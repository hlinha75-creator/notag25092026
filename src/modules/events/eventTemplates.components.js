const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function saveConfigurationComponents(eventId, kind, contentType) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`event_config:save:${eventId}:${kind}:${contentType}`)
      .setLabel('Salvar configuração em 1 clique')
      .setStyle(ButtonStyle.Secondary)
  )];
}

module.exports = { saveConfigurationComponents };
