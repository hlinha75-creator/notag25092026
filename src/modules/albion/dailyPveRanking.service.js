const { EmbedBuilder } = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase, transaction } = require('../../database/connection');
const { formatFame } = require('./fame.service');

const DEFAULT_API_BASE = 'https://gameinfo-ams.albiononline.com/api/gameinfo';
const GUILD_NAME = process.env.ALBION_GUILD_NAME || 'NoTag';
const POST_AFTER_HOUR = 9;
const API_CONCURRENCY = 1;
const API_THROTTLE_MS = 1500;
const API_RETRIES = 4;
const API_TIMEOUT_MS = 15000;
const API_MAX_RETRY_DELAY_MS = 30000;
const CATEGORIES = [
  ['pveFame', 'PvE'],
  ['pvpFame', 'PvP'],
  ['craftingFame', 'Craft'],
  ['gatheringFame', 'Coleta'],
  ['totalFame', 'Fama total']
];

async function postDailyPveRankingIfNeeded(client, now = new Date()) {
  if (saoPauloHour(now) < POST_AFTER_HOUR) return null;
  const dateKey = saoPauloDateKey(now);
  const reminderKey = `albion-fame-daily:${dateKey}`;
  if (hasReminder(reminderKey)) return null;

  const result = await publishRanking(client, { period: 'daily', now, saveSnapshot: true });
  saveReminder(reminderKey, 'albion_fame_daily', result.messageId, result.channelId);
  await postMoveNoticeIfNeeded(client, dateKey);
  return result;
}

async function postWeeklyRankingIfNeeded(client, now = new Date()) {
  if (saoPauloHour(now) < POST_AFTER_HOUR || saoPauloWeekday(now) !== 1) return null;
  const range = previousWeekRange(now);
  const reminderKey = `albion-fame-weekly:${range.start}:${range.end}`;
  if (hasReminder(reminderKey)) return null;

  const result = await publishRanking(client, { period: 'weekly', now });
  saveReminder(reminderKey, 'albion_fame_weekly', result.messageId, result.channelId);
  return result;
}

async function publishPveRanking(client, now = new Date()) {
  return publishRanking(client, { period: 'daily', now, saveSnapshot: true });
}

async function replaceDailyRanking(client, now = new Date()) {
  const dateKey = saoPauloDateKey(now);
  const reminderKey = `albion-fame-daily:${dateKey}`;
  const db = getDatabase();
  const previous = db.prepare(`
    SELECT message_id, channel_id FROM operation_reminders WHERE reminder_key = ?
  `).get(reminderKey);

  const result = await publishRanking(client, { period: 'daily', now, saveSnapshot: true });

  if (previous?.message_id && previous?.channel_id && previous.message_id !== result.messageId) {
    const oldChannel = await client.channels.fetch(previous.channel_id).catch(() => null);
    if (oldChannel?.isTextBased()) {
      const oldMessage = await oldChannel.messages.fetch(previous.message_id).catch(() => null);
      if (oldMessage) await oldMessage.delete().catch(() => null);
    }
  }

  db.prepare(`
    INSERT INTO operation_reminders (reminder_key, type, message_id, channel_id)
    VALUES (?, 'albion_fame_daily', ?, ?)
    ON CONFLICT(reminder_key) DO UPDATE SET
      message_id = excluded.message_id,
      channel_id = excluded.channel_id,
      sent_at = CURRENT_TIMESTAMP
  `).run(reminderKey, result.messageId, result.channelId);
  return { ...result, replacedMessageId: previous?.message_id || null };
}

