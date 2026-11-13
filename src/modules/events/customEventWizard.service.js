const { randomUUID } = require('node:crypto');
const weaponCatalog = require('./customEventWeaponCatalog.service');
const dpsWeapons = require('./dpsWeaponPool');
const eventTypes = require('./eventTypes');
const compositionRules = require('./compositionRules');
const weaponSelectionModes = require('./weaponSelectionModes');

const drafts = new Map();
const roleOrder = ['tank', 'healer', 'support', 'dps'];
const roleLabels = {
  tank: 'Tank',
  healer: 'Healer',
  support: 'Suporte',
  dps: 'DPS'
};
const fieldsPerPage = 5;
const maxSlots = 40;

function createDraft({ creatorId, title, scheduledTime, location, timeRange, day, description, composition, contentType = 'cta', template = null }) {
  const slots = parseComposition(composition);
  const id = randomUUID().replaceAll('-', '').slice(0, 12);
  const normalizedScheduledTime = normalizeCtaDateTime(scheduledTime || `${day || ''} ${timeRange || ''}`);
  const draft = {
    id,
    creatorId,
    contentType,
    title: clean(title, 100),
    scheduledTime: normalizedScheduledTime,
    location: clean(location, 100),
    timeRange: normalizedScheduledTime.split(' ').slice(-2).join(' '),
    day: normalizedScheduledTime.split(' ')[0],
    description: clean(description, 1000),
    compositionMode: weaponSelectionModes.normalize(template?.compositionMode ?? template?.composition_mode ?? 'predefined'),
    rulesSnapshot: compositionRules.snapshot(contentType),
    dpsPolicy: dpsWeapons.normalizeDpsWeaponPolicy(template?.dpsPolicy ?? template?.dps_policy ?? 'caller'),
    composition: slots,
    lootRules: clean(template?.lootRules, 1000),
    consumables: clean(template?.consumables, 1000),
    mount: clean(template?.mount, 200),
    catalog: [],
    slotDefinitions: buildSlotDefinitions(slots, template?.slots, { includeDps: eventTypes.usesVisualComposition(contentType) }),
    dpsPool: dpsWeapons.normalizeDpsWeaponPool(template?.dpsPool, slots.dps, {
      policy: template?.dpsPolicy ?? template?.dps_policy ?? 'caller'
    }),
    buildsChannelId: template?.buildsChannelId ?? template?.builds_channel_id ?? null,
    buildsChannelName: template?.buildsChannelName ?? template?.builds_channel_name ?? null,
    reviewedManualBuildKeys: [],
    createdAt: Date.now()
  };
  const eventLabel = contentType === 'cta' ? 'CTA' : eventTypes.eventTypeLabel(contentType);
  if (!draft.title) throw new Error(`Informe o titulo da ${eventLabel}.`);
  if (!draft.location) throw new Error(`Informe o local da ${eventLabel}. Ex: Portal de Bridgewatch.`);
  drafts.set(id, draft);
  return draft;
}

