const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getDatabase, transaction } = require('../../database/connection');
const audit = require('../audit/audit.repository');
const { htmlReportAttachment } = require('../../utils/htmlReport');
const { formatSilver } = require('../../utils/silver');

const previews = new Map();

const categoryColumns = {
  pve: 'pve_fame',
  pvp: 'pvp_fame',
  gathering: 'gathering_fame',
  crafting: 'crafting_fame'
};

const categoryLabels = {
  pve: 'PvE',
  pvp: 'PvP',
  gathering: 'Coleta',
  crafting: 'Craft'
};

const fameColumns = {
  total_fame: 'total_fame',
  pve_fame: 'pve_fame',
  pvp_fame: 'pvp_fame',
  gathering_fame: 'gathering_fame',
  crafting_fame: 'crafting_fame'
};

function previewFameTotals(text, { sourceName = null, actorId = null } = {}) {
  const rows = parseDelimitedRows(text);
  const parsed = rows
    .map(normalizeFameRow)
    .filter((row) => row.albionName)
    .map((row) => {
      const total = row.totalFame || row.pveFame + row.pvpFame + row.gatheringFame + row.craftingFame;
      return {
        albionKey: normalizeName(row.albionName),
        albionName: row.albionName,
        totalFame: total,
        pveFame: row.pveFame,
        pvpFame: row.pvpFame,
        gatheringFame: row.gatheringFame,
        craftingFame: row.craftingFame
      };
    });

  const byName = new Map();
  for (const row of parsed) byName.set(row.albionKey, row);
  const uniqueRows = [...byName.values()].sort((a, b) => b.totalFame - a.totalFame || a.albionName.localeCompare(b.albionName));

  return {
    type: 'fame_total',
    sourceName,
    actorId,
    rows: uniqueRows,
    summary: {
      players: uniqueRows.length,
      totalFame: uniqueRows.reduce((total, row) => total + row.totalFame, 0),
      pveFame: uniqueRows.reduce((total, row) => total + row.pveFame, 0),
      pvpFame: uniqueRows.reduce((total, row) => total + row.pvpFame, 0),
      gatheringFame: uniqueRows.reduce((total, row) => total + row.gatheringFame, 0),
      craftingFame: uniqueRows.reduce((total, row) => total + row.craftingFame, 0),
      top: uniqueRows.slice(0, 8)
    }
  };
}

function previewPveFame(text, { sourceName = null, actorId = null } = {}) {
  const rows = parseDelimitedRows(text);
  const byName = new Map();
  for (const sourceRow of rows) {
    const albionName = clean(firstByAliases(sourceRow, ['player', 'character name', 'character_name', 'nome', 'nick', 'albion', 'albion_name', 'jogador']));
    const pveFame = parseFameNumber(firstByAliases(sourceRow, ['amount', 'pve', 'pve fame', 'fama pve', 'fame pve']));
    const albionKey = normalizeName(albionName);
    if (albionKey) byName.set(albionKey, { albionKey, albionName, pveFame });
  }
  const uniqueRows = [...byName.values()].sort((a, b) => b.pveFame - a.pveFame || a.albionName.localeCompare(b.albionName));
  return {
    type: 'fame_pve',
    sourceName,
    actorId,
    rows: uniqueRows,
    summary: {
      players: uniqueRows.length,
      totalFame: 0,
      pveFame: uniqueRows.reduce((total, row) => total + row.pveFame, 0),
      pvpFame: 0,
      gatheringFame: 0,
      craftingFame: 0,
      top: uniqueRows.slice(0, 8)
    }
  };
}