async function publishRanking(client, { period = 'daily', now = new Date(), saveSnapshot = period === 'daily' } = {}) {
  const dateKey = saoPauloDateKey(now);
  let rows;
  let subtitle;

  if (period === 'weekly') {
    const range = previousWeekRange(now);
    rows = weeklyGrowthRows(range.start, range.end);
    if (!rows.length) throw new Error(`Nao ha pelo menos dois snapshots entre ${range.start} e ${range.end} para gerar o semanal.`);
    subtitle = `Fama conquistada de ${formatDate(range.start)} a ${formatDate(range.end)}`;
  } else {
    const currentRows = await fetchFameRanking(registeredAlbionNames());
    if (!currentRows.length) throw new Error('A API do Albion nao retornou fama para nenhum jogador cadastrado.');
    const daily = dailyGrowthRows(dateKey, currentRows);
    if (saveSnapshot) saveDailySnapshot(dateKey, currentRows);
    rows = daily.rows;
    subtitle = daily.previousDate
      ? `Fama conquistada desde ${formatDate(daily.previousDate)} • Total de carreira ao lado`
      : `Base inicial salva em ${formatDate(dateKey)} • Ainda sem dia anterior para comparar`;
  }

  attachDiscordIds(rows);

  const channelId = rankingChannelId(dateKey);
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error(`Canal ou topico do ranking indisponivel: ${channelId}`);
  const mentionedIds = period === 'weekly' ? weeklyPodiumDiscordIds(rows) : [];
  const message = await channel.send({
    content: mentionedIds.length ? `🏆 **Pódio da semana:** ${mentionedIds.map((id) => `<@${id}>`).join(' ')}` : undefined,
    embeds: [rankingEmbed(rows, period, subtitle)],
    allowedMentions: period === 'weekly' ? { users: mentionedIds } : { parse: [] }
  });
  return { totalPlayers: rows.length, messageId: message.id, channelId: channel.id, period };
}

function registeredAlbionNames() {
  return getDatabase().prepare(`
    SELECT DISTINCT albion_name FROM users
    WHERE albion_name IS NOT NULL AND trim(albion_name) <> '' AND registration_status = 'member'
    ORDER BY albion_name COLLATE NOCASE
  `).all().map((row) => row.albion_name);
}

async function fetchFameRanking(names, options = {}) {
  const { fetchImpl = fetch, apiBase = process.env.ALBION_API_BASE || DEFAULT_API_BASE } = options;
  const concurrency = Math.max(1, Number(options.concurrency || API_CONCURRENCY));
  const throttleMs = Math.max(0, Number(options.throttleMs ?? (fetchImpl === fetch ? API_THROTTLE_MS : 0)));
  const warnLogger = options.warnLogger || console.warn;
  const uniqueNames = [...new Set(names.map((name) => String(name || '').trim()).filter(Boolean))];
  if (!uniqueNames.length) throw new Error('Nao ha jogadores Albion aprovados para montar o ranking.');
  const results = [];
  for (let index = 0; index < uniqueNames.length; index += concurrency) {
    const batch = uniqueNames.slice(index, index + concurrency);
    const rows = await Promise.all(batch.map(async (name) => {
      try {
        return await fetchPlayerFame(name, { ...options, fetchImpl, apiBase });
      } catch (error) {
        if (error?.status === 429 || isSystemResourceError(error)) throw error;
        warnLogger(`[ALBION FAMA] Jogador ${name} ignorado apos falha: ${error.message}`);
        return null;
      }
    }));
    results.push(...rows.filter(Boolean));
    if (throttleMs && index + concurrency < uniqueNames.length) await wait(throttleMs);
  }
  return results;
}

async function fetchPveRanking(names, options = {}) {
  const rows = await fetchFameRanking(names, options);
  return rows.sort((a, b) => b.pveFame - a.pveFame || a.name.localeCompare(b.name));
}

