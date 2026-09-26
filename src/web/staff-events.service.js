const ids = require('../config/ids');
const events = require('../modules/events/events.service');
const eventsRepo = require('../modules/events/events.repository');
const finance = require('../modules/finance/finance.service');
const campaigns = require('../modules/campaigns/campaigns.service');
const balanceBackup = require('../modules/csv/balanceBackup.service');
const { safeSend } = require('../utils/discord');
const { parseSilver } = require('../utils/silver');
const { normalizeEventType } = require('../modules/events/eventTypes');

const AUDIENCES = new Set(['public', 'member', 'staff']);
const MAX_PARTICIPANTS = 20;

function actionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cleanText(value, label, { required = false, max = 200 } = {}) {
  const text = String(value || '').trim();
  if (required && !text) throw actionError(`${label} e obrigatorio.`);
  if (text.length > max) throw actionError(`${label} deve ter no maximo ${max} caracteres.`);
  return text;
}

function slotValue(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_PARTICIPANTS) {
    throw actionError(`${label} deve ser um numero inteiro entre 0 e ${MAX_PARTICIPANTS}.`);
  }
  return parsed;
}

function validateEventInput(input) {
  const audience = String(input.audience || 'public');
  if (!AUDIENCES.has(audience)) throw actionError('Escolha um publico valido para o evento.');
  const fields = {
    contentType: normalizeEventType(input.contentType),
    title: cleanText(input.title, 'Titulo', { required: true, max: 80 }),
    description: cleanText(input.description, 'Build ou descricao', { max: 500 }) || 'Pergunte na Call',
    location: cleanText(input.location, 'Local', { max: 100 }) || 'Pergunte na Call',
    scheduledTime: cleanText(input.scheduledTime, 'Data e hora', { max: 80 }) || null,
    tankSlots: slotValue(input.tankSlots, 'Vagas de Tank'),
    healerSlots: slotValue(input.healerSlots, 'Vagas de Healer'),
    supportSlots: slotValue(input.supportSlots, 'Vagas de Suporte'),
    dpsSlots: slotValue(input.dpsSlots, 'Vagas de DPS'),
    audience
  };
  const totalSlots = fields.tankSlots + fields.healerSlots + fields.supportSlots + fields.dpsSlots;
  if (totalSlots < 1) throw actionError('O evento precisa ter pelo menos uma vaga.');
  if (totalSlots > MAX_PARTICIPANTS) throw actionError(`O evento pode ter no maximo ${MAX_PARTICIPANTS} participantes.`);
  return fields;
}

function publicationForAudience(audience) {
  const roleIds = audience === 'public'
    ? [ids.roles.member, ids.roles.guest]
    : audience === 'member'
      ? [ids.roles.member]
      : [ids.roles.adm, ids.roles.staff, ids.roles.caller, ids.roles.recruiter];
  const roles = [...new Set(roleIds.filter(Boolean))];
  return {
    channelId: audience === 'staff' ? ids.channels.staff : ids.channels.pingContent,
    content: roles.map((roleId) => `<@&${roleId}>`).join(' '),
    allowedMentions: { parse: [], roles }
  };
}

async function actorContext(client, actorId) {
  const guild = client.guilds.cache?.get(ids.guildId) || await client.guilds.fetch(ids.guildId);
  const member = guild.members.cache?.get(actorId) || await guild.members.fetch(actorId).catch(() => null);
  if (!member) throw actionError('Membro da staff nao encontrado no Discord.', 403);
  return {
    guild,
    member,
    interaction: { client, guild, member, user: { id: actorId } }
  };
}

function numericEvent(eventId) {
  const id = Number(eventId);
  if (!Number.isSafeInteger(id) || id <= 0) throw actionError('Evento invalido.');
  const event = eventsRepo.getEvent(id);
  if (!event) throw actionError('Evento nao encontrado.', 404);
  return event;
}

function ensureStandardEvent(event) {
  if (
    eventsRepo.getWorldBossEventMeta(event.id)
    || eventsRepo.getRaidAvalonEventMeta(event.id)
    || eventsRepo.getCustomEventMeta(event.id)
  ) {
    throw actionError('Este evento possui composicao especial e deve ser editado pelo Discord.', 409);
  }
}

