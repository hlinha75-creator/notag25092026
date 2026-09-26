const { randomInt } = require('node:crypto');
const { getDatabase, transaction } = require('../../database/connection');

const ACTIVE_STATUSES = ['pending_payer', 'pending_staff', 'scheduled', 'open'];

function createGiveaway(data) {
  const result = getDatabase().prepare(`
    INSERT INTO giveaways (
      guild_id, creator_id, payer_id, title, description, prize_name, estimated_value,
      starts_at, ends_at, winner_count, notes, requires_staff_approval, status
    ) VALUES (
      @guildId, @creatorId, @payerId, @title, @description, @prizeName, @estimatedValue,
      @startsAt, @endsAt, @winnerCount, @notes, @requiresStaffApproval, 'pending_payer'
    )
  `).run(data);
  return getGiveaway(result.lastInsertRowid);
}

function getGiveaway(id) {
  return getDatabase().prepare('SELECT * FROM giveaways WHERE id = ?').get(id);
}

function countActiveByCreator(creatorId) {
  return getDatabase().prepare(`
    SELECT COUNT(*) AS total FROM giveaways
    WHERE creator_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
  `).get(creatorId, ...ACTIVE_STATUSES).total;
}

function latestByCreator(creatorId) {
  return getDatabase().prepare('SELECT * FROM giveaways WHERE creator_id = ? ORDER BY id DESC LIMIT 1').get(creatorId);
}

function setPayerApproved(id, payerId) {
  const result = getDatabase().prepare(`
    UPDATE giveaways SET payer_approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND payer_id = ? AND status IN ('pending_payer', 'pending_staff')
  `).run(id, payerId);
  return { changed: result.changes > 0, giveaway: getGiveaway(id) };
}

function setStaffApproved(id, staffId) {
  const result = getDatabase().prepare(`
    UPDATE giveaways
    SET staff_approved_at = CURRENT_TIMESTAMP, staff_approved_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND requires_staff_approval = 1 AND status IN ('pending_payer', 'pending_staff')
  `).run(staffId, id);
  return { changed: result.changes > 0, giveaway: getGiveaway(id) };
}

function setReadyStatus(id, status) {
  getDatabase().prepare(`
    UPDATE giveaways SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND payer_approved_at IS NOT NULL
      AND (requires_staff_approval = 0 OR staff_approved_at IS NOT NULL)
      AND status IN ('pending_payer', 'pending_staff', 'scheduled', 'open')
  `).run(status, id);
  return getGiveaway(id);
}

