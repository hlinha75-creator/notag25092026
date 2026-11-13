const { EmbedBuilder } = require('discord.js');
const env = require('../../config/env');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');

const PERIODS = Object.freeze({
  '24h': { hours: 24, label: '24 horas' },
  '7d': { hours: 7 * 24, label: '7 dias' },
  '30d': { hours: 30 * 24, label: '30 dias' }
});
const ANNOUNCEMENT_KEY = 'guild_killboard_announcement:v1';

function normalizeGuild(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function encounterPlayer(event, type) {
  return type === 'kill' ? event?.Victim : event?.Killer;
}

function recordGuildEncounter(db, event, type) {
  if (!['kill', 'death'].includes(type) || !event?.EventId) return false;
  const opponent = encounterPlayer(event, type);
  const opponentGuild = String(opponent?.GuildName || '').trim();
  const opponentGuildId = String(opponent?.GuildId || '').trim() || null;
  if (!opponentGuild) return false;
  const eventAt = new Date(event.TimeStamp || Date.now());
  if (Number.isNaN(eventAt.getTime())) return false;
  const result = db.prepare(`
    INSERT INTO albion_guild_encounters
      (event_id, event_type, event_at, opponent_guild, opponent_guild_key, opponent_guild_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      opponent_guild_id = COALESCE(excluded.opponent_guild_id, albion_guild_encounters.opponent_guild_id)
  `).run(event.EventId, type, eventAt.toISOString(), opponentGuild, normalizeGuild(opponentGuild), opponentGuildId);
  return result.changes > 0;
}

function rankingRows(db, eventType, cutoff, limit) {
  return db.prepare(`
    WITH known_ids AS (
      SELECT opponent_guild_key, MAX(NULLIF(opponent_guild_id, '')) AS guildId
      FROM albion_guild_encounters
      GROUP BY opponent_guild_key
    ),
    filtered AS (
      SELECT
        encounter.*,
        COALESCE(NULLIF(encounter.opponent_guild_id, ''), known_ids.guildId) AS effectiveGuildId,
        COALESCE(NULLIF(encounter.opponent_guild_id, ''), known_ids.guildId, 'name:' || encounter.opponent_guild_key) AS identityKey
      FROM albion_guild_encounters encounter
      LEFT JOIN known_ids ON known_ids.opponent_guild_key = encounter.opponent_guild_key
      WHERE encounter.event_type = ? AND encounter.event_at >= ?
    ),
    ranking AS (
      SELECT
        identityKey,
        COUNT(*) AS deaths,
        MAX(event_at) AS lastEventAt,
        MAX(effectiveGuildId) AS guildId
      FROM filtered
      GROUP BY identityKey
    ),
    latest AS (
      SELECT
        identityKey,
        opponent_guild,
        ROW_NUMBER() OVER (PARTITION BY identityKey ORDER BY event_at DESC, event_id DESC) AS rowNumber
      FROM filtered
    )
    SELECT
      latest.opponent_guild AS guild,
      ranking.guildId,
      ranking.deaths,
      ranking.lastEventAt
    FROM ranking
    JOIN latest ON latest.identityKey = ranking.identityKey AND latest.rowNumber = 1
    ORDER BY ranking.deaths DESC, ranking.lastEventAt DESC, guild COLLATE NOCASE
    LIMIT ?
  `).all(eventType, cutoff, limit).map((row) => ({
    guild: row.guild,
    guildId: row.guildId || null,
    statsUrl: row.guildId ? `https://europe.albionbb.com/guilds/${encodeURIComponent(row.guildId)}/attendance` : null,
    deaths: Number(row.deaths),
    lastEventAt: row.lastEventAt
  }));
}

function encounterTotal(db, eventType, cutoff) {
  return Number(db.prepare(`
    SELECT COUNT(*) AS total
    FROM albion_guild_encounters
    WHERE event_type = ? AND event_at >= ?
  `).get(eventType, cutoff).total || 0);
}

function getGuildRankings(period = '24h', options = {}) {
  const selected = PERIODS[period] ? period : '24h';
  const definition = PERIODS[selected];
  const db = options.db || getDatabase();
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const limit = Math.min(25, Math.max(1, Number(options.limit || 10)));
  const cutoff = new Date(now.getTime() - definition.hours * 60 * 60 * 1000).toISOString();
  const kills = rankingRows(db, 'kill', cutoff, limit);
  const deaths = rankingRows(db, 'death', cutoff, limit);
  const coverage = db.prepare('SELECT MIN(event_at) AS oldestEventAt, MAX(event_at) AS newestEventAt FROM albion_guild_encounters').get();
  return {
    period: selected,
    periodLabel: definition.label,
    generatedAt: now.toISOString(),
    cutoff,
    kills,
    deaths,
    totals: {
      kills: encounterTotal(db, 'kill', cutoff),
      deaths: encounterTotal(db, 'death', cutoff)
    },
    coverage
  };
}

function publicUrl() {
  const configured = env.dashboardBaseUrl;
  const base = configured.includes('localhost') ? 'https://notag.discloud.app' : configured;
  return `${base}/killboardguilds`;
}

async function postGuildKillboardAnnouncementIfNeeded(client, options = {}) {
  const db = options.db || getDatabase();
  if (db.prepare('SELECT 1 FROM albion_killfeed_state WHERE key = ?').get(ANNOUNCEMENT_KEY)) {
    return { sent: false, reason: 'already_sent' };
  }
  const channel = await client.channels.fetch(ids.channels.notagChat);
  if (!channel?.isTextBased()) throw new Error(`Canal chat-notag indisponivel: ${ids.channels.notagChat}`);
  const url = options.url || publicUrl();
  const message = await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('⚔️ Novo no Killboard NoTag!')
      .setDescription('Quer descobrir quais guildas mais estão matando a gente — e quais guildas nós mais estamos eliminando?')
      .addFields({ name: 'Rankings disponíveis', value: 'Últimas **24 horas**, **7 dias** e **30 dias**.' })
      .setFooter({ text: 'Os dados são atualizados automaticamente pelo killfeed.' })],
    components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Ver ranking de guildas', url }]}]
  });
  db.prepare(`
    INSERT INTO albion_killfeed_state (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).run(ANNOUNCEMENT_KEY, message.id || 'sent');
  return { sent: true, messageId: message.id || null, url };
}

module.exports = {
  PERIODS,
  getGuildRankings,
  normalizeGuild,
  postGuildKillboardAnnouncementIfNeeded,
  recordGuildEncounter
};
