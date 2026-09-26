const { getDatabase, transaction } = require('../../database/connection');

function getMission(id) {
  return getDatabase().prepare('SELECT * FROM guild_service_missions WHERE id = ?').get(id);
}

function getMissionBySourceMessage(sourceMessageId) {
  return getDatabase().prepare('SELECT * FROM guild_service_missions WHERE source_message_id = ?').get(sourceMessageId);
}

function createMission(data) {
  const result = getDatabase().prepare(`
    INSERT INTO guild_service_missions (
      guild_id, channel_id, source_message_id, creator_id, title, objective, description,
      image_attachment_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.guildId,
    data.channelId,
    data.sourceMessageId,
    data.creatorId,
    data.title,
    data.objective,
    data.description,
    data.imageAttachmentName || null
  );
  return getMission(result.lastInsertRowid);
}

function attachPublishedMessage(id, messageId) {
  getDatabase().prepare(`
    UPDATE guild_service_missions
    SET message_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(messageId, id);
  return getMission(id);
}

function removeUnpublishedMission(id) {
  return getDatabase().prepare(`
    DELETE FROM guild_service_missions
    WHERE id = ? AND message_id IS NULL AND status = 'available'
  `).run(id);
}

function listMissionsWithoutImage(limit = 50) {
  return getDatabase().prepare(`
    SELECT * FROM guild_service_missions
    WHERE message_id IS NOT NULL AND image_attachment_name IS NULL
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}

function listOpenMissions(limit = 200) {
  return getDatabase().prepare(`
    SELECT * FROM guild_service_missions
    WHERE message_id IS NOT NULL AND status IN ('available', 'claimed')
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}

function setMissionImage(id, imageAttachmentName) {
  getDatabase().prepare(`
    UPDATE guild_service_missions
    SET image_attachment_name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND image_attachment_name IS NULL
  `).run(imageAttachmentName, id);
  return getMission(id);
}

function updateMission({ id, title, objective, description }) {
  const result = getDatabase().prepare(`
    UPDATE guild_service_missions
    SET title = ?, objective = ?, description = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('available', 'claimed')
  `).run(title, objective, description, id);
  return { changed: result.changes > 0, mission: getMission(id) };
}

const setMissionThread = transaction(({ id, threadId }) => {
  const result = getDatabase().prepare(`
    UPDATE guild_service_missions
    SET thread_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND thread_id IS NULL
  `).run(threadId, id);
  return { changed: result.changes > 0, mission: getMission(id) };
});

const claimMission = transaction(({ id, assigneeId, claimedAt, reminderDueAt }) => {
  const result = getDatabase().prepare(`
    UPDATE guild_service_missions
    SET status = 'claimed', assignee_id = ?, claimed_at = ?, reminder_due_at = ?,
        reminder_claimed_at = NULL, reminded_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'available'
  `).run(assigneeId, claimedAt, reminderDueAt, id);
  return { changed: result.changes > 0, mission: getMission(id) };
});

const completeMission = transaction(({ id, assigneeId, completedAt }) => {
  const result = getDatabase().prepare(`
    UPDATE guild_service_missions
    SET status = 'completed', completed_at = ?, reminder_due_at = NULL,
        reminder_claimed_at = NULL, reminded_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'claimed' AND assignee_id = ?
  `).run(completedAt, id, assigneeId);
  return { changed: result.changes > 0, mission: getMission(id) };
});

const releaseMission = transaction(({ id, assigneeId }) => {
  const result = getDatabase().prepare(`
    UPDATE guild_service_missions
    SET status = 'available', assignee_id = NULL, claimed_at = NULL,
        reminder_due_at = NULL, reminder_claimed_at = NULL, reminded_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'claimed' AND assignee_id = ?
  `).run(id, assigneeId);
  return { changed: result.changes > 0, mission: getMission(id) };
});

const postponeReminder = transaction(({ id, assigneeId, reminderDueAt }) => {
  const result = getDatabase().prepare(`
    UPDATE guild_service_missions
    SET reminder_due_at = ?, reminder_claimed_at = NULL, reminded_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'claimed' AND assignee_id = ?
  `).run(reminderDueAt, id, assigneeId);
  return { changed: result.changes > 0, mission: getMission(id) };
});

function listDueReminders(nowIso, staleBeforeIso, limit = 50) {
  return getDatabase().prepare(`
    SELECT *
    FROM guild_service_missions
    WHERE status = 'claimed'
      AND reminder_due_at IS NOT NULL
      AND reminder_due_at <= ?
      AND reminded_at IS NULL
      AND (reminder_claimed_at IS NULL OR reminder_claimed_at <= ?)
    ORDER BY reminder_due_at ASC, id ASC
    LIMIT ?
  `).all(nowIso, staleBeforeIso, limit);
}

function reserveReminder(id, claimedAt, staleBeforeIso) {
  return getDatabase().prepare(`
    UPDATE guild_service_missions
    SET reminder_claimed_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'claimed' AND reminded_at IS NULL
      AND (reminder_claimed_at IS NULL OR reminder_claimed_at <= ?)
  `).run(claimedAt, id, staleBeforeIso);
}

function markReminderSent(id, claimedAt, remindedAt) {
  return getDatabase().prepare(`
    UPDATE guild_service_missions
    SET reminded_at = ?, reminder_claimed_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'claimed' AND reminder_claimed_at = ?
  `).run(remindedAt, id, claimedAt);
}

function clearReminderReservation(id, claimedAt) {
  return getDatabase().prepare(`
    UPDATE guild_service_missions
    SET reminder_claimed_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'claimed' AND reminder_claimed_at = ?
  `).run(id, claimedAt);
}

module.exports = {
  attachPublishedMessage,
  claimMission,
  clearReminderReservation,
  completeMission,
  createMission,
  getMission,
  getMissionBySourceMessage,
  listDueReminders,
  listMissionsWithoutImage,
  listOpenMissions,
  markReminderSent,
  postponeReminder,
  reserveReminder,
  releaseMission,
  removeUnpublishedMission,
  setMissionImage,
  setMissionThread,
  updateMission
};
