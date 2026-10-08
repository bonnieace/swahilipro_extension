#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
function main() {
  const [, , sourceArg, target, compilerRef = 'unspecified'] = process.argv;
  const targets = ['linux-x64', 'win32-x64', 'darwin-x64', 'darwin-arm64'];
  if (!sourceArg || !targets.includes(target)) throw new Error('Usage: node scripts/package-with-runtime.js <binary> <target> [compiler-ref]');
  const root = path.resolve(__dirname, '..'); const source = path.resolve(sourceArg);
  if (!fs.statSync(source).isFile()) throw new Error('Runtime must be a regular file');
  const runtimeDir = path.join(root, 'runtime'); const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'swa-package-'));
  const names = ['swa', 'swahilipro', 'swa.exe', 'swahilipro.exe', 'provenance.json'];
  const saved = [];
  fs.mkdirSync(runtimeDir, { recursive: true }); fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  // Stage outside runtime first, so even a runtime-directory source survives.
  const staged = path.join(backup, 'source'); fs.copyFileSync(source, staged);
  try {
    for (const name of names) { const file = path.join(runtimeDir, name); if (fs.existsSync(file)) { fs.renameSync(file, path.join(backup, name)); saved.push(name); } }
    const runtimeNames = target.startsWith('win32') ? ['swa.exe', 'swahilipro.exe'] : ['swa', 'swahilipro'];
    for (const name of runtimeNames) { const file = path.join(runtimeDir, name); fs.copyFileSync(staged, file); if (!target.startsWith('win32')) fs.chmodSync(file, 0o755); }
    const samePlatform = target === `${process.platform}-${process.arch}`;
    if (samePlatform) {
      const smoke = spawnSync(path.join(runtimeDir, runtimeNames[0]), ['agent', '--stdio'], { input: '', timeout: 10000, encoding: 'utf8', maxBuffer: 262144, windowsHide: true });
      let hello; try { hello = JSON.parse(smoke.stdout.split('\n')[0]); } catch (_) { throw new Error('Runtime does not support the required agent protocol'); }
      if (smoke.status !== 0 || hello.v !== 1 || hello.protocol !== 1 || hello.type !== 'hello') throw new Error('Runtime does not support the required agent protocol');
    }
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(staged)).digest('hex');
    fs.writeFileSync(path.join(runtimeDir, 'provenance.json'), JSON.stringify({ compilerRef, sha256, target, protocol: 1, packagingHandshakeVerified: samePlatform }, null, 2) + '\n');
    const vscePackage = require.resolve('@vscode/vsce/package.json'); const bin = require(vscePackage).bin.vsce;
    const output = path.join(root, 'dist', `swahilipro-${target}.vsix`);
    const result = spawnSync(process.execPath, [path.resolve(path.dirname(vscePackage), bin), 'package', '--target', target, '--out', output], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) throw new Error('VSIX packaging failed');
    console.log(`Created ${output}`);
  } finally {
    for (const name of names) { const file = path.join(runtimeDir, name); if (fs.existsSync(file)) fs.rmSync(file); }
    for (const name of saved) fs.renameSync(path.join(backup, name), path.join(runtimeDir, name));
    fs.rmSync(backup, { recursive: true, force: true });
  }
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
