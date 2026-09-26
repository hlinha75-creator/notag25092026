const Database = require('better-sqlite3');
const db = new Database('data/notag.sqlite');
const rows = db.prepare(`
  SELECT
    u.discord_id,
    u.discord_name,
    u.albion_name,
    COALESCE(b.balance, 0) AS balance,
    u.registration_status
  FROM users u
  LEFT JOIN balances b ON b.discord_id = u.discord_id
  LEFT JOIN linked_discord_accounts l
    ON l.linked_discord_id = u.discord_id
   AND l.primary_discord_id <> l.linked_discord_id
  WHERE l.linked_discord_id IS NULL
    AND u.registration_status = 'member'
  ORDER BY COALESCE(b.balance, 0) DESC,
           COALESCE(u.albion_name, u.discord_name, u.discord_id) COLLATE NOCASE
`).all();

console.log('TOTAL_MEMBROS:', rows.length);
console.log('TOTAL_PRATA:', rows.reduce((sum, row) => sum + Number(row.balance || 0), 0));
for (const [index, row] of rows.entries()) {
  const name = row.albion_name || row.discord_name || row.discord_id;
  console.log(`${index + 1}. ${name} - ${Number(row.balance).toLocaleString('pt-BR')} prata`);
}
db.close();
