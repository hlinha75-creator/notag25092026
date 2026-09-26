const crypto = require('node:crypto');
const { getDatabase, transaction } = require('../../database/connection');
const { backupDatabase } = require('../../database/backup');
const audit = require('../audit/audit.repository');

const previews = new Map();
const KINDS = new Set(['food', 'guild_history', 'bank']);
const KIND_LABELS = {
  food: 'Alimento',
  guild_history: 'Histórico da guilda',
  bank: 'Banco da guilda'
};

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeHeader(value) {
  return normalizeName(value);
}

function clean(value) {
  return String(value ?? '').replace(/^"|"$/g, '').trim();
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function detectDelimiter(text) {
  const firstLine = String(text || '').split(/\r?\n/).find((line) => line.trim()) || '';
  return ['\t', ';', ',']
    .map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter || ',';
}

function parseRows(text, delimiter) {
  const rows = [];
  let cell = '';
  let row = [];
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function parseDelimitedRows(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const parsed = parseRows(raw, detectDelimiter(raw));
  const [headers, ...data] = parsed;
  if (!headers) return [];
  return data.map((cells) => Object.fromEntries(headers.map((header, index) => [clean(header), cells[index] || ''])));
}

function firstByAliases(row, aliases) {
  const accepted = new Set(aliases.map(normalizeHeader));
  for (const [key, value] of Object.entries(row)) {
    if (accepted.has(normalizeHeader(key))) return value;
  }
  return '';
}

function parseInteger(value, { allowNegative = false } = {}) {
  const raw = clean(value).replace(/[\s.]/g, '').replace(',', '.');
  if (!raw || !/^-?\d+$/.test(raw)) throw new Error('valor inválido');
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || (!allowNegative && parsed < 0)) throw new Error('valor inválido');
  return parsed;
}

function validEventDate(value) {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(clean(value));
}

function linkedUsers() {
  return new Map(getDatabase().prepare(`
    SELECT lower(albion_name) AS albion_key, discord_id
    FROM users
    WHERE albion_name IS NOT NULL AND trim(albion_name) <> ''
  `).all().map((row) => [normalizeName(row.albion_key), row.discord_id]));
}

function latestFoodRows() {
  const latest = getDatabase().prepare(`
    SELECT id FROM albion_operational_imports
    WHERE kind = 'food' ORDER BY id DESC LIMIT 1
  `).get();
  if (!latest) return new Map();
  return new Map(getDatabase().prepare(`
    SELECT albion_key, albion_name, amount
    FROM albion_food_contribution_rows WHERE import_id = ?
  `).all(latest.id).map((row) => [row.albion_key, row]));
}

function previewFood(sourceRows) {
  const previous = latestFoodRows();
  const users = linkedUsers();
  const rows = [];
  const errors = [];
  const seen = new Set();
  for (let index = 0; index < sourceRows.length; index += 1) {
    const source = sourceRows[index];
    const albionName = clean(firstByAliases(source, ['player', 'character name', 'jogador']));
    const albionKey = normalizeName(albionName);
    if (!albionKey) {
      errors.push({ line: index + 2, message: 'Jogador não informado.' });
      continue;
    }
    if (seen.has(albionKey)) {
      errors.push({ line: index + 2, message: `${albionName} aparece mais de uma vez.` });
      continue;
    }
    let amount;
    try {
      amount = parseInteger(firstByAliases(source, ['amount', 'valor']));
    } catch {
      errors.push({ line: index + 2, message: `${albionName}: valor inválido.` });
      continue;
    }
    seen.add(albionKey);
    const previousAmount = Number(previous.get(albionKey)?.amount || 0);
    rows.push({
      albionKey,
      albionName,
      guildRole: clean(firstByAliases(source, ['guild role', 'role', 'cargo'])) || null,
      sourceRank: Number(clean(firstByAliases(source, ['rank', 'posição', 'posicao']))) || null,
      amount,
      previousAmount,
      delta: amount - previousAmount,
      discordId: users.get(albionKey) || null
    });
  }
  rows.sort((a, b) => b.amount - a.amount || a.albionName.localeCompare(b.albionName));
  return {
    rows,
    errors,
    summary: {
      rows: rows.length,
      contributors: rows.filter((row) => row.amount > 0).length,
      zero: rows.filter((row) => row.amount === 0).length,
      linked: rows.filter((row) => row.discordId).length,
      totalAmount: rows.reduce((total, row) => total + row.amount, 0),
      changed: rows.filter((row) => row.delta !== 0).length,
      errors: errors.length
    }
  };
}

function historyAction(reason) {
  if (/^assigned /i.test(reason)) return 'role_assigned';
  if (/^unassigned |^removed /i.test(reason)) return 'role_removed';
  if (/^accepted /i.test(reason)) return 'accepted';
  if (/^invited /i.test(reason)) return 'invited';
  if (/^left the guild/i.test(reason)) return 'left';
  if (/^kicked /i.test(reason)) return 'kicked';
  return 'other';
}

function parseHistoryTarget(reason, actorName, actionType) {
  if (actionType === 'left') return { targetName: actorName, targetMissing: false };
  const matches = [...reason.matchAll(/\[b\](.*?)\[\/b\]/g)].map((match) => clean(match[1]));
  const candidate = actionType === 'role_assigned' || actionType === 'role_removed' ? matches[1] : matches[0];
  return {
    targetName: candidate && candidate !== '{0}' ? candidate : null,
    targetMissing: !candidate || candidate === '{0}'
  };
}

function previewHistory(sourceRows) {
  const db = getDatabase();
  const rowsByKey = new Map();
  const errors = [];
  let inputDuplicates = 0;
  for (let index = 0; index < sourceRows.length; index += 1) {
    const source = sourceRows[index];
    const eventAt = clean(firstByAliases(source, ['date', 'data']));
    const actorName = clean(firstByAliases(source, ['player', 'jogador']));
    const rawReason = clean(firstByAliases(source, ['reason', 'motivo', 'ação', 'acao']));
    if (!validEventDate(eventAt) || !actorName || !rawReason) {
      errors.push({ line: index + 2, message: 'Data, jogador ou ação inválidos.' });
      continue;
    }
    const actionType = historyAction(rawReason);
    const { targetName, targetMissing } = parseHistoryTarget(rawReason, actorName, actionType);
    const roleMatch = rawReason.match(/^(?:assigned|unassigned|removed) \[b\](.*?)\[\/b\]/i);
    const eventKey = hash(`${eventAt}|${normalizeName(actorName)}|${rawReason}`);
    if (rowsByKey.has(eventKey)) {
      inputDuplicates += 1;
      continue;
    }
    rowsByKey.set(eventKey, {
      eventKey,
      eventAt,
      actorName,
      actionType,
      rawReason,
      roleName: roleMatch ? clean(roleMatch[1]) : null,
      targetName,
      targetMissing: targetMissing ? 1 : 0
    });
  }
  const rows = [...rowsByKey.values()].sort((a, b) => b.eventAt.localeCompare(a.eventAt));
  const exists = db.prepare('SELECT 1 FROM albion_guild_history_events WHERE event_key = ?');
  const existingDuplicates = rows.filter((row) => exists.get(row.eventKey)).length;
  const counts = Object.fromEntries([...new Set(rows.map((row) => row.actionType))]
    .map((type) => [type, rows.filter((row) => row.actionType === type).length]));
  return {
    rows,
    errors,
    summary: {
      rows: rows.length,
      newRows: rows.length - existingDuplicates,
      duplicates: existingDuplicates + inputDuplicates,
      missingTargets: rows.filter((row) => row.targetMissing).length,
      firstEventAt: rows.at(-1)?.eventAt || null,
      lastEventAt: rows[0]?.eventAt || null,
      counts,
      errors: errors.length
    }
  };
}

function bankAction(reason) {
  if (reason.toLowerCase() === 'deposit') return 'deposit';
  if (reason.toLowerCase() === 'withdrawal') return 'withdrawal';
  return 'system_expense';
}

function previewBank(sourceRows) {
  const db = getDatabase();
  const rowsByKey = new Map();
  const errors = [];
  let inputDuplicates = 0;
  for (let index = 0; index < sourceRows.length; index += 1) {
    const source = sourceRows[index];
    const eventAt = clean(firstByAliases(source, ['date', 'data']));
    const playerName = clean(firstByAliases(source, ['player', 'jogador']));
    const reason = clean(firstByAliases(source, ['reason', 'motivo']));
    let amount;
    try {
      amount = parseInteger(firstByAliases(source, ['amount', 'valor']), { allowNegative: true });
    } catch {
      errors.push({ line: index + 2, message: 'Valor inválido.' });
      continue;
    }
    if (!validEventDate(eventAt) || !playerName || !reason) {
      errors.push({ line: index + 2, message: 'Data, jogador ou motivo inválidos.' });
      continue;
    }
    const actionType = bankAction(reason);
    if ((actionType === 'deposit' && amount < 0) || (actionType !== 'deposit' && amount > 0)) {
      errors.push({ line: index + 2, message: `${reason}: sinal do valor incompatível.` });
      continue;
    }
    const eventKey = hash(`${eventAt}|${normalizeName(playerName)}|${reason}|${amount}`);
    if (rowsByKey.has(eventKey)) {
      inputDuplicates += 1;
      continue;
    }
    rowsByKey.set(eventKey, { eventKey, eventAt, playerName, actionType, reason, amount });
  }
  const rows = [...rowsByKey.values()].sort((a, b) => b.eventAt.localeCompare(a.eventAt));
  const exists = db.prepare('SELECT 1 FROM albion_guild_bank_events WHERE event_key = ?');
  const existingDuplicates = rows.filter((row) => exists.get(row.eventKey)).length;
  const sum = (type) => rows.filter((row) => row.actionType === type).reduce((total, row) => total + row.amount, 0);
  return {
    rows,
    errors,
    summary: {
      rows: rows.length,
      newRows: rows.length - existingDuplicates,
      duplicates: existingDuplicates + inputDuplicates,
      deposits: sum('deposit'),
      withdrawals: sum('withdrawal'),
      systemExpenses: sum('system_expense'),
      netChange: rows.reduce((total, row) => total + row.amount, 0),
      firstEventAt: rows.at(-1)?.eventAt || null,
      lastEventAt: rows[0]?.eventAt || null,
      errors: errors.length
    }
  };
}

function previewOperationalData(text, { kind, sourceName = null, actorId = null } = {}) {
  if (!KINDS.has(kind)) throw new Error('Tipo de dado Albion inválido.');
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const sourceRows = parseDelimitedRows(raw);
  if (!sourceRows.length) throw new Error('O arquivo não possui registros para importar.');
  const parsed = kind === 'food' ? previewFood(sourceRows)
    : kind === 'guild_history' ? previewHistory(sourceRows)
      : previewBank(sourceRows);
  const sourceHash = hash(raw);
  const previousImport = getDatabase().prepare(`
    SELECT id, created_at FROM albion_operational_imports
    WHERE kind = ? AND source_hash = ? LIMIT 1
  `).get(kind, sourceHash);
  return {
    type: 'albion_operational',
    kind,
    kindLabel: KIND_LABELS[kind],
    sourceName,
    sourceHash,
    actorId,
    previousImport: previousImport || null,
    ...parsed
  };
}

const applyTransaction = transaction((preview) => {
  if (preview.type !== 'albion_operational' || !KINDS.has(preview.kind)) throw new Error('Prévia inválida.');
  if (preview.errors.length) throw new Error('Corrija os erros antes de confirmar.');
  if (preview.previousImport) throw new Error('Este mesmo arquivo já foi importado.');
  const db = getDatabase();
  const imported = db.prepare(`
    INSERT INTO albion_operational_imports
      (kind, source_name, source_hash, rows_count, inserted_count, duplicate_count,
       imported_by, first_event_at, last_event_at, summary_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    preview.kind,
    preview.sourceName || null,
    preview.sourceHash,
    preview.summary.rows,
    preview.kind === 'food' ? preview.rows.length : preview.summary.newRows,
    preview.summary.duplicates || 0,
    preview.actorId || null,
    preview.summary.firstEventAt || null,
    preview.summary.lastEventAt || null,
    JSON.stringify(preview.summary)
  );
  const importId = Number(imported.lastInsertRowid);
  let insertedRows = 0;
  if (preview.kind === 'food') {
    const insert = db.prepare(`
      INSERT INTO albion_food_contribution_rows
        (import_id, albion_key, albion_name, guild_role, source_rank, amount, previous_amount, discord_id)
      VALUES (@importId, @albionKey, @albionName, @guildRole, @sourceRank, @amount, @previousAmount, @discordId)
    `);
    for (const row of preview.rows) {
      insert.run({ ...row, importId });
      insertedRows += 1;
    }
  } else if (preview.kind === 'guild_history') {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO albion_guild_history_events
        (event_key, event_at, actor_name, action_type, raw_reason, role_name, target_name, target_missing, first_import_id)
      VALUES (@eventKey, @eventAt, @actorName, @actionType, @rawReason, @roleName, @targetName, @targetMissing, @importId)
    `);
    for (const row of preview.rows) insertedRows += insert.run({ ...row, importId }).changes;
  } else {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO albion_guild_bank_events
        (event_key, event_at, player_name, action_type, reason, amount, first_import_id)
      VALUES (@eventKey, @eventAt, @playerName, @actionType, @reason, @amount, @importId)
    `);
    for (const row of preview.rows) insertedRows += insert.run({ ...row, importId }).changes;
  }
  db.prepare('UPDATE albion_operational_imports SET inserted_count = ? WHERE id = ?').run(insertedRows, importId);
  audit.createAuditLog({
    type: 'albion_operational_data_imported',
    actorId: preview.actorId,
    reason: `${KIND_LABELS[preview.kind]} importado`,
    metadata: { importId, kind: preview.kind, sourceName: preview.sourceName, insertedRows, ...preview.summary }
  });
  return { importId, kind: preview.kind, kindLabel: preview.kindLabel, insertedRows, summary: preview.summary };
});

function applyOperationalPreview(preview) {
  backupDatabase(`before_albion_${preview.kind}_import`);
  return applyTransaction(preview);
}

function savePreview(preview) {
  const id = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  previews.set(id, { ...preview, createdAt: Date.now() });
  return id;
}

function getPreview(id) {
  const preview = previews.get(String(id || ''));
  if (!preview) throw new Error('Prévia expirada. Analise o arquivo novamente.');
  return preview;
}

function confirmPreview(id, actorId) {
  const preview = getPreview(id);
  if (preview.actorId && String(preview.actorId) !== String(actorId)) throw new Error('Esta prévia pertence a outra sessão.');
  const result = applyOperationalPreview(preview);
  previews.delete(String(id));
  return result;
}

function latestImports() {
  return [...KINDS].map((kind) => ({
    kind,
    kindLabel: KIND_LABELS[kind],
    latest: getDatabase().prepare(`
      SELECT id, source_name, rows_count, inserted_count, duplicate_count,
             first_event_at, last_event_at, created_at
      FROM albion_operational_imports WHERE kind = ? ORDER BY id DESC LIMIT 1
    `).get(kind) || null
  }));
}

function foodDashboard() {
  const db = getDatabase();
  const latest = db.prepare(`
    SELECT id, source_name, created_at FROM albion_operational_imports
    WHERE kind = 'food' ORDER BY id DESC LIMIT 1
  `).get();
  if (!latest) return { latest: null, total: 0, contributors: 0, rows: [] };
  const rows = db.prepare(`
    SELECT albion_name, guild_role, source_rank, amount, previous_amount,
           amount - previous_amount AS delta, discord_id
    FROM albion_food_contribution_rows
    WHERE import_id = ? AND amount > 0
    ORDER BY amount DESC, albion_name COLLATE NOCASE
    LIMIT 50
  `).all(latest.id);
  const totals = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total, SUM(CASE WHEN amount > 0 THEN 1 ELSE 0 END) AS contributors
    FROM albion_food_contribution_rows WHERE import_id = ?
  `).get(latest.id);
  return { latest, total: Number(totals.total || 0), contributors: Number(totals.contributors || 0), rows };
}

function historyDashboard() {
  const db = getDatabase();
  const counts = db.prepare(`
    SELECT action_type, COUNT(*) AS count FROM albion_guild_history_events GROUP BY action_type
  `).all();
  return {
    total: Number(db.prepare('SELECT COUNT(*) AS total FROM albion_guild_history_events').get().total || 0),
    missingTargets: Number(db.prepare('SELECT COUNT(*) AS total FROM albion_guild_history_events WHERE target_missing = 1').get().total || 0),
    counts: Object.fromEntries(counts.map((row) => [row.action_type, Number(row.count)])),
    rows: db.prepare(`
      SELECT event_at, actor_name, action_type, raw_reason, role_name, target_name, target_missing
      FROM albion_guild_history_events ORDER BY event_at DESC LIMIT 100
    `).all()
  };
}

function bankDashboard() {
  const db = getDatabase();
  const summary = db.prepare(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN action_type = 'deposit' THEN amount ELSE 0 END), 0) AS deposits,
      COALESCE(SUM(CASE WHEN action_type = 'withdrawal' THEN amount ELSE 0 END), 0) AS withdrawals,
      COALESCE(SUM(CASE WHEN action_type = 'system_expense' THEN amount ELSE 0 END), 0) AS system_expenses,
      COALESCE(SUM(amount), 0) AS net_change
    FROM albion_guild_bank_events
  `).get();
  return {
    total: Number(summary.total || 0),
    deposits: Number(summary.deposits || 0),
    withdrawals: Number(summary.withdrawals || 0),
    systemExpenses: Number(summary.system_expenses || 0),
    netChange: Number(summary.net_change || 0),
    rows: db.prepare(`
      SELECT event_at, player_name, action_type, reason, amount
      FROM albion_guild_bank_events ORDER BY event_at DESC LIMIT 100
    `).all()
  };
}

function getOperationalDashboardData() {
  return {
    imports: latestImports(),
    food: foodDashboard(),
    history: historyDashboard(),
    bank: bankDashboard()
  };
}

module.exports = {
  applyOperationalPreview,
  confirmPreview,
  getOperationalDashboardData,
  getPreview,
  previewOperationalData,
  savePreview
};
