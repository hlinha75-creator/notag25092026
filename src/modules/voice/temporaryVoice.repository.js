const { getDatabase } = require('../../database/connection');

function save({ channelId, guildId, ownerId, triggerChannelId }) {
  return getDatabase().prepare(`
    INSERT INTO temporary_voice_channels
      (channel_id, guild_id, owner_id, trigger_channel_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (guild_id, owner_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      trigger_channel_id = excluded.trigger_channel_id,
      created_at = CURRENT_TIMESTAMP
  `).run(channelId, guildId, ownerId, triggerChannelId);
}

function getByChannel(channelId) {
  return getDatabase().prepare('SELECT * FROM temporary_voice_channels WHERE channel_id = ?').get(channelId);
}

function getByOwner(guildId, ownerId) {
  return getDatabase().prepare(`
    SELECT * FROM temporary_voice_channels WHERE guild_id = ? AND owner_id = ?
  `).get(guildId, ownerId);
}

function listByGuild(guildId) {
  return getDatabase().prepare('SELECT * FROM temporary_voice_channels WHERE guild_id = ?').all(guildId);
}

function remove(channelId) {
  return getDatabase().prepare('DELETE FROM temporary_voice_channels WHERE channel_id = ?').run(channelId);
}

module.exports = { getByChannel, getByOwner, listByGuild, remove, save };
