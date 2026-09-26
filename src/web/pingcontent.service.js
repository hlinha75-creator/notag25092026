const ids = require('../config/ids');
const events = require('../modules/events/events.service');
const eventsRepo = require('../modules/events/events.repository');
const { normalizeCtaDateTime } = require('../modules/events/customEventWizard.service');
const { families, familyRuleForRole, findWeapon, roleRules } = require('../modules/events/weaponCatalog');
const { publicationForAudience } = require('./staff-events.service');
const { cloneDefaultDpsWeaponPool, normalizeDpsWeaponPool, normalizeDpsWeaponPolicy } = require('../modules/events/dpsWeaponPool');
const sponsoredCtaBuilds = require('../modules/events/sponsoredCtaBuilds.service');
const { eventTypes, normalizeEventType } = require('../modules/events/eventTypes');
const compositionRules = require('../modules/events/compositionRules');

const ROLES = ['tank', 'healer', 'support', 'dps'];
const QUALITIES = new Set(['Normal', 'Bom', 'Notável', 'Excelente', 'Obra-prima']);
const MAX_SLOTS = 20;

function actionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function clean(value, max = 200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function integer(value, label, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw actionError(`${label} deve estar entre ${min} e ${max}.`);
  }
  return parsed;
}

function optionalHttpUrl(value) {
  const raw = clean(value, 400);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    return parsed.toString();
  } catch {
    throw actionError('O link da build precisa começar com http:// ou https://.');
  }
}

function parseSlots(value) {
  let slots;
  try {
    slots = JSON.parse(String(value || '[]'));
  } catch {
    throw actionError('A composição enviada pelo navegador é inválida. Atualize a página e tente novamente.');
  }
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > MAX_SLOTS) {
    throw actionError(`A composição precisa ter entre 1 e ${MAX_SLOTS} vagas.`);
  }
  const seen = new Set();
  return slots.map((slot) => {
    const role = clean(slot.role, 20);
    const index = Number(slot.index);
    if (!ROLES.includes(role) || !Number.isInteger(index) || index < 1 || index > MAX_SLOTS) {
      throw actionError('Existe uma vaga inválida na composição.');
    }
    const position = `${role}:${index}`;
    if (seen.has(position)) throw actionError('A composição contém vagas repetidas.');
    seen.add(position);
    const weapon = role === 'dps' ? null : findWeapon(clean(slot.itemId, 100));
    if (role !== 'dps' && !weapon) throw actionError(`Escolha uma arma válida para ${role} ${index}.`);
    if (weapon && !familyRuleForRole(role, weapon.familyKey).allowed) {
      throw actionError(`${weapon.familyLabel} não está disponível para ${role}.`);
    }
    return {
      role,
      index,
      weapon,
      note: clean(slot.note, 60),
      buildUrl: optionalHttpUrl(slot.buildUrl)
    };
  });
}

function validateVisualEventInput(input) {
  const contentType = normalizeEventType(input.contentType);
  const title = clean(input.title, 80);
  const location = clean(input.location, 100);
  if (!title) throw actionError('Informe o nome do evento.');
  if (!location) throw actionError('Informe o local do evento.');
  const audience = clean(input.audience, 20) || 'member';
  if (!['public', 'member', 'staff'].includes(audience)) throw actionError('Escolha um público válido.');
  const tier = integer(input.tier, 'O tier', 4, 8);
  const enchantment = integer(input.enchantment, 'O encantamento', 0, 4);
  const itemPower = integer(input.itemPower || 0, 'O IP mínimo', 0, 3000);
  const quality = clean(input.quality, 30) || 'Excelente';
  if (!QUALITIES.has(quality)) throw actionError('Escolha uma qualidade válida.');
  const slots = parseSlots(input.slots);
  const counts = Object.fromEntries(ROLES.map((role) => [role, slots.filter((slot) => slot.role === role).length]));
  let dpsPolicy;
  try {
    dpsPolicy = normalizeDpsWeaponPolicy(input.dpsPolicy);
  } catch (error) {
    throw actionError(error.message);
  }
  let rawDpsPool;
  try {
    rawDpsPool = JSON.parse(String(input.dpsPool || '[]'));
  } catch {
    throw actionError('O cardápio de DPS enviado pelo navegador é inválido.');
  }
  let dpsPool;
  try {
    dpsPool = normalizeDpsWeaponPool(rawDpsPool, counts.dps, { policy: dpsPolicy });
  } catch (error) {
    throw actionError(error.message);
  }
  for (const role of ROLES) {
    const indexes = slots.filter((slot) => slot.role === role).map((slot) => slot.index).sort((a, b) => a - b);
    if (indexes.some((index, position) => index !== position + 1)) {
      throw actionError(`As vagas de ${role} precisam estar em ordem contínua.`);
    }
  }
  const scheduledTime = normalizeCtaDateTime(input.scheduledTime);
  const requirementParts = [`T${tier}.${enchantment}`, quality];
  if (itemPower) requirementParts.push(`${itemPower} IP mínimo`);
  const description = [clean(input.description, 350), `Requisitos: ${requirementParts.join(' · ')}`].filter(Boolean).join(' | ');
  return {
    contentType,
    title,
    location,
    audience,
    scheduledTime,
    tier,
    enchantment,
    itemPower,
    quality,
    description,
    lootRules: clean(input.lootRules, 500),
    consumables: clean(input.consumables, 500),
    mount: clean(input.mount, 200),
    counts,
    slots,
    dpsPool,
    dpsPolicy
  };
}

