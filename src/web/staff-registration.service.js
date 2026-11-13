const ids = require('../config/ids');
const audit = require('../modules/audit/audit.repository');
const accountLinks = require('../modules/accounts/accountLinks.service');
const memberSnapshots = require('../modules/members/memberSnapshot.service');
const repo = require('../modules/registration/registration.repository');
const { baseEmbed, safeSend } = require('../utils/discord');
const { findAlbionProfile } = require('./onboarding');

const EXPECTED_GUILD_NAME = String(process.env.ALBION_GUILD_NAME || 'NoTag').trim();
const OVERDUE_MS = 24 * 60 * 60 * 1000;

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function memberName(member) {
  return member?.user?.globalName || member?.displayName || member?.user?.username || member?.user?.tag || member?.id;
}

function memberDiscordName(member) {
  return member?.user?.tag || member?.user?.username || memberName(member);
}

async function getGuild(client) {
  return client.guilds.cache?.get(ids.guildId) || client.guilds.fetch(ids.guildId);
}

async function getGuildMember(client, discordId) {
  const guild = await getGuild(client);
  const member = guild.members.cache?.get(String(discordId))
    || await guild.members.fetch(String(discordId)).catch(() => null);
  if (!member) fail('Essa pessoa não está mais no Discord da Notag.', 404);
  return { guild, member };
}

function liveMembers(guild) {
  const cache = guild?.members?.cache;
  if (!cache) return [];
  if (typeof cache.values === 'function') return [...cache.values()];
  return Object.values(cache);
}

async function currentDiscordMembers(guild) {
  let members = liveMembers(guild);
  const expectedMembers = Number(guild?.memberCount);
  const cacheLooksIncomplete = Number.isFinite(expectedMembers) && expectedMembers > members.length;

  if ((cacheLooksIncomplete || members.length === 0) && typeof guild?.members?.fetch === 'function') {
    const fetched = await guild.members.fetch().catch(() => null);
    if (fetched) {
      members = typeof fetched.values === 'function' ? [...fetched.values()] : Object.values(fetched);
    }
  }

  return members;
}

function joinedAt(member) {
  if (member?.joinedAt instanceof Date) return member.joinedAt.toISOString();
  if (member?.joinedTimestamp) return new Date(member.joinedTimestamp).toISOString();
  return null;
}

