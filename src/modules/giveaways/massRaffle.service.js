const crypto = require('node:crypto');
const { getDatabase, transaction } = require('../../database/connection');
const env = require('../../config/env');
const ids = require('../../config/ids');
const accountLinks = require('../accounts/accountLinks.service');

const RAFFLE_KEY = 'loot-82-2026-08-22';
const TITLE = 'Sorteio em Massa — 82 Prêmios';
const SCHEDULED_AT = '2026-08-22T22:00:00.000Z';
const TOTAL_PRIZES = 82;
const MINIMUM_SECONDS = 60 * 60;
const QUALIFICATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FREEZE_AT = '2026-08-22T21:00:00.000Z';
const NOTIFICATIONS = [
  { key: '12h', offsetMs: 12 * 60 * 60 * 1000, label: 'Faltam 12 horas' },
  { key: '6h', offsetMs: 6 * 60 * 60 * 1000, label: 'Faltam 6 horas' },
  { key: '3h', offsetMs: 3 * 60 * 60 * 1000, label: 'Faltam 3 horas' },
  { key: '1h', offsetMs: 60 * 60 * 1000, label: 'Falta 1 hora' },
  { key: '15m', offsetMs: 15 * 60 * 1000, label: 'Faltam 15 minutos' },
  { key: 'live', offsetMs: 0, label: 'Estamos ao vivo' }
];

function ensureRaffle() {
  getDatabase().prepare(`
    INSERT OR IGNORE INTO mass_raffles (raffle_key, title, scheduled_at)
    VALUES (?, ?, ?)
  `).run(RAFFLE_KEY, TITLE, SCHEDULED_AT);
}

function qualificationRows(now = new Date()) {
  const cutoff = new Date(now.getTime() - QUALIFICATION_WINDOW_MS).toISOString();
  return getDatabase().prepare(`
    SELECT
      COALESCE(links.primary_discord_id, ep.discord_id) AS discordId,
      COALESCE(
        MAX(NULLIF(trim(primary_user.albion_name), '')),
        MAX(NULLIF(trim(linked_user.albion_name), '')),
        MAX(NULLIF(trim(linked_user.discord_name), '')),
        COALESCE(links.primary_discord_id, ep.discord_id)
      ) AS name,
      CAST(SUM(COALESCE(ep.manual_seconds, ep.calculated_seconds, 0)) AS INTEGER) AS seconds,
      COUNT(DISTINCT ep.event_id) AS events
    FROM event_participants ep
    JOIN events e ON e.id = ep.event_id
    LEFT JOIN linked_discord_accounts links ON links.linked_discord_id = ep.discord_id
    LEFT JOIN users primary_user ON primary_user.discord_id = COALESCE(links.primary_discord_id, ep.discord_id)
    LEFT JOIN users linked_user ON linked_user.discord_id = ep.discord_id
    WHERE e.ended_at IS NOT NULL
      AND e.status <> 'cancelled'
      AND datetime(e.ended_at) >= datetime(?)
      AND ep.is_spectator = 0
    GROUP BY COALESCE(links.primary_discord_id, ep.discord_id)
    ORDER BY seconds DESC, events DESC, name COLLATE NOCASE
  `).all(cutoff).map((row) => ({
    discordId: String(row.discordId),
    name: String(row.name),
    seconds: Number(row.seconds || 0),
    events: Number(row.events || 0)
  }));
}

function storedParticipants() {
  return getDatabase().prepare(`
    SELECT discord_id AS discordId, display_name AS name, seconds, event_count AS events
    FROM mass_raffle_participants
    WHERE raffle_key = ?
    ORDER BY seconds DESC, event_count DESC, display_name COLLATE NOCASE
  `).all(RAFFLE_KEY);
}

