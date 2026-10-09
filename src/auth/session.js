const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const lockfile = require('proper-lockfile');
const { ClientError, pause } = require('./api');
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
function tokenPair(row) {
  if (!row || row.tokenType !== 'Bearer' || ['accessToken', 'refreshToken', 'grantId'].some(k => typeof row[k] !== 'string' || !TOKEN.test(row[k])) || !Number.isInteger(row.expiresIn) || row.expiresIn < 120 || row.expiresIn > 900) throw new ClientError('invalid_token_response');
  return row;
}
function diskLock(directory) {
  return async (key, action) => {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, crypto.createHash('sha256').update(key).digest('hex'));
    await fs.writeFile(target, '', { flag: 'a', mode: 0o600 });
    let release;
    try { release = await lockfile.lock(target, { realpath: false, stale: 120000, update: 10000, retries: 0 }); }
    catch (_) { throw new ClientError('another_account_action_is_running'); }
    try { return await action(); } finally { await release(); }
  };
}
class Session {
  constructor(secrets, api, lock, open, onChange = () => {}) {
    this.secrets = secrets; this.api = api; this.lock = lock; this.open = open; this.onChange = onChange;
    this.key = 'swahilipro.account.v1.' + crypto.createHash('sha256').update(api.origin).digest('hex');
    this.access = null; this.identity = null; this.lastWritten = undefined;
  }
  async read() {
    try {
      const raw = await this.secrets.get(this.key);
      if (!raw) return null;
      const row = JSON.parse(raw);
      if (row.v !== 1 || !TOKEN.test(row.refreshToken) || !TOKEN.test(row.grantId)) throw new Error();
      return row;
    } catch (_) { throw new ClientError('secret_storage_read_failed'); }
  }
  async save(row) {
    try { this.lastWritten = JSON.stringify(row); await this.secrets.store(this.key, this.lastWritten); }
    catch (_) { throw new ClientError('secret_storage_write_failed'); }
  }
  async externalChange(key) {
    if (key !== this.key) return;
    const raw = await this.secrets.get(this.key);
    if (raw === this.lastWritten) return;
    const previous = this.access?.grantId;
    this.access = null; this.identity = null;
    const row = await this.read();
    if (!row || (previous && row.grantId !== previous)) this.onChange();
  }
  async login(show, signal, sleep = pause, now = () => Date.now()) {
    return this.lock(this.key, async () => {
      if (await this.read()) throw new ClientError('sign_out_before_switching_accounts');
      const verifier = crypto.randomBytes(48).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const attempt = await this.api.json('POST', '/api/v1/auth/client/start', { clientType: 'vscode', label: 'SwahiliPro VS Code', challenge }, undefined, signal);
      const expected = `${this.api.origin}/authorize-client?attempt=${attempt.attemptId}`;
      if (!TOKEN.test(attempt.attemptId) || !TOKEN.test(attempt.pollingSecret) || !/^[A-F0-9]{8}$/.test(attempt.confirmationCode) || attempt.verificationUrl !== expected || !Number.isInteger(attempt.interval) || attempt.interval < 5 || attempt.interval > 30 || !Number.isInteger(attempt.expiresIn) || attempt.expiresIn < 1 || attempt.expiresIn > 600) throw new ClientError('invalid_login_attempt');
      show({ url: expected, code: attempt.confirmationCode });
      if (await this.open(expected) === false) throw new ClientError('browser_could_not_be_opened');
      const deadline = now() + attempt.expiresIn * 1000;
      let approved = false;
      const polling = { attemptId: attempt.attemptId, pollingSecret: attempt.pollingSecret };
      while (now() < deadline) {
        await sleep(attempt.interval * 1000, signal);
        if (now() >= deadline) break;
        try {
          if (approved) {
            const pair = tokenPair(await this.api.json('POST', '/api/v1/auth/client/complete', { ...polling, verifier }, undefined, signal));
            await this.save({ v: 1, refreshToken: pair.refreshToken, grantId: pair.grantId });
            this.access = { token: pair.accessToken, grantId: pair.grantId, expiresAt: Date.now() + pair.expiresIn * 1000 };
            return;
          }
          const row = await this.api.json('POST', '/api/v1/auth/client/status', polling, undefined, signal);
          if (!['pending', 'approved'].includes(row.state)) throw new ClientError('authorization_denied_or_expired');
          approved = row.state === 'approved';
        } catch (error) { if (error.status === 429) continue; throw error; }
      }
      throw new ClientError('login_attempt_expired');
    });
  }
  async token() { return this.lock(this.key, () => this._token()); }
  async _token() {
    const row = await this.read();
    if (!row) throw new ClientError('sign_in_required');
    if (row.refreshAttempted) throw new ClientError('refresh_uncertain_sign_out_and_sign_in');
    if (this.access?.grantId === row.grantId && this.access.expiresAt > Date.now() + 120000) return this.access.token;
    await this.save({ ...row, refreshAttempted: true });
    const pair = tokenPair(await this.api.json('POST', '/api/v1/auth/client/refresh', { refreshToken: row.refreshToken }));
    if (pair.grantId !== row.grantId) throw new ClientError('invalid_refresh_grant');
    await this.save({ v: 1, refreshToken: pair.refreshToken, grantId: pair.grantId });
    this.access = { token: pair.accessToken, grantId: pair.grantId, expiresAt: Date.now() + pair.expiresIn * 1000 };
    return pair.accessToken;
  }
  async profile() {
    const row = await this.api.json('GET', '/api/v1/me', undefined, await this.token());
    if (typeof row.uid !== 'string' || row.uid.length < 1 || row.uid.length > 128) throw new ClientError('invalid_account_response');
    this.identity = { uid: row.uid, name: String(row.name || '').slice(0, 100), email: String(row.email || '').slice(0, 200) };
    return this.identity;
  }
  async logout() {
    return this.lock(this.key, async () => {
      let confirmed = !(await this.read());
      try { if (!confirmed) { const token = await this._token(); await this.api.json('POST', '/api/v1/auth/client/logout', undefined, token); confirmed = true; } }
      catch (_) { /* Local deletion always follows; website can revoke offline grants. */ }
      {
        try { this.lastWritten = undefined; await this.secrets.delete(this.key); }
        catch (_) { throw new ClientError('secret_storage_delete_failed'); }
        this.access = null; this.identity = null; this.onChange();
      }
      return confirmed;
    });
  }
}
module.exports = { Session, diskLock, tokenPair };