function normalizeCtaDateTime(value, now = new Date()) {
  const raw = clean(value, 80);
  const timeOnly = raw.match(/^(\d{1,2}):(\d{2})(?:\s+UTC)?$/i);
  if (timeOnly) {
    const hour = Number(timeOnly[1]);
    const minute = Number(timeOnly[2]);
    if (hour > 23 || minute > 59) throw new Error('Data ou hora invalida. Use o horario UTC.');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const year = now.getUTCFullYear();
    return `${day}/${month}/${year} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} UTC`;
  }
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?\s+(\d{1,2}):(\d{2})(?:\s+UTC)?$/i);
  if (!match) {
    throw new Error('Informe o horario UTC. Ex: 21:00, 25/08 22:00 ou 25/08/2026 22:00.');
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3] || now.getUTCFullYear());
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    year < 2000
    || year > 9999
    || hour > 23
    || minute > 59
    || instant.getUTCFullYear() !== year
    || instant.getUTCMonth() !== month - 1
    || instant.getUTCDate() !== day
  ) {
    throw new Error('Data ou hora invalida. Use o horario UTC.');
  }
  const date = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}${match[3] ? `/${year}` : ''}`;
  return `${date} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} UTC`;
}

function parseComposition(value) {
  const numbers = String(value || '').match(/\d+/g) || [];
  if (numbers.length !== 4) {
    throw new Error('Use 4 numeros na composicao: Tank, Healer, Suporte, DPS. Ex: 2,2,2,14.');
  }
  const slots = Object.fromEntries(roleOrder.map((role, index) => [role, Number.parseInt(numbers[index], 10)]));
  const values = Object.values(slots);
  if (values.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error('A composicao deve usar somente quantidades inteiras maiores ou iguais a zero.');
  }
  const total = values.reduce((sum, count) => sum + count, 0);
  if (total < 1) throw new Error('A composicao precisa liberar pelo menos uma vaga.');
  if (total > maxSlots) throw new Error(`A composicao do CTA aceita no maximo ${maxSlots} vagas.`);
  return slots;
}

function buildSlotDefinitions(composition, templateSlots = [], options = {}) {
  const savedSlots = new Map((templateSlots || []).map((slot) => [`${slot.role}:${slot.index ?? slot.slot_index}`, slot]));
  return roleOrder.filter((role) => options.includeDps || role !== 'dps').flatMap((role) => (
    Array.from({ length: composition[role] }, (_, index) => {
      const position = index + 1;
      const saved = savedSlots.get(`${role}:${position}`);
      return {
        role,
        index: position,
        fieldLabel: `${roleLabels[role]} ${position}`,
        value: clean(saved?.value ?? saved?.slot_label, 80),
        buildKey: saved?.buildKey ?? saved?.build_key ?? null,
        buildUrl: saved?.buildUrl ?? saved?.build_url ?? null,
        emojiName: saved?.emojiName ?? saved?.emoji_name ?? null,
        emojiId: saved?.emojiId ?? saved?.emoji_id ?? null
      };
    })
  ));
}

function getDraft(id, creatorId = null) {
  const draft = drafts.get(String(id));
  if (!draft) throw new Error('Rascunho de evento expirado ou nao encontrado. Comece novamente.');
  if (creatorId && draft.creatorId !== creatorId) throw new Error('Somente quem iniciou este evento pode continuar.');
  return draft;
}

function saveDetails({ id, creatorId, lootRules, consumables, mount, dpsPoolText = null }) {
  const draft = getDraft(id, creatorId);
  draft.lootRules = clean(lootRules, 1000);
  draft.consumables = clean(consumables, 1000);
  draft.mount = clean(mount, 200);
  if (draft.composition.dps > 0) {
    draft.dpsPool = dpsPoolText == null
      ? dpsWeapons.normalizeDpsWeaponPool(draft.dpsPool, draft.composition.dps, { policy: draft.dpsPolicy })
      : dpsWeapons.parseDpsPoolTextForPolicy(
          dpsPoolText,
          draft.composition.dps,
          draft.dpsPolicy
        );
    applyRulesToDpsPool(draft);
  }
  return draft;
}

function setRulesSnapshot({ id, creatorId, rulesSnapshot }) {
  const draft = getDraft(id, creatorId);
  draft.rulesSnapshot = rulesSnapshot || compositionRules.snapshot(draft.contentType);
  applyRulesToDpsPool(draft);
  return draft;
}

function applyRulesToDpsPool(draft) {
  if (draft.contentType !== 'cta' || ['role_free', 'weapon_declared'].includes(draft.dpsPolicy)) return draft;
  draft.dpsPool = draft.dpsPool.map((weapon) => {
    const constraint = compositionRules.ruleFor(draft.rulesSnapshot, weapon.weaponKey);
    return {
      ...weapon,
      mandatory: Number(constraint.min || 0) > 0,
      maxQuantity: constraint.max == null && draft.dpsPolicy === 'free'
        ? draft.composition.dps
        : constraint.max ?? weapon.maxQuantity
    };
  });
  return draft;
}

function setDpsPolicy({ id, creatorId, policy }) {
  const draft = getDraft(id, creatorId);
  draft.dpsPolicy = dpsWeapons.normalizeDpsWeaponPolicy(policy);
  draft.dpsPool = dpsWeapons.normalizeDpsWeaponPool(draft.dpsPool, draft.composition.dps, {
    policy: draft.dpsPolicy
  });
  return draft;
}

function setCompositionMode({ id, creatorId, mode }) {
  const draft = getDraft(id, creatorId);
  draft.compositionMode = weaponSelectionModes.normalize(mode);
  if (draft.compositionMode !== 'predefined') {
    for (const slot of draft.slotDefinitions) {
      Object.assign(slot, { value: '', buildKey: null, buildUrl: null, emojiName: null, emojiId: null });
    }
  }
  return draft;
}

function pageCount(draftOrId) {
  const draft = typeof draftOrId === 'string' ? getDraft(draftOrId) : draftOrId;
  return Math.ceil(draft.slotDefinitions.length / fieldsPerPage);
}

function slotPage({ id, creatorId, page }) {
  const draft = getDraft(id, creatorId);
  const pageIndex = parsePage(page, pageCount(draft));
  const start = pageIndex * fieldsPerPage;
  return {
    draft,
    page: pageIndex,
    totalPages: pageCount(draft),
    slots: draft.slotDefinitions.slice(start, start + fieldsPerPage)
  };
}

function saveSlotPage({ id, creatorId, page, values }) {
  const result = slotPage({ id, creatorId, page });
  const start = result.page * fieldsPerPage;
  result.slots.forEach((slot, index) => {
    result.draft.slotDefinitions[start + index].value = clean(values[index], 80);
  });
  return result;
}

function setCatalog({ id, creatorId, builds }) {
  const draft = getDraft(id, creatorId);
  draft.catalog = Array.isArray(builds) ? builds.map((build) => ({ ...build })) : [];
  for (const role of roleOrder) {
    if (draft.composition[role] > 0 && !draft.catalog.some((build) => weaponCatalog.allowedForRole(build, role))) {
      throw new Error(`Nao encontrei builds de ${roleLabels[role]} no canal configurado.`);
    }
  }
  for (const slot of draft.slotDefinitions) {
    if (!slot.buildKey) continue;
    const current = draft.catalog.find((build) => build.key === slot.buildKey && weaponCatalog.allowedForRole(build, slot.role));
    if (!current) {
      Object.assign(slot, { value: '', buildKey: null, buildUrl: null, emojiName: null, emojiId: null });
      continue;
    }
    const emojiId = current.emojiId || slot.emojiId || null;
    const emojiName = current.emojiId
      ? current.emojiName
      : slot.emojiId
        ? slot.emojiName
        : current.familySymbol || current.emojiName || null;
    Object.assign(slot, {
      value: current.name,
      buildKey: current.key,
      buildUrl: current.buildUrl || slot.buildUrl || null,
      emojiName,
      emojiId
    });
  }
  const buildsByName = new Map(draft.catalog.map((build) => [normalizeName(build.name), build]));
  const buildsByKey = new Map(draft.catalog.map((build) => [build.key, build]));
  draft.dpsPool = draft.dpsPool.map((weapon) => {
    const build = buildsByKey.get(weapon.weaponKey) || buildsByName.get(normalizeName(weapon.label));
    return {
      ...weapon,
      emojiName: build?.emojiName || build?.familySymbol || weapon.emojiName || null,
      emojiId: build?.emojiId || weapon.emojiId || null,
      buildUrl: build?.buildUrl || weapon.buildUrl || null
    };
  });
  return draft;
}

function compositionStep({ id, creatorId, position = null }) {
  const draft = getDraft(id, creatorId);
  const requested = position == null ? draft.slotDefinitions.findIndex((slot) => !slot.value) : Number(position);
  const slotPosition = requested < 0 ? draft.slotDefinitions.length : requested;
  if (!Number.isInteger(slotPosition) || slotPosition < 0 || slotPosition >= draft.slotDefinitions.length) {
    return { draft, complete: true, position: draft.slotDefinitions.length, total: draft.slotDefinitions.length };
  }
  return {
    draft,
    complete: false,
    position: slotPosition,
    total: draft.slotDefinitions.length,
    slot: draft.slotDefinitions[slotPosition],
    builds: draft.catalog.filter((build) => weaponCatalog.allowedForRole(build, draft.slotDefinitions[slotPosition].role))
  };
}

function applyBuild(slot, build) {
  Object.assign(slot, {
    value: build.name,
    buildKey: build.key,
    buildUrl: build.buildUrl || null,
    emojiName: build.emojiId ? build.emojiName : build.familySymbol || build.emojiName || null,
    emojiId: build.emojiId || null
  });
}

function setSlotBuild({ id, creatorId, position, buildKey, familyKey = null }) {
  const step = compositionStep({ id, creatorId, position });
  if (step.complete) throw new Error('A composicao deste evento ja foi preenchida.');
  const build = step.builds.find((candidate) => (
    candidate.key === buildKey && (!familyKey || (candidate.familyKey || 'forum') === familyKey)
  ));
  if (!build) throw new Error(`Escolha uma build valida para ${step.slot.fieldLabel}.`);
  const otherSlots = step.draft.slotDefinitions.filter((_, index) => index !== step.position);
  if (!compositionRules.canAdd(otherSlots, step.draft.rulesSnapshot, build.key, step.slot.role)) {
    const rule = compositionRules.ruleFor(step.draft.rulesSnapshot, build.key);
    throw new Error(`${build.name} não pode ocupar outra vaga (${compositionRules.ruleLabel(rule)}).`);
  }
  applyBuild(step.slot, build);
  return { ...step, build };
}

function confirmSlotBuild({ id, creatorId, position }) {
  const step = compositionStep({ id, creatorId, position });
  if (step.complete || !step.slot.value || !step.slot.buildKey) throw new Error('Escolha uma arma antes de continuar.');
  return compositionStep({ id, creatorId, position: step.position + 1 });
}

function repeatSlotBuild({ id, creatorId, position }) {
  const step = compositionStep({ id, creatorId, position });
  if (step.complete || !step.slot.buildKey) throw new Error('Escolha uma arma antes de repetir.');
  const build = step.builds.find((candidate) => candidate.key === step.slot.buildKey);
  if (!build) throw new Error('A arma escolhida nao esta mais disponivel para esta funcao.');
  for (const slot of step.draft.slotDefinitions) {
    if (slot.role !== step.slot.role || slot.index <= step.slot.index || slot.buildKey) continue;
    if (!compositionRules.canAdd(step.draft.slotDefinitions, step.draft.rulesSnapshot, build.key, slot.role)) break;
    applyBuild(slot, build);
  }
  return compositionStep({ id, creatorId });
}

function selectBuild(input) {
  const selected = setSlotBuild(input);
  return compositionStep({ id: input.id, creatorId: input.creatorId, position: selected.position + 1 });
}

function removeDraft(id, creatorId = null) {
  const draft = getDraft(id, creatorId);
  drafts.delete(draft.id);
  return draft;
}

function parsePage(value, totalPages) {
  const page = Number.parseInt(value, 10);
  if (!Number.isInteger(page) || page < 0 || page >= totalPages) throw new Error('Etapa de composicao invalida.');
  return page;
}

function clean(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

module.exports = {
  createDraft,
  getDraft,
  pageCount,
  parseComposition,
  normalizeCtaDateTime,
  removeDraft,
  confirmSlotBuild,
  repeatSlotBuild,
  saveDetails,
  setDpsPolicy,
  setCompositionMode,
  setRulesSnapshot,
  selectBuild,
  setSlotBuild,
  setCatalog,
  saveSlotPage,
  slotPage,
  compositionStep
};
