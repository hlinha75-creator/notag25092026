const Database = require('better-sqlite3');
const db = new Database('data/notag.sqlite');

const result = db.prepare(
  "UPDATE users SET registration_status = 'member' WHERE registration_status != 'member'"
).run();

const rows = db.prepare(
  "SELECT registration_status, COUNT(*) AS q FROM users GROUP BY registration_status ORDER BY registration_status"
).all();

console.log('linhas afetadas:', result.changes);
console.log(JSON.stringify(rows, null, 2));

db.close();
