const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { getDatabase, transaction } = require('../../database/connection');
const { toCsv } = require('../../utils/csv');
const { htmlReportAttachment } = require('../../utils/htmlReport');

const previews = new Map();

function previewPveRank(text, { weekKey = currentWeekKey(), sourceName = null, actorId = null } = {}) {
  const rows = parseDelimitedRows(text);
  const parsed = rows
    .map((row) => ({
      rank: toInt(row.Rank),
      albionName: clean(row.Player),
      guildRole: clean(row['Guild Role']),
      amount: toInt(row.Amount)
    }))
    .filter((row) => row.rank > 0 && row.albionName);
  const totalAmount = parsed.reduce((total, row) => total + row.amount, 0);
  const top = parsed.slice(0, 10);
  return {
    type: 'pve_rank',
    weekKey,
    sourceName,
    actorId,
    rows: parsed,
    summary: {
      players: parsed.length,
      totalAmount,
      top
    }
  };
}

function previewGuildLogs(text, { weekKey = currentWeekKey(), sourceName = null, actorId = null } = {}) {
  const rows = parseDelimitedRows(text);
  const parsed = rows
    .map((row) => {
      const reason = clean(row.Reason);
      return {
        eventDate: clean(row.Date),
        actorName: clean(row.Player),
        rawReason: reason,
        actionType: classifyReason(reason),
        targetHint: extractTargetHint(reason)
      };
    })
    .filter((row) => row.eventDate && row.actorName && row.rawReason);
  const byType = countBy(parsed, (row) => row.actionType);
  const byActor = topCounts(parsed, (row) => row.actorName, 8);
  return {
    type: 'guild_logs',
    weekKey,
    sourceName,
    actorId,
    rows: parsed,
    summary: {
      logs: parsed.length,
      byType,
      byActor
    }
  };
}

const savePveRank = transaction((preview) => {
  const importId = upsertImport({
    importType: 'pve_rank',
    weekKey: preview.weekKey,
    sourceName: preview.sourceName,
    rowsCount: preview.rows.length,
    summary: preview.summary,
    importedBy: preview.actorId
  });
  const db = getDatabase();
  db.prepare('DELETE FROM albion_pve_rankings WHERE import_id = ?').run(importId);
  const stmt = db.prepare(`
    INSERT INTO albion_pve_rankings (import_id, week_key, rank, albion_name, guild_role, amount)
    VALUES (@importId, @weekKey, @rank, @albionName, @guildRole, @amount)
  `);
  for (const row of preview.rows) {
    stmt.run({ importId, weekKey: preview.weekKey, ...row });
  }
  return getImport(importId);
});

