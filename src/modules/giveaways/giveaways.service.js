const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const env = require('../../config/env');
const ids = require('../../config/ids');
const { can, hasRole, isOwner } = require('../../config/permissions');
const audit = require('../audit/audit.repository');
const repo = require('./giveaways.repository');
const { formatSilver, parseSilver } = require('../../utils/silver');
const { discordTimestamp, parseLocalDateTime } = require('../../utils/timezone');

const STAFF_APPROVAL_THRESHOLD = 100_000_000;

async function createFromCommand(interaction) {
  const now = new Date();
  enforceCreationLimits(interaction.user.id, now);
  const payer = interaction.options.getUser('pagador', true);
  if (payer.bot) throw new Error('Um bot nao pode ser responsavel pelo premio.');
  const startsAt = parseLocalDateTime(interaction.options.getString('inicio', true), env.giveawayTimeZone);
  const endsAt = parseLocalDateTime(interaction.options.getString('fim', true), env.giveawayTimeZone);
  validateSchedule(startsAt, endsAt, now);
  const prizeName = interaction.options.getString('premio', true).trim();
  const estimatedValue = estimatedPrizeValue(interaction.options.getString('valor'), prizeName);

  const giveaway = repo.createGiveaway({
    guildId: interaction.guildId,
    creatorId: interaction.user.id,
    payerId: payer.id,
    title: interaction.options.getString('titulo', true).trim(),
    description: interaction.options.getString('descricao', true).trim(),
    prizeName,
    estimatedValue,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    winnerCount: interaction.options.getInteger('ganhadores', true),
    notes: interaction.options.getString('observacoes')?.trim() || null,
    requiresStaffApproval: estimatedValue > STAFF_APPROVAL_THRESHOLD ? 1 : 0
  });
  auditLog('giveaway_created', interaction.user.id, giveaway);
  const notifications = await sendApprovalRequests(interaction.client, giveaway);
  return {
    giveaway,
    content: [
      `Sorteio #${giveaway.id} criado e aguardando a confirmacao de <@${payer.id}>.`,
      giveaway.requires_staff_approval ? 'Como o valor supera 100m de silver, a staff tambem precisa aprovar.' : null,
      notifications.payer ? null : 'Nao consegui enviar DM ao pagador. Ele precisara receber um novo pedido pela edicao do sorteio.',
      `Depois das aprovacoes, ele sera publicado em <#${ids.channels.giveaways}>.`
    ].filter(Boolean).join('\n')
  };
}

async function editFromCommand(interaction) {
  const id = interaction.options.getInteger('id', true);
  const current = requireManageable(interaction, id);
  if (['ended', 'cancelled'].includes(current.status)) throw new Error('Sorteios encerrados ou cancelados nao podem ser editados.');
  const changes = {};
  const stringFields = {
    titulo: 'title', descricao: 'description', premio: 'prize_name', observacoes: 'notes'
  };
  for (const [option, column] of Object.entries(stringFields)) {
    const value = interaction.options.getString(option);
    if (value !== null) changes[column] = value.trim() || null;
  }
  const payer = interaction.options.getUser('pagador');
  if (payer) {
    if (payer.bot) throw new Error('Um bot nao pode ser responsavel pelo premio.');
    changes.payer_id = payer.id;
  }
  const winners = interaction.options.getInteger('ganhadores');
  if (winners !== null) changes.winner_count = winners;
  const startRaw = interaction.options.getString('inicio');
  const endRaw = interaction.options.getString('fim');
  const startsAt = startRaw ? parseLocalDateTime(startRaw, env.giveawayTimeZone) : new Date(current.starts_at);
  const endsAt = endRaw ? parseLocalDateTime(endRaw, env.giveawayTimeZone) : new Date(current.ends_at);
  if (startRaw) changes.starts_at = startsAt.toISOString();
  if (endRaw) changes.ends_at = endsAt.toISOString();
  validateSchedule(startsAt, endsAt, new Date(), { allowPastStart: current.status === 'open' });

  const valueRaw = interaction.options.getString('valor');
  if (valueRaw !== null) changes.estimated_value = editablePrizeValue(valueRaw);
  else if (Object.prototype.hasOwnProperty.call(changes, 'prize_name')) changes.estimated_value = estimatedPrizeValue(null, changes.prize_name);
  const nextPrize = changes.prize_name ?? current.prize_name;
  const nextValue = Object.prototype.hasOwnProperty.call(changes, 'estimated_value')
    ? changes.estimated_value
    : Number(current.estimated_value || estimatedPrizeValue(null, nextPrize));
  changes.requires_staff_approval = nextValue > STAFF_APPROVAL_THRESHOLD ? 1 : 0;

  const approvalSensitive = ['payer_id', 'prize_name', 'estimated_value'].some((field) => Object.prototype.hasOwnProperty.call(changes, field));
  if (approvalSensitive) {
    changes.payer_approved_at = null;
    changes.staff_approved_at = null;
    changes.staff_approved_by = null;
    changes.status = 'pending_payer';
  } else if (['scheduled', 'open'].includes(current.status)) {
    changes.status = statusForSchedule(startsAt, endsAt, new Date());
  }

  const updated = repo.updateGiveaway(id, changes);
  audit.createAuditLog({
    type: 'giveaway_edited', actorId: interaction.user.id, targetId: String(id),
    beforeValue: JSON.stringify(current), afterValue: JSON.stringify(updated)
  });
  await refreshMessage(interaction.client, updated);
  if (approvalSensitive) await sendApprovalRequests(interaction.client, updated);
  return { giveaway: updated, content: approvalSensitive
    ? `Sorteio #${id} atualizado. O pagador${updated.requires_staff_approval ? ' e a staff' : ''} precisam aprovar novamente.`
    : `Sorteio #${id} atualizado.` };
}

