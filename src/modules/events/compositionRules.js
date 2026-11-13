const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { findWeapon } = require('./weaponCatalog');

const COMPOSITION_SHEET_URL = process.env.EVENT_COMPOSITION_SHEET_URL
  || 'https://docs.google.com/spreadsheets/d/1Iuoh950ssC0bw9TMmtmXCUFZK9o5YagY59lu-gvNzv0/edit#gid=1900393803';
const MATRIX_SHEET = 'Regras por conteúdo';
const DETAILS_SHEET = 'Regras detalhadas';
const MATRIX_GID = '1900393803';
const DETAILS_GID = '734982105';
const PACKAGED_SNAPSHOT_PATH = path.join(__dirname, 'compositionRules.snapshot.json');

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
  group_dungeon: ['DG Grupo'],
  roaming: ['Roaming T6'],
  outposts: ['Outposts'],
  static: ['Static'],
  gank: ['Gank T8'],
  world_boss: ['World Boss'],
  // O fluxo atual chama este conteúdo de Raid Avalon Full. A coluna antiga
  // Raid Avalon permanece como fallback para planilhas ainda não migradas.
  raid_avalon: ['Raid Full', 'Raid Avalon'],
  raid_dragon: ['Raid Dragão'],
  cta: ['CTA']
};

let cachedSheet = null;
let cachedAt = 0;
let cachedServiceToken = null;

function rule(key, min, max, role = null) {
  return Object.freeze({ key, min, max, role });
}

function snapshot(contentType) {
  const merged = { ...(RULES.all || {}), ...(RULES[contentType] || {}) };
  return {
    version: 2,
    sourceUrl: COMPOSITION_SHEET_URL,
    sourceStatus: 'fallback',
    contentType,
    capturedAt: new Date().toISOString(),
    warnings: [],
    weapons: Object.fromEntries(Object.entries(merged).map(([itemId, value]) => [itemId, {
      ...value,
      label: findWeapon(itemId)?.name || itemId
    }]))
  };
}

async function loadSnapshot(contentType, options = {}) {
  const fallback = snapshot(contentType);
  try {
    const data = await loadSheetData(options);
    return snapshotFromSheetData(contentType, data, fallback);
  } catch (remoteError) {
    try {
      const data = loadPackagedSheetData();
      const packaged = snapshotFromSheetData(contentType, data, fallback);
      packaged.sourceStatus = 'packaged';
      packaged.warnings.unshift(`Planilha online indisponível: ${remoteError.message}`);
      return packaged;
    } catch (packagedError) {
      fallback.warnings.push(
        `Planilha online indisponível: ${remoteError.message}`,
        `Snapshot local indisponível: ${packagedError.message}`
      );
      return fallback;
    }
  }
}