function previewCategoryFame(text, { category, sourceName = null, actorId = null } = {}) {
  const column = categoryColumns[category];
  if (!column) throw new Error('Categoria de fama inválida.');
  const sourceRows = parseDelimitedRows(text);
  if (!sourceRows.length) throw new Error('A tabela não possui jogadores para importar.');

  const db = getDatabase();
  const currentRows = new Map(db.prepare(`SELECT albion_key, albion_name, ${column} AS amount FROM albion_fame_totals`).all()
    .map((row) => [row.albion_key, row]));
  const users = new Map(db.prepare(`
    SELECT lower(albion_name) AS albion_key, discord_id
    FROM users
    WHERE albion_name IS NOT NULL AND trim(albion_name) <> ''
  `).all().map((row) => [normalizeName(row.albion_key), row.discord_id]));

  const parsed = [];
  const errors = [];
  const seen = new Map();
  for (let index = 0; index < sourceRows.length; index += 1) {
    const sourceRow = sourceRows[index];
    const albionName = clean(firstByAliases(sourceRow, ['player', 'character name', 'character_name', 'nome', 'nick', 'albion', 'albion_name', 'jogador']));
    const albionKey = normalizeName(albionName);
    const amountRaw = firstByAliases(sourceRow, ['amount', 'valor', 'fame', 'fama']);
    const sourceRank = parseOptionalInteger(firstByAliases(sourceRow, ['rank', 'posição', 'posicao']));
    const guildRole = clean(firstByAliases(sourceRow, ['guild role', 'guild_role', 'role', 'cargo']));
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
      amount = parseCategoryAmount(amountRaw);
    } catch (error) {
      errors.push({ line: index + 2, message: `${albionName}: ${error.message}` });
      continue;
    }
    seen.set(albionKey, true);
    const previousAmount = Number(currentRows.get(albionKey)?.amount || 0);
    parsed.push({
      albionKey,
      albionName,
      guildRole: guildRole || null,
      sourceRank,
      amount,
      previousAmount,
      delta: amount - previousAmount,
      discordId: users.get(albionKey) || null,
      reduction: amount < previousAmount
    });
  }

  parsed.sort((a, b) => b.amount - a.amount || a.albionName.localeCompare(b.albionName));
  const importedKeys = new Set(parsed.map((row) => row.albionKey));
  const missing = [...currentRows.values()]
    .filter((row) => Number(row.amount || 0) > 0 && !importedKeys.has(row.albion_key))
    .map((row) => ({ albionKey: row.albion_key, albionName: row.albion_name, amount: Number(row.amount || 0) }));
  const reductions = parsed.filter((row) => row.reduction);
  const unmatched = parsed.filter((row) => !row.discordId);

  return {
    type: 'fame_category',
    category,
    categoryLabel: categoryLabels[category],
    sourceName,
    actorId,
    rows: parsed,
    errors,
    missing,
    summary: {
      players: parsed.length,
      withPoints: parsed.filter((row) => row.amount > 0).length,
      zero: parsed.filter((row) => row.amount === 0).length,
      linked: parsed.length - unmatched.length,
      unmatched: unmatched.length,
      missing: missing.length,
      reductions: reductions.length,
      totalAmount: parsed.reduce((total, row) => total + row.amount, 0),
      errors: errors.length
    }
  };
}

