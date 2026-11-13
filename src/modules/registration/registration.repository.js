const { getDatabase } = require('../../database/connection');

function upsertUser({ discordId, discordName, albionName, registrationStatus }) {
  getDatabase()
    .prepare(`
      INSERT INTO users (discord_id, discord_name, albion_name, registration_status, updated_at)
      VALUES (@discordId, @discordName, @albionName, @registrationStatus, CURRENT_TIMESTAMP)
      ON CONFLICT(discord_id) DO UPDATE SET
        discord_name = excluded.discord_name,
        albion_name = COALESCE(excluded.albion_name, users.albion_name),
        registration_status = excluded.registration_status,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run({
      discordId,
      discordName,
      albionName: albionName || null,
      registrationStatus: registrationStatus || 'unregistered'
    });
}

function getUser(discordId) {
  return getDatabase().prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId);
}

function findUserByAlbionName(albionName, exceptDiscordId = null) {
  return getDatabase()
    .prepare(`
      SELECT * FROM users
      WHERE lower(trim(albion_name)) = lower(trim(?))
        AND (? IS NULL OR discord_id <> ?)
      LIMIT 1
    `)
    .get(albionName, exceptDiscordId, exceptDiscordId);
}

function createRegistration({ discordId, albionName }) {
  return getDatabase()
    .prepare('INSERT INTO registrations (discord_id, albion_name) VALUES (?, ?)')
    .run(discordId, albionName);
}

function getRegistration(id) {
  return getDatabase().prepare('SELECT * FROM registrations WHERE id = ?').get(id);
}

function getPendingRegistrationForDiscord(discordId) {
  return getDatabase()
    .prepare("SELECT * FROM registrations WHERE discord_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1")
    .get(discordId);
}

function listPendingRegistrations() {
  return getDatabase()
    .prepare(`
      SELECT r.*, u.discord_name
      FROM registrations r
      LEFT JOIN users u ON u.discord_id = r.discord_id
      WHERE r.status = 'pending'
      ORDER BY r.created_at ASC, r.id ASC
    `)
    .all();
}

function updateRegistration({ id, status, reviewedBy, note }) {
  return getDatabase()
    .prepare(`
      UPDATE registrations
      SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .run(status, reviewedBy, note || null, id);
}

function resolvePendingRegistrations({ discordId, status, reviewedBy, note }) {
  return getDatabase()
    .prepare(`
      UPDATE registrations
      SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE discord_id = ? AND status = 'pending'
    `)
    .run(status, reviewedBy, note || null, discordId);
}

function updateUserRegistration({ discordId, discordName, albionName, registrationStatus, clearAlbion = false }) {
  return getDatabase()
    .prepare(`
      INSERT INTO users (discord_id, discord_name, albion_name, registration_status, updated_at)
      VALUES (@discordId, @discordName, @albionName, @registrationStatus, CURRENT_TIMESTAMP)
      ON CONFLICT(discord_id) DO UPDATE SET
        discord_name = COALESCE(excluded.discord_name, users.discord_name),
        albion_name = CASE WHEN @clearAlbion = 1 THEN NULL ELSE COALESCE(excluded.albion_name, users.albion_name) END,
        registration_status = excluded.registration_status,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run({
      discordId,
      discordName: discordName || null,
      albionName: albionName || null,
      registrationStatus: registrationStatus || 'unregistered',
      clearAlbion: clearAlbion ? 1 : 0
    });
}

function listRegistrationRecords(limit = 500) {
  return getDatabase().prepare(`
    SELECT
      u.discord_id, u.discord_name, u.albion_name, u.registration_status,
      u.created_at, u.updated_at,
      latest.id AS registration_id,
      latest.albion_name AS requested_albion_name,
      latest.status AS registration_review_status,
      latest.reviewed_by, latest.review_note,
      latest.created_at AS registration_created_at,
      latest.reviewed_at,
      joined.created_at AS discord_joined_at
    FROM users u
    LEFT JOIN registrations latest ON latest.id = (
      SELECT r.id FROM registrations r
      WHERE r.discord_id = u.discord_id
      ORDER BY r.id DESC LIMIT 1
    )
    LEFT JOIN guild_member_events joined ON joined.id = (
      SELECT g.id FROM guild_member_events g
      WHERE g.discord_id = u.discord_id AND g.event_type = 'join'
      ORDER BY g.id DESC LIMIT 1
    )
    ORDER BY
      CASE
        WHEN latest.status = 'pending' THEN 0
        WHEN u.registration_status IN ('guest', 'unregistered', 'pending') THEN 1
        ELSE 2
      END,
      COALESCE(latest.created_at, u.updated_at) ASC,
      COALESCE(u.albion_name, u.discord_name, u.discord_id) COLLATE NOCASE
    LIMIT ?
  `).all(limit);
}

function upsertStaffAlert({ discordId, channelId, messageId }) {
  return getDatabase().prepare(`
    INSERT INTO registration_staff_alerts
      (discord_id, channel_id, message_id, resolved_at, updated_at)
    VALUES (?, ?, ?, NULL, CURRENT_TIMESTAMP)
    ON CONFLICT(discord_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      message_id = excluded.message_id,
      resolved_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  `).run(discordId, channelId, messageId);
}

function getOpenStaffAlert(discordId) {
  return getDatabase().prepare(`
    SELECT * FROM registration_staff_alerts
    WHERE discord_id = ? AND resolved_at IS NULL
  `).get(discordId);
}

function resolveStaffAlert(discordId) {
  return getDatabase().prepare(`
    UPDATE registration_staff_alerts
    SET resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE discord_id = ? AND resolved_at IS NULL
  `).run(discordId);
}

function logGuildMemberEvent({ eventType, discordId, discordName, displayName }) {
  const user = getUser(discordId) || {};
  return getDatabase()
    .prepare(`
      INSERT INTO guild_member_events
        (event_type, discord_id, discord_name, display_name, albion_name, registration_status)
      VALUES
        (@eventType, @discordId, @discordName, @displayName, @albionName, @registrationStatus)
    `)
    .run({
      eventType,
      discordId,
      discordName: discordName || user.discord_name || null,
      displayName: displayName || null,
      albionName: user.albion_name || null,
      registrationStatus: user.registration_status || null
    });
}

module.exports = {
  createRegistration,
  findUserByAlbionName,
  getPendingRegistrationForDiscord,
  getRegistration,
  getUser,
  getOpenStaffAlert,
  listRegistrationRecords,
  listPendingRegistrations,
  logGuildMemberEvent,
  resolvePendingRegistrations,
  resolveStaffAlert,
  updateRegistration,
  updateUserRegistration,
  upsertStaffAlert,
  upsertUser
};
