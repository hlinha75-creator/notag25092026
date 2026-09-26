require('dotenv').config();
const path = require('node:path');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente ausente: ${name}`);
  }
  return value;
}

function resolveDatabasePath(value = process.env.DATABASE_PATH || './data/notag.sqlite') {
  const projectRoot = path.resolve(__dirname, '..', '..');
  if (!value) return path.join(projectRoot, 'data/notag.sqlite');
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

module.exports = {
  token: process.env.DISCORD_TOKEN,
  discordClientId: process.env.CLIENT_ID,
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET,
  requireEnv,
  resolveDatabasePath,
  databasePath: resolveDatabasePath(),
  nodeEnv: process.env.NODE_ENV || 'development',
  dashboardBaseUrl: (process.env.DASHBOARD_BASE_URL || 'http://localhost:8080').replace(/\/$/, ''),
  dashboardHost: process.env.DASHBOARD_HOST || '0.0.0.0',
  dashboardPort: Number(process.env.PORT || process.env.DASHBOARD_PORT || 8080),
  dashboardSessionSecret: process.env.DASHBOARD_SESSION_SECRET,
  commandAllowedUserIds: (process.env.COMMAND_ALLOWED_USER_IDS || '1276439186513203234,1436716667894759475,334126478457307136,244264130234679296')
    .split(',').map((id) => id.trim()).filter(Boolean),
  giveawayTimeZone: process.env.GIVEAWAY_TIME_ZONE || 'America/Sao_Paulo',
  giveawayMaxActivePerUser: Number(process.env.GIVEAWAY_MAX_ACTIVE_PER_USER || 2),
  giveawayCooldownMinutes: Number(process.env.GIVEAWAY_COOLDOWN_MINUTES || 60),
  idleHostUserIds: (process.env.IDLE_HOST_USER_IDS || process.env.IDLE_HOST_USER_ID || '1276439186513203234,1436716667894759475')
    .split(',').map((id) => id.trim()).filter(Boolean),
  idleTopicId: process.env.IDLE_TOPIC_ID || '1525824031784304770',
  idleArchiveTopicId: process.env.IDLE_ARCHIVE_TOPIC_ID || '1525841189939445810',
  missionAuthorIds: (process.env.MISSION_AUTHOR_IDS || '1276439186513203234,1436716667894759475')
    .split(',').map((id) => id.trim()).filter(Boolean)
};
