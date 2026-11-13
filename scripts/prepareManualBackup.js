const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { backupDatabase } = require('../src/database/backup');

const sourcePath = backupDatabase('manual_download');
if (!sourcePath) throw new Error('Banco nao encontrado. Confira DATABASE_PATH.');

const outputDir = path.resolve(path.dirname(sourcePath), '..', 'manual-download');
fs.mkdirSync(outputDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = path.join(outputDir, `notag-manual-${timestamp}.sqlite`);
fs.copyFileSync(sourcePath, outputPath);

const hash = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex');
fs.writeFileSync(`${outputPath}.sha256`, `${hash}  ${path.basename(outputPath)}\n`, 'utf8');

console.log(`Backup pronto para download: ${outputPath}`);
console.log(`SHA-256: ${hash}`);
