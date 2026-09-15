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
const windowsTarget = target.startsWith("win32-");
const runtimeNames = windowsTarget
  ? ["swa.exe", "swahilipro.exe"]
  : ["swa", "swahilipro"];
const runtimeDestinations = runtimeNames.map((name) => path.join(runtimeDir, name));

if (!fs.existsSync(runtimeSource)) {
  console.error(`Runtime not found: ${runtimeSource}`);
  process.exit(2);
}

fs.mkdirSync(runtimeDir, { recursive: true });
fs.mkdirSync(distDir, { recursive: true });

for (const name of ["swa", "swa.exe", "swahilipro", "swahilipro.exe"]) {
  const candidate = path.join(runtimeDir, name);
  if (fs.existsSync(candidate)) fs.rmSync(candidate);
}

try {
  for (const destination of runtimeDestinations) {
    fs.copyFileSync(runtimeSource, destination);
    if (!windowsTarget) {
      fs.chmodSync(destination, 0o755);
    }
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
  for (const destination of runtimeDestinations) {
    if (fs.existsSync(destination)) {
      fs.rmSync(destination);
    }
  }
}
