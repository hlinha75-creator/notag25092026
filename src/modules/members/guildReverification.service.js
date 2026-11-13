const { AttachmentBuilder } = require('discord.js');
const ids = require('../../config/ids');
const { parseCsv, toCsv } = require('../../utils/csv');
const repo = require('./guildReverification.repository');

const DEFAULT_DEADLINE_DAYS = 7;
const MINIMUM_SECONDS = 30 * 60;

function defaultDeadline(now = new Date()) {
  return new Date(now.getTime() + (DEFAULT_DEADLINE_DAYS * 24 * 60 * 60 * 1000)).toISOString();
}

function deadlineText(value) {
  const timestamp = Math.floor(Date.parse(value) / 1000);
  return Number.isFinite(timestamp) ? `<t:${timestamp}:F> (<t:${timestamp}:R>)` : 'prazo inválido';
}

function normalizeName(value) {
  return String(value || '').replace(/^"|"$/g, '').trim().toLowerCase();
}

function parseRoster(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) throw new Error('O arquivo da guild esta vazio.');
  const delimiter = (raw.split(/\r?\n/, 1)[0] || '').includes('\t') ? '\t' : ',';
  const rows = delimiter === ',' ? parseCsv(raw) : parseTsv(raw);
  const names = rows.map((row) => {
    const entry = Object.entries(row).find(([key]) => ['character name', 'character_name', 'nome', 'name', 'jogador'].includes(normalizeName(key)));
    return String(entry?.[1] || '').replace(/^"|"$/g, '').trim();
  }).filter(Boolean);
  const unique = [...new Map(names.map((name) => [normalizeName(name), name])).entries()];
  if (!unique.length) throw new Error('Nao encontrei a coluna Character Name no arquivo.');
  return unique.map(([normalizedName, albionName]) => ({ normalizedName, albionName }));
}

function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headers = (lines.shift() || '').split('\t').map((value) => value.replace(/^"|"$/g, '').trim());
  return lines.map((line) => Object.fromEntries(headers.map((header, index) => [header, (line.split('\t')[index] || '').replace(/^"|"$/g, '').trim()])));
}

function linkRosterToUsers(roster) {
  const db = require('../../database/connection').getDatabase();
  const users = db.prepare("SELECT discord_id, albion_name FROM users WHERE albion_name IS NOT NULL AND trim(albion_name) <> ''").all();
  const byName = new Map(users.map((user) => [normalizeName(user.albion_name), user.discord_id]));
  return roster.map((entry) => ({ ...entry, discordId: byName.get(entry.normalizedName) || null }));
}

async function startCampaign({ guild, actorId, rosterText, announcementChannelId, verifiedRoleId, voiceChannelIds, deadlineAt, now = new Date() }) {
  const deadline = new Date(deadlineAt || defaultDeadline(now));
  if (!Number.isFinite(deadline.getTime()) || deadline <= now) throw new Error('O prazo precisa ser uma data futura valida em UTC.');
  const roster = linkRosterToUsers(parseRoster(rosterText));
  const campaign = repo.createCampaign({
    guildId: guild.id,
    announcementChannelId,
    verifiedRoleId,
    voiceChannelIds: [...new Set(voiceChannelIds)],
    startsAt: now.toISOString(),
    deadlineAt: deadline.toISOString(),
    createdBy: actorId,
    members: roster
  });
  return { campaign, roster, linked: roster.filter((row) => row.discordId).length };
}

function isStaffMember(member) {
  if (!member) return false;
  if (String(member.displayName || '').startsWith('.')) return true;
  return [ids.roles.staff, ids.roles.adm, ids.roles.recruiter].some((roleId) => member.roles?.cache?.has(roleId));
}

function calculateStaffOverlap(sessions, staffIds, startsAt, endsAt) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  const staff = new Set(staffIds.map(String));
  const staffByChannel = new Map();
  for (const session of sessions) {
    if (!staff.has(String(session.discord_id)) && !staff.has(String(session.primary_discord_id))) continue;
    const interval = clippedInterval(session, start, end);
    if (interval) pushMap(staffByChannel, session.channel_id, interval);
  }

  const playerIntervals = new Map();
  for (const session of sessions) {
    const playerId = String(session.primary_discord_id || session.discord_id);
    const own = clippedInterval(session, start, end);
    if (!own) continue;
    for (const staffInterval of staffByChannel.get(session.channel_id) || []) {
      const overlap = [Math.max(own[0], staffInterval[0]), Math.min(own[1], staffInterval[1])];
      if (overlap[1] > overlap[0]) pushMap(playerIntervals, playerId, overlap);
    }
  }

  return new Map([...playerIntervals].map(([playerId, intervals]) => [playerId, mergedSeconds(intervals)]));
}