async function cancelFromCommand(interaction) {
  const id = interaction.options.getInteger('id', true);
  requireManageable(interaction, id);
  const result = repo.cancelGiveaway(id, interaction.user.id, interaction.options.getString('motivo'));
  if (!result.changed) throw new Error('Este sorteio ja foi encerrado ou cancelado.');
  auditLog('giveaway_cancelled', interaction.user.id, result.giveaway, result.giveaway.cancel_reason);
  await refreshMessage(interaction.client, result.giveaway);
  return `Sorteio #${id} cancelado.`;
}

async function finishFromCommand(interaction) {
  const id = interaction.options.getInteger('id', true);
  requireManageable(interaction, id);
  const result = repo.drawWinners(id, true);
  auditLog('giveaway_finished', interaction.user.id, result.giveaway, 'Encerramento manual');
  await refreshMessage(interaction.client, result.giveaway, { announceResult: !result.alreadyEnded });
  return finishSummary(result.giveaway, result.winners);
}

async function rerollFromCommand(interaction) {
  const id = interaction.options.getInteger('id', true);
  requireManageable(interaction, id);
  const invalid = interaction.options.getUser('ganhador', true);
  const reason = interaction.options.getString('motivo') || 'Ganhador invalido';
  const result = repo.rerollWinner(id, invalid.id, interaction.user.id, reason);
  audit.createAuditLog({
    type: 'giveaway_winner_rerolled', actorId: interaction.user.id, targetId: String(id), reason,
    metadata: { invalidUserId: invalid.id, replacement: result.replacement }
  });
  await refreshMessage(interaction.client, result.giveaway);
  await sendToGiveawayChannel(interaction.client, result.giveaway, {
    content: result.replacement
      ? `🔁 Sorteio #${id}: <@${invalid.id}> foi invalidado. Novo ganhador: <@${result.replacement}>!`
      : `🔁 Sorteio #${id}: <@${invalid.id}> foi invalidado, mas nao ha outro participante elegivel.`,
    allowedMentions: { users: result.replacement ? [result.replacement] : [] }
  });
  return result.replacement ? `Novo ganhador: <@${result.replacement}>.` : 'Nao ha outro participante elegivel.';
}

