const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase, transaction } = require('../../database/connection');

const announcementKey = 'loch-market-announcement:v1';

function feedbackCounts() {
  const rows = getDatabase().prepare(`
    SELECT feedback_type, COUNT(*) AS total
    FROM loch_announcement_feedback
    GROUP BY feedback_type
  `).all();
  const counts = { liked: 0, read: 0 };
  for (const row of rows) counts[row.feedback_type] = Number(row.total || 0);
  return counts;
}

function announcementComponents(counts = feedbackCounts()) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('loch:feedback:liked')
        .setLabel(`Eu gostei disso (${counts.liked})`)
        .setEmoji('\u2764\uFE0F')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('loch:feedback:read')
        .setLabel(`Eu li (${counts.read})`)
        .setEmoji('\u2705')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('loch:suggestion')
        .setLabel('Sugestão')
        .setEmoji('\uD83D\uDCA1')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function announcementPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('HO Loch (Mapa T8)')
        .setDescription([
          'Agora que apenas jogadores com a tag da guilda podem entrar na HO de Loch, vamos fortalecer nossa economia interna!',
          '',
          'A ideia é vender nossos itens no mercado da HO por preços justos, seguindo o valor praticado no mercado geral e evitando aumentos exagerados.',
          '',
          'Para incentivar a participação e movimentar o nosso mercado, estou colocando vários itens à venda por apenas **1 prata**.',
          '',
          'Contamos com todos para comprar, vender e ajudar a desenvolver a economia da nossa HO!'
        ].join('\n'))
        .setColor(0x2f855a)
    ],
    components: announcementComponents(),
    allowedMentions: { parse: [] }
  };
}

async function postAnnouncementIfNeeded(client) {
  const db = getDatabase();
  const existing = db.prepare(`
    SELECT reminder_key, message_id, channel_id
    FROM operation_reminders
    WHERE reminder_key = ?
  `).get(announcementKey);

  if (existing?.message_id && existing?.channel_id) {
    const existingChannel = await client.channels.fetch(existing.channel_id).catch(() => null);
    const existingMessage = existingChannel?.isTextBased()
      ? await existingChannel.messages.fetch(existing.message_id).catch(() => null)
      : null;
    if (existingMessage) {
      await existingMessage.edit(announcementPayload());
      return existingMessage;
    }
  }

  const channel = await client.channels.fetch(ids.channels.campaignAnnouncements).catch(() => null);
  if (!channel?.isTextBased()) return null;
  const message = await channel.send(announcementPayload());
  db.prepare(`
    INSERT INTO operation_reminders (reminder_key, type, message_id, channel_id)
    VALUES (?, 'loch_market_announcement', ?, ?)
    ON CONFLICT(reminder_key) DO UPDATE SET
      message_id = excluded.message_id,
      channel_id = excluded.channel_id
  `).run(announcementKey, message.id, channel.id);
  return message;
}

function registerFeedback(userId, feedbackType) {
  const result = getDatabase().prepare(`
    INSERT OR IGNORE INTO loch_announcement_feedback (user_id, feedback_type)
    VALUES (?, ?)
  `).run(userId, feedbackType);
  return { added: result.changes > 0, counts: feedbackCounts() };
}

const createSuggestion = transaction(({ authorId, suggestion }) => {
  const result = getDatabase().prepare(`
    INSERT INTO loch_market_suggestions (author_id, suggestion)
    VALUES (?, ?)
  `).run(authorId, suggestion);
  return Number(result.lastInsertRowid);
});

function suggestionStaffPayload({ id, authorId, suggestion }) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`Sugestão sobre o mercado da HO #${id}`)
        .addFields(
          { name: 'Enviada por', value: `<@${authorId}>`, inline: false },
          { name: 'Opinião', value: suggestion.slice(0, 1024), inline: false }
        )
        .setColor(0xd69e2e)
        .setTimestamp(new Date())
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`loch:answer:${id}`)
          .setLabel('Responder ao membro')
          .setStyle(ButtonStyle.Primary)
      )
    ],
    allowedMentions: { parse: [] }
  };
}

function attachStaffMessage(id, channelId, messageId) {
  getDatabase().prepare(`
    UPDATE loch_market_suggestions
    SET staff_channel_id = ?, staff_message_id = ?
    WHERE id = ?
  `).run(channelId, messageId, id);
}

function getSuggestion(id) {
  return getDatabase().prepare('SELECT * FROM loch_market_suggestions WHERE id = ?').get(id);
}

function markAnswered({ id, staffId, answer }) {
  getDatabase().prepare(`
    UPDATE loch_market_suggestions
    SET status = 'answered', answered_by = ?, answer = ?, answered_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(staffId, answer, id);
  return getSuggestion(id);
}

function answeredStaffPayload(suggestion) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`Sugestão sobre o mercado da HO #${suggestion.id}`)
        .addFields(
          { name: 'Enviada por', value: `<@${suggestion.author_id}>`, inline: false },
          { name: 'Opinião', value: suggestion.suggestion.slice(0, 1024), inline: false },
          { name: 'Resposta da staff', value: suggestion.answer.slice(0, 1024), inline: false },
          { name: 'Respondida por', value: `<@${suggestion.answered_by}>`, inline: false }
        )
        .setColor(0x38a169)
        .setTimestamp(new Date())
    ],
    components: [],
    allowedMentions: { parse: [] }
  };
}

module.exports = {
  announcementComponents,
  announcementPayload,
  answeredStaffPayload,
  attachStaffMessage,
  createSuggestion,
  getSuggestion,
  markAnswered,
  postAnnouncementIfNeeded,
  registerFeedback,
  suggestionStaffPayload
};
