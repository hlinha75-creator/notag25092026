const ids = require('../../config/ids');
const audit = require('../audit/audit.repository');
const repo = require('./events.repository');
const notificationPreferences = require('./eventNotificationPreferences.service');

const EVENT_REMINDER_DELETE_AFTER_MS = 5 * 60 * 1000;
const reminderPhases = [
  { key: '15', minutes: 15, lowerBoundMinutes: 10 },
  { key: '10', minutes: 10, lowerBoundMinutes: 5 },
  { key: '5', minutes: 5, lowerBoundMinutes: 0 },
  { key: '0', minutes: 0, lowerBoundMinutes: -10 }
];
const roleLabels = { tank: 'Tank', healer: 'Healer', support: 'Suporte', dps: 'DPS' };
const worldBossSlotLabels = {
  main_tank: 'Main Tank',
  main_heal: 'Main Healer',
  badon: 'Badon',
  shadowcaller: 'Shadowcaller',
  perma_support: 'Permafrost',
  lightcaller: 'Águia',
  mistpiercer_1: 'Mistpiercer 1',
  mistpiercer_2: 'Mistpiercer 2',
  mistpiercer_3: 'Mistpiercer 3',
  looter: 'Looter',
  scout_sw_gate: 'Portão SW (Mobile)',
  scout_nw_gate: 'Portão NW (Mobile)',
  scout_ne_gate: 'Portão NE (Mobile)',
  scout_sw_bridge: 'Ponte SW (Ativo)',
  scout_se_bridge: 'Ponte SE (Ativo)',
  scout_ne_bridge: 'Ponte NE (Ativo)'
};

async function checkEventStartWarnings(client) {
  const events = repo.listPendingReminderEvents();
  const guild = await client.guilds.fetch(ids.guildId).catch(() => null);
  if (!guild) return;
  await cleanupExpiredEventTempRoles(guild);
  for (const event of events) {
    const startAt = parseAlbionEventTime(event.scheduled_time);
    if (!startAt) continue;
    const msUntilStart = startAt.getTime() - Date.now();
    const phase = dueReminderPhase(msUntilStart);
    if (!phase) continue;
    await sendEventReminder(client, event, phase.key).catch((error) => {
      console.error(`Falha ao avisar ${event.event_code} em ${phase.key} minutos:`, error);
    });
  }
}

function dueReminderPhase(msUntilStart) {
  return reminderPhases.find((phase) => (
    msUntilStart <= phase.minutes * 60 * 1000
    && msUntilStart > phase.lowerBoundMinutes * 60 * 1000
  )) || null;
}

async function cleanupExpiredEventTempRoles(guild) {
  for (const event of repo.listEventsWithTempRoles()) {
    if (!isTempRoleExpired(event.temp_role_delete_after)) continue;
    await removeWarningRole(guild, event).catch((error) => {
      console.error(`Falha ao remover cargo temporario ${event.warning_role_id} do ${event.event_code}:`, error);
    });
  }

  const roles = await guild.roles.fetch().catch(() => guild.roles.cache);
  const now = Date.now();
  for (const role of roles.values()) {
    if (!isOrphanEventTempRole(role, now)) continue;
    await role.delete('Removendo cargo temporario antigo sem evento vinculado').catch((error) => {
      console.error(`Falha ao remover cargo temporario antigo ${role.name}:`, error);
    });
  }
}

function isTempRoleExpired(deleteAfter) {
  if (!deleteAfter) return false;
  const time = Date.parse(deleteAfter);
  return Number.isFinite(time) && time <= Date.now();
}

function isOrphanEventTempRole(role, now = Date.now()) {
  if (!/^\d{4}as\d{1,2}h$/i.test(role?.name || '')) return false;
  return now - Number(role.createdTimestamp || 0) >= 24 * 60 * 60 * 1000;
}

