const Database = require('better-sqlite3');
const db = new Database('data/notag.sqlite');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('TABLES', JSON.stringify(tables, null, 2));
for (const table of ['users', 'balances', 'member_roles', 'guild_roles', 'guild_role_memberships']) {
  try {
    const cols = db.prepare('PRAGMA table_info(' + table + ')').all();
    console.log('TABLE', table, JSON.stringify(cols, null, 2));
  } catch (error) {
    console.log('TABLE', table, 'MISSING');
  }
}
db.close();
