const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ids = require('../config/ids');
const { getDatabase, transaction } = require('../database/connection');
const audit = require('../modules/audit/audit.repository');
const accountLinks = require('../modules/accounts/accountLinks.service');
const finance = require('../modules/finance/finance.service');
const financeRepo = require('../modules/finance/finance.repository');
const { safeSend } = require('../utils/discord');
const { formatSilver, parseSilver } = require('../utils/silver');

function actionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function pendingWithdraw(userId) {
  return getDatabase().prepare(`
    SELECT *
    FROM withdraw_requests
    WHERE user_id = ? AND status IN ('requested', 'approved')
    ORDER BY id DESC
    LIMIT 1
  `).get(userId) || null;
}

function parsePortalAmount(rawAmount) {
  let amount;
  try {
    amount = parseSilver(rawAmount);
  } catch {
    throw actionError('Informe um valor válido. Exemplos: 850k, 1.5m ou 1500000.');
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw actionError('O valor do saque precisa ser maior que zero.');
  }
  return amount;
}

function cleanPortalNote(note) {
  const cleanNote = String(note || '').replace(/\s+/g, ' ').trim();
  if (cleanNote.length > 180) throw actionError('A observação pode ter no máximo 180 caracteres.');
  return cleanNote;
}

function ownedWithdraw(discordId, requestId) {
  const userId = accountLinks.resolvePrimaryUserId(discordId);
  const request = financeRepo.getWithdrawRequest(Number(requestId));
  if (!request || request.user_id !== userId) throw actionError('Pedido de saque não encontrado.', 404);
  return { request, userId };
}

const createPortalWithdraw = transaction(({ discordId, rawAmount, note }) => {
  const userId = accountLinks.resolvePrimaryUserId(discordId);
  const amount = parsePortalAmount(rawAmount);
  const cleanNote = cleanPortalNote(note);

  const existing = pendingWithdraw(userId);
  if (existing) {
    throw actionError(`Você já possui o saque #${existing.id} pendente. Aguarde a conclusão antes de pedir outro.`, 409);
  }

  const balance = financeRepo.getBalance(userId);
  if (amount > balance) {
    throw actionError(`Seu saldo disponível é ${formatSilver(balance)}. Escolha um valor igual ou menor.`, 409);
  }

  const result = finance.requestWithdraw({ userId, amount, note: cleanNote });
  const request = financeRepo.getWithdrawRequest(result.lastInsertRowid);
  audit.createAuditLog({
    type: 'withdraw_requested',
    actorId: discordId,
    targetId: userId,
    afterValue: amount,
    reason: cleanNote || 'Solicitado pelo portal',
    metadata: { source: 'portal', originalDiscordId: discordId }
  });
  return request;
});

const editPortalWithdrawRequest = transaction(({ discordId, requestId, rawAmount, note }) => {
  const { request, userId } = ownedWithdraw(discordId, requestId);
  if (request.status !== 'requested') {
    throw actionError('Este saque já foi analisado pela staff e não pode mais ser alterado.', 409);
  }
  const amount = parsePortalAmount(rawAmount);
  const cleanNote = cleanPortalNote(note);
  const balance = financeRepo.getBalance(userId);
  if (amount > balance) {
    throw actionError(`Seu saldo disponível é ${formatSilver(balance)}. Escolha um valor igual ou menor.`, 409);
  }
  const updated = financeRepo.updateWithdrawRequest({ id: request.id, amount, note: cleanNote });
  if (!updated.changes) throw actionError('Este saque não está mais disponível para alteração.', 409);
  audit.createAuditLog({
    type: 'withdraw_edited_by_requester',
    actorId: discordId,
    targetId: userId,
    beforeValue: request.amount,
    afterValue: amount,
    reason: cleanNote || 'Alterado pelo solicitante no portal',
    metadata: { source: 'portal', requestId: request.id, previousNote: request.note || null }
  });
  return financeRepo.getWithdrawRequest(request.id);
});