async function fetchPlayerFame(name, options) {
  const { fetchImpl, apiBase } = options;
  const search = await fetchAlbionJson(
    `${apiBase}/search?q=${encodeURIComponent(name)}`,
    `buscar ${name}`,
    options
  );
  const match = (search.players || []).find((player) => normalizeName(player.Name) === normalizeName(name));
  if (!match?.Id) return null;
  const player = await fetchAlbionJson(
    `${apiBase}/players/${encodeURIComponent(match.Id)}`,
    `consultar ${name}`,
    options
  );
  if (normalizeGuildName(player?.GuildName) !== normalizeGuildName(GUILD_NAME)) return null;
  return extractFame(player, match.Name || name);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAlbionJson(url, action, options = {}) {
  const retries = Math.max(1, Number(options.retries || API_RETRIES));
  const timeoutMs = Math.max(1, Number(options.timeoutMs || API_TIMEOUT_MS));
  const waitImpl = options.waitImpl || wait;
  let lastStatus = 0;
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
      const response = await options.fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'Notag-Discord-Bot/1.0' }
      });
      if (response.ok) return await response.json();
      lastStatus = Number(response.status || 0);
      const retryable = lastStatus === 429 || lastStatus >= 500;
      const retryDelay = retryDelayMs(response, attempt, options);
      await releaseResponse(response);
      if (!retryable || attempt === retries) break;
      await waitImpl(retryDelay);
    } catch (error) {
      lastStatus = 0;
      lastError = error;
      if (!isRetryableFetchError(error) || attempt === retries) break;
      await waitImpl(retryDelayMs(null, attempt, options));
    } finally {
      clearTimeout(timeout);
    }
  }
  if (lastStatus) {
    const error = new Error(`API Albion respondeu ${lastStatus} ao ${action} apos ${retries} tentativa(s).`);
    error.status = lastStatus;
    throw error;
  }
  const detail = lastError?.name === 'AbortError'
    ? `timeout de ${Math.round(timeoutMs / 1000)}s`
    : lastError?.message || 'erro desconhecido';
  throw new Error(`Falha ao ${action} na API Albion apos ${retries} tentativa(s): ${detail}`, { cause: lastError });
}

function retryDelayMs(response, attempt, options = {}) {
  const retryAfter = response?.headers?.get?.('retry-after');
  const seconds = Number(retryAfter);
  const hasRetryAfter = retryAfter !== null && retryAfter !== undefined && retryAfter !== '';
  let delay = hasRetryAfter && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
  if (delay === null && retryAfter) {
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) delay = Math.max(0, retryAt - Date.now());
  }
  if (delay === null) delay = 1000 * (2 ** Math.max(0, attempt - 1));
  return Math.min(Number(options.maxRetryDelayMs || API_MAX_RETRY_DELAY_MS), delay);
}

async function releaseResponse(response) {
  try {
    await response?.body?.cancel?.();
  } catch {}
}

function isSystemResourceError(error) {
  const code = error?.code || error?.cause?.code;
  return code === 'ENFILE' || code === 'EMFILE';
}

function isRetryableFetchError(error) {
  const code = error?.code || error?.cause?.code;
  return error?.name === 'AbortError'
    || error instanceof TypeError
    || ['EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(code);
}

function extractFame(player, fallbackName = '') {
  const stats = player?.LifetimeStatistics || {};
  const pveFame = numericTotal(stats.PvE);
  const pvpFame = Number(player?.KillFame || 0);
  const craftingFame = numericTotal(stats.Crafting);
  const gatheringFame = numericTotal(stats.Gathering?.All ?? stats.Gathering);
  return {
    name: player?.Name || fallbackName,
    key: normalizeName(player?.Name || fallbackName),
    pveFame,
    pvpFame,
    craftingFame,
    gatheringFame,
    totalFame: pveFame + pvpFame + craftingFame + gatheringFame
  };
}

function extractPveFame(player) {
  return numericTotal(player?.LifetimeStatistics?.PvE);
}

function numericTotal(value) {
  if (Number.isFinite(Number(value?.Total))) return Number(value.Total);
  if (typeof value === 'number') return value;
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value).reduce((sum, child) => sum + numericTotal(child), 0);
}