function setPendingStatus(id) {
  const giveaway = getGiveaway(id);
  const status = giveaway?.payer_approved_at ? 'pending_staff' : 'pending_payer';
  getDatabase().prepare('UPDATE giveaways SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
  return getGiveaway(id);
}

function attachMessage(id, channelId, messageId) {
  getDatabase().prepare(`UPDATE giveaways SET channel_id = ?, message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(channelId, messageId, id);
  return getGiveaway(id);
}

function participantCount(id) {
  return getDatabase().prepare('SELECT COUNT(*) AS total FROM giveaway_participants WHERE giveaway_id = ?').get(id).total;
}

const toggleParticipant = transaction((giveawayId, userId, nowIso) => {
  const db = getDatabase();
  const giveaway = getGiveaway(giveawayId);
  if (!giveaway || giveaway.status !== 'open') throw new Error('Este sorteio nao esta aberto.');
  if (new Date(nowIso) < new Date(giveaway.starts_at) || new Date(nowIso) >= new Date(giveaway.ends_at)) {
    throw new Error('As inscricoes deste sorteio estao fechadas.');
  }
  const current = db.prepare('SELECT 1 FROM giveaway_participants WHERE giveaway_id = ? AND user_id = ?').get(giveawayId, userId);
  if (current) {
    db.prepare('DELETE FROM giveaway_participants WHERE giveaway_id = ? AND user_id = ?').run(giveawayId, userId);
    return { joined: false, total: participantCount(giveawayId) };
  }
  db.prepare('INSERT INTO giveaway_participants (giveaway_id, user_id) VALUES (?, ?)').run(giveawayId, userId);
  return { joined: true, total: participantCount(giveawayId) };
});

function dueGiveaways(nowIso) {
  return getDatabase().prepare(`
    SELECT * FROM giveaways
    WHERE (status = 'scheduled' AND starts_at <= ?)
       OR (status IN ('scheduled', 'open') AND ends_at <= ?)
    ORDER BY ends_at, id
  `).all(nowIso, nowIso);
}

function updateGiveaway(id, changes) {
  const allowed = new Set([
    'title', 'description', 'prize_name', 'estimated_value', 'payer_id', 'starts_at', 'ends_at',
    'winner_count', 'notes', 'requires_staff_approval', 'payer_approved_at', 'staff_approved_at',
    'staff_approved_by', 'status'
  ]);
  const entries = Object.entries(changes).filter(([key]) => allowed.has(key));
  if (!entries.length) return getGiveaway(id);
  const params = { id };
  const assignments = entries.map(([key, value], index) => {
    const param = `value${index}`;
    params[param] = value;
    return `${key} = @${param}`;
  });
  getDatabase().prepare(`UPDATE giveaways SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run(params);
  return getGiveaway(id);
}

function cancelGiveaway(id, actorId, reason) {
  const result = getDatabase().prepare(`
    UPDATE giveaways SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status NOT IN ('ended', 'cancelled')
  `).run(reason || null, actorId, id);
  return { changed: result.changes > 0, giveaway: getGiveaway(id) };
}

const drawWinners = transaction((id, force = false) => {
  const db = getDatabase();
  const giveaway = getGiveaway(id);
  if (!giveaway) throw new Error('Sorteio nao encontrado.');
  if (!['open', 'scheduled'].includes(giveaway.status)) {
    if (giveaway.status === 'ended') return { giveaway, winners: listActiveWinners(id), alreadyEnded: true };
    throw new Error('Este sorteio nao pode ser encerrado agora.');
  }
  if (!force && new Date() < new Date(giveaway.ends_at)) throw new Error('O sorteio ainda nao chegou ao fim.');

  const participants = db.prepare(`
    SELECT user_id FROM giveaway_participants
    WHERE giveaway_id = ?
      AND user_id NOT IN (SELECT user_id FROM giveaway_winners WHERE giveaway_id = ?)
  `).all(id, id).map((row) => row.user_id);
  const amount = Math.min(Number(giveaway.winner_count), participants.length);
  for (let index = 0; index < amount; index += 1) {
    const selectedIndex = randomInt(participants.length);
    const [userId] = participants.splice(selectedIndex, 1);
    db.prepare('INSERT INTO giveaway_winners (giveaway_id, user_id) VALUES (?, ?)').run(id, userId);
  }
  db.prepare(`UPDATE giveaways SET status = 'ended', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  return { giveaway: getGiveaway(id), winners: listActiveWinners(id), alreadyEnded: false };
});

const rerollWinner = transaction((id, invalidUserId, actorId, reason) => {
  const db = getDatabase();
  const giveaway = getGiveaway(id);
  if (!giveaway || giveaway.status !== 'ended') throw new Error('O sorteio precisa estar encerrado para refazer um ganhador.');
  const winner = db.prepare(`
    SELECT * FROM giveaway_winners WHERE giveaway_id = ? AND user_id = ? AND status = 'selected'
    ORDER BY id DESC LIMIT 1
  `).get(id, invalidUserId);
  if (!winner) throw new Error('Esse membro nao e um ganhador valido deste sorteio.');
  db.prepare(`
    UPDATE giveaway_winners SET status = 'invalid', invalidated_by = ?, invalidated_at = CURRENT_TIMESTAMP, invalid_reason = ?
    WHERE id = ?
  `).run(actorId, reason || 'Ganhador invalidado', winner.id);
  const candidates = db.prepare(`
    SELECT user_id FROM giveaway_participants
    WHERE giveaway_id = ?
      AND user_id NOT IN (SELECT user_id FROM giveaway_winners WHERE giveaway_id = ?)
  `).all(id, id).map((row) => row.user_id);
  let replacement = null;
  if (candidates.length) {
    replacement = candidates[randomInt(candidates.length)];
    db.prepare('INSERT INTO giveaway_winners (giveaway_id, user_id) VALUES (?, ?)').run(id, replacement);
  }
  return { giveaway: getGiveaway(id), invalidUserId, replacement, winners: listActiveWinners(id) };
});

function listActiveWinners(id) {
  return getDatabase().prepare(`SELECT * FROM giveaway_winners WHERE giveaway_id = ? AND status = 'selected' ORDER BY id`).all(id);
}

module.exports = {
  attachMessage, cancelGiveaway, countActiveByCreator, createGiveaway, drawWinners, dueGiveaways,
  getGiveaway, latestByCreator, listActiveWinners, participantCount, rerollWinner, setPayerApproved,
  setPendingStatus, setReadyStatus, setStaffApproved, toggleParticipant, updateGiveaway
};
