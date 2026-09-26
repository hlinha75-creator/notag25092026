require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Database = require('better-sqlite3');
const { guildId, roles } = require('./../src/config/ids');

async function main() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error('DISCORD_TOKEN ausente no .env');
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  await client.login(token);

  const guild = await client.guilds.fetch(guildId);
  await guild.members.fetch();
  const memberRole = await guild.roles.fetch(roles.member).catch(() => null);
  const memberRoleIds = new Set(
    memberRole ? guild.members.cache.filter((member) => member.roles.cache.has(memberRole.id)).map((member) => member.id) : []
  );

  const db = new Database('data/notag.sqlite');
  const rows = db.prepare(`
    SELECT
      u.discord_id,
      u.discord_name,
      u.albion_name,
      COALESCE(b.balance, 0) AS balance
    FROM users u
    LEFT JOIN balances b ON b.discord_id = u.discord_id
    LEFT JOIN linked_discord_accounts l
      ON l.linked_discord_id = u.discord_id
     AND l.primary_discord_id <> l.linked_discord_id
    WHERE u.registration_status = 'member'
      AND l.linked_discord_id IS NULL
    ORDER BY COALESCE(b.balance, 0) DESC,
             COALESCE(u.albion_name, u.discord_name, u.discord_id) COLLATE NOCASE
  `).all();

  const missing = rows.filter((row) => guild.members.cache.has(String(row.discord_id)) && !memberRoleIds.has(String(row.discord_id)));

  console.log('SEM_CARGO_MEMBRO:', missing.length);
  console.log('TOTAL_PRATA_SEM_CARGO_MEMBRO:', missing.reduce((sum, row) => sum + Number(row.balance || 0), 0));
  missing.forEach((row, index) => {
    const name = row.albion_name || row.discord_name || row.discord_id;
    console.log(`${index + 1}. ${name} - ${Number(row.balance).toLocaleString('pt-BR')} prata`);
  });

  db.close();
  await client.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
