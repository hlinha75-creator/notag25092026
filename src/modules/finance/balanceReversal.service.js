const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { parseSilver, formatSilver } = require('../../utils/silver');
const { safeSend } = require('../../utils/discord');
const audit = require('../audit/audit.repository');
const deposit = require('../deposit/deposit.service');
const finance = require('./finance.service');
const financeRepo = require('./finance.repository');

const drafts = new Map();

async function createDraft({ actorId, guild, percentage, reason, rawList }) {
  percentage = Number(percentage);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
    throw new Error('A porcentagem deve ser maior que 0 e no maximo 100.');
  }

  const entries = parseReversalList(rawList);
  if (!entries.length) throw new Error('Nenhuma linha com nome e valor foi encontrada.');

  const duplicateKeys = entries
    .filter((entry, index) => entries.findIndex((candidate) => candidate.key === entry.key) !== index)
    .map((entry) => entry.name);
  if (duplicateKeys.length) {
    throw new Error(`A lista possui membro(s) repetido(s): ${Array.from(new Set(duplicateKeys)).join(', ')}.`);
  }

  reason = String(reason || `Correcao de pagamento: estorno de ${percentage}%`).trim();
  if (reason.length > 500) throw new Error('O motivo do estorno deve ter no maximo 500 caracteres.');

  const resolved = await deposit.resolveNames({ guild, names: entries });
  const duplicateAccounts = resolved.matched
    .filter((item, index) => resolved.matched.findIndex((candidate) => candidate.discordId === item.discordId) !== index)
    .map((item) => item.discordId);
  if (duplicateAccounts.length) {
    throw new Error(`Mais de uma linha corresponde a mesma conta Discord: ${Array.from(new Set(duplicateAccounts)).map((id) => `<@${id}>`).join(', ')}.`);
  }
  const matched = resolved.matched.map((item) => {
    const amount = Math.round(item.sourceAmount * percentage / 100);
    const currentBalance = financeRepo.getBalance(item.discordId);
    return {
      ...item,
      amount,
      currentBalance,
      afterBalance: currentBalance - amount
    };
  });
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const draft = {
    id,
    actorId,
    type: 'balance_reversal',
    percentage,
    reason,
    rawList,
    entries,
    matched,
    unmatched: resolved.unmatched,
    ambiguous: resolved.ambiguous,
    createdAt: Date.now()
  };
  drafts.set(id, draft);
  return draft;
}

function getDraft(id) {
  return drafts.get(id);
}

function cancelDraft(id) {
  drafts.delete(id);
}

function canConfirm(draft) {
  return Boolean(
    draft
    && draft.matched.length > 0
    && draft.matched.length === draft.entries.length
    && draft.unmatched.length === 0
    && draft.ambiguous.length === 0
  );
}

async function confirmDraft({ draftId, actorId, client }) {
  const draft = getDraft(draftId);
  if (!draft) throw new Error('Previa de estorno expirada ou nao encontrada.');
  if (draft.actorId !== actorId) throw new Error('Somente quem criou o estorno pode confirma-lo.');
  if (!canConfirm(draft)) throw new Error('Resolva todos os nomes antes de aplicar o estorno. Nenhum saldo foi alterado.');

  const transactions = draft.matched.map((item) => ({
    type: 'payment_reversal',
    userId: item.discordId,
    amount: -item.amount,
    reason: draft.reason,
    referenceType: 'balance_reversal',
    referenceId: draft.id,
    createdBy: actorId
  }));
  const applied = finance.applyManyTransactions(transactions);
  await finance.notifyBalanceTransactions({ client, transactions: applied });

  const total = applied.reduce((sum, item) => sum + Math.abs(item.amount), 0);
  audit.createAuditLog({
    type: 'balance_reversal_confirmed',
    actorId,
    afterValue: -total,
    reason: draft.reason,
    metadata: {
      percentage: draft.percentage,
      participants: draft.matched.map((item) => ({
        discordId: item.discordId,
        name: item.name,
        sourceAmount: item.sourceAmount,
        reversedAmount: item.amount
      }))
    }
  });

  await safeSend(client, ids.channels.bankLogs, {
    content: `Estorno por lista aplicado por <@${actorId}>: -${formatSilver(total)} de ${draft.matched.length} membro(s), equivalente a ${formatPercent(draft.percentage)} dos valores informados. Motivo: ${draft.reason}`
  });

  drafts.delete(draftId);
  return { participants: applied, total, percentage: draft.percentage };
}

