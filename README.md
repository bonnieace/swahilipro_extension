# SwahiliPro for Visual Studio Code

The SwahiliPro extension is the primary desktop distribution for the SwahiliPro programming language.

A packaged Marketplace build includes the matching standalone `swa` runtime, so users can install the extension and immediately run `.swa` files without installing Python or pip.

The extension respects your existing VS Code appearance. It keeps your current color theme and file icon theme instead of asking you to switch themes. SwahiliPro's existing language representation icon is used for `.swa` language registration where the active icon theme allows language icons.

## Install

1. Open Visual Studio Code.
2. Open Extensions with `Ctrl+Shift+X`.
3. Search for **SwahiliPro**.
4. Click **Install**.
5. Create or open a `.swa` file and press the Run button in the editor title bar.

The extension automatically adds its bundled runtime to the `PATH` used by **new VS Code integrated terminals**, so after installation you can open a new terminal and run:

```bash
swa --version
```

To make `swa` available from terminals outside VS Code as well, accept the one-time **Enable CLI** prompt or run **SwahiliPro: Enable swa CLI in PATH** from the Command Palette. The runtime is copied to a stable per-user directory at `~/.swahilipro/bin` (or the equivalent user directory on Windows) and that directory is added to the user's PATH. Open a new terminal after enabling it.

## What the extension provides

- SwahiliPro v2 syntax highlighting.
- `.swa` language registration.
- Correct `#` comment behavior.
- Brace/parenthesis/list auto-closing and indentation.
- **SwahiliPro: Run File** command.
- **SwahiliPro: Open REPL** command.
- **SwahiliPro: New File** command.
- **SwahiliPro: Enable swa CLI in PATH** command.
- Automatic `swa` availability in new VS Code integrated terminals.
- A bundled standalone `swa` runtime in packaged builds.

## Example

```swahili
jumlisha(a, b) => a + b

acha jina = "Amina"
acha umri = 18

ikiwa (umri >= 18) {
    andika("Habari " + jina)
}

andika(jumlisha(5, 10))
```

## Running code

Open a `.swa` file and either:

- click the **Run** button in the editor title bar, or
- open the Command Palette and choose **SwahiliPro: Run File**.

The extension launches the bundled runtime as:

```bash
swa your-file.swa
```

For an interactive shell, use **SwahiliPro: Open REPL**, equivalent to:

```bash
swa
```

## Development runtime override

Source checkouts do not commit generated native binaries. To test the extension against a locally built runtime, set:

```text
swahilipro.runtimePath
```

to the absolute path of a standalone `swa` or `swa.exe` binary.

## Packaging with a runtime

After building a standalone runtime from `bonnieace/swahilipro-compiler`, package a platform-specific VSIX with:

```bash
npm install
node scripts/package-with-runtime.js /path/to/swa win32-x64
```

Example targets include `win32-x64`, `linux-x64`, `darwin-x64`, and `darwin-arm64`. The packaging script injects the binary as `runtime/swa` or `runtime/swa.exe`, creates the VSIX, then removes the temporary generated binary from the source tree.

## Runtime philosophy

The extension does not maintain a second implementation of SwahiliPro. It invokes the same standalone `swa` binary distributed as the CLI. This keeps the compiler, CLI and editor behavior on the same language version.

## Support

Issues and suggestions can be reported in this repository.
