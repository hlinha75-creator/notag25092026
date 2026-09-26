const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  UserSelectMenuBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const finance = require('../finance/finance.service');
const audit = require('../audit/audit.repository');
const { calculateNetLoot } = require('../events/lootCalculator');
const { formatSilver } = require('../../utils/silver');
const { safeSend } = require('../../utils/discord');

const drafts = new Map();

function createDraft({ actorId, lootTotal, repair, silverBags, taxPercent }) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const netLoot = calculateNetLoot({ lootTotal, repair, silverBags, taxPercent });
  const draft = {
    id,
    actorId,
    lootTotal,
    repair,
    silverBags,
    taxPercent,
    netLoot,
    participants: new Set(),
    createdAt: Date.now()
  };
  drafts.set(id, draft);
  return draft;
}

function getDraft(id) {
  return drafts.get(id);
}

function addParticipants({ draftId, userIds }) {
  const draft = getDraft(draftId);
  if (!draft) throw new Error('Deposito expirado ou nao encontrado.');
  for (const userId of userIds) draft.participants.add(userId);
  return draft;
}

function cancelDraft(id) {
  drafts.delete(id);
}

async function createListDraft({ actorId, guild, totalAmount, reason, rawList }) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const parsedNames = parseNameList(rawList);
  const resolved = await resolveNames({ guild, names: parsedNames });
  const draft = {
    id,
    actorId,
    type: 'list_deposit',
    totalAmount,
    reason: reason || 'Deposito por lista',
    rawList,
    parsedNames,
    ...resolved,
    createdAt: Date.now()
  };
  drafts.set(id, draft);
  return draft;
}

function perMemberAmount(draft) {
  const count = draft.participants.size;
  if (count <= 0) return 0;
  return Math.floor(draft.netLoot / count);
}

async function confirmDraft({ draftId, actorId, client }) {
  const draft = getDraft(draftId);
  if (!draft) throw new Error('Deposito expirado ou nao encontrado.');
  if (draft.actorId !== actorId) throw new Error('Somente quem criou o deposito pode confirmar.');
  if (draft.participants.size === 0) throw new Error('Selecione pelo menos um participante.');

  const amount = perMemberAmount(draft);
  const participants = Array.from(draft.participants);
  const transactions = participants.map((userId) => ({
    type: 'quick_deposit',
    userId,
    amount,
    reason: `Deposito rapido dividido igualmente entre ${participants.length} membros`,
    referenceType: 'quick_deposit',
    referenceId: draft.id,
    createdBy: actorId
  }));
  finance.applyManyTransactions(transactions);
  await finance.notifyBalanceTransactions({ client, transactions });

  audit.createAuditLog({
    type: 'quick_deposit_confirmed',
    actorId,
    afterValue: draft.netLoot,
    reason: `Deposito rapido ${draft.id}`,
    metadata: {
      participants,
      perMember: amount,
      lootTotal: draft.lootTotal,
      repair: draft.repair,
      silverBags: draft.silverBags,
      taxPercent: draft.taxPercent
    }
  });

  await safeSend(client, ids.channels.bankLogs, {
    content: `Deposito rapido aprovado por <@${actorId}>: ${formatSilver(amount)} para ${participants.length} membro(s). Total liquido: ${formatSilver(draft.netLoot)}.`
  });

  drafts.delete(draftId);
  return { amount, participants };
}

