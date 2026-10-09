const fs = require('fs/promises');
const path = require('path');
const { Api, ClientError } = require('../auth/api');
const { Session, diskLock } = require('../auth/session');
const { EngineProcess } = require('../agent/process');
const { EditorTools, fingerprint } = require('../workspace/edits');
const { WorkspacePolicy, validText, hash } = require('../workspace/policy');
function userSetting(vscode, key) { return vscode.workspace.getConfiguration('swahilipro').inspect(key)?.globalValue ?? (key === 'apiOrigin' ? 'https://swahilipro.com' : ''); }
function safeError(error) { return typeof error?.code === 'string' && /^[a-z_]{1,100}$/.test(error.code) ? error.code.replace(/_/g, ' ') : 'The operation could not be completed.'; }
function catalog(row) {
  if (typeof row.enabled !== 'boolean' || !Array.isArray(row.models) || row.models.length > 30) throw new ClientError('invalid_model_catalog');
  return row.models.map(m => {
    if (typeof m.id !== 'string' || !m.id || m.id.length > 250 || typeof m.name !== 'string' || m.name.length > 100 || !Number.isInteger(m.maxOutputTokens) || m.maxOutputTokens < 1 || m.maxOutputTokens > 8192) throw new ClientError('invalid_model_catalog');
    return { id: m.id, name: m.name, maxOutputTokens: m.maxOutputTokens };
  });
}
class Controller {
  constructor(vscode, context, runtime) {
    this.vscode = vscode; this.context = context; this.runtime = runtime; this.generation = 0;
    this.state = { busy: false, account: null, credits: null, models: [], enabled: false, messages: [], error: '', attachment: null, requestId: null, receipt: null };
    this.messages = []; this.publish = () => {}; this.session = null;
    this.disposables = [context.secrets.onDidChange(e => { this.session?.externalChange(e.key).catch(error => this.error(error)); }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.newSession()),
      vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('swahilipro.apiOrigin') || e.affectsConfiguration('swahilipro.runtimePath')) { this.loginAbort?.abort(); this.newSession(); this.session = null; this.state.account = null; this.state.models = []; this.state.enabled = false; this.update(); } })];
  }
  check() { if (!this.vscode.workspace.isTrusted) throw new ClientError('trust_workspace_first'); if (this.vscode.env.remoteName) throw new ClientError('remote_workspaces_are_not_supported_yet'); }
  update() { this.publish({ ...this.state, trusted: this.vscode.workspace.isTrusted }); }
  error(error) { this.state.error = safeError(error); this.update(); }
  account() {
    this.check(); const origin = userSetting(this.vscode, 'apiOrigin');
    if (!this.session) this.session = new Session(this.context.secrets, new Api(origin), diskLock(path.join(this.context.globalStorageUri.fsPath, 'auth-locks')), url => this.vscode.env.openExternal(this.vscode.Uri.parse(url)), () => { this.newSession(); this.state.account = null; this.state.credits = null; this.update(); });
    return this.session;
  }
  async refresh() {
    if (this.state.busy) throw new ClientError('finish_current_operation_first');
    const generation = this.generation; const session = this.account();
    if (!await session.read()) { this.state.account = null; this.state.credits = null; this.state.models = []; this.state.enabled = false; this.update(); return; }
    const profile = await session.profile(); const token = await session.token();
    const [credits, models] = await Promise.all([session.api.json('GET', '/api/v1/credits', undefined, token), session.api.json('GET', '/api/v1/models', undefined, token)]);
    const available = credits.available;
    if (!Number.isSafeInteger(available) || available < 0 || credits.unit !== 'microcredits') throw new ClientError('invalid_credit_response');
    const choices = catalog(models);
    if (generation !== this.generation || session !== this.session) return;
    this.state.account = { name: profile.name, email: profile.email }; this.state.credits = available;
    this.state.models = choices; this.state.enabled = models.enabled; this.state.error = ''; this.update();
  }
  async signIn() {
    const session = this.account(); if (this.loginAbort) throw new ClientError('login_already_running');
    const abort = new AbortController(); this.loginAbort = abort;
    try {
      await this.vscode.window.withProgress({ location: this.vscode.ProgressLocation.Notification, title: 'Sign in to SwahiliPro', cancellable: true }, async (progress, cancellation) => {
        const disposable = cancellation.onCancellationRequested(() => abort.abort());
        try { await session.login(({ code }) => { progress.report({ message: `Confirm code ${code} in your browser.` }); }, abort.signal); }
        finally { disposable.dispose(); }
      });
      if (session === this.session) await this.refresh();
    } finally { if (this.loginAbort === abort) this.loginAbort = null; }
  }
  async signOut() {
    this.loginAbort?.abort(); this.newSession();
    const confirmed = await this.account().logout();
    this.state.account = null; this.state.models = []; this.state.credits = null; this.state.enabled = false;
    this.state.error = confirmed ? '' : 'Signed out locally. Revoke this device on the website if remote sign-out could not be confirmed.'; this.update();
  }
  stop() {
    ++this.generation; this.engine?.dispose(); this.engine = null; this.tools?.dispose(); this.tools = null; this.root = null;
    if (this.state.busy) { this.needsNewSession = true; this.state.error = 'Stopped. Start a new chat before sending again. Credits may already have been used; check the request status.'; }
    this.state.busy = false; this.update();
  }
  newSession() { this.stop(); this.messages = []; this.attachment = null; this.needsNewSession = false; this.state.messages = []; this.state.attachment = null; this.state.requestId = null; this.state.receipt = null; this.state.error = ''; this.update(); }
  async workspace() {
    this.check(); if (this.root) return this.root;
    const folders = (this.vscode.workspace.workspaceFolders || []).filter(f => f.uri.scheme === 'file');
    if (!folders.length) throw new ClientError('open_local_workspace_first');
    let folder = folders.length === 1 ? folders[0] : await this.vscode.window.showQuickPick(folders.map(f => ({ label: f.name, folder: f })), { placeHolder: 'Choose the workspace for this chat' });
    folder = folder?.folder || folder; if (!folder) throw new ClientError('cancelled');
    return fs.realpath(folder.uri.fsPath);
  }
  async connect(paid = true) {
    this.check(); const generation = this.generation;
    const session = paid ? this.account() : null; const profile = paid ? await session.profile() : null;
    if (this.engine && !this.engine.closed && (!paid || this.enginePaid)) return this.engine;
    this.engine?.dispose(); this.tools?.dispose();
    const root = await this.workspace(); this.check();
    if (generation !== this.generation) throw new ClientError('cancelled');
    const tools = new EditorTools(this.vscode, root, () => generation === this.generation && this.tools === tools && this.engine && !this.engine.closed);
    this.tools = tools; this.root = root;
    const engine = new EngineProcess(this.runtime(), root, async event => {
      this.check(); if (generation !== this.generation || engine !== this.engine) throw new ClientError('cancelled');
      const body = { kind: event.kind, operationRequestId: event.operationRequestId };
      if (event.kind === 'credential') { body.origin = event.origin; body.uid = event.uid; }
      else if (event.kind === 'approval') body.proposal = event.proposal;
      else body.payload = event.payload;
      if (fingerprint(body) !== event.binding) throw new ClientError('invalid_host_request_binding');
      if (event.kind === 'read') return tools.read(event.payload);
      if (event.kind === 'approval') return tools.approve(event.proposal);
      if (event.kind === 'apply') return tools.apply(event.payload);
      if (event.kind === 'credential') {
        if (!session || event.origin !== session.api.origin || event.uid !== profile.uid || session !== this.session) throw new ClientError('account_binding_mismatch');
        const accessToken = await session.token(); this.check();
        if (generation !== this.generation) throw new ClientError('cancelled');
        const expiresIn = Math.floor((session.access.expiresAt - Date.now()) / 1000);
        if (expiresIn < 120 || expiresIn > 900) throw new ClientError('credential_expiry_invalid');
        return { accessToken, expiresIn };
      }
      throw new ClientError('unsupported_host_operation');
    });
    this.engine = engine; this.enginePaid = paid;
    try { await engine.ready; const initialized = await engine.request('initialize', { workspace: root, mode: 'host', ...(paid ? { apiOrigin: session.api.origin, uid: profile.uid } : {}) });
      if (initialized.workspace !== root || initialized.mode !== 'host' || initialized.capabilities?.read !== true || initialized.capabilities?.hostEdits !== true || (paid && initialized.capabilities?.prompt !== true)) throw new ClientError('incompatible_engine_capabilities');
    }
    catch (error) { engine.dispose(); if (this.engine === engine) this.engine = null; throw error; }
    if (generation !== this.generation) { engine.dispose(); throw new ClientError('cancelled'); }
    return engine;
  }
  async attachSelection() {
    if (this.state.busy) throw new ClientError('finish_current_operation_first');
    const root = await this.workspace(); const editor = this.vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty || editor.document.uri.scheme !== 'file') throw new ClientError('select_text_in_a_workspace_file');
    const policy = new WorkspacePolicy(root); const relative = policy.relative(editor.document.uri.fsPath); await policy.resolve(relative);
    const text = validText(editor.document.getText(editor.selection));
    if (Buffer.byteLength(text) > 16000) throw new ClientError('selection_context_limit');
    this.root = root; this.attachment = { uri: editor.document.uri, version: editor.document.version, text, path: relative, line: editor.selection.start.line + 1 };
    this.state.attachment = `${relative}:${this.attachment.line} (${Buffer.byteLength(text)} bytes)`; this.update();
  }
  removeAttachment() { if (this.state.busy) return; this.attachment = null; this.state.attachment = null; this.update(); }
  async send(text, modelId) {
    this.check(); if (this.state.busy) throw new ClientError('finish_current_operation_first');
    if (this.needsNewSession) throw new ClientError('start_new_chat_after_interrupted_response');
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 30000) throw new ClientError('message_text_limit');
    const model = this.state.models.find(m => m.id === modelId);
    if (!this.state.enabled || !model) throw new ClientError('select_an_available_model');
    const generation = this.generation; this.state.busy = true; this.state.error = ''; this.state.receipt = null; this.state.requestId = null; this.update();
    let started = false;
    try {
      let content = text;
      if (this.attachment) {
        const doc = await this.vscode.workspace.openTextDocument(this.attachment.uri);
        if (doc.version !== this.attachment.version) throw new ClientError('selection_changed_attach_again');
        content += `\n\nAttached selection from ${this.attachment.path}:${this.attachment.line}:\n${this.attachment.text}`;
      }
      const messages = [...this.messages, { role: 'user', content }];
      if (content.length > 30000) throw new ClientError('message_with_attachment_limit');
      const params = { messages, model: model.id, maxOutputTokens: Math.min(model.maxOutputTokens, 2048) };
      if (messages.length > 28 || Buffer.byteLength(JSON.stringify(params)) > 58000) throw new ClientError('context_full_start_new_chat');
      const engine = await this.connect(); if (generation !== this.generation) throw new ClientError('cancelled');
      const answer = { role: 'assistant', content: '' }; this.state.messages.push({ role: 'user', content }, answer); this.update(); started = true;
      let complete = false;
      await engine.request('prompt', params, event => {
        if (generation !== this.generation) return;
        if (!event || event.version !== 1 || typeof event.type !== 'string') throw new ClientError('invalid_gateway_event');
        if (['client.request', 'request.started'].includes(event.type)) { if (typeof event.requestId !== 'string' || !/^[a-f0-9]{64}$/.test(event.requestId)) throw new ClientError('invalid_request_receipt'); this.state.requestId = event.requestId; }
        else if (event.type === 'text.delta') { if (typeof event.text !== 'string' || Buffer.byteLength(answer.content + event.text) > 131072) throw new ClientError('response_text_limit'); answer.content += event.text; }
        else if (event.type === 'request.completed') complete = true;
        else if (event.type === 'request.failed') throw new ClientError('inference_failed_check_request_status');
        this.update();
      });
      if (!complete) throw new ClientError('incomplete_response_check_request_status');
      if (generation === this.generation) { this.messages = [...messages, { ...answer }]; this.removeAttachmentAfterSend(); }
    } catch (error) { if (generation === this.generation) { if (started) this.needsNewSession = true; this.error(error); } }
    finally { if (generation === this.generation) { this.state.busy = false; this.update(); } }
  }
  removeAttachmentAfterSend() { this.attachment = null; this.state.attachment = null; }
  async requestStatus() {
    if (this.state.busy || !this.state.requestId) throw new ClientError('no_idle_request_to_check');
    const generation = this.generation; this.state.busy = true; this.update();
    try {
      const engine = await this.connect(); const row = await engine.request('request.status', { requestId: this.state.requestId });
      if (generation === this.generation) this.state.receipt = typeof row.request?.state === 'string' ? row.request.state.slice(0, 50) : 'Status checked; see account usage.';
    } finally { if (generation === this.generation) { this.state.busy = false; this.update(); } }
  }
  async explainSelection() {
    await this.attachSelection(); await this.refresh();
    const model = await this.vscode.window.showQuickPick(this.state.models.map(m => ({ label: m.name, model: m })), { placeHolder: 'Choose a model to explain your selection (uses credits)' });
    if (model) await this.send('Explain this attached selection.', model.model.id);
  }
  async reviewEdit() {
    this.check(); if (this.state.busy) throw new ClientError('finish_current_operation_first');
    const editor = this.vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') throw new ClientError('open_target_workspace_file');
    const selection = await this.vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Review replacement text from this file' });
    if (!selection?.length) return;
    const stat = await fs.stat(selection[0].fsPath); if (!stat.isFile() || stat.size > 32768) throw new ClientError('proposal_text_limit');
    const text = validText(new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(selection[0].fsPath)));
    const generation = this.generation; this.state.busy = true; this.update();
    try {
      const engine = await this.connect(false); const relative = this.tools.policy.relative(editor.document.uri.fsPath);
      const current = await this.tools.read({ path: relative, allowMissing: false });
      await engine.request('tool', { name: 'edit', arguments: { path: relative, text, baseHash: hash(current.text) } });
    } finally { if (generation === this.generation) { this.state.busy = false; this.update(); } }
  }
  dispose() { this.loginAbort?.abort(); this.stop(); this.disposables.forEach(d => d.dispose()); this.publish = () => {}; }
}
module.exports = { Controller, userSetting, safeError, catalog };
