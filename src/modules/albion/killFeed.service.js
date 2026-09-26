const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const { estimateCombatValues } = require('./marketValue.service');
const { backfillBattleEvents, finalizeStaleBattles, recordBattleEvent, syncReportedBattleButtons } = require('./battleReports.service');
const { recordGuildEncounter } = require('./guildKillboard.service');

const DEFAULT_API_BASE = 'https://gameinfo-ams.albiononline.com/api/gameinfo';
const LEGACY_AMERICAS_API_BASE = 'https://gameinfo.albiononline.com/api/gameinfo';
const GUILD_NAME = process.env.ALBION_GUILD_NAME || 'NoTag';
const PAGE_SIZE = 51;
const MAX_PAGES = 20;
const API_TIMEOUT_MS = 45000;
const API_RETRIES = 3;
const VENGEANCE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
let polling = false;
let lastHealthLogAt = 0;

function configuredApiBase(options = {}) {
  if (options.apiBase) return options.apiBase;
  const configured = String(process.env.ALBION_API_BASE_URL || process.env.ALBION_API_BASE || '').replace(/\/$/, '');
  // A NoTag deste Discord joga na Europa. Corrige automaticamente a configuracao antiga de Americas.
  if (!configured || configured === LEGACY_AMERICAS_API_BASE) return DEFAULT_API_BASE;
  return configured;
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function classifyEvent(event, guildName = GUILD_NAME) {
  const guild = normalize(guildName);
  const isKill = normalize(event?.Killer?.GuildName) === guild;
  const isDeath = normalize(event?.Victim?.GuildName) === guild;
  if (!isKill && !isDeath) return null;
  return isDeath ? 'death' : 'kill';
}

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function playerLabel(player) {
  const guild = player?.GuildName ? ` [${player.GuildName}]` : '';
  return `**${player?.Name || 'Desconhecido'}**${guild}`;
}

function participantLines(event) {
  const seen = new Set();
  return [event?.Killer, ...(event?.Participants || [])]
    .filter((player) => {
      if (!player?.Name || (event?.Victim?.Id && player.Id === event.Victim.Id)) return false;
      const key = player.Id || normalize(player.Name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((player, index) => {
      const guild = player.GuildName || 'Sem guild';
      const alliance = player.AllianceName || 'Sem aliança';
      return `${index + 1}. **${player.Name}** — Guild: **${guild}** | Ally: **${alliance}**`;
    });
}

function chunkLines(lines, maxLength = 3800) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (current && current.length + line.length + 1 > maxLength) {
      chunks.push(current);
      current = '';
    }
    current += `${current ? '\n' : ''}${line.slice(0, maxLength)}`;
  }
  if (current) chunks.push(current);
  return chunks;
}

function weaponImageUrl(player) {
  const weapon = player?.Equipment?.MainHand;
  if (!weapon?.Type) return null;
  return `https://render.albiononline.com/v1/item/${encodeURIComponent(weapon.Type)}.png?quality=${Number(weapon.Quality || 1)}`;
}

function weaponEmbed(player, label, color) {
  const weapon = player?.Equipment?.MainHand;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`Arma ${label}`)
    .setDescription(weapon?.Type ? `${playerLabel(player)}\n\`${weapon.Type}\`` : `${playerLabel(player)}\nArma não informada.`);
  const imageUrl = weaponImageUrl(player);
  if (imageUrl) embed.setThumbnail(imageUrl);
  return embed;
}

function killboardRegion(apiBase = '') {
  if (String(apiBase).includes('gameinfo-ams')) return 'eu';
  if (String(apiBase).includes('gameinfo-sgp')) return 'asia';
  return 'americas';
}

function registeredPlayer(db, albionPlayer) {
  const name = String(albionPlayer?.Name || '').trim();
  if (!name) return null;
  return db.prepare(`
    SELECT discord_id, albion_name FROM users
    WHERE registration_status = 'member' AND lower(trim(albion_name)) = lower(?)
    LIMIT 1
  `).get(name);
}

function recordVengeanceDeath(db, event) {
  const victim = registeredPlayer(db, event.Victim);
  if (!victim || !event.Killer?.Id || !event.EventId) return false;
  const occurredAt = new Date(event.TimeStamp || Date.now());
  if (Number.isNaN(occurredAt.getTime())) return false;
  db.prepare(`
    INSERT OR IGNORE INTO albion_vengeance_deaths
      (original_event_id, victim_discord_id, victim_albion_name, enemy_player_id, enemy_player_name, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(event.EventId, victim.discord_id, victim.albion_name, event.Killer.Id, event.Killer.Name || 'Desconhecido', occurredAt.toISOString());
  return true;
}

function findVengeanceMatches(db, event, now = new Date()) {
  const avenger = registeredPlayer(db, event.Killer);
  if (!avenger || !event.Victim?.Id || !event.EventId) return null;
  if (event.Killer?.AllianceId && event.Killer.AllianceId === event.Victim?.AllianceId) return null;
  const cutoff = new Date(now.getTime() - VENGEANCE_WINDOW_MS).toISOString();
  const rows = db.prepare(`
    SELECT * FROM albion_vengeance_deaths
    WHERE enemy_player_id = ? AND avenged_event_id IS NULL AND occurred_at >= ?
    ORDER BY occurred_at ASC
  `).all(event.Victim.Id, cutoff).filter((row) => row.victim_discord_id !== avenger.discord_id);
  return rows.length ? { avenger, rows } : null;
}

async function processVengeance(client, _channel, db, event, now = new Date()) {
  if (db.prepare('SELECT 1 FROM albion_vengeance_rewards WHERE vengeance_event_id = ?').get(event.EventId)) return null;
  const match = findVengeanceMatches(db, event, now);
  if (!match) return null;

  const originalIds = match.rows.map((row) => row.original_event_id);
  const mentions = [...new Set(match.rows.map((row) => `<@${row.victim_discord_id}>`))].join(', ');
  const oldest = Math.min(...match.rows.map((row) => new Date(row.occurred_at).getTime()));
  const days = Math.max(0, Math.floor((now.getTime() - oldest) / 86400000));
  const notagChannel = await client.channels.fetch(ids.channels.notagChat);
  if (!notagChannel?.isTextBased()) throw new Error(`Canal chat-notag indisponivel: ${ids.channels.notagChat}`);
  const message = await notagChannel.send({
    content: `<@${match.avenger.discord_id}> ${mentions}`,
    embeds: [new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('⚔️ Morte vingada!')
      .setDescription(`**${event.Killer.Name}** vingou ${mentions}, eliminando **${event.Victim.Name}**.`)
      .addFields(
        { name: 'Quando foi a morte', value: days === 0 ? 'Hoje' : `Há ${days} dia${days === 1 ? '' : 's'}`, inline: true },
        { name: 'Reconhecimento', value: 'Parabéns pela vingança!', inline: true },
        { name: 'Vingador', value: `<@${match.avenger.discord_id}>`, inline: true }
      )]
  });
  recordVengeance(db, event, match, originalIds);
  return { messageId: message.id, recognizedUserId: match.avenger.discord_id, originalIds };
}

function recordVengeance(db, event, match, originalIds) {
  const commit = db.transaction(() => {
    db.prepare(`
      INSERT INTO albion_vengeance_rewards
        (vengeance_event_id, avenger_discord_id, amount, original_events_json)
      VALUES (?, ?, ?, ?)
    `).run(event.EventId, match.avenger.discord_id, 0, JSON.stringify(originalIds));
    const mark = db.prepare(`
      UPDATE albion_vengeance_deaths
      SET avenged_event_id = ?, avenger_discord_id = ?, avenged_at = CURRENT_TIMESTAMP
      WHERE original_event_id = ? AND avenged_event_id IS NULL
    `);
    match.rows.forEach((row) => mark.run(event.EventId, match.avenger.discord_id, row.original_event_id));
  });
  commit();
}

function eventEmbed(event, type, apiBase = DEFAULT_API_BASE, valuations = null) {
  const death = type === 'death';
  const occurredAt = event.TimeStamp ? new Date(event.TimeStamp) : null;
  const region = killboardRegion(apiBase);
  const regionLabel = region === 'eu' ? 'Europa' : region === 'asia' ? 'Ásia' : 'Américas';
  const embed = new EmbedBuilder()
    .setColor(death ? 0xd83c3e : 0x2ecc71)
    .setTitle(death ? '☠️ Morte da NoTag' : '⚔️ Kill da NoTag')
    .setDescription(`${playerLabel(event.Killer)} matou ${playerLabel(event.Victim)}`)
    .addFields(
      { name: 'Fama da kill', value: formatNumber(event.TotalVictimKillFame), inline: true },
      { name: 'IP', value: `${Math.round(Number(event.Killer?.AverageItemPower || 0))} vs ${Math.round(Number(event.Victim?.AverageItemPower || 0))}`, inline: true },
      { name: 'Participantes', value: String(event.numberOfParticipants || event.Participants?.length || 1), inline: true }
    )
    .setFooter({ text: `Evento #${event.EventId} • Albion ${regionLabel}` });
  if (valuations?.killer?.total > 0) {
    embed.addFields({
      name: 'Valor estimado de quem matou',
      value: `~ ${formatNumber(valuations.killer.total)} prata (${valuations.killer.priced}/${valuations.killer.items} itens com preço)`,
      inline: false
    });
  }
  if (valuations?.victim?.total > 0) {
    embed.addFields({
      name: 'Perda estimada de quem morreu',
      value: `~ ${formatNumber(valuations.victim.total)} prata (${valuations.victim.priced}/${valuations.victim.items} itens com preço)`,
      inline: false
    });
  }
  if (occurredAt && !Number.isNaN(occurredAt.getTime())) embed.setTimestamp(occurredAt);
  return embed;
}

async function eventPayload(event, type, apiBase = DEFAULT_API_BASE, options = {}) {
  let valuations = null;
  try {
    valuations = await estimateCombatValues(event, options);
  } catch (error) {
    console.error(`Falha ao estimar valor perdido no evento Albion #${event.EventId}:`, error.message);
  }
  const participants = participantLines(event);
  const participantEmbeds = chunkLines(participants.length ? participants : ['Nenhum participante informado pela API.'])
    .slice(0, 7)
    .map((description, index) => new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(index ? `Participantes (${index + 1})` : 'Participantes')
      .setDescription(description));
  const weaponEmbeds = [
    weaponEmbed(event.Killer, 'de quem matou', 0x2ecc71),
    weaponEmbed(event.Victim, 'de quem morreu', 0xd83c3e)
  ];
  const url = `https://killboard-1.com/${killboardRegion(apiBase)}/event/${event.EventId}`;
  const components = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Ver detalhes no KillBoard #1').setURL(url)
  )];
  return { embeds: [eventEmbed(event, type, apiBase, valuations), ...participantEmbeds, ...weaponEmbeds], components };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(fetchImpl, apiBase, offset, options = {}) {
  const retries = options.retries ?? API_RETRIES;
  const timeoutMs = options.timeoutMs ?? API_TIMEOUT_MS;
  const url = `${apiBase.replace(/\/$/, '')}/events?limit=${PAGE_SIZE}&offset=${offset}`;
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'Notag-Discord-Killfeed/1.0' }
      });
      if (!response.ok) {
        const error = new Error(`API Albion respondeu ${response.status}.`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error('API Albion retornou um formato inesperado.');
      return body;
    } catch (error) {
      lastError = error;
      const retryable = error.name === 'AbortError' || error.retryable || error instanceof TypeError;
      if (!retryable || attempt === retries) break;
      await (options.waitImpl || wait)(attempt * 1500);
    } finally {
      clearTimeout(timeout);
    }
  }
  const detail = lastError?.name === 'AbortError'
    ? `timeout de ${Math.round(timeoutMs / 1000)}s`
    : lastError?.message || 'erro desconhecido';
  throw new Error(`Falha na API Albion após ${retries} tentativa(s): ${detail}`, { cause: lastError });
}

