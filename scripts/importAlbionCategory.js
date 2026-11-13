const fs = require('node:fs');
const path = require('node:path');
const { migrate } = require('../src/database/migrate');
const { backupDatabase } = require('../src/database/backup');
const fame = require('../src/modules/albion/fame.service');

function main(argv = process.argv) {
  const category = argv[2];
  const filePath = argv[3];
  const apply = argv.includes('--apply');
  const sourceName = argv.slice(4).find((value) => value !== '--apply') || (filePath ? path.basename(filePath) : null);
  if (!category || !filePath) {
    console.error('Uso: node scripts/importAlbionCategory.js <pve|pvp|gathering|crafting> <arquivo> [origem] [--apply]');
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
  const preview = fame.previewCategoryFame(fs.readFileSync(resolved, 'utf8'), { category, sourceName, actorId: 'script' });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', category, sourceName, summary: preview.summary, errors: preview.errors.slice(0, 30) }, null, 2));
  if (!apply) return;
  backupDatabase(`before_albion_${category}_import`);
  console.log(JSON.stringify(fame.applyCategoryPreview(preview, { confirmReductions: true }), null, 2));
}

if (require.main === module) main();
module.exports = { main };
