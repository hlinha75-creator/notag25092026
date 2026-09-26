const { EmbedBuilder } = require('discord.js');

async function safeSend(client, channelId, payload) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return null;
    return channel.send(normalizePayload(payload));
  } catch (error) {
    console.error(`Falha ao enviar mensagem no canal ${channelId}:`, error);
    return null;
  }
}

function baseEmbed(title) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0x2f855a)
    .setTimestamp(new Date());
}

function normalizePayload(payload) {
  if (!payload?.allowedMentions) return payload;
  return {
    ...payload,
    allowedMentions: normalizeAllowedMentions(payload.allowedMentions)
  };
}

function normalizeAllowedMentions(allowedMentions) {
  return {
    ...allowedMentions,
    users: uniqueMentionIds(allowedMentions.users),
    roles: uniqueMentionIds(allowedMentions.roles)
  };
}

function uniqueMentionIds(values) {
  if (!Array.isArray(values)) return values;
  return [...new Set(values.filter(Boolean).map(String))];
}

module.exports = {
  baseEmbed,
  normalizeAllowedMentions,
  normalizePayload,
  safeSend
};