const saveGuildLogs = transaction((preview) => {
  const importId = upsertImport({
    importType: 'guild_logs',
    weekKey: preview.weekKey,
    sourceName: preview.sourceName,
    rowsCount: preview.rows.length,
    summary: preview.summary,
    importedBy: preview.actorId
  });
  const db = getDatabase();
  db.prepare('DELETE FROM albion_guild_logs WHERE import_id = ?').run(importId);
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO albion_guild_logs
      (import_id, week_key, event_date, actor_name, action_type, raw_reason, target_hint)
    VALUES
      (@importId, @weekKey, @eventDate, @actorName, @actionType, @rawReason, @targetHint)
  `);
  for (const row of preview.rows) {
    stmt.run({ importId, weekKey: preview.weekKey, ...row });
  }
  return getImport(importId);
});

function weeklySummaryEmbed(weekKey = currentWeekKey()) {
  const rank = getImportByTypeWeek('pve_rank', weekKey);
  const logs = getImportByTypeWeek('guild_logs', weekKey);
  const topPve = listPveRank(weekKey, 10);
  const logTypes = listGuildLogTypeCounts(weekKey);
  const logActors = listGuildLogActorCounts(weekKey, 8);
  return new EmbedBuilder()
    .setTitle(`Resumo Albion semanal ${weekKey}`)
    .addFields(
      {
        name: 'Rank PvE',
        value: rank
          ? [`Jogadores: ${rank.rows_count}`, ...topPve.map((row) => `${row.rank}. ${row.albion_name} - ${formatCompact(row.amount)}`)].join('\n')
          : 'Rank PvE ainda nao importado.',
        inline: false
      },
      {
        name: 'Logs gerais',
        value: logs
          ? [`Logs: ${logs.rows_count}`, ...logTypes.map((row) => `${typeLabel(row.action_type)}: ${row.total}`)].join('\n')
          : 'Logs gerais ainda nao importados.',
        inline: true
      },
      {
        name: 'Atores mais ativos',
        value: logActors.length ? logActors.map((row) => `${row.actor_name}: ${row.total}`).join('\n') : 'Sem dados.',
        inline: true
      }
    )
    .setColor(0x38a169)
    .setTimestamp(new Date());
}

function pveRankCsvAttachment(weekKey = currentWeekKey()) {
  const rows = listPveRank(weekKey, 1000);
  const csv = toCsv(rows, ['week_key', 'rank', 'albion_name', 'guild_role', 'amount']);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: `albion-pve-rank-${safeFilePart(weekKey)}.csv` });
}

function pveRankReportAttachment(weekKey = currentWeekKey()) {
  const rows = listPveRank(weekKey, 1000);
  return htmlReportAttachment({
    title: `Rank PvE Albion ${weekKey}`,
    fileName: `albion-pve-rank-${safeFilePart(weekKey)}.html`,
    csvName: `albion-pve-rank-${safeFilePart(weekKey)}.csv`,
    rows,
    columns: [
      'week_key',
      { key: 'rank', label: 'rank', align: 'right' },
      'albion_name',
      'guild_role',
      { key: 'amount', label: 'amount', align: 'right', format: formatCompact }
    ],
    summary: [
      ['Jogadores', rows.length],
      ['Fama total', formatCompact(rows.reduce((total, row) => total + Number(row.amount || 0), 0))]
    ]
  });
}

function guildLogsCsvAttachment(weekKey = currentWeekKey()) {
  const rows = getDatabase()
    .prepare(`
      SELECT week_key, event_date, actor_name, action_type, target_hint, raw_reason
      FROM albion_guild_logs
      WHERE week_key = ?
      ORDER BY event_date DESC
    `)
    .all(weekKey);
  const csv = toCsv(rows, ['week_key', 'event_date', 'actor_name', 'action_type', 'target_hint', 'raw_reason']);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: `albion-guild-logs-${safeFilePart(weekKey)}.csv` });
}

function guildLogsReportAttachment(weekKey = currentWeekKey()) {
  const rows = getDatabase()
    .prepare(`
      SELECT week_key, event_date, actor_name, action_type, target_hint, raw_reason
      FROM albion_guild_logs
      WHERE week_key = ?
      ORDER BY event_date DESC
    `)
    .all(weekKey);
  return htmlReportAttachment({
    title: `Logs Albion ${weekKey}`,
    fileName: `albion-guild-logs-${safeFilePart(weekKey)}.html`,
    csvName: `albion-guild-logs-${safeFilePart(weekKey)}.csv`,
    rows,
    columns: ['week_key', 'event_date', 'actor_name', 'action_type', 'target_hint', 'raw_reason'],
    summary: [
      ['Logs', rows.length],
      ['Atores', new Set(rows.map((row) => row.actor_name).filter(Boolean)).size]
    ]
  });
}

function previewText(preview) {
  if (preview.type === 'pve_rank') {
    return [
      `Previa Rank PvE ${preview.weekKey}`,
      `Jogadores: ${preview.summary.players}`,
      `Fama total: ${preview.summary.totalAmount}`,
      '',
      'Top 5:',
      ...preview.summary.top.slice(0, 5).map((row) => `${row.rank}. ${row.albionName} - ${formatCompact(row.amount)}`)
    ].join('\n');
  }

  const byType = Object.entries(preview.summary.byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, total]) => `${typeLabel(type)}: ${total}`);
  return [
    `Previa Logs Albion ${preview.weekKey}`,
    `Linhas: ${preview.summary.logs}`,
    '',
    ...byType,
    '',
    'Atores mais ativos:',
    ...preview.summary.byActor.map((row) => `${row.key}: ${row.total}`)
  ].join('\n');
}

function savePreview(preview) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  previews.set(id, { ...preview, createdAt: Date.now() });
  return id;
}

function takePreview(id) {
  const preview = previews.get(id);
  previews.delete(id);
  if (!preview) throw new Error('Previa expirada. Rode o comando de importacao novamente.');
  return preview;
}

function cancelPreview(id) {
  previews.delete(id);
}

function applyPreview(preview) {
  if (preview.type === 'pve_rank') return savePveRank(preview);
  if (preview.type === 'guild_logs') return saveGuildLogs(preview);
  throw new Error('Tipo de importacao Albion desconhecido.');
}

function upsertImport({ importType, weekKey, sourceName, rowsCount, summary, importedBy }) {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO albion_imports (import_type, week_key, source_name, rows_count, summary_json, imported_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(import_type, week_key) DO UPDATE SET
      source_name = excluded.source_name,
      rows_count = excluded.rows_count,
      summary_json = excluded.summary_json,
      imported_by = excluded.imported_by,
      created_at = CURRENT_TIMESTAMP
  `).run(importType, weekKey, sourceName || null, rowsCount, JSON.stringify(summary), importedBy || null);
  return db.prepare('SELECT id FROM albion_imports WHERE import_type = ? AND week_key = ?').get(importType, weekKey).id;
}

