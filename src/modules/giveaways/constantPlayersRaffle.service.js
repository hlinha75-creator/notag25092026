const crypto = require('node:crypto');
const { getDatabase, transaction } = require('../../database/connection');
const ids = require('../../config/ids');

const RAFFLE_KEY = 'sorteio240926';
const TOTAL_SLOTS = 35;
const PARTICIPANTS = [
  '!Tmaiusculo.', '.killme', '!Vtracer', '.davimix', '.MonetaryMike', 'Spotk', 'DarosBR', 'Akuma1000',
  '.MaxHardcore', 'Patolas', '!Nagacaburos', '!Sabedoria7', '.BSAlGunner', 'Lamusk', 'Amakv', '.mylola262',
  'minhafemea1', '!Cominhos', 'Shoofat', 'Magnun17', '.Vulto', '.Dsn', 'Rammstein', '.TKZX🔞', 'LuiziN',
  '.MatMac', '.Euhh', 'Jairrodrigo', 'guislave'
];
const PARTICIPANT_DISCORD_IDS = {
  guislave: '1527371637123580065'
};
const REMINDERS = [
  { key: '15m', offset: 15 * 60 * 1000, text: 'O sorteio começa em 15 minutos.' },
  { key: '10m', offset: 10 * 60 * 1000, text: 'Faltam 10 minutos para o sorteio.' },
  { key: '5m', offset: 5 * 60 * 1000, text: 'Faltam 5 minutos para o sorteio.' },
  { key: 'live', offset: 0, text: 'O sorteio começou! Os resultados estão sendo publicados.' }
];
const PAGE_URL = 'https://notag.discloud.app/sorteio240926';
let processing = false;
let lastResolveAt = 0;

function ensureRaffle(now = new Date()) {
  getDatabase().prepare(`
    INSERT OR IGNORE INTO constant_raffles (raffle_key, status)
    VALUES (?, 'waiting')
  `).run(RAFFLE_KEY);
  return getDatabase().prepare('SELECT * FROM constant_raffles WHERE raffle_key = ?').get(RAFFLE_KEY);
}

function normalizeName(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/^@/, '').replace(/[^\p{L}\p{N}]/gu, '');
}

async function resolveParticipants(client, now = new Date()) {
  const guild = client.guilds.cache.get(ids.guildId) || await client.guilds.fetch(ids.guildId);
  const members = guild.members.cache;
  const mapped = [];
  const unresolved = [];
  for (const name of PARTICIPANTS) {
    const key = normalizeName(name);
    let matches = [...members.values()].filter((member) => [member.user.username, member.user.globalName, member.displayName]
      .some((candidate) => normalizeName(candidate) === key));
    if (matches.length !== 1 || (PARTICIPANT_DISCORD_IDS[key] && !matches.some((member) => member.id === PARTICIPANT_DISCORD_IDS[key]))) {
      const found = await guild.members.search({ query: name.replace(/^[@.!]+/, ''), limit: 100, cache: false }).catch(() => null);
      if (found) {
        const byId = new Map(matches.map((member) => [member.id, member]));
        for (const member of found.values()) byId.set(member.id, member);
        matches = [...byId.values()].filter((member) => [member.user.username, member.user.globalName, member.displayName]
          .some((candidate) => normalizeName(candidate) === key));
      }
    }
    const preferredDiscordId = PARTICIPANT_DISCORD_IDS[key];
    if (preferredDiscordId) {
      const preferred = matches.find((member) => member.id === preferredDiscordId);
      if (preferred) {
        mapped.push({ discordId: preferred.id, name });
        continue;
      }
      unresolved.push({ name, reason: 'preferred_account_not_found' });
      continue;
    }
    if (matches.length !== 1) {
      unresolved.push({ name, reason: matches.length ? 'ambiguous' : 'not_found' });
      continue;
    }
    mapped.push({ discordId: matches[0].id, name });
  }
  const countsByDiscordId = new Map();
  for (const member of mapped) countsByDiscordId.set(member.discordId, (countsByDiscordId.get(member.discordId) || 0) + 1);
  for (const member of mapped) {
    if (countsByDiscordId.get(member.discordId) > 1) unresolved.push({ name: member.name, reason: 'duplicate_account' });
  }
  if (unresolved.length || mapped.length !== PARTICIPANTS.length) {
    getDatabase().prepare('UPDATE constant_raffles SET unresolved_json = ? WHERE raffle_key = ?')
      .run(JSON.stringify(unresolved), RAFFLE_KEY);
    return { scheduled: false, unresolved };
  }
  const db = getDatabase();
  const save = db.transaction(() => {
    const insert = db.prepare(`INSERT OR IGNORE INTO constant_raffle_participants (raffle_key, discord_id, display_name) VALUES (?, ?, ?)`);
    for (const member of mapped) insert.run(RAFFLE_KEY, member.discordId, member.name);
    const startAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    db.prepare(`UPDATE constant_raffles SET scheduled_at = ?, status = 'scheduled', unresolved_json = '[]' WHERE raffle_key = ? AND status = 'waiting'`)
      .run(startAt, RAFFLE_KEY);
  });
  save();
  return { scheduled: true, unresolved: [] };
}

