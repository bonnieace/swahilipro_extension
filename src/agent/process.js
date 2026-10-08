const { spawn } = require('child_process');
const os = require('os');
const { ClientError } = require('../auth/api');
const MAX_FRAME = 262144;
class Decoder {
  constructor() { this.buffer = Buffer.alloc(0); }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    const rows = [];
    let index;
    while ((index = this.buffer.indexOf(10)) !== -1) {
      if (index + 1 > MAX_FRAME) throw new ClientError('engine_frame_limit');
      let line; try { line = new TextDecoder('utf-8', { fatal: true }).decode(this.buffer.subarray(0, index)); } catch (_) { throw new ClientError('invalid_engine_utf8'); }
      this.buffer = this.buffer.subarray(index + 1);
      let row; try { row = JSON.parse(line); } catch (_) { throw new ClientError('invalid_engine_frame'); }
      if (!row || row.v !== 1 || typeof row.type !== 'string') throw new ClientError('incompatible_engine_protocol');
      rows.push(row);
    }
    if (this.buffer.length > MAX_FRAME) throw new ClientError('engine_frame_limit');
    return rows;
  }
}
class EngineProcess {
  constructor(binary, cwd, onHost, spawnProcess = spawn) {
    this.counter = 0; this.pending = new Map(); this.closed = false; this.onHost = onHost; this.decoder = new Decoder();
    const env = { PATH: process.env.PATH || '', HOME: os.homedir(), USERPROFILE: os.homedir(), LANG: 'C.UTF-8' };
    for (const key of ['SystemRoot', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
    this.child = spawnProcess(binary, ['agent', '--stdio'], { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
    this.ready = new Promise((resolve, reject) => { this.resolveHello = resolve; this.rejectHello = reject; });
    this.startTimer = setTimeout(() => this.fail('engine_startup_timeout'), 10000);
    this.child.stdout.on('data', chunk => {
      try { for (const row of this.decoder.push(chunk)) this.receive(row); }
      catch (error) { this.fail(error.code || 'invalid_engine_frame'); }
    });
    // Drain stderr without retaining/logging it; it may include user source.
    let stderrSize = 0;
    this.child.stderr.on('data', chunk => { stderrSize += chunk.length; if (stderrSize > 65536) this.fail('engine_stderr_limit'); });
    this.child.stdin.on('error', () => this.fail('engine_pipe_closed'));
    this.child.on('error', () => this.fail('engine_start_failed'));
    this.child.on('close', () => { clearTimeout(this.killTimer); this.fail('engine_stopped'); });
  }
  receive(row) {
    if (this.closed) return;
    if (row.type === 'hello') {
      if (this.hello || row.protocol !== 1 || !Array.isArray(row.capabilities) || !['initialize', 'tool', 'prompt', 'reply', 'cancel'].every(k => row.capabilities.includes(k))) throw new ClientError('update_compiler_for_agent_protocol');
      this.hello = row; clearTimeout(this.startTimer); this.resolveHello(row); return;
    }
    if (!this.hello) throw new ClientError('engine_handshake_required');
    const operation = this.pending.get(row.id);
    if (!operation) throw new ClientError('unexpected_engine_response');
    if (row.type === 'event') {
      if (row.event === 'host.request') {
        if (typeof row.callId !== 'string' || !/^[a-f0-9]{32}$/.test(row.callId) || typeof row.binding !== 'string' || !/^[a-f0-9]{64}$/.test(row.binding) || row.operationRequestId !== row.id) throw new ClientError('invalid_host_request');
        Promise.resolve().then(() => this.onHost(row)).then(result => {
          if (!this.closed && this.pending.has(row.id)) return this.request('reply', { callId: row.callId, binding: row.binding, result });
        }).catch(() => { if (!this.closed) this.request('cancel', { requestId: row.id }).catch(() => {}); });
      } else if (row.event === 'gateway') operation.onEvent?.(row.data);
      else throw new ClientError('unsupported_engine_event');
    } else if (row.type === 'result' || row.type === 'error') {
      clearTimeout(operation.timer); this.pending.delete(row.id);
      if (row.type === 'error') operation.reject(new ClientError(typeof row.error === 'string' && /^[a-z_]{1,100}$/.test(row.error) ? row.error : 'engine_request_failed'));
      else operation.resolve(row.result);
    } else throw new ClientError('invalid_engine_message');
  }
  write(message) {
    const frame = Buffer.from(JSON.stringify({ v: 1, ...message }) + '\n');
    if (frame.length > MAX_FRAME) throw new ClientError('engine_input_limit');
    this.child.stdin.write(frame);
  }
  request(method, params, onEvent) {
    if (this.closed) return Promise.reject(new ClientError('engine_stopped'));
    const id = String(++this.counter);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('engine_operation_timeout'), 300000);
      this.pending.set(id, { resolve, reject, onEvent, timer });
      try { this.write({ id, method, params }); }
      catch (_) { clearTimeout(timer); this.pending.delete(id); reject(new ClientError('engine_input_limit')); }
    });
  }
  fail(code) {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.startTimer); this.rejectHello(new ClientError(code));
    for (const row of this.pending.values()) { clearTimeout(row.timer); row.reject(new ClientError(code)); }
    this.pending.clear(); this.child.kill();
  }
  dispose() {
    if (this.closed) return;
    try { this.write({ id: `stop_${++this.counter}`, method: 'shutdown', params: {} }); } catch (_) { /* Pipe already closed. */ }
    this.closed = true; clearTimeout(this.startTimer); this.rejectHello(new ClientError('cancelled'));
    for (const row of this.pending.values()) { clearTimeout(row.timer); row.reject(new ClientError('cancelled')); }
    this.pending.clear(); this.killTimer = setTimeout(() => this.child.kill(), 35000); this.killTimer.unref();
  }
}
module.exports = { EngineProcess, Decoder, MAX_FRAME };