async function createStaffEvent(client, input) {
  const fields = validateEventInput(input);
  const context = await actorContext(client, input.actorId);
  const publication = publicationForAudience(fields.audience);
  const event = await events.createEventFromFields(context.interaction, {
    creatorId: input.actorId,
    title: fields.title,
    description: fields.description,
    location: fields.location,
    scheduledTime: fields.scheduledTime,
    tankSlots: fields.tankSlots,
    healerSlots: fields.healerSlots,
    supportSlots: fields.supportSlots,
    dpsSlots: fields.dpsSlots,
    contentType: fields.contentType,
    postChannelId: publication.channelId,
    messageContent: publication.content,
    allowedMentions: publication.allowedMentions
  });
  eventsRepo.updateEvent(event.id, { audience: fields.audience });
  await events.syncEventPublication(client, event.id, publication);
  return {
    event: eventsRepo.getEvent(event.id),
    message: `${event.event_code} criado e publicado no Discord.`
  };
}

async function editStaffEvent(client, input) {
  const event = numericEvent(input.eventId);
  ensureStandardEvent(event);
  const fields = validateEventInput(input);
  const context = await actorContext(client, input.actorId);
  const updated = await events.updateCreatedEvent({
    client,
    guild: context.guild,
    eventId: event.id,
    actorId: input.actorId,
    patch: {
      title: fields.title,
      description: fields.description,
      location: fields.location,
      scheduled_time: fields.scheduledTime,
      tank_slots: fields.tankSlots,
      healer_slots: fields.healerSlots,
      support_slots: fields.supportSlots,
      dps_slots: fields.dpsSlots,
      content_type: fields.contentType,
      audience: fields.audience
    },
    publication: publicationForAudience(fields.audience)
  });
  return { event: updated, message: `${updated.event_code} atualizado no site e no Discord.` };
}

async function startStaffEvent(client, input) {
  const event = numericEvent(input.eventId);
  const context = await actorContext(client, input.actorId);
  const voice = await events.startEventWithGuild({
    client,
    guild: context.guild,
    eventId: event.id,
    actorId: input.actorId
  });
  return { event: eventsRepo.getEvent(event.id), voiceChannelId: voice.id, message: `${event.event_code} iniciado.` };
}

