const { findWeapon } = require('./weaponCatalog');

const COMPOSITION_SHEET_URL = process.env.EVENT_COMPOSITION_SHEET_URL
  || 'https://docs.google.com/spreadsheets/d/1Iuoh950ssC0bw9TMmtmXCUFZK9o5YagY59lu-gvNzv0/edit#gid=1900393803';

const RULES = Object.freeze({
  all: {
    T4_2H_LONGBOW: rule('max_one', 0, 1),
    T4_2H_BOW_AVALON: rule('repeat', 0, null)
  },
  group_dungeon: {
    T4_MAIN_MACE_HELL: rule('unique', 1, 1, 'tank'),
    T4_MAIN_HOLYSTAFF_AVALON: rule('unique', 1, 1, 'healer'),
    T4_MAIN_CURSEDSTAFF_AVALON: rule('unique', 1, 1, 'support'),
    T4_2H_BOW_KEEPER: rule('unique', 1, 1, 'dps')
  },
  cta: {
    T4_2H_ICECRYSTAL_UNDEAD: rule('minimum_one', 1, null, 'dps')
  }
});
const sheetColumns = {
  group_dungeon: 'DG Grupo',
  roaming: 'Roaming T6',
  outposts: 'Outposts',
  static: 'Static',
  gank: 'Gank T8',
  world_boss: 'World Boss',
  raid_avalon: 'Raid Avalon',
  cta: 'CTA'
};
let cachedSheet = null;
let cachedAt = 0;

function rule(key, min, max, role = null) {
  return Object.freeze({ key, min, max, role });
}

function snapshot(contentType) {
  const merged = { ...(RULES.all || {}), ...(RULES[contentType] || {}) };
  return {
    version: 1,
    sourceUrl: COMPOSITION_SHEET_URL,
    contentType,
    capturedAt: new Date().toISOString(),
    weapons: Object.fromEntries(Object.entries(merged).map(([itemId, value]) => [itemId, {
      ...value,
      label: findWeapon(itemId)?.name || itemId
    }]))
  };
}

async function loadSnapshot(contentType, options = {}) {
  const fallback = snapshot(contentType);
  try {
    const rows = await loadSheetRows(options);
    const headerIndex = rows.findIndex((row) => row.includes('Arma') && row.includes('Regra padrão'));
    if (headerIndex < 0) return fallback;
    const headers = rows[headerIndex];
    const itemIndex = headers.indexOf('Item ID');
    const weaponIndex = headers.indexOf('Arma');
    const defaultIndex = headers.indexOf('Regra padrão');
    const contentIndex = headers.indexOf(sheetColumns[contentType]);
    const buildUrlIndex = ['Link da build', 'Build URL', 'Link'].map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
    if (itemIndex < 0 || weaponIndex < 0 || contentIndex < 0) return fallback;
    const weapons = {};
    for (const row of rows.slice(headerIndex + 1)) {
      const itemId = String(row[itemIndex] || '').trim();
      if (!itemId) continue;
      let value = String(row[contentIndex] || '').trim();
      if (!value || normalize(value) === 'herdar padrao') value = String(row[defaultIndex] || '').trim();
      const parsed = sheetRule(value);
      if (!parsed) continue;
      const known = fallback.weapons[itemId];
      const buildUrl = buildUrlIndex >= 0 && /^https?:\/\//i.test(String(row[buildUrlIndex] || '').trim())
        ? String(row[buildUrlIndex]).trim()
        : null;
      weapons[itemId] = {
        ...parsed,
        role: known?.role || null,
        label: String(row[weaponIndex] || '').trim() || known?.label || findWeapon(itemId)?.name || itemId,
        ...(buildUrl ? { buildUrl } : {})
      };
    }
    return { ...fallback, capturedAt: new Date().toISOString(), weapons };
  } catch {
    return fallback;
  }
}

async function loadSheetRows({ fetchImpl = globalThis.fetch, force = false } = {}) {
  if (!force && cachedSheet && Date.now() - cachedAt < 5 * 60 * 1000) return cachedSheet;
  if (typeof fetchImpl !== 'function') throw new Error('Fetch indisponível.');
  const sheetId = COMPOSITION_SHEET_URL.match(/\/d\/([^/]+)/)?.[1];
  const gid = COMPOSITION_SHEET_URL.match(/[?#&]gid=(\d+)/)?.[1] || '1900393803';
  const response = await fetchImpl(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`, {
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`Planilha respondeu ${response.status}.`);
  cachedSheet = parseCsv(await response.text());
  cachedAt = Date.now();
  return cachedSheet;
}

function sheetRule(value) {
  const key = normalize(value);
  if (!key || key === 'a definir') return null;
  if (key === 'nao permitido') return rule('forbidden', 0, 0);
  if (key === 'maximo 1') return rule('max_one', 0, 1);
  if (key === 'pode repetir') return rule('repeat', 0, null);
  if (key === 'unico') return rule('unique', 1, 1);
  if (key === 'minimo 1') return rule('minimum_one', 1, null);
  return null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < String(text).length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { field += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { row.push(field); field = ''; continue; }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); rows.push(row); row = []; field = ''; continue;
    }
    field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function parseSnapshot(value, contentType = 'other') {
  if (!value) return snapshot(contentType);
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return snapshot(contentType); }
}

function ruleFor(snapshotValue, itemId) {
  return parseSnapshot(snapshotValue).weapons?.[itemId] || { key: 'unrestricted', min: 0, max: null, role: null };
}

function validateSlots(slots, snapshotValue) {
  const current = parseSnapshot(snapshotValue);
  const counts = new Map();
  for (const slot of slots || []) {
    if (!slot.buildKey) continue;
    counts.set(slot.buildKey, (counts.get(slot.buildKey) || 0) + 1);
  }
  const errors = [];
  for (const [itemId, constraint] of Object.entries(current.weapons || {})) {
    const count = counts.get(itemId) || 0;
    if (constraint.min != null && count < constraint.min) {
      errors.push(`${constraint.label} precisa aparecer pelo menos ${constraint.min} vez(es).`);
    }
    if (constraint.max != null && count > constraint.max) {
      errors.push(`${constraint.label} aceita no máximo ${constraint.max} vaga(s).`);
    }
    if (constraint.role) {
      const wrongRole = (slots || []).find((slot) => slot.buildKey === itemId && slot.role !== constraint.role);
      if (wrongRole) errors.push(`${constraint.label} deve ocupar uma vaga de ${constraint.role}.`);
    }
  }
  return errors;
}

function canAdd(slots, snapshotValue, itemId, role) {
  const constraint = ruleFor(snapshotValue, itemId);
  if (constraint.role && constraint.role !== role) return false;
  if (constraint.max == null) return true;
  return (slots || []).filter((slot) => slot.buildKey === itemId).length < constraint.max;
}

function ruleLabel(constraint) {
  return ({
    unique: 'Único (obrigatório)',
    minimum_one: 'Mínimo 1',
    max_one: 'Máximo 1',
    repeat: 'Pode repetir',
    unrestricted: 'Sem limite definido',
    forbidden: 'Não permitido'
  })[constraint?.key] || 'Regra personalizada';
}

module.exports = {
  COMPOSITION_SHEET_URL,
  canAdd,
  loadSnapshot,
  parseCsv,
  parseSnapshot,
  ruleFor,
  ruleLabel,
  snapshot,
  validateSlots
};
