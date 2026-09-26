const { getDatabase } = require('../../database/connection');
const accountLinks = require('../accounts/accountLinks.service');

function getBalance(userId) {
  userId = accountLinks.resolvePrimaryUserId(userId);
  const row = getDatabase().prepare('SELECT balance FROM balances WHERE discord_id = ?').get(userId);
  return row?.balance || 0;
}

function ensureBalance(userId) {
  userId = accountLinks.resolvePrimaryUserId(userId);
  getDatabase()
    .prepare('INSERT OR IGNORE INTO balances (discord_id, balance) VALUES (?, 0)')
    .run(userId);
  return getBalance(userId);
}

function setBalance({ userId, amount }) {
  userId = accountLinks.resolvePrimaryUserId(userId);
  getDatabase()
    .prepare(`
      INSERT INTO balances (discord_id, balance, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(discord_id) DO UPDATE SET balance = excluded.balance, updated_at = CURRENT_TIMESTAMP
    `)
    .run(userId, amount);
}

function insertTransaction({ type, userId, amount, beforeBalance, afterBalance, reason, referenceType, referenceId, createdBy }) {
  userId = accountLinks.resolvePrimaryUserId(userId);
  return getDatabase()
    .prepare(`
      INSERT INTO balance_transactions
        (type, user_id, amount, before_balance, after_balance, reason, reference_type, reference_id, created_by)
      VALUES
        (@type, @userId, @amount, @beforeBalance, @afterBalance, @reason, @referenceType, @referenceId, @createdBy)
    `)
    .run({
      type,
      userId,
      amount,
      beforeBalance,
      afterBalance,
      reason,
      referenceType: referenceType || null,
      referenceId: referenceId || null,
      createdBy
    });
}

function listBalances() {
  return getDatabase()
    .prepare(`
      SELECT b.discord_id, u.discord_name, u.albion_name, b.balance, b.updated_at AS last_updated
      FROM balances b
      LEFT JOIN users u ON u.discord_id = b.discord_id
      LEFT JOIN linked_discord_accounts l
        ON l.linked_discord_id = b.discord_id
       AND l.primary_discord_id <> l.linked_discord_id
      WHERE l.linked_discord_id IS NULL
      ORDER BY COALESCE(u.albion_name, u.discord_name, b.discord_id) COLLATE NOCASE
    `)
    .all()
    .map(enrichLinkedBalanceRow);
}

function listAllBalances() {
  return getDatabase()
    .prepare(`
      SELECT discord_id, discord_name, albion_name, balance, last_updated
      FROM (
        SELECT
          u.discord_id,
          u.discord_name,
          u.albion_name,
          COALESCE(b.balance, 0) AS balance,
          b.updated_at AS last_updated,
          COALESCE(u.albion_name, u.discord_name, u.discord_id) AS sort_name
        FROM users u
        LEFT JOIN balances b ON b.discord_id = u.discord_id
        LEFT JOIN linked_discord_accounts l
          ON l.linked_discord_id = u.discord_id
         AND l.primary_discord_id <> l.linked_discord_id
        WHERE l.linked_discord_id IS NULL
        UNION
        SELECT
          b.discord_id,
          NULL AS discord_name,
          NULL AS albion_name,
          b.balance,
          b.updated_at AS last_updated,
          b.discord_id AS sort_name
        FROM balances b
        LEFT JOIN users u ON u.discord_id = b.discord_id
        LEFT JOIN linked_discord_accounts l
          ON l.linked_discord_id = b.discord_id
         AND l.primary_discord_id <> l.linked_discord_id
        WHERE u.discord_id IS NULL
          AND l.linked_discord_id IS NULL
      )
      ORDER BY sort_name COLLATE NOCASE
    `)
    .all()
    .map(enrichLinkedBalanceRow);
}

