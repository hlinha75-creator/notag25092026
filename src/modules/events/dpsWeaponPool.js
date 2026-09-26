const { findWeapon, itemImage } = require('./weaponCatalog');

const dpsWeaponPolicies = Object.freeze({
  caller: { key: 'caller', label: 'Armas definidas pelo caller' },
  free: { key: 'free', label: 'Escolha livre do membro' },
  limited: { key: 'limited', label: 'Escolha livre com limite' },
  predefined: { key: 'predefined', label: 'Armas predefinidas pelo caller' },
  role_free: { key: 'role_free', label: 'Livre por função, sem informar arma' },
  sheet_limited: { key: 'sheet_limited', label: 'Escolha respeitando a planilha' },
  weapon_declared: { key: 'weapon_declared', label: 'Escolha sem limite, informando arma' }
});

const defaultDpsWeaponPool = Object.freeze([
  entry('T4_2H_ICECRYSTAL_UNDEAD', 'Prisma', 1, true, 'https://prnt.sc/cwSVumoOCXhg'),
  entry('T4_2H_KNUCKLES_SET3', 'Luvas Cravadas', 1, true, 'https://prnt.sc/ZhUKcmv70w_n'),
  entry('T4_2H_AXE_AVALON', 'Quebra-Reinos', 1, false, 'https://prnt.sc/65AEi-0rI8O2'),
  entry('T4_2H_KNUCKLES_HELL', 'Mãos Infernais', 1, false, 'https://prnt.sc/ZhUKcmv70w_n'),
  entry('T4_2H_CROSSBOWLARGE', 'Besta Pesada', 1, false, 'https://prnt.sc/pHcKjhEJvhiq'),
  entry('T4_2H_CROSSBOW_CANNON_AVALON', 'Modelador de Energia', 1, false, 'https://prnt.sc/f6ZU57xzP19s'),
  entry('T4_2H_LONGBOW', 'Arco Longo', 1, false, 'https://prnt.sc/pMn4r19KAyQJ'),
  entry('T4_2H_BOW_AVALON', 'Fura-Bruma', 2, false, 'https://prnt.sc/gE05MtimkpSx'),
  entry('T4_2H_HARPOON_HELL', 'Caça-Espíritos', 1, false, 'https://prnt.sc/ANu607xVFw9g'),
  entry('T4_2H_GLAIVE_CRYSTAL', 'Arma Fraturada', 4, false, 'https://prnt.sc/4flrOSIniVVF'),
  entry('T4_2H_INFERNOSTAFF_MORGANA', 'Cajado de Fogo Elevado', 1, false, 'https://prnt.sc/epnpWHXcCJzq'),
  entry('T4_2H_FIRE_RINGPAIR_AVALON', 'Canção da Alvorada', 1, false, 'https://prnt.sc/dwtPHJVzjqc0'),
  entry('T4_MAIN_ARCANESTAFF_UNDEAD', 'Cajado Feiticeiro', 1, false, 'https://prnt.sc/0Zs3dvdYWi5A'),
  entry('T4_2H_FROSTSTAFF', 'Cajado de Gelo Elevado', 2, false, 'https://prnt.sc/xf96cydqsv6F'),
  entry('T4_2H_FROSTSTAFF_CRYSTAL', 'Cajado Ártico', 1, false, 'https://prnt.sc/a4df2bvm2YWu'),
  entry('T4_MAIN_CURSEDSTAFF_CRYSTAL', 'Cajado Pútrido', 1, false, 'https://prnt.sc/zT5xBUb2um52')
]);

function entry(weaponKey, label, maxQuantity, mandatory, buildUrl) {
  return Object.freeze({ weaponKey, label, maxQuantity, mandatory, buildUrl });
}

function cloneDefaultDpsWeaponPool() {
  return defaultDpsWeaponPool.map((item) => ({ ...item }));
}

function normalizeDpsWeaponPolicy(value) {
  const key = String(value || 'caller').trim().toLowerCase();
  if (!dpsWeaponPolicies[key]) throw new Error('Escolha uma regra válida para as armas de DPS.');
  return key;
}

