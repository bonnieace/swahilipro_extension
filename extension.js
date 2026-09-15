const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const CLI_ENABLED_KEY = "swahilipro.cliEnabled";
const CLI_PROMPTED_KEY = "swahilipro.cliPrompted.v1";

function runtimeFilenames() {
  const suffix = process.platform === "win32" ? ".exe" : "";
  return [`swa${suffix}`, `swahilipro${suffix}`];
}

function runtimeFilename() {
  return runtimeFilenames()[0];
}

function bundledRuntimePath(context) {
  return context.asAbsolutePath(path.join("runtime", runtimeFilename()));
}

function runtimePath(context) {
  const configured = vscode.workspace
    .getConfiguration("swahilipro")
    .get("runtimePath", "")
    .trim();

  if (configured) {
    return path.resolve(configured);
  }

  return bundledRuntimePath(context);
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

function cliInstallDirectory() {
  return path.join(os.homedir(), ".swahilipro", "bin");
}

function cliInstallPaths() {
  const directory = cliInstallDirectory();
  return runtimeFilenames().map((name) => path.join(directory, name));
}

function prependTerminalPath(context, directory, description) {
  context.environmentVariableCollection.description = description;
  context.environmentVariableCollection.prepend(
    "PATH",
    `${directory}${path.delimiter}`,
  );
}

function exposeRuntimeToIntegratedTerminals(context) {
  const executable = runtimePath(context);
  if (!fs.existsSync(executable)) return;

  prependTerminalPath(
    context,
    path.dirname(executable),
    "Makes the SwahiliPro swa and swahilipro commands available in new VS Code integrated terminals.",
  );
}

function powershellQuote(value) {
  return value.replace(/'/g, "''");
}

function addDirectoryToWindowsUserPath(directory) {
  const escapedDirectory = powershellQuote(directory);
  const script = [
    `$dir = '${escapedDirectory}'`,
    "$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "$parts = if ([string]::IsNullOrWhiteSpace($userPath)) { @() } else { $userPath -split ';' }",
    "$present = $parts | Where-Object { $_.TrimEnd('\\') -ieq $dir.TrimEnd('\\') }",
    "if (-not $present) {",
    "  $newPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $dir } else { $userPath.TrimEnd(';') + ';' + $dir }",
    "  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')",
    "}",
  ].join("; ");

  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { windowsHide: true, stdio: "pipe" },
  );
}

function shellProfilePath() {
  const shell = path.basename(process.env.SHELL || "");

  if (shell === "zsh") return path.join(os.homedir(), ".zshrc");
  if (shell === "bash") return path.join(os.homedir(), ".bashrc");
  if (shell === "fish") {
    return path.join(os.homedir(), ".config", "fish", "config.fish");
  }

  return path.join(os.homedir(), ".profile");
}

function addDirectoryToPosixUserPath(directory) {
  const profile = shellProfilePath();
  fs.mkdirSync(path.dirname(profile), { recursive: true });

  const shell = path.basename(process.env.SHELL || "");
  const marker = "# SwahiliPro CLI";
  const pathLine =
    shell === "fish"
      ? `set -gx PATH ${directory} $PATH`
      : `export PATH="${directory}:$PATH"`;

  const existing = fs.existsSync(profile) ? fs.readFileSync(profile, "utf8") : "";
  if (existing.includes(marker) || existing.includes(directory)) return;

  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(profile, `${prefix}\n${marker}\n${pathLine}\n`, "utf8");
}

function addDirectoryToUserPath(directory) {
  if (process.platform === "win32") {
    addDirectoryToWindowsUserPath(directory);
    return;
  }

  addDirectoryToPosixUserPath(directory);
}

function copyRuntimeToCliLocation(context) {
  const source = ensureRuntime(context);
  const directory = cliInstallDirectory();
  const destinations = cliInstallPaths();

  fs.mkdirSync(directory, { recursive: true });

  for (const destination of destinations) {
    fs.copyFileSync(source, destination);
    if (process.platform !== "win32") {
      fs.chmodSync(destination, 0o755);
    }
  }

  return { directory, destinations };
}

async function enableGlobalCli(context, showConfirmation = true) {
  try {
    const { directory } = copyRuntimeToCliLocation(context);
    addDirectoryToUserPath(directory);
    prependTerminalPath(
      context,
      directory,
      "Makes the SwahiliPro swa and swahilipro commands available in new terminals.",
    );
    await context.globalState.update(CLI_ENABLED_KEY, true);

    if (showConfirmation) {
      vscode.window.showInformationMessage(
        "SwahiliPro CLI enabled. Open a new terminal and run `swa -v` or `swahilipro -v`.",
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Could not enable the SwahiliPro CLI: ${error.message}`,
    );
  }
}

async function refreshEnabledCli(context) {
  if (!context.globalState.get(CLI_ENABLED_KEY, false)) return;

  try {
    const { directory } = copyRuntimeToCliLocation(context);
    prependTerminalPath(
      context,
      directory,
      "Makes the SwahiliPro swa and swahilipro commands available in new terminals.",
    );
  } catch (_) {
    // A development checkout may not contain a packaged runtime yet.
  }
}

async function maybeOfferCliSetup(context) {
  if (context.globalState.get(CLI_ENABLED_KEY, false)) return;
  if (context.globalState.get(CLI_PROMPTED_KEY, false)) return;
  if (!fs.existsSync(runtimePath(context))) return;

  await context.globalState.update(CLI_PROMPTED_KEY, true);
  const choice = await vscode.window.showInformationMessage(
    "Make the `swa` and `swahilipro` commands available from your terminal?",
    "Enable CLI",
    "Not now",
  );

  if (choice === "Enable CLI") {
    await enableGlobalCli(context);
  }
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

function quoteTerminalArgument(value) {
  return `"${value.replace(/(["$`\\])/g, "\\$1")}"`;
}

async function runFile(context) {
  const document = await activeSwahiliDocument();
  if (!document) return;

  try {
    ensureRuntime(context);
  } catch (error) {
    vscode.window.showErrorMessage(error.message);
    return;
  }

  // Use the user's normal integrated shell instead of making swa itself the shell.
  // A short-lived swa process then returns control to the terminal instead of closing it.
  const terminal = vscode.window.createTerminal({
    name: `SwahiliPro: ${path.basename(document.fileName)}`,
    cwd: path.dirname(document.fileName),
  });
  terminal.show(true);
  terminal.sendText(`swa ${quoteTerminalArgument(document.fileName)}`, true);
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

async function activate(context) {
  exposeRuntimeToIntegratedTerminals(context);
  await refreshEnabledCli(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("swahilipro.runFile", () => runFile(context)),
    vscode.commands.registerCommand("swahilipro.openRepl", () => openRepl(context)),
    vscode.commands.registerCommand("swahilipro.newFile", newFile),
    vscode.commands.registerCommand("swahilipro.enableCli", () =>
      enableGlobalCli(context),
    ),
  );

  await maybeOfferCliSetup(context);
}

function deactivate() {}

module.exports = { activate, deactivate };
