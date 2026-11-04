# Swahili Programming Language - SwahiliPro

Language support for **SwahiliPro**, a programming language with Swahili keywords designed to help people learn and build software in their own language.

## Features

- Syntax highlighting for SwahiliPro v2 `.swa` files
- `#` line comments, bracket matching, auto-closing pairs and indentation
- Hover documentation and examples for keywords such as `acha`, `ikiwa`, `kwa`, `wakati` and `rudisha`
- **SwahiliPro: New File** from the Command Palette

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

## Running SwahiliPro programs

This extension provides editor support only. To run `.swa` files, install the SwahiliPro runtime separately (see [swahilipro.com](https://swahilipro.com)), then run from any terminal:

```bash
swa your-file.swa
```

## Privacy and security

This extension contains only declarative language files and a small hover provider. It does not bundle executables, start processes, make network requests, collect telemetry, or change your PATH or shell configuration. It works in untrusted and virtual workspaces.