const saveDailySnapshot = transaction((dateKey, rows) => {
  const stmt = getDatabase().prepare(`
    INSERT INTO albion_fame_daily_snapshots
      (snapshot_date, albion_key, albion_name, pve_fame, pvp_fame, crafting_fame, gathering_fame, total_fame)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_date, albion_key) DO UPDATE SET
      albion_name=excluded.albion_name, pve_fame=excluded.pve_fame, pvp_fame=excluded.pvp_fame,
      crafting_fame=excluded.crafting_fame, gathering_fame=excluded.gathering_fame,
      total_fame=excluded.total_fame, captured_at=CURRENT_TIMESTAMP
  `);
  for (const row of rows) {
    stmt.run(dateKey, row.key, row.name, row.pveFame, row.pvpFame, row.craftingFame, row.gatheringFame, row.totalFame);
  }
});

function weeklyGrowthRows(start, end) {
  const snapshots = getDatabase().prepare(`
    SELECT * FROM albion_fame_daily_snapshots WHERE snapshot_date BETWEEN ? AND ?
    ORDER BY snapshot_date, albion_name COLLATE NOCASE
  `).all(start, end);
  const latestDate = snapshots.at(-1)?.snapshot_date;
  const presentOnLatestDate = new Set(
    snapshots.filter((row) => row.snapshot_date === latestDate).map((row) => row.albion_key)
  );
  const grouped = new Map();
  for (const row of snapshots) {
    if (!presentOnLatestDate.has(row.albion_key)) continue;
    const list = grouped.get(row.albion_key) || [];
    list.push(row);
    grouped.set(row.albion_key, list);
  }
  return [...grouped.values()].filter((list) => list.length >= 2).map((list) => {
    const first = list[0];
    const last = list[list.length - 1];
    const growth = (column) => Math.max(0, Number(last[column]) - Number(first[column]));
    return {
      name: last.albion_name, key: last.albion_key,
      pveFame: growth('pve_fame'), pvpFame: growth('pvp_fame'),
      craftingFame: growth('crafting_fame'), gatheringFame: growth('gathering_fame'),
      totalFame: growth('total_fame')
    };
  });
}

function dailyGrowthRows(dateKey, currentRows) {
  const previousDate = getDatabase().prepare(`
    SELECT MAX(snapshot_date) AS snapshot_date
    FROM albion_fame_daily_snapshots
    WHERE snapshot_date < ?
  `).get(dateKey)?.snapshot_date || null;

  if (!previousDate) return { previousDate: null, rows: currentRows };

  const previous = getDatabase().prepare(`
    SELECT * FROM albion_fame_daily_snapshots WHERE snapshot_date = ?
  `).all(previousDate);
  const byPlayer = new Map(previous.map((row) => [row.albion_key, row]));
  const columns = {
    pveFame: 'pve_fame',
    pvpFame: 'pvp_fame',
    craftingFame: 'crafting_fame',
    gatheringFame: 'gathering_fame',
    totalFame: 'total_fame'
  };

  const rows = currentRows.map((current) => {
    const before = byPlayer.get(current.key);
    if (!before) {
      return {
        ...current,
        pveFame: 0,
        pvpFame: 0,
        craftingFame: 0,
        gatheringFame: 0,
        totalFame: 0,
        careerTotals: current
      };
    }
    const growth = { name: current.name, key: current.key, careerTotals: current };
    for (const [key, column] of Object.entries(columns)) {
      growth[key] = Math.max(0, Number(current[key]) - Number(before[column]));
    }
    return growth;
  });
  return { previousDate, rows };
}

function rankingEmbed(rows, period, subtitle) {
  const embed = new EmbedBuilder()
    .setColor(period === 'weekly' ? 0xf5a623 : 0x38a169)
    .setTitle(period === 'weekly' ? 'Top 5 semanal — Fama conquistada' : 'Top 5 diário — Fama Albion')
    .setFooter({ text: subtitle }).setTimestamp();
  for (const [key, label] of CATEGORIES) {
    const top = [...rows].sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name)).slice(0, 5);
    embed.addFields({
      name: label,
      value: top.map((row, index) => {
        const mention = row.discordId ? ` (<@${row.discordId}>)` : '';
        const value = row.careerTotals
          ? `+${formatFame(row[key])} hoje | Total: ${formatFame(row.careerTotals[key])}`
          : formatFame(row[key]);
        return `${medal(index)} **${row.name}**${mention} — ${value}`;
      }).join('\n') || 'Sem dados.'
    });
  }
  return embed;
}

