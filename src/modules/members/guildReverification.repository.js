const { getDatabase, transaction } = require('../../database/connection');

function createCampaign({ guildId, announcementChannelId, verifiedRoleId, voiceChannelIds, startsAt, deadlineAt, createdBy, members }) {
  return transaction(() => {
    const db = getDatabase();
    db.prepare("UPDATE guild_reverification_campaigns SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE status = 'active'").run();
    const result = db.prepare(`
      INSERT INTO guild_reverification_campaigns
        (guild_id, announcement_channel_id, verified_role_id, voice_channel_ids_json, starts_at, deadline_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(guildId, announcementChannelId, verifiedRoleId, JSON.stringify(voiceChannelIds), startsAt, deadlineAt, createdBy);
    const campaignId = Number(result.lastInsertRowid);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO guild_reverification_members
        (campaign_id, albion_name, normalized_name, discord_id)
      VALUES (?, ?, ?, ?)
    `);
    for (const member of members) insert.run(campaignId, member.albionName, member.normalizedName, member.discordId || null);
    return getCampaign(campaignId);
  })();
}

function getCampaign(id) {
  return getDatabase().prepare('SELECT * FROM guild_reverification_campaigns WHERE id = ?').get(id);
}

function getActiveCampaign() {
  return getDatabase().prepare("SELECT * FROM guild_reverification_campaigns WHERE status = 'active' ORDER BY id DESC LIMIT 1").get();
}

function listMembers(campaignId, status) {
  const sql = status
    ? 'SELECT * FROM guild_reverification_members WHERE campaign_id = ? AND status = ? ORDER BY albion_name COLLATE NOCASE'
    : 'SELECT * FROM guild_reverification_members WHERE campaign_id = ? ORDER BY albion_name COLLATE NOCASE';
  return status ? getDatabase().prepare(sql).all(campaignId, status) : getDatabase().prepare(sql).all(campaignId);
}

function findPendingByDiscordId(campaignId, discordId) {
  return getDatabase().prepare(`
    SELECT * FROM guild_reverification_members
    WHERE campaign_id = ? AND discord_id = ? AND status = 'pending'
    ORDER BY albion_name COLLATE NOCASE LIMIT 1
  `).get(campaignId, discordId);
}

function linkPendingUsers(campaignId) {
  return getDatabase().prepare(`
    UPDATE guild_reverification_members AS member
    SET discord_id = (
      SELECT users.discord_id
      FROM users
      WHERE lower(trim(users.albion_name)) = member.normalized_name
      LIMIT 1
    )
    WHERE member.campaign_id = ?
      AND member.status = 'pending'
      AND member.discord_id IS NULL
      AND EXISTS (
        SELECT 1 FROM users
        WHERE lower(trim(users.albion_name)) = member.normalized_name
      )
  `).run(campaignId);
}

function markVerified({ campaignId, normalizedName, status, qualificationSeconds = 0, verifiedBy }) {
  return getDatabase().prepare(`
    UPDATE guild_reverification_members
    SET status = ?, qualification_seconds = ?, verified_by = ?, verified_at = ?
    WHERE campaign_id = ? AND normalized_name = ? AND status = 'pending'
  `).run(status, qualificationSeconds, verifiedBy || null, new Date().toISOString(), campaignId, normalizedName);
}

function listVoiceSessions({ startsAt, endsAt, channelIds }) {
  if (!channelIds.length) return [];
  const placeholders = channelIds.map(() => '?').join(',');
  return getDatabase().prepare(`
    SELECT vs.discord_id, COALESCE(links.primary_discord_id, vs.discord_id) AS primary_discord_id,
      vs.channel_id, vs.joined_at, COALESCE(vs.left_at, ?) AS left_at
    FROM voice_sessions vs
    LEFT JOIN linked_discord_accounts links ON links.linked_discord_id = vs.discord_id
    WHERE vs.channel_id IN (${placeholders})
      AND vs.joined_at < ?
      AND COALESCE(vs.left_at, ?) > ?
  `).all(endsAt, ...channelIds, endsAt, endsAt, startsAt);
}

function setLastReminder(campaignId, dateText) {
  return getDatabase().prepare('UPDATE guild_reverification_campaigns SET last_reminder_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(dateText, campaignId);
}

function finishCampaign(campaignId, finalPostedAt = new Date().toISOString()) {
  return getDatabase().prepare("UPDATE guild_reverification_campaigns SET status = 'finished', final_posted_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(finalPostedAt, campaignId);
}

module.exports = {
  createCampaign,
  findPendingByDiscordId,
  finishCampaign,
  getActiveCampaign,
  getCampaign,
  listMembers,
  listVoiceSessions,
  linkPendingUsers,
  markVerified,
  setLastReminder
};
