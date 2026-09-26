const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const { formatSilver } = require('../../utils/silver');
const { safeSend } = require('../../utils/discord');
const albionFame = require('../albion/fame.service');
const accountLinks = require('../accounts/accountLinks.service');
const financeRepo = require('../finance/finance.repository');

const careerKeys = [
  ['classe_tank', 'Tank'],
  ['classe_healer', 'Healer'],
  ['classe_support', 'Suporte'],
  ['classe_dps', 'DPS'],
  ['classe_caller', 'Caller']
];

async function memberProfilePayload(userId, guild = null) {
  const link = accountLinks.linkInfo(userId);
  const users = usersForIds(link.linkedIds);
  const user = bestUser(users, link.primaryId);
  const member = guild ? await bestGuildMember(guild, link.linkedIds, link.primaryId) : null;
  const displayName = link.label || member?.displayName || user?.discord_name || link.primaryId || userId;
  const guildMember = Boolean((await anyGuildMemberHasRole(guild, link.linkedIds, ids.roles.member)) || user?.registration_status === 'member');
  const finance = financeStats(link);
  const eventStats = eventParticipationStats(link.linkedIds);
  const voice = voiceStats(link.linkedIds);
  const career = careerStats(link.linkedIds);
  const fame = albionFame.getFameByAlbionName(user?.albion_name);
  const latestFame = albionFame.latestImport();

  const embed = new EmbedBuilder()
    .setTitle('Meu Perfil NOTAG')
    .setDescription(profileDescription(link))
    .addFields(
      {
        name: 'Cadastro',
        value: [
          `Discord: ${displayName}`,
          `Albion: ${user?.albion_name || 'nao cadastrado'}`,
          `Status: ${registrationLabel(user?.registration_status)}`,
          `Guild member: ${guildMember ? 'sim' : 'nao'}`
        ].join('\n'),
        inline: false
      },
      {
        name: 'Carreira PvE',
        value: [
          careerLine(career, 'classe_tank', 'Tank'),
          careerLine(career, 'classe_healer', 'Healer'),
          careerLine(career, 'classe_support', 'Suporte'),
          careerLine(career, 'classe_dps', 'DPS'),
          careerLine(career, 'classe_caller', 'Caller')
        ].join('\n'),
        inline: true
      },
      {
        name: 'Financeiro',
        value: [
          `Total acumulado: ${formatSilver(finance.earned)}`,
          `Sacado: ${formatSilver(finance.withdrawn)}`,
          `Saldo: ${formatSilver(finance.balance)}`
        ].join('\n'),
        inline: true
      },
      {
        name: 'Presenca',
        value: [
          `Call voz: ${durationText(voice.seconds)}${voice.rank ? ` | Top #${voice.rank}` : ''}`,
          `Raid: ${durationText(eventStats.raid)}`,
          `DG: ${durationText(eventStats.dg)}`,
          `Roaming: ${durationText(eventStats.roaming)}`,
          `HCE: ${durationText(eventStats.hce)}`,
          `Cacada: ${durationText(eventStats.hunt)}`
        ].join('\n'),
        inline: false
      },
      {
        name: 'Albion manual',
        value: fame
          ? [
            fameLine('PvE', fame.pve_fame, albionFame.rankFor('pve_fame', fame.pve_fame)),
            fameLine('PvP', fame.pvp_fame, albionFame.rankFor('pvp_fame', fame.pvp_fame)),
            fameLine('Coleta', fame.gathering_fame, albionFame.rankFor('gathering_fame', fame.gathering_fame)),
            fameLine('Craft', fame.crafting_fame, albionFame.rankFor('crafting_fame', fame.crafting_fame)),
            `Atualizado: ${shortDate(fame.updated_at)}`
          ].join('\n')
          : [
            'Sem fama manual importada ainda.',
            latestFame ? `Ultima importacao geral: ${shortDate(latestFame.created_at)}` : 'Nenhuma importacao geral registrada.',
            'Use o botao abaixo para pedir atualizacao.'
          ].join('\n'),
        inline: false
      }
    )
    .setColor(0x4f46e5)
    .setTimestamp(new Date());

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('profile:request_fame_update').setLabel('Solicitar ADM atualize').setStyle(ButtonStyle.Secondary)
      )
    ],
    allowedMentions: { users: link.linkedIds }
  };
}

