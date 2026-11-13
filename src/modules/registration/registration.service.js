const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const ids = require('../../config/ids');
const audit = require('../audit/audit.repository');
const repo = require('./registration.repository');
const { parseCsv, toCsv } = require('../../utils/csv');
const { safeSend } = require('../../utils/discord');

const guildVerificationPreviews = new Map();

async function handleGuildMemberAdd(member) {
  repo.upsertUser({
    discordId: member.id,
    discordName: member.user.tag,
    registrationStatus: 'unregistered'
  });
  repo.logGuildMemberEvent({
    eventType: 'join',
    discordId: member.id,
    discordName: member.user.tag,
    displayName: member.displayName
  });
  await member.roles.add(ids.roles.noTag).catch((error) => console.error('Falha ao adicionar Sem Tag:', error));
}

async function handleGuildMemberRemove(member) {
  repo.logGuildMemberEvent({
    eventType: 'leave',
    discordId: member.id,
    discordName: member.user?.tag || member.displayName || member.id,
    displayName: member.displayName
  });
  await postMemberLeftLog(member).catch((error) => console.error('Falha ao registrar saida de membro:', error));
}

async function postMemberLeftLog(member) {
  const user = repo.getUser(member.id) || {};
  const roles = member.roles?.cache
    ? [...member.roles.cache.values()]
      .filter((role) => role.id !== member.guild.id)
      .sort((a, b) => b.position - a.position)
      .map((role) => role.name)
    : [];

  await safeSend(member.client, ids.channels.memberExit, {
    embeds: [
      new EmbedBuilder()
        .setTitle('Saida do servidor')
        .setDescription(`<@${member.id}> saiu do Discord.`)
        .addFields(
          { name: 'Discord', value: `${member.user?.tag || member.displayName || 'desconhecido'}\nID: ${member.id}`, inline: true },
          { name: 'Apelido', value: member.displayName || '-', inline: true },
          { name: 'Albion', value: user.albion_name || '-', inline: true },
          { name: 'Status cadastro', value: user.registration_status || '-', inline: true },
          { name: 'Cargos anteriores', value: fieldText(roles.length ? roles.slice(0, 20).join(', ') : '-'), inline: false }
        )
        .setColor(0xe53e3e)
        .setTimestamp(new Date())
    ],
    allowedMentions: { parse: [] }
  });
}

