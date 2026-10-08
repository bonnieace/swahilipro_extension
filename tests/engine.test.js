const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Decoder, EngineProcess, MAX_FRAME } = require('../src/agent/process');
const { fingerprint } = require('../src/workspace/edits');
test('decoder preserves split UTF-8 and rejects oversized or malformed frames', () => {
  const decoder = new Decoder(); const bytes = Buffer.from(JSON.stringify({ v: 1, type: 'event', text: 'Habari 🙂' }) + '\n');
  const index = bytes.indexOf(Buffer.from('🙂')) + 1;
  assert.deepEqual(decoder.push(bytes.subarray(0, index)), []); assert.equal(decoder.push(bytes.subarray(index))[0].text, 'Habari 🙂');
  assert.throws(() => new Decoder().push(Buffer.alloc(MAX_FRAME + 1)), { code: 'engine_frame_limit' });
  assert.throws(() => new Decoder().push(Buffer.from('{"v":1,"type":"\xff"}\n', 'binary')), { code: 'invalid_engine_utf8' });
  assert.throws(() => new Decoder().push(Buffer.from('{"v":2,"type":"hello"}\n')), { code: 'incompatible_engine_protocol' });
});
test('approval canonical JSON matches Python for Unicode and sorted nested keys', () => {
  const { spawnSync } = require('child_process'); const value = { z: '🙂 é\u007f', a: { b: 2, a: null } };
  const result = spawnSync('python', ['-c', 'import sys,json,hashlib;print(hashlib.sha256(json.dumps(json.loads(sys.stdin.read()),sort_keys=True,separators=(",",":"),ensure_ascii=True).encode()).hexdigest())'], { input: JSON.stringify(value), encoding: 'utf8' });
  assert.equal(result.status, 0); assert.equal(fingerprint(value), result.stdout.trim());
});
test('real packaged compiler reads unsaved host data and binds an approved edit', { skip: !process.env.SWA_ENGINE_BINARY }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swa-engine-')); await fs.writeFile(path.join(root, 'example.txt'), 'disk');
  let text = 'unsaved buffer'; let version = 7; let approved;
  const engine = new EngineProcess(process.env.SWA_ENGINE_BINARY, root, async event => {
    const body = { kind: event.kind, operationRequestId: event.operationRequestId, ...(event.kind === 'approval' ? { proposal: event.proposal } : { payload: event.payload }) };
    assert.equal(fingerprint(body), event.binding);
    if (event.kind === 'read') return { exists: true, text, version };
    if (event.kind === 'approval') { approved = event.proposal; assert.equal(approved.version, version); return { approved: true, approvalHash: approved.approvalHash }; }
    if (event.kind === 'apply') { assert.deepEqual(event.payload, approved); text = event.payload.text; ++version; return { applied: true, hash: event.payload.afterHash }; }
    throw new Error('unexpected host operation');
  });
  try {
    await engine.ready; await engine.request('initialize', { workspace: root, mode: 'host' });
    const read = await engine.request('tool', { name: 'read', arguments: { path: 'example.txt' } });
    assert.equal(read.text, text);
    const baseHash = require('../src/workspace/policy').hash(text);
    await engine.request('tool', { name: 'edit', arguments: { path: 'example.txt', text: 'replacement', baseHash } });
    assert.equal(text, 'replacement'); assert.equal(await fs.readFile(path.join(root, 'example.txt'), 'utf8'), 'disk');
  } finally { engine.dispose(); await fs.rm(root, { recursive: true, force: true }); }
});