const cancelPortalWithdrawRequest = transaction(({ discordId, requestId }) => {
  const { request, userId } = ownedWithdraw(discordId, requestId);
  if (request.status !== 'requested') {
    throw actionError('Este saque já foi analisado pela staff e não pode mais ser cancelado.', 409);
  }
  financeRepo.updateWithdrawStatus({ id: request.id, status: 'cancelled', actorId: discordId });
  audit.createAuditLog({
    type: 'withdraw_cancelled_by_requester',
    actorId: discordId,
    targetId: userId,
    beforeValue: request.amount,
    afterValue: 0,
    reason: `Saque #${request.id} cancelado pelo solicitante`,
    metadata: { source: 'portal', requestId: request.id }
  });
  return financeRepo.getWithdrawRequest(request.id);
});

function staffRequestContent(request) {
  const note = request.note ? ` | Obs: ${request.note}` : '';
  const status = {
    requested: 'Aguardando pagamento',
    approved: `Aprovado${request.reviewed_by ? ` por <@${request.reviewed_by}>` : ''} | Aguardando pagamento`,
    refused: `Recusado${request.reviewed_by ? ` por <@${request.reviewed_by}>` : ''}`,
    paid: `Pago${request.paid_by ? ` por <@${request.paid_by}>` : ''}`,
    cancelled: `Cancelado pelo solicitante${request.cancelled_by ? ` <@${request.cancelled_by}>` : ''}`
  }[request.status] || request.status;
  return `Saque #${request.id} | <@${request.user_id}> | ${formatSilver(request.amount)} | ${status}${note}`;
}

function staffRequestComponents(request) {
  if (!['requested', 'approved'].includes(request.status)) return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`finance:pay_withdraw:${request.id}`).setLabel('Pagar saque').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`finance:refuse_withdraw:${request.id}`).setLabel('Recusar saque').setStyle(ButtonStyle.Danger)
    )
  ];
}

async function syncWithdrawStaffNotice(client, request) {
  const payload = {
    content: staffRequestContent(request),
    components: staffRequestComponents(request),
    allowedMentions: { parse: [], users: [], roles: [] }
  };
  if (request.staff_channel_id && request.staff_message_id) {
    const channel = await client.channels.fetch(request.staff_channel_id).catch(() => null);
    const message = await channel?.messages?.fetch(request.staff_message_id).catch(() => null);
    if (message) {
      await message.edit(payload);
      return message;
    }
  }
  const message = await safeSend(client, ids.channels.finance, payload);
  if (message) {
    financeRepo.setWithdrawStaffMessage({
      id: request.id,
      channelId: message.channelId || message.channel?.id || ids.channels.finance,
      messageId: message.id
    });
  }
  return message;
}

async function requestPortalWithdraw(client, input) {
  const request = createPortalWithdraw(input);
  const staffMessage = await syncWithdrawStaffNotice(client, request);
  if (!staffMessage) {
    audit.createAuditLog({
      type: 'withdraw_staff_notice_failed',
      actorId: input.discordId,
      targetId: request.user_id,
      afterValue: request.id,
      reason: 'Pedido salvo, mas o aviso não pôde ser enviado ao canal financeiro.',
      metadata: { source: 'portal' }
    });
  }
  return {
    request,
    staffNotified: Boolean(staffMessage),
    message: `Saque #${request.id} de ${formatSilver(request.amount)} enviado para a staff.`
  };
}

async function editPortalWithdraw(client, input) {
  const request = editPortalWithdrawRequest(input);
  await syncWithdrawStaffNotice(client, request);
  return { request, message: `Saque #${request.id} atualizado para ${formatSilver(request.amount)}.` };
}

async function cancelPortalWithdraw(client, input) {
  const request = cancelPortalWithdrawRequest(input);
  await syncWithdrawStaffNotice(client, request);
  return { request, message: `Saque #${request.id} cancelado. Nenhum saldo foi alterado.` };
}

module.exports = {
  cancelPortalWithdraw,
  editPortalWithdraw,
  requestPortalWithdraw,
  staffRequestComponents,
  staffRequestContent,
  syncWithdrawStaffNotice
};
