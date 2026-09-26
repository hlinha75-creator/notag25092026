const ids = require('../config/ids');
const accountLinks = require('../modules/accounts/accountLinks.service');
const events = require('../modules/events/events.service');
const eventsRepo = require('../modules/events/events.repository');

const MAX_PARTICIPANTS = 20;
const STANDARD_ROLES = new Set(['tank', 'healer', 'support', 'dps']);

function actionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function specialSignupMode(eventId) {
  if (eventsRepo.getWorldBossEventMeta(eventId)) return 'world_boss';
  if (eventsRepo.getRaidAvalonEventMeta(eventId)) return 'raid_avalon';
  if (eventsRepo.getCustomEventMeta(eventId) || eventsRepo.getVisualEventBuildMeta(eventId)) return 'custom';
  return 'standard';
}

function linkedParticipant(eventId, discordId) {
  const linkedIds = accountLinks.linkInfo(discordId).linkedIds;
  return eventsRepo.listParticipants(eventId).find((participant) => linkedIds.includes(participant.discord_id)) || null;
}

async function interactionFor(client, discordId) {
  const guild = client.guilds.cache?.get(ids.guildId) || await client.guilds.fetch(ids.guildId);
  const member = guild.members.cache?.get(discordId) || await guild.members.fetch(discordId).catch(() => null);
  if (!member) throw actionError('Você precisa estar no Discord da Notag.', 403);
  return { client, guild, member, user: { id: discordId } };
}

async function changePortalParticipation(client, { discordId, accessLevel = 'guest', privileged = false, eventId, action, role, slotIndex, weaponKey }) {
  const numericEventId = Number(eventId);
  if (!Number.isInteger(numericEventId) || numericEventId <= 0) throw actionError('Evento inválido.');

  const event = eventsRepo.getEvent(numericEventId);
  const audience = event?.audience || 'public';
  if ((audience === 'staff' && !privileged) || (audience === 'member' && accessLevel !== 'member')) {
    throw actionError('Voce nao tem acesso a este evento.', 403);
  }
  if (!event || !['created', 'running'].includes(event.status)) throw actionError('Esse evento não está aberto.');

  const existingLinked = linkedParticipant(numericEventId, discordId);
  if (existingLinked && existingLinked.discord_id !== discordId) {
    throw actionError('Uma conta Discord vinculada a você já está inscrita neste evento.', 409);
  }

  const interaction = await interactionFor(client, discordId);
  if (action === 'spectate') {
    await events.spectateEvent(interaction, numericEventId);
    return {
      action: 'spectator',
      message: event.status === 'running'
        ? 'Você entrou como espectador. Se estiver em outra chamada de voz, o bot tentará movê-lo para o evento.'
        : 'Você está inscrito como espectador. Espectadores não recebem parte do loot.'
    };
  }

  if (action !== 'join') throw actionError('Ação de evento inválida.');
  if (!STANDARD_ROLES.has(role)) throw actionError('Escolha uma função válida.');

  const participants = eventsRepo.listParticipants(numericEventId);
  const current = participants.find((participant) => participant.discord_id === discordId);
  const activeCount = participants.filter((participant) => !participant.is_spectator && !participant.is_paused).length;
  if ((!current || current.is_spectator) && activeCount >= MAX_PARTICIPANTS) {
    await events.spectateEvent(interaction, numericEventId);
    return {
      action: 'spectator',
      automatic: true,
      message: 'As 20 vagas de participante estão ocupadas. Você entrou automaticamente como espectador.'
    };
  }

  const signupMode = specialSignupMode(numericEventId);
  if (signupMode === 'custom') {
    if (role === 'dps' && weaponKey && eventsRepo.listCustomEventDpsWeapons(numericEventId).length > 0) {
      const weapon = await events.joinCustomEventDpsWeapon(interaction, numericEventId, weaponKey);
      return {
        action: 'participant',
        role,
        weaponKey,
        slotLabel: weapon.weapon_label,
        message: event.status === 'running'
          ? 'Arma de DPS atualizada. Se estiver em outra chamada, o bot tentará movê-lo para o evento.'
          : `DPS confirmado com ${weapon.weapon_label}. Você pode trocar enquanto houver estoque.`
      };
    }
    const numericSlotIndex = Number(slotIndex);
    if (!Number.isInteger(numericSlotIndex) || numericSlotIndex <= 0) {
      throw actionError('Escolha uma vaga válida.');
    }
    const slot = await events.joinCustomEventSlot(interaction, numericEventId, role, numericSlotIndex);
    return {
      action: 'participant',
      role,
      slotIndex: numericSlotIndex,
      slotLabel: slot.slot_label || null,
      message: event.status === 'running'
        ? 'Vaga atualizada. Se estiver em outra chamada de voz, o bot tentará movê-lo para o evento.'
        : 'Vaga confirmada. Você pode trocar de função enquanto houver vaga.'
    };
  }
  if (signupMode !== 'standard') {
    throw actionError('Este evento possui uma composição especial que ainda deve ser escolhida pelo painel do Discord.', 409);
  }

  await events.joinEvent(interaction, numericEventId, role);
  return {
    action: 'participant',
    role,
    message: event.status === 'running'
      ? 'Participação atualizada. Se estiver em outra chamada de voz, o bot tentará movê-lo para o evento.'
      : 'Participação confirmada. Você pode trocar de função enquanto houver vaga.'
  };
}

module.exports = { MAX_PARTICIPANTS, changePortalParticipation, specialSignupMode };