function attachDiscordIds(rows) {
  const members = getDatabase().prepare(`
    SELECT discord_id, albion_name FROM users
    WHERE discord_id IS NOT NULL AND albion_name IS NOT NULL AND registration_status = 'member'
  `).all();
  const byAlbion = new Map(members.map((member) => [normalizeName(member.albion_name), member.discord_id]));
  for (const row of rows) row.discordId = byAlbion.get(row.key || normalizeName(row.name)) || null;
  return rows;
}

function weeklyPodiumDiscordIds(rows) {
  return [...rows]
    .sort((a, b) => b.totalFame - a.totalFame || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((row) => row.discordId)
    .filter(Boolean);
}

async function postMoveNoticeIfNeeded(client, dateKey) {
  if (daysSinceFirstDaily(dateKey) !== 2) return;
  const key = 'albion-fame-ranking-move-notice';
  if (hasReminder(key)) return;
  const channel = await client.channels.fetch(ids.channels.notagChat);
  if (!channel?.isTextBased()) return;
  const message = await channel.send(`📢 **Aviso:** a partir de amanhã, os rankings diários e semanais de fama serão publicados em <#${ids.channels.fameRankingTopic}>.`);
  saveReminder(key, 'albion_fame_move_notice', message.id, channel.id);
}

function rankingChannelId(dateKey) {
  return daysSinceFirstDaily(dateKey) >= 3 ? ids.channels.fameRankingTopic : ids.channels.notagChat;
}

function daysSinceFirstDaily(dateKey) {
  const first = getDatabase().prepare(`
    SELECT substr(reminder_key, -10) AS date_key FROM operation_reminders
    WHERE reminder_key LIKE 'albion-fame-daily:%' ORDER BY date_key LIMIT 1
  `).get()?.date_key;
  if (!first) return 0;
  return Math.max(0, Math.round((Date.parse(`${dateKey}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / 86400000));
}

function previousWeekRange(now) {
  const today = saoPauloDateKey(now);
  const date = new Date(`${today}T12:00:00Z`);
  const weekday = date.getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const currentMonday = new Date(date.getTime() - daysSinceMonday * 86400000);
  const start = new Date(currentMonday.getTime() - 7 * 86400000);
  const end = new Date(currentMonday.getTime() - 86400000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function hasReminder(key) { return Boolean(getDatabase().prepare('SELECT 1 FROM operation_reminders WHERE reminder_key=?').get(key)); }
function saveReminder(key, type, messageId, channelId) {
  getDatabase().prepare('INSERT INTO operation_reminders (reminder_key,type,message_id,channel_id) VALUES (?,?,?,?)').run(key, type, messageId, channelId);
}
function medal(index) { return ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][index] || `${index + 1}.`; }
function normalizeName(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function normalizeGuildName(value) { return String(value || '').trim().toLocaleLowerCase('en-US'); }
function saoPauloHour(date) { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(date)); }
function saoPauloWeekday(date) { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).formatToParts(date).find((p) => p.type === 'weekday')?.value === 'Mon'); }
function saoPauloDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function formatDate(key) { const [y, m, d] = key.split('-'); return `${d}/${m}/${y}`; }

module.exports = {
  dailyGrowthRows, extractFame, extractPveFame, fetchFameRanking, fetchPveRanking, postDailyPveRankingIfNeeded,
  postWeeklyRankingIfNeeded, previousWeekRange, publishPveRanking, publishRanking, replaceDailyRanking,
  weeklyGrowthRows, weeklyPodiumDiscordIds
};
