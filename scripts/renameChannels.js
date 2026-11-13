require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const ids = require('../src/config/ids');
const { renameConfiguredChannels } = require('../src/modules/setup/channelRenamer');

async function main() {
  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN ausente. Preencha o .env antes de rodar.');

  const shouldApply = process.argv.includes('--apply');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);

  const guild = await client.guilds.fetch(ids.guildId);
  await guild.channels.fetch();

  console.log(`Servidor: ${guild.name} (${guild.id})`);
  console.log(shouldApply ? 'Modo: aplicar renomes' : 'Modo: previa. Nada sera alterado.');

  const results = await renameConfiguredChannels(guild, ids, { apply: shouldApply });
  for (const item of results) {
    if (item.status === 'missing') console.log(`- ${item.kind}.${item.key}: canal nao encontrado (${item.id})`);
    else if (item.status === 'same') console.log(`- ${item.kind}.${item.key}: ja esta como "${item.name}"`);
    else console.log(`- ${item.kind}.${item.key}: "${item.oldName}" -> "${item.name}"`);
  }

  if (!shouldApply) {
    console.log('\nPara aplicar, rode: npm run rename:channels -- --apply');
  }

  await client.destroy();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
