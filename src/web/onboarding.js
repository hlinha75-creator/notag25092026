const ids = require('../config/ids');
const env = require('../config/env');
const audit = require('../modules/audit/audit.repository');
const repo = require('../modules/registration/registration.repository');
const { baseEmbed, safeSend } = require('../utils/discord');

const DEFAULT_ALBION_API = 'https://gameinfo-ams.albiononline.com/api/gameinfo';
const ISSUE_NOTIFICATION_COOLDOWN_MS = 5 * 60 * 1000;
const issueNotifications = new Map();

function guestVoiceUrl() {
  return `https://discord.com/channels/${ids.guildId}/${ids.channels.guestVoice}`;
}

function normalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function validateAlbionName(value) {
  const name = String(value || '').trim();
  if (name.length < 3 || name.length > 32) throw new Error('Informe um nome Albion entre 3 e 32 caracteres.');
  if (!/^[\p{L}\p{N}_'-]+$/u.test(name)) throw new Error('O nome Albion contém caracteres inválidos.');
  return name;
}

async function findAlbionCharacter(value, options = {}) {
  const requestedName = validateAlbionName(value);
  const fetchImpl = options.fetchImpl || fetch;
  const apiBase = String(options.apiBase || process.env.ALBION_API_BASE_URL || process.env.ALBION_API_BASE || DEFAULT_ALBION_API).replace(/\/$/, '');
  const response = await fetchImpl(`${apiBase}/search?q=${encodeURIComponent(requestedName)}`);
  if (!response.ok) throw new Error('A consulta ao Albion está temporariamente indisponível.');
  const search = await response.json();
  const match = (search.players || []).find((player) => normalizeName(player.Name) === normalizeName(requestedName));
  if (!match?.Id) throw new Error('Personagem não encontrado no servidor Europa do Albion.');
  return { id: match.Id, name: match.Name || requestedName };
}

async function findAlbionProfile(value, options = {}) {
  const character = await findAlbionCharacter(value, options);
  const fetchImpl = options.fetchImpl || fetch;
  const apiBase = String(options.apiBase || process.env.ALBION_API_BASE_URL || process.env.ALBION_API_BASE || DEFAULT_ALBION_API).replace(/\/$/, '');
  const response = await fetchImpl(`${apiBase}/players/${encodeURIComponent(character.id)}`);
  if (!response.ok) throw new Error('O Albion não retornou os dados completos desse personagem.');
  const profile = await response.json();
  return {
    id: character.id,
    name: profile.Name || character.name,
    guildId: profile.GuildId || null,
    guildName: profile.GuildName || '',
    allianceName: profile.AllianceName || ''
  };
}

function hasAnyRole(member, roleIds) {
  return roleIds.some((roleId) => roleId && member.roles?.cache?.has(roleId));
}

async function ensureGuestMember(client, discordUser, accessToken) {
  const guild = await client.guilds.fetch(ids.guildId);
  let member = await guild.members.fetch(discordUser.id).catch(() => null);
  if (!member) {
    member = await guild.members.add(discordUser.id, {
      accessToken,
      roles: ids.roles.guest ? [ids.roles.guest] : []
    });
  } else if (!hasAnyRole(member, [ids.roles.adm, ids.roles.staff, ids.roles.member, ids.roles.guest])) {
    await member.roles.add(ids.roles.guest, 'Entrada pelo site da Notag');
  }
  return member;
}

async function ensureFallbackGuestAccess(client, session) {
  const guild = await client.guilds.fetch(ids.guildId);
  const member = await guild.members.fetch(session.id);
  const protectedMember = hasAnyRole(member, [ids.roles.adm, ids.roles.staff, ids.roles.member]);

  if (!protectedMember) {
    if (ids.roles.guest && !member.roles.cache.has(ids.roles.guest)) {
      await member.roles.add(ids.roles.guest, 'Ajuda solicitada pelo site da Notag');
    }
    if (ids.roles.noTag && member.roles.cache.has(ids.roles.noTag)) {
      await member.roles.remove(ids.roles.noTag, 'Ajuda solicitada pelo site da Notag');
    }
  }
  return member;
}

function issueReason(error) {
  const reason = String(error?.message || 'Falha não identificada no cadastro.').trim();
  return reason.slice(0, 900);
}

async function notifyOnboardingIssue(client, session, albionName, error, options = {}) {
  const now = options.now ?? Date.now();
  const lastNotification = issueNotifications.get(session.id) || 0;
  if (now - lastNotification < ISSUE_NOTIFICATION_COOLDOWN_MS) {
    return { notified: false, cooldown: true };
  }
  issueNotifications.set(session.id, now);

  const informedName = String(albionName || '').trim() || 'Não informado';
  const displayName = session.globalName || session.username || 'Usuário desconhecido';
  const embed = baseEmbed('Ajuda necessária no cadastro pelo site')
    .setColor(0xd97706)
    .addFields(
      { name: 'Discord', value: `${displayName} (<@${session.id}>)\nID: ${session.id}` },
      { name: 'Personagem informado', value: informedName.slice(0, 1024) },
      { name: 'Motivo', value: issueReason(error) },
      { name: 'Recepção de voz', value: `<#${ids.channels.guestVoice}>` }
    );
  const sent = await safeSend(client, ids.channels.memberRequests, {
    content: `<@${session.id}> precisa de ajuda no cadastro pelo site.`,
    embeds: [embed],
    allowedMentions: { parse: [], users: [session.id], roles: [] }
  });
  if (sent?.id) {
    try {
      repo.upsertStaffAlert({
        discordId: session.id,
        channelId: sent.channelId || ids.channels.memberRequests,
        messageId: sent.id
      });
    } catch (storageError) {
      const closedTestDatabase = process.env.NODE_ENV === 'test'
        && /database connection is not open/i.test(String(storageError?.message || ''));
      if (!closedTestDatabase) console.error('[ONBOARDING] Não foi possível vincular o aviso à fila:', storageError);
    }
  }
  return { notified: Boolean(sent), cooldown: false };
}

async function handleOnboardingIssue(client, session, albionName, error, options = {}) {
  try {
    await ensureFallbackGuestAccess(client, session);
  } catch (accessError) {
    console.error('[ONBOARDING] Não foi possível confirmar o acesso de Convidado:', accessError);
  }

  try {
    await notifyOnboardingIssue(client, session, albionName, error, options);
  } catch (notificationError) {
    console.error('[ONBOARDING] Não foi possível avisar a staff:', notificationError);
  }

  try {
    audit.createAuditLog({
      type: 'website_onboarding_needs_staff',
      actorId: session.id,
      targetId: session.id,
      afterValue: String(albionName || '').trim() || null,
      reason: issueReason(error),
      metadata: { staffChannelId: ids.channels.memberRequests, voiceChannelId: ids.channels.guestVoice }
    });
  } catch (auditError) {
    console.error('[ONBOARDING] Não foi possível registrar a solicitação na auditoria:', auditError);
  }

  return {
    needsStaff: true,
    albionName: String(albionName || '').trim() || null,
    message: 'A staff foi avisada e vai ajudar você na recepção.',
    voiceUrl: guestVoiceUrl()
  };
}

async function completeOnboarding(client, session, albionName, options = {}) {
  const character = await findAlbionCharacter(albionName, options);
  const owner = repo.findUserByAlbionName(character.name, session.id);
  if (owner) throw new Error('Esse personagem Albion já está vinculado a outra conta. Procure a staff.');

  const current = repo.getUser(session.id);
  const currentName = normalizeName(current?.albion_name);
  const requestedName = normalizeName(character.name);
  if (currentName && currentName !== requestedName && current.registration_status !== 'unregistered') {
    throw new Error(`Sua conta já possui o personagem ${current.albion_name}. Procure a staff para alterar.`);
  }

  const guild = await client.guilds.fetch(ids.guildId);
  const member = await guild.members.fetch(session.id);
  const isMember = current?.registration_status === 'member' || hasAnyRole(member, [ids.roles.member]);
  const nickname = character.name.slice(0, 32);
  if (member.nickname !== nickname) await member.setNickname(nickname, 'Personagem informado no site da Notag');

  if (!isMember) {
    if (ids.roles.noTag && member.roles.cache.has(ids.roles.noTag)) {
      await member.roles.remove(ids.roles.noTag, 'Cadastro iniciado pelo site da Notag');
    }
    if (ids.roles.guest && !member.roles.cache.has(ids.roles.guest)) {
      await member.roles.add(ids.roles.guest, 'Cadastro iniciado pelo site da Notag');
    }
  }

  const pending = repo.getPendingRegistrationForDiscord(session.id);
  const status = isMember ? 'member' : (current?.registration_status === 'guest' ? 'guest' : 'pending');
  repo.upsertUser({
    discordId: session.id,
    discordName: session.username,
    albionName: character.name,
    registrationStatus: status
  });
  if (!isMember && !pending) repo.createRegistration({ discordId: session.id, albionName: character.name });

  audit.createAuditLog({
    type: 'website_onboarding_completed',
    actorId: session.id,
    targetId: session.id,
    afterValue: character.name,
    reason: 'Cadastro concluído pelo site',
    metadata: { albionPlayerId: character.id, existingMember: isMember }
  });

  return {
    albionName: character.name,
    alreadyMember: isMember,
    voiceUrl: guestVoiceUrl()
  };
}

function onboardingConfigured() {
  return Boolean(env.token && env.discordClientId && env.discordClientSecret && env.dashboardSessionSecret && ids.roles.guest && ids.channels.guestVoice);
}

module.exports = {
  completeOnboarding,
  ensureFallbackGuestAccess,
  ensureGuestMember,
  findAlbionCharacter,
  findAlbionProfile,
  handleOnboardingIssue,
  notifyOnboardingIssue,
  onboardingConfigured,
  validateAlbionName
};