const refreshParticipants = transaction(({ now = new Date(), freeze = false } = {}) => {
  ensureRaffle();
  const db = getDatabase();
  const raffle = db.prepare('SELECT participants_frozen_at FROM mass_raffles WHERE raffle_key = ?').get(RAFFLE_KEY);
  if (raffle.participants_frozen_at) return { frozen: true, participants: storedParticipants() };
  const participants = qualificationRows(now).filter((row) => row.seconds >= MINIMUM_SECONDS);
  db.prepare('DELETE FROM mass_raffle_participants WHERE raffle_key = ?').run(RAFFLE_KEY);
  const insert = db.prepare(`
    INSERT INTO mass_raffle_participants
      (raffle_key, discord_id, display_name, seconds, event_count, qualified_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const row of participants) {
    insert.run(RAFFLE_KEY, row.discordId, row.name, row.seconds, row.events, now.toISOString());
  }
  db.prepare(`
    UPDATE mass_raffles
    SET participants_refreshed_at = ?, participants_frozen_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE raffle_key = ?
  `).run(now.toISOString(), freeze ? now.toISOString() : null, RAFFLE_KEY);
  return { frozen: freeze, participants: storedParticipants() };
});

function maybeRefreshParticipants(now = new Date()) {
  ensureRaffle();
  const raffle = getDatabase().prepare(`
    SELECT participants_refreshed_at, participants_frozen_at
    FROM mass_raffles WHERE raffle_key = ?
  `).get(RAFFLE_KEY);
  if (raffle.participants_frozen_at) return { frozen: true, participants: storedParticipants() };
  const freeze = now.getTime() >= Date.parse(FREEZE_AT);
  const stale = !raffle.participants_refreshed_at || now.getTime() - Date.parse(raffle.participants_refreshed_at) >= 5 * 60 * 1000;
  if (freeze || stale) return refreshParticipants({ now, freeze });
  return { frozen: false, participants: storedParticipants() };
}

function activeParticipantNames() {
  return storedParticipants().map((row) => row.name);
}

function getParticipantVerification(discordId, now = new Date()) {
  ensureRaffle();
  const db = getDatabase();
  const raffle = db.prepare('SELECT participants_frozen_at FROM mass_raffles WHERE raffle_key = ?').get(RAFFLE_KEY);
  const primaryId = accountLinks.resolvePrimaryUserId(discordId);
  let row;
  if (raffle.participants_frozen_at) {
    row = db.prepare(`
      SELECT display_name AS name, seconds, event_count AS events
      FROM mass_raffle_participants WHERE raffle_key = ? AND discord_id = ?
    `).get(RAFFLE_KEY, primaryId);
  } else {
    row = qualificationRows(now).find((item) => item.discordId === primaryId);
  }
  const seconds = Number(row?.seconds || 0);
  return {
    name: row?.name || null,
    qualified: seconds >= MINIMUM_SECONDS,
    seconds,
    events: Number(row?.events || 0),
    remainingSeconds: Math.max(0, MINIMUM_SECONDS - seconds),
    frozen: Boolean(raffle.participants_frozen_at),
    freezeAt: FREEZE_AT
  };
}

function prizeFromId(prizeId) {
  const match = String(prizeId || '').match(/^i([123])s(\d{1,2})$/);
  if (!match) return null;
  const image = Number(match[1]);
  const slot = Number(match[2]);
  const limits = { 1: 26, 2: 27, 3: 29 };
  if (slot < 1 || slot > limits[image]) return null;
  return { id: `i${image}s${slot}`, image, slot };
}

function getOfficialState() {
  ensureRaffle();
  const db = getDatabase();
  const raffle = db.prepare('SELECT * FROM mass_raffles WHERE raffle_key = ?').get(RAFFLE_KEY);
  const results = db.prepare(`
    SELECT prize_id AS prizeId, image_number AS image, slot_number AS slot,
           winner_name AS winner, drawn_by AS drawnBy, drawn_at AS drawnAt
    FROM mass_raffle_results
    WHERE raffle_key = ?
    ORDER BY id
  `).all(RAFFLE_KEY);
  const stored = storedParticipants();
  const participants = stored;
  return {
    key: raffle.raffle_key,
    title: raffle.title,
    scheduledAt: raffle.scheduled_at,
    status: raffle.status,
    startedAt: raffle.started_at,
    completedAt: raffle.completed_at,
    totalPrizes: TOTAL_PRIZES,
    participantCount: participants.length,
    participants,
    participantsRefreshedAt: raffle.participants_refreshed_at,
    participantsFrozenAt: raffle.participants_frozen_at,
    qualification: { minimumSeconds: MINIMUM_SECONDS, windowDays: 7, freezeAt: FREEZE_AT },
    results
  };
}

function actionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

const startOfficial = transaction(({ actorId, now = new Date() }) => {
  ensureRaffle();
  const db = getDatabase();
  const raffle = db.prepare('SELECT * FROM mass_raffles WHERE raffle_key = ?').get(RAFFLE_KEY);
  if (raffle.status !== 'scheduled') throw actionError('O sorteio oficial já foi iniciado.');
  const earliest = Date.parse(SCHEDULED_AT) - 15 * 60 * 1000;
  if (now.getTime() < earliest) throw actionError('O modo oficial poderá ser iniciado 15 minutos antes do horário marcado.');
  const frozen = refreshParticipants({ now, freeze: true });
  if (!frozen.participants.length) throw actionError('Nenhum participante atingiu o tempo mínimo; o sorteio não pode ser iniciado.');
  db.prepare(`
    UPDATE mass_raffles
    SET status = 'live', started_by = ?, started_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE raffle_key = ?
  `).run(actorId, now.toISOString(), RAFFLE_KEY);
  return getOfficialState();
});

const drawOfficial = transaction(({ actorId, prizeId, now = new Date(), randomInt = crypto.randomInt }) => {
  ensureRaffle();
  const db = getDatabase();
  const raffle = db.prepare('SELECT * FROM mass_raffles WHERE raffle_key = ?').get(RAFFLE_KEY);
  if (raffle.status !== 'live') throw actionError('O sorteio oficial ainda não está ao vivo.');
  const prize = prizeFromId(prizeId);
  if (!prize) throw actionError('Prêmio inválido.');
  if (db.prepare('SELECT 1 FROM mass_raffle_results WHERE raffle_key = ? AND prize_id = ?').get(RAFFLE_KEY, prize.id)) {
    throw actionError('Este prêmio já foi sorteado.');
  }
  const participants = activeParticipantNames();
  if (!participants.length) throw actionError('A lista oficial de participantes está vazia.');
  const winner = participants[randomInt(participants.length)];
  db.prepare(`
    INSERT INTO mass_raffle_results
      (raffle_key, prize_id, image_number, slot_number, winner_name, drawn_by, drawn_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(RAFFLE_KEY, prize.id, prize.image, prize.slot, winner, actorId, now.toISOString());
  const total = Number(db.prepare('SELECT COUNT(*) AS total FROM mass_raffle_results WHERE raffle_key = ?').get(RAFFLE_KEY).total);
  if (total >= TOTAL_PRIZES) {
    db.prepare(`UPDATE mass_raffles SET status = 'completed', completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE raffle_key = ?`)
      .run(now.toISOString(), RAFFLE_KEY);
  }
  return { winner, prize, state: getOfficialState() };
});

function notificationPayload(item, state = getOfficialState()) {
  const url = `${env.dashboardBaseUrl}/sorteio`;
  const live = item.key === 'live';
  const announcement = item.key === 'announcement';
  const oneHour = item.key === '1h';
  const rule = '**Participam somente membros que acumularam pelo menos 1 hora de conteúdo em grupo, em eventos finalizados, nos últimos 7 dias.**';
  const schedule = 'O sorteio dos **82 prêmios** será realizado em **22/08 às 22h UTC (19h de Brasília)**, ao vivo pelo site.';
  return {
    content: `<@&${ids.roles.member}>`,
    embeds: [{
      color: live ? 0x75bc7c : 0xe8b950,
      title: live ? '🔴 Sorteio em massa ao vivo!' : announcement ? '🎁 Sorteio em massa confirmado!' : `🎁 ${item.label} para o sorteio em massa!`,
      description: live
        ? `O sorteio oficial dos **82 prêmios** começou com **${state.participantCount} participantes**. Acompanhe os resultados ao vivo em ${url}`
        : [schedule, rule, oneHour ? `🔒 **Lista oficial encerrada com ${state.participantCount} participantes.**` : null, `Confira sua participação em ${url}`].filter(Boolean).join('\n\n'),
      timestamp: SCHEDULED_AT
    }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 5, label: 'Verificar se estou na lista', url: `${url}/verificar` }]
    }],
    allowedMentions: { parse: [], roles: [ids.roles.member] }
  };
}

