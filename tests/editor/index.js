const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const vscode = require('vscode');
const { EditorTools, fingerprint } = require('../../src/workspace/edits');
const { hash } = require('../../src/workspace/policy');
async function run() {
  const extension = vscode.extensions.getExtension('masota.swahilipro'); assert(extension); await extension.activate();
  const root = await fs.realpath(vscode.workspace.workspaceFolders[0].uri.fsPath);
  const uri = vscode.Uri.file(path.join(root, 'example.txt')); const doc = await vscode.workspace.openTextDocument(uri); await vscode.window.showTextDocument(doc);
  const edit = new vscode.WorkspaceEdit(); edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), 'dirty buffer'); assert(await vscode.workspace.applyEdit(edit));
  const adapter = { ...vscode, window: { ...vscode.window, showInformationMessage: async () => 'Apply' }, commands: { ...vscode.commands, executeCommand: async () => {} } };
  const tools = new EditorTools(adapter, root); const current = await tools.read({ path: 'example.txt' }); assert.equal(current.text, 'dirty buffer'); assert(doc.isDirty);
  const proposal = { operationId: 'f'.repeat(32), tool: 'edit', root, path: 'example.txt', baseHash: hash(current.text), version: current.version, text: 'reviewed replacement', afterHash: hash('reviewed replacement'), diff: '', syntax: null }; proposal.approvalHash = fingerprint(proposal);
  await tools.approve(proposal); assert.equal((await tools.apply(proposal)).applied, true); assert.equal(doc.getText(), 'reviewed replacement'); assert(doc.isDirty); assert.equal(await fs.readFile(uri.fsPath, 'utf8'), 'disk text');
  await vscode.commands.executeCommand('undo'); assert.equal(doc.getText(), 'dirty buffer');
  tools.dispose();
  console.log('VS Code dirty-buffer edit, disk preservation and undo passed.');
}
module.exports = { run };