async function ensureEventTempRole(guild, event) {
  if (event.warning_role_id) {
    const existing = await guild.roles.fetch(event.warning_role_id).catch(() => null);
    if (existing) return existing;
  }
  const role = await guild.roles.create({
    name: eventTempRoleName(event),
    mentionable: true,
    reason: `Tag temporaria do evento ${event.event_code}`
  });
  repo.updateEvent(event.id, {
    warning_role_id: role.id,
    temp_role_delete_after: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  });
  for (const participant of repo.listParticipants(event.id)) {
    await addEventRoleToMember(guild, { ...event, warning_role_id: role.id }, participant.discord_id).catch(() => {});
  }
  return role;
}

async function addEventRoleToMember(guild, event, discordId) {
  if (!event?.warning_role_id) return;
  const member = await guild.members.fetch(discordId).catch(() => null);
  await member?.roles.add(event.warning_role_id, `Participante do evento ${event.event_code}`).catch(() => {});
}

async function removeEventRoleFromMember(guild, event, discordId) {
  if (!event?.warning_role_id) return;
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (member?.roles?.remove) {
    await member.roles.remove(event.warning_role_id, `Saiu do evento ${event.event_code}`).catch(() => {});
  }
}

async function sendEventReminder(client, event, phase) {
  const missingSlots = eventMissingSlots(event);
  let dispatchCount = 0;
  const destinations = reminderDestinations(event, phase);

  for (const destination of destinations) {
    if (repo.hasReminderDispatch({ eventId: event.id, phase, channelId: destination.channelId })) continue;
    const channel = await client.channels.fetch(destination.channelId).catch(() => null);
    const message = await channel?.send(eventReminderPayload(event, phase, {
      missingSlots, roleIds: destination.roleIds
    })).catch((error) => {
      console.error(`Falha ao enviar lembrete ${event.event_code} em ${destination.channelId}:`, error);
      return null;
    });
    if (!message) continue;
    repo.markReminderDispatch({
      eventId: event.id,
      phase,
      channelId: destination.channelId,
      messageId: message.id
    });
    dispatchCount += 1;
    if (destination.channelId === ids.channels.notagChat) {
      repo.updateEvent(event.id, { warning_message_id: message.id, warning_sent: 1 });
    }
    scheduleReminderDeletion(client, event.id, destination.channelId, message.id);
  }

  dispatchCount += await sendSubscriberDms(client, event, phase, missingSlots);
  if (phase === '10') repo.updateEvent(event.id, { reminder_10_sent: 1 });
  if (phase === '0') repo.updateEvent(event.id, { reminder_start_sent: 1 });
  if (dispatchCount > 0) {
    audit.createAuditLog({
      type: 'event_start_warning_sent',
      targetId: String(event.id),
      afterValue: phase,
      reason: `${event.event_code}: ${phase} minuto(s); ${dispatchCount} envio(s)`
    });
  }
  return dispatchCount;
}

function eventReminderPayload(event, phase, options = {}) {
  const publicationUrl = event.message_channel_id && event.message_id
    ? `https://discord.com/channels/${ids.guildId}/${event.message_channel_id}/${event.message_id}`
    : null;
  const roleIds = options.roleIds || [];
  const mentions = roleIds.map((roleId) => `<@&${roleId}>`).join(' ');
  const missingSlots = options.missingSlots || eventMissingSlots(event);
  const title = String(event.title || 'EVENTO').toLocaleUpperCase('pt-BR');
  const availability = missingSlots.length
    ? `🧩 **${formatMissingSlots(missingSlots)}**`
    : '✅ **Composição completa**';
  const summary = [
    event.location ? `📍 **${event.location}**` : null,
    availability
  ].filter(Boolean).join(' · ');
  const action = [
    `🔊 <#${ids.channels.waitingVoice}>`,
    publicationUrl ? `[Abrir evento](${publicationUrl})` : null
  ].filter(Boolean).join(' · ');
  return {
    content: [
      [mentions || null, reminderHeading(phase, title)].filter(Boolean).join(' '),
      summary,
      action
    ].filter(Boolean).join('\n'),
    allowedMentions: { parse: [], roles: roleIds }
  };
}

function reminderHeading(phase, title) {
  if (String(phase) === '0') return `🚀 **AGORA · ${title}**`;
  return `⏰ **${phase} MIN · ${title}**`;
}

