const { AttachmentBuilder, ChannelType } = require('discord.js');
const { extraRenames, names } = require('./channelRenamer');

function channelTypeName(type) {
  const labels = {
    [ChannelType.GuildCategory]: 'categoria',
    [ChannelType.GuildText]: 'texto',
    [ChannelType.GuildVoice]: 'voz',
    [ChannelType.GuildAnnouncement]: 'anuncio',
    [ChannelType.GuildForum]: 'forum',
    [ChannelType.GuildStageVoice]: 'palco'
  };
  return labels[type] || `tipo_${type}`;
}

function configuredLookup(ids) {
  const entries = [
    ...Object.entries(ids.categories).map(([key, id]) => ({
      key,
      id,
      suggestedName: names.categories[key]
    })),
    ...Object.entries(ids.channels).map(([key, id]) => ({
      key,
      id,
      suggestedName: names.channels[key]
    })),
    ...extraRenames.map((item) => ({
      key: item.key,
      id: item.id,
      suggestedName: item.name
    }))
  ];
  return new Map(entries.map((entry) => [entry.id, entry]));
}

function parentName(channel, guild) {
  if (!channel.parentId) return '-';
  return guild.channels.cache.get(channel.parentId)?.name || channel.parentId;
}

function sortedChannels(guild) {
  return [...guild.channels.cache.values()]
    .sort((left, right) => {
      const leftParent = left.type === ChannelType.GuildCategory ? left.id : left.parentId || '';
      const rightParent = right.type === ChannelType.GuildCategory ? right.id : right.parentId || '';
      return String(leftParent).localeCompare(String(rightParent)) || (left.rawPosition ?? 0) - (right.rawPosition ?? 0);
    });
}

async function auditGuildChannels(guild, ids) {
  await guild.channels.fetch();
  const knownById = configuredLookup(ids);

  return sortedChannels(guild).map((channel) => {
    const known = knownById.get(channel.id);
    return {
      id: channel.id,
      name: channel.name,
      type: channelTypeName(channel.type),
      category: parentName(channel, guild),
      configuredKey: known?.key || '',
      suggestedName: known?.suggestedName || ''
    };
  });
}

function formatAuditSummary(rows) {
  const known = rows.filter((row) => row.configuredKey).length;
  const unknown = rows.length - known;
  return [
    `Canais encontrados: ${rows.length}`,
    `Conhecidos pelo bot: ${known}`,
    `Fora do mapa do bot: ${unknown}`,
    '',
    'Enviei o relatorio completo em TXT. Os canais fora do mapa precisam de uma sugestao aprovada antes de renomear.'
  ].join('\n');
}

function auditAttachment(rows) {
  const header = ['tipo', 'categoria', 'nome_atual', 'id', 'chave_bot', 'sugestao'];
  const lines = rows.map((row) => [
    row.type,
    row.category,
    row.name,
    row.id,
    row.configuredKey || '-',
    row.suggestedName || 'definir'
  ].map(csvValue).join(','));

  const content = [header.join(','), ...lines].join('\n');
  return new AttachmentBuilder(Buffer.from(content, 'utf8'), { name: 'auditoria-canais.csv' });
}

function csvValue(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

module.exports = {
  auditAttachment,
  auditGuildChannels,
  formatAuditSummary
};