async function fetchRecentEvents(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const apiBase = configuredApiBase(options);
  const lastId = Number(options.lastId || 0);
  const result = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await fetchPage(fetchImpl, apiBase, page * PAGE_SIZE, options);
    result.push(...rows);
    if (rows.length < PAGE_SIZE || (lastId && rows.some((row) => Number(row.EventId) <= lastId))) break;
  }
  return result;
}

async function pollKillFeed(client, options = {}) {
  if (polling) return { skipped: true };
  polling = true;
  try {
    const db = options.db || getDatabase();
    const apiBase = configuredApiBase(options);
    const cursorKey = `latest_global_event_id:${killboardRegion(apiBase)}`;
    const storedCursor = Number(db.prepare('SELECT value FROM albion_killfeed_state WHERE key = ?').get(cursorKey)?.value || 0);
    const latest = storedCursor;
    const events = await fetchRecentEvents({ ...options, lastId: latest });
    const relevant = events
      .map((event) => ({ event, type: classifyEvent(event, options.guildName) }))
      .filter((item) => item.type && Number(item.event.EventId) > latest)
      .sort((a, b) => Number(a.event.EventId) - Number(b.event.EventId));

    const exists = db.prepare('SELECT 1 FROM albion_killfeed_events WHERE event_id = ?');
    const save = db.prepare('INSERT INTO albion_killfeed_events (event_id, event_type, event_at, discord_message_id) VALUES (?, ?, ?, ?)');
    let posted = 0;
    for (const item of relevant) {
      recordGuildEncounter(db, item.event, item.type);
      if (exists.get(item.event.EventId)) continue;
      const channelId = item.type === 'death' ? ids.channels.deathFeed : ids.channels.killFeed;
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) throw new Error(`Canal do killfeed indisponivel: ${channelId}`);
      const payload = await eventPayload(item.event, item.type, apiBase, options);
      const message = await channel.send(payload);
      save.run(item.event.EventId, item.type, item.event.TimeStamp || null, message.id);
      await recordBattleEvent(db, item.event, item.type, options);
      if (item.type === 'death') recordVengeanceDeath(db, item.event);
      if (item.type === 'kill') await processVengeance(client, channel, db, item.event);
      posted += 1;
    }
    const newestGlobalId = Math.max(latest, ...events.map((event) => Number(event.EventId) || 0));
    if (newestGlobalId > 0) {
      db.prepare(`
        INSERT INTO albion_killfeed_state (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(cursorKey, String(newestGlobalId));
    }
    const backfill = await backfillBattleEvents(db, { ...options, db, apiBase });
    const battles = backfill.pending === 0
      ? await finalizeStaleBattles(client, { ...options, db })
      : { reported: 0, discarded: 0 };
    const reportButtons = await syncReportedBattleButtons(client, { ...options, db });
    const now = Date.now();
    if (posted > 0 || battles.reported > 0 || now - lastHealthLogAt >= 10 * 60 * 1000) {
      console.log(`[KILLFEED] OK Europa | ${events.length} eventos consultados | ${relevant.length} da NoTag | ${posted} publicados | ${backfill.processed} histórico(s) recuperado(s) | ${battles.reported} batalha(s) relatada(s) | ${reportButtons.synced} botão(ões) sincronizado(s) | cursor ${newestGlobalId}`);
      lastHealthLogAt = now;
    }
    return { posted, checked: events.length, relevant: relevant.length, cursor: newestGlobalId, backfill, battles, reportButtons };
  } finally {
    polling = false;
  }
}

module.exports = {
  classifyEvent,
  configuredApiBase,
  eventEmbed,
  eventPayload,
  fetchRecentEvents,
  findVengeanceMatches,
  participantLines,
  pollKillFeed,
  processVengeance,
  recordVengeanceDeath,
  weaponImageUrl
};