function reminderDestinations(event, phase) {
  if (event.audience === 'staff') return [];
  const destinations = [{
    channelId: ids.channels.notagChat,
    roleIds: phase === '15' ? [ids.roles.core, ids.roles.member].filter(Boolean) : []
  }];
  if (event.audience !== 'member') {
    destinations.push({
      channelId: ids.channels.inactivityNotice,
      roleIds: phase === '15' ? [ids.roles.guest].filter(Boolean) : []
    });
  }
  return destinations;
}

function eventMissingSlots(event) {
  if (repo.getWorldBossEventMeta(event.id)) {
    const occupied = new Set(repo.listWorldBossAssignments(event.id).map((assignment) => assignment.slot_key));
    return Object.entries(worldBossSlotLabels)
      .filter(([slotKey]) => !occupied.has(slotKey))
      .map(([, label]) => label);
  }

  const participants = repo.listParticipants(event.id)
    .filter((participant) => !participant.is_spectator && !participant.is_paused);
  const customSlots = repo.getCustomEventMeta(event.id) || repo.getVisualEventBuildMeta(event.id)
    ? repo.listCustomEventSlots(event.id)
    : [];
  if (customSlots.length) return customMissingSlots(customSlots, participants);

  return Object.entries(roleLabels).flatMap(([role, label]) => {
    const capacity = Number(event[`${role}_slots`] || 0);
    const occupied = participants.filter((participant) => participant.role === role).length;
    const missing = Math.max(0, capacity - occupied);
    return missing ? [`${missing} ${label}`] : [];
  });
}

function customMissingSlots(slots, participants) {
  const occupied = new Set();
  const unassignedByRole = new Map(Object.keys(roleLabels).map((role) => [role, []]));
  for (const participant of participants) {
    if (participant.custom_slot_index != null) {
      occupied.add(`${participant.role}:${participant.custom_slot_index}`);
    } else if (unassignedByRole.has(participant.role)) {
      unassignedByRole.get(participant.role).push(participant);
    }
  }
  for (const role of Object.keys(roleLabels)) {
    const available = slots.filter((slot) => slot.role === role && !occupied.has(`${role}:${slot.slot_index}`));
    unassignedByRole.get(role).slice(0, available.length).forEach((_, index) => {
      occupied.add(`${role}:${available[index].slot_index}`);
    });
  }
  return slots
    .filter((slot) => !occupied.has(`${slot.role}:${slot.slot_index}`))
    .map((slot) => slot.slot_label || `${roleLabels[slot.role] || slot.role} ${slot.slot_index}`);
}

function formatMissingSlots(slots) {
  const visible = slots.slice(0, 12);
  const hidden = slots.length - visible.length;
  return `${visible.join(', ')}${hidden > 0 ? ` e mais ${hidden}` : ''}`;
}

function eventNotificationType(event) {
  if (repo.getWorldBossEventMeta(event.id)) return 'world_boss';
  if (repo.getRaidAvalonEventMeta(event.id)) return 'raid_full';
  if (repo.getCustomEventMeta(event.id)) return 'cta';
  return 'common';
}

async function sendSubscriberDms(client, event, phase, missingSlots) {
  const subscribers = notificationPreferences.listSubscribers(eventNotificationType(event), phase);
  const registeredIds = new Set(
    repo.listParticipants(event.id)
      .filter((participant) => !participant.is_spectator && !participant.is_paused)
      .map((participant) => participant.discord_id)
  );
  let attempts = 0;
  for (const subscriber of subscribers) {
    if (!registeredIds.has(subscriber.discord_id)) continue;
    if (notificationPreferences.wasDmSent({ eventId: event.id, phase, discordId: subscriber.discord_id })) continue;
    if (!await subscriberCanAccessEvent(client, event, subscriber.discord_id)) {
      notificationPreferences.markDmSent({ eventId: event.id, phase, discordId: subscriber.discord_id });
      continue;
    }
    const user = await client.users.fetch(subscriber.discord_id).catch(() => null);
    if (user) await user.send(eventReminderPayload(event, phase, { missingSlots, roleIds: [] })).catch(() => null);
    notificationPreferences.markDmSent({ eventId: event.id, phase, discordId: subscriber.discord_id });
    attempts += 1;
  }
  return attempts;
}