async function rankHtmlPayload(guild = null) {
  const rows = await rankRows(guild);
  return {
    content: 'Rank geral HTML gerado. Abra o arquivo e use Baixar CSV se precisar de planilha.',
    files: [albionFame.rankRowsAttachment(rows)]
  };
}

async function requestFameUpdate(interaction) {
  const link = accountLinks.linkInfo(interaction.user.id);
  const user = bestUser(usersForIds(link.linkedIds), link.primaryId);
  await safeSend(interaction.client, ids.channels.pveCareer, {
    content: [
      `Pedido de atualizacao de fama Albion: <@${link.primaryId}>`,
      `Discord: ${interaction.member?.displayName || interaction.user.username}`,
      `Albion: ${user?.albion_name || 'nao cadastrado'}`,
      link.isLinked ? `Contas vinculadas: ${link.linkedIds.map((id) => `<@${id}>`).join(' ')}` : null,
      'Atualize quando enviar/importar a planilha de fama total.'
    ].filter(Boolean).join('\n'),
    allowedMentions: { users: link.linkedIds }
  });
}

async function rankRows(guild = null) {
  const db = getDatabase();
  const users = db.prepare('SELECT * FROM users ORDER BY COALESCE(albion_name, discord_name, discord_id) COLLATE NOCASE').all();
  const userGroups = new Map();
  for (const user of users) {
    const primaryId = accountLinks.resolvePrimaryUserId(user.discord_id);
    if (!userGroups.has(primaryId)) userGroups.set(primaryId, []);
    userGroups.get(primaryId).push(user);
  }

  const fameOnly = albionFame.listFameTotals()
    .filter((row) => !row.discord_id)
    .map((row) => ({
      discord_id: '',
      discord_name: '',
      albion_name: row.albion_name,
      registration_status: '',
      fame: row
    }));

  const rows = [];
  for (const [primaryId, groupUsers] of userGroups.entries()) {
    const linkedIds = accountLinks.linkedUserIds(primaryId);
    const user = bestUser(groupUsers, primaryId);
    const finance = financeStats({ primaryId, linkedIds });
    const voice = voiceStats(linkedIds);
    const events = eventParticipationStats(linkedIds);
    const career = careerStats(linkedIds);
    const fame = albionFame.getFameByAlbionName(user.albion_name);
    const member = await bestGuildMember(guild, linkedIds, primaryId);
    const guildMember = Boolean((await anyGuildMemberHasRole(guild, linkedIds, ids.roles.member)) || user.registration_status === 'member');
    rows.push({
      discord_id: primaryId,
      discord_name: user.discord_name || member?.displayName || '',
      albion_name: user.albion_name || '',
      registration_status: user.registration_status || '',
      guild_member: guildMember ? 'sim' : 'nao',
      balance: finance.balance,
      earned: finance.earned,
      withdrawn: finance.withdrawn,
      voice_seconds: voice.seconds,
      voice_time: durationText(voice.seconds),
      event_seconds: events.total,
      event_time: durationText(events.total),
      tank_points: career.pointsByKey.classe_tank || 0,
      healer_points: career.pointsByKey.classe_healer || 0,
      support_points: career.pointsByKey.classe_support || 0,
      dps_points: career.pointsByKey.classe_dps || 0,
      caller_points: career.pointsByKey.classe_caller || 0,
      total_fame: fame?.total_fame || 0,
      pve_fame: fame?.pve_fame || 0,
      pvp_fame: fame?.pvp_fame || 0,
      gathering_fame: fame?.gathering_fame || 0,
      crafting_fame: fame?.crafting_fame || 0
    });
  }

  for (const item of fameOnly) {
    rows.push({
      discord_id: '',
      discord_name: '',
      albion_name: item.albion_name,
      registration_status: 'sem vinculo discord',
      guild_member: 'desconhecido',
      balance: 0,
      earned: 0,
      withdrawn: 0,
      voice_seconds: 0,
      voice_time: '0m',
      event_seconds: 0,
      event_time: '0m',
      tank_points: 0,
      healer_points: 0,
      support_points: 0,
      dps_points: 0,
      caller_points: 0,
      total_fame: item.fame.total_fame || 0,
      pve_fame: item.fame.pve_fame || 0,
      pvp_fame: item.fame.pvp_fame || 0,
      gathering_fame: item.fame.gathering_fame || 0,
      crafting_fame: item.fame.crafting_fame || 0
    });
  }

  return rows.sort((a, b) => Number(b.event_seconds || 0) - Number(a.event_seconds || 0) || String(a.albion_name || a.discord_name).localeCompare(String(b.albion_name || b.discord_name), 'pt-BR'));
}

