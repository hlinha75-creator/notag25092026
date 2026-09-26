require('dotenv').config();
const { REST, Routes } = require('discord.js');
const ids = require('../src/config/ids');
const CONFIRMATION = 'CONFIRMAR-LIMPEZA';

async function main() {
  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN ausente.');
  if (process.argv[2] !== CONFIRMATION) {
    console.log('Nenhum comando foi removido.');
    console.log(`Para limpar comandos globais e da guild, rode: npm run clear:commands -- ${CONFIRMATION}`);
    return;
  }
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(Routes.applicationCommands(ids.clientId), { body: [] });
  console.log('Comandos globais antigos limpos.');

  await rest.put(Routes.applicationGuildCommands(ids.clientId, ids.guildId), { body: [] });
  console.log(`Comandos antigos da guild ${ids.guildId} limpos.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
