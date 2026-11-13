const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const ids = require('../../config/ids');
const env = require('../../config/env');
const { estimateVictimBuild } = require('./marketValue.service');

const DEFAULT_GUILD_NAME = process.env.ALBION_GUILD_NAME || 'NoTag';
const DEFAULT_IDLE_MS = 30 * 60 * 1000;
const NEARBY_EVENT_MS = 5 * 60 * 1000;
const MIN_NOTAG_MEMBERS = 4;
const MIN_DEATHS = 2;
const BACKFILL_BATCH_SIZE = 20;
const DEFAULT_HISTORY_MS = Math.max(1, Number(process.env.ALBION_BATTLE_HISTORY_DAYS || 7)) * 24 * 60 * 60 * 1000;

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseJson(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function eventActors(event) {
  const actors = [event?.Killer, event?.Victim, ...(event?.Participants || [])];
  const seen = new Set();
  return actors.filter((player) => {
    if (!player?.Name && !player?.Id) return false;
    const key = String(player.Id || normalize(player.Name));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function eventIdentity(event, guildName = DEFAULT_GUILD_NAME) {
  const guild = normalize(guildName);
  const actors = eventActors(event);
  const notagMembers = unique(actors
    .filter((player) => normalize(player.GuildName) === guild)
    .map((player) => player.Name || player.Id));
  const playerKeys = unique(actors.map((player) => String(player.Id || normalize(player.Name))));
  const enemies = actors.filter((player) => normalize(player.GuildName) !== guild);
  return {
    notagMembers,
    playerKeys,
    enemyGuilds: unique(enemies.map((player) => normalize(player.GuildName))),
    enemyAlliances: unique(enemies.map((player) => normalize(player.AllianceName)))
  };
}

function overlap(left, right) {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function battleIdentity(db, battleId) {
  const rows = db.prepare(`
    SELECT notag_members_json, player_keys_json, enemy_guilds_json, enemy_alliances_json
    FROM albion_battle_events WHERE battle_id = ?
  `).all(battleId);
  return {
    notagMembers: unique(rows.flatMap((row) => parseJson(row.notag_members_json))),
    playerKeys: unique(rows.flatMap((row) => parseJson(row.player_keys_json))),
    enemyGuilds: unique(rows.flatMap((row) => parseJson(row.enemy_guilds_json))),
    enemyAlliances: unique(rows.flatMap((row) => parseJson(row.enemy_alliances_json)))
  };
}

function selectBattle(db, eventAt, identity, options = {}) {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const eventTime = new Date(eventAt).getTime();
  const cutoff = new Date(eventTime - idleMs).toISOString();
  const candidates = db.prepare(`
    SELECT * FROM albion_battles
    WHERE status = 'active' AND last_event_at >= ? AND last_event_at <= ?
    ORDER BY last_event_at DESC
  `).all(cutoff, eventAt);

  let best = null;
  for (const battle of candidates) {
    const known = battleIdentity(db, battle.id);
    const gap = eventTime - new Date(battle.last_event_at).getTime();
    let score = gap <= NEARBY_EVENT_MS ? 1 : 0;
    if (overlap(identity.notagMembers, known.notagMembers)) score += 10;
    if (overlap(identity.playerKeys, known.playerKeys)) score += 6;
    if (overlap(identity.enemyGuilds, known.enemyGuilds)) score += 3;
    if (overlap(identity.enemyAlliances, known.enemyAlliances)) score += 3;
    if (score > 0 && (!best || score > best.score)) best = { battle, score };
  }
  return best?.battle || null;
}

async function recordBattleEvent(db, event, eventType, options = {}) {
  if (!event?.EventId || !event?.Victim) return null;
  const existing = db.prepare('SELECT battle_id FROM albion_battle_events WHERE event_id = ?').get(event.EventId);
  if (existing) return existing.battle_id;

  const parsedTime = new Date(event.TimeStamp || options.now || Date.now());
  if (Number.isNaN(parsedTime.getTime())) return null;
  const eventAt = parsedTime.toISOString();
  const identity = eventIdentity(event, options.guildName);
  let valuation = { total: 0, priced: 0, items: 0 };
  try {
    valuation = await estimateVictimBuild(event, options);
  } catch (error) {
    (options.logger || console).error(`Falha ao estimar build do evento Albion #${event.EventId}:`, error.message);
  }

  const save = db.transaction(() => {
    let battle = selectBattle(db, eventAt, identity, options);
    if (!battle) {
      const result = db.prepare(`
        INSERT INTO albion_battles (started_at, last_event_at) VALUES (?, ?)
      `).run(eventAt, eventAt);
      battle = { id: Number(result.lastInsertRowid) };
    }
    db.prepare(`
      INSERT INTO albion_battle_events (
        event_id, battle_id, event_type, event_at, victim_name, victim_guild,
        victim_build_value, priced_items, total_items, notag_members_json,
        player_keys_json, enemy_guilds_json, enemy_alliances_json, raw_event_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.EventId,
      battle.id,
      eventType,
      eventAt,
      event.Victim.Name || 'Desconhecido',
      event.Victim.GuildName || null,
      valuation.total,
      valuation.priced,
      valuation.items,
      JSON.stringify(identity.notagMembers),
      JSON.stringify(identity.playerKeys),
      JSON.stringify(identity.enemyGuilds),
      JSON.stringify(identity.enemyAlliances),
      JSON.stringify(event)
    );
    db.prepare(`
      UPDATE albion_battles SET
        started_at = CASE WHEN started_at > ? THEN ? ELSE started_at END,
        last_event_at = CASE WHEN last_event_at < ? THEN ? ELSE last_event_at END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(eventAt, eventAt, eventAt, eventAt, battle.id);
    return battle.id;
  });
  return save();
}

async function fetchEventDetails(eventId, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const apiBase = String(options.apiBase || '').replace(/\/$/, '');
  if (!apiBase) throw new Error('API Albion não informada para recuperar o evento.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.eventTimeoutMs || 20000);
  try {
    const response = await fetchImpl(`${apiBase}/events/${eventId}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Notag-Discord-Killfeed/1.0' }
    });
    if (!response.ok) throw new Error(`API Albion respondeu ${response.status}.`);
    const event = await response.json();
    if (!event?.EventId) throw new Error('API Albion retornou um evento inválido.');
    return event;
  } finally {
    clearTimeout(timeout);
  }
}

async function backfillBattleEvents(db, options = {}) {
  const now = new Date(options.now || Date.now());
  const limit = options.backfillLimit ?? BACKFILL_BATCH_SIZE;
  const historyCutoff = new Date(now.getTime() - (options.historyMs ?? DEFAULT_HISTORY_MS)).toISOString();
  const rows = db.prepare(`
    SELECT feed.event_id, feed.event_type
    FROM albion_killfeed_events feed
    LEFT JOIN albion_battle_events battle_event ON battle_event.event_id = feed.event_id
    LEFT JOIN albion_battle_backfill backfill ON backfill.event_id = feed.event_id
    WHERE battle_event.event_id IS NULL
      AND COALESCE(feed.event_at, feed.posted_at) >= ?
      AND (backfill.retry_after IS NULL OR backfill.retry_after <= ?)
    ORDER BY COALESCE(feed.event_at, feed.posted_at), feed.event_id
    LIMIT ?
  `).all(historyCutoff, now.toISOString(), limit);
  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const event = await fetchEventDetails(row.event_id, options);
      await recordBattleEvent(db, event, row.event_type, options);
      db.prepare('DELETE FROM albion_battle_backfill WHERE event_id = ?').run(row.event_id);
      processed += 1;
    } catch (error) {
      const retryAfter = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      db.prepare(`
        INSERT INTO albion_battle_backfill (event_id, attempts, last_error, retry_after)
        VALUES (?, 1, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET
          attempts = attempts + 1,
          last_error = excluded.last_error,
          retry_after = excluded.retry_after,
          updated_at = CURRENT_TIMESTAMP
      `).run(row.event_id, String(error.message || error).slice(0, 500), retryAfter);
      (options.logger || console).error(`Falha ao recuperar evento Albion #${row.event_id}:`, error.message);
      failed += 1;
    }
  }
  const pending = Number(db.prepare(`
    SELECT COUNT(*) AS total
    FROM albion_killfeed_events feed
    LEFT JOIN albion_battle_events battle_event ON battle_event.event_id = feed.event_id
    LEFT JOIN albion_battle_backfill backfill ON backfill.event_id = feed.event_id
    WHERE battle_event.event_id IS NULL
      AND COALESCE(feed.event_at, feed.posted_at) >= ?
      AND (backfill.retry_after IS NULL OR backfill.retry_after <= ?)
  `).get(historyCutoff, now.toISOString()).total || 0);
  return { processed, failed, pending };
}

function battleSummary(db, battleId) {
  const battle = db.prepare('SELECT * FROM albion_battles WHERE id = ?').get(battleId);
  if (!battle) return null;
  const events = db.prepare(`
    SELECT * FROM albion_battle_events WHERE battle_id = ? ORDER BY event_at, event_id
  `).all(battleId);
  const members = unique(events.flatMap((event) => parseJson(event.notag_members_json)));
  const kills = events.filter((event) => event.event_type === 'kill');
  const deaths = events.filter((event) => event.event_type === 'death');
  const enemyValue = kills.reduce((sum, event) => sum + Number(event.victim_build_value || 0), 0);
  const notagValue = deaths.reduce((sum, event) => sum + Number(event.victim_build_value || 0), 0);
  const pricedItems = events.reduce((sum, event) => sum + Number(event.priced_items || 0), 0);
  const totalItems = events.reduce((sum, event) => sum + Number(event.total_items || 0), 0);
  return {
    battle,
    events,
    members,
    kills,
    deaths,
    enemyValue,
    notagValue,
    balance: enemyValue - notagValue,
    efficiency: enemyValue + notagValue > 0 ? enemyValue / (enemyValue + notagValue) : 0,
    pricedItems,
    totalItems
  };
}

function compactSilver(value) {
  const amount = Number(value || 0);
  const sign = amount < 0 ? '-' : '';
  const absolute = Math.abs(amount);
  if (absolute >= 1_000_000) return `${sign}${(absolute / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} M`;
  if (absolute >= 1_000) return `${sign}${(absolute / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `${sign}${Math.round(absolute).toLocaleString('pt-BR')}`;
}

function discordTime(value, style = 'f') {
  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:${style}>`;
}

function rankingLines(events, limit = 5) {
  const ranked = [...events].sort((a, b) => Number(b.victim_build_value) - Number(a.victim_build_value)).slice(0, limit);
  if (!ranked.length) return 'Nenhuma.';
  return ranked.map((event, index) =>
    `${index + 1}. **${event.victim_name}**${event.victim_guild ? ` [${event.victim_guild}]` : ''} — ${compactSilver(event.victim_build_value)}`
  ).join('\n');
}

function battleReportEmbed(summary) {
  const { battle, events, members, kills, deaths } = summary;
  return new EmbedBuilder()
    .setColor(summary.balance >= 0 ? 0x2ecc71 : 0xd83c3e)
    .setTitle('⚔️ Relatório de grande batalha')
    .setDescription([
      `**Início:** ${discordTime(battle.started_at)}  •  **Fim:** ${discordTime(battle.last_event_at, 't')}`,
      `**NoTag envolvidos:** ${members.length}  •  **Mortes no total:** ${events.length}`
    ].join('\n'))
    .addFields(
      { name: 'Inimigos eliminados', value: `${kills.length} • **${compactSilver(summary.enemyValue)} prata**`, inline: true },
      { name: 'Mortes da NoTag', value: `${deaths.length} • **${compactSilver(summary.notagValue)} prata**`, inline: true },
      { name: 'Saldo estimado', value: `**${summary.balance >= 0 ? '+' : ''}${compactSilver(summary.balance)} prata**`, inline: true },
      { name: 'Eficiência por valor', value: `${(summary.efficiency * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`, inline: true },
      { name: 'Cobertura de preços', value: `${summary.pricedItems}/${summary.totalItems} itens equipados`, inline: true },
      { name: 'Critério', value: `${members.length} membros • ${events.length} mortes`, inline: true },
      { name: 'Maiores eliminações', value: rankingLines(kills), inline: false },
      { name: 'Maiores perdas da NoTag', value: rankingLines(deaths), inline: false },
      { name: 'Membros NoTag identificados', value: members.map((name) => `\`${name}\``).join(', ').slice(0, 1024) || 'Não identificados', inline: false }
    )
    .setFooter({ text: `Batalha #${battle.id} • valores estimados das builds equipadas` })
    .setTimestamp(new Date(battle.last_event_at));
}

function battleReportUrl(battleId) {
  return `${env.dashboardBaseUrl}/batalhas/${Number(battleId)}`;
}

function battleReportComponents(battleId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Ver relatório completo')
      .setURL(battleReportUrl(battleId))
  )];
}

async function finalizeStaleBattles(client, options = {}) {
  const db = options.db;
  if (!db) throw new Error('Banco de dados não informado para os relatórios de batalha.');
  const now = new Date(options.now || Date.now());
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const cutoff = new Date(now.getTime() - idleMs).toISOString();
  const stale = db.prepare(`
    SELECT id FROM albion_battles
    WHERE status = 'active' AND last_event_at <= ?
    ORDER BY last_event_at
  `).all(cutoff);
  const result = { reported: 0, discarded: 0 };

  for (const row of stale) {
    const summary = battleSummary(db, row.id);
    const qualifies = summary.members.length >= (options.minMembers ?? MIN_NOTAG_MEMBERS)
      && summary.events.length >= (options.minDeaths ?? MIN_DEATHS);
    if (!qualifies) {
      db.prepare(`
        UPDATE albion_battles SET status = 'discarded', closed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(now.toISOString(), row.id);
      result.discarded += 1;
      continue;
    }

    const channelId = options.channelId || ids.channels.battleReports;
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) throw new Error(`Canal de relatórios de batalha indisponível: ${channelId}`);
    const message = await channel.send({
      embeds: [battleReportEmbed(summary)],
      components: battleReportComponents(row.id)
    });
    db.prepare(`
      UPDATE albion_battles SET status = 'reported', closed_at = ?, report_channel_id = ?,
        report_message_id = ?, details_button_synced_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'active'
    `).run(now.toISOString(), channelId, message.id, now.toISOString(), row.id);
    result.reported += 1;
  }
  return result;
}

async function syncReportedBattleButtons(client, options = {}) {
  const db = options.db;
  if (!db) throw new Error('Banco de dados não informado para sincronizar botões de batalha.');
  const rows = db.prepare(`
    SELECT id, report_channel_id, report_message_id
    FROM albion_battles
    WHERE status = 'reported'
      AND report_channel_id IS NOT NULL
      AND report_message_id IS NOT NULL
      AND details_button_synced_at IS NULL
    ORDER BY id DESC
    LIMIT ?
  `).all(options.limit ?? 10);
  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const channel = await client.channels.fetch(row.report_channel_id);
      if (!channel?.isTextBased() || !channel.messages?.fetch) throw new Error('Canal ou mensagem indisponível.');
      const message = await channel.messages.fetch(row.report_message_id);
      await message.edit({ components: battleReportComponents(row.id) });
      db.prepare(`
        UPDATE albion_battles SET details_button_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(row.id);
      synced += 1;
    } catch (error) {
      (options.logger || console).error(`Falha ao adicionar botão ao relatório da batalha #${row.id}:`, error.message);
      failed += 1;
    }
  }
  return { synced, failed, pending: Math.max(0, rows.length - synced - failed) };
}

module.exports = {
  BACKFILL_BATCH_SIZE,
  DEFAULT_HISTORY_MS,
  DEFAULT_IDLE_MS,
  MIN_DEATHS,
  MIN_NOTAG_MEMBERS,
  battleReportEmbed,
  battleReportComponents,
  battleReportUrl,
  battleSummary,
  backfillBattleEvents,
  eventIdentity,
  fetchEventDetails,
  finalizeStaleBattles,
  recordBattleEvent,
  selectBattle,
  syncReportedBattleButtons
};