async function handleButton(interaction) {
  const [, action, idRaw] = interaction.customId.split(':');
  const id = Number(idRaw);
  if (!Number.isSafeInteger(id)) throw new Error('Sorteio invalido.');
  if (action === 'join') {
    if (interaction.user.bot) throw new Error('Bots nao podem participar.');
    const result = repo.toggleParticipant(id, interaction.user.id, new Date().toISOString());
    const giveaway = repo.getGiveaway(id);
    await interaction.update(giveawayPayload(giveaway));
    return interaction.followUp({
      content: result.joined ? 'Voce entrou no sorteio.' : 'Sua participacao foi removida.',
      flags: MessageFlags.Ephemeral
    });
  }
  if (action === 'payer_approve') {
    if (interaction.user.id !== repo.getGiveaway(id)?.payer_id) throw new Error('Somente o pagador indicado pode confirmar este premio.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = repo.setPayerApproved(id, interaction.user.id);
    if (!result.changed) return interaction.editReply('Esta confirmacao ja foi registrada ou o sorteio nao aceita mais aprovacoes.');
    auditLog('giveaway_payer_approved', interaction.user.id, result.giveaway);
    const ready = await activateIfApproved(interaction.client, result.giveaway);
    return interaction.editReply(ready ? `Premio confirmado. O sorteio #${id} foi liberado.` : 'Premio confirmado. Agora falta a aprovacao da staff.');
  }
  if (action === 'payer_refuse') {
    if (interaction.user.id !== repo.getGiveaway(id)?.payer_id) throw new Error('Somente o pagador indicado pode recusar este premio.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = repo.cancelGiveaway(id, interaction.user.id, 'Pagador recusou a responsabilidade pelo premio');
    if (!result.changed) return interaction.editReply('Este sorteio nao aceita mais alteracoes.');
    auditLog('giveaway_payer_refused', interaction.user.id, result.giveaway);
    await refreshMessage(interaction.client, result.giveaway);
    return interaction.editReply(`Voce recusou o pagamento do sorteio #${id}. Ele foi cancelado.`);
  }
  if (action === 'staff_approve') {
    if (!isStaff(interaction.member)) throw new Error('Somente a staff pode aprovar sorteios acima de 100m.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = repo.setStaffApproved(id, interaction.user.id);
    if (!result.changed) return interaction.editReply('Esta aprovacao ja foi registrada ou nao e necessaria.');
    auditLog('giveaway_staff_approved', interaction.user.id, result.giveaway);
    const ready = await activateIfApproved(interaction.client, result.giveaway);
    return interaction.editReply(ready ? `Sorteio #${id} aprovado e liberado.` : 'Aprovacao registrada. Agora falta a confirmacao do pagador.');
  }
  throw new Error('Acao de sorteio desconhecida.');
}

async function processDueGiveaways(client) {
  const now = new Date();
  const due = repo.dueGiveaways(now.toISOString());
  for (const giveaway of due) {
    try {
      if (new Date(giveaway.ends_at) <= now) {
        const result = repo.drawWinners(giveaway.id, true);
        auditLog('giveaway_finished', client.user?.id, result.giveaway, 'Encerramento automatico');
        await refreshMessage(client, result.giveaway, { announceResult: !result.alreadyEnded });
      } else if (giveaway.status === 'scheduled' && new Date(giveaway.starts_at) <= now) {
        const updated = repo.setReadyStatus(giveaway.id, 'open');
        auditLog('giveaway_opened', client.user?.id, updated);
        await refreshMessage(client, updated);
      }
    } catch (error) {
      console.error(`Falha ao processar sorteio #${giveaway.id}:`, error);
    }
  }
}

async function activateIfApproved(client, giveaway) {
  if (!giveaway.payer_approved_at || (giveaway.requires_staff_approval && !giveaway.staff_approved_at)) {
    repo.setPendingStatus(giveaway.id);
    return false;
  }
  if (new Date(giveaway.ends_at) <= new Date()) throw new Error('O prazo deste sorteio ja terminou. Edite as datas para libera-lo.');
  const updated = repo.setReadyStatus(giveaway.id, statusForSchedule(new Date(giveaway.starts_at), new Date(giveaway.ends_at), new Date()));
  await publishOrRefresh(client, updated);
  return true;
}

async function publishOrRefresh(client, giveaway) {
  if (giveaway.message_id) return refreshMessage(client, giveaway);
  const channel = await client.channels.fetch(ids.channels.giveaways).catch(() => null);
  if (!channel?.isTextBased()) throw new Error('Canal de publicacao dos sorteios nao encontrado.');
  const message = await channel.send(giveawayPayload(giveaway));
  repo.attachMessage(giveaway.id, channel.id, message.id);
  audit.createAuditLog({
    type: 'giveaway_published', actorId: giveaway.creator_id, targetId: String(giveaway.id),
    metadata: { channelId: channel.id, messageId: message.id }
  });
}

async function refreshMessage(client, giveaway, options = {}) {
  if (!giveaway?.message_id || !giveaway.channel_id) return;
  const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
  const message = await channel?.messages?.fetch(giveaway.message_id).catch(() => null);
  await message?.edit(giveawayPayload(giveaway)).catch(() => null);
  if (options.announceResult) {
    const winners = repo.listActiveWinners(giveaway.id);
    await channel?.send({
      content: resultAnnouncement(giveaway, winners),
      allowedMentions: { users: [...new Set([...winners.map((winner) => winner.user_id), giveaway.payer_id])] }
    }).catch(() => null);
  }
}

function giveawayPayload(giveaway) {
  const count = repo.participantCount(giveaway.id);
  const winners = giveaway.status === 'ended' ? repo.listActiveWinners(giveaway.id) : [];
  const status = statusLabel(giveaway.status);
  const embed = new EmbedBuilder()
    .setColor(statusColor(giveaway.status))
    .setTitle(`🎁 ${giveaway.title}`)
    .setDescription(giveaway.description)
    .addFields(
      { name: 'Premio', value: giveaway.prize_name, inline: true },
      { name: 'Valor estimado', value: giveaway.estimated_value ? `${formatSilver(giveaway.estimated_value)} silver` : 'Nao informado', inline: true },
      { name: 'Ganhadores', value: String(giveaway.winner_count), inline: true },
      { name: 'Inicio', value: discordTimestamp(giveaway.starts_at), inline: true },
      { name: 'Fim', value: discordTimestamp(giveaway.ends_at), inline: true },
      { name: 'Participantes', value: String(count), inline: true },
      { name: 'Criado por', value: `<@${giveaway.creator_id}>`, inline: true },
      { name: 'Premio pago por', value: `<@${giveaway.payer_id}>`, inline: true },
      { name: 'Status', value: status, inline: true }
    )
    .setFooter({ text: `Sorteio #${giveaway.id} • Fuso: ${env.giveawayTimeZone}` })
    .setTimestamp(new Date(giveaway.created_at.endsWith?.('Z') ? giveaway.created_at : `${giveaway.created_at.replace(' ', 'T')}Z`));
  if (giveaway.notes) embed.addFields({ name: 'Observacoes', value: giveaway.notes.slice(0, 1024) });
  if (giveaway.status === 'ended') embed.addFields({
    name: 'Ganhadores',
    value: winners.length ? winners.map((winner) => `<@${winner.user_id}>`).join('\n') : 'Nenhum participante elegivel.'
  });
  if (giveaway.status === 'cancelled' && giveaway.cancel_reason) {
    embed.addFields({ name: 'Motivo do cancelamento', value: giveaway.cancel_reason.slice(0, 1024) });
  }
  const joinButton = new ButtonBuilder()
    .setCustomId(`giveaway:join:${giveaway.id}`)
    .setLabel(giveaway.status === 'open' ? 'Participar / Sair' : status)
    .setEmoji('🎟️')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(giveaway.status !== 'open');
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(joinButton)],
    allowedMentions: { parse: [] }
  };
}

async function sendApprovalRequests(client, giveaway) {
  const payer = await client.users.fetch(giveaway.payer_id).catch(() => null);
  const payerMessage = await payer?.send({
    content: [
      `Voce foi indicado para pagar/entregar o premio do sorteio #${giveaway.id}.`,
      `**${giveaway.title}** — ${giveaway.prize_name}`,
      giveaway.estimated_value ? `Valor estimado: ${formatSilver(giveaway.estimated_value)} silver.` : null,
      `Criado por <@${giveaway.creator_id}>. Confirme somente se aceita essa responsabilidade.`
    ].filter(Boolean).join('\n'),
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`giveaway:payer_approve:${giveaway.id}`).setLabel('Aceitar premio').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`giveaway:payer_refuse:${giveaway.id}`).setLabel('Recusar').setStyle(ButtonStyle.Danger)
    )],
    allowedMentions: { parse: [] }
  }).then(() => true).catch(() => false);

  let staffMessage = true;
  if (giveaway.requires_staff_approval) {
    const channel = await client.channels.fetch(ids.channels.staff).catch(() => null);
    staffMessage = await channel?.send({
      content: `<@&${ids.roles.staff}> aprovacao necessaria: sorteio #${giveaway.id} vale **${formatSilver(giveaway.estimated_value)} silver** (acima de 100m). Criador: <@${giveaway.creator_id}>. Pagador: <@${giveaway.payer_id}>.`,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`giveaway:staff_approve:${giveaway.id}`).setLabel('Aprovar sorteio').setStyle(ButtonStyle.Success)
      )],
      allowedMentions: { roles: [ids.roles.staff], users: [] }
    }).then(() => true).catch(() => false);
  }
  return { payer: payerMessage, staff: staffMessage };
}

