function isAlreadyAcknowledged(error) {
  return error?.code === 40060 || error?.rawError?.code === 40060;
}

function isUnknownInteraction(error) {
  return error?.code === 10062 || error?.rawError?.code === 10062;
}

function isExpiredOrDuplicateInteraction(error) {
  return isAlreadyAcknowledged(error) || isUnknownInteraction(error);
}

async function safeDeferReply(interaction, options = {}) {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferReply(options);
    return true;
  } catch (error) {
    if (isExpiredOrDuplicateInteraction(error)) return false;
    throw error;
  }
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
    return true;
  } catch (error) {
    if (isExpiredOrDuplicateInteraction(error)) return false;
    throw error;
  }
}

async function safeEditReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
      return true;
    }
    return safeReply(interaction, payload);
  } catch (error) {
    if (isExpiredOrDuplicateInteraction(error)) return false;
    throw error;
  }
}

module.exports = {
  isAlreadyAcknowledged,
  isExpiredOrDuplicateInteraction,
  isUnknownInteraction,
  safeDeferReply,
  safeEditReply,
  safeReply
};