function normalizeDpsWeaponPool(input, dpsSlots, options = {}) {
  const slots = Number(dpsSlots || 0);
  if (!Number.isInteger(slots) || slots < 0) throw new Error('A quantidade de DPS é inválida.');
  if (slots === 0) return [];
  const policy = normalizeDpsWeaponPolicy(options.policy);
  if (policy === 'role_free') return [];
  const source = Array.isArray(input) && input.length ? input : cloneDefaultDpsWeaponPool();
  const defaults = new Map(defaultDpsWeaponPool.map((item) => [item.weaponKey, item]));
  const seen = new Set();
  const normalized = [];
  for (const raw of source) {
    const weaponKey = String(raw.weaponKey || raw.weapon_key || raw.itemId || '').trim();
    const definition = defaults.get(weaponKey);
    if (!definition) throw new Error(`Arma de DPS não reconhecida: ${weaponKey || 'sem identificação'}.`);
    if (seen.has(weaponKey)) throw new Error(`A arma ${definition.label} aparece mais de uma vez.`);
    seen.add(weaponKey);
    const enabled = raw.enabled !== false && Number(raw.maxQuantity ?? raw.max_quantity ?? definition.maxQuantity) > 0;
    if (!enabled) {
      if (['caller', 'predefined'].includes(policy) && definition.mandatory) throw new Error(`${definition.label} é obrigatória e não pode ser removida.`);
      continue;
    }
    const configuredQuantity = Number(raw.maxQuantity ?? raw.max_quantity ?? definition.maxQuantity);
    const maxQuantity = ['free', 'weapon_declared'].includes(policy) ? slots : configuredQuantity;
    if (!Number.isInteger(maxQuantity) || maxQuantity < 1 || maxQuantity > 20) {
      throw new Error(`O limite de ${definition.label} deve ficar entre 1 e 20.`);
    }
    const weapon = findWeapon(weaponKey);
    if (!weapon) throw new Error(`A arma ${definition.label} não existe no catálogo do Albion.`);
    normalized.push({
      ...definition,
      maxQuantity,
      mandatory: ['caller', 'predefined'].includes(policy) && definition.mandatory,
      albionName: weapon.name,
      imageUrl: itemImage(weaponKey),
      emojiName: raw.emojiName ?? raw.emoji_name ?? null,
      emojiId: raw.emojiId ?? raw.emoji_id ?? null
    });
  }
  for (const required of defaultDpsWeaponPool.filter((item) => item.mandatory)) {
    if (['caller', 'predefined'].includes(policy) && !seen.has(required.weaponKey)) throw new Error(`${required.label} é obrigatória e não pode ser removida.`);
  }
  const requiredSlots = normalized.filter((item) => item.mandatory).length;
  if (slots < requiredSlots) {
    throw new Error(`A composição precisa de pelo menos ${requiredSlots} vagas de DPS para as armas obrigatórias.`);
  }
  const capacity = normalized.reduce((sum, item) => sum + item.maxQuantity, 0);
  if (capacity < slots) {
    throw new Error(`O estoque de DPS oferece ${capacity} vagas, mas a composição pede ${slots}.`);
  }
  if (options.maxEntries && normalized.length > options.maxEntries) {
    throw new Error(`O cardápio aceita no máximo ${options.maxEntries} armas.`);
  }
  return normalized;
}

function formatDpsPoolText(pool = defaultDpsWeaponPool) {
  return pool.map((item) => `${item.mandatory ? '! ' : ''}${item.label}: ${item.maxQuantity}`).join('\n');
}

function parseDpsPoolText(text, dpsSlots) {
  return parseDpsPoolTextForPolicy(text, dpsSlots, 'caller');
}

function parseDpsPoolTextForPolicy(text, dpsSlots, policy = 'caller') {
  const defaultsByName = new Map(defaultDpsWeaponPool.flatMap((item) => [
    [normalizeName(item.label), item],
    [normalizeName(findWeapon(item.weaponKey)?.name), item]
  ]));
  const parsed = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = line.replace(/^!\s*/, '').match(/^(.+?)\s*[:=x-]\s*(\d+)$/i);
    if (!match) throw new Error(`Linha inválida no estoque de DPS: "${line}". Use Nome: quantidade.`);
    const definition = defaultsByName.get(normalizeName(match[1]));
    if (!definition) throw new Error(`Arma de DPS não reconhecida: ${match[1].trim()}.`);
    return { weaponKey: definition.weaponKey, maxQuantity: Number(match[2]), enabled: true };
  });
  return normalizeDpsWeaponPool(parsed, dpsSlots, { maxEntries: 20, policy });
}

function policyOptions() {
  return ['predefined', 'role_free', 'sheet_limited', 'weapon_declared'].map((key) => ({
    label: dpsWeaponPolicies[key].label,
    value: key
  }));
}

function normalizeName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

module.exports = {
  cloneDefaultDpsWeaponPool,
  defaultDpsWeaponPool,
  dpsWeaponPolicies,
  formatDpsPoolText,
  normalizeDpsWeaponPool,
  normalizeDpsWeaponPolicy,
  parseDpsPoolText,
  parseDpsPoolTextForPolicy,
  policyOptions
};
