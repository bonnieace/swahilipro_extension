const crypto = require('crypto');
const { WorkspacePolicy, validText, hash } = require('./policy');
const { ClientError } = require('../auth/api');
function fingerprint(value) {
  function sorted(row) { if (Array.isArray(row)) return row.map(sorted); if (row && typeof row === 'object') return Object.fromEntries(Object.keys(row).sort().map(k => [k, sorted(row[k])])); return row; }
  // Match Python's ensure_ascii=True for protocol approval hashes.
  const canonical = JSON.stringify(sorted(value)).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
class EditorTools {
  constructor(vscode, root, alive = () => true) { this.vscode = vscode; this.policy = new WorkspacePolicy(root); this.approved = new Map(); this.alive = alive; this.previews = new Map(); }
  check() { if (!this.alive() || !this.vscode.workspace.isTrusted) throw new ClientError('cancelled_or_untrusted_workspace'); }
  async read({ path, allowMissing }) {
    this.check(); const file = await this.policy.resolve(path, allowMissing);
    const uri = this.vscode.Uri.file(file);
    let doc;
    try { doc = await this.vscode.workspace.openTextDocument(uri); }
    catch (error) { if (allowMissing && ['FileNotFound', 'ENOENT'].includes(error.code)) return { exists: false }; throw new ClientError('file_unreadable'); }
    this.check(); return { exists: true, text: validText(doc.getText()), version: doc.version };
  }
  async approve(proposal) {
    this.check();
    if (!proposal || proposal.tool !== 'edit' || proposal.root !== this.policy.root || !/^[a-f0-9]{32}$/.test(proposal.operationId)) throw new ClientError('unsupported_edit_proposal');
    const { approvalHash, ...body } = proposal;
    if (fingerprint(body) !== approvalHash || hash(validText(proposal.text)) !== proposal.afterHash) throw new ClientError('invalid_approval_binding');
    const row = await this.read({ path: proposal.path, allowMissing: true });
    if ((row.exists ? hash(row.text) : null) !== proposal.baseHash || (row.exists ? row.version : null) !== proposal.version) throw new ClientError('stale_editor_buffer');
    const left = this.vscode.Uri.parse(`swahilipro-diff:/${proposal.operationId}/before`);
    const right = this.vscode.Uri.parse(`swahilipro-diff:/${proposal.operationId}/after`);
    this.previews.set(left.toString(), row.text || ''); this.previews.set(right.toString(), proposal.text);
    await this.vscode.commands.executeCommand('vscode.diff', left, right, `SwahiliPro: ${proposal.path}`, { preview: true });
    const choice = await this.vscode.window.showInformationMessage(`Apply this change to ${proposal.path}?${proposal.syntax?.valid === false ? ' Syntax checking reported an error.' : ''}`, { modal: true }, 'Apply');
    this.check();
    if (choice !== 'Apply') return { approved: false };
    this.approved.set(proposal.operationId, approvalHash);
    return { approved: true, approvalHash };
  }
  async apply(proposal) {
    this.check();
    const approved = this.approved.get(proposal.operationId); this.approved.delete(proposal.operationId);
    const { approvalHash, ...body } = proposal;
    if (!approved || approved !== approvalHash || fingerprint(body) !== approved) throw new ClientError('stale_or_duplicate_approval');
    const file = await this.policy.resolve(proposal.path, true);
    const row = await this.read({ path: proposal.path, allowMissing: true });
    if ((row.exists ? hash(row.text) : null) !== proposal.baseHash || (row.exists ? row.version : null) !== proposal.version) throw new ClientError('stale_editor_buffer');
    this.check();
    const uri = this.vscode.Uri.file(file);
    const edit = new this.vscode.WorkspaceEdit();
    if (!row.exists) edit.createFile(uri, { overwrite: false });
    // This buffer/version check is immediately before applyEdit; the API itself
    // has no version parameter. Confirm post-edit text before acknowledging.
    edit.replace(uri, new this.vscode.Range(0, 0, row.exists ? this.vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString()).lineCount : 0, 0), proposal.text);
    if (!await this.vscode.workspace.applyEdit(edit)) return { applied: false };
    const document = await this.vscode.workspace.openTextDocument(uri);
    if (hash(document.getText()) !== proposal.afterHash) return { applied: false };
    return { applied: true, hash: proposal.afterHash };
  }
  dispose() { this.approved.clear(); this.previews.clear(); }
}
module.exports = { EditorTools, fingerprint };