async function confirmListDraft({ draftId, actorId, client }) {
  const draft = getDraft(draftId);
  if (!draft) throw new Error('Deposito por lista expirado ou nao encontrado.');
  if (draft.actorId !== actorId) throw new Error('Somente quem criou o deposito pode confirmar.');
  if (draft.type !== 'list_deposit') throw new Error('Este rascunho nao e um deposito por lista.');
  if (draft.matched.length === 0) throw new Error('Nenhum membro encontrado para receber deposito.');

  const amount = listPerMemberAmount(draft);
  const participants = draft.matched.map((item) => item.discordId);
  const transactions = participants.map((userId) => ({
    type: 'list_deposit',
    userId,
    amount,
    reason: `${draft.reason} dividido igualmente entre ${participants.length} membros`,
    referenceType: 'list_deposit',
    referenceId: draft.id,
    createdBy: actorId
  }));
  const applied = finance.applyManyTransactions(transactions);
  await finance.notifyBalanceTransactions({ client, transactions: applied });

  audit.createAuditLog({
    type: 'list_deposit_confirmed',
    actorId,
    afterValue: draft.totalAmount,
    reason: `Deposito por lista ${draft.id}`,
    metadata: {
      participants,
      perMember: amount,
      totalAmount: draft.totalAmount,
      remainder: listRemainder(draft),
      sourceNames: draft.parsedNames.map((item) => item.name),
      unmatched: draft.unmatched.map((item) => item.name),
      ambiguous: draft.ambiguous.map((item) => item.name)
    }
  });

  await safeSend(client, ids.channels.bankLogs, {
    content: [
      `Deposito por lista aprovado por <@${actorId}>.`,
      `${participants.length} membro(s) receberam ${formatSilver(amount)} cada.`,
      `Total informado: ${formatSilver(draft.totalAmount)}. Sobra por arredondamento: ${formatSilver(listRemainder(draft))}.`
    ].join(' ')
  });

  drafts.delete(draftId);
  return { amount, participants, totalAmount: draft.totalAmount, remainder: listRemainder(draft) };
}

function draftEmbed(draft) {
  const count = draft.participants.size;
  const amount = perMemberAmount(draft);
  const participants = Array.from(draft.participants).slice(0, 30).map((id) => `<@${id}>`).join(', ');
  return new EmbedBuilder()
    .setTitle('Deposito rapido')
    .setDescription('Selecione os participantes pela busca do Discord. Pode adicionar em mais de uma rodada.')
    .addFields(
      { name: 'Loot total', value: formatSilver(draft.lootTotal), inline: true },
      { name: 'Reparo', value: formatSilver(draft.repair), inline: true },
      { name: 'Sacos', value: formatSilver(draft.silverBags), inline: true },
      { name: 'Taxa', value: `${draft.taxPercent}%`, inline: true },
      { name: 'Liquido', value: formatSilver(draft.netLoot), inline: true },
      { name: 'Participantes', value: String(count), inline: true },
      { name: 'Cada membro recebe', value: formatSilver(amount), inline: true },
      { name: 'Selecionados', value: participants || 'Nenhum membro selecionado ainda.', inline: false }
    )
    .setColor(0x38a169)
    .setTimestamp(new Date());
}

