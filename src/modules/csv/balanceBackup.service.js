const { AttachmentBuilder } = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const financeRepo = require('../finance/finance.repository');
const { toCsv } = require('../../utils/csv');

async function postEventBalanceBackup(client, eventId) {
  return postBalanceBackup(client, {
    key: `event:${eventId}`,
    triggerType: 'event',
    referenceId: String(eventId),
    reason: `Backup automatico de saldos apos evento #${eventId}`
  });
}

async function postDailyBackupIfNeeded(client) {
  const last = lastSentBackup('daily');
  if (last?.sent_at && Date.now() - Date.parse(last.sent_at) < 24 * 60 * 60 * 1000) {
    return null;
  }

  return postBalanceBackup(client, {
    key: `daily:${saoPauloDateKey()}`,
    triggerType: 'daily',
    referenceId: saoPauloDateKey(),
    reason: 'Backup automatico de saldos a cada 24 horas'
  });
}

async function postBalanceBackup(client, { key, triggerType, referenceId, reason }) {
  const started = beginBackup({ key, triggerType, referenceId });
  if (!started) return null;

  try {
    const channel = await client.channels.fetch(ids.channels.archive);
    if (!channel?.isTextBased()) throw new Error('Canal de arquivar nao encontrado ou nao e texto.');

    const message = await channel.send({
      content: reason,
      files: [balancesBackupAttachment(triggerType, referenceId)]
    });
    markBackupSent({ key, channelId: channel.id, messageId: message.id });
    return message;
  } catch (error) {
    markBackupFailed({ key, errorMessage: error.message || 'Erro desconhecido' });
    console.error('Falha ao postar backup automatico de saldos:', error);
    return null;
  }
}

function balancesBackupAttachment(triggerType, referenceId) {
  const rows = financeRepo.listAllBalances().map((row) => ({
    discord_id: row.discord_id || '',
    discord_name: row.discord_name || '',
    albion_name: row.albion_name || '',
    balance: Number(row.balance || 0),
    last_updated: row.last_updated || ''
  }));
  const csv = toCsv(rows, ['discord_id', 'discord_name', 'albion_name', 'balance', 'last_updated']);
  const fileName = `backup-saldos-${safeFilePart(triggerType)}-${safeFilePart(referenceId || saoPauloDateKey())}.csv`;
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: fileName });
}

function beginBackup({ key, triggerType, referenceId }) {
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM balance_csv_backups WHERE backup_key = ?').get(key);
  if (existing?.status === 'sent') return false;

  if (existing) {
    db.prepare(`
      UPDATE balance_csv_backups
      SET status = 'pending', error_message = NULL
      WHERE backup_key = ?
    `).run(key);
    return true;
  }

  db.prepare(`
    INSERT INTO balance_csv_backups (backup_key, trigger_type, reference_id)
    VALUES (?, ?, ?)
  `).run(key, triggerType, referenceId || null);
  return true;
}

function markBackupSent({ key, channelId, messageId }) {
  getDatabase()
    .prepare(`
      UPDATE balance_csv_backups
      SET status = 'sent', channel_id = ?, message_id = ?, sent_at = CURRENT_TIMESTAMP, error_message = NULL
      WHERE backup_key = ?
    `)
    .run(channelId, messageId, key);
}

function markBackupFailed({ key, errorMessage }) {
  getDatabase()
    .prepare(`
      UPDATE balance_csv_backups
      SET status = 'failed', error_message = ?
      WHERE backup_key = ?
    `)
    .run(String(errorMessage).slice(0, 500), key);
}

function lastSentBackup(triggerType) {
  return getDatabase()
    .prepare(`
      SELECT *
      FROM balance_csv_backups
      WHERE trigger_type = ? AND status = 'sent'
      ORDER BY sent_at DESC
      LIMIT 1
    `)
    .get(triggerType);
}

function saoPauloDateKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function safeFilePart(value) {
  return String(value || 'backup')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'backup';
}

module.exports = {
  balancesBackupAttachment,
  postDailyBackupIfNeeded,
  postEventBalanceBackup
};
