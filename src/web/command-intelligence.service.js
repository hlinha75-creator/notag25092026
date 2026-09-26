const { getDatabase } = require('../database/connection');
const ids = require('../config/ids');

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function ageDays(value) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? Math.max(0, Math.floor((Date.now() - time) / DAY_MS)) : null;
}

function eventCategory(row) {
  const text = normalizeName(`${row.title || ''} ${row.description || ''} ${row.location || ''}`);
  if (row.is_world_boss || /world\s*boss|boss\s*world/.test(text)) return 'worldBoss';
  if (/transport|transporte|caravana/.test(text)) return 'transport';
  if (/avalon|raid/.test(text)) return 'raid';
  if (/roam|roaming|gank/.test(text)) return 'roaming';
  if (/farm|fama|fame/.test(text)) return 'farm';
  return 'other';
}

function roleCategory(value) {
  const role = normalizeName(value);
  if (/tank|caller/.test(role)) return 'tank';
  if (/heal|curador/.test(role)) return 'healer';
  if (/support|suporte/.test(role)) return 'support';
  if (/scout|batedor/.test(role)) return 'scout';
  return 'dps';
}

function contributionScore(member) {
  return Math.round(Math.min(100,
    member.events.total * 3
    + member.events.created * 5
    + member.events.transport * 2
    + member.events.worldBoss * 2
    + Object.values(member.roles).filter(Boolean).length * 2
    + Math.min(20, member.weekly.voiceSeconds / 3600)
    + (member.weekly.active ? 10 : 0)
  ));
}

function baseMember(input = {}) {
  return {
    id: input.discord_id || null,
    albionName: input.albion_name || input.character_name || null,
    discordName: input.discord_name || null,
    registrationStatus: input.registration_status || 'unregistered',
    discordJoinedAt: null,
    discordDays: null,
    guildJoinedAt: input.guild_joined_at || null,
    guildDays: ageDays(input.guild_joined_at),
    guildRoles: input.roles || [],
    hierarchy: 'Sem tag',
    linkedAccounts: [],
    fame: { total: 0, pve: 0, pvp: 0, gathering: 0, crafting: 0 },
    events: { total: 0, transport: 0, raid: 0, worldBoss: 0, roaming: 0, farm: 0, other: 0, created: 0, totalSeconds: 0 },
    roles: { tank: 0, healer: 0, support: 0, dps: 0, scout: 0 },
    finance: { balance: 0, received: 0, withdrawn: 0, movement: 0 },
    weekly: { active: false, voiceSeconds: 0, events: 0, lastActivityAt: null },
    onlineInGame: Boolean(input.is_online),
    lastSeenInGame: input.last_seen_iso || input.last_seen || null
  };
}

function hierarchyFor(member) {
  const roles = member?.roles?.cache;
  if (!roles) return 'Sem tag';
  const order = [
    [ids.roles.adm, 'Fundador'], [ids.roles.staff, 'Staff'], [ids.roles.treasurer, 'Financeiro'],
    [ids.roles.caller, 'Caller'], [ids.roles.recruiter, 'Recrutador'], [ids.roles.member, 'Membro'],
    [ids.roles.guest, 'Convidado']
  ];
  return order.find(([roleId]) => roleId && roles.has(roleId))?.[1] || 'Sem tag';
}

function collectionValues(collection) {
  if (!collection) return [];
  if (typeof collection.values === 'function') return [...collection.values()];
  return Array.isArray(collection) ? collection : [];
}

async function getDiscordMembers(client) {
  let guild = client?.guilds?.cache?.get(ids.guildId) || null;
  if (!guild && typeof client?.guilds?.fetch === 'function') guild = await client.guilds.fetch(ids.guildId).catch(() => null);
  if (!guild) return [];
  const fetched = typeof guild.members?.fetch === 'function' ? await guild.members.fetch().catch(() => null) : null;
  return collectionValues(fetched || guild.members?.cache).map((member) => ({
    id: String(member.id),
    name: member.displayName || member.user?.globalName || member.user?.username || member.id,
    joinedAt: member.joinedAt?.toISOString?.() || (member.joinedTimestamp ? new Date(member.joinedTimestamp).toISOString() : null),
    hierarchy: member.id === guild.ownerId ? 'Fundador' : hierarchyFor(member)
  }));
}

