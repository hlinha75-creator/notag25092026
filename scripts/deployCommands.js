require('dotenv').config();
const { REST, Routes } = require('discord.js');
const commands = require('../src/commands/definitions');
const ids = require('../src/config/ids');

async function main() {
  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN ausente.');
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(ids.clientId, ids.guildId), { body: commands });
  console.log(`Comandos registrados na guild ${ids.guildId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
