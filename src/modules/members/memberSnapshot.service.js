const { getDatabase, transaction } = require('../../database/connection');
const dailyReport = require('../reports/dailyReport.service');

const MAX_MEMBERS = 1000;

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function parseSnapshotRows(text) {
  const parsed = dailyReport.parseMemberExport(String(text || '').replace(/^\uFEFF/, ''));
  if (!parsed.length) {
    throw new Error('Nenhum membro encontrado. Confira se a tabela possui a coluna "Character Name".');
  }

  const rowsByKey = new Map();
  const duplicates = [];
  for (const row of parsed) {
    if (rowsByKey.has(row.key)) duplicates.push(row.characterName);
    else rowsByKey.set(row.key, row);
  }
  const rows = [...rowsByKey.values()];
  if (rows.length > MAX_MEMBERS) {
    throw new Error(`A lista possui ${rows.length} membros. O limite por importação é ${MAX_MEMBERS}.`);
  }
  return { rows, duplicates };
}

function importMemberSnapshot(text, { sourceName = null, actorId = 'manual' } = {}) {
  const { rows, duplicates } = parseSnapshotRows(text);

  const saved = saveSnapshot({
    sourceName,
    actorId,
    rows
  });
  return { ...saved, duplicates };
}

const saveSnapshot = transaction(({ sourceName, actorId, rows }) => {
  const db = getDatabase();
  const onlineCount = rows.filter((row) => row.isOnline).length;
  const snapshot = db
    .prepare(`
      INSERT INTO member_snapshots (created_by, source_name, member_count, online_count)
      VALUES (?, ?, ?, ?)
    `)
    .run(actorId || 'manual', sourceName || null, rows.length, onlineCount);

  const stmt = db.prepare(`
    INSERT INTO member_snapshot_rows (
      snapshot_id,
      member_key,
      character_name,
      last_seen,
      roles_json,
      is_online,
      last_seen_iso
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of rows) {
    stmt.run(
      snapshot.lastInsertRowid,
      row.key,
      row.characterName,
      row.lastSeen || null,
      JSON.stringify(row.roles || []),
      row.isOnline ? 1 : 0,
      row.lastSeenDate ? row.lastSeenDate.toISOString() : null
    );
  }

  return {
    id: snapshot.lastInsertRowid,
    memberCount: rows.length,
    onlineCount
  };
});

function latestSnapshot() {
  return getDatabase()
    .prepare('SELECT * FROM member_snapshots ORDER BY id DESC LIMIT 1')
    .get();
}

function snapshotRows(snapshotId) {
  if (!snapshotId) return [];
  return getDatabase().prepare(`
    SELECT snapshot_id, member_key, character_name, last_seen, roles_json, is_online, last_seen_iso
    FROM member_snapshot_rows
    WHERE snapshot_id = ?
    ORDER BY character_name COLLATE NOCASE
  `).all(snapshotId).map((row) => ({
    ...row,
    roles: JSON.parse(row.roles_json || '[]')
  }));
}

function linkedUsers() {
  return getDatabase().prepare(`
    SELECT discord_id, discord_name, albion_name, registration_status
    FROM users
    WHERE albion_name IS NOT NULL AND trim(albion_name) <> ''
  `).all();
}

function compareRows(rows, previousRows = []) {
  const users = linkedUsers();
  const usersByName = new Map(users.map((user) => [normalizeName(user.albion_name), user]));
  const currentKeys = new Set(rows.map((row) => row.key || row.member_key));
  const previousKeys = new Set(previousRows.map((row) => row.key || row.member_key));
  const linked = rows.filter((row) => usersByName.has(row.key || row.member_key));
  const unlinked = rows.filter((row) => !usersByName.has(row.key || row.member_key));
  const registeredOutside = users.filter((user) => user.registration_status === 'member' && !currentKeys.has(normalizeName(user.albion_name)));
  const additions = rows.filter((row) => !previousKeys.has(row.key || row.member_key));
  const removals = previousRows.filter((row) => !currentKeys.has(row.key || row.member_key));

  return {
    linkedCount: linked.length,
    unlinkedCount: unlinked.length,
    additions: additions.map((row) => row.characterName || row.character_name),
    removals: removals.map((row) => row.characterName || row.character_name),
    unlinked: unlinked.map((row) => ({
      characterName: row.characterName || row.character_name,
      lastSeen: row.lastSeen ?? row.last_seen ?? null,
      roles: row.roles || []
    })),
    registeredOutside: registeredOutside.map((user) => ({
      discordId: user.discord_id,
      discordName: user.discord_name,
      albionName: user.albion_name
    }))
  };
}

function previewMemberSnapshot(text) {
  const { rows, duplicates } = parseSnapshotRows(text);
  const previous = latestSnapshot();
  const previousRows = previous ? snapshotRows(previous.id) : [];
  const comparison = compareRows(rows, previousRows);
  return {
    memberCount: rows.length,
    onlineCount: rows.filter((row) => row.isOnline).length,
    duplicateCount: duplicates.length,
    duplicates,
    previousSnapshotId: previous?.id || null,
    ...comparison,
    sample: rows.slice(0, 20).map((row) => ({
      characterName: row.characterName,
      lastSeen: row.lastSeen || null,
      roles: row.roles || [],
      linked: comparison.unlinked.every((item) => normalizeName(item.characterName) !== row.key)
    }))
  };
}

function latestSnapshotDetails() {
  const snapshot = latestSnapshot();
  if (!snapshot) return null;
  const rows = snapshotRows(snapshot.id);
  const previous = getDatabase().prepare(`
    SELECT id FROM member_snapshots WHERE id < ? ORDER BY id DESC LIMIT 1
  `).get(snapshot.id);
  const previousRows = previous ? snapshotRows(previous.id) : [];
  return {
    ...snapshot,
    previous_snapshot_id: previous?.id || null,
    ...compareRows(rows, previousRows),
    rows
  };
}

function latestSnapshotLookup() {
  const details = latestSnapshotDetails();
  if (!details) return { snapshot: null, members: new Map() };
  return {
    snapshot: details,
    members: new Map(details.rows.map((row) => [row.member_key, row]))
  };
}

module.exports = {
  importMemberSnapshot,
  latestSnapshot,
  latestSnapshotDetails,
  latestSnapshotLookup,
  parseSnapshotRows,
  previewMemberSnapshot,
  snapshotRows
};
