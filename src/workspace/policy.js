const fs = require('fs/promises');
const path = require('path');
const ignore = require('ignore');
const crypto = require('crypto');
const { ClientError } = require('../auth/api');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const MAX_TEXT = 32768;
function blocked(name) {
  name = name.toLowerCase();
  return ['.git', '.ssh', '.aws', '.azure', '.gnupg', '.venv', 'node_modules', '__pycache__', '.npmrc', '.pypirc', '.netrc'].includes(name) || /^(\.env|id_rsa|id_ed25519|credentials|secrets)/.test(name) || /\.(pem|key|p12|pfx|keystore)$/.test(name);
}
function validText(text) { if (typeof text !== 'string' || text.includes('\0') || Buffer.byteLength(text) > MAX_TEXT) throw new ClientError('context_text_limit'); return text; }
class WorkspacePolicy {
  constructor(root) { this.root = path.resolve(root); }
  async resolve(name, missing = false) {
    if (typeof name !== 'string' || name.length > 1024 || /[\\:\x00-\x1f]/.test(name) || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..' || blocked(p))) throw new ClientError('excluded_workspace_path');
    const target = path.join(this.root, ...name.split('/'));
    const root = await fs.realpath(this.root);
    if (root !== this.root) throw new ClientError('workspace_link_refused');
    let current = this.root;
    for (const part of name.split('/')) {
      current = path.join(current, part);
      let stat;
      try { stat = await fs.lstat(current); } catch (error) { if (error.code !== 'ENOENT' || !missing || current !== target) throw new ClientError('file_not_found'); }
      if (stat && (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)))) throw new ClientError('workspace_link_or_special_file');
      const directory = stat?.isDirectory();
      let owner = path.dirname(current);
      while (true) {
        for (const file of ['.gitignore', '.swaignore']) {
          const rules = path.join(owner, file);
          let data;
          try {
            const ruleStat = await fs.lstat(rules);
            if (!ruleStat.isFile() || ruleStat.nlink !== 1 || ruleStat.size > MAX_TEXT) throw new ClientError('unsafe_ignore_file');
            data = await fs.readFile(rules, 'utf8');
          } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
          const relative = path.relative(owner, current).split(path.sep).join('/') + (directory ? '/' : '');
          if (ignore().add(data).ignores(relative)) throw new ClientError('ignored_workspace_path');
        }
        if (owner === this.root) break;
        owner = path.dirname(owner);
      }
    }
    return target;
  }
  relative(file) {
    const relative = path.relative(this.root, file).split(path.sep).join('/');
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw new ClientError('outside_workspace');
    return relative;
  }
}
module.exports = { WorkspacePolicy, validText, hash, blocked };
