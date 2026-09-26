require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { backupDatabase } = require('../src/database/backup');

const target = process.argv[2];
const confirmation = process.argv[3];
const stoppedConfirmation = process.argv[4];

if (!target || confirmation !== 'CONFIRMAR' || stoppedConfirmation !== 'BOT_PARADO') {
  console.log('Uso: node scripts/restoreDatabase.js <backup.sqlite> CONFIRMAR BOT_PARADO');
  console.log('Este script e manual e sobrescreve o banco atual.');
  console.log('Pare o bot antes e confirme que não existem arquivos -wal/-shm ativos.');
  process.exit(1);
}

const databasePath = path.resolve(process.env.DATABASE_PATH || './data/notag.sqlite');
const backupPath = path.resolve(target);

if (!fs.existsSync(backupPath)) {
  throw new Error(`Backup nao encontrado: ${backupPath}`);
}
if (backupPath === databasePath) throw new Error('O backup e o banco de destino nao podem ser o mesmo arquivo.');

for (const sidecar of [`${databasePath}-wal`, `${databasePath}-shm`]) {
  if (fs.existsSync(sidecar)) throw new Error(`Arquivo ativo encontrado: ${sidecar}. Pare o bot e feche conexoes antes do restore.`);
}

function verifyDatabase(filePath) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`integrity_check retornou: ${integrity}`);
  } finally {
    db.close();
  }
}

function verifyChecksum(filePath) {
  const checksumPath = `${filePath}.sha256`;
  if (!fs.existsSync(checksumPath)) return false;
  const expected = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0]?.toLowerCase();
  const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (!expected || expected !== actual) throw new Error('SHA-256 do backup nao confere. Restore cancelado.');
  return true;
}

verifyDatabase(backupPath);
const checksumVerified = verifyChecksum(backupPath);

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const emergency = fs.existsSync(databasePath) ? backupDatabase('before_restore') : null;
if (emergency) console.log(`Copia de emergencia criada: ${emergency}`);

fs.copyFileSync(backupPath, databasePath);
try {
  verifyDatabase(databasePath);
} catch (error) {
  if (emergency) fs.copyFileSync(emergency, databasePath);
  throw new Error(`Restore falhou na verificacao final e foi revertido: ${error.message}`);
}
console.log(`Banco restaurado de ${backupPath}`);
console.log(checksumVerified ? 'SHA-256 verificado.' : 'Backup sem arquivo .sha256; integridade SQLite verificada.');