function draftEmbed(draft) {
  const totalSource = draft.entries.reduce((sum, item) => sum + item.sourceAmount, 0);
  const totalReversal = draft.matched.reduce((sum, item) => sum + item.amount, 0);
  const negativeCount = draft.matched.filter((item) => item.afterBalance < 0).length;
  const found = compactLines(draft.matched.map((item) => (
    `<@${item.discordId}> (${item.name}): ${formatSilver(item.sourceAmount)} -> -${formatSilver(item.amount)} | saldo ${formatSilver(item.currentBalance)} -> ${formatSilver(item.afterBalance)}`
  )));
  const unmatched = compactLines(draft.unmatched.map((item) => item.name), ', ');
  const ambiguous = compactLines(draft.ambiguous.map((item) => `${item.name}: ${item.matches.map((match) => `<@${match.discordId}>`).join(' / ')}`));

  return new EmbedBuilder()
    .setTitle('Previa do estorno por lista')
    .setDescription(canConfirm(draft)
      ? 'Confira os valores. O saldo so sera retirado ao confirmar abaixo.'
      : 'O estorno esta bloqueado porque nem todos os nomes foram encontrados sem ambiguidade.')
    .addFields(
      { name: 'Porcentagem', value: formatPercent(draft.percentage), inline: true },
      { name: 'Pessoas na lista', value: String(draft.entries.length), inline: true },
      { name: 'Encontradas', value: String(draft.matched.length), inline: true },
      { name: 'Total original listado', value: formatSilver(totalSource), inline: true },
      { name: 'Total a retirar', value: `-${formatSilver(totalReversal)}`, inline: true },
      { name: 'Ficarao negativos', value: String(negativeCount), inline: true },
      { name: 'Motivo', value: draft.reason, inline: false },
      { name: 'Previa individual', value: found || 'Nenhum membro encontrado.', inline: false },
      { name: 'Nao encontrados', value: unmatched || 'Nenhum.', inline: false },
      { name: 'Ambiguos', value: ambiguous || 'Nenhum.', inline: false }
    )
    .setColor(canConfirm(draft) ? (negativeCount ? 0xed8936 : 0xc53030) : 0x718096)
    .setFooter({ text: 'A confirmacao cria debitos auditados, faz backup e envia DM aos membros.' })
    .setTimestamp(new Date());
}

function draftComponents(draft) {
  const enabled = canConfirm(draft);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`balance_reversal:confirm:${draft.id}`)
        .setLabel(enabled ? 'Confirmar estorno' : 'Corrija a lista')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!enabled),
      new ButtonBuilder()
        .setCustomId(`balance_reversal:cancel:${draft.id}`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function parseReversalList(rawList) {
  const entries = [];
  const lines = String(rawList || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || !line.includes('|')) continue;
    const parts = line.split('|').map((part) => part.trim());
    const parsedName = deposit.parseNameList(parts[0])[0];
    if (!parsedName) throw new Error(`Nao foi possivel ler o nome na linha ${index + 1}.`);
    let sourceAmount;
    try {
      sourceAmount = Math.abs(parseSilver(parts.at(-1)));
    } catch {
      throw new Error(`Valor de prata invalido na linha ${index + 1}: ${parts.at(-1) || 'vazio'}.`);
    }
    if (!sourceAmount) throw new Error(`O valor da linha ${index + 1} deve ser maior que zero.`);
    entries.push({ ...parsedName, sourceAmount, lineNumber: index + 1 });
  }
  return entries;
}

function compactLines(lines, separator = '\n', maxLength = 1000) {
  const kept = [];
  let used = 0;
  for (const line of lines) {
    const text = String(line || '').trim();
    if (!text) continue;
    const extra = kept.length ? separator.length : 0;
    if (used + extra + text.length > maxLength) break;
    kept.push(text);
    used += extra + text.length;
  }
  const remaining = lines.length - kept.length;
  return kept.join(separator) + (remaining > 0 ? `${separator}... e mais ${remaining}` : '');
}

function formatPercent(value) {
  return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

module.exports = {
  cancelDraft,
  canConfirm,
  confirmDraft,
  createDraft,
  draftComponents,
  draftEmbed,
  getDraft,
  parseReversalList
};
