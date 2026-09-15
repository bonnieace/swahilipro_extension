const vscode = require("vscode");
const path = require("path");
const { spawn } = require("child_process");

function parseCompilerError(stderr, document) {
  const lines = stderr.replace(/\r\n/g, "\n").split("\n");
  const locationIndex = lines.findIndex((line) => /^Faili .+, mstari \d+$/.test(line.trim()));
  if (locationIndex < 0) return null;

  const match = lines[locationIndex].trim().match(/mstari (\d+)$/);
  if (!match) return null;

  const requestedLine = Math.max(Number(match[1]) - 1, 0);
  const line = Math.min(requestedLine, Math.max(document.lineCount - 1, 0));
  const documentLine = document.lineAt(line).text;
  const compilerSourceLine = lines[locationIndex + 2] || "";
  const pointerLine = lines[locationIndex + 3] || "";
  const pointerStart = pointerLine.indexOf("^");

  // The compiler normally echoes the same source line that VS Code is showing.
  // If it does not (for example after legacy-syntax translation), never use a
  // column from transformed source to underline an unrelated character.
  const sourceMatchesDocument = !compilerSourceLine || compilerSourceLine === documentLine;
  const requestedStart = sourceMatchesDocument && pointerStart >= 0
    ? pointerStart
    : Math.max(documentLine.search(/\S/), 0);

  const pointerWidth = sourceMatchesDocument && pointerStart >= 0
    ? Math.max((pointerLine.slice(pointerStart).match(/^\^+/) || [""])[0].length, 1)
    : Math.max(documentLine.trim().length, 1);

  const lineLength = documentLine.length;
  const safeStart = Math.min(Math.max(requestedStart, 0), lineLength);
  const safeEnd = lineLength === 0
    ? safeStart
    : Math.min(Math.max(safeStart + pointerWidth, safeStart + 1), lineLength);

  const firstLine = lines.find((entry) => entry.trim().length > 0) || "SwahiliPro syntax error";
  const message = firstLine.replace(/^.*?:\s*/, "") || firstLine;
  const range = new vscode.Range(line, safeStart, line, safeEnd);
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
  diagnostic.source = "SwahiliPro";
  diagnostic.code = "syntax";

  if (compilerSourceLine && compilerSourceLine !== documentLine) {
    diagnostic.relatedInformation = [
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(document.uri, range),
        `Compiler checked translated source: ${compilerSourceLine}`,
      ),
    ];
  }

  return diagnostic;
}

function registerDiagnostics(context, getRuntimePath) {
  const collection = vscode.languages.createDiagnosticCollection("swahilipro");
  const timers = new Map();
  const generations = new Map();
  context.subscriptions.push(collection);

  function clearTimer(uri) {
    const key = uri.toString();
    const timer = timers.get(key);
    if (timer) clearTimeout(timer);
    timers.delete(key);
  }

  function checkDocument(document, generation, documentVersion) {
    if (document.languageId !== "swa") return;

    const key = document.uri.toString();
    if (generations.get(key) !== generation || document.version !== documentVersion) return;

    let executable;
    try {
      executable = getRuntimePath();
    } catch (_) {
      collection.delete(document.uri);
      return;
    }

    const cwd = document.isUntitled
      ? (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd())
      : path.dirname(document.fileName);

    const child = spawn(executable, ["check", "-"], {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", () => {
      if (generations.get(key) === generation && document.version === documentVersion) {
        collection.delete(document.uri);
      }
    });

    child.on("close", (code) => {
      // An edit invalidates an in-flight compiler result immediately, even
      // while the debounce timer for the next check has not fired yet.
      if (generations.get(key) !== generation || document.version !== documentVersion) return;

      if (code === 0) {
        collection.delete(document.uri);
        return;
      }

      const diagnostic = parseCompilerError(stderr, document);
      if (diagnostic) collection.set(document.uri, [diagnostic]);
      else collection.delete(document.uri);
    });

    child.stdin.end(document.getText(), "utf8");
  }

  function schedule(document, delay = 250) {
    if (document.languageId !== "swa") return;

    clearTimer(document.uri);
    const key = document.uri.toString();
    const generation = (generations.get(key) || 0) + 1;
    const documentVersion = document.version;
    generations.set(key, generation);

    // Do not leave an error from the previous document version visible while
    // the user is typing and the next compiler check is waiting to run.
    collection.delete(document.uri);

    timers.set(key, setTimeout(() => {
      timers.delete(key);
      checkDocument(document, generation, documentVersion);
    }, delay));
  }

  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId === "swa") schedule(document, 0);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => schedule(document, 0)),
    vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)),
    vscode.workspace.onDidSaveTextDocument((document) => schedule(document, 0)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      clearTimer(document.uri);
      generations.delete(document.uri.toString());
      collection.delete(document.uri);
    }),
  );
}

module.exports = { parseCompilerError, registerDiagnostics };