function draftComponents(draftId) {
  return [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`deposit_select:add:${draftId}`)
        .setPlaceholder('Buscar e selecionar participantes')
        .setMinValues(1)
        .setMaxValues(25)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`deposit:confirm:${draftId}`).setLabel('Confirmar deposito').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`deposit:cancel:${draftId}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    )
  ];
}

function listDraftEmbed(draft) {
  const amount = listPerMemberAmount(draft);
  const remainder = listRemainder(draft);
  const found = compactLines(draft.matched.map((item) => `<@${item.discordId}> (${item.name})`));
  const unmatched = compactLines(draft.unmatched.map((item) => item.name), ', ');
  const ambiguous = compactLines(draft.ambiguous.map((item) => `${item.name}: ${item.matches.map((match) => mentionName(match)).join(' / ')}`));
  return new EmbedBuilder()
    .setTitle('Deposito por lista')
    .setDescription('Confira a previa antes de confirmar. O bot deposita somente para os membros encontrados sem ambiguidade.')
    .addFields(
      { name: 'Valor total', value: formatSilver(draft.totalAmount), inline: true },
      { name: 'Nomes lidos', value: String(draft.parsedNames.length), inline: true },
      { name: 'Encontrados', value: String(draft.matched.length), inline: true },
      { name: 'Cada encontrado recebe', value: formatSilver(amount), inline: true },
      { name: 'Sobra', value: formatSilver(remainder), inline: true },
      { name: 'Motivo', value: draft.reason || 'Deposito por lista', inline: true },
      { name: 'Encontrados', value: found || 'Nenhum encontrado.', inline: false },
      { name: 'Nao encontrados', value: unmatched || 'Nenhum.', inline: false },
      { name: 'Ambiguos', value: ambiguous || 'Nenhum.', inline: false }
    )
    .setColor(draft.unmatched.length || draft.ambiguous.length ? 0xf6ad55 : 0x38a169)
    .setFooter({ text: 'Confirmar aplica saldo imediatamente e envia DM para cada membro.' })
    .setTimestamp(new Date());
}

function listDraftComponents(draftId, canConfirm = true) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`deposit:list_confirm:${draftId}`)
        .setLabel(canConfirm ? 'Confirmar encontrados' : 'Nada para confirmar')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canConfirm),
      new ButtonBuilder()
        .setCustomId(`deposit:list_cancel:${draftId}`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function listPerMemberAmount(draft) {
  const count = draft.matched.length;
  if (count <= 0) return 0;
  return Math.floor(draft.totalAmount / count);
}

function listRemainder(draft) {
  return draft.totalAmount - (listPerMemberAmount(draft) * draft.matched.length);
}

function parseNameList(rawList) {
  const seen = new Set();
  return String(rawList || '')
    .split(/\r?\n/)
    .map(extractNameFromLine)
    .filter(Boolean)
    .map((name) => ({ name, key: normalizeName(name) }))
    .filter((item) => {
      if (!item.key || seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
}

function extractNameFromLine(line) {
  let text = String(line || '').trim();
  if (!text) return null;
  const mention = text.match(/<@!?(\d+)>/);
  if (mention) return mention[1];
  text = text.replace(/^\s*\d+[\.)-]?\s*/, '');
  text = text.split(':')[0];
  text = text.split('|')[0];
  text = text.split(' - ')[0];
  text = text.replace(/^@+/, '').trim();
  const firstToken = text.match(/[A-Za-z0-9_.-]{2,32}/);
  return firstToken ? firstToken[0].trim() : null;
}

async function resolveNames({ guild, names }) {
  const members = guild ? await guild.members.fetch().catch(() => null) : null;
  const users = getDatabase()
    .prepare('SELECT discord_id, discord_name, albion_name FROM users')
    .all();
  const byDiscordId = new Map();
  for (const row of users) {
    byDiscordId.set(row.discord_id, {
      discordId: row.discord_id,
      discordName: row.discord_name,
      albionName: row.albion_name
    });
  }
  if (members) {
    for (const member of members.values()) {
      const existing = byDiscordId.get(member.id) || { discordId: member.id };
      existing.discordName = existing.discordName || member.user?.username || null;
      existing.displayName = member.displayName || null;
      existing.nickname = member.nickname || null;
      existing.globalName = member.user?.globalName || null;
      byDiscordId.set(member.id, existing);
    }
  }

  const index = new Map();
  for (const user of byDiscordId.values()) {
    const aliases = [
      user.discordId,
      user.albionName,
      user.discordName,
      user.displayName,
      user.nickname,
      user.globalName
    ];
    for (const alias of aliases) {
      const key = normalizeName(alias);
      if (!key) continue;
      if (!index.has(key)) index.set(key, new Map());
      index.get(key).set(user.discordId, user);
    }
  }

  const matched = [];
  const unmatched = [];
  const ambiguous = [];
  for (const item of names) {
    const matches = Array.from(index.get(item.key)?.values() || []);
    if (matches.length === 1) {
      matched.push({ ...item, ...matches[0] });
    } else if (matches.length > 1) {
      ambiguous.push({ ...item, matches });
    } else {
      unmatched.push(item);
    }
  }
  return { matched, unmatched, ambiguous };
}

function mentionName(user) {
  return `<@${user.discordId}>${user.albionName ? `/${user.albionName}` : ''}`;
}

function compactLines(lines, separator = '\n', maxLength = 950) {
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

function normalizeName(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

module.exports = {
  addParticipants,
  cancelDraft,
  confirmDraft,
  confirmListDraft,
  createDraft,
  createListDraft,
  draftComponents,
  draftEmbed,
  getDraft,
  listDraftComponents,
  listDraftEmbed,
  normalizeName,
  parseNameList,
  resolveNames
};
