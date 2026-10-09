const crypto = require('crypto');
const path = require('path');
class ChatView {
  constructor(vscode, context, controller) { this.vscode = vscode; this.context = context; this.controller = controller; }
  resolveWebviewView(view) {
    const webview = view.webview; const media = this.vscode.Uri.file(path.join(this.context.extensionPath, 'media'));
    webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = crypto.randomBytes(24).toString('base64');
    const css = webview.asWebviewUri(this.vscode.Uri.joinPath(media, 'chat.css'));
    const js = webview.asWebviewUri(this.vscode.Uri.joinPath(media, 'chat.js'));
    webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none';"><link rel="stylesheet" href="${css}"><title>SwahiliPro Chat</title></head><body>
<header><strong>SwahiliPro</strong><button id="newSession">New chat</button></header>
<section aria-label="Account"><p id="account">Sign in to use AI chat</p><p id="credits"></p><div class="actions"><button id="signIn">Sign in</button><button id="signOut" hidden>Sign out</button><button id="refresh">Refresh</button><button id="settings">Settings</button></div></section>
<p id="error" role="alert"></p><p id="notice"></p><main id="messages" aria-live="polite" aria-label="Conversation"></main>
<section id="receipt" hidden><p id="requestId"></p><button id="requestStatus">Check request status</button><p id="status"></p></section>
<footer><label for="model">Model</label><select id="model"></select><p id="attachment"></p><div class="actions"><button id="attachSelection">Attach selection</button><button id="removeAttachment" hidden>Remove</button></div><form id="composer"><label for="prompt">Message</label><textarea id="prompt" rows="4" maxlength="30000" placeholder="Ask about your code…"></textarea><div class="actions"><button id="send" type="submit">Send</button><button id="stop" type="button" hidden>Stop</button></div></form><small>Only your messages and attached selections are sent. Chat uses account credits.</small></footer>
<script nonce="${nonce}" src="${js}"></script></body></html>`;
    const publish = state => { webview.postMessage({ type: 'state', state }); };
    this.controller.publish = publish;
    const listener = webview.onDidReceiveMessage(message => {
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
      const allowed = ['ready', 'signIn', 'signOut', 'refresh', 'newSession', 'attachSelection', 'removeAttachment', 'send', 'stop', 'requestStatus', 'settings'];
      if (!allowed.includes(message.type) || Object.keys(message).some(k => !['type', ...(message.type === 'send' ? ['text', 'model'] : [])].includes(k))) return;
      if (message.type === 'send' && (typeof message.text !== 'string' || message.text.length > 30000 || typeof message.model !== 'string' || message.model.length > 250)) return;
      Promise.resolve().then(() => {
        if (message.type === 'ready') { this.controller.update(); return this.controller.refresh(); }
        if (message.type === 'send') return this.controller.send(message.text, message.model);
        if (message.type === 'settings') return this.vscode.commands.executeCommand('workbench.action.openSettings', 'swahilipro');
        return this.controller[message.type]();
      }).catch(error => this.controller.error(error));
    });
    view.onDidDispose(() => { listener.dispose(); if (this.controller.publish === publish) { this.controller.publish = () => {}; this.controller.stop(); } });
    this.controller.update();
  }
}
module.exports = { ChatView };