function fieldText(value, maxLength = 1024) {
  const text = String(value || '-').trim() || '-';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 20)}\n... texto cortado`;
}

async function submitRegistration({ interaction, albionName }) {
  const member = interaction.member;
  assertAlbionNameAvailable(albionName, member.id);
  repo.upsertUser({
    discordId: member.id,
    discordName: interaction.user.tag,
    albionName,
    registrationStatus: 'pending'
  });
  const result = repo.createRegistration({ discordId: member.id, albionName });
  await applyAlbionNickname(member, albionName);
  await member.roles.remove(ids.roles.noTag).catch(() => {});
  await member.roles.add(ids.roles.guest).catch(() => {});
  audit.createAuditLog({
    type: 'registration_created',
    actorId: member.id,
    targetId: member.id,
    afterValue: albionName,
    reason: 'Registro enviado'
  });
  return result.lastInsertRowid;
}

async function applyAlbionNickname(member, albionName) {
  if (!member?.setNickname) return;

  const nickname = String(albionName || '').trim().slice(0, 32);
  if (!nickname || member.nickname === nickname) return;

  await member
    .setNickname(nickname, 'Nick do Albion informado no registro')
    .catch((error) => console.error(`Falha ao renomear ${member.id} para ${nickname}:`, error));
}

async function approveRegistration({ guild, registrationId, actorId, asMember, note }) {
  const registration = repo.getRegistration(registrationId);
  if (!registration) throw new Error('Registro nao encontrado.');
  assertAlbionNameAvailable(registration.albion_name, registration.discord_id);

  repo.updateRegistration({
    id: registrationId,
    status: asMember ? 'approved_member' : 'approved_guest',
    reviewedBy: actorId,
    note
  });
  repo.upsertUser({
    discordId: registration.discord_id,
    albionName: registration.albion_name,
    registrationStatus: asMember ? 'member' : 'guest'
  });

  const member = await guild.members.fetch(registration.discord_id).catch(() => null);
  if (member) {
    await member.roles.remove(ids.roles.noTag).catch(() => {});
    if (asMember) {
      await member.roles.remove(ids.roles.guest).catch(() => {});
      await member.roles.add(ids.roles.member).catch(() => {});
    } else {
      await member.roles.add(ids.roles.guest).catch(() => {});
    }
  }

  audit.createAuditLog({
    type: asMember ? 'registration_approved_member' : 'registration_kept_guest',
    actorId,
    targetId: registration.discord_id,
    afterValue: registration.albion_name,
    reason: note || null
  });

  return registration;
}

function assertAlbionNameAvailable(albionName, discordId) {
  const owner = repo.findUserByAlbionName(albionName, discordId);
  if (!owner) return;
  throw new Error(`O nick Albion ${albionName} ja esta vinculado a <@${owner.discord_id}>. Se as duas contas forem da mesma pessoa, use /mesclar_contas.`);
}

function previewPendingGuildRegistrations(csvText, actorId) {
  const guildNames = parseGuildNames(csvText);
  const guildNameSet = new Set(guildNames.map((name) => normalizeName(name)));
  const pending = repo.listPendingRegistrations();
  const approved = [];
  const keptGuest = [];

  for (const registration of pending) {
    const normalized = normalizeName(registration.albion_name);
    const item = {
      registrationId: registration.id,
      discordId: registration.discord_id,
      discordName: registration.discord_name || '',
      albionName: registration.albion_name,
      status: guildNameSet.has(normalized) ? 'aprovar_membro' : 'manter_convidado',
      reason: guildNameSet.has(normalized) ? 'encontrado na lista da guild' : 'nao encontrado na lista da guild'
    };

    if (item.status === 'aprovar_membro') approved.push(item);
    else keptGuest.push(item);
  }

  const preview = {
    actorId,
    guildNamesCount: guildNames.length,
    pendingCount: pending.length,
    approved,
    keptGuest,
    createdAt: Date.now()
  };
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  guildVerificationPreviews.set(id, preview);
  return { id, preview };
}

async function applyPendingGuildRegistrationPreview({ guild, previewId, actorId }) {
  const preview = guildVerificationPreviews.get(previewId);
  guildVerificationPreviews.delete(previewId);
  if (!preview) throw new Error('Previa expirada ou ja usada. Rode /sincronizar_albion novamente.');
  if (preview.actorId !== actorId) throw new Error('Somente quem criou a previa pode confirmar.');

  const results = [];
  for (const item of preview.approved) {
    const registration = repo.getRegistration(item.registrationId);
    if (!registration || registration.status !== 'pending') {
      results.push({ ...item, applied: 'nao', result: 'registro nao esta mais pendente' });
      continue;
    }

    await approveRegistration({
      guild,
      registrationId: item.registrationId,
      actorId,
      asMember: true,
      note: 'Aprovado automaticamente por CSV/TSV da guild Albion'
    });
    results.push({ ...item, applied: 'sim', result: 'aprovado como membro' });
  }

  for (const item of preview.keptGuest) {
    results.push({ ...item, applied: 'nao', result: 'mantido convidado' });
  }

  audit.createAuditLog({
    type: 'registration_guild_file_applied',
    actorId,
    reason: 'Verificacao de pedidos pendentes por arquivo da guild',
    metadata: {
      guildNamesCount: preview.guildNamesCount,
      pendingCount: preview.pendingCount,
      approved: preview.approved.length,
      keptGuest: preview.keptGuest.length
    }
  });

  return results;
}

function takePendingGuildRegistrationPreview(previewId, actorId) {
  const preview = guildVerificationPreviews.get(previewId);
  if (preview?.actorId === actorId) guildVerificationPreviews.delete(previewId);
  return preview;
}

function pendingGuildPreviewText(preview) {
  const approvedSample = preview.approved
    .slice(0, 12)
    .map((item) => `+ ${item.albionName} -> <@${item.discordId}>`)
    .join('\n') || 'Nenhum encontrado.';
  const keptSample = preview.keptGuest
    .slice(0, 8)
    .map((item) => `- ${item.albionName} -> <@${item.discordId}>`)
    .join('\n') || 'Nenhum.';

  return [
    'Previa da verificacao de pedidos pendentes:',
    `Entradas lidas no arquivo: ${preview.guildNamesCount}`,
    `Pedidos pendentes: ${preview.pendingCount}`,
    `Serao aprovados como Membro: ${preview.approved.length}`,
    `Continuam Convidado/pendente: ${preview.keptGuest.length}`,
    '',
    'Encontrados:',
    approvedSample,
    '',
    'Nao encontrados:',
    keptSample
  ].join('\n').slice(0, 1900);
}

function pendingGuildPreviewAttachment(preview, fileName = 'previa-pedidos-pendentes.csv') {
  const rows = [
    ...preview.approved,
    ...preview.keptGuest
  ].map((item) => ({
    registration_id: item.registrationId,
    discord_id: item.discordId,
    discord_name: item.discordName,
    albion_name: item.albionName,
    status: item.status,
    motivo: item.reason
  }));
  const csv = toCsv(rows, ['registration_id', 'discord_id', 'discord_name', 'albion_name', 'status', 'motivo']);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: fileName });
}

function pendingGuildApplyAttachment(results) {
  const rows = results.map((item) => ({
    registration_id: item.registrationId,
    discord_id: item.discordId,
    discord_name: item.discordName,
    albion_name: item.albionName,
    status: item.status,
    aplicado: item.applied,
    resultado: item.result
  }));
  const csv = toCsv(rows, ['registration_id', 'discord_id', 'discord_name', 'albion_name', 'status', 'aplicado', 'resultado']);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: 'resultado-pedidos-pendentes.csv' });
}

function parseGuildNames(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];

  const delimiter = raw.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
  const firstLine = raw.split(/\r?\n/, 1)[0] || '';
  const firstCells = firstLine.split(delimiter).map((cell) => normalizeHeader(cell));
  const hasKnownHeader = firstCells.some((cell) => guildNameHeaders().includes(cell));
  if (!hasKnownHeader) {
    return uniqueNames(allCellsFromLines(raw, delimiter));
  }

  const rows = delimiter === ','
    ? parseCsv(raw)
    : parseDelimited(raw, '\t');
  return uniqueNames([
    ...namesFromRows(rows),
    ...allValuesFromRows(rows)
  ]);
}

function namesFromRows(rows) {
  const names = [];

  for (const row of rows) {
    const entries = Object.entries(row);
    const match = entries.find(([key]) => guildNameHeaders().includes(normalizeHeader(key)));
    const value = match ? match[1] : entries[0]?.[1];
    if (value && String(value).trim()) names.push(String(value).trim());
  }

  return names;
}

function guildNameHeaders() {
  return ['character name', 'character_name', 'name', 'nome', 'nick', 'player', 'jogador', 'albion_name', 'albion'];
}

function allValuesFromRows(rows) {
  return rows
    .flatMap((row) => Object.values(row))
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function allCellsFromLines(text, delimiter) {
  return String(text || '')
    .split(/\r?\n/)
    .flatMap((line) => line.split(delimiter))
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function parseDelimited(text, delimiter) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];
  const headers = lines[0].split(delimiter).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));
  });
}

function uniqueNames(names) {
  const seen = new Set();
  const result = [];
  for (const name of names) {
    const normalized = normalizeName(name);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(String(name).trim());
  }
  return result;
}

function normalizeName(name) {
  return String(name || '')
    .replace(/^\uFEFF/, '')
    .replace(/^"|"$/g, '')
    .trim()
    .toLowerCase();
}

function normalizeHeader(name) {
  return normalizeName(name).replace(/\s+/g, ' ');
}

module.exports = {
  applyPendingGuildRegistrationPreview,
  approveRegistration,
  handleGuildMemberAdd,
  handleGuildMemberRemove,
  pendingGuildApplyAttachment,
  pendingGuildPreviewAttachment,
  pendingGuildPreviewText,
  previewPendingGuildRegistrations,
  takePendingGuildRegistrationPreview,
  submitRegistration
};