const applyCategoryPreviewTransaction = transaction((preview) => {
  if (preview.type !== 'fame_category' || !categoryColumns[preview.category]) throw new Error('Prévia de categoria inválida.');
  if (preview.errors.length) throw new Error('Corrija os erros da tabela antes de confirmar.');
  const db = getDatabase();
  const result = db.prepare(`
    INSERT INTO albion_fame_category_imports
      (category, source_name, rows_count, linked_count, unmatched_count, missing_count, reductions_count, imported_by, summary_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    preview.category,
    preview.sourceName || null,
    preview.rows.length,
    preview.summary.linked,
    preview.summary.unmatched,
    preview.summary.missing,
    preview.summary.reductions,
    preview.actorId || null,
    JSON.stringify(preview.summary)
  );
  const importId = Number(result.lastInsertRowid);
  const insertRow = db.prepare(`
    INSERT INTO albion_fame_category_rows
      (import_id, albion_key, albion_name, guild_role, source_rank, amount, previous_amount, discord_id)
    VALUES (@importId, @albionKey, @albionName, @guildRole, @sourceRank, @amount, @previousAmount, @discordId)
  `);
  const updateTotal = db.prepare(`
    INSERT INTO albion_fame_totals (albion_key, albion_name, ${categoryColumns[preview.category]}, updated_at)
    VALUES (@albionKey, @albionName, @amount, CURRENT_TIMESTAMP)
    ON CONFLICT(albion_key) DO UPDATE SET
      albion_name = excluded.albion_name,
      ${categoryColumns[preview.category]} = excluded.${categoryColumns[preview.category]},
      updated_at = CURRENT_TIMESTAMP
  `);
  for (const row of preview.rows) {
    insertRow.run({ ...row, importId });
    updateTotal.run(row);
  }
  db.exec(`
    UPDATE albion_fame_totals
    SET total_fame = pve_fame + pvp_fame + gathering_fame + crafting_fame
  `);
  audit.createAuditLog({
    type: 'albion_fame_category_imported',
    actorId: preview.actorId,
    reason: `Importação manual de ${categoryLabels[preview.category]} All-time`,
    metadata: { importId, category: preview.category, sourceName: preview.sourceName, ...preview.summary }
  });
  return { importId, category: preview.category, categoryLabel: categoryLabels[preview.category], summary: preview.summary };
});

function applyCategoryPreview(preview, { confirmReductions = false } = {}) {
  if (preview.summary.reductions > 0 && !confirmReductions) {
    throw new Error('Confirme as reduções All-time antes de importar.');
  }
  return applyCategoryPreviewTransaction(preview);
}

const undoLatestCategoryImportTransaction = transaction(({ category, actorId }) => {
  const column = categoryColumns[category];
  if (!column) throw new Error('Categoria de fama inválida.');
  const db = getDatabase();
  const latest = db.prepare(`
    SELECT * FROM albion_fame_category_imports
    WHERE category = ? AND undone_at IS NULL
    ORDER BY id DESC LIMIT 1
  `).get(category);
  if (!latest) throw new Error(`Não há importação de ${categoryLabels[category]} para desfazer.`);
  const rows = db.prepare('SELECT * FROM albion_fame_category_rows WHERE import_id = ?').all(latest.id);
  const previous = db.prepare(`
    SELECT r.amount
    FROM albion_fame_category_rows r
    JOIN albion_fame_category_imports i ON i.id = r.import_id
    WHERE i.category = ? AND i.undone_at IS NULL AND i.id < ? AND r.albion_key = ?
    ORDER BY i.id DESC LIMIT 1
  `);
  const update = db.prepare(`UPDATE albion_fame_totals SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE albion_key = ?`);
  for (const row of rows) {
    const prior = previous.get(category, latest.id, row.albion_key);
    update.run(Number(prior?.amount || 0), row.albion_key);
  }
  db.prepare(`UPDATE albion_fame_category_imports SET undone_at = CURRENT_TIMESTAMP, undone_by = ? WHERE id = ?`)
    .run(actorId || null, latest.id);
  db.exec('UPDATE albion_fame_totals SET total_fame = pve_fame + pvp_fame + gathering_fame + crafting_fame');
  audit.createAuditLog({
    type: 'albion_fame_category_import_undone',
    actorId,
    reason: `Última importação de ${categoryLabels[category]} desfeita`,
    metadata: { importId: latest.id, category }
  });
  return { importId: latest.id, category, categoryLabel: categoryLabels[category], restoredRows: rows.length };
});

function undoLatestCategoryImport(category, actorId) {
  return undoLatestCategoryImportTransaction({ category, actorId });
}

function listCategoryImportStatus() {
  const db = getDatabase();
  return Object.keys(categoryColumns).map((category) => {
    const latest = db.prepare(`
      SELECT id, category, source_name, rows_count, linked_count, unmatched_count, missing_count,
             reductions_count, imported_by, created_at
      FROM albion_fame_category_imports
      WHERE category = ? AND undone_at IS NULL
      ORDER BY id DESC LIMIT 1
    `).get(category);
    return { category, categoryLabel: categoryLabels[category], latest: latest || null };
  });
}

const applyPreview = transaction((preview) => {
  const db = getDatabase();
  const importResult = db.prepare(`
    INSERT INTO albion_fame_imports (source_name, rows_count, summary_json, imported_by)
    VALUES (?, ?, ?, ?)
  `).run(preview.sourceName || null, preview.rows.length, JSON.stringify(preview.summary), preview.actorId || null);

  const importId = importResult.lastInsertRowid;
  const stmt = preview.type === 'fame_pve' ? db.prepare(`
    INSERT INTO albion_fame_totals
      (albion_key, albion_name, total_fame, pve_fame, pvp_fame, gathering_fame, crafting_fame, import_id, updated_at)
    VALUES
      (@albionKey, @albionName, @pveFame, @pveFame, 0, 0, 0, @importId, CURRENT_TIMESTAMP)
    ON CONFLICT(albion_key) DO UPDATE SET
      albion_name = excluded.albion_name,
      total_fame = MAX(albion_fame_totals.total_fame, excluded.pve_fame),
      pve_fame = excluded.pve_fame,
      import_id = excluded.import_id,
      updated_at = CURRENT_TIMESTAMP
  `) : db.prepare(`
    INSERT INTO albion_fame_totals
      (albion_key, albion_name, total_fame, pve_fame, pvp_fame, gathering_fame, crafting_fame, import_id, updated_at)
    VALUES
      (@albionKey, @albionName, @totalFame, @pveFame, @pvpFame, @gatheringFame, @craftingFame, @importId, CURRENT_TIMESTAMP)
    ON CONFLICT(albion_key) DO UPDATE SET
      albion_name = excluded.albion_name,
      total_fame = excluded.total_fame,
      pve_fame = excluded.pve_fame,
      pvp_fame = excluded.pvp_fame,
      gathering_fame = excluded.gathering_fame,
      crafting_fame = excluded.crafting_fame,
      import_id = excluded.import_id,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const row of preview.rows) {
    stmt.run({ ...row, importId });
  }

  audit.createAuditLog({
    type: preview.type === 'fame_pve' ? 'albion_pve_fame_imported' : 'albion_fame_imported',
    actorId: preview.actorId,
    reason: preview.type === 'fame_pve' ? 'Importacao manual de fama PvE Albion' : 'Importacao manual de fama total Albion',
    metadata: {
      sourceName: preview.sourceName,
      rows: preview.rows.length,
      totalFame: preview.summary.totalFame
    }
  });

  return { importId, rowsCount: preview.rows.length };
});