function listActivePositiveBalances() {
  return getDatabase()
    .prepare(`
      SELECT
        u.discord_id,
        u.discord_name,
        u.albion_name,
        b.balance,
        b.updated_at AS last_updated
      FROM users u
      JOIN balances b ON b.discord_id = u.discord_id
      LEFT JOIN linked_discord_accounts l
        ON l.linked_discord_id = u.discord_id
       AND l.primary_discord_id <> l.linked_discord_id
      WHERE u.registration_status = 'member'
        AND b.balance > 0
        AND l.linked_discord_id IS NULL
      ORDER BY b.balance DESC,
               COALESCE(u.albion_name, u.discord_name, u.discord_id) COLLATE NOCASE
    `)
    .all()
    .map(enrichLinkedBalanceRow);
}

function listTransactions(limit = 1000) {
  return getDatabase()
    .prepare('SELECT * FROM balance_transactions ORDER BY id DESC LIMIT ?')
    .all(limit);
}

function createWithdrawRequest({ userId, amount, note }) {
  userId = accountLinks.resolvePrimaryUserId(userId);
  return getDatabase()
    .prepare('INSERT INTO withdraw_requests (user_id, amount, note) VALUES (?, ?, ?)')
    .run(userId, amount, note || null);
}

function updateWithdrawStatus({ id, status, actorId }) {
  const column = status === 'paid' ? 'paid_by' : status === 'cancelled' ? 'cancelled_by' : 'reviewed_by';
  const dateColumn = status === 'paid' ? 'paid_at' : status === 'cancelled' ? 'cancelled_at' : 'reviewed_at';
  return getDatabase()
    .prepare(`UPDATE withdraw_requests SET status = ?, ${column} = ?, ${dateColumn} = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(status, actorId, id);
}

function getWithdrawRequest(id) {
  return getDatabase().prepare('SELECT * FROM withdraw_requests WHERE id = ?').get(id);
}

function updateWithdrawRequest({ id, amount, note }) {
  return getDatabase()
    .prepare('UPDATE withdraw_requests SET amount = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = \'requested\'')
    .run(amount, note || null, id);
}

function setWithdrawStaffMessage({ id, channelId, messageId }) {
  return getDatabase()
    .prepare('UPDATE withdraw_requests SET staff_channel_id = ?, staff_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(channelId || null, messageId || null, id);
}

function createPaymentRequest({ userId, amount, service, description, evidence }) {
  userId = accountLinks.resolvePrimaryUserId(userId);
  return getDatabase()
    .prepare(`
      INSERT INTO payment_requests (user_id, amount, service, description, evidence)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(userId, amount, service, description, evidence || null);
}

function updatePaymentRequestStatus({ id, status, actorId }) {
  return getDatabase()
    .prepare('UPDATE payment_requests SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(status, actorId, id);
}

function getPaymentRequest(id) {
  return getDatabase().prepare('SELECT * FROM payment_requests WHERE id = ?').get(id);
}

function enrichLinkedBalanceRow(row) {
  if (row.discord_name && row.albion_name) return row;
  const linkedIds = accountLinks.linkedUserIds(row.discord_id);
  if (linkedIds.length <= 1) return row;
  const users = getDatabase()
    .prepare(`SELECT discord_id, discord_name, albion_name FROM users WHERE discord_id IN (${accountLinks.placeholders(linkedIds)})`)
    .all(...linkedIds);
  const best = users.find((user) => user.discord_id === row.discord_id && user.albion_name)
    || users.find((user) => user.albion_name)
    || users.find((user) => user.discord_id === row.discord_id && user.discord_name)
    || users.find((user) => user.discord_name);
  return {
    ...row,
    discord_name: row.discord_name || best?.discord_name || null,
    albion_name: row.albion_name || best?.albion_name || null
  };
}

module.exports = {
  createPaymentRequest,
  createWithdrawRequest,
  ensureBalance,
  getBalance,
  getPaymentRequest,
  getWithdrawRequest,
  insertTransaction,
  listAllBalances,
  listActivePositiveBalances,
  listBalances,
  listTransactions,
  setBalance,
  setWithdrawStaffMessage,
  updatePaymentRequestStatus,
  updateWithdrawRequest,
  updateWithdrawStatus
};
