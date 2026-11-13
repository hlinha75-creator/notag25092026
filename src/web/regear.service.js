const { getDatabase } = require('../database/connection');
const accountLinks = require('../modules/accounts/accountLinks.service');
const ids = require('../config/ids');

const ROLE_LABELS = new Map([
  [ids.roles.adm, 'Administrador'],
  [ids.roles.staff, 'Staff'],
  [ids.roles.treasurer, 'Tesoureiro'],
  [ids.roles.caller, 'Caller'],
  [ids.roles.recruiter, 'Recrutador'],
  [ids.roles.member, 'Membro'],
  [ids.roles.guest, 'Convidado'],
  [ids.roles.core, 'Core'],
  [ids.roles.newcomer, 'Novato'],
  [ids.roles.noTag, 'NoTag']
].filter(([roleId]) => Boolean(roleId)));

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function parseEvent(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function equipmentItems(player) {
  const equipped = Object.entries(player?.Equipment || {}).map(([slot, item]) => ({ slot, item }));
  const inventory = (player?.Inventory || []).map((item, index) => ({ slot: `Inventory${index + 1}`, item }));
  return [...equipped, ...inventory]
    .filter(({ item }) => item?.Type)
    .map(({ slot, item }) => ({
      slot,
      type: item.Type,
      quality: Number(item.Quality || 1),
      count: Math.max(1, Number(item.Count || 1)),
      imageUrl: `https://render.albiononline.com/v1/item/${encodeURIComponent(item.Type)}.png?quality=${Number(item.Quality || 1)}`
    }));
}

function baseRows(db, albionNames = null) {
  const names = (albionNames || []).filter(Boolean).map((name) => String(name).trim().toLowerCase());
  const where = names.length
    ? `AND lower(trim(e.victim_name)) IN (${placeholders(names)})`
    : '';
  return db.prepare(`
    SELECT e.event_id, e.event_at, e.victim_name, e.victim_guild,
           e.victim_build_value, e.priced_items, e.total_items, e.raw_event_json,
           u.discord_id, u.discord_name,
           COALESCE(r.status, 'pending') AS regear_status,
           r.reviewed_by, r.approved_at, r.paid_at, r.updated_at AS regear_updated_at
    FROM albion_battle_events e
    LEFT JOIN users u ON lower(trim(u.albion_name)) = lower(trim(e.victim_name))
    LEFT JOIN albion_regear_requests r ON r.event_id = e.event_id
    WHERE e.event_type = 'death' ${where}
    ORDER BY e.event_at DESC, e.event_id DESC
  `).all(...names);
}

async function discordRolesByUser(client, discordIds) {
  const result = new Map();
  if (!client?.guilds || !discordIds.length) return result;
  const guild = client.guilds.cache?.get(ids.guildId) || await client.guilds.fetch(ids.guildId).catch(() => null);
  if (!guild) return result;
  for (const discordId of discordIds) {
    const member = guild.members.cache?.get(discordId) || await guild.members.fetch(discordId).catch(() => null);
    if (!member) continue;
    const roles = [...member.roles.cache.keys()]
      .filter((roleId) => roleId !== guild.id)
      .map((roleId) => ({ id: roleId, name: guild.roles?.cache?.get(roleId)?.name || ROLE_LABELS.get(roleId) || roleId }));
    result.set(discordId, roles);
  }
  return result;
}

function summarize(rows) {
  return {
    deaths: rows.length,
    totalLost: rows.reduce((sum, row) => sum + Number(row.lossValue || 0), 0),
    pricedDeaths: rows.filter((row) => row.lossValue > 0).length,
    pending: rows.filter((row) => row.regearStatus === 'pending').length,
    approved: rows.filter((row) => row.regearStatus === 'approved').length,
    paid: rows.filter((row) => row.regearStatus === 'paid').length,
    lastDeathAt: rows[0]?.occurredAt || null
  };
}

function setRegearStatus(db, { eventId, status, actorId }) {
  const normalizedEventId = Number(eventId);
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (!Number.isSafeInteger(normalizedEventId) || normalizedEventId <= 0) {
    throw Object.assign(new Error('Morte inválida.'), { statusCode: 400 });
  }
  if (!['pending', 'approved', 'paid'].includes(normalizedStatus)) {
    throw Object.assign(new Error('Status de regear inválido.'), { statusCode: 400 });
  }
  const death = db.prepare("SELECT event_id FROM albion_battle_events WHERE event_id = ? AND event_type = 'death'").get(normalizedEventId);
  if (!death) throw Object.assign(new Error('Morte não encontrada.'), { statusCode: 404 });

  db.prepare(`
    INSERT INTO albion_regear_requests
      (event_id, status, reviewed_by, approved_at, paid_at, updated_at)
    VALUES (
      ?, ?, ?,
      CASE WHEN ? IN ('approved', 'paid') THEN CURRENT_TIMESTAMP ELSE NULL END,
      CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE NULL END,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(event_id) DO UPDATE SET
      status = excluded.status,
      reviewed_by = excluded.reviewed_by,
      approved_at = CASE
        WHEN excluded.status = 'pending' THEN NULL
        WHEN albion_regear_requests.approved_at IS NOT NULL THEN albion_regear_requests.approved_at
        ELSE CURRENT_TIMESTAMP
      END,
      paid_at = CASE WHEN excluded.status = 'paid' THEN CURRENT_TIMESTAMP ELSE NULL END,
      updated_at = CURRENT_TIMESTAMP
  `).run(normalizedEventId, normalizedStatus, String(actorId), normalizedStatus, normalizedStatus);
  return db.prepare('SELECT * FROM albion_regear_requests WHERE event_id = ?').get(normalizedEventId);
}

async function getRegearData(client, discordId, { staff = false, canManage = false, db = getDatabase() } = {}) {
  let albionNames = null;
  if (!staff) {
    const link = accountLinks.linkInfo(discordId);
    const linkedIds = link.linkedIds.length ? link.linkedIds : [discordId];
    albionNames = db.prepare(`
      SELECT albion_name FROM users
      WHERE discord_id IN (${placeholders(linkedIds)}) AND albion_name IS NOT NULL
    `).all(...linkedIds).map((row) => row.albion_name);
  }

  const sourceRows = !staff && albionNames.length === 0 ? [] : baseRows(db, albionNames);
  const roleMap = staff
    ? await discordRolesByUser(client, [...new Set(sourceRows.map((row) => row.discord_id).filter(Boolean))])
    : new Map();
  const rows = sourceRows.map((row) => {
    const event = parseEvent(row.raw_event_json);
    const roles = roleMap.get(row.discord_id) || [];
    return {
      eventId: Number(row.event_id),
      occurredAt: row.event_at,
      victimName: row.victim_name,
      victimGuild: row.victim_guild || null,
      victimDiscordName: row.discord_name || null,
      victimDiscordId: row.discord_id || null,
      killerName: event?.Killer?.Name || 'Desconhecido',
      killerGuild: event?.Killer?.GuildName || null,
      victimIp: Math.round(Number(event?.Victim?.AverageItemPower || 0)),
      killerIp: Math.round(Number(event?.Killer?.AverageItemPower || 0)),
      participants: Number(event?.numberOfParticipants || event?.Participants?.length || 1),
      killFame: Number(event?.TotalVictimKillFame || 0),
      lossValue: Number(row.victim_build_value || 0),
      pricedItems: Number(row.priced_items || 0),
      totalItems: Number(row.total_items || 0),
      regearStatus: row.regear_status,
      regearReviewedBy: row.reviewed_by || null,
      regearApprovedAt: row.approved_at || null,
      regearPaidAt: row.paid_at || null,
      regearUpdatedAt: row.regear_updated_at || null,
      roles,
      equipment: equipmentItems(event?.Victim),
      detailUrl: `https://killboard-1.com/eu/event/${Number(row.event_id)}`
    };
  });

  const availableRoles = staff
    ? [...new Map(rows.flatMap((row) => row.roles).map((role) => [role.id, role])).values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    : [];
  return {
    generatedAt: new Date().toISOString(),
    mode: staff ? 'staff' : 'member',
    canManage: Boolean(staff && canManage),
    summary: summarize(rows),
    availableRoles,
    rows
  };
}

module.exports = { equipmentItems, getRegearData, setRegearStatus, summarize };