function loadRows(db) {
  const latestSnapshot = db.prepare('SELECT id, created_at FROM member_snapshots ORDER BY id DESC LIMIT 1').get();
  const roster = latestSnapshot ? db.prepare(`
    SELECT current.*, first_seen.guild_joined_at
    FROM member_snapshot_rows current
    LEFT JOIN (
      SELECT rows.member_key, MIN(snapshots.created_at) AS guild_joined_at
      FROM member_snapshot_rows rows JOIN member_snapshots snapshots ON snapshots.id = rows.snapshot_id
      GROUP BY rows.member_key
    ) first_seen ON first_seen.member_key = current.member_key
    WHERE current.snapshot_id = ?
  `).all(latestSnapshot.id).map((row) => ({ ...row, roles: JSON.parse(row.roles_json || '[]') })) : [];

  return {
    latestSnapshot,
    roster,
    users: db.prepare(`SELECT u.* FROM users u WHERE NOT EXISTS (
      SELECT 1 FROM linked_discord_accounts links
      WHERE links.linked_discord_id = u.discord_id AND links.primary_discord_id <> u.discord_id
    )`).all(),
    links: db.prepare(`SELECT links.primary_discord_id, links.linked_discord_id, links.label,
      linked.discord_name, linked.albion_name FROM linked_discord_accounts links
      LEFT JOIN users linked ON linked.discord_id = links.linked_discord_id
      ORDER BY links.primary_discord_id, links.created_at`).all(),
    fame: db.prepare('SELECT * FROM albion_fame_totals').all(),
    participations: db.prepare(`SELECT ep.*, e.title, e.description, e.location,
      links.primary_discord_id,
      EXISTS(SELECT 1 FROM world_boss_events wb WHERE wb.event_id = e.id) AS is_world_boss
      FROM event_participants ep JOIN events e ON e.id = ep.event_id
      LEFT JOIN linked_discord_accounts links ON links.linked_discord_id = ep.discord_id
      WHERE e.status <> 'cancelled' AND COALESCE(ep.is_spectator, 0) = 0 AND COALESCE(ep.is_paused, 0) = 0`).all(),
    createdEvents: db.prepare(`SELECT e.id, e.creator_id, links.primary_discord_id FROM events e
      LEFT JOIN linked_discord_accounts links ON links.linked_discord_id = e.creator_id WHERE e.status <> 'cancelled'`).all(),
    balances: db.prepare(`SELECT COALESCE(links.primary_discord_id, balances.discord_id) AS primary_discord_id,
      SUM(balances.balance) AS balance FROM balances LEFT JOIN linked_discord_accounts links
      ON links.linked_discord_id = balances.discord_id GROUP BY COALESCE(links.primary_discord_id, balances.discord_id)`).all(),
    transactions: db.prepare(`SELECT COALESCE(links.primary_discord_id, tx.user_id) AS primary_discord_id,
      SUM(CASE WHEN tx.amount > 0 THEN tx.amount ELSE 0 END) AS received, SUM(ABS(tx.amount)) AS movement
      FROM balance_transactions tx LEFT JOIN linked_discord_accounts links ON links.linked_discord_id = tx.user_id
      GROUP BY COALESCE(links.primary_discord_id, tx.user_id)`).all(),
    withdrawals: db.prepare(`SELECT COALESCE(links.primary_discord_id, requests.user_id) AS primary_discord_id,
      SUM(requests.amount) AS withdrawn FROM withdraw_requests requests LEFT JOIN linked_discord_accounts links
      ON links.linked_discord_id = requests.user_id WHERE requests.status = 'paid'
      GROUP BY COALESCE(links.primary_discord_id, requests.user_id)`).all(),
    voice: db.prepare(`SELECT COALESCE(links.primary_discord_id, sessions.discord_id) AS primary_discord_id,
      SUM(CASE WHEN datetime(sessions.joined_at) >= datetime('now', '-7 days') THEN sessions.seconds ELSE 0 END) AS weekly_seconds,
      MAX(COALESCE(sessions.left_at, sessions.joined_at)) AS last_activity_at
      FROM voice_sessions sessions LEFT JOIN linked_discord_accounts links ON links.linked_discord_id = sessions.discord_id
      GROUP BY COALESCE(links.primary_discord_id, sessions.discord_id)`).all()
  };
}