function snapshotFromSheetData(contentType, data, fallback = snapshot(contentType)) {
  const rows = data.matrixRows || [];
  const headerIndex = rows.findIndex((row) => row.includes('Arma') && row.includes('Regra padrão'));
  if (headerIndex < 0) throw new Error('Cabeçalho da matriz de regras não encontrado.');
  const headers = rows[headerIndex];
  const itemIndex = headers.indexOf('Item ID');
  const weaponIndex = headers.indexOf('Arma');
  const defaultIndex = headers.indexOf('Regra padrão');
  const contentHeader = resolveContentHeader(headers, contentType);
  const contentIndex = contentHeader ? headers.indexOf(contentHeader) : -1;
  const buildUrlIndex = ['Link da build', 'Build URL', 'Link']
    .map((name) => headers.indexOf(name))
    .find((index) => index >= 0) ?? -1;
  if (itemIndex < 0 || weaponIndex < 0 || defaultIndex < 0) {
    throw new Error('Colunas obrigatórias da matriz não foram encontradas.');
  }

  const warnings = [];
  if (contentIndex < 0) warnings.push(`A coluna de ${contentType} não existe; somente regras padrão serão usadas.`);
  const details = detailedRules(data.detailRows || []);
  const weapons = { ...fallback.weapons };

  for (const row of rows.slice(headerIndex + 1)) {
    const itemId = String(row[itemIndex] || '').trim();
    if (!itemId) continue;
    const label = String(row[weaponIndex] || '').trim() || findWeapon(itemId)?.name || itemId;
    const defaultRaw = String(row[defaultIndex] || '').trim();
    const contentRaw = contentIndex >= 0 ? String(row[contentIndex] || '').trim() : 'Herdar padrão';
    const inheritsDefault = !contentRaw || normalize(contentRaw) === 'herdar padrao';
    const selectedRaw = inheritsDefault ? defaultRaw : contentRaw;
    const detailContent = inheritsDefault ? 'Todos (padrão)' : contentHeader;
    const isInvalidCustom = normalize(selectedRaw) === 'limite personalizado'
      && !sheetRule(selectedRaw, details.get(detailKey(detailContent, itemId)));
    const parsed = sheetRule(selectedRaw, details.get(detailKey(detailContent, itemId)));
    const defaultParsed = sheetRule(defaultRaw, details.get(detailKey('Todos (padrão)', itemId)));
    const effective = parsed || (normalize(selectedRaw) === 'limite personalizado' ? defaultParsed : null);
    if (isInvalidCustom) {
      warnings.push(`${label}: limite personalizado sem mínimo/máximo válido em ${detailContent}; regra padrão aplicada.`);
    }
    if (!effective) {
      continue;
    }
    const known = fallback.weapons[itemId];
    const buildUrl = buildUrlIndex >= 0 && /^https?:\/\//i.test(String(row[buildUrlIndex] || '').trim())
      ? String(row[buildUrlIndex]).trim()
      : null;
    weapons[itemId] = {
      ...effective,
      role: known?.role || null,
      label,
      ...(buildUrl ? { buildUrl } : {})
    };
  }

  return {
    ...fallback,
    capturedAt: data.capturedAt || new Date().toISOString(),
    sourceStatus: data.sourceStatus || 'remote',
    sourceColumn: contentHeader || null,
    warnings,
    weapons
  };
}

function resolveContentHeader(headers, contentType) {
  return (sheetColumns[contentType] || []).find((name) => headers.includes(name)) || null;
}

function detailedRules(rows) {
  const map = new Map();
  const headerIndex = rows.findIndex((row) => row.includes('Conteúdo') && row.includes('Item ID'));
  if (headerIndex < 0) return map;
  const headers = rows[headerIndex];
  const indexes = {
    content: headers.indexOf('Conteúdo'),
    itemId: headers.indexOf('Item ID'),
    rule: headers.indexOf('Regra'),
    min: headers.indexOf('Mínimo personalizado'),
    max: headers.indexOf('Máximo personalizado')
  };
  for (const row of rows.slice(headerIndex + 1)) {
    const content = String(row[indexes.content] || '').trim();
    const itemId = String(row[indexes.itemId] || '').trim();
    if (!content || !itemId) continue;
    map.set(detailKey(content, itemId), {
      rule: String(row[indexes.rule] || '').trim(),
      min: optionalInteger(row[indexes.min]),
      max: optionalInteger(row[indexes.max])
    });
  }
  return map;
}

function detailKey(content, itemId) {
  return `${normalize(content)}|${String(itemId || '').trim()}`;
}

function optionalInteger(value) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function loadSheetData({ fetchImpl = globalThis.fetch, force = false } = {}) {
  if (!force && cachedSheet && Date.now() - cachedAt < 5 * 60 * 1000) return cachedSheet;
  if (typeof fetchImpl !== 'function') throw new Error('Fetch indisponível.');
  const credentials = serviceAccountCredentials();
  const data = credentials
    ? await loadWithServiceAccount(credentials, fetchImpl)
    : await loadWithCsvExport(fetchImpl);
  cachedSheet = data;
  cachedAt = Date.now();
  return data;
}

async function loadWithCsvExport(fetchImpl) {
  const spreadsheetId = spreadsheetIdFromUrl();
  const configured = String(process.env.EVENT_COMPOSITION_SHEET_CSV_URL || '').trim();
  const matrixUrl = configured || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${MATRIX_GID}`;
  const detailsUrl = configured
    ? replaceGid(configured, DETAILS_GID)
    : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${DETAILS_GID}`;
  const matrixRows = await fetchCsv(matrixUrl, fetchImpl);
  let detailRows = [];
  try { detailRows = await fetchCsv(detailsUrl, fetchImpl); } catch { /* regras simples continuam válidas */ }
  return { matrixRows, detailRows, capturedAt: new Date().toISOString(), sourceStatus: 'remote_csv' };
}