function previewText(preview) {
  if (preview.type === 'fame_pve') {
    return [
      'Previa da fama PvE Albion',
      `Arquivo: ${preview.sourceName || 'anexo'}`,
      `Jogadores: ${preview.summary.players}`,
      `PvE: ${formatFame(preview.summary.pveFame)}`,
      '',
      'Top por fama PvE:',
      ...preview.summary.top.slice(0, 5).map((row, index) => `${index + 1}. ${row.albionName} - ${formatFame(row.pveFame)}`),
      '',
      'Somente PvE sera atualizado. PvP, Coleta e Craft serao preservados.'
    ].join('\n');
  }
  return [
    'Previa da fama total Albion',
    `Arquivo: ${preview.sourceName || 'anexo'}`,
    `Jogadores: ${preview.summary.players}`,
    `PvE: ${formatFame(preview.summary.pveFame)}`,
    `PvP: ${formatFame(preview.summary.pvpFame)}`,
    `Coleta: ${formatFame(preview.summary.gatheringFame)}`,
    `Craft: ${formatFame(preview.summary.craftingFame)}`,
    '',
    'Top por fama total:',
    ...preview.summary.top.slice(0, 5).map((row, index) => (
      `${index + 1}. ${row.albionName} - total ${formatFame(row.totalFame)} | PvE ${formatFame(row.pveFame)}`
    )),
    '',
    'Confirme apenas se os numeros parecerem certos. Isso nao altera saldos.'
  ].join('\n');
}

function previewAttachment(preview) {
  if (preview.type === 'fame_pve') {
    return htmlReportAttachment({
      title: 'Previa fama PvE Albion',
      fileName: 'previa-fama-pve-albion.html',
      csvName: 'previa-fama-pve-albion.csv',
      rows: preview.rows.map((row) => ({ albion_name: row.albionName, pve_fame: row.pveFame })),
      columns: ['albion_name', { key: 'pve_fame', label: 'pve_fame', align: 'right', format: formatFame }],
      summary: [['Jogadores', preview.rows.length], ['PvE', formatFame(preview.summary.pveFame)]]
    });
  }
  return htmlReportAttachment({
    title: 'Previa fama total Albion',
    fileName: 'previa-fama-total-albion.html',
    csvName: 'previa-fama-total-albion.csv',
    rows: preview.rows.map(printableFameRow),
    columns: fameReportColumns(),
    summary: [
      ['Jogadores', preview.rows.length],
      ['PvE', formatFame(preview.summary.pveFame)],
      ['PvP', formatFame(preview.summary.pvpFame)],
      ['Coleta', formatFame(preview.summary.gatheringFame)],
      ['Craft', formatFame(preview.summary.craftingFame)]
    ]
  });
}

function savePreview(preview) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  previews.set(id, { ...preview, createdAt: Date.now() });
  return id;
}

function takePreview(id) {
  const preview = previews.get(id);
  previews.delete(id);
  if (!preview) throw new Error('Previa expirada. Envie o arquivo novamente.');
  return preview;
}

function getPreview(id) {
  const preview = previews.get(id);
  if (!preview) throw new Error('Prévia expirada. Envie a tabela novamente.');
  return preview;
}

function cancelPreview(id) {
  previews.delete(id);
}

