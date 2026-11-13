require('dotenv').config();

const { REST, Routes } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const channelId = process.argv[2];
const outputMode = process.argv[3] || 'json';

if (!token) throw new Error('Variavel de ambiente ausente: DISCORD_TOKEN');
if (!/^\d{17,20}$/.test(channelId || '')) {
  throw new Error('Uso: node scripts/reviewChannelMessages.js <channel_id>');
}

const rest = new REST({ version: '10' }).setToken(token);

function summarizeEmbed(embed) {
  return {
    type: embed.type || null,
    title: embed.title || null,
    description: embed.description || null,
    url: embed.url || null,
    fields: (embed.fields || []).map((field) => ({
      name: field.name,
      value: field.value,
      inline: Boolean(field.inline)
    })),
    image: embed.image?.url || null,
    thumbnail: embed.thumbnail?.url || null,
    footer: embed.footer?.text || null
  };
}

async function main() {
  const channel = await rest.get(Routes.channel(channelId));
  const messages = [];
  let before;

  while (true) {
    const query = new URLSearchParams({ limit: '100' });
    if (before) query.set('before', before);
    const page = await rest.get(Routes.channelMessages(channelId), { query });
    messages.push(...page);
    if (page.length < 100) break;
    before = page[page.length - 1].id;
  }

  const guildId = channel.guild_id || process.env.GUILD_ID || null;
  const normalized = messages
    .sort((left, right) => BigInt(left.id) < BigInt(right.id) ? -1 : 1)
    .map((message, index) => ({
      number: index + 1,
      id: message.id,
      author: {
        id: message.author?.id || null,
        username: message.author?.global_name || message.author?.username || 'Desconhecido',
        bot: Boolean(message.author?.bot)
      },
      timestamp: message.timestamp,
      editedTimestamp: message.edited_timestamp || null,
      content: message.content || '',
      pinned: Boolean(message.pinned),
      type: message.type,
      attachments: (message.attachments || []).map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.content_type || null,
        size: attachment.size,
        url: attachment.url
      })),
      embeds: (message.embeds || []).map(summarizeEmbed),
      components: message.components || [],
      reactions: (message.reactions || []).map((reaction) => ({
        emoji: reaction.emoji?.name || reaction.emoji?.id || '?',
        count: reaction.count,
        me: Boolean(reaction.me)
      })),
      referencedMessageId: message.message_reference?.message_id || null,
      link: guildId ? `https://discord.com/channels/${guildId}/${channelId}/${message.id}` : null
    }));

  const result = {
    channel: {
      id: channel.id,
      name: channel.name || null,
      guildId
    },
    collectedAt: new Date().toISOString(),
    total: normalized.length,
    messages: normalized
  };

  if (outputMode === '--summary') {
    const lines = normalized.map((message) => {
      const date = message.timestamp.slice(0, 10);
      const embedTitle = message.embeds.map((embed) => embed.title).filter(Boolean).join(' | ');
      const rawSummary = message.content || embedTitle || (message.attachments.length ? '[somente anexo]' : '[sem texto]');
      const summary = rawSummary.replace(/\s+/g, ' ').trim().slice(0, 220);
      const markers = [
        message.author.bot ? 'BOT' : null,
        message.type === 18 ? 'TOPICO' : null,
        message.attachments.length ? `${message.attachments.length} ANEXO(S)` : null,
        message.embeds.length ? `${message.embeds.length} EMBED(S)` : null,
        message.components.length ? 'BOTOES' : null,
        message.pinned ? 'FIXADA' : null
      ].filter(Boolean).join(', ');
      return `${String(message.number).padStart(2, '0')} | ${date} | ${message.id} | ${message.author.username} | ${markers || '-'} | ${summary}`;
    });
    process.stdout.write(lines.join('\n'));
    return;
  }

  process.stdout.write(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  const code = error?.code ? ` (codigo ${error.code})` : '';
  console.error(`Falha ao consultar o canal${code}: ${error.message}`);
  process.exitCode = 1;
});
