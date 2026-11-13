const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const roots = ['src', 'scripts', 'test', 'docs'];
const files = roots.flatMap((root) => listJavaScript(path.resolve(root)));
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push({ file, error: result.stderr || result.stdout });
}

if (failures.length) {
  for (const failure of failures) console.error(`${failure.file}\n${failure.error}`);
  process.exit(1);
}

console.log(`${files.length} arquivos JavaScript passaram na verificacao de sintaxe.`);

function listJavaScript(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScript(fullPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}