async function getCommandIntelligenceData(client) {
  const rows = loadRows(getDatabase());
  const members = new Map();
  const byAlbion = new Map();
  for (const row of rows.roster) {
    const member = baseMember(row);
    members.set(`albion:${row.member_key}`, member);
    byAlbion.set(row.member_key, member);
  }
  for (const user of rows.users) {
    const albionKey = normalizeName(user.albion_name);
    const member = byAlbion.get(albionKey) || baseMember(user);
    Object.assign(member, { id: user.discord_id, discordName: user.discord_name || member.discordName,
      albionName: user.albion_name || member.albionName, registrationStatus: user.registration_status });
    members.delete(`albion:${albionKey}`);
    members.set(user.discord_id, member);
    if (albionKey) byAlbion.set(albionKey, member);
  }
  const byId = new Map([...members.values()].filter((member) => member.id).map((member) => [String(member.id), member]));
  const find = (row, key = 'primary_discord_id') => byId.get(String(row[key] || ''));

  for (const row of rows.links) find(row)?.linkedAccounts.push({ id: row.linked_discord_id, label: row.label, discordName: row.discord_name, albionName: row.albion_name });
  for (const row of rows.fame) {
    const member = byAlbion.get(normalizeName(row.albion_name));
    if (member) member.fame = { total: row.total_fame, pve: row.pve_fame, pvp: row.pvp_fame, gathering: row.gathering_fame, crafting: row.crafting_fame };
  }
  for (const row of rows.participations) {
    const member = find(row) || byId.get(String(row.discord_id));
    if (!member) continue;
    member._eventIds ||= new Set();
    if (!member._eventIds.has(row.event_id)) {
      member._eventIds.add(row.event_id);
      member.events.total += 1;
      member.events[eventCategory(row)] += 1;
      if (Date.parse(row.joined_at) >= Date.now() - 7 * DAY_MS) member.weekly.events += 1;
    }
    member.events.totalSeconds += Number(row.manual_seconds ?? row.calculated_seconds ?? 0);
    member.roles[roleCategory(row.role)] += 1;
    if (!member.weekly.lastActivityAt || String(row.joined_at) > member.weekly.lastActivityAt) member.weekly.lastActivityAt = row.joined_at;
  }
  for (const row of rows.createdEvents) {
    const member = find(row) || byId.get(String(row.creator_id));
    if (member) member.events.created += 1;
  }
  for (const row of rows.balances) { const member = find(row); if (member) member.finance.balance = Number(row.balance || 0); }
  for (const row of rows.transactions) { const member = find(row); if (member) Object.assign(member.finance, { received: Number(row.received || 0), movement: Number(row.movement || 0) }); }
  for (const row of rows.withdrawals) { const member = find(row); if (member) member.finance.withdrawn = Number(row.withdrawn || 0); }
  for (const row of rows.voice) {
    const member = find(row); if (!member) continue;
    member.weekly.voiceSeconds = Number(row.weekly_seconds || 0);
    if (!member.weekly.lastActivityAt || String(row.last_activity_at) > member.weekly.lastActivityAt) member.weekly.lastActivityAt = row.last_activity_at;
  }
  for (const discord of await getDiscordMembers(client)) {
    const member = byId.get(discord.id); if (!member) continue;
    Object.assign(member, { discordName: discord.name || member.discordName, discordJoinedAt: discord.joinedAt,
      discordDays: ageDays(discord.joinedAt), hierarchy: discord.hierarchy });
  }

  const result = [...members.values()].map((member) => {
    member.weekly.active = member.weekly.voiceSeconds > 0 || member.weekly.events > 0 || Date.parse(member.weekly.lastActivityAt) >= Date.now() - 7 * DAY_MS;
    delete member._eventIds;
    return member;
  }).sort((a, b) => String(a.albionName || a.discordName || '').localeCompare(String(b.albionName || b.discordName || ''), 'pt-BR'));

  return {
    generatedAt: new Date().toISOString(), sourceUpdatedAt: rows.latestSnapshot?.created_at || null,
    definitions: { weeklyActivity: 'Voz ou participação em evento registrada nos últimos 7 dias.', eventCategories: 'Categorias inferidas pelo tipo e pelo texto do evento.' },
    summary: { members: result.length, activeWeekly: result.filter((m) => m.weekly.active).length,
      inactiveWeekly: result.filter((m) => !m.weekly.active).length, unlinked: result.filter((m) => !m.id).length,
      eventHours: Math.round(result.reduce((sum, m) => sum + m.events.totalSeconds, 0) / 3600) },
    members: result
  };
}

function rankingPosition(members, selected, value) {
  const ranked = members
    .filter((member) => member.id)
    .sort((left, right) => value(right) - value(left));
  const index = ranked.indexOf(selected);
  return { position: index >= 0 ? index + 1 : null, total: ranked.length };
}

async function getMemberIntelligenceData(client, discordId) {
  const intelligence = await getCommandIntelligenceData(client);
  const requestedId = String(discordId || '');
  const member = intelligence.members.find((candidate) => (
    String(candidate.id || '') === requestedId
    || candidate.linkedAccounts.some((account) => String(account.id || '') === requestedId)
  ));
  if (!member) return null;

  return {
    generatedAt: intelligence.generatedAt,
    sourceUpdatedAt: intelligence.sourceUpdatedAt,
    definitions: intelligence.definitions,
    member,
    positions: {
      contribution: rankingPosition(intelligence.members, member, contributionScore),
      events: rankingPosition(intelligence.members, member, (candidate) => candidate.events.total),
      eventHours: rankingPosition(intelligence.members, member, (candidate) => candidate.events.totalSeconds),
      fame: rankingPosition(intelligence.members, member, (candidate) => candidate.fame.total)
    }
  };
}

module.exports = {
  contributionScore,
  eventCategory,
  getCommandIntelligenceData,
  getMemberIntelligenceData,
  normalizeName,
  roleCategory
};
