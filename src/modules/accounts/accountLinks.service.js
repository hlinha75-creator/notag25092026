const { getDatabase, transaction } = require('../../database/connection');

const mergePreviews = new Map();
const MERGE_PREVIEW_TTL_MS = 15 * 60 * 1000;

function resolvePrimaryUserId(userId) {
  const id = String(userId || '').trim();
  if (!id) return id;
  if (!tableExists()) return id;
  const row = getDatabase()
    .prepare('SELECT primary_discord_id FROM linked_discord_accounts WHERE linked_discord_id = ?')
    .get(id);
  return row?.primary_discord_id || id;
}

function linkedUserIds(userId) {
  const primaryId = resolvePrimaryUserId(userId);
  if (!primaryId) return [];
  if (!tableExists()) return [primaryId];
  const rows = getDatabase()
    .prepare('SELECT linked_discord_id FROM linked_discord_accounts WHERE primary_discord_id = ? ORDER BY linked_discord_id')
    .all(primaryId)
    .map((row) => row.linked_discord_id);
  return unique([primaryId, ...rows]);
}

function linkInfo(userId) {
  const primaryId = resolvePrimaryUserId(userId);
  const linkedIds = linkedUserIds(primaryId);
  const row = tableExists()
    ? getDatabase()
      .prepare('SELECT label FROM linked_discord_accounts WHERE primary_discord_id = ? AND label IS NOT NULL ORDER BY linked_discord_id LIMIT 1')
      .get(primaryId)
    : null;
  return {
    primaryId,
    linkedIds,
    label: row?.label || null,
    isLinked: linkedIds.length > 1,
    isSecondary: Boolean(userId && primaryId && String(userId) !== String(primaryId))
  };
}

function isSecondaryUserId(userId) {
  const id = String(userId || '').trim();
  return Boolean(id && resolvePrimaryUserId(id) !== id);
}

function canonicalizeRowsByUserId(rows, key = 'discord_id') {
  const map = new Map();
  for (const row of rows) {
    const primaryId = resolvePrimaryUserId(row[key]);
    if (!primaryId) continue;
    if (!map.has(primaryId)) map.set(primaryId, []);
    map.get(primaryId).push(row);
  }
  return map;
}

