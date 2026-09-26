const { getDatabase } = require('../../database/connection');

function startSession(data) {
  const result = getDatabase().prepare(`
    INSERT INTO idle_game_sessions (guild_id, voice_channel_id, voice_channel_name, host_id, started_at)
    VALUES (@guildId, @channelId, @channelName, @hostId, @startedAt)
  `).run(data);
  return getSession(Number(result.lastInsertRowid));
}
function getSession(id) { return getDatabase().prepare('SELECT * FROM idle_game_sessions WHERE id = ?').get(id); }
function getRunningSession() { return getDatabase().prepare("SELECT * FROM idle_game_sessions WHERE status = 'running' ORDER BY id DESC LIMIT 1").get(); }
function endRunningSessions(endedAt) { return getDatabase().prepare("UPDATE idle_game_sessions SET status = 'ended', ended_at = ? WHERE status = 'running'").run(endedAt); }
function setMessageId(id, messageId) { return getDatabase().prepare('UPDATE idle_game_sessions SET discord_message_id = ? WHERE id = ?').run(messageId, id); }
function setTopicMessageId(id, messageId) { return getDatabase().prepare('UPDATE idle_game_sessions SET topic_message_id = ? WHERE id = ?').run(messageId, id); }
function joinPlayer({ sessionId, discordId, discordName, joinedAt, eventBonus }) {
  const db = getDatabase();
  const joined = db.prepare(`INSERT OR IGNORE INTO idle_game_participation (session_id, discord_id, discord_name, joined_at, event_bonus)
    VALUES (?, ?, ?, ?, ?)`).run(sessionId, discordId, discordName, joinedAt, eventBonus ? 1 : 0);
  db.prepare(`INSERT INTO idle_game_players (discord_id, discord_name, sessions_joined) VALUES (?, ?, 1)
    ON CONFLICT(discord_id) DO UPDATE SET discord_name=excluded.discord_name,
      sessions_joined=idle_game_players.sessions_joined+?, updated_at=CURRENT_TIMESTAMP`).run(discordId, discordName, joined.changes ? 1 : 0);
  return db.prepare(`UPDATE idle_game_participation SET left_at=NULL, discord_name=?, event_bonus=MAX(event_bonus, ?)
    WHERE session_id=? AND discord_id=?`).run(discordName, eventBonus ? 1 : 0, sessionId, discordId);
}
function leavePlayer(sessionId, discordId, leftAt) { return getDatabase().prepare('UPDATE idle_game_participation SET left_at=? WHERE session_id=? AND discord_id=?').run(leftAt, sessionId, discordId); }
function addFarm({ sessionId, discordId, seconds, points }) {
  const db = getDatabase();
  db.prepare('UPDATE idle_game_participation SET focus_seconds=focus_seconds+?, points=points+? WHERE session_id=? AND discord_id=?').run(seconds, points, sessionId, discordId);
  db.prepare('UPDATE idle_game_players SET total_focus_seconds=total_focus_seconds+?, total_points=total_points+?, updated_at=CURRENT_TIMESTAMP WHERE discord_id=?').run(seconds, points, discordId);
}
function addSpeech({ sessionId, discordId, penaltySeconds, penaltyUntil, occurredAt }) {
  const db = getDatabase();
  db.prepare('UPDATE idle_game_participation SET speech_count=speech_count+1, penalty_until=? WHERE session_id=? AND discord_id=?').run(penaltyUntil, sessionId, discordId);
  db.prepare('UPDATE idle_game_players SET total_speeches=total_speeches+1, updated_at=CURRENT_TIMESTAMP WHERE discord_id=?').run(discordId);
  db.prepare('INSERT INTO idle_game_speech_events (session_id, discord_id, penalty_seconds, occurred_at) VALUES (?, ?, ?, ?)').run(sessionId, discordId, penaltySeconds, occurredAt);
}
function listParticipation(sessionId) { return getDatabase().prepare('SELECT * FROM idle_game_participation WHERE session_id=? ORDER BY points DESC').all(sessionId); }
function listRecentSessions(limit=20) { return getDatabase().prepare('SELECT * FROM idle_game_sessions ORDER BY id DESC LIMIT ?').all(limit); }
function leaderboard(limit=20) { return getDatabase().prepare('SELECT * FROM idle_game_players ORDER BY total_points DESC LIMIT ?').all(limit); }
function recentSpeechCount(sessionId, discordId, since) { return getDatabase().prepare('SELECT COUNT(*) count FROM idle_game_speech_events WHERE session_id=? AND discord_id=? AND occurred_at>=?').get(sessionId, discordId, since).count; }

module.exports = { startSession, getSession, getRunningSession, endRunningSessions, setMessageId, setTopicMessageId, joinPlayer, leavePlayer, addFarm, addSpeech, listParticipation, listRecentSessions, leaderboard, recentSpeechCount };
