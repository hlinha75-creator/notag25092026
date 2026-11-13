const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const env = require('../../config/env');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const seasonPoints = require('./seasonPoints.service');

const targetChannels = [
  { channelId: ids.channels.campaignAnnouncements, notifyMembers: true },
  { channelId: ids.channels.notagChat, notifyMembers: false }
];

function formatPoints(value) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function portalSeasonUrl() {
  return new URL('/portal/temporada', env.dashboardBaseUrl).toString();
}

function buildSeasonAnnouncementPayload({ notifyMembers = false } = {}) {
  const ranking = seasonPoints.calculateSeasonRanking();
  const top20 = ranking.rows.slice(0, 20);
  const podium = top20.slice(0, 3).map((row, index) => (
    `${['🥇', '🥈', '🥉'][index]} **${row.name}** — **${formatPoints(row.totalPoints)}** pts`
  )).join('\n');
  const remaining = top20.slice(3).map((row) => (
    `**${row.rank}.** ${row.name} — **${formatPoints(row.totalPoints)}** pts`
  )).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`🏆 A NOTAG É OURO! — Temporada ${ranking.season}`)
    .setDescription([
      `Com esforço coletivo, alcançamos o **bracket Ouro** e somamos **${new Intl.NumberFormat('pt-BR').format(ranking.officialGuildPoints)} pontos de temporada**. Parabéns a todos que contribuíram! 🖤💛`,
      'Superamos a meta de **120.000 pontos** e nos qualificamos para um **QG Qualidade 5 / Tier 8**. Este levantamento foi feito com menos de **2 dias restantes** na temporada.'
    ].join('\n\n'))
    .addFields(
      { name: '⭐ Pódio da temporada', value: podium, inline: false },
      { name: '🔥 Top 20 contribuições', value: remaining, inline: false }
    )
    .setColor(0xf2bd4a)
    .setFooter({ text: `Snapshot de ${ranking.capturedAt.split('-').reverse().join('/')} · Estimativa proporcional baseada nos rankings da temporada.` });

  const button = new ButtonBuilder()
    .setLabel('Ver ranking completo')
    .setEmoji('🏆')
    .setStyle(ButtonStyle.Link)
    .setURL(portalSeasonUrl());

  return {
    content: notifyMembers ? `<@&${ids.roles.member}>` : undefined,
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
    allowedMentions: notifyMembers ? { roles: [ids.roles.member] } : { parse: [] }
  };
}

async function upsertAnnouncement(client, target) {
  const db = getDatabase();
  const key = `season:${seasonPoints.calculateSeasonRanking().season}:gold:${target.channelId}`;
  const channel = await client.channels.fetch(target.channelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error(`Canal ${target.channelId} indisponível ou sem suporte a mensagens.`);

  const previous = db.prepare('SELECT * FROM persistent_bot_messages WHERE message_key = ?').get(key);
  let message = previous ? await channel.messages.fetch(previous.message_id).catch(() => null) : null;
  const payload = buildSeasonAnnouncementPayload({ notifyMembers: target.notifyMembers });
  message = message ? await message.edit(payload) : await channel.send(payload);

  db.prepare(`
    INSERT INTO persistent_bot_messages (message_key, channel_id, message_id, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(message_key) DO UPDATE SET
      channel_id = excluded.channel_id,
      message_id = excluded.message_id,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, channel.id, message.id);

  return { channelId: channel.id, messageId: message.id, updated: Boolean(previous) };
}

async function publishSeasonAnnouncement(client) {
  const results = [];
  for (const target of targetChannels) {
    try {
      results.push({ ok: true, ...await upsertAnnouncement(client, target) });
    } catch (error) {
      results.push({ ok: false, channelId: target.channelId, error: error.message });
    }
  }
  return results;
}

module.exports = {
  buildSeasonAnnouncementPayload,
  portalSeasonUrl,
  publishSeasonAnnouncement,
  targetChannels
};