async function fetchCsv(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Exportação CSV respondeu ${response.status}.`);
  return parseCsv(await response.text());
}

async function loadWithServiceAccount(credentials, fetchImpl) {
  const token = await serviceAccountAccessToken(credentials, fetchImpl);
  const spreadsheetId = spreadsheetIdFromUrl();
  const endpoint = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet`);
  endpoint.searchParams.append('ranges', `'${MATRIX_SHEET}'!A:Z`);
  endpoint.searchParams.append('ranges', `'${DETAILS_SHEET}'!A:I`);
  endpoint.searchParams.set('majorDimension', 'ROWS');
  const response = await fetchImpl(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error(`Google Sheets API respondeu ${response.status}.`);
  const body = await response.json();
  const ranges = body.valueRanges || [];
  return {
    matrixRows: ranges[0]?.values || [],
    detailRows: ranges[1]?.values || [],
    capturedAt: new Date().toISOString(),
    sourceStatus: 'remote_authenticated'
  };
}

function serviceAccountCredentials() {
  const encoded = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '').trim();
  const raw = encoded
    ? Buffer.from(encoded, 'base64').toString('utf8')
    : String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  try {
    const credentials = JSON.parse(raw);
    if (!credentials.client_email || !credentials.private_key) throw new Error('campos obrigatórios ausentes');
    return credentials;
  } catch (error) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON inválido: ${error.message}`);
  }
}

async function serviceAccountAccessToken(credentials, fetchImpl) {
  if (cachedServiceToken && cachedServiceToken.expiresAt > Date.now() + 60_000) return cachedServiceToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: credentials.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), credentials.private_key).toString('base64url');
  const response = await fetchImpl(credentials.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`
    }),
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error(`OAuth da conta de serviço respondeu ${response.status}.`);
  const body = await response.json();
  if (!body.access_token) throw new Error('OAuth não retornou access_token.');
  cachedServiceToken = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 };
  return cachedServiceToken.value;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function spreadsheetIdFromUrl() {
  const id = COMPOSITION_SHEET_URL.match(/\/d\/([^/]+)/)?.[1];
  if (!id) throw new Error('ID da planilha de composições não encontrado.');
  return id;
}

function replaceGid(url, gid) {
  const parsed = new URL(url);
  parsed.searchParams.set('gid', gid);
  return parsed.toString();
}

function loadPackagedSheetData() {
  const parsed = JSON.parse(fs.readFileSync(PACKAGED_SNAPSHOT_PATH, 'utf8'));
  if (!Array.isArray(parsed.matrixRows)) throw new Error('matrixRows ausente.');
  return { ...parsed, sourceStatus: 'packaged' };
}

function sheetRule(value, custom = null) {
  const key = normalize(value);
  if (!key || key === 'a definir' || key === 'herdar padrao') return null;
  if (key === 'nao permitido') return rule('forbidden', 0, 0);
  if (key === 'maximo 1') return rule('max_one', 0, 1);
  if (key === 'pode repetir') return rule('repeat', 0, null);
  if (key === 'unico') return rule('unique', 1, 1);
  if (key === 'minimo 1') return rule('minimum_one', 1, null);
  if (key === 'limite personalizado') {
    if (!custom || (custom.min == null && custom.max == null)) return null;
    if (custom.min != null && custom.max != null && custom.min > custom.max) return null;
    return rule('custom', custom.min ?? 0, custom.max ?? null);
  }
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
    custom: `Personalizado (${constraint?.min ?? 0}–${constraint?.max ?? '∞'})`,
    unrestricted: 'Sem limite definido',
    forbidden: 'Não permitido'
  })[constraint?.key] || 'Regra personalizada';
}

module.exports = {
  COMPOSITION_SHEET_URL,
  canAdd,
  detailedRules,
  loadSheetData,
  loadSnapshot,
  parseCsv,
  parseSnapshot,
  resolveContentHeader,
  ruleFor,
  ruleLabel,
  sheetRule,
  snapshot,
  snapshotFromSheetData,
  validateSlots
};
