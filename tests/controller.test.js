const test = require('node:test');
const assert = require('node:assert/strict');
const { Controller, userSetting } = require('../src/chat/controller');
const disposable = () => ({ dispose() {} });
function fixture(request) {
  const vscode = { workspace: { isTrusted: true, onDidChangeWorkspaceFolders: disposable, onDidChangeConfiguration: disposable }, env: {} };
  const context = { secrets: { onDidChange: disposable } };
  const c = new Controller(vscode, context, () => 'unused'); c.state.enabled = true; c.state.models = [{ id: 'model', name: 'Model', maxOutputTokens: 2048 }]; c.state.account = { name: 'Fixture' };
  c.connect = async () => ({ request }); return c;
}
test('streamed chat keeps client receipt and only completed text enters context', async () => {
  const rid = 'a'.repeat(64);
  const c = fixture(async (_method, _params, emit) => {
    emit({ version: 1, type: 'client.request', requestId: rid }); emit({ version: 1, type: 'request.started', requestId: rid }); emit({ version: 1, type: 'text.delta', text: 'Habari' }); emit({ version: 1, type: 'request.completed', actual: 12 });
  });
  await c.send('hello', 'model'); assert.equal(c.state.requestId, rid); assert.equal(c.state.messages[1].content, 'Habari'); assert.equal(c.messages[1].content, 'Habari'); assert.equal(c.state.busy, false); c.dispose();
});
test('interrupted response is visible but cannot be automatically resent', async () => {
  let calls = 0; const c = fixture(async (_method, _params, emit) => { ++calls; emit({ version: 1, type: 'client.request', requestId: 'a'.repeat(64) }); emit({ version: 1, type: 'text.delta', text: 'partial' }); throw new Error('lost'); });
  await c.send('hello', 'model'); assert.equal(c.messages.length, 0); assert.equal(c.state.messages[1].content, 'partial'); assert.equal(c.state.requestId, 'a'.repeat(64));
  await assert.rejects(c.send('retry', 'model'), { code: 'start_new_chat_after_interrupted_response' }); assert.equal(calls, 1); c.dispose();
});
test('stop during engine connection prevents the paid prompt', async () => {
  const c = fixture(async () => { throw new Error('should never send'); }); let resolve;
  c.connect = () => new Promise(r => { resolve = r; }); const sending = c.send('hello', 'model'); c.stop(); resolve({ request: async () => { throw new Error('paid call after stop'); } }); await sending;
  assert.equal(c.state.messages.length, 0); assert.equal(c.state.busy, false); assert(c.needsNewSession); c.dispose();
});
test('untrusted workspace and workspace-provided origins cannot authorize calls', async () => {
  const c = fixture(async () => {}); c.vscode.workspace.isTrusted = false; await assert.rejects(c.send('hello', 'model'), { code: 'trust_workspace_first' });
  assert.equal(userSetting({ workspace: { getConfiguration: () => ({ inspect: () => ({ globalValue: 'https://trusted.test', workspaceValue: 'https://evil.test' }) }) } }, 'apiOrigin'), 'https://trusted.test'); c.dispose();
});
