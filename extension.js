const vscode = require("vscode");
const { registerHoverProvider } = require("./hover");

async function newFile() {
  const document = await vscode.workspace.openTextDocument({
    language: "swa",
    content: '# SwahiliPro\n\nandika("Habari Dunia")\n',
  });
  await vscode.window.showTextDocument(document);
}

function activate(context) {
  registerHoverProvider(context);
  context.subscriptions.push(
    vscode.commands.registerCommand("swahilipro.newFile", newFile),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
