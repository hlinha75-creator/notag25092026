const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const eventsRepo = require('./events.repository');

const allEventTypes = ['common', 'cta', 'raid_full', 'world_boss'];
const allPhases = ['15', '10', '5', '0'];
const recommendedPhases = ['15', '0'];
const eventTypeLabels = {
  common: 'Eventos comuns',
  cta: 'CTA',
  raid_full: 'Raid Full',
  world_boss: 'World Boss'
};
const phaseLabels = {
  15: '15 minutos antes',
  10: '10 minutos antes',
  5: '5 minutos antes',
  0: 'Começando agora'
};

function getPreference(discordId) {
  const row = getDatabase().prepare('SELECT * FROM event_notification_preferences WHERE discord_id = ?').get(discordId);
  if (!row) {
    return {
      discordId: String(discordId),
      enabled: false,
      eventTypes: [...allEventTypes],
      phases: [...recommendedPhases],
      configured: false
    };
  }
  return {
    discordId: row.discord_id,
    enabled: Boolean(row.enabled),
    eventTypes: parseChoices(row.event_types_json, allEventTypes, allEventTypes),
    phases: parseChoices(row.phases_json, allPhases, recommendedPhases),
    configured: true
  };
}

function savePreference(discordId, patch = {}) {
  const current = getPreference(discordId);
  const enabled = patch.enabled == null ? current.enabled : Boolean(patch.enabled);
  const eventTypes = normalizeChoices(patch.eventTypes || current.eventTypes, allEventTypes, 'tipo de evento');
  const phases = normalizeChoices(patch.phases || current.phases, allPhases, 'momento do aviso');
  getDatabase().prepare(`
    INSERT INTO event_notification_preferences
      (discord_id, enabled, event_types_json, phases_json, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(discord_id) DO UPDATE SET
      enabled = excluded.enabled,
      event_types_json = excluded.event_types_json,
      phases_json = excluded.phases_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(String(discordId), enabled ? 1 : 0, JSON.stringify(eventTypes), JSON.stringify(phases));
  return getPreference(discordId);
}

function acceptRecommended(discordId) {
  return savePreference(discordId, {
    enabled: true,
    eventTypes: allEventTypes,
    phases: recommendedPhases
  });
}

function disable(discordId) {
  return savePreference(discordId, { enabled: false });
}

function listSubscribers(eventType, phase) {
  return getDatabase().prepare(`
    SELECT *
    FROM event_notification_preferences
    WHERE enabled = 1
    ORDER BY discord_id
  `).all().filter((row) => (
    parseChoices(row.event_types_json, allEventTypes, allEventTypes).includes(eventType)
    && parseChoices(row.phases_json, allPhases, recommendedPhases).includes(String(phase))
  ));
}

function wasDmSent({ eventId, phase, discordId }) {
  return Boolean(getDatabase().prepare(`
    SELECT 1 FROM event_notification_dm_dispatches
    WHERE event_id = ? AND phase = ? AND discord_id = ?
  `).get(eventId, String(phase), String(discordId)));
}

function markDmSent({ eventId, phase, discordId }) {
  return getDatabase().prepare(`
    INSERT OR IGNORE INTO event_notification_dm_dispatches (event_id, phase, discord_id)
    VALUES (?, ?, ?)
  `).run(eventId, String(phase), String(discordId));
}

function preferencePayload(discordId, notice = null) {
  const preference = getPreference(discordId);
  const status = preference.enabled
    ? `Ativas: **${preference.eventTypes.map((type) => eventTypeLabels[type]).join(', ')}** | **${preference.phases.map((phase) => phaseLabels[phase]).join(', ')}**.`
    : preference.configured
      ? 'Suas notificações pessoais estão **desativadas**.'
      : 'Você ainda não escolheu suas preferências. A recomendação é receber avisos aos 15 minutos e no início.';
  return {
    content: [notice, status].filter(Boolean).join('\n\n'),
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('event_notification_types:select')
          .setPlaceholder('Tipos de evento')
          .setMinValues(1)
          .setMaxValues(allEventTypes.length)
          .addOptions(allEventTypes.map((value) => ({
            label: eventTypeLabels[value],
            value,
            default: preference.eventTypes.includes(value)
          })))
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('event_notification_phases:select')
          .setPlaceholder('Quando receber')
          .setMinValues(1)
          .setMaxValues(allPhases.length)
          .addOptions(allPhases.map((value) => ({
            label: phaseLabels[value],
            value,
            default: preference.phases.includes(value)
          })))
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('event_notifications:recommended').setLabel('Receber recomendado').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('event_notifications:disable').setLabel('Desativar').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('event_notifications:test').setLabel('Testar DM').setStyle(ButtonStyle.Secondary)
      )
    ],
    flags: MessageFlags.Ephemeral
  };
}

function questionPanelPayload(roleIds) {
  const mentions = roleIds.map((roleId) => `<@&${roleId}>`).join(' ');
  return {
    content: mentions,
    embeds: [new EmbedBuilder()
      .setTitle('🔔 Preferências de eventos')
      .setDescription([
        '**Os avisos de eventos estão incomodando?**',
        'Você pode manter a recomendação, escolher os tipos e horários que deseja receber por DM ou desativar as notificações pessoais.',
        'Os avisos públicos continuam visíveis no canal, mas sua escolha controla as mensagens privadas.'
      ].join('\n\n'))
      .setColor(0x5865f2)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('event_notifications:recommended').setLabel('Estão boas').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('event_notifications:customize').setLabel('Personalizar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('event_notifications:disable').setLabel('Desativar').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('event_notifications:test').setLabel('Testar minha notificação').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [], roles: roleIds }
  };
}

async function upsertQuestionPanels(client) {
  const panels = [
    {
      key: 'event-notifications:members',
      channelId: ids.channels.notagChat,
      roleIds: [ids.roles.core, ids.roles.member].filter(Boolean)
    },
    {
      key: 'event-notifications:guests',
      channelId: ids.channels.inactivityNotice,
      roleIds: [ids.roles.guest].filter(Boolean)
    }
  ];
  const results = [];
  for (const panel of panels) {
    try {
      const channel = await client.channels.fetch(panel.channelId);
      const stored = eventsRepo.getPersistentMessage(panel.key);
      const existing = stored?.channel_id === panel.channelId
        ? await channel.messages.fetch(stored.message_id).catch(() => null)
        : null;
      const payload = questionPanelPayload(panel.roleIds);
      const message = existing ? await existing.edit(payload) : await channel.send(payload);
      eventsRepo.setPersistentMessage({ key: panel.key, channelId: panel.channelId, messageId: message.id });
      results.push({ type: panel.key, channelId: panel.channelId, ok: true });
    } catch (error) {
      results.push({
        type: panel.key,
        channelId: panel.channelId,
        ok: false,
        error: String(error?.message || error).slice(0, 160)
      });
    }
  }
  return results;
}

async function sendTestDm(interaction) {
  const preference = getPreference(interaction.user.id);
  if (!preference.enabled) {
    return preferencePayload(interaction.user.id, 'Ative uma configuração antes de testar a DM.');
  }
  const sent = await interaction.user.send({
    content: [
      '🔔 **TESTE DE NOTIFICAÇÃO DE EVENTO**',
      'Sua configuração está funcionando.',
      `Tipos: ${preference.eventTypes.map((type) => eventTypeLabels[type]).join(', ')}.`,
      `Momentos: ${preference.phases.map((phase) => phaseLabels[phase]).join(', ')}.`
    ].join('\n'),
    allowedMentions: { parse: [] }
  }).then(() => true).catch(() => false);
  if (!sent) {
    return preferencePayload(interaction.user.id, 'Não consegui enviar a DM. Verifique se suas mensagens privadas do servidor estão liberadas.');
  }
  return preferencePayload(interaction.user.id, 'DM de teste enviada com sucesso.');
}

function parseChoices(raw, allowed, fallback) {
  try {
    return normalizeChoices(JSON.parse(raw), allowed, 'preferência');
  } catch {
    return [...fallback];
  }
}

function normalizeChoices(values, allowed, label) {
  const choices = [...new Set((Array.isArray(values) ? values : []).map(String))]
    .filter((value) => allowed.includes(value));
  if (!choices.length) throw new Error(`Selecione pelo menos um ${label}.`);
  return choices;
}

module.exports = {
  acceptRecommended,
  allEventTypes,
  allPhases,
  disable,
  eventTypeLabels,
  getPreference,
  listSubscribers,
  markDmSent,
  phaseLabels,
  preferencePayload,
  questionPanelPayload,
  savePreference,
  sendTestDm,
  upsertQuestionPanels,
  wasDmSent
};
