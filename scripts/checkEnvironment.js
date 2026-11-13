require('dotenv').config();

const required = [
  'DISCORD_TOKEN',
  'CLIENT_ID',
  'GUILD_ID',
  'DATABASE_PATH',
  'DISCORD_CLIENT_SECRET',
  'DASHBOARD_BASE_URL',
  'DASHBOARD_SESSION_SECRET'
];

const missing = required.filter((name) => !String(process.env[name] || '').trim());
if (missing.length > 0) {
  console.error('Ambiente incompleto. Preencha no .env:');
  for (const name of missing) console.error(`- ${name}`);
  console.error('\nUse .env.example como lista oficial. Nenhum valor secreto foi exibido.');
  process.exit(1);
}

console.log(`Ambiente pronto: ${required.length} variaveis obrigatorias preenchidas.`);
