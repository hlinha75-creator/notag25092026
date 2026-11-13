const finance = require('../modules/finance/finance.service');
const financeRepo = require('../modules/finance/finance.repository');
const { formatSilver } = require('../utils/silver');
const { syncWithdrawStaffNotice } = require('./portal-finance.service');

function actionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function notifyMember(client, userId, message) {
  const user = await client.users.fetch(userId).catch(() => null);
  await user?.send(message).catch(() => {});
}

async function manageStaffWithdraw(client, { actorId, requestId, action }) {
  const id = Number(requestId);
  if (!Number.isSafeInteger(id) || id <= 0) throw actionError('Pedido de saque inválido.');
  const before = financeRepo.getWithdrawRequest(id);
  if (!before) throw actionError('Pedido de saque não encontrado.', 404);

  if (action === 'approve') {
    finance.approveWithdraw({ requestId: id, actorId });
    await notifyMember(client, before.user_id, `Seu saque #${id} de ${formatSilver(before.amount)} foi aprovado pela staff e aguarda pagamento.`);
  } else if (action === 'refuse') {
    finance.refuseWithdraw({ requestId: id, actorId });
    await notifyMember(client, before.user_id, `Seu saque #${id} de ${formatSilver(before.amount)} foi recusado pela staff. Nenhum saldo foi alterado.`);
  } else if (action === 'pay') {
    const transaction = finance.payWithdraw({ requestId: id, actorId });
    await finance.notifyBalanceTransactions({ client, transactions: [transaction] });
  } else {
    throw actionError('Ação financeira inválida.');
  }

  const request = financeRepo.getWithdrawRequest(id);
  await syncWithdrawStaffNotice(client, request);
  const messages = {
    approve: `Saque #${id} aprovado. O saldo será descontado somente no pagamento.`,
    refuse: `Saque #${id} recusado. Nenhum saldo foi alterado.`,
    pay: `Saque #${id} pago e descontado do saldo.`
  };
  return { request, message: messages[action] };
}

module.exports = { manageStaffWithdraw };
