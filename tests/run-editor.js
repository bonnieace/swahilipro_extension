const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { runTests } = require('@vscode/test-electron');
async function main() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'swa-vscode-'));
  try {
    await fs.writeFile(path.join(workspace, 'example.txt'), 'disk text');
    await runTests({ version: '1.88.1', extensionDevelopmentPath: path.resolve(__dirname, '..'), extensionTestsPath: path.join(__dirname, 'editor', 'index.js'), launchArgs: [workspace, '--disable-workspace-trust', '--disable-gpu', '--no-sandbox', '--skip-welcome', '--skip-release-notes', '--disable-extensions'] });
  } finally { await fs.rm(workspace, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