function financeStats(link) {
  const db = getDatabase();
  const idsToCheck = accountLinks.unique([link.primaryId, ...(link.linkedIds || [])]);
  if (!idsToCheck.length) return { balance: 0, earned: 0, withdrawn: 0 };
  const ph = accountLinks.placeholders(idsToCheck);
  const balance = financeRepo.getBalance(link.primaryId);
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS earned,
      COALESCE(SUM(CASE WHEN amount < 0 AND type = 'withdraw_paid' THEN ABS(amount) ELSE 0 END), 0) AS withdrawn
    FROM balance_transactions
    WHERE user_id IN (${ph})
  `).get(...idsToCheck);
  return {
    balance,
    earned: Number(row?.earned || 0),
    withdrawn: Number(row?.withdrawn || 0)
  };
}

function voiceStats(userIds) {
  const db = getDatabase();
  const idsToCheck = accountLinks.unique(userIds);
  if (!idsToCheck.length) return { seconds: 0, rank: null };
  const ph = accountLinks.placeholders(idsToCheck);
  const seconds = Number(db.prepare(`
    SELECT COALESCE(SUM(seconds), 0) AS seconds
    FROM voice_sessions
    WHERE discord_id IN (${ph})
  `).get(...idsToCheck)?.seconds || 0);
  const rank = seconds > 0 ? voiceRank(seconds) : null;
  return { seconds, rank };
}

function eventParticipationStats(userIds) {
  const idsToCheck = accountLinks.unique(userIds);
  if (!idsToCheck.length) return { raid: 0, dg: 0, roaming: 0, hce: 0, hunt: 0, total: 0 };
  const ph = accountLinks.placeholders(idsToCheck);
  const rows = getDatabase().prepare(`
    SELECT
      e.title,
      e.description,
      COALESCE(ep.manual_seconds, ep.calculated_seconds, 0) AS seconds
    FROM event_participants ep
    JOIN events e ON e.id = ep.event_id
    WHERE ep.discord_id IN (${ph})
      AND COALESCE(ep.is_spectator, 0) = 0
  `).all(...idsToCheck);

  const totals = { raid: 0, dg: 0, roaming: 0, hce: 0, hunt: 0, total: 0 };
  for (const row of rows) {
    const seconds = Number(row.seconds || 0);
    totals.total += seconds;
    totals[classifyEvent(row)] += seconds;
  }
  return totals;
}

function classifyEvent(row) {
  const text = normalizeText(`${row.title || ''} ${row.description || ''}`);
  if (text.includes('hce')) return 'hce';
  if (text.includes('cacada') || text.includes('caca') || text.includes('hunt')) return 'hunt';
  if (text.includes('roaming') || text.includes('roam')) return 'roaming';
  if (text.includes('raid') || text.includes('avalon') || text.includes('ava')) return 'raid';
  if (text.includes('dg') || text.includes('dungeon') || text.includes('grupo')) return 'dg';
  return 'dg';
}

function careerStats(userIds) {
  const idsToCheck = accountLinks.unique(userIds);
  if (!idsToCheck.length) {
    return {
      pointsByKey: Object.fromEntries(careerKeys.map(([key]) => [key, 0])),
      rankByKey: Object.fromEntries(careerKeys.map(([key]) => [key, null]))
    };
  }
  const ph = accountLinks.placeholders(idsToCheck);
  const rows = getDatabase().prepare(`
    SELECT weapon_key, points
    FROM raid_avalon_weapon_career
    WHERE discord_id IN (${ph})
      AND weapon_key LIKE 'classe_%'
  `).all(...idsToCheck);
  const pointsByKey = Object.fromEntries(careerKeys.map(([key]) => [key, 0]));
  const rankByKey = {};
  for (const row of rows) {
    pointsByKey[row.weapon_key] = (pointsByKey[row.weapon_key] || 0) + Number(row.points || 0);
  }
  for (const [key] of careerKeys) {
    const points = pointsByKey[key] || 0;
    rankByKey[key] = points > 0 ? careerRank(key, points) : null;
  }
  return { pointsByKey, rankByKey };
}

function careerRank(key, points) {
  const totals = new Map();
  const rows = getDatabase().prepare(`
    SELECT discord_id, points
    FROM raid_avalon_weapon_career
    WHERE weapon_key = ?
  `).all(key);
  for (const row of rows) {
    const primaryId = accountLinks.resolvePrimaryUserId(row.discord_id);
    totals.set(primaryId, (totals.get(primaryId) || 0) + Number(row.points || 0));
  }
  return [...totals.values()].filter((total) => total > points).length + 1;
}

function careerLine(career, key, label) {
  const points = career.pointsByKey[key] || 0;
  const rank = career.rankByKey[key];
  return `${label}: ${points}${rank ? ` | Top #${rank}` : ''}`;
}

function fameLine(label, value, rank) {
  return `${label}: ${albionFame.formatFame(value)}${rank ? ` | Top #${rank}` : ''}`;
}

function registrationLabel(status) {
  const labels = {
    member: 'cadastrado',
    guest: 'cadastrado como convidado',
    pending: 'cadastro pendente',
    unregistered: 'nao cadastrado'
  };
  return labels[status] || 'nao cadastrado';
}

function durationText(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}

function shortDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function usersForIds(userIds) {
  const idsToCheck = accountLinks.unique(userIds);
  if (!idsToCheck.length) return [];
  return getDatabase()
    .prepare(`SELECT * FROM users WHERE discord_id IN (${accountLinks.placeholders(idsToCheck)})`)
    .all(...idsToCheck);
}

function bestUser(users, primaryId) {
  return users.find((user) => user.discord_id === primaryId && user.albion_name)
    || users.find((user) => user.albion_name)
    || users.find((user) => user.discord_id === primaryId)
    || users[0]
    || { discord_id: primaryId, discord_name: primaryId, albion_name: null, registration_status: 'unregistered' };
}

async function bestGuildMember(guild, userIds, primaryId) {
  if (!guild) return null;
  const primary = await guild.members.fetch(primaryId).catch(() => null);
  if (primary) return primary;
  for (const userId of accountLinks.unique(userIds).filter((id) => id !== primaryId)) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) return member;
  }
  return null;
}

async function anyGuildMemberHasRole(guild, userIds, roleId) {
  if (!guild || !roleId) return false;
  for (const userId of accountLinks.unique(userIds)) {
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (member?.roles?.cache?.has(roleId)) return true;
  }
  return false;
}

function profileDescription(link) {
  const lines = [`Conta principal: <@${link.primaryId}>`];
  const linked = link.linkedIds.filter((id) => id !== link.primaryId);
  if (linked.length) lines.push(`Conta vinculada: ${linked.map((id) => `<@${id}>`).join(' ')}`);
  return lines.join('\n');
}

function voiceRank(seconds) {
  const rows = getDatabase()
    .prepare(`
      SELECT discord_id, COALESCE(SUM(seconds), 0) AS seconds
      FROM voice_sessions
      GROUP BY discord_id
    `)
    .all();
  const totals = new Map();
  for (const row of rows) {
    const primaryId = accountLinks.resolvePrimaryUserId(row.discord_id);
    totals.set(primaryId, (totals.get(primaryId) || 0) + Number(row.seconds || 0));
  }
  return [...totals.values()].filter((total) => total > seconds).length + 1;
}

module.exports = {
  memberProfilePayload,
  rankHtmlPayload,
  requestFameUpdate
};