function getState(viewerId = null) {
  const raffle = ensureRaffle();
  const db = getDatabase();
  const participants = raffle.status === 'waiting'
    ? PARTICIPANTS.map((name) => ({ name }))
    : db.prepare('SELECT discord_id AS discordId, display_name AS name FROM constant_raffle_participants WHERE raffle_key = ? ORDER BY rowid')
      .all(RAFFLE_KEY);
  const results = db.prepare(`
    SELECT slot_number AS slot, winner_discord_id AS winnerId, winner_name AS winner, confirmed_at AS confirmedAt
    FROM constant_raffle_results WHERE raffle_key = ? ORDER BY slot_number
  `).all(RAFFLE_KEY).map((result) => ({
    slot: Number(result.slot), winner: result.winner,
    confirmed: Boolean(result.confirmedAt), confirmedAt: result.confirmedAt,
    mine: Boolean(viewerId && result.winnerId === String(viewerId))
  }));
  let unresolved = [];
  try { unresolved = JSON.parse(raffle.unresolved_json || '[]'); } catch { /* keep the public status readable */ }
  return {
    key: RAFFLE_KEY,
    title: 'Jogadores Constantes',
    status: raffle.status,
    scheduledAt: raffle.scheduled_at,
    totalSlots: TOTAL_SLOTS,
    participantCount: participants.length,
    participants: participants.map(({ name }) => ({ name })),
    unresolved: unresolved.map(({ name }) => name),
    results
  };
}

const confirmPrize = transaction(({ discordId, slotNumber, now = new Date() }) => {
  const raffle = ensureRaffle(now);
  if (raffle.status !== 'completed') throw Object.assign(new Error('O sorteio ainda não foi concluído.'), { statusCode: 409 });
  const slot = Number(slotNumber);
  if (!Number.isInteger(slot) || slot < 1 || slot > TOTAL_SLOTS) throw Object.assign(new Error('Slot inválido.'), { statusCode: 400 });
  const db = getDatabase();
  const result = db.prepare(`SELECT winner_discord_id, confirmed_at FROM constant_raffle_results WHERE raffle_key = ? AND slot_number = ?`)
    .get(RAFFLE_KEY, slot);
  if (!result || result.winner_discord_id !== String(discordId)) {
    throw Object.assign(new Error('Este prêmio não está associado à sua conta do Discord.'), { statusCode: 403 });
  }
  db.prepare(`UPDATE constant_raffle_results SET confirmed_at = COALESCE(confirmed_at, ?) WHERE raffle_key = ? AND slot_number = ?`)
    .run(now.toISOString(), RAFFLE_KEY, slot);
  return getState(discordId);
});

const drawAll = transaction(({ now = new Date(), randomInt = crypto.randomInt } = {}) => {
  const raffle = ensureRaffle(now);
  if (raffle.status === 'completed') return false;
  if (raffle.status !== 'scheduled' || !raffle.scheduled_at || now.getTime() < Date.parse(raffle.scheduled_at)) return false;

  const db = getDatabase();
  const existingResults = db.prepare('SELECT 1 FROM constant_raffle_results WHERE raffle_key = ? LIMIT 1').get(RAFFLE_KEY);
  if (existingResults) {
    db.prepare(`UPDATE constant_raffles SET status = 'completed', completed_at = COALESCE(completed_at, ?) WHERE raffle_key = ?`)
      .run(now.toISOString(), RAFFLE_KEY);
    return false;
  }

  const participants = db.prepare('SELECT discord_id AS discordId, display_name AS name FROM constant_raffle_participants WHERE raffle_key = ?').all(RAFFLE_KEY);
  if (!participants.length) return false;

  const insert = db.prepare(`INSERT OR IGNORE INTO constant_raffle_results (raffle_key, slot_number, winner_discord_id, winner_name) VALUES (?, ?, ?, ?)`);
  for (let slot = 1; slot <= TOTAL_SLOTS; slot += 1) {
    const winner = participants[randomInt(participants.length)];
    insert.run(RAFFLE_KEY, slot, winner.discordId, winner.name);
  }
  db.prepare(`UPDATE constant_raffles SET status = 'completed', completed_at = ? WHERE raffle_key = ? AND status = 'scheduled'`)
    .run(now.toISOString(), RAFFLE_KEY);
  return true;
});