function placeholders(values) {
  return values.length ? values.map(() => '?').join(',') : "''";
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function tableExists() {
  try {
    return Boolean(getDatabase()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'linked_discord_accounts'")
      .get());
  } catch (error) {
    return false;
  }
}

function createMergePreview({ primaryUser, secondaryUser, actorId, label }) {
  const primaryId = resolvePrimaryUserId(primaryUser?.id);
  const secondaryId = resolvePrimaryUserId(secondaryUser?.id);
  if (!primaryId || !secondaryId) throw new Error('Informe as duas contas Discord para mesclar.');
  if (primaryId === secondaryId) throw new Error('Essas contas ja estao mescladas.');

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const preview = {
    id,
    actorId: String(actorId),
    primaryId,
    secondaryId,
    primaryName: primaryUser?.tag || primaryUser?.username || primaryId,
    secondaryName: secondaryUser?.tag || secondaryUser?.username || secondaryId,
    label: String(label || '').trim().slice(0, 80) || null,
    createdAt: Date.now()
  };
  mergePreviews.set(id, preview);
  return preview;
}

function getMergePreview(id, actorId) {
  const preview = mergePreviews.get(String(id));
  if (!preview) throw new Error('Essa confirmacao de mesclagem expirou. Rode /mesclar_contas novamente.');
  if (String(preview.actorId) !== String(actorId)) throw new Error('Essa confirmacao pertence a outro membro da staff.');
  if (Date.now() - preview.createdAt > MERGE_PREVIEW_TTL_MS) {
    mergePreviews.delete(String(id));
    throw new Error('Essa confirmacao de mesclagem expirou. Rode /mesclar_contas novamente.');
  }
  return preview;
}

function cancelMergePreview(id, actorId) {
  getMergePreview(id, actorId);
  mergePreviews.delete(String(id));
}

function applyMergePreview(id, actorId) {
  const preview = getMergePreview(id, actorId);
  const result = mergeAccounts({ ...preview, actorId });
  mergePreviews.delete(String(id));
  return result;
}

const mergeAccounts = transaction(({ primaryId, secondaryId, actorId, label = null }) => {
  const db = getDatabase();
  const canonicalPrimaryId = resolvePrimaryUserId(primaryId);
  const canonicalSecondaryId = resolvePrimaryUserId(secondaryId);
  if (!canonicalPrimaryId || !canonicalSecondaryId) throw new Error('Contas Discord invalidas.');
  if (canonicalPrimaryId === canonicalSecondaryId) throw new Error('Essas contas ja estao mescladas.');

  const secondaryIds = linkedUserIds(canonicalSecondaryId);
  const primaryUser = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(canonicalPrimaryId);
  const secondaryUsers = db
    .prepare(`SELECT * FROM users WHERE discord_id IN (${placeholders(secondaryIds)}) ORDER BY discord_id`)
    .all(...secondaryIds);
  const bestSecondary = secondaryUsers.find((user) => user.albion_name)
    || secondaryUsers.find((user) => user.discord_name)
    || null;
  const albionName = primaryUser?.albion_name || bestSecondary?.albion_name || null;
  const discordName = primaryUser?.discord_name || bestSecondary?.discord_name || canonicalPrimaryId;
  const registrationStatus = bestRegistrationStatus([primaryUser, ...secondaryUsers]);

  db.prepare(`
    INSERT INTO users (discord_id, discord_name, albion_name, registration_status, updated_at)
    VALUES (?, ?, NULL, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(discord_id) DO UPDATE SET
      discord_name = COALESCE(users.discord_name, excluded.discord_name),
      registration_status = ?,
      updated_at = CURRENT_TIMESTAMP
  `).run(canonicalPrimaryId, discordName, registrationStatus, registrationStatus);

  // O nick Albion pertence ao jogador canonico. Limpar as secundarias primeiro evita
  // o UNIQUE constraint quando as duas contas foram cadastradas com o mesmo nick.
  db.prepare(`UPDATE users SET albion_name = NULL, updated_at = CURRENT_TIMESTAMP WHERE discord_id IN (${placeholders(secondaryIds)})`)
    .run(...secondaryIds);
  if (albionName) {
    db.prepare('UPDATE users SET albion_name = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?')
      .run(albionName, canonicalPrimaryId);
  }

  const allSecondaryIds = unique(secondaryIds);
  mergeBalances(db, canonicalPrimaryId, allSecondaryIds);
  for (const sourceId of allSecondaryIds) {
    db.prepare('UPDATE balance_transactions SET user_id = ? WHERE user_id = ?').run(canonicalPrimaryId, sourceId);
    db.prepare('UPDATE withdraw_requests SET user_id = ? WHERE user_id = ?').run(canonicalPrimaryId, sourceId);
    db.prepare('UPDATE payment_requests SET user_id = ? WHERE user_id = ?').run(canonicalPrimaryId, sourceId);
    mergeCampaignEventPayouts(db, canonicalPrimaryId, sourceId);
    db.prepare('UPDATE campaign_event_payouts SET user_id = ? WHERE user_id = ?').run(canonicalPrimaryId, sourceId);
    db.prepare('UPDATE campaign_contributions SET user_id = ? WHERE user_id = ?').run(canonicalPrimaryId, sourceId);
  }

  const linkStmt = db.prepare(`
    INSERT INTO linked_discord_accounts (linked_discord_id, primary_discord_id, label, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(linked_discord_id) DO UPDATE SET
      primary_discord_id = excluded.primary_discord_id,
      label = COALESCE(excluded.label, linked_discord_accounts.label),
      updated_at = CURRENT_TIMESTAMP
  `);
  for (const sourceId of allSecondaryIds) linkStmt.run(sourceId, canonicalPrimaryId, label);

  db.prepare(`
    INSERT INTO audit_logs (type, actor_id, target_id, before_value, after_value, reason, metadata)
    VALUES ('discord_accounts_merged', ?, ?, ?, ?, 'Mesclagem manual de contas Discord', ?)
  `).run(
    actorId || null,
    canonicalPrimaryId,
    allSecondaryIds.join(','),
    canonicalPrimaryId,
    JSON.stringify({ primaryId: canonicalPrimaryId, secondaryIds: allSecondaryIds, label, albionName })
  );

  return { primaryId: canonicalPrimaryId, secondaryIds: allSecondaryIds, label, albionName };
});

function mergeBalances(db, primaryId, secondaryIds) {
  const ids = unique([primaryId, ...secondaryIds]);
  const total = db.prepare(`SELECT COALESCE(SUM(balance), 0) AS total FROM balances WHERE discord_id IN (${placeholders(ids)})`)
    .get(...ids).total;
  db.prepare(`DELETE FROM balances WHERE discord_id IN (${placeholders(ids)})`).run(...ids);
  if (Number(total) !== 0) {
    db.prepare('INSERT INTO balances (discord_id, balance, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
      .run(primaryId, Number(total));
  }
}

function mergeCampaignEventPayouts(db, primaryId, secondaryId) {
  const conflicts = db.prepare(`
    SELECT linked.id AS linked_id, primary_row.id AS primary_id, linked.amount AS linked_amount
    FROM campaign_event_payouts linked
    JOIN campaign_event_payouts primary_row
      ON primary_row.campaign_id = linked.campaign_id
     AND primary_row.event_id = linked.event_id
     AND primary_row.user_id = ?
    WHERE linked.user_id = ?
  `).all(primaryId, secondaryId);
  for (const row of conflicts) {
    db.prepare('UPDATE campaign_event_payouts SET amount = amount + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(Number(row.linked_amount || 0), row.primary_id);
    db.prepare('DELETE FROM campaign_event_payouts WHERE id = ?').run(row.linked_id);
  }
}

function bestRegistrationStatus(users) {
  const priorities = ['member', 'synced', 'guest', 'pending', 'unregistered'];
  const statuses = new Set(users.filter(Boolean).map((user) => user.registration_status));
  return priorities.find((status) => statuses.has(status)) || 'unregistered';
}

module.exports = {
  applyMergePreview,
  cancelMergePreview,
  canonicalizeRowsByUserId,
  createMergePreview,
  isSecondaryUserId,
  linkedUserIds,
  linkInfo,
  mergeAccounts,
  placeholders,
  resolvePrimaryUserId,
  unique
};