async function sendNotification(client, key, item) {
  const db = getDatabase();
  if (db.prepare('SELECT 1 FROM mass_raffle_notifications WHERE raffle_key = ? AND notification_key = ?').get(RAFFLE_KEY, key)) return false;
  const channel = await client.channels.fetch(ids.channels.campaignAnnouncements).catch(() => null);
  if (!channel?.isTextBased()) throw new Error('Canal de avisos do sorteio não encontrado.');
  const message = await channel.send(notificationPayload(item));
  db.prepare(`
    INSERT OR IGNORE INTO mass_raffle_notifications
      (raffle_key, notification_key, channel_id, message_id)
    VALUES (?, ?, ?, ?)
  `).run(RAFFLE_KEY, key, channel.id, message.id);
  return true;
}

async function syncAnnouncementMessage(client) {
  const db = getDatabase();
  const marker = db.prepare(`
    SELECT 1 FROM mass_raffle_notifications
    WHERE raffle_key = ? AND notification_key = 'announcement-qualified-rule'
  `).get(RAFFLE_KEY);
  if (marker) return false;
  const announcement = db.prepare(`
    SELECT channel_id, message_id FROM mass_raffle_notifications
    WHERE raffle_key = ? AND notification_key = 'announcement'
  `).get(RAFFLE_KEY);
  if (!announcement?.channel_id || !announcement?.message_id || announcement.message_id === 'skipped') return false;
  const channel = await client.channels.fetch(announcement.channel_id).catch(() => null);
  const message = channel?.messages ? await channel.messages.fetch(announcement.message_id).catch(() => null) : null;
  if (!message) return false;
  await message.edit(notificationPayload({ key: 'announcement', label: 'Sorteio em massa confirmado' }));
  db.prepare(`
    INSERT OR IGNORE INTO mass_raffle_notifications
      (raffle_key, notification_key, channel_id, message_id)
    VALUES (?, 'announcement-qualified-rule', ?, ?)
  `).run(RAFFLE_KEY, announcement.channel_id, announcement.message_id);
  return true;
}