function calculateVoiceTime(sessions, startsAt, endsAt) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  const playerIntervals = new Map();
  for (const session of sessions) {
    const interval = clippedInterval(session, start, end);
    if (interval) pushMap(playerIntervals, String(session.primary_discord_id || session.discord_id), interval);
  }
  return new Map([...playerIntervals].map(([playerId, intervals]) => [playerId, mergedSeconds(intervals)]));
}

function clippedInterval(session, start, end) {
  const joined = Math.max(Date.parse(session.joined_at), start);
  const left = Math.min(Date.parse(session.left_at), end);
  return Number.isFinite(joined) && Number.isFinite(left) && left > joined ? [joined, left] : null;
}

function pushMap(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function mergedSeconds(intervals) {
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current = null;
  for (const interval of sorted) {
    if (!current) current = interval.slice();
    else if (interval[0] <= current[1]) current[1] = Math.max(current[1], interval[1]);
    else {
      total += current[1] - current[0];
      current = interval.slice();
    }
  }
  if (current) total += current[1] - current[0];
  return Math.floor(total / 1000);
}

async function refreshQualifications(client, now = new Date()) {
  const campaign = repo.getActiveCampaign();
  if (!campaign) return { campaign: null, qualified: [] };
  repo.linkPendingUsers(campaign.id);
  const guild = await client.guilds.fetch(campaign.guild_id);
  const members = await guild.members.fetch();
  const staffIds = [...members.values()].filter(isStaffMember).map((member) => member.id);
  const endsAt = new Date(Math.min(now.getTime(), Date.parse(campaign.deadline_at))).toISOString();
  const channelIds = JSON.parse(campaign.voice_channel_ids_json);
  const sessions = repo.listVoiceSessions({ startsAt: campaign.starts_at, endsAt, channelIds });
  const overlaps = calculateStaffOverlap(sessions, staffIds, campaign.starts_at, endsAt);
  const voiceTime = calculateVoiceTime(sessions, campaign.starts_at, endsAt);
  const qualified = [];
  for (const item of repo.listMembers(campaign.id, 'pending')) {
    if (!item.discord_id) continue;
    const seconds = voiceTime.get(String(item.discord_id)) || 0;
    const staffOverlapSeconds = overlaps.get(String(item.discord_id)) || 0;
    if (seconds < MINIMUM_SECONDS || staffOverlapSeconds <= 0) continue;
    const member = members.get(item.discord_id);
    if (!member) continue;
    const roleAdded = await member.roles.add(campaign.verified_role_id, 'Dispensado: 30 minutos em call com staff')
      .then(() => true)
      .catch((error) => {
        console.error(`Falha ao conceder @verificado para ${item.discord_id}:`, error);
        return false;
      });
    if (!roleAdded) continue;
    repo.markVerified({ campaignId: campaign.id, normalizedName: item.normalized_name, status: 'voice_qualified', qualificationSeconds: seconds, verifiedBy: 'bot' });
    qualified.push({ ...item, seconds });
  }
  return { campaign, qualified };
}

async function confirmMember({ guild, discordId, actorId }) {
  const campaign = repo.getActiveCampaign();
  if (!campaign) throw new Error('Nao existe campanha de verificacao ativa.');
  repo.linkPendingUsers(campaign.id);
  const item = repo.findPendingByDiscordId(campaign.id, discordId);
  if (!item) throw new Error('Esse membro nao esta pendente ou nao foi vinculado ao cadastro Albion.');
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) throw new Error('Membro nao encontrado no Discord.');
  await member.roles.add(campaign.verified_role_id, `Confirmado em voz por ${actorId}`);
  repo.markVerified({ campaignId: campaign.id, normalizedName: item.normalized_name, status: 'verified', verifiedBy: actorId });
  return item;
}

function pendingPayload(campaign, heading) {
  const pending = repo.listMembers(campaign.id, 'pending');
  const linked = pending.filter((item) => item.discord_id);
  const unmatched = pending.filter((item) => !item.discord_id);
  const mentions = linked.map((item) => `<@${item.discord_id}>`);
  const lines = [
    heading,
    `**Pendentes: ${pending.length}**`,
    '',
    mentions.length ? mentions.join(' ') : 'Nenhum jogador vinculado pendente.',
    unmatched.length ? `\nSem vinculo Discord: ${unmatched.map((item) => item.albion_name).join(', ')}` : null
  ].filter(Boolean);
  return {
    content: lines.join('\n').slice(0, 1990),
    allowedMentions: { users: linked.map((item) => item.discord_id), parse: [] }
  };
}