async function subscriberCanAccessEvent(client, event, discordId) {
  if (!event.audience || event.audience === 'public') return true;
  const guild = await client.guilds?.fetch?.(ids.guildId)?.catch(() => null);
  const member = await guild?.members?.fetch?.(discordId)?.catch(() => null);
  if (!member) return false;
  const has = (roleId) => Boolean(
    roleId && (
      member.roles?.cache?.has?.(roleId)
      || member.roles?.includes?.(roleId)
      || member._roles?.includes?.(roleId)
    )
  );
  if (event.audience === 'staff') return [ids.roles.adm, ids.roles.staff].some(has);
  return [ids.roles.adm, ids.roles.staff, ids.roles.core, ids.roles.member].some(has);
}

async function deleteWarningMessage(client, event) {
  if (!event?.warning_message_id) return;
  for (const channelId of [ids.channels.notagChat, ids.channels.participate].filter(Boolean)) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    const message = await channel?.messages.fetch(event.warning_message_id).catch(() => null);
    if (message) {
      await message.delete().catch(() => {});
      break;
    }
  }
  repo.updateEvent(event.id, { warning_message_id: null });
}

function scheduleReminderDeletion(client, eventId, channelId, messageId) {
  const timer = setTimeout(async () => {
    const event = repo.getEvent(eventId);
    if (!event) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    const message = await channel?.messages.fetch(messageId).catch(() => null);
    await message?.delete().catch(() => {});
    const current = repo.getEvent(eventId);
    if (current?.warning_message_id === messageId) repo.updateEvent(eventId, { warning_message_id: null });
  }, EVENT_REMINDER_DELETE_AFTER_MS);
  timer.unref?.();
}

async function removeWarningRole(guild, event) {
  if (!event?.warning_role_id) return;
  const role = await guild.roles.fetch(event.warning_role_id).catch(() => null);
  if (role) await role.delete(`Removendo cargo temporario do evento ${event.event_code}`);
  repo.updateEvent(event.id, { warning_role_id: null, temp_role_delete_after: null });
}

function parseAlbionEventTime(value, now = new Date()) {
  const text = String(value || '').trim();
  const textWithoutDate = text.replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/, ' ');
  const match = textWithoutDate.match(/\b(\d{1,2}):(\d{2})\b/)
    || textWithoutDate.match(/\b(\d{1,2})h\b/i)
    || textWithoutDate.match(/\b(\d{1,2})\b/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const dateMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let day = now.getUTCDate();
  if (dateMatch) {
    day = Number(dateMatch[1]);
    month = Number(dateMatch[2]) - 1;
    if (dateMatch[3]) {
      year = Number(dateMatch[3]);
      if (year < 100) year += 2000;
    }
  }
  const start = new Date(Date.UTC(year, month, day, hour, minute, 0));
  if (!dateMatch && hour <= 3 && now.getUTCHours() > 6) start.setUTCDate(start.getUTCDate() + 1);
  return start;
}

function eventTempRoleName(event) {
  const start = parseAlbionEventTime(event.scheduled_time) || new Date();
  const day = String(start.getUTCDate()).padStart(2, '0');
  const month = String(start.getUTCMonth() + 1).padStart(2, '0');
  const hour = String(start.getUTCHours()).padStart(2, '0');
  return `${day}${month}as${hour}h`;
}

module.exports = {
  addEventRoleToMember,
  checkEventStartWarnings,
  cleanupExpiredEventTempRoles,
  deleteWarningMessage,
  ensureEventTempRole,
  eventReminderPayload,
  eventMissingSlots,
  eventNotificationType,
  eventTempRoleName,
  dueReminderPhase,
  reminderDestinations,
  parseAlbionEventTime,
  removeEventRoleFromMember,
  removeWarningRole,
  sendEventReminder
};
