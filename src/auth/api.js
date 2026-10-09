const https = require('https');
class ClientError extends Error {
  constructor(code, status = 0) { super(code); this.code = code; this.status = status; }
}
function apiOrigin(value) {
  try {
    if (typeof value !== 'string' || /[\s\x00-\x1f]/.test(value)) throw new Error();
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error();
    return parsed.origin;
  } catch (_) { throw new ClientError('configure_https_api_origin'); }
}
function safeCode(value) { return typeof value === 'string' && /^[a-z_]{1,80}$/.test(value) ? value : 'gateway_rejected'; }
class Api {
  constructor(origin, transport = https.request) { this.origin = apiOrigin(origin); this.transport = transport; }
  json(method, path, body, token, signal) {
    if (!/^\/api\/[a-z0-9/_-]+$/i.test(path)) return Promise.reject(new ClientError('invalid_api_path'));
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const headers = { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      const request = this.transport(new URL(path, this.origin), { method, headers, signal }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > 131072) request.destroy(); else chunks.push(chunk); });
        response.on('error', () => reject(new ClientError('gateway_connection_failed')));
        response.on('end', () => {
          try {
            if (size > 131072) throw new ClientError('gateway_response_limit');
            const row = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error();
            if (response.statusCode >= 300) throw new ClientError(safeCode(row.error), response.statusCode);
            resolve(row);
          } catch (error) { reject(error instanceof ClientError ? error : new ClientError('invalid_gateway_response')); }
        });
      });
      const deadline = setTimeout(() => request.destroy(), 30000);
      request.on('close', () => clearTimeout(deadline));
      request.on('error', () => reject(new ClientError(signal?.aborted ? 'cancelled' : 'gateway_connection_failed')));
      if (payload) request.write(payload);
      request.end();
    });
  }
}
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new ClientError('cancelled')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
module.exports = { Api, ClientError, apiOrigin, pause };