function pendingPayloads(campaign, heading) {
  const pending = repo.listMembers(campaign.id, 'pending');
  const linked = pending.filter((item) => item.discord_id);
  const unmatched = pending.filter((item) => !item.discord_id);
  const payloads = [{
    content: `${heading}\n\n**Pendentes: ${pending.length}**`,
    allowedMentions: { parse: [] }
  }];

  for (let index = 0; index < linked.length; index += 40) {
    const chunk = linked.slice(index, index + 40);
    payloads.push({
      content: chunk.map((item) => `<@${item.discord_id}>`).join(' '),
      allowedMentions: { users: chunk.map((item) => item.discord_id), parse: [] }
    });
  }
  for (let index = 0; index < unmatched.length; index += 40) {
    const chunk = unmatched.slice(index, index + 40);
    payloads.push({
      content: `**Sem vinculo Discord:** ${chunk.map((item) => item.albion_name).join(', ')}`.slice(0, 1990),
      allowedMentions: { parse: [] }
    });
  }
  return payloads;
}

async function postPendingList(channel, campaign, heading, files = []) {
  const payloads = pendingPayloads(campaign, heading);
  if (files.length) payloads[0].files = files;
  const sent = [];
  for (const payload of payloads) sent.push(await channel.send(payload));
  return sent;
}

function campaignAttachment(campaign) {
  const rows = repo.listMembers(campaign.id).map((item) => ({
    jogador: item.albion_name,
    discord_id: item.discord_id || '',
    status: item.status,
    minutos_com_staff: Math.floor(item.qualification_seconds / 60),
    verificado_por: item.verified_by || '',
    verificado_em: item.verified_at || ''
  }));
  return new AttachmentBuilder(Buffer.from(toCsv(rows, ['jogador', 'discord_id', 'status', 'minutos_com_staff', 'verificado_por', 'verificado_em']), 'utf8'), { name: `verificacao-guild-${campaign.id}.csv` });
}

async function postReminderIfNeeded(client, now = new Date()) {
  const campaign = repo.getActiveCampaign();
  if (!campaign) return { sent: false, reason: 'no_campaign' };
  await refreshQualifications(client, now);
  const deadline = Date.parse(campaign.deadline_at);
  if (now.getTime() >= deadline) return finishIfNeeded(client, now);
  const utcDate = now.toISOString().slice(0, 10);
  if (now.getUTCHours() < 18 || campaign.last_reminder_date === utcDate) return { sent: false, reason: 'not_due' };
  const channel = await client.channels.fetch(campaign.announcement_channel_id);
  await postPendingList(channel, campaign, `📢 **CONFIRMACAO OBRIGATORIA — lembrete diario**\nPrazo final: ${deadlineText(campaign.deadline_at)}. Entre em Recrutamento ou Aguardando Evento e fale seu nome no jogo para uma pessoa da staff.`);
  repo.setLastReminder(campaign.id, utcDate);
  return { sent: true };
}

async function finishIfNeeded(client, now = new Date(), force = false) {
  const campaign = repo.getActiveCampaign();
  if (!campaign) return { sent: false, reason: 'no_campaign' };
  if (!force && now.getTime() < Date.parse(campaign.deadline_at)) return { sent: false, reason: 'not_due' };
  await refreshQualifications(client, now);
  const channel = await client.channels.fetch(campaign.announcement_channel_id);
  await postPendingList(
    channel,
    campaign,
    '⏰ **PRAZO ENCERRADO**\nOs nomes abaixo permaneceram pendentes e formam a lista para remocao da guilda no jogo.',
    [campaignAttachment(campaign)]
  );
  repo.finishCampaign(campaign.id, now.toISOString());
  return { sent: true, pending: repo.listMembers(campaign.id, 'pending') };
}

function summary(campaign) {
  const all = repo.listMembers(campaign.id);
  const counts = all.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
  return { total: all.length, pending: counts.pending || 0, verified: counts.verified || 0, voiceQualified: counts.voice_qualified || 0 };
}

module.exports = {
  DEFAULT_DEADLINE_DAYS,
  MINIMUM_SECONDS,
  calculateStaffOverlap,
  calculateVoiceTime,
  campaignAttachment,
  confirmMember,
  deadlineText,
  defaultDeadline,
  finishIfNeeded,
  parseRoster,
  pendingPayload,
  pendingPayloads,
  postPendingList,
  postReminderIfNeeded,
  refreshQualifications,
  startCampaign,
  summary
};