function nonNegativeSilver(value, label) {
  const parsed = parseSilver(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw actionError(`${label} deve ser zero ou um valor positivo.`);
  return parsed;
}

async function finishStaffEvent(client, input) {
  const event = numericEvent(input.eventId);
  const context = await actorContext(client, input.actorId);
  const taxPercent = Number(input.taxPercent || 0);
  if (!Number.isInteger(taxPercent) || taxPercent < 0 || taxPercent > 100) {
    throw actionError('A taxa deve ser um numero inteiro entre 0 e 100.');
  }
  const loot = {
    lootTotal: nonNegativeSilver(input.lootTotal, 'Loot total'),
    repair: nonNegativeSilver(input.repair, 'Reparo'),
    silverBags: nonNegativeSilver(input.silverBags, 'Sacos de prata'),
    taxPercent,
    evidenceNotes: cleanText(input.evidenceNotes, 'Evidencias', { max: 1000 })
  };
  await events.finishEvent(context.interaction, event.id);
  const review = events.saveLootReview({ eventId: event.id, ...loot });
  const reviewChannel = await events.createPostEventReviewSpace(context.interaction, event.id);
  return {
    event: eventsRepo.getEvent(event.id),
    netLoot: review.netLoot,
    reviewChannelId: reviewChannel.id,
    message: `${event.event_code} finalizado. A revisao foi criada no Discord.`
  };
}

async function cancelStaffEvent(client, input) {
  const event = numericEvent(input.eventId);
  const context = await actorContext(client, input.actorId);
  await events.cancelEvent(context.interaction, event.id, cleanText(input.reason, 'Motivo', { max: 300 }));
  return { event: eventsRepo.getEvent(event.id), message: `${event.event_code} cancelado.` };
}

async function submitStaffEventToFinance(client, input) {
  const event = numericEvent(input.eventId);
  await actorContext(client, input.actorId);
  events.submitEventToFinance({ eventId: event.id, actorId: input.actorId });
  const reviewChannel = await events.moveReviewChannelToClosed(client, event.id);
  await events.postDpsMeterSummary(client, event.id);
  const financeMessage = await safeSend(client, ids.channels.finance, {
    content: `Evento #${event.id} enviado para aprovacao financeira pelo painel web por <@${input.actorId}>.${reviewChannel ? ` Revisao: <#${reviewChannel.id}>` : ''}`,
    embeds: [events.reviewEmbed(event.id)],
    components: events.reviewComponents(event.id, 'finance'),
    allowedMentions: { users: [input.actorId] }
  });
  if (financeMessage?.id) {
    eventsRepo.updateReviewMetadata(event.id, { finance_message_id: financeMessage.id });
  }
  await events.syncEventWorkflowMessages(client, event.id);
  return {
    event: eventsRepo.getEvent(event.id),
    reviewChannelId: reviewChannel?.id || null,
    message: `${event.event_code} enviado ao financeiro. Agora pode ser aprovado pelo painel ou pelo Discord.`
  };
}

async function returnStaffEventToReview(client, input) {
  const event = numericEvent(input.eventId);
  await actorContext(client, input.actorId);
  const reviewChannel = await events.returnEventToReview({ client, eventId: event.id, actorId: input.actorId });
  await safeSend(client, ids.channels.finance, {
    content: `Evento ${event.event_code} devolvido para revisao pelo painel web por <@${input.actorId}>.${reviewChannel ? ` Revisao: <#${reviewChannel.id}>` : ''}`,
    embeds: [events.reviewEmbed(event.id)],
    allowedMentions: { users: [input.actorId] }
  });
  await events.syncEventWorkflowMessages(client, event.id);
  return {
    event: eventsRepo.getEvent(event.id),
    reviewChannelId: reviewChannel?.id || null,
    message: `${event.event_code} devolvido para revisao.`
  };
}

async function approveStaffEventPayment(client, input) {
  const event = numericEvent(input.eventId);
  const context = await actorContext(client, input.actorId);
  const paymentResult = events.approveEventPayment({ eventId: event.id, actorId: input.actorId });
  await events.syncEventWorkflowMessages(client, event.id);
  const transactions = Array.isArray(paymentResult) ? paymentResult : (paymentResult.transactions || []);
  const raidRewards = await events.grantRaidAvalonRewards({
    guild: context.guild,
    eventId: event.id,
    actorId: input.actorId
  });

  if (transactions.length > 0) {
    await finance.notifyBalanceTransactions({ client, transactions });
  }

  let campaignText = '';
  if (paymentResult.campaignChoices?.decisions?.length) {
    const dmResult = await campaigns.sendEventPayoutDms({
      client,
      eventId: event.id,
      choices: paymentResult.campaignChoices
    });
    await campaigns.refreshActiveCampaignProgress(client);
    campaignText = ` Campanha @${paymentResult.campaignChoices.campaign.role_name || '900m'}: ${dmResult.sent} DM(s) enviada(s), ${dmResult.failed} falha(s).`;
  }

  await events.scheduleReviewChannelDeletion(client, event.id, 14);
  await balanceBackup.postEventBalanceBackup(client, event.id);

  const raidText = raidRewards.granted || raidRewards.points
    ? ` Carreira: ${raidRewards.points} ponto(s), ${raidRewards.granted} tag(s) nova(s).`
    : '';
  const paymentText = paymentResult.campaignChoices?.decisions?.length
    ? `Pagamento aprovado pelo painel web; os participantes receberam a escolha da campanha por DM.${campaignText}`
    : `Pagamento aprovado pelo painel web; ${transactions.length} saldo(s) atualizado(s).`;

  await safeSend(client, ids.channels.finance, {
    content: `${event.event_code} aprovado pelo painel web por <@${input.actorId}>. ${paymentText}${raidText}`,
    embeds: [events.reviewEmbed(event.id)],
    allowedMentions: { users: [input.actorId] }
  });

  return {
    event: eventsRepo.getEvent(event.id),
    transactions: transactions.length,
    campaignChoices: paymentResult.campaignChoices?.decisions?.length || 0,
    message: `${event.event_code}: ${paymentText}${raidText}`
  };
}

async function manageStaffEvent(client, input) {
  if (input.action === 'create') return createStaffEvent(client, input);
  if (input.action === 'edit') return editStaffEvent(client, input);
  if (input.action === 'start') return startStaffEvent(client, input);
  if (input.action === 'finish') return finishStaffEvent(client, input);
  if (input.action === 'cancel') return cancelStaffEvent(client, input);
  if (input.action === 'submit_review') return submitStaffEventToFinance(client, input);
  if (input.action === 'return_review') return returnStaffEventToReview(client, input);
  if (input.action === 'approve_payment') return approveStaffEventPayment(client, input);
  throw actionError('Acao de evento invalida.');
}

module.exports = {
  MAX_PARTICIPANTS,
  createStaffEvent,
  editStaffEvent,
  approveStaffEventPayment,
  finishStaffEvent,
  manageStaffEvent,
  publicationForAudience,
  returnStaffEventToReview,
  startStaffEvent,
  submitStaffEventToFinance,
  validateEventInput
};
