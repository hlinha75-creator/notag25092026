require('dotenv').config();

const { ChannelType, Client, GatewayIntentBits } = require('discord.js');
const ids = require('../src/config/ids');

const configuredChannels = Object.entries(ids.channels).map(([key, id]) => ({ kind: 'channel', key, id }));
const configuredCategories = Object.entries(ids.categories).map(([key, id]) => ({ kind: 'category', key, id }));

function channelTypeName(type) {
  const names = {
    [ChannelType.GuildCategory]: 'categoria',
    [ChannelType.GuildText]: 'texto',
    [ChannelType.GuildVoice]: 'voz',
    [ChannelType.GuildAnnouncement]: 'anuncio',
    [ChannelType.GuildForum]: 'forum',
    [ChannelType.GuildStageVoice]: 'palco'
  };
  return names[type] || `tipo_${type}`;
}

function parentName(channel, guild) {
  if (!channel.parentId) return '-';
  return guild.channels.cache.get(channel.parentId)?.name || channel.parentId;
}

async function main() {
  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN ausente. Preencha o .env antes de rodar.');

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_TOKEN);

  const guild = await client.guilds.fetch(ids.guildId);
  await guild.channels.fetch();

  console.log(`Servidor: ${guild.name} (${guild.id})`);
  console.log('\nIDs usados pelo bot:');
  for (const item of [...configuredCategories, ...configuredChannels]) {
    const channel = guild.channels.cache.get(item.id);
    const status = channel ? `${channel.name} | ${channelTypeName(channel.type)} | pai: ${parentName(channel, guild)}` : 'NAO ENCONTRADO';
    console.log(`- ${item.kind}.${item.key}: ${item.id} -> ${status}`);
  }

  console.log('\nTodas as categorias e canais:');
  const channels = [...guild.channels.cache.values()]
    .sort((a, b) => {
      const leftParent = a.type === ChannelType.GuildCategory ? a.id : a.parentId || '';
      const rightParent = b.type === ChannelType.GuildCategory ? b.id : b.parentId || '';
      return String(leftParent).localeCompare(String(rightParent)) || (a.rawPosition ?? 0) - (b.rawPosition ?? 0);
    });

  for (const channel of channels) {
    const marker = channel.type === ChannelType.GuildCategory ? '\n' : '  ';
    const parent = channel.type === ChannelType.GuildCategory ? '' : ` | categoria: ${parentName(channel, guild)}`;
    console.log(`${marker}- ${channel.name} | ${channelTypeName(channel.type)} | ${channel.id}${parent}`);
  }

  await client.destroy();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
