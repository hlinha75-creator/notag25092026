const { EmbedBuilder } = require('discord.js');
const ids = require('../../config/ids');

const activeTimers = new Map();
const MAX_DURATION_MS = 60 * 60 * 1000;
const MIN_DURATION_MS = 60 * 1000;

function parseObjectiveInput(input) {
  const parts = String(input || '')
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length !== 3) {
    throw new Error('Use o formato: /objetivo tipo, mapa, tempo. Ex: /objetivo orb roxa, ho loch, 5min');
  }

  const [type, location, durationText] = parts;
  const durationMs = parseDurationMs(durationText);

  return {
    type: normalizeLabel(type),
    location: normalizeLabel(location),
    durationMs
  };
}

function parseDurationMs(value) {
  const text = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  const match = text.match(/^(\d{1,3})(m|min|minuto|minutos|s|seg|segundo|segundos)?$/);
  if (!match) {
    throw new Error('Tempo invalido. Use algo como 5min, 10m ou 300s.');
  }

  const amount = Number(match[1]);
  const unit = match[2] || 'min';
  const durationMs = unit.startsWith('s') ? amount * 1000 : amount * 60 * 1000;

  if (durationMs < MIN_DURATION_MS) {
    throw new Error('O tempo minimo do objetivo e 1 minuto.');
  }
  if (durationMs > MAX_DURATION_MS) {
    throw new Error('O tempo maximo do objetivo e 60 minutos.');
  }

  return durationMs;
}

function normalizeLabel(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function colorForType(type) {
  const normalized = type.toLowerCase();
  if (normalized.includes('roxa')) return 0x805ad5;
  if (normalized.includes('azul')) return 0x3182ce;
  if (normalized.includes('verde')) return 0x38a169;
  if (normalized.includes('bau')) return 0xd69e2e;
  if (normalized.includes('dg')) return 0xe53e3e;
  if (normalized.includes('coleta')) return 0x2f855a;
  if (normalized.includes('tesouro')) return 0xd69e2e;
  return 0x805ad5;
}

function buildEmbed(objective, remainingMs, imageUrl) {
  const embed = new EmbedBuilder()
    .setTitle(`${objective.type} encontrado`)
    .setColor(colorForType(objective.type))
    .addFields(
      { name: 'Local', value: objective.location, inline: true },
      { name: 'Tempo restante', value: formatRemaining(remainingMs), inline: true },
      { name: 'Avisado por', value: `<@${objective.actorId}>`, inline: true }
    )
    .setTimestamp(new Date(objective.expiresAt));

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  return embed;
}

function nextRefreshDelay(remainingMs) {
  if (remainingMs <= 60 * 1000) return 10 * 1000;
  return 30 * 1000;
}

async function createObjective(interaction) {
  const objective = parseObjectiveInput(interaction.options.getString('alerta'));
  const image = interaction.options.getAttachment('imagem');
  const imageUrl = isImageAttachment(image) ? image.url : null;

  if (image && !imageUrl) {
    throw new Error('O anexo precisa ser uma imagem.');
  }

  const channel = await interaction.client.channels.fetch(ids.channels.notagChat);
  if (!channel?.isTextBased()) {
    throw new Error('Canal chat-notag invalido ou nao encontrado.');
  }

  const expiresAt = Date.now() + objective.durationMs;
  const payload = {
    ...objective,
    actorId: interaction.user.id,
    expiresAt
  };

  const message = await channel.send({
    embeds: [buildEmbed(payload, objective.durationMs, imageUrl)]
  });

  scheduleRefresh(message, payload, imageUrl);

  return {
    message,
    objective: payload
  };
}

function scheduleRefresh(message, objective, imageUrl) {
  const remainingMs = objective.expiresAt - Date.now();

  if (remainingMs <= 0) {
    activeTimers.delete(message.id);
    message.delete().catch(() => {});
    return;
  }

  message.edit({
    embeds: [buildEmbed(objective, remainingMs, imageUrl)]
  }).catch(() => {});

  const timer = setTimeout(
    () => scheduleRefresh(message, objective, imageUrl),
    Math.min(nextRefreshDelay(remainingMs), remainingMs)
  );
  activeTimers.set(message.id, timer);
}

function isImageAttachment(attachment) {
  if (!attachment) return false;
  if (attachment.contentType?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp)(\?\S*)?$/i.test(attachment.url || '');
}

module.exports = {
  createObjective,
  formatRemaining,
  parseObjectiveInput
};
