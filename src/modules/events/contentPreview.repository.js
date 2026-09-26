const { getDatabase, transaction } = require('../../database/connection');

function ensurePreview(previewDate) {
  getDatabase().prepare(`
    INSERT INTO daily_content_previews (preview_date)
    VALUES (?)
    ON CONFLICT(preview_date) DO NOTHING
  `).run(previewDate);
  return getPreview(previewDate);
}

function getPreview(previewDate) {
  return getDatabase().prepare('SELECT * FROM daily_content_previews WHERE preview_date = ?').get(previewDate);
}

function listOpenPreviews() {
  return getDatabase().prepare(`
    SELECT * FROM daily_content_previews
    WHERE status = 'open'
    ORDER BY preview_date
  `).all();
}

function attachMessage({ previewDate, channelId, messageId }) {
  getDatabase().prepare(`
    UPDATE daily_content_previews
    SET channel_id = ?, message_id = ?, posted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE preview_date = ?
  `).run(channelId, messageId, previewDate);
  return getPreview(previewDate);
}

function attachSummaryMessage(previewDate, messageId) {
  getDatabase().prepare(`
    UPDATE daily_content_previews
    SET summary_message_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE preview_date = ?
  `).run(messageId, previewDate);
}

function archivePreview({ previewDate, channelId, messageId, summaryMessageId }) {
  getDatabase().prepare(`
    UPDATE daily_content_previews
    SET channel_id = ?, message_id = ?, summary_message_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE preview_date = ?
  `).run(channelId, messageId, summaryMessageId, previewDate);
  return getPreview(previewDate);
}

const toggleInterest = transaction(({ previewDate, timeSlot, userId }) => {
  const db = getDatabase();
  const preview = getPreview(previewDate);
  if (!preview || preview.status !== 'open') throw new Error('Esta sondagem ja foi encerrada.');
  const current = db.prepare(`
    SELECT 1 FROM daily_content_interests
    WHERE preview_date = ? AND time_slot = ? AND user_id = ?
  `).get(previewDate, timeSlot, userId);
  if (current) {
    db.prepare(`DELETE FROM daily_content_interests WHERE preview_date = ? AND time_slot = ? AND user_id = ?`)
      .run(previewDate, timeSlot, userId);
    return { added: false };
  }
  db.prepare(`INSERT INTO daily_content_interests (preview_date, time_slot, user_id) VALUES (?, ?, ?)`)
    .run(previewDate, timeSlot, userId);
  return { added: true };
});

function interestCounts(previewDate) {
  return getDatabase().prepare(`
    SELECT time_slot, COUNT(*) AS total
    FROM daily_content_interests
    WHERE preview_date = ?
    GROUP BY time_slot
  `).all(previewDate);
}

function upsertProposal({ previewDate, timeSlot, callerId, contentName, targetPlayers }) {
  const preview = getPreview(previewDate);
  if (!preview || preview.status !== 'open') throw new Error('Esta sondagem ja foi encerrada.');
  getDatabase().prepare(`
    INSERT INTO daily_content_proposals
      (preview_date, time_slot, caller_id, content_name, target_players)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(preview_date, time_slot, caller_id) DO UPDATE SET
      content_name = excluded.content_name,
      target_players = excluded.target_players,
      updated_at = CURRENT_TIMESTAMP
  `).run(previewDate, timeSlot, callerId, contentName, targetPlayers);
}

function listProposals(previewDate) {
  return getDatabase().prepare(`
    SELECT * FROM daily_content_proposals
    WHERE preview_date = ?
    ORDER BY CASE time_slot WHEN '1800' THEN 1 WHEN '2000' THEN 2 WHEN '2200' THEN 3 WHEN '0000' THEN 4 ELSE 5 END, id
  `).all(previewDate);
}

function closePreview(previewDate) {
  getDatabase().prepare(`
    UPDATE daily_content_previews
    SET status = 'closed', closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
    WHERE preview_date = ? AND status = 'open'
  `).run(previewDate);
  return getPreview(previewDate);
}

function closeStalePreviews(today) {
  return getDatabase().prepare(`
    UPDATE daily_content_previews
    SET status = 'closed', closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
    WHERE status = 'open' AND preview_date < ?
  `).run(today).changes;
}

module.exports = {
  archivePreview,
  attachMessage,
  attachSummaryMessage,
  closePreview,
  closeStalePreviews,
  ensurePreview,
  getPreview,
  interestCounts,
  listOpenPreviews,
  listProposals,
  toggleInterest,
  upsertProposal
};