async function actorContext(client, actorId) {
  const guild = client.guilds.cache?.get(ids.guildId) || await client.guilds.fetch(ids.guildId);
  const member = guild.members.cache?.get(actorId) || await guild.members.fetch(actorId).catch(() => null);
  if (!member) throw actionError('Membro da staff não encontrado no Discord.', 403);
  return { guild, member, interaction: { client, guild, member, user: { id: actorId } } };
}

function slotLabel(slot, fields) {
  const requirement = `T${fields.tier}.${fields.enchantment}`;
  return [requirement, slot.weapon.name, slot.note].filter(Boolean).join(' · ').slice(0, 80);
}

async function createStaffVisualEvent(client, input) {
  const fields = validateVisualEventInput(input);
  const context = await actorContext(client, input.actorId);
  const publication = publicationForAudience(fields.audience);
  const forumBuilds = await sponsoredCtaBuilds.loadCatalog(client, context.guild);
  const poolBuilds = sponsoredCtaBuilds.attachGuildEmojis(fields.dpsPool.map((weapon) => ({
    key: weapon.weaponKey,
    name: weapon.label,
    role: 'dps',
    iconUrl: weapon.imageUrl
  })), context.guild);
  const emojisByName = new Map([...forumBuilds, ...poolBuilds].map((build) => [normalizeName(build.name), build]));
  fields.dpsPool = fields.dpsPool.map((weapon) => {
    const build = emojisByName.get(normalizeName(weapon.label));
    return { ...weapon, emojiName: build?.emojiName || null, emojiId: build?.emojiId || null, buildUrl: build?.buildUrl || weapon.buildUrl || null };
  });
  const event = await events.createEventFromFields(context.interaction, {
    creatorId: input.actorId,
    title: fields.title,
    description: fields.description,
    location: fields.location,
    scheduledTime: fields.scheduledTime,
    tankSlots: fields.counts.tank,
    healerSlots: fields.counts.healer,
    supportSlots: fields.counts.support,
    dpsSlots: fields.counts.dps,
    contentType: fields.contentType,
    audience: fields.audience,
    postChannelId: publication.channelId,
    messageContent: publication.content,
    allowedMentions: publication.allowedMentions
  });
  eventsRepo.createCustomEventMeta({
    eventId: event.id,
    eventDay: fields.scheduledTime.split(' ')[0],
    timeRange: fields.scheduledTime.split(' ').slice(1).join(' '),
    lootRules: fields.lootRules,
    consumables: fields.consumables,
    mountRequirement: fields.mount,
    slots: fields.slots.filter((slot) => slot.role !== 'dps' || fields.dpsPolicy === 'role_free').map((slot) => ({
      role: slot.role,
      index: slot.index,
      value: slot.weapon ? slotLabel(slot, fields) : '',
      buildKey: slot.weapon?.itemId || null,
      buildUrl: slot.buildUrl || null
    })),
    dpsPool: fields.dpsPool,
    dpsPolicy: fields.dpsPolicy
  });
  if (['sheet_limited', 'weapon_declared'].includes(fields.dpsPolicy)) {
    eventsRepo.createVisualEventBuildMeta({
      eventId: event.id,
      buildsChannelId: ids.channels.outpostBuilds,
      buildsChannelName: null,
      slots: fields.slots.map((slot) => ({
        role: slot.role,
        index: slot.index,
        value: slot.weapon ? slotLabel(slot, fields) : '',
        buildKey: slot.weapon?.itemId || null,
        buildUrl: slot.buildUrl || null
      })),
      compositionMode: fields.dpsPolicy,
      rulesSnapshot: await compositionRules.loadSnapshot(fields.contentType),
      sheetUrl: compositionRules.COMPOSITION_SHEET_URL
    });
  }
  await events.syncEventPublication(client, event.id, publication);
  return {
    event: eventsRepo.getEvent(event.id),
    message: `${event.event_code} criado com ${fields.slots.length} vagas e publicado no Discord.`
  };
}

