require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const ids = require('../src/config/ids');
const { syncGuestChannelPermissions } = require('../src/modules/setup/guestChannelPermissions');

async function main() {
  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN ausente. Preencha o .env antes de rodar.');

  const shouldApply = process.argv.includes('--apply');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);

  try {
    const guild = await client.guilds.fetch(ids.guildId);
    const results = await syncGuestChannelPermissions(guild, { apply: shouldApply });
    const labels = {
      hidden: 'oculto',
      readOnly: 'somente leitura',
      writable: 'leitura e escrita',
      voice: 'entrar e falar'
    };

    console.log(`Servidor: ${guild.name} (${guild.id})`);
    console.log(shouldApply ? 'Modo: aplicar permissoes' : 'Modo: previa. Nada sera alterado.');
    for (const item of results) {
      const status = item.changed ? (shouldApply ? 'aplicado' : 'alterar') : 'ja correto';
      console.log(`- ${item.name} (${item.id}): ${labels[item.mode]} | ${status}`);
    }

    const changed = results.filter((item) => item.changed).length;
    console.log(`\nResumo: ${changed} de ${results.length} canal(is) ${shouldApply ? 'atualizado(s)' : 'precisam de atualizacao'}.`);
    if (!shouldApply) console.log('Para aplicar, rode: npm run sync:guest-channels -- --apply');
  } finally {
    await client.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
