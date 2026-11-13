require('dotenv').config();
const { backupDatabase } = require('../src/database/backup');

const backupPath = backupDatabase('manual');
if (!backupPath) {
  console.log('Banco ainda nao existe. Nada para copiar.');
} else {
  console.log(`Backup criado: ${backupPath}`);
}
