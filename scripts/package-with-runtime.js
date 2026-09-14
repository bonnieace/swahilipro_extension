#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const [, , runtimeSourceArg, target] = process.argv;

if (!runtimeSourceArg || !target) {
  console.error(
    "Usage: node scripts/package-with-runtime.js <path-to-swa-binary> <vsce-target>",
  );
  process.exit(2);
}

const root = path.resolve(__dirname, "..");
const runtimeSource = path.resolve(runtimeSourceArg);
const runtimeDir = path.join(root, "runtime");
const distDir = path.join(root, "dist");
const runtimeName = target.startsWith("win32-") ? "swa.exe" : "swa";
const runtimeDestination = path.join(runtimeDir, runtimeName);

if (!fs.existsSync(runtimeSource)) {
  console.error(`Runtime not found: ${runtimeSource}`);
  process.exit(2);
}

fs.mkdirSync(runtimeDir, { recursive: true });
fs.mkdirSync(distDir, { recursive: true });

for (const name of ["swa", "swa.exe"]) {
  const candidate = path.join(runtimeDir, name);
  if (fs.existsSync(candidate)) fs.rmSync(candidate);
}

try {
  fs.copyFileSync(runtimeSource, runtimeDestination);
  if (!target.startsWith("win32-")) {
    fs.chmodSync(runtimeDestination, 0o755);
  }

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const output = path.join(distDir, `swahilipro-${target}.vsix`);
  const result = spawnSync(
    npx,
    ["vsce", "package", "--target", target, "--out", output],
    { cwd: root, stdio: "inherit" },
  );

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  console.log(`Created ${output}`);
} finally {
  if (fs.existsSync(runtimeDestination)) {
    fs.rmSync(runtimeDestination);
  }
}