function confirmComponents(previewId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`albion_fame:confirm:${previewId}`).setLabel('Confirmar fama').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`albion_fame:cancel:${previewId}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function getFameByAlbionName(albionName) {
  const key = normalizeName(albionName);
  if (!key) return null;
  return getDatabase()
    .prepare('SELECT * FROM albion_fame_totals WHERE albion_key = ?')
    .get(key);
}

function rankFor(column, value) {
  if (!fameColumns[column] || Number(value || 0) <= 0) return null;
  return Number(getDatabase()
    .prepare(`SELECT COUNT(*) + 1 AS rank FROM albion_fame_totals WHERE ${fameColumns[column]} > ?`)
    .get(value)?.rank || 1);
}

function latestImport() {
  return getDatabase()
    .prepare('SELECT * FROM albion_fame_imports ORDER BY id DESC LIMIT 1')
    .get();
}

function listFameTotals() {
  return getDatabase()
    .prepare(`
      SELECT
        ft.*,
        u.discord_id,
        u.discord_name,
        u.registration_status
      FROM albion_fame_totals ft
      LEFT JOIN users u ON lower(u.albion_name) = lower(ft.albion_name)
      ORDER BY ft.total_fame DESC, ft.albion_name COLLATE NOCASE
    `)
    .all();
}

function rankRowsAttachment(rows, title = 'Rank geral de membros') {
  return htmlReportAttachment({
    title,
    fileName: 'rank-geral-membros.html',
    csvName: 'rank-geral-membros.csv',
    rows,
    columns: [
      { key: 'discord_id', label: 'discord_id' },
      { key: 'discord_name', label: 'discord_name' },
      { key: 'albion_name', label: 'albion_name' },
      { key: 'registration_status', label: 'status' },
      { key: 'guild_member', label: 'guild_member' },
      { key: 'balance', label: 'saldo', align: 'right', format: formatSilver },
      { key: 'earned', label: 'total_acumulado', align: 'right', format: formatSilver },
      { key: 'withdrawn', label: 'sacado', align: 'right', format: formatSilver },
      { key: 'voice_time', label: 'voz_total' },
      { key: 'event_time', label: 'tempo_eventos' },
      { key: 'tank_points', label: 'tank', align: 'right' },
      { key: 'healer_points', label: 'healer', align: 'right' },
      { key: 'support_points', label: 'suporte', align: 'right' },
      { key: 'dps_points', label: 'dps', align: 'right' },
      { key: 'caller_points', label: 'caller', align: 'right' },
      { key: 'pve_fame', label: 'fama_pve', align: 'right', format: formatFame },
      { key: 'pvp_fame', label: 'fama_pvp', align: 'right', format: formatFame },
      { key: 'gathering_fame', label: 'fama_coleta', align: 'right', format: formatFame },
      { key: 'crafting_fame', label: 'fama_craft', align: 'right', format: formatFame }
    ],
    summary: [
      ['Membros', rows.length],
      ['Com fame Albion', rows.filter((row) => Number(row.total_fame || 0) > 0).length]
    ]
  });
}

function fameReportColumns() {
  return [
    'albion_name',
    { key: 'total_fame', label: 'total_fame', align: 'right', format: formatFame },
    { key: 'pve_fame', label: 'pve_fame', align: 'right', format: formatFame },
    { key: 'pvp_fame', label: 'pvp_fame', align: 'right', format: formatFame },
    { key: 'gathering_fame', label: 'gathering_fame', align: 'right', format: formatFame },
    { key: 'crafting_fame', label: 'crafting_fame', align: 'right', format: formatFame }
  ];
}

function printableFameRow(row) {
  return {
    albion_name: row.albionName || row.albion_name || '',
    total_fame: row.totalFame ?? row.total_fame ?? 0,
    pve_fame: row.pveFame ?? row.pve_fame ?? 0,
    pvp_fame: row.pvpFame ?? row.pvp_fame ?? 0,
    gathering_fame: row.gatheringFame ?? row.gathering_fame ?? 0,
    crafting_fame: row.craftingFame ?? row.crafting_fame ?? 0
  };
}

function normalizeFameRow(row) {
  return {
    albionName: clean(firstByAliases(row, ['character name', 'character_name', 'player', 'nome', 'nick', 'albion', 'albion_name', 'jogador'])),
    totalFame: parseFameNumber(firstByAliases(row, ['total fame', 'fama total', 'total_fame', 'fame total', 'total'])),
    pveFame: parseFameNumber(firstByAliases(row, ['pve', 'pve fame', 'fama pve', 'fame pve', 'fame for killing mobs', 'fame for mobs', 'killing mobs'])),
    pvpFame: parseFameNumber(firstByAliases(row, ['pvp', 'pvp fame', 'fama pvp', 'fame pvp', 'fame for killing players', 'killing players'])),
    gatheringFame: parseFameNumber(firstByAliases(row, ['coleta', 'gathering', 'gathering fame', 'fama coleta', 'fame for gathering'])),
    craftingFame: parseFameNumber(firstByAliases(row, ['craft', 'crafting', 'crafting fame', 'fama craft', 'fame for crafting', 'raft']))
  };
}

function firstByAliases(row, aliases) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.has(normalizeHeader(key))) return value;
  }
  return '';
}

function parseDelimitedRows(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const rows = parseRows(raw, detectDelimiter(raw));
  const [headers, ...data] = rows;
  if (!headers) return [];
  return data.map((cells) => Object.fromEntries(headers.map((header, index) => [clean(header), cells[index] || ''])));
}

function detectDelimiter(text) {
  const firstLine = String(text || '').split(/\r?\n/).find((line) => line.trim()) || '';
  const candidates = ['\t', ';', ','];
  return candidates
    .map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter || ',';
}

function parseRows(text, delimiter) {
  const rows = [];
  let cell = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
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

function parseFameNumber(value) {
  let text = String(value || '').trim().toLowerCase();
  if (!text) return 0;
  text = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');

  let multiplier = 1;
  if (/b$|bilhao|bilhoes|billion/.test(text)) multiplier = 1000000000;
  else if (/m$|milhao|milhoes|million/.test(text)) multiplier = 1000000;
  else if (/k$|mil$|thousand/.test(text)) multiplier = 1000;

  let numeric = text
    .replace(/bilhoes|bilhao|billion|milhoes|milhao|million|thousand|mil/g, '')
    .replace(/[^\d.,-]/g, '');
  if (!numeric) return 0;

  if (multiplier > 1) {
    numeric = numeric.replace(',', '.');
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(numeric)) {
    numeric = numeric.replace(/[.,]/g, '');
  } else {
    const commaCount = (numeric.match(/,/g) || []).length;
    const dotCount = (numeric.match(/\./g) || []).length;
    if (commaCount && dotCount) {
      const lastComma = numeric.lastIndexOf(',');
      const lastDot = numeric.lastIndexOf('.');
      const decimal = lastComma > lastDot ? ',' : '.';
      const thousand = decimal === ',' ? '.' : ',';
      numeric = numeric.replaceAll(thousand, '').replace(decimal, '.');
    } else if (commaCount === 1 && dotCount === 0) {
      numeric = numeric.replace(',', '.');
    }
  }

  const number = Number(numeric);
  return Number.isFinite(number) ? Math.round(number * multiplier) : 0;
}

function parseCategoryAmount(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('valor não informado.');
  if (raw.startsWith('-')) throw new Error('o valor não pode ser negativo.');
  const parsed = parseFameNumber(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('valor inválido.');
  if (parsed === 0 && !/^['"\s]*0(?:[.,]0+)?['"\s]*$/i.test(raw)) throw new Error('valor inválido.');
  return parsed;
}

function parseOptionalInteger(value) {
  const parsed = Number(String(value || '').replace(/[^\d]/g, ''));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatFame(value) {
  const number = Number(value || 0);
  if (number >= 1000000000) return `${trimDecimal(number / 1000000000)}b`;
  if (number >= 1000000) return `${trimDecimal(number / 1000000)}m`;
  if (number >= 1000) return `${trimDecimal(number / 1000)}k`;
  return String(Math.round(number));
}

function trimDecimal(value) {
  return (Math.round(value * 100) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function clean(value) {
  return String(value || '').replace(/^"|"$/g, '').trim();
}

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

module.exports = {
  applyCategoryPreview,
  applyPreview,
  cancelPreview,
  confirmComponents,
  formatFame,
  getPreview,
  getFameByAlbionName,
  latestImport,
  listFameTotals,
  listCategoryImportStatus,
  previewAttachment,
  previewCategoryFame,
  previewFameTotals,
  previewPveFame,
  previewText,
  rankFor,
  rankRowsAttachment,
  savePreview,
  takePreview,
  undoLatestCategoryImport
};
