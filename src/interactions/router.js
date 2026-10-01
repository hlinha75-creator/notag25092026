const { handleCommand } = require('../commands/handlers');
const { handleButton } = require('./buttons');
const { handleModal } = require('./modals');
const { handleSelect } = require('./selects');
const events = require('../modules/events/events.service');
const eventsRepo = require('../modules/events/events.repository');
const missions = require('../modules/missions/missions.service');
const wtb = require('../modules/marketplace/wtb.service');
const callerSchedule = require('../modules/operations/callerSchedule.service');
const { MessageFlags } = require('discord.js');
const { safeDeferReply, safeEditReply, safeReply } = require('../utils/interactions');

async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('caller_schedule:')) return await callerSchedule.handleButton(interaction);
      if (interaction.customId.startsWith('wtb:')) return await wtb.handleButton(interaction);
      return await handleButton(interaction);
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('caller_schedule:')) {
      return await callerSchedule.handleSelect(interaction);
    }
    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isChannelSelectMenu()) return await handleSelect(interaction);
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('mission:edit_submit:')) {
        return await missions.handleEditModal(interaction);
      }
      if (interaction.customId.startsWith('wtb:')) {
        return await wtb.handleModal(interaction);
      }
      if (interaction.customId.startsWith('event:cancel_modal:')) {
        const [, , eventIdRaw, channelId, messageId] = interaction.customId.split(':');
        const eventId = Number(eventIdRaw);
        const reason = interaction.fields.getTextInputValue('reason');
        const acknowledged = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        if (!acknowledged) return null;
        if (!eventsRepo.getEvent(eventId)) {
          const channel = channelId
            ? await interaction.client.channels.fetch(channelId).catch(() => null)
            : null;
          const sourceMessage = channel && messageId
            ? await channel.messages.fetch(messageId).catch(() => null)
            : null;
          await sourceMessage?.delete().catch(() => {});
          return safeEditReply(interaction, {
            content: sourceMessage
              ? 'A mensagem antiga do evento foi removida. O registro já não existe no banco, então não havia evento para cancelar.'
              : 'Esse evento já não existe no banco e não pôde ser cancelado. A mensagem antiga não foi localizada; remova-a manualmente no Discord.'
          });
        }
        await events.cancelEvent(interaction, eventId, reason);
        return safeEditReply(interaction, { content: 'Evento cancelado.' });
      }
      return await handleModal(interaction);
    }
  } catch (error) {
    if (error.code === 10062 || error.code === 40060) return;
    const message = readableInteractionError(error);
    if (!isUserFacingError(error)) {
      console.error('Erro em interaction:', error);
    }
    const payload = { content: `Erro: ${message}`, flags: MessageFlags.Ephemeral };
    if (interaction.deferred && !interaction.replied) {
      return safeEditReply(interaction, { content: payload.content }).catch(() => {});
    }
    return safeReply(interaction, payload).catch(() => {});
  }
}

function isUserFacingError(error) {
  return error?.isUserFacing === true || (error instanceof Error && error.name === 'Error' && !error.code);
}

function readableInteractionError(error) {
  const details = collectErrorMessages(error);
  if (details.length > 0) return details.slice(0, 3).join(' | ');
  return error.message || 'Erro inesperado.';
}

function collectErrorMessages(error) {
  const messages = [];
  if (error?.errors instanceof Map) {
    for (const value of error.errors.values()) {
      messages.push(...collectErrorMessages(value));
    }
  }
  if (Array.isArray(error?.errors)) {
    for (const value of error.errors) {
      messages.push(...collectErrorMessages(value));
    }
  }
  if (Array.isArray(error)) {
    for (const value of error) {
      messages.push(...collectErrorMessages(value));
    }
  }
  if (error?.message && error.message !== 'Received one or more errors') {
    messages.push(error.message);
  }
  return [...new Set(messages.map((message) => String(message).slice(0, 220)))];
}

module.exports = {
  handleInteraction
};
