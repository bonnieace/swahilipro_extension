const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

function runtimeFilename() {
  return process.platform === "win32" ? "swa.exe" : "swa";
}

function runtimePath(context) {
  const configured = vscode.workspace
    .getConfiguration("swahilipro")
    .get("runtimePath", "")
    .trim();

  if (configured) {
    return path.resolve(configured);
  }

  return context.asAbsolutePath(path.join("runtime", runtimeFilename()));
}

function ensureRuntime(context) {
  const executable = runtimePath(context);
  if (!fs.existsSync(executable)) {
    throw new Error(
      "SwahiliPro runtime haijapatikana. Install the packaged SwahiliPro extension or set swahilipro.runtimePath to a standalone swa binary.",
    );
  }

  if (process.platform !== "win32") {
    try {
      fs.chmodSync(executable, 0o755);
    } catch (_) {
      // Spawn will surface a useful error if the filesystem forbids execution.
    }
  }

  return executable;
}

async function activeSwahiliDocument() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("Open a .swa file first.");
    return null;
  }

  const document = editor.document;
  if (document.languageId !== "swa" && path.extname(document.fileName) !== ".swa") {
    vscode.window.showErrorMessage("The active file is not a SwahiliPro (.swa) file.");
    return null;
  }

  if (document.isUntitled) {
    const saved = await document.save();
    if (!saved || document.isUntitled) {
      vscode.window.showErrorMessage("Save the .swa file before running it.");
      return null;
    }
  } else if (document.isDirty) {
    await document.save();
  }

  return document;
}

async function runFile(context) {
  const document = await activeSwahiliDocument();
  if (!document) return;

  let executable;
  try {
    executable = ensureRuntime(context);
  } catch (error) {
    vscode.window.showErrorMessage(error.message);
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: `SwahiliPro: ${path.basename(document.fileName)}`,
    shellPath: executable,
    shellArgs: [document.fileName],
    cwd: path.dirname(document.fileName),
  });
  terminal.show(true);
}

function openRepl(context) {
  let executable;
  try {
    executable = ensureRuntime(context);
  } catch (error) {
    vscode.window.showErrorMessage(error.message);
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: "SwahiliPro REPL",
    shellPath: executable,
  });
  terminal.show();
}

async function newFile() {
  const document = await vscode.workspace.openTextDocument({
    language: "swa",
    content: '# SwahiliPro\n\nandika("Habari Dunia")\n',
  });
  await vscode.window.showTextDocument(document);
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("swahilipro.runFile", () => runFile(context)),
    vscode.commands.registerCommand("swahilipro.openRepl", () => openRepl(context)),
    vscode.commands.registerCommand("swahilipro.newFile", newFile),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