async function sendReminder(client, reminder) {
  const db = getDatabase();
  if (db.prepare('SELECT 1 FROM constant_raffle_notifications WHERE raffle_key = ? AND notification_key = ?').get(RAFFLE_KEY, reminder.key)) return false;
  const channel = await client.channels.fetch(ids.channels.notagChat).catch(() => null);
  if (!channel?.isTextBased()) throw new Error('O canal #notag-chat não está disponível.');
  await channel.send({
    content: `🎁 **Sorteio de Jogadores Constantes** — ${reminder.text}\nAssista e acompanhe: ${PAGE_URL}`,
    allowedMentions: { parse: [] }
  });
  db.prepare('INSERT OR IGNORE INTO constant_raffle_notifications (raffle_key, notification_key) VALUES (?, ?)').run(RAFFLE_KEY, reminder.key);
  return true;
}

async function notifyWinners(client, now = new Date()) {
  const db = getDatabase();
  const winners = db.prepare(`
    SELECT winner_discord_id AS discordId, winner_name AS name, GROUP_CONCAT(slot_number, ', ') AS slots
    FROM constant_raffle_results WHERE raffle_key = ?
    GROUP BY winner_discord_id, winner_name ORDER BY MIN(slot_number)
  `).all(RAFFLE_KEY);
  for (const winner of winners) {
    const prior = db.prepare('SELECT sent_at AS sentAt, last_attempt_at AS lastAttemptAt FROM constant_raffle_dm_notifications WHERE raffle_key = ? AND discord_id = ?')
      .get(RAFFLE_KEY, winner.discordId);
    if (prior?.sentAt || (prior?.lastAttemptAt && now.getTime() - Date.parse(prior.lastAttemptAt) < 5 * 60 * 1000)) continue;
    let sentAt = null;
    try {
      const user = await client.users.fetch(winner.discordId);
      await user.send(`🎉 Parabéns, **${winner.name}**! Você ganhou o(s) slot(s) **${winner.slots}** no sorteio de Jogadores Constantes.\nAcesse ${PAGE_URL} e entre com sua conta do Discord para confirmar. A confirmação ficará registrada no site; prêmios não confirmados permanecem pendentes para a staff.`);
      sentAt = now.toISOString();
    } catch (error) {
      console.error(`[SORTEIO CONSTANTES] Não foi possível enviar DM para ${winner.discordId}:`, error.message);
    }
    db.prepare(`
      INSERT INTO constant_raffle_dm_notifications (raffle_key, discord_id, sent_at, last_attempt_at, attempts)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT (raffle_key, discord_id) DO UPDATE SET
        sent_at = COALESCE(excluded.sent_at, constant_raffle_dm_notifications.sent_at),
        last_attempt_at = excluded.last_attempt_at,
        attempts = constant_raffle_dm_notifications.attempts + 1
    `).run(RAFFLE_KEY, winner.discordId, sentAt, now.toISOString());
  }
}

async function process(client, now = new Date()) {
  if (processing) return;
  processing = true;
  try {
    const raffle = ensureRaffle(now);
    if (raffle.status === 'completed') return;
    if (raffle.status === 'waiting' && now.getTime() - lastResolveAt >= 30_000) {
      lastResolveAt = now.getTime();
      await resolveParticipants(client, now);
    }
    const current = ensureRaffle(now);
    if (current.status === 'scheduled') {
      const scheduledAt = Date.parse(current.scheduled_at);
      for (const reminder of REMINDERS) {
        if (now.getTime() >= scheduledAt - reminder.offset) await sendReminder(client, reminder);
      }
      drawAll({ now });
    }
    const afterDraw = ensureRaffle(now);
    if (afterDraw.status === 'completed') await notifyWinners(client, now);
  } finally {
    processing = false;
  }
}

module.exports = { PARTICIPANTS, RAFFLE_KEY, TOTAL_SLOTS, confirmPrize, drawAll, getState, process };
