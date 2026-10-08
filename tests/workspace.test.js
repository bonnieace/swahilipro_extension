const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { WorkspacePolicy, hash } = require('../src/workspace/policy');
const { EditorTools, fingerprint } = require('../src/workspace/edits');
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swa-editor-')); await fs.writeFile(path.join(root, 'file.txt'), 'on disk');
  const uri = file => ({ fsPath: file, toString: () => file }); let text = 'dirty'; let version = 5; let applied = 0;
  const doc = { uri: uri(path.join(root, 'file.txt')), getText: () => text, get version() { return version; }, lineCount: 1 };
  const vscode = { workspace: { isTrusted: true, textDocuments: [doc], openTextDocument: async () => doc, applyEdit: async edit => { text = edit.text; ++version; ++applied; return true; } }, Uri: { file: uri, parse: uri }, Range: class {}, WorkspaceEdit: class { replace(_uri, _range, value) { this.text = value; } }, commands: { executeCommand: async () => {} }, window: { showInformationMessage: async () => 'Apply' } };
  const tools = new EditorTools(vscode, root); const proposal = { operationId: 'a'.repeat(32), tool: 'edit', root, path: 'file.txt', baseHash: hash(text), version, text: 'new text', afterHash: hash('new text'), diff: '', syntax: null }; proposal.approvalHash = fingerprint(proposal);
  return { root, tools, proposal, vscode, mutate: () => { text = 'new dirty text'; ++version; }, applied: () => applied, text: () => text, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}
test('policy excludes traversal, secrets, ignores, symlinks and hard links', async () => {
  const f = await fixture(); const policy = new WorkspacePolicy(f.root);
  try {
    await fs.writeFile(path.join(f.root, '.gitignore'), 'ignored.txt\n'); await fs.writeFile(path.join(f.root, 'ignored.txt'), 'x');
    await fs.symlink(path.join(f.root, 'file.txt'), path.join(f.root, 'link.txt')); await fs.link(path.join(f.root, 'file.txt'), path.join(f.root, 'hard.txt'));
    for (const name of ['../x', '/etc/passwd', '.env', 'node_modules/x', 'ignored.txt', 'link.txt', 'hard.txt']) await assert.rejects(policy.resolve(name, true));
  } finally { await f.cleanup(); }
});
test('reviewed WorkspaceEdit reads dirty buffers and does not save disk', async () => {
  const f = await fixture();
  try { assert.equal((await f.tools.read({ path: 'file.txt' })).text, 'dirty'); await f.tools.approve(f.proposal); assert.equal((await f.tools.apply(f.proposal)).applied, true); assert.equal(f.text(), 'new text'); assert.equal(await fs.readFile(path.join(f.root, 'file.txt'), 'utf8'), 'on disk'); await assert.rejects(f.tools.apply(f.proposal)); }
  finally { await f.cleanup(); }
});
test('buffer changes after approval block application', async () => {
  const f = await fixture(); try { await f.tools.approve(f.proposal); f.mutate(); await assert.rejects(f.tools.apply(f.proposal), { code: 'stale_editor_buffer' }); assert.equal(f.applied(), 0); } finally { await f.cleanup(); }
});
test('mutated proposal and cancellation cannot reuse approval', async () => {
  const f = await fixture(); try { await f.tools.approve(f.proposal); await assert.rejects(f.tools.apply({ ...f.proposal, text: 'injected' })); assert.equal(f.applied(), 0); f.vscode.workspace.isTrusted = false; await assert.rejects(f.tools.read({ path: 'file.txt' })); } finally { await f.cleanup(); }
});
test('denial does not grant an edit and unreadable files are not missing', async () => {
  const f = await fixture(); try { f.vscode.window.showInformationMessage = async () => undefined; assert.deepEqual(await f.tools.approve(f.proposal), { approved: false }); await assert.rejects(f.tools.apply(f.proposal)); f.vscode.workspace.openTextDocument = async () => { throw Object.assign(new Error(), { code: 'EACCES' }); }; await assert.rejects(f.tools.read({ path: 'file.txt', allowMissing: true }), { code: 'file_unreadable' }); } finally { await f.cleanup(); }
});
