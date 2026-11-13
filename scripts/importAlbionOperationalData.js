const fs = require('node:fs');
const path = require('node:path');
const { migrate } = require('../src/database/migrate');
const operationalData = require('../src/modules/albion/operationalData.service');

function main(argv = process.argv) {
  const kind = argv[2];
  const filePath = argv[3];
  const apply = argv.includes('--apply');
  const sourceName = argv.slice(4).find((value) => value !== '--apply') || (filePath ? path.basename(filePath) : null);
  if (!kind || !filePath) {
    console.error('Uso: node scripts/importAlbionOperationalData.js <food|guild_history|bank> <arquivo> [origem] [--apply]');
    process.exitCode = 1;
    return;
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`Arquivo não encontrado: ${resolved}`);
    process.exitCode = 1;
    return;
  }
  migrate();
  const preview = operationalData.previewOperationalData(fs.readFileSync(resolved, 'utf8'), { kind, sourceName, actorId: 'script' });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', kind, sourceName, previousImport: preview.previousImport, summary: preview.summary, errors: preview.errors.slice(0, 30) }, null, 2));
  if (!apply) return;
  const result = operationalData.applyOperationalPreview(preview);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main();
module.exports = { main };
