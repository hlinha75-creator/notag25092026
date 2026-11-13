const { getDatabase } = require('../../database/connection');

function startSession({ discordId, discordName, channelId, channelName, categoryId, categoryName, joinedAt }) {
  const open = getOpenSession(discordId);
  if (open) return { changes: 0, lastInsertRowid: open.id };
  return getDatabase()
    .prepare(`
      INSERT INTO voice_sessions
        (discord_id, discord_name, channel_id, channel_name, category_id, category_name, joined_at)
      VALUES
        (@discordId, @discordName, @channelId, @channelName, @categoryId, @categoryName, @joinedAt)
    `)
    .run({ discordId, discordName, channelId, channelName, categoryId, categoryName, joinedAt });
}

function closeOpenSession({ discordId, leftAt }) {
  const open = getOpenSession(discordId);
  if (!open) return { changes: 0 };
  const seconds = Math.max(0, Math.floor((Date.parse(leftAt) - Date.parse(open.joined_at)) / 1000));
  return getDatabase()
    .prepare(`
      UPDATE voice_sessions
      SET left_at = @leftAt, seconds = @seconds
      WHERE id = @id
    `)
    .run({ id: open.id, leftAt, seconds });
}

function getOpenSession(discordId) {
  return getDatabase()
    .prepare('SELECT * FROM voice_sessions WHERE discord_id = ? AND left_at IS NULL ORDER BY id DESC LIMIT 1')
    .get(discordId);
}

function listSessions(limit = 10000) {
  return getDatabase()
    .prepare(`
      SELECT
        vs.id,
        vs.discord_id,
        COALESCE(u.discord_name, vs.discord_name) AS discord_name,
        u.albion_name,
        vs.channel_id,
        vs.channel_name,
        vs.category_id,
        vs.category_name,
        vs.joined_at,
        vs.left_at,
        CASE
          WHEN vs.left_at IS NULL THEN CAST((julianday('now') - julianday(vs.joined_at)) * 86400 AS INTEGER)
          ELSE vs.seconds
        END AS seconds
      FROM voice_sessions vs
      LEFT JOIN users u ON u.discord_id = vs.discord_id
      ORDER BY vs.joined_at DESC
      LIMIT ?
    `)
    .all(limit);
}

function listSessionsForDate(dateText) {
  return getDatabase()
    .prepare(`
      SELECT
        vs.id,
        vs.discord_id,
        COALESCE(u.discord_name, vs.discord_name) AS discord_name,
        u.albion_name,
        vs.channel_id,
        vs.channel_name,
        vs.category_id,
        vs.category_name,
        vs.joined_at,
        vs.left_at,
        CASE
          WHEN vs.left_at IS NULL THEN CAST((julianday('now') - julianday(vs.joined_at)) * 86400 AS INTEGER)
          ELSE vs.seconds
        END AS seconds
      FROM voice_sessions vs
      LEFT JOIN users u ON u.discord_id = vs.discord_id
      WHERE substr(vs.joined_at, 1, 10) = ?
      ORDER BY vs.discord_id, vs.joined_at
    `)
    .all(dateText);
}

function closeAllOpenSessions(leftAt, maxSessionSeconds = 12 * 60 * 60) {
  return getDatabase()
    .prepare(`
      UPDATE voice_sessions
      SET
        left_at = CASE
          WHEN (julianday(@leftAt) - julianday(joined_at)) * 86400 > @maxSessionSeconds THEN joined_at
          ELSE @leftAt
        END,
        seconds = CASE
          WHEN (julianday(@leftAt) - julianday(joined_at)) * 86400 > @maxSessionSeconds THEN 0
          ELSE MAX(0, CAST((julianday(@leftAt) - julianday(joined_at)) * 86400 AS INTEGER))
        END
      WHERE left_at IS NULL
    `)
    .run({ leftAt, maxSessionSeconds });
}

function listWeeklyConsistentPlayers({ weekStart, weekEnd, minimumDailySeconds = 1800, minimumDays = 6 }) {
  return getDatabase()
    .prepare(`
      WITH daily AS (
        SELECT
          COALESCE(links.primary_discord_id, vs.discord_id) AS discord_id,
          COALESCE(NULLIF(primary_user.albion_name, ''), NULLIF(primary_user.discord_name, ''),
            NULLIF(source_user.albion_name, ''), NULLIF(source_user.discord_name, ''),
            NULLIF(vs.discord_name, ''), vs.discord_id) AS name,
          date(vs.joined_at, '-3 hours') AS day,
          SUM(CASE
            WHEN vs.left_at IS NULL THEN MAX(0, CAST((julianday('now') - julianday(vs.joined_at)) * 86400 AS INTEGER))
            ELSE COALESCE(vs.seconds, 0)
          END) AS seconds
        FROM voice_sessions vs
        LEFT JOIN linked_discord_accounts links ON links.linked_discord_id = vs.discord_id
        LEFT JOIN users primary_user ON primary_user.discord_id = COALESCE(links.primary_discord_id, vs.discord_id)
        LEFT JOIN users source_user ON source_user.discord_id = vs.discord_id
        WHERE date(vs.joined_at, '-3 hours') BETWEEN @weekStart AND @weekEnd
        GROUP BY COALESCE(links.primary_discord_id, vs.discord_id), day
      )
      SELECT discord_id, MAX(name) AS name, COUNT(*) AS days, SUM(seconds) AS seconds
      FROM daily
      WHERE seconds >= @minimumDailySeconds
      GROUP BY discord_id
      HAVING COUNT(*) >= @minimumDays
      ORDER BY days DESC, seconds DESC, name COLLATE NOCASE
    `)
    .all({ weekStart, weekEnd, minimumDailySeconds, minimumDays });
}

function getWeeklyAward(weekStart) {
  return getDatabase().prepare('SELECT * FROM weekly_voice_core_awards WHERE week_start = ?').get(weekStart);
}

function createWeeklyAward({ weekStart, weekEnd, channelId, messageId, qualifiedCount, awardedCount, qualifiedJson }) {
  return getDatabase().prepare(`
    INSERT INTO weekly_voice_core_awards
      (week_start, week_end, channel_id, message_id, qualified_count, awarded_count, qualified_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(weekStart, weekEnd, channelId, messageId, qualifiedCount, awardedCount, qualifiedJson);
}

module.exports = {
  closeAllOpenSessions,
  closeOpenSession,
  getOpenSession,
  getWeeklyAward,
  createWeeklyAward,
  listWeeklyConsistentPlayers,
  listSessionsForDate,
  listSessions,
  startSession
};