function lastConfiguration(actorId) {
  const previous = eventsRepo.getLastCustomEventConfiguration(actorId);
  if (!previous) return null;
  const requirement = String(previous.description || '').match(/Requisitos:\s*T(\d)\.(\d)\s*·\s*([^|·]+)(?:\s*·\s*(\d+) IP mínimo)?/i);
  return {
    contentType: previous.content_type,
    title: previous.title,
    description: String(previous.description || '').split(/\s*\|\s*Requisitos:/i)[0],
    location: previous.location,
    scheduledTime: previous.scheduled_time,
    audience: previous.audience,
    lootRules: previous.loot_rules,
    consumables: previous.consumables,
    mount: previous.mount_requirement,
    dpsPolicy: previous.dps_policy || 'caller',
    tier: Number(requirement?.[1] || 8),
    enchantment: Number(requirement?.[2] || 1),
    quality: clean(requirement?.[3], 30) || 'Excelente',
    itemPower: Number(requirement?.[4] || 1300),
    counts: {
      tank: Number(previous.tank_slots || 0),
      healer: Number(previous.healer_slots || 0),
      support: Number(previous.support_slots || 0),
      dps: Number(previous.dps_slots || 0)
    },
    slots: previous.slots.map((slot) => ({
      role: slot.role,
      index: slot.slot_index,
      itemId: findWeapon(slot.build_key) ? slot.build_key : null,
      buildUrl: slot.build_url || '',
      note: ''
    })),
    dpsPool: previous.dpsPool?.length ? previous.dpsPool.map((weapon) => ({
      weaponKey: weapon.weapon_key,
      maxQuantity: weapon.max_quantity,
      mandatory: Boolean(weapon.mandatory),
      enabled: true
    })) : cloneDefaultDpsWeaponPool()
  };
}

function normalizeName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function pingContentBootstrap(actorId) {
  return {
    catalog: families,
    roleRules,
    defaultDpsPool: cloneDefaultDpsWeaponPool(),
    eventTypes,
    lastConfiguration: lastConfiguration(actorId),
    savedConfigurations: eventsRepo.listAllSavedEventConfigurations(actorId).map((row) => ({
      id: row.id,
      name: row.name,
      contentType: row.content_type,
      configuration: eventsRepo.getSavedEventConfiguration(actorId, row.id)
    })),
    limits: { maxSlots: MAX_SLOTS }
  };
}

function savePublishedConfiguration(actorId, eventId, name) {
  const event = eventsRepo.getEvent(Number(eventId));
  if (!event || String(event.creator_id) !== String(actorId)) throw actionError('Evento não disponível para salvar.', 404);
  return eventsRepo.saveEventConfiguration({ creatorId: actorId, eventId: event.id, kind: 'custom', contentType: event.content_type, name });
}

function deletePublishedConfiguration(actorId, templateId) {
  if (!eventsRepo.deleteSavedEventConfiguration(actorId, templateId)) throw actionError('Configuração não encontrada.', 404);
  return { deleted: true };
}

module.exports = { createStaffVisualEvent, deletePublishedConfiguration, pingContentBootstrap, savePublishedConfiguration, validateVisualEventInput };
