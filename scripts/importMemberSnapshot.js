const fs = require('fs');
const path = require('path');
const { migrate } = require('../src/database/migrate');
const { backupDatabase } = require('../src/database/backup');
const snapshots = require('../src/modules/members/memberSnapshot.service');

function usage() {
  return [
    'Uso: node scripts/importMemberSnapshot.js <arquivo> [origem] [--apply]',
    '',
    'Exemplo:',
    '  node scripts/importMemberSnapshot.js membros-semana.tsv "lista semanal"',
    '  node scripts/importMemberSnapshot.js membros-semana.tsv "lista semanal" --apply',
    '',
    'Sem --apply, o script mostra apenas a prévia.'
  ].join('\n');
}

function main(argv = process.argv) {
  const filePath = argv[2];
  const apply = argv.includes('--apply');
  const sourceArg = argv.slice(3).find((arg) => arg !== '--apply');
  const sourceName = sourceArg || (filePath ? path.basename(filePath) : null);

  if (!filePath) {
    console.error(usage());
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Arquivo nao encontrado: ${resolvedPath}`);
    process.exit(1);
  }

  migrate();

  const text = fs.readFileSync(resolvedPath, 'utf8');
  const preview = snapshots.previewMemberSnapshot(text);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', sourceName, ...preview }, null, 2));
  if (!apply) {
    console.log('\nNada foi importado. Revise a prévia e repita com --apply.');
    return;
  }

  const backupPath = backupDatabase('before_member_snapshot_import');
  const result = snapshots.importMemberSnapshot(text, {
    sourceName,
    actorId: 'script'
  });

  console.log(`Snapshot #${result.id} importado.`);
  console.log(`Membros: ${result.memberCount}`);
  console.log(`Online: ${result.onlineCount}`);
  console.log(`Backup anterior: ${backupPath || 'banco ainda não existia'}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  main
};
