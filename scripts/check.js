const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
function scan(dir) {
  for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', '.vscode-test'].includes(file.name)) continue;
    const name = path.join(dir, file.name);
    if (file.isDirectory()) scan(name);
    else if (name.endsWith('.js')) execFileSync(process.execPath, ['--check', name]);
  }
}
scan('.');
for (const name of ['package.json', 'language-configuration.json', 'syntaxes/swa.tmLanguage.json']) JSON.parse(fs.readFileSync(name, 'utf8'));