function getImport(id) {
  return getDatabase().prepare('SELECT * FROM albion_imports WHERE id = ?').get(id);
}

function getImportByTypeWeek(importType, weekKey) {
  return getDatabase()
    .prepare('SELECT * FROM albion_imports WHERE import_type = ? AND week_key = ?')
    .get(importType, weekKey);
}

function listPveRank(weekKey, limit) {
  return getDatabase()
    .prepare(`
      SELECT week_key, rank, albion_name, guild_role, amount
      FROM albion_pve_rankings
      WHERE week_key = ?
      ORDER BY rank ASC
      LIMIT ?
    `)
    .all(weekKey, limit);
}

function listGuildLogTypeCounts(weekKey) {
  return getDatabase()
    .prepare(`
      SELECT action_type, COUNT(*) AS total
      FROM albion_guild_logs
      WHERE week_key = ?
      GROUP BY action_type
      ORDER BY total DESC
    `)
    .all(weekKey);
}

function listGuildLogActorCounts(weekKey, limit) {
  return getDatabase()
    .prepare(`
      SELECT actor_name, COUNT(*) AS total
      FROM albion_guild_logs
      WHERE week_key = ?
      GROUP BY actor_name
      ORDER BY total DESC, actor_name COLLATE NOCASE
      LIMIT ?
    `)
    .all(weekKey, limit);
}

function parseDelimitedRows(text) {
  const rows = parseRows(String(text || ''));
  const [headers, ...data] = rows;
  if (!headers) return [];
  const keys = headers.map(clean);
  return data.map((cells) => Object.fromEntries(keys.map((key, index) => [key, cells[index] || ''])));
}

function parseRows(text) {
  const delimiter = text.includes('\t') ? '\t' : ',';
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

function classifyReason(reason) {
  const text = String(reason || '').toLowerCase();
  if (text.includes('accepted')) return 'accepted';
  if (text.includes('invited')) return 'invited';
  if (text.includes('left the guild')) return 'left';
  if (text.includes('kicked')) return 'kicked';
  if (text.includes('assigned')) return 'assigned_role';
  return 'other';
}

function extractTargetHint(reason) {
  const match = String(reason || '').match(/to \[b\](.+?)\[\/b\]|\[b\](.+?)\[\/b\]/i);
  const value = clean(match?.[1] || match?.[2] || '');
  return value && value !== '{0}' ? value : '';
}

function countBy(rows, fn) {
  return rows.reduce((acc, row) => {
    const key = fn(row);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function topCounts(rows, fn, limit) {
  const counts = countBy(rows, fn);
  return Object.entries(counts)
    .map(([key, total]) => ({ key, total }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function typeLabel(type) {
  const labels = {
    accepted: 'Aceitos',
    invited: 'Convites',
    left: 'Saidas',
    kicked: 'Kicks',
    assigned_role: 'Cargos alterados',
    other: 'Outros'
  };
  return labels[type] || type;
}

function currentWeekKey(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const diffDays = Math.floor((date - start) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function toInt(value) {
  const number = Number(String(value || '').replace(/\D+/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function clean(value) {
  return String(value || '').replace(/^"|"$/g, '').trim();
}

function formatCompact(value) {
  const number = Number(value || 0);
  if (number >= 1000000) return `${Math.round((number / 1000000) * 10) / 10}m`;
  if (number >= 1000) return `${Math.round(number / 1000)}k`;
  return String(number);
}

function safeFilePart(value) {
  return String(value || 'semana').replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'semana';
}

module.exports = {
  currentWeekKey,
  applyPreview,
  cancelPreview,
  guildLogsCsvAttachment,
  guildLogsReportAttachment,
  previewGuildLogs,
  previewPveRank,
  previewText,
  pveRankCsvAttachment,
  pveRankReportAttachment,
  saveGuildLogs,
  savePreview,
  savePveRank,
  takePreview,
  weeklySummaryEmbed
};