function storedDateMs(value) {
  if (!value) return NaN;
  const text = String(value).trim();
  return Date.parse(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
}

async function getRegistrationQueue(client, options = {}) {
  const now = Number(options.now || Date.now());
  const guild = await getGuild(client);
  const records = repo.listRegistrationRecords(options.limit || 500);
  const roster = memberSnapshots.latestSnapshotLookup();
  const discordMembers = await currentDiscordMembers(guild);
  const currentDiscordIds = new Set(discordMembers.map((member) => String(member.id)));
  const byId = new Map(
    records
      .filter((row) => currentDiscordIds.has(String(row.discord_id)))
      .map((row) => [String(row.discord_id), { ...row }])
  );

  for (const member of discordMembers) {
    const isGuest = Boolean(ids.roles.guest && member.roles?.cache?.has(ids.roles.guest));
    const isMember = Boolean(ids.roles.member && member.roles?.cache?.has(ids.roles.member));
    if (!isGuest && !isMember && !byId.has(String(member.id))) continue;
    const current = byId.get(String(member.id)) || {
      discord_id: String(member.id),
      discord_name: memberDiscordName(member),
      albion_name: null,
      registration_status: isMember ? 'member' : 'unregistered',
      created_at: joinedAt(member),
      updated_at: joinedAt(member)
    };
    current.discord_name = current.discord_name || memberDiscordName(member);
    current.discord_display_name = memberName(member);
    current.has_guest_role = isGuest;
    current.has_member_role = isMember;
    current.discord_joined_at = current.discord_joined_at || joinedAt(member);
    byId.set(String(member.id), current);
  }

  return [...byId.values()].map((row) => {
    const requestedName = row.requested_albion_name || row.albion_name;
    const rosterMember = requestedName ? roster.members.get(normalize(requestedName)) : null;
    const duplicate = requestedName ? repo.findUserByAlbionName(requestedName, row.discord_id) : null;
    const waitingSince = row.registration_created_at || row.discord_joined_at || row.created_at || row.updated_at;
    const parsedWaitingSince = storedDateMs(waitingSince);
    const waitingMs = Number.isFinite(parsedWaitingSince) ? Math.max(0, now - parsedWaitingSince) : 0;
    let reviewStatus = row.registration_review_status || row.registration_status || 'unregistered';
    if (reviewStatus === 'pending' && duplicate) reviewStatus = 'link_review';
    else if (row.has_member_role || row.registration_status === 'member') reviewStatus = 'member';
    else if (!row.registration_id && row.has_guest_role) reviewStatus = waitingMs >= OVERDUE_MS ? 'overdue' : 'unregistered';
    else if (reviewStatus === 'approved_guest') reviewStatus = 'guest';
    return {
      ...row,
      requested_albion_name: requestedName,
      queue_status: reviewStatus,
      waiting_hours: Math.floor(waitingMs / 3600000),
      linked_owner_id: duplicate?.discord_id || null,
      linked_owner_name: duplicate?.albion_name || duplicate?.discord_name || null,
      roster_status: !roster.snapshot ? 'not_imported' : (!requestedName ? 'unknown' : (rosterMember ? 'current' : 'absent')),
      roster_snapshot_id: roster.snapshot?.id || null,
      roster_last_seen: rosterMember?.last_seen || null,
      roster_roles: rosterMember?.roles || []
    };
  }).sort((a, b) => {
    const priority = { link_review: 0, pending: 1, overdue: 2, unregistered: 3, rejected: 4, guest: 5, member: 6 };
    return (priority[a.queue_status] ?? 9) - (priority[b.queue_status] ?? 9)
      || String(a.discord_display_name || a.discord_name || '').localeCompare(String(b.discord_display_name || b.discord_name || ''), 'pt-BR');
  });
}

async function previewRegistration(client, { discordId, albionName }, options = {}) {
  const { member } = await getGuildMember(client, discordId);
  const profile = await findAlbionProfile(albionName, options);
  if (normalize(profile.guildName) !== normalize(EXPECTED_GUILD_NAME)) {
    fail(`${profile.name} não está atualmente na guilda ${EXPECTED_GUILD_NAME}. O cadastro continuará como Convidado até entrar na guilda e enviar novamente.`, 409);
  }
  const owner = repo.findUserByAlbionName(profile.name, discordId);
  return {
    discordId: String(discordId),
    discordName: memberDiscordName(member),
    displayName: memberName(member),
    albionPlayerId: profile.id,
    albionName: profile.name,
    guildName: profile.guildName,
    allianceName: profile.allianceName || null,
    linkRequired: Boolean(owner),
    owner: owner ? {
      discordId: owner.discord_id,
      discordName: owner.discord_name,
      albionName: owner.albion_name,
      registrationStatus: owner.registration_status
    } : null
  };
}

async function clearStaffAlert(client, discordId) {
  const alert = repo.getOpenStaffAlert(discordId);
  if (!alert) return false;
  try {
    const channel = await client.channels.fetch(alert.channel_id);
    const message = channel?.messages?.fetch
      ? await channel.messages.fetch(alert.message_id).catch(() => null)
      : null;
    if (message?.delete) await message.delete().catch(() => null);
  } finally {
    repo.resolveStaffAlert(discordId);
  }
  return true;
}

async function sendResolutionDm(member, kind, albionName, reason) {
  if (!member?.send) return;
  const text = kind === 'approved'
    ? `Seu cadastro na Notag foi aprovado. Bem-vindo(a), ${albionName}! Seu apelido e cargo de Membro foram atualizados.`
    : `Seu cadastro na Notag precisa ser corrigido${reason ? `: ${reason}` : '.'} Você continua como Convidado e pode enviar o personagem novamente pelo site.`;
  await member.send(text).catch(() => null);
}

async function applyMemberRoles(member, albionName) {
  const nickname = String(albionName || '').trim().slice(0, 32);
  if (nickname && member.nickname !== nickname && member.setNickname) {
    await member.setNickname(nickname, 'Cadastro aprovado pelo painel da Notag').catch(() => null);
  }
  if (ids.roles.noTag) await member.roles.remove(ids.roles.noTag, 'Cadastro aprovado pelo painel').catch(() => null);
  if (ids.roles.guest) await member.roles.remove(ids.roles.guest, 'Cadastro aprovado pelo painel').catch(() => null);
  if (ids.roles.member) await member.roles.add(ids.roles.member, 'Cadastro aprovado pelo painel').catch(() => null);
}

async function approveRosterMember(client, { actorId, discordId, albionName, matchType = 'automatic' }) {
  const cleanAlbionName = String(albionName || '').trim();
  if (!cleanAlbionName) fail('Personagem da lista não informado.');
  const { member } = await getGuildMember(client, discordId);
  const current = repo.getUser(discordId);
  const owner = repo.findUserByAlbionName(cleanAlbionName, discordId);
  if (owner) fail(`O personagem ${cleanAlbionName} já está vinculado a outra conta Discord.`, 409);
  if (current?.albion_name && normalize(current.albion_name) !== normalize(cleanAlbionName)) {
    fail(`Essa conta Discord já está vinculada ao personagem ${current.albion_name}.`, 409);
  }

  repo.resolvePendingRegistrations({
    discordId,
    status: 'approved_member',
    reviewedBy: actorId,
    note: matchType === 'automatic'
      ? 'Vínculo automático pela lista atual da guilda'
      : 'Vínculo confirmado pelo próprio usuário'
  });
  repo.updateUserRegistration({
    discordId,
    discordName: memberDiscordName(member),
    albionName: cleanAlbionName,
    registrationStatus: 'member'
  });
  await applyMemberRoles(member, cleanAlbionName);
  await clearStaffAlert(client, discordId);
  if (matchType === 'automatic' && member?.send) {
    await member.send(
      `A lista atual da guilda confirmou uma correspondência exata com **${cleanAlbionName}**. Seu apelido foi atualizado e o cargo Membro foi aplicado automaticamente. Se essa conta não for sua, avise a staff.`
    ).catch(() => null);
  }
  audit.createAuditLog({
    type: matchType === 'automatic' ? 'roster_member_auto_linked' : 'roster_member_self_confirmed',
    actorId,
    targetId: discordId,
    beforeValue: current?.registration_status || null,
    afterValue: 'member',
    reason: 'Lista atual de membros da guilda',
    metadata: { albionName: cleanAlbionName, matchType }
  });
  return { member, albionName: cleanAlbionName };
}

async function logStaffResolution(client, { title, color, actorId, discordId, albionName, detail }) {
  const embed = baseEmbed(title).setColor(color).addFields(
    { name: 'Discord', value: `<@${discordId}> (${discordId})` },
    { name: 'Personagem', value: albionName || 'Não informado' },
    { name: 'Responsável', value: `<@${actorId}>` },
    ...(detail ? [{ name: 'Detalhes', value: String(detail).slice(0, 1024) }] : [])
  );
  await safeSend(client, ids.channels.staff, {
    embeds: [embed],
    allowedMentions: { parse: [], users: [discordId, actorId], roles: [] }
  });
}

async function confirmRegistration(client, input, options = {}) {
  const preview = await previewRegistration(client, input, options);
  const { member } = await getGuildMember(client, preview.discordId);
  const current = repo.getUser(preview.discordId);
  repo.upsertUser({
    discordId: preview.discordId,
    discordName: preview.discordName,
    albionName: preview.linkRequired ? null : preview.albionName,
    registrationStatus: 'pending'
  });
  let pending = repo.getPendingRegistrationForDiscord(preview.discordId);
  if (pending && normalize(pending.albion_name) !== normalize(preview.albionName)) {
    repo.updateRegistration({ id: pending.id, status: 'replaced', reviewedBy: input.actorId, note: 'Substituído no painel da staff' });
    pending = null;
  }
  if (!pending) {
    const result = repo.createRegistration({ discordId: preview.discordId, albionName: preview.albionName });
    pending = repo.getRegistration(result.lastInsertRowid);
  }

  let status = 'approved_member';
  let detail = 'Cadastro aprovado após validação da guilda no Albion.';
  if (preview.linkRequired) {
    accountLinks.mergeAccounts({
      primaryId: preview.owner.discordId,
      secondaryId: preview.discordId,
      actorId: input.actorId,
      label: preview.albionName
    });
    status = 'approved_linked';
    detail = `Conta vinculada ao perfil principal <@${preview.owner.discordId}>.`;
  }
  repo.resolvePendingRegistrations({ discordId: preview.discordId, status, reviewedBy: input.actorId, note: input.note || detail });
  repo.updateUserRegistration({
    discordId: preview.discordId,
    discordName: preview.discordName,
    albionName: preview.linkRequired ? null : preview.albionName,
    registrationStatus: 'member'
  });
  await applyMemberRoles(member, preview.albionName);
  await sendResolutionDm(member, 'approved', preview.albionName);
  await clearStaffAlert(client, preview.discordId);
  audit.createAuditLog({
    type: preview.linkRequired ? 'website_registration_link_authorized' : 'website_registration_approved',
    actorId: input.actorId,
    targetId: preview.discordId,
    beforeValue: current?.registration_status || null,
    afterValue: 'member',
    reason: input.note || null,
    metadata: { albionName: preview.albionName, guildName: preview.guildName, ownerId: preview.owner?.discordId || null }
  });
  await logStaffResolution(client, {
    title: preview.linkRequired ? 'Vínculo autorizado e cadastro aprovado' : 'Cadastro aprovado como Membro',
    color: 0x23a55a,
    actorId: input.actorId,
    discordId: preview.discordId,
    albionName: preview.albionName,
    detail
  });
  return { message: preview.linkRequired ? 'Vínculo autorizado e conta promovida a Membro.' : 'Cadastro aprovado e conta promovida a Membro.', preview };
}

async function rejectRegistration(client, { actorId, discordId, reason }) {
  const { member } = await getGuildMember(client, discordId);
  const current = repo.getUser(discordId);
  const pending = repo.getPendingRegistrationForDiscord(discordId);
  const albionName = pending?.albion_name || current?.albion_name || null;
  repo.resolvePendingRegistrations({ discordId, status: 'rejected', reviewedBy: actorId, note: reason || null });
  repo.updateUserRegistration({
    discordId,
    discordName: memberDiscordName(member),
    albionName: null,
    registrationStatus: 'guest',
    clearAlbion: true
  });
  if (ids.roles.member) await member.roles.remove(ids.roles.member, 'Cadastro rejeitado pelo painel').catch(() => null);
  if (ids.roles.noTag) await member.roles.remove(ids.roles.noTag, 'Cadastro rejeitado pelo painel').catch(() => null);
  if (ids.roles.guest) await member.roles.add(ids.roles.guest, 'Cadastro rejeitado pelo painel').catch(() => null);
  await sendResolutionDm(member, 'rejected', albionName, String(reason || '').trim());
  await clearStaffAlert(client, discordId);
  audit.createAuditLog({
    type: 'website_registration_rejected',
    actorId,
    targetId: discordId,
    beforeValue: current?.registration_status || null,
    afterValue: 'guest',
    reason: String(reason || '').trim() || null,
    metadata: { albionName }
  });
  await logStaffResolution(client, {
    title: 'Cadastro devolvido para correção', color: 0xed4245, actorId, discordId,
    albionName, detail: String(reason || '').trim() || 'Sem motivo informado.'
  });
  return { message: 'Cadastro devolvido. A pessoa continua como Convidado e pode enviar novamente.' };
}

async function remindRegistration(client, { actorId, discordId }) {
  const { member } = await getGuildMember(client, discordId);
  const siteUrl = `${String(process.env.DASHBOARD_BASE_URL || 'https://notag.discloud.app').replace(/\/$/, '')}/join`;
  await member.send(`Seu cadastro na Notag ainda está pendente. Acesse ${siteUrl}, informe seu personagem do Albion e conclua o envio. Se precisar de ajuda, entre na recepção de voz: https://discord.com/channels/${ids.guildId}/${ids.channels.guestVoice}`).catch(() => null);
  await clearStaffAlert(client, discordId);
  const embed = baseEmbed('Cadastro pendente — lembrete reenviado').setColor(0xf0b232).addFields(
    { name: 'Discord', value: `${memberName(member)} (<@${discordId}>)\nID: ${discordId}` },
    { name: 'Situação', value: 'Aguardando cadastro pelo site' },
    { name: 'Responsável pelo lembrete', value: `<@${actorId}>` }
  );
  const sent = await safeSend(client, ids.channels.memberRequests, {
    embeds: [embed], allowedMentions: { parse: [], users: [discordId, actorId], roles: [] }
  });
  if (sent?.id) repo.upsertStaffAlert({ discordId, channelId: sent.channelId || ids.channels.memberRequests, messageId: sent.id });
  audit.createAuditLog({ type: 'website_registration_reminder_sent', actorId, targetId: discordId, reason: 'Lembrete manual da staff' });
  return { message: 'Lembrete enviado por DM e aviso da fila atualizado.' };
}

async function manageStaffRegistration(client, input, options = {}) {
  const action = String(input.action || '').trim();
  if (action === 'preview') return { message: 'Personagem validado no Albion.', preview: await previewRegistration(client, input, options) };
  if (action === 'confirm') return confirmRegistration(client, input, options);
  if (action === 'reject') return rejectRegistration(client, input);
  if (action === 'remind') return remindRegistration(client, input);
  fail('Ação de cadastro inválida.');
}

module.exports = {
  EXPECTED_GUILD_NAME,
  approveRosterMember,
  applyMemberRoles,
  clearStaffAlert,
  confirmRegistration,
  getRegistrationQueue,
  manageStaffRegistration,
  previewRegistration,
  rejectRegistration,
  remindRegistration
};