function enforceCreationLimits(userId, now) {
  if (repo.countActiveByCreator(userId) >= env.giveawayMaxActivePerUser) {
    throw new Error(`Voce ja tem ${env.giveawayMaxActivePerUser} sorteios ativos ou aguardando aprovacao.`);
  }
  const latest = repo.latestByCreator(userId);
  if (!latest) return;
  const createdAt = new Date(`${latest.created_at.replace(' ', 'T')}Z`);
  const next = new Date(createdAt.getTime() + env.giveawayCooldownMinutes * 60_000);
  if (now < next) throw new Error(`Aguarde ate ${discordTimestamp(next)} para criar outro sorteio.`);
}

function requireManageable(interaction, id) {
  const giveaway = repo.getGiveaway(id);
  if (!giveaway) throw new Error('Sorteio nao encontrado.');
  if (giveaway.creator_id !== interaction.user.id && !isStaff(interaction.member)) {
    throw new Error('Somente o criador ou a staff pode gerenciar este sorteio.');
  }
  return giveaway;
}

function isStaff(member) {
  return isOwner(member) || hasRole(member, 'staff') || hasRole(member, 'adm') || can(member, 'approvePayment');
}

function estimatedPrizeValue(valueRaw, prizeName) {
  if (valueRaw?.trim()) return parsePositiveSilver(valueRaw);
  const normalized = String(prizeName || '').trim().toLowerCase();
  const match = normalized.match(/^(\d+(?:[.,]\d+)?\s*(?:k|m)?)(?:\s*(?:silver|prata))?$/);
  return match ? parsePositiveSilver(match[1]) : null;
}

