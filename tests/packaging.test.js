const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
test('failed runtime packaging restores every pre-existing runtime file', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async () => {
  const runtime = path.resolve(__dirname, '../runtime'); const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'swa-package-test-'));
  const names = ['swa', 'swahilipro', 'swa.exe', 'swahilipro.exe', 'provenance.json']; const originals = new Map();
  await fs.mkdir(runtime, { recursive: true });
  try {
    for (const name of names) {
      const file = path.join(runtime, name); try { originals.set(name, { text: await fs.readFile(file), mode: (await fs.stat(file)).mode }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.writeFile(file, 'developer runtime ' + name);
    }
    const source = path.join(temp, 'old-runtime'); await fs.writeFile(source, '#!/bin/sh\necho old-runtime\n', { mode: 0o755 });
    const result = spawnSync(process.execPath, ['scripts/package-with-runtime.js', source, 'linux-x64'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
    assert.equal(result.status, 1);
    for (const name of names) assert.equal(await fs.readFile(path.join(runtime, name), 'utf8'), 'developer runtime ' + name);
  } finally {
    for (const name of names) { const file = path.join(runtime, name); const saved = originals.get(name); if (saved) { await fs.writeFile(file, saved.text); await fs.chmod(file, saved.mode); } else await fs.rm(file, { force: true }); }
    await fs.rm(temp, { recursive: true, force: true });
  }
});