async function processNotifications(client, now = new Date()) {
  ensureRaffle();
  maybeRefreshParticipants(now);
  const db = getDatabase();
  const target = Date.parse(SCHEDULED_AT);
  const sent = [];
  const initialExists = db.prepare('SELECT 1 FROM mass_raffle_notifications WHERE raffle_key = ? AND notification_key = ?').get(RAFFLE_KEY, 'announcement');
  if (!initialExists && now.getTime() < target) {
    if (await sendNotification(client, 'announcement', { key: 'announcement', label: 'Sorteio em massa confirmado' })) sent.push('announcement');
  }
  await syncAnnouncementMessage(client);
  for (const item of NOTIFICATIONS) {
    const due = target - item.offsetMs;
    if (now.getTime() < due) continue;
    const exists = db.prepare('SELECT 1 FROM mass_raffle_notifications WHERE raffle_key = ? AND notification_key = ?').get(RAFFLE_KEY, item.key);
    if (exists) continue;
    const tolerance = item.key === 'live' ? 60 * 60 * 1000 : 10 * 60 * 1000;
    if (now.getTime() > due + tolerance) {
      db.prepare(`INSERT OR IGNORE INTO mass_raffle_notifications (raffle_key, notification_key, message_id) VALUES (?, ?, 'skipped')`)
        .run(RAFFLE_KEY, item.key);
      continue;
    }
    if (await sendNotification(client, item.key, item)) sent.push(item.key);
  }
  return sent;
}

module.exports = {
  FREEZE_AT,
  MINIMUM_SECONDS,
  NOTIFICATIONS,
  RAFFLE_KEY,
  SCHEDULED_AT,
  drawOfficial,
  ensureRaffle,
  getOfficialState,
  getParticipantVerification,
  maybeRefreshParticipants,
  notificationPayload,
  prizeFromId,
  processNotifications,
  qualificationRows,
  refreshParticipants,
  startOfficial
};