function parsePositiveSilver(raw) {
  const value = parseSilver(raw);
  if (value <= 0) throw new Error('O valor estimado do premio precisa ser maior que zero.');
  return value;
}

function editablePrizeValue(raw) {
  const normalized = String(raw || '').trim().toLowerCase();
  if (['nenhum', 'sem valor', 'remover'].includes(normalized)) return null;
  return parsePositiveSilver(raw);
}

function validateSchedule(startsAt, endsAt, now, options = {}) {
  if (!options.allowPastStart && startsAt < new Date(now.getTime() - 60_000)) throw new Error('O inicio nao pode estar no passado.');
  if (endsAt <= startsAt) throw new Error('O fim precisa ser posterior ao inicio.');
  if (endsAt > new Date(now.getTime() + 366 * 24 * 60 * 60_000)) throw new Error('O fim nao pode estar a mais de um ano.');
}

function statusForSchedule(startsAt, endsAt, now) {
  if (now >= endsAt) return 'ended';
  return now >= startsAt ? 'open' : 'scheduled';
}

function statusLabel(status) {
  return ({
    pending_payer: 'Aguardando pagador', pending_staff: 'Aguardando staff', scheduled: 'Agendado',
    open: 'Inscricoes abertas', ended: 'Encerrado', cancelled: 'Cancelado'
  })[status] || status;
}

function statusColor(status) {
  return ({ open: 0x2ecc71, scheduled: 0x3498db, ended: 0x9b59b6, cancelled: 0xe74c3c })[status] || 0xf1c40f;
}

function resultAnnouncement(giveaway, winners) {
  return winners.length
    ? `🎉 **Resultado do sorteio #${giveaway.id} — ${giveaway.title}**\n${winners.map((winner) => `<@${winner.user_id}>`).join(' ')} ganharam **${giveaway.prize_name}**!\nResponsavel pelo premio: <@${giveaway.payer_id}>.`
    : `Sorteio #${giveaway.id} encerrado sem participantes elegiveis.`;
}

function finishSummary(giveaway, winners) {
  return winners.length ? `Sorteio #${giveaway.id} encerrado. Ganhadores: ${winners.map((winner) => `<@${winner.user_id}>`).join(', ')}.` : `Sorteio #${giveaway.id} encerrado sem ganhadores.`;
}

async function sendToGiveawayChannel(client, giveaway, payload) {
  const channelId = giveaway.channel_id || ids.channels.giveaways;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  return channel?.send(payload).catch(() => null);
}

function auditLog(type, actorId, giveaway, reason = null) {
  audit.createAuditLog({
    type, actorId, targetId: String(giveaway.id), reason,
    metadata: { creatorId: giveaway.creator_id, payerId: giveaway.payer_id, status: giveaway.status }
  });
}

module.exports = {
  STAFF_APPROVAL_THRESHOLD,
  cancelFromCommand,
  createFromCommand,
  editFromCommand,
  finishFromCommand,
  giveawayPayload,
  handleButton,
  processDueGiveaways,
  rerollFromCommand
};
