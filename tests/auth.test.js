const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Session, diskLock } = require('../src/auth/session');
const { apiOrigin, ClientError } = require('../src/auth/api');
const token = letter => letter.repeat(43);
function fixture(json) {
  const values = new Map(); const secrets = { get: async k => values.get(k), store: async (k, v) => values.set(k, v), delete: async k => values.delete(k) };
  const session = new Session(secrets, { origin: 'https://account.test', json }, async (_key, action) => action(), async () => true);
  return { session, secrets, values };
}
const pair = { tokenType: 'Bearer', accessToken: token('a'), refreshToken: token('b'), grantId: token('g'), expiresIn: 900 };
test('only a bare HTTPS origin is accepted', () => {
  assert.equal(apiOrigin('https://account.test/'), 'https://account.test');
  for (const origin of ['http://account.test', 'https://evil@account.test', 'https://account.test/api', 'https://account.test?x=1', 'https://account.test/#x', ' https://account.test']) assert.throws(() => apiOrigin(origin));
});
test('browser login binds S256 and separates status and completion polls', async () => {
  const calls = []; let clock = 0; const sleeps = [];
  const { session, values } = fixture(async (_method, route, body) => {
    calls.push({ route, body, clock });
    if (route.endsWith('start')) return { attemptId: token('i'), pollingSecret: token('p'), confirmationCode: 'AABB1234', interval: 5, expiresIn: 60, verificationUrl: 'https://account.test/authorize-client?attempt=' + token('i') };
    if (route.endsWith('status')) return { state: 'approved' };
    return pair;
  });
  await session.login(() => {}, undefined, async ms => { sleeps.push(ms); clock += ms; }, () => clock);
  assert.deepEqual(sleeps, [5000, 5000]);
  assert.equal(require('crypto').createHash('sha256').update(calls[2].body.verifier).digest('base64url'), calls[0].body.challenge);
  const stored = [...values.values()].join(''); assert(!stored.includes(pair.accessToken)); assert(stored.includes(pair.refreshToken));
  assert.equal(await session.token(), pair.accessToken);
});
test('login refuses a substituted verification URL', async () => {
  const { session } = fixture(async () => ({ attemptId: token('i'), pollingSecret: token('p'), confirmationCode: 'AABB1234', interval: 5, expiresIn: 60, verificationUrl: 'https://other.test' }));
  await assert.rejects(session.login(() => {}), { code: 'invalid_login_attempt' });
});
test('lost refresh response leaves a durable marker and is never retried', async () => {
  let calls = 0; const { session, secrets } = fixture(async () => { ++calls; throw new ClientError('gateway_connection_failed'); });
  await session.save({ v: 1, refreshToken: token('r'), grantId: token('g') });
  await assert.rejects(session.token());
  const restarted = new Session(secrets, session.api, session.lock, async () => true);
  await assert.rejects(restarted.token(), { code: 'refresh_uncertain_sign_out_and_sign_in' }); assert.equal(calls, 1);
});
test('failed SecretStorage write prevents refresh network call', async () => {
  let calls = 0; const { session, secrets } = fixture(async () => { ++calls; return pair; });
  await session.save({ v: 1, refreshToken: token('r'), grantId: token('g') });
  secrets.store = async () => { throw new Error('sensitive internal detail'); };
  await assert.rejects(session.token(), { code: 'secret_storage_write_failed' }); assert.equal(calls, 0);
});
test('logout deletes the local secret even when revocation is uncertain', async () => {
  const { session } = fixture(async () => { throw new ClientError('offline'); });
  await session.save({ v: 1, refreshToken: token('r'), grantId: token('g'), refreshAttempted: true });
  assert.equal(await session.logout(), false); assert.equal(await session.read(), null);
});
test('disk lock serializes account actions across separate session instances', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'swa-auth-test-')); const lock = diskLock(directory);
  let unlock; let entered; const ready = new Promise(r => { entered = r; }); const hold = new Promise(r => { unlock = r; });
  try {
    const running = lock('same-account', async () => { entered(); await hold; }); await ready;
    await assert.rejects(diskLock(directory)('same-account', async () => {}), { code: 'another_account_action_is_running' });
    unlock(); await running; await lock('same-account', async () => {});
  } finally { unlock?.(); await fs.rm(directory, { recursive: true, force: true }); }
});
