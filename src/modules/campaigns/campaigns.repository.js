const { getDatabase } = require('../../database/connection');
const accountLinks = require('../accounts/accountLinks.service');

function getActiveCampaign() {
  return getDatabase()
    .prepare("SELECT * FROM campaigns WHERE status = 'open' ORDER BY id ASC LIMIT 1")
    .get();
}

function getCampaign(id) {
  return getDatabase().prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
}

function getCampaignTotals(campaignId) {
  const db = getDatabase();
  const totals = db
    .prepare(`
      SELECT
        COALESCE(SUM(amount), 0) AS raised,
        COUNT(DISTINCT user_id) AS contributors
      FROM campaign_contributions
      WHERE campaign_id = ?
        AND status = 'approved'
    `)
    .get(campaignId);
  const events = db
    .prepare(`
      SELECT COUNT(DISTINCT source_id) AS total
      FROM campaign_contributions
      WHERE campaign_id = ?
        AND status = 'approved'
        AND source_type = 'event_payout'
    `)
    .get(campaignId);
  const pending = db
    .prepare(`
      SELECT COUNT(*) AS total
      FROM campaign_event_payouts
      WHERE campaign_id = ?
        AND status = 'pending'
    `)
    .get(campaignId);
  return {
    raised: Number(totals?.raised || 0),
    contributors: Number(totals?.contributors || 0),
    events: Number(events?.total || 0),
    pending: Number(pending?.total || 0)
  };
}

function createEventPayoutDecision({ campaignId, eventId, userId, amount, expiresAt, createdBy }) {
  userId = accountLinks.resolvePrimaryUserId(userId);
  getDatabase()
    .prepare(`
      INSERT OR IGNORE INTO campaign_event_payouts
        (campaign_id, event_id, user_id, amount, expires_at, created_by)
      VALUES
        (@campaignId, @eventId, @userId, @amount, @expiresAt, @createdBy)
    `)
    .run({ campaignId, eventId, userId, amount, expiresAt, createdBy });
  return getDatabase()
    .prepare('SELECT * FROM campaign_event_payouts WHERE campaign_id = ? AND event_id = ? AND user_id = ?')
    .get(campaignId, eventId, userId);
}

function getEventPayoutDecision(id) {
  return getDatabase()
    .prepare(`
      SELECT cep.*, c.code AS campaign_code, c.title AS campaign_title, c.goal_amount, c.role_name,
             e.event_code, e.title AS event_title
      FROM campaign_event_payouts cep
      JOIN campaigns c ON c.id = cep.campaign_id
      JOIN events e ON e.id = cep.event_id
      WHERE cep.id = ?
    `)
    .get(id);
}

function listEventPayoutDecisions(eventId) {
  return getDatabase()
    .prepare('SELECT * FROM campaign_event_payouts WHERE event_id = ? ORDER BY id ASC')
    .all(eventId);
}

function listExpiredPendingDecisions(nowIso, limit = 50) {
  return getDatabase()
    .prepare(`
      SELECT *
      FROM campaign_event_payouts
      WHERE status = 'pending'
        AND expires_at <= ?
      ORDER BY expires_at ASC, id ASC
      LIMIT ?
    `)
    .all(nowIso, limit);
}

function markEventPayoutDecision({ id, status, decision, processedBy }) {
  return getDatabase()
    .prepare(`
      UPDATE campaign_event_payouts
      SET status = @status,
          decision = @decision,
          processed_by = @processedBy,
          decided_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
        AND status = 'pending'
    `)
    .run({ id, status, decision, processedBy });
}

function setDecisionDmMessage({ id, messageId }) {
  return getDatabase()
    .prepare('UPDATE campaign_event_payouts SET dm_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(messageId, id);
}

function insertContribution({ campaignId, userId, amount, sourceType, sourceId, createdBy, approvedBy, note }) {
  userId = accountLinks.resolvePrimaryUserId(userId);
  return getDatabase()
    .prepare(`
      INSERT INTO campaign_contributions
        (campaign_id, user_id, amount, source_type, source_id, status, created_by, approved_by, note)
      VALUES
        (@campaignId, @userId, @amount, @sourceType, @sourceId, 'approved', @createdBy, @approvedBy, @note)
    `)
    .run({
      campaignId,
      userId,
      amount,
      sourceType,
      sourceId: sourceId || null,
      createdBy,
      approvedBy: approvedBy || null,
      note: note || null
    });
}


function listContributorTotals(campaignId, limit = 50) {
  return getDatabase()
    .prepare(`
      SELECT
        cc.user_id,
        u.discord_name,
        u.albion_name,
        SUM(cc.amount) AS total_amount,
        COUNT(*) AS entries
      FROM campaign_contributions cc
      LEFT JOIN users u ON u.discord_id = cc.user_id
      WHERE cc.campaign_id = ?
        AND cc.status = 'approved'
      GROUP BY cc.user_id, u.discord_name, u.albion_name
      ORDER BY total_amount DESC, entries DESC
      LIMIT ?
    `)
    .all(campaignId, limit);
}
function updateCampaignProgressMessage({ campaignId, channelId, messageId }) {
  return getDatabase()
    .prepare(`
      UPDATE campaigns
      SET progress_channel_id = ?, progress_message_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .run(channelId, messageId, campaignId);
}

function listContributions(campaignId, limit = 20) {
  return getDatabase()
    .prepare(`
      SELECT cc.*, u.discord_name, u.albion_name
      FROM campaign_contributions cc
      LEFT JOIN users u ON u.discord_id = cc.user_id
      WHERE cc.campaign_id = ?
      ORDER BY cc.id DESC
      LIMIT ?
    `)
    .all(campaignId, limit);
}

module.exports = {
  createEventPayoutDecision,
  getActiveCampaign,
  getCampaign,
  getCampaignTotals,
  getEventPayoutDecision,
  insertContribution,
  listContributions,
  listContributorTotals,
  listEventPayoutDecisions,
  listExpiredPendingDecisions,
  markEventPayoutDecision,
  setDecisionDmMessage,
  updateCampaignProgressMessage
};
