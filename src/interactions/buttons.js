const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } = require('discord.js');
const { can, hasRole, isOwner } = require('../config/permissions');
const ids = require('../config/ids');
const eventsRepo = require('../modules/events/events.repository');
const events = require('../modules/events/events.service');
const customEventWizard = require('../modules/events/customEventWizard.service');
const weaponSelectionModes = require('../modules/events/weaponSelectionModes');
const eventTemplateComponents = require('../modules/events/eventTemplates.components');
const financeRepo = require('../modules/finance/finance.repository');
const finance = require('../modules/finance/finance.service');
const balanceReversal = require('../modules/finance/balanceReversal.service');
const audit = require('../modules/audit/audit.repository');
const csv = require('../modules/csv/csv.service');
const balanceBackup = require('../modules/csv/balanceBackup.service');
const albionVerification = require('../modules/albion/guildVerification.service');
const deposit = require('../modules/deposit/deposit.service');
const inactiveEvents = require('../modules/members/inactiveEvents.service');
const inactiveGuests = require('../modules/members/inactiveGuests.service');
const operations = require('../modules/operations/operations.service');
const announcementAcknowledgement = require('../modules/operations/announcementAcknowledgement.service');
const mandatoryRules = require('../modules/operations/mandatoryRules.service');
const staffTutorial = require('../modules/tutorials/staffTutorial.service');
const memberOnboarding = require('../modules/tutorials/memberOnboarding.service');
const academy = require('../modules/tutorials/academy.service');
const campaigns = require('../modules/campaigns/campaigns.service');
const memberProfile = require('../modules/members/profile.service');
const albionFame = require('../modules/albion/fame.service');
const { formatSilver } = require('../utils/silver');
const registration = require('../modules/registration/registration.service');
const { safeSend } = require('../utils/discord');
const accountLinks = require('../modules/accounts/accountLinks.service');
const lochMarket = require('../modules/community/lochMarket.service');
const springHideout = require('../modules/community/springHideout.service');
const giveaways = require('../modules/giveaways/giveaways.service');
const rosterAutoLink = require('../modules/members/rosterAutoLink.service');
const { approveRosterMember } = require('../web/staff-registration.service');
const missions = require('../modules/missions/missions.service');
const customEventWizardComponents = require('../modules/events/customEventWizard.components');
const groupDungeonWizard = require('../modules/events/groupDungeonWizard.service');
const eventTypes = require('../modules/events/eventTypes');
const eventNotificationPreferences = require('../modules/events/eventNotificationPreferences.service');
const eventCreationRecovery = require('../modules/events/eventCreationRecovery.service');
const compositionRules = require('../modules/events/compositionRules');
const { safeDeferReply, safeEditReply } = require('../utils/interactions');

const pausedButtonScopes = new Set([
  'auction',
  'albion_weekly',
  'member_list',
  'member_panel',
  'member_panel_staff',
  'poll'
]);

const pausedButtonIds = new Set([
  'panel:create_auction'
]);

function textInput(id, label, required = true, placeholder = null, style = TextInputStyle.Short) {
  const component = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required);
  if (placeholder) component.setPlaceholder(placeholder);
  return component;
}

function editTextInput(id, label, value, { required = true, style = TextInputStyle.Short, maxLength = 4000 } = {}) {
  const component = textInput(id, label, required, null, style).setMaxLength(maxLength);
  const current = String(value || '').slice(0, maxLength);
  if (current) component.setValue(current);
  return component;
}

function rememberedTextInput(id, label, value, { required = true, placeholder = null, style = TextInputStyle.Short, maxLength = 4000 } = {}) {
  const component = textInput(id, label, required, placeholder, style).setMaxLength(maxLength);
  const current = String(value || '').slice(0, maxLength);
  if (current) component.setValue(current);
  return component;
}

function showModal(interaction, customId, title, inputs) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(inputs.map((component) => new ActionRowBuilder().addComponents(component)));
  return interaction.showModal(modal);
}

function commonEventModal(interaction, previous = null, contentType = 'other') {
  const slots = previous?.slotsText ?? (previous
    ? [previous.tank_slots, previous.healer_slots, previous.support_slots, previous.dps_slots].join(',')
    : '');
  const customId = previous?.id
    ? `event:create:${contentType}:reuse:${previous.id}`
    : `event:create:${contentType}`;
  return showModal(interaction, customId, `Criar ${eventTypes.eventTypeLabel(contentType)}`, [
    rememberedTextInput('title', 'Content', previous?.title, { required: false, placeholder: 'Ex: DG Grupo T8+', maxLength: 80 }),
    rememberedTextInput('location', 'Local', previous?.location, { required: false, placeholder: 'Ex: Martlock Portal > HO Loch', maxLength: 100 }),
    rememberedTextInput('scheduledTime', 'Data/Hora', previous?.scheduledTime, { required: false, placeholder: 'Ex: 23/06 15:00 utc', maxLength: 80 }),
    rememberedTextInput('description', 'Tier da Build', previous?.description, { required: false, placeholder: 'Ex: T8 equivalente + set Skip', maxLength: 500 }),
    rememberedTextInput('slots', 'Tank, Healer, Suporte, DPS', slots, { required: false, placeholder: 'Ex: 1,1,1,3', maxLength: 40 })
  ]);
}

function customEventModal(interaction, previous = null, reuse = false) {
  const composition = previous
    ? [previous.tank_slots, previous.healer_slots, previous.support_slots, previous.dps_slots].join(',')
    : '';
  return showModal(interaction, reuse ? `event:custom_basic:reuse:${previous.id}` : 'event:custom_basic', 'Criar CTA', [
    rememberedTextInput('title', 'Título', previous?.title, { placeholder: 'Ex: Fame Farm T6', maxLength: 100 }),
    textInput('scheduledTime', 'Data e hora (UTC)', true, 'Ex: 21:00 (hoje) ou 25/08 22:00'),
    rememberedTextInput('location', 'Local', previous?.location, { placeholder: 'Ex: Portal de Bridgewatch', maxLength: 100 }),
    rememberedTextInput('description', 'Descrição', previous?.description, { required: false, placeholder: 'Montaria, food, poção, OC, swap etc.', style: TextInputStyle.Paragraph, maxLength: 1000 }),
    rememberedTextInput('composition', 'Tank, Healer, Suporte, DPS', composition, { placeholder: 'Ex: 2,2,2,14', maxLength: 40 })
  ]);
}

function raidEventModal(interaction, previous = null, contentType = null) {
  const mode = weaponSelectionModes.normalize(previous?.composition_mode || 'predefined');
  const selectedType = contentType || previous?.content_type || 'raid_avalon';
  const isDragonRaid = selectedType === 'raid_dragon';
  return showModal(interaction, `event:${isDragonRaid ? 'create_raid_dragon' : 'create_raid_full'}:${mode}`, isDragonRaid ? 'Criar Raid Dragão' : 'Raid Avalon Full', [
    textInput('scheduledTime', 'Dia e hora Albion', true, 'Ex: hoje 20:30 ou 16/06 20:30'),
    rememberedTextInput('location', 'We mass from', previous?.location, { placeholder: 'Ex: Bridgewatch Portal', maxLength: 100 }),
    rememberedTextInput('dungeonTier', isDragonRaid ? 'Tier da Raid' : 'Tier da DG', previous?.dungeon_tier, { placeholder: 'Ex: T8.1', maxLength: 40 }),
    rememberedTextInput('buildTier', 'Tier da build', previous?.build_tier, { placeholder: 'Ex: T8 equivalente', maxLength: 80 }),
    rememberedTextInput(
      'observation',
      'Observacao',
      previous ? events.raidObservationText(previous.description) : events.raidDefaultObservation,
      { required: false, style: TextInputStyle.Paragraph, maxLength: 500 }
    )
  ]);
}

function worldBossModal(interaction, previous = null) {
  const mode = weaponSelectionModes.normalize(previous?.composition_mode || 'predefined');
  return showModal(interaction, `event:create_world_boss:${mode}`, 'Criar World Boss', [
    textInput('eventDate', 'Data do Farm', true, 'Ex: 20/07/2026')
  ]);
}

function creationModalForKind(interaction, kind, previous = null, contentType = null) {
  if (kind === 'custom') return customEventModal(interaction, previous, Boolean(previous));
  if (kind === 'raid') return raidEventModal(interaction, previous, contentType);
  if (kind === 'world') return worldBossModal(interaction, previous);
  return commonEventModal(interaction, previous, contentType || 'other');
}

function reuseChoicePayload(kind, recent, contentType = null) {
  const labels = { common: 'evento', custom: 'CTA', raid: 'Raid Full', world: 'World Boss' };
  const label = labels[kind] || 'evento';
  const options = recent.map((event) => ({
    label: String(event.title || label).slice(0, 100),
    value: String(event.id),
    description: String(`${event.scheduled_time || 'Sem data'} • ${event.tank_slots}/${event.healer_slots}/${event.support_slots}/${event.dps_slots}`).slice(0, 100)
  }));
  return {
    content: `Encontrei seus últimos modelos de ${label}. A data e a hora sempre serão solicitadas novamente.`,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`event_template:select:${kind}:${contentType || 'other'}`)
          .setPlaceholder('Escolher entre os últimos eventos')
          .addOptions(options)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`event_create:reuse:${kind}:${contentType || 'other'}`).setLabel('Repetir último').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`event_create:new:${kind}:${contentType || 'other'}`).setLabel('Criar do zero').setStyle(ButtonStyle.Secondary)
      )
    ],
    flags: MessageFlags.Ephemeral
  };
}

function mentionOrDash(userId) {
  return userId ? `<@${userId}>` : 'sem registro';
}

function truncateInline(value, max = 70) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function withdrawRequestContent(request, options = {}) {
  const status = options.status || request.status || 'requested';
  const amount = formatSilver(Math.abs(Number(request.amount || 0)));
  const approvedBy = options.approvedBy || request.reviewed_by;
  const paidBy = options.paidBy || request.paid_by;
  const refusedBy = options.refusedBy || request.reviewed_by;
  const statusText = {
    requested: 'Aguardando pagamento',
    approved: `Aprovado: ${mentionOrDash(approvedBy)} | Aguardando pagamento`,
    paid: `Aprovado: ${mentionOrDash(approvedBy)} | Pago: ${mentionOrDash(paidBy)}`,
    refused: `Recusado: ${mentionOrDash(refusedBy)}`
  }[status] || `Status: ${status}`;
  const note = truncateInline(request.note);
  const line = [`Saque #${request.id}`, mentionOrDash(request.user_id), amount, statusText, note ? `Obs: ${note}` : null]
    .filter(Boolean)
    .join(' | ');
  return options.warning ? `${line}\n${options.warning}` : line;
}

function paymentRequestContent(request, options = {}) {
  const status = options.status || request.status || 'requested';
  const amount = formatSilver(Math.abs(Number(request.amount || 0)));
  const reviewedBy = options.reviewedBy || request.reviewed_by;
  const statusText = {
    requested: 'Aguardando aprovacao',
    approved: `Aprovado e depositado: ${mentionOrDash(reviewedBy)}`,
    refused: `Recusado: ${mentionOrDash(reviewedBy)}`
  }[status] || `Status: ${status}`;
  const lines = [
    `Pedido de pagamento #${request.id} | ${mentionOrDash(request.user_id)} | ${amount} | ${statusText}`,
    `Servico: ${truncateInline(request.service, 140)}`,
    `Motivo: ${truncateInline(request.description, 220)}`
  ];
  if (request.evidence) lines.push(`Prova: ${truncateInline(request.evidence, 220)}`);
  return lines.join('\n');
}

function canManageEvent(member, event) {
  if (!event) return false;
  if (event.creator_id === member.id) return true;
  return can(member, 'assumeEvent');
}

function isEphemeralInteractionMessage(interaction) {
  const flags = interaction.message?.flags;
  if (typeof flags?.has === 'function') return flags.has(MessageFlags.Ephemeral);
  return (Number(flags?.bitfield ?? flags ?? 0) & MessageFlags.Ephemeral) === MessageFlags.Ephemeral;
}

function canForceStartFinish(member) {
  return isOwner(member) || hasRole(member, 'staff') || hasRole(member, 'adm');
}

const publicEventActions = new Set([
  'details',
  'participate',
  'raid_slot',
  'raid_role',
  'raid_helper',
  'wb_slot',
  'wb_leave',
  'wb_manage',
  'wb_confirm',
  'wb_abort',
  'join_role',
  'change_role',
  'auto_join',
  'spectate',
  'pause',
  'start',
  'confirm_start',
  'finish',
  'confirm_finish',
  'cancel',
  'confirm_cancel',
  'abort_cancel'
]);

function isInteractiveEvent(event) {
  return event && ['created', 'running'].includes(event.status);
}

async function replyUnavailableEvent(interaction, event) {
  await interaction.message?.edit({ components: [] }).catch(() => {});
  const statusText = event?.status
    ? `Status atual: ${event.status}.`
    : 'O registro desse evento nao existe mais no banco atual.';
  return interaction.reply({
    content: `Esse evento nao esta mais aberto. ${statusText} Removi os botoes antigos desta mensagem.`,
    flags: MessageFlags.Ephemeral
  });
}

async function advanceCustomEventWizard(interaction, draftId, next) {
  if (!next.complete) return interaction.update(customEventWizardComponents.compositionPayload(next));
  if (eventTypes.usesVisualComposition(next.draft.contentType)) {
    await interaction.deferUpdate();
    const payload = await groupDungeonWizard.completionPayload({
      client: interaction.client,
      guild: interaction.guild,
      draft: next.draft
    });
    return interaction.editReply(payload);
  }
  await interaction.deferUpdate();
  const event = await events.createCustomEventFromDraft(interaction, next.draft);
  customEventWizard.removeDraft(draftId, interaction.user.id);
  return interaction.editReply({
    content: `CTA ${event.event_code} criado com a composição visual.`,
    embeds: [],
    components: []
  });
}

async function handleButton(interaction) {
  const [scope, action, id, extra, detail] = interaction.customId.split(':');
  if (pausedButtonScopes.has(scope) || pausedButtonIds.has(interaction.customId)) {
    return pausedFeatureReply(interaction);
  }

  if (scope === 'giveaway') return giveaways.handleButton(interaction);
  if (scope === 'mission') return missions.handleButton(interaction);
  if (scope === 'academy') return academy.handleButton(interaction);
  if (scope === 'mandatory_rules' && action === 'ack') {
    const result = await mandatoryRules.acknowledge(interaction);
    await interaction.update({ components: result.components });
    return interaction.followUp({
      content: result.restored
        ? 'Confirmação registrada e seu cargo Membro foi devolvido.'
        : result.added ? 'Confirmação registrada. Obrigado!' : 'Sua confirmação já estava registrada.',
      flags: MessageFlags.Ephemeral
    });
  }
  if (scope === 'mandatory_rules' && action === 'details') {
    return interaction.reply({
      ...mandatoryRules.fullRulesPayload(),
      flags: MessageFlags.Ephemeral
    });
  }
  if (scope === 'mandatory_rules' && action === 'pending') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Somente a staff pode consultar os pendentes.', flags: MessageFlags.Ephemeral });
    }
    await interaction.message.edit({ components: mandatoryRules.staffComponents() }).catch(() => {});
    const pages = mandatoryRules.pendingPages();
    await interaction.reply({ content: pages[0], allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
    for (const page of pages.slice(1)) {
      await interaction.followUp({ content: page, allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
    }
    return null;
  }
  if (scope === 'general_balances') {
    if (interaction.channelId !== ids.channels.staff) {
      return interaction.reply({ content: `Use esta exportação somente no canal <#${ids.channels.staff}>.`, flags: MessageFlags.Ephemeral });
    }
    if (!hasRole(interaction.member, 'staff')) {
      return interaction.reply({ content: 'Somente quem possui a tag Staff pode exportar os saldos gerais.', flags: MessageFlags.Ephemeral });
    }
    if (!['csv', 'html'].includes(action)) {
      return interaction.reply({ content: 'Formato de exportação inválido.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const attachment = action === 'csv'
      ? csv.activeMemberBalancesCsvAttachment()
      : csv.activeMemberBalancesHtmlAttachment();
    return interaction.editReply({
      content: action === 'csv'
        ? 'CSV gerado com os saldos positivos de todos, independente do cargo.'
        : 'HTML gerado com os saldos positivos de todos, independente do cargo. O arquivo também permite baixar o CSV.',
      files: [attachment]
    });
  }
  if (scope === 'event_create') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar evento.', flags: MessageFlags.Ephemeral });
    }
    let previous = action === 'reuse'
      ? eventsRepo.listRecentEventConfigurations(interaction.user.id, id, 1, extra)[0] || null
      : null;
    if (previous) previous = eventsRepo.getEventConfiguration(interaction.user.id, id, previous.id) || previous;
    if (!previous && ['raid', 'world'].includes(id)) {
      return interaction.update({
        content: `Escolha como as armas funcionarão em **${eventTypes.eventTypeLabel(extra)}**:`,
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`event_special_mode:select:${id}:${extra}`)
            .setPlaceholder('Escolha o modo das armas')
            .addOptions(weaponSelectionModes.options())
        )]
      });
    }
    return creationModalForKind(interaction, id, previous, extra);
  }
  if (scope === 'event_create_retry' && action === 'open') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar evento.', flags: MessageFlags.Ephemeral });
    }
    const attempt = eventCreationRecovery.take(id, interaction.user.id);
    return commonEventModal(interaction, attempt.values, attempt.contentType);
  }
  if (scope === 'event_config' && action === 'save') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Você não tem permissão para salvar configurações.', flags: MessageFlags.Ephemeral });
    }
    const event = eventsRepo.getEvent(Number(id));
    if (!event || String(event.creator_id) !== String(interaction.user.id)) {
      return interaction.reply({ content: 'Esse evento não está disponível para salvar.', flags: MessageFlags.Ephemeral });
    }
    return showModal(interaction, `event_config:save:${id}:${extra}:${detail}`, 'Salvar configuração', [
      textInput('name', 'Nome da configuração', true, `Ex: ${event.title}`)
    ]);
  }
  if (scope === 'event_loot_correction') {
    if (action === 'confirm') {
      await interaction.deferUpdate();
      const result = events.confirmLootReviewCorrection({ draftId: id, actorId: interaction.user.id });
      await events.syncEventWorkflowMessages(interaction.client, result.eventId);
      return interaction.editReply({
        content: `Correcao confirmada: ${formatSilver(result.previousNetLoot)} -> ${formatSilver(result.netLoot)}. O split dos participantes foi recalculado.`,
        components: []
      });
    }
    if (action === 'cancel') {
      events.cancelLootReviewCorrection({ draftId: id, actorId: interaction.user.id });
      return interaction.update({ content: 'Correcao cancelada. Nenhum valor foi alterado.', components: [] });
    }
  }
  if (scope === 'event_notifications') {
    if (action === 'recommended') {
      eventNotificationPreferences.acceptRecommended(interaction.user.id);
      return interaction.reply(eventNotificationPreferences.preferencePayload(
        interaction.user.id,
        'Configuração recomendada ativada.'
      ));
    }
    if (action === 'customize') {
      return interaction.reply(eventNotificationPreferences.preferencePayload(interaction.user.id));
    }
    if (action === 'disable') {
      eventNotificationPreferences.disable(interaction.user.id);
      return interaction.reply(eventNotificationPreferences.preferencePayload(
        interaction.user.id,
        'Notificações pessoais desativadas.'
      ));
    }
    if (action === 'test') {
      return interaction.reply(await eventNotificationPreferences.sendTestDm(interaction));
    }
  }
  if (scope === 'content_preview') {
    return interaction.reply({ content: 'A prévia de conteúdos foi desativada.', flags: MessageFlags.Ephemeral });
  }
  if (scope === 'roster_link') return rosterAutoLink.handleProposalButton(interaction, approveRosterMember);

  if (scope === 'event_manage_player') {
    const eventId = Number(id);
    const event = eventsRepo.getEvent(eventId);
    if (!canManageEvent(interaction.member, event)) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode gerenciar os jogadores.', flags: MessageFlags.Ephemeral });
    }
    if (!event || event.status !== 'running') {
      return interaction.reply({ content: 'O evento nao esta em andamento.', flags: MessageFlags.Ephemeral });
    }
    const participant = eventsRepo.getParticipant({ eventId, discordId: extra });
    if (!participant || participant.is_spectator || participant.is_paused) {
      return interaction.reply({ content: 'Esse jogador nao esta mais na composicao ativa.', flags: MessageFlags.Ephemeral });
    }
    if (action === 'pause') {
      await events.pauseManagedParticipant(interaction, eventId, extra);
      return interaction.update({
        content: `<@${extra}> foi removido da composicao. A vaga foi liberada e o tempo ja participado foi preservado.`,
        components: [],
        allowedMentions: { parse: [] }
      });
    }
    if (action.startsWith('role_')) {
      const role = action.slice('role_'.length);
      if (eventsRepo.getCustomEventMeta(eventId) || eventsRepo.getVisualEventBuildMeta(eventId)) {
        const options = events.customEventSlotOptions(eventId, role, extra);
        if (!options.length) {
          return interaction.reply({ content: `Nao ha vagas livres para ${rolePlainLabel(role)}.`, flags: MessageFlags.Ephemeral });
        }
        const rows = [];
        for (let start = 0; start < options.length; start += 25) {
          const page = Math.floor(start / 25) + 1;
          rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`event_manage_slot:assign:${eventId}:${extra}:${page}`)
              .setPlaceholder(`Escolher vaga de ${rolePlainLabel(role)}`)
              .addOptions(options.slice(start, start + 25))
          ));
        }
        return interaction.update({
          content: `Escolha a vaga/arma que <@${extra}> vai ocupar:`,
          components: rows,
          allowedMentions: { parse: [] }
        });
      }
      await events.reassignManagedParticipant(interaction, { eventId, discordId: extra, role });
      return interaction.update({
        content: `<@${extra}> agora esta como **${rolePlainLabel(role)}**.`,
        components: [],
        allowedMentions: { parse: [] }
      });
    }
  }

  if (scope === 'announcement' && ['ack', 'list'].includes(action)) {
    if (!hasRole(interaction.member, 'member')) {
      return interaction.reply({
        content: 'Somente membros da guilda podem confirmar este aviso.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (action === 'list') {
      const count = announcementAcknowledgement.acknowledgementCount(id);
      await interaction.message.edit({
        components: announcementAcknowledgement.acknowledgementComponents(id, count)
      });
      const pages = announcementAcknowledgement.acknowledgementListPages(id);
      await interaction.reply({
        content: pages[0],
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral
      });
      for (const page of pages.slice(1)) {
        await interaction.followUp({
          content: page,
          allowedMentions: { parse: [] },
          flags: MessageFlags.Ephemeral
        });
      }
      return null;
    }

    const result = announcementAcknowledgement.registerAcknowledgement(id, interaction.user.id);
    await interaction.update({
      components: announcementAcknowledgement.acknowledgementComponents(id, result.count)
    });
    return interaction.followUp({
      content: result.added ? 'OK registrado. Obrigado por confirmar!' : 'Seu OK ja estava registrado.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (scope === 'custom_event' && action === 'details') {
    const draft = customEventWizard.getDraft(id, interaction.user.id);
    const dpsPool = require('../modules/events/dpsWeaponPool');
    const fields = [
      rememberedTextInput('lootRules', 'Loot', draft.lootRules, { required: false, placeholder: 'Ex: full loot split; retirar regear e dividir o restante', style: TextInputStyle.Paragraph, maxLength: 1000 }),
      rememberedTextInput('consumables', 'Consumiveis', draft.consumables, { required: false, placeholder: 'Ex: 4x Giga Pot T7 / 2x Omelete Avaloniano T7', style: TextInputStyle.Paragraph, maxLength: 1000 }),
      rememberedTextInput('mount', 'Montaria', draft.mount, { required: false, placeholder: 'Ex: 120%+', maxLength: 200 })
    ];
    if (draft.composition.dps > 0 && !['free', 'role_free', 'weapon_declared'].includes(draft.dpsPolicy)) fields.push(
      rememberedTextInput('dpsPool', draft.dpsPolicy === 'caller' ? 'Armas do caller — Nome: quantidade' : 'Limites DPS — Nome: quantidade', dpsPool.formatDpsPoolText(draft.dpsPool), {
        required: draft.composition.dps > 0,
        placeholder: draft.dpsPolicy === 'caller' ? '! Prisma: 1\n! Luvas Cravadas: 1\nFura-Bruma: 2' : 'Prisma: 1\nLuvas Cravadas: 1\nFura-Bruma: 2',
        style: TextInputStyle.Paragraph,
        maxLength: 4000
      })
    );
    return showModal(interaction, `event:custom_details:${draft.id}`, 'CTA - loot e requisitos', fields);
  }

  if (scope === 'custom_event' && action === 'slots') {
    const slotPage = customEventWizard.slotPage({ id, creatorId: interaction.user.id, page: extra });
    const inputs = slotPage.slots.map((slot, index) => {
      const input = textInput(`slot_${index}`, slot.fieldLabel, false, 'Ex: arma, build ou observacao da vaga');
      if (slot.value) input.setValue(slot.value);
      return input;
    });
    return showModal(
      interaction,
      `event:custom_slots:${id}:${slotPage.page}`,
      `Composicao ${slotPage.page + 1}/${slotPage.totalPages}`,
      inputs
    );
  }

  if (scope === 'custom_event' && action === 'build_back') {
    const step = customEventWizard.compositionStep({
      id,
      creatorId: interaction.user.id,
      position: Number(extra)
    });
    return interaction.update(customEventWizardComponents.compositionPayload(step));
  }

  if (scope === 'custom_event' && action === 'weapon_change') {
    const step = customEventWizard.compositionStep({
      id,
      creatorId: interaction.user.id,
      position: Number(extra)
    });
    return interaction.update(customEventWizardComponents.compositionPayload(step));
  }

  if (scope === 'custom_event' && action === 'weapon_confirm') {
    const next = customEventWizard.confirmSlotBuild({
      id,
      creatorId: interaction.user.id,
      position: Number(extra)
    });
    return advanceCustomEventWizard(interaction, id, next);
  }

  if (scope === 'custom_event' && action === 'weapon_repeat') {
    const next = customEventWizard.repeatSlotBuild({
      id,
      creatorId: interaction.user.id,
      position: Number(extra)
    });
    return advanceCustomEventWizard(interaction, id, next);
  }

  if (scope === 'custom_event' && action === 'cancel') {
    const draft = customEventWizard.removeDraft(id, interaction.user.id);
    const label = draft.contentType === 'cta' ? 'CTA' : eventTypes.eventTypeLabel(draft.contentType);
    return interaction.update({ content: `Criação da ${label} cancelada.`, embeds: [], components: [] });
  }

  if (scope === 'group_dungeon') {
    const draft = customEventWizard.getDraft(id, interaction.user.id);
    if (!eventTypes.usesVisualComposition(draft.contentType)) {
      throw new Error('Este assistente nao pertence a um evento com composicao visual.');
    }
    const eventLabel = eventTypes.eventTypeLabel(draft.contentType);
    if (action === 'missing_links') {
      const missing = groupDungeonWizard.manualLinkPage(draft);
      if (!missing.length) return interaction.update(groupDungeonWizard.reviewPayload(draft));
      return showModal(
        interaction,
        `event:group_build_links:${draft.id}`,
        'Links das builds',
        missing.map((build, index) => textInput(
          `link_${index}`,
          build.name.slice(0, 45),
          false,
          'https://discord.com/channels/...'
        ))
      );
    }
    if (action === 'review_without_links') {
      groupDungeonWizard.saveManualLinks({
        draftId: draft.id,
        creatorId: interaction.user.id,
        links: groupDungeonWizard.missingBuilds(draft).map((build) => ({ ...build, url: '' }))
      });
      return interaction.update(groupDungeonWizard.reviewPayload(draft));
    }
    if (action === 'change_forum') {
      await interaction.deferUpdate();
      return interaction.editReply(await groupDungeonWizard.forumSelectionPayload(interaction.guild, draft));
    }
    if (action === 'confirm') {
      await interaction.deferUpdate();
      const event = await events.createVisualEventFromDraft(interaction, draft);
      customEventWizard.removeDraft(draft.id, interaction.user.id);
      return interaction.editReply({
        content: `${eventLabel} ${event.event_code} criado com composição e fórum de builds.`,
        embeds: [],
        components: eventTemplateComponents.saveConfigurationComponents(event.id, 'common', draft.contentType)
      });
    }
    if (action === 'cancel') {
      customEventWizard.removeDraft(draft.id, interaction.user.id);
      return interaction.update({ content: `Criação de ${eventLabel} cancelada.`, embeds: [], components: [] });
    }
  }

  if (scope === 'accounts' && ['merge', 'cancel_merge'].includes(action)) {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para mesclar contas.', flags: MessageFlags.Ephemeral });
    }
    if (action === 'cancel_merge') {
      accountLinks.cancelMergePreview(id, interaction.user.id);
      return interaction.update({ content: 'Mesclagem cancelada. Nenhum dado foi alterado.', components: [] });
    }
    const result = accountLinks.applyMergePreview(id, interaction.user.id);
    return interaction.update({
      content: [
        'Contas mescladas com sucesso.',
        `Principal: <@${result.primaryId}>`,
        `Contas incorporadas: ${result.secondaryIds.map((userId) => `<@${userId}>`).join(' ')}`,
        result.albionName ? `Albion: ${result.albionName}` : null
      ].filter(Boolean).join('\n'),
      allowedMentions: { parse: [] },
      components: []
    });
  }

  if (scope === 'loch') {
    if (action === 'feedback') {
      const result = lochMarket.registerFeedback(interaction.user.id, id);
      await interaction.update({ components: lochMarket.announcementComponents(result.counts) });
      return interaction.followUp({
        content: result.added ? 'Obrigado por registrar sua reação.' : 'Sua reação já estava registrada.',
        flags: MessageFlags.Ephemeral
      });
    }
    if (action === 'suggestion') {
      return showModal(interaction, 'loch:suggestion_modal', 'Sugestão sobre o mercado', [
        textInput('suggestion', 'Sua opinião', true, 'Escreva sua sugestão para a staff', TextInputStyle.Paragraph)
      ]);
    }
    if (action === 'answer') {
      if (!isOwner(interaction.member) && !hasRole(interaction.member, 'staff') && !hasRole(interaction.member, 'adm')) {
        return interaction.reply({ content: 'Somente a staff pode responder sugestões.', flags: MessageFlags.Ephemeral });
      }
      const suggestion = lochMarket.getSuggestion(Number(id));
      if (!suggestion) return interaction.reply({ content: 'Sugestão não encontrada.', flags: MessageFlags.Ephemeral });
      if (suggestion.status === 'answered') {
        return interaction.reply({ content: 'Essa sugestão já foi respondida.', flags: MessageFlags.Ephemeral });
      }
      return showModal(interaction, `loch:answer_modal:${id}`, 'Responder sugestão', [
        textInput('answer', 'Resposta da staff', true, 'A resposta sera enviada por mensagem privada', TextInputStyle.Paragraph)
      ]);
    }
  }

  if (scope === 'spring_ho') {
    if (action === 'feedback') {
      const result = springHideout.registerFeedback(interaction.user.id, id);
      await interaction.update({ components: springHideout.announcementComponents(result.counts) });
      return interaction.followUp({
        content: result.added ? 'Obrigado por registrar sua reação.' : 'Sua reação já estava registrada.',
        flags: MessageFlags.Ephemeral
      });
    }
    if (action === 'suggestion') {
      return showModal(interaction, 'spring_ho:suggestion_modal', 'Sugestão sobre a HO', [
        textInput('suggestion', 'Sua opinião', true, 'Escreva sua sugestão para a staff', TextInputStyle.Paragraph)
      ]);
    }
    if (action === 'answer') {
      if (!isOwner(interaction.member) && !hasRole(interaction.member, 'staff') && !hasRole(interaction.member, 'adm')) {
        return interaction.reply({ content: 'Somente a staff pode responder sugestões.', flags: MessageFlags.Ephemeral });
      }
      const suggestion = springHideout.getSuggestion(Number(id));
      if (!suggestion) return interaction.reply({ content: 'Sugestão não encontrada.', flags: MessageFlags.Ephemeral });
      if (suggestion.status === 'answered') {
        return interaction.reply({ content: 'Essa sugestão já foi respondida.', flags: MessageFlags.Ephemeral });
      }
      return showModal(interaction, `spring_ho:answer_modal:${id}`, 'Responder sugestão', [
        textInput('answer', 'Resposta da staff', true, 'A resposta sera enviada por mensagem privada', TextInputStyle.Paragraph)
      ]);
    }
  }

  if (scope === 'campaign' && ['donate_event', 'keep_event'].includes(action)) {
    await interaction.deferReply(interaction.guild ? { flags: MessageFlags.Ephemeral } : {});
    const result = await campaigns.resolveEventPayoutChoice({
      client: interaction.client,
      decisionId: Number(id),
      userId: interaction.user.id,
      choice: action === 'donate_event' ? 'donate' : 'keep',
      actorId: interaction.user.id
    });
    if (result.transaction) {
      await finance.notifyBalanceTransactions({ client: interaction.client, transactions: [result.transaction] });
    }
    await interaction.message.edit({
      embeds: [campaigns.closedDecisionEmbed(result)],
      components: []
    }).catch(() => {});
    return interaction.editReply({
      content: result.donated
        ? `Doacao registrada: ${formatSilver(result.decision.amount)} para @${result.campaign.role_name || '900m'}.`
        : `Tudo certo. ${formatSilver(result.decision.amount)} foi enviado para seu saldo.`
    });
  }
  if (scope === 'campaign' && action === 'donate_balance') {
    const balance = financeRepo.getBalance(interaction.user.id);
    if (balance <= 0) {
      return interaction.reply({ content: 'Voce nao tem saldo positivo para doar.', flags: MessageFlags.Ephemeral });
    }
    return showModal(interaction, 'campaign:donate_balance_modal', 'Doar saldo para @900m', [
      textInput('amount', 'Valor para doar', true, `Seu saldo: ${formatSilver(balance)}. Ex: 5m`)
    ]);
  }

  if (scope === 'campaign' && action === 'view_contributors') {
    return interaction.reply({ ...campaigns.contributorsHtmlPayload(), flags: MessageFlags.Ephemeral });
  }

  if (scope === 'campaign' && action === 'confirm_balance_donation') {
    if (extra !== interaction.user.id) {
      return interaction.reply({ content: 'Essa confirmacao nao foi criada para voce.', flags: MessageFlags.Ephemeral });
    }
    const amount = Number(id);
    await interaction.deferUpdate();
    const result = await campaigns.donateFromBalance({
      client: interaction.client,
      userId: interaction.user.id,
      amount,
      actorId: interaction.user.id
    });
    await finance.notifyBalanceTransactions({ client: interaction.client, transactions: [result.transaction] });
    return interaction.editReply({
      content: `Doacao registrada: ${formatSilver(amount)} para @${result.campaign.role_name || '900m'}. Seu saldo atual: ${formatSilver(result.transaction.afterBalance)}.`,
      components: []
    });
  }

  if (scope === 'campaign' && action === 'cancel_balance_donation') {
    if (id !== interaction.user.id) {
      return interaction.reply({ content: 'Essa confirmacao nao foi criada para voce.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferUpdate();
    return interaction.editReply({ content: 'Doacao cancelada. Nenhum saldo foi alterado.', components: [] });
  }

  if (interaction.customId === 'panel:create_event') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar evento.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      content: `**Qual tipo de evento?**\nA escolha abre o formulário e as regras corretas para esse conteúdo.\n\n📋 [Abrir planilha de composições](${compositionRules.COMPOSITION_SHEET_URL})`,
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('event_create_type:select')
          .setPlaceholder('Selecione o tipo do evento')
          .addOptions(eventTypes.discordOptions())
      )],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'panel:create_custom_event') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar CTA.', flags: MessageFlags.Ephemeral });
    }
    const recent = eventsRepo.listRecentEventConfigurations(interaction.user.id, 'custom');
    return recent.length
      ? interaction.reply(reuseChoicePayload('custom', recent))
      : customEventModal(interaction);
  }

  if (interaction.customId === 'panel:create_raid_full') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar Raid Avalon Full.', flags: MessageFlags.Ephemeral });
    }
    const recent = eventsRepo.listRecentEventConfigurations(interaction.user.id, 'raid');
    return recent.length
      ? interaction.reply(reuseChoicePayload('raid', recent))
      : raidEventModal(interaction);
  }

  if (interaction.customId === 'panel:create_world_boss') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar World Boss.', flags: MessageFlags.Ephemeral });
    }
    const recent = eventsRepo.listRecentEventConfigurations(interaction.user.id, 'world');
    return recent.length
      ? interaction.reply(reuseChoicePayload('world', recent))
      : worldBossModal(interaction);
  }

  if (interaction.customId === 'panel:registration') {
    return showModal(interaction, 'registration:submit', 'Registro Albion', [
      textInput('albionName', 'Nome do personagem no Albion')
    ]);
  }

  if (interaction.customId === 'panel:member_profile') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return interaction.editReply(await memberProfile.memberProfilePayload(interaction.user.id, interaction.guild));
  }

  if (interaction.customId === 'profile:request_fame_update') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await memberProfile.requestFameUpdate(interaction);
    return interaction.editReply({ content: 'Pedido enviado para a ADM atualizar seus dados Albion na proxima rotina manual.' });
  }

  if (scope === 'member_list') {
    if (!can(interaction.member, 'approveRegistration') && !can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Sem permissao para usar a lista de membros.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'refresh') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await memberList.refreshPanel(interaction);
      return interaction.editReply({ content: 'Lista de membros atualizada.' });
    }

    if (action === 'csv') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return interaction.editReply({
        content: 'HTML da lista de membros gerado. Abra o arquivo e use Baixar CSV se precisar de planilha.',
        files: [await memberList.csvAttachment(interaction.guild)]
      });
    }

    if (action === 'view') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return interaction.editReply({
        embeds: [await memberList.filteredEmbed(interaction.guild, id)]
      });
    }
  }

  if (scope === 'member_panel_staff') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Somente a equipe pode responder membros.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'answer') {
      return showModal(interaction, `member_panel_staff:answer_modal:${id}`, 'Responder membro', [
        textInput('answer', 'Resposta', true, 'Escreva a resposta que sera enviada por DM', TextInputStyle.Paragraph)
      ]);
    }
  }

  if (scope === 'event') {
    const eventId = Number(id);
    const event = eventsRepo.getEvent(eventId);
    if (publicEventActions.has(action) && !isInteractiveEvent(event)) {
      return replyUnavailableEvent(interaction, event);
    }
    if (action === 'details' || action === 'participate') {
      return interaction.reply({
        ...(action === 'participate' ? { content: 'Escolha abaixo como voce quer participar:' } : {}),
        ...events.eventDetailsPayload(eventId, { viewerCanManage: canManageEvent(interaction.member, event), client: interaction.client }),
        flags: MessageFlags.Ephemeral
      });
    }
    if (action === 'manage_players') {
      if (!canManageEvent(interaction.member, event)) {
        return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode gerenciar os jogadores.', flags: MessageFlags.Ephemeral });
      }
      if (!event || event.status !== 'running') {
        return interaction.reply({ content: 'O evento nao esta em andamento.', flags: MessageFlags.Ephemeral });
      }
      if (eventsRepo.getRaidAvalonEventMeta(eventId) || eventsRepo.getWorldBossEventMeta(eventId)) {
        return interaction.reply({ content: 'Este tipo de evento usa um gerenciamento proprio de funcoes.', flags: MessageFlags.Ephemeral });
      }
      const active = eventsRepo.listParticipants(eventId).filter((participant) => (
        !participant.is_spectator && !participant.is_paused
      ));
      if (!active.length) {
        return interaction.reply({ content: 'Nao ha jogadores na composicao ativa.', flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({
        content: 'Selecione um jogador que esta na composicao:',
        components: [new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(`event_manage_player_select:select:${eventId}`)
            .setPlaceholder('Buscar jogador para gerenciar')
            .setMinValues(1)
            .setMaxValues(1)
        )],
        flags: MessageFlags.Ephemeral
      });
    }
    if (['edit', 'edit_info', 'edit_slots', 'edit_custom_details', 'edit_custom_names'].includes(action)) {
      if (!canManageEvent(interaction.member, event)) {
        return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode editar este evento.', flags: MessageFlags.Ephemeral });
      }
      if (event.status !== 'created') {
        return interaction.reply({ content: 'Somente eventos que ainda nao foram iniciados podem ser editados.', flags: MessageFlags.Ephemeral });
      }
      const customMeta = eventsRepo.getCustomEventMeta(eventId);
      const fixedComposition = Boolean(
        eventsRepo.getRaidAvalonEventMeta(eventId)
        || eventsRepo.getWorldBossEventMeta(eventId)
        || eventsRepo.getVisualEventBuildMeta(eventId)
      );
      if (action === 'edit') {
        const buttons = [
          new ButtonBuilder().setCustomId(`event:edit_info:${eventId}:main`).setLabel('Informacoes').setStyle(ButtonStyle.Primary)
        ];
        if (!fixedComposition) {
          buttons.push(new ButtonBuilder().setCustomId(`event:edit_slots:${eventId}:main`).setLabel('Vagas').setStyle(ButtonStyle.Secondary));
        }
        if (customMeta) {
          buttons.push(
            new ButtonBuilder().setCustomId(`event:edit_custom_details:${eventId}:main`).setLabel('Requisitos').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`event:edit_custom_names:${eventId}:main`).setLabel('Armas / funcoes').setStyle(ButtonStyle.Secondary)
          );
        }
        return interaction.reply({
          content: `Editando **${event.title}**. Escolha o que deseja alterar:`,
          components: [new ActionRowBuilder().addComponents(buttons)],
          flags: MessageFlags.Ephemeral
        });
      }
      if (action === 'edit_info') {
        const raidMeta = eventsRepo.getRaidAvalonEventMeta(eventId);
        const inputs = [
          editTextInput('title', 'Titulo', event.title, { maxLength: 80 }),
          editTextInput('location', raidMeta ? 'We mass from' : 'Local', event.location, { required: Boolean(customMeta), maxLength: 100 }),
          editTextInput(
            'description',
            raidMeta ? 'Observacao' : 'Build ou descricao',
            raidMeta ? events.raidObservationText(event.description) : event.description,
            { required: false, style: TextInputStyle.Paragraph, maxLength: 500 }
          )
        ];
        inputs.splice(2, 0, editTextInput('scheduledTime', 'Data e hora (UTC)', event.scheduled_time, { required: Boolean(customMeta), maxLength: 80 }));
        return showModal(interaction, `event:edit_info_modal:${eventId}`, 'Editar informacoes do evento', inputs);
      }
      if (action === 'edit_slots') {
        return showModal(interaction, `event:edit_slots_modal:${eventId}`, 'Editar vagas do evento', [
          editTextInput(
            'slots',
            'Tank, Healer, Suporte, DPS',
            `${event.tank_slots},${event.healer_slots},${event.support_slots},${event.dps_slots}`,
            { maxLength: 40 }
          )
        ]);
      }
      if (action === 'edit_custom_details') {
        if (!customMeta) throw new Error('Este nao e um CTA.');
        return showModal(interaction, `event:edit_custom_details_modal:${eventId}`, 'Editar requisitos do CTA', [
          editTextInput('lootRules', 'Loot', customMeta.loot_rules, { required: false, style: TextInputStyle.Paragraph, maxLength: 1000 }),
          editTextInput('consumables', 'Consumiveis', customMeta.consumables, { required: false, style: TextInputStyle.Paragraph, maxLength: 1000 }),
          editTextInput('mountRequirement', 'Montaria', customMeta.mount_requirement, { required: false, maxLength: 200 })
        ]);
      }
      if (!customMeta) throw new Error('Este nao e um CTA.');
      const slotLabels = new Map(eventsRepo.listCustomEventSlots(eventId).map((slot) => [
        `${slot.role}:${slot.slot_index}`,
        slot.slot_label || ''
      ]));
      const labelsFor = (role, count) => Array.from({ length: Number(count || 0) }, (_, index) => (
        slotLabels.get(`${role}:${index + 1}`) || ''
      )).join(' | ');
      return showModal(interaction, `event:edit_custom_names_modal:${eventId}`, 'Editar armas e funcoes', [
        editTextInput('tank', `Tank (${event.tank_slots})`, labelsFor('tank', event.tank_slots), { required: false, style: TextInputStyle.Paragraph }),
        editTextInput('healer', `Healer (${event.healer_slots})`, labelsFor('healer', event.healer_slots), { required: false, style: TextInputStyle.Paragraph }),
        editTextInput('support', `Suporte (${event.support_slots})`, labelsFor('support', event.support_slots), { required: false, style: TextInputStyle.Paragraph }),
        editTextInput('dps', `DPS (${event.dps_slots})`, labelsFor('dps', event.dps_slots), { required: false, style: TextInputStyle.Paragraph })
      ]);
    }
    if (action === 'raid_slot') {
      const select = raidWeaponSlotSelect(eventId, interaction.user.id);
      if (!select) {
        return interaction.reply({ content: 'Nao ha vagas livres nesta raid.', flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({
        content: 'Escolha sua vaga/arma:',
        components: [select],
        flags: MessageFlags.Ephemeral
      });
    }
    if (action === 'wb_slot') {
      const options = events.worldBossSlotOptions(eventId, interaction.user.id);
      if (options.length === 0) {
        return interaction.reply({ content: 'Todas as vagas do World Boss estao ocupadas.', flags: MessageFlags.Ephemeral });
      }
      const select = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`event_world_boss_slot:slot:${eventId}`)
          .setPlaceholder('Escolha sua funcao ou scout')
          .addOptions(options)
      );
      return interaction.reply({
        content: 'Escolha uma vaga. Se voce ja estiver inscrito, a vaga anterior sera liberada:',
        components: [select],
        flags: MessageFlags.Ephemeral
      });
    }
    if (action === 'wb_manage') {
      const options = events.worldBossMemberSlotOptions(eventId, interaction.user.id);
      if (options.length === 0) {
        return interaction.reply({ content: 'Voce nao possui vagas neste World Boss.', flags: MessageFlags.Ephemeral });
      }
      const select = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`event_world_boss_slot:remove:${eventId}`)
          .setPlaceholder('Escolha a vaga que deseja liberar')
          .addOptions(options)
      );
      return interaction.reply({
        content: 'Selecione somente a vaga que deseja liberar:',
        components: [select],
        flags: MessageFlags.Ephemeral
      });
    }
    if (action === 'wb_confirm') {
      const slot = await events.joinWorldBossSlot(interaction, eventId, extra);
      return interaction.update({ content: `Funcao confirmada: **${slot.label}**.`, components: [] });
    }
    if (action === 'wb_abort') {
      return interaction.update({ content: 'Escolha de funcao cancelada.', components: [] });
    }
    if (action === 'wb_leave') {
      await events.leaveWorldBoss(interaction, eventId);
      return interaction.reply({ content: 'Voce saiu da composicao do World Boss.', flags: MessageFlags.Ephemeral });
    }
    if (action === 'raid_role') {
      const role = extra;
      const select = raidWeaponSelect(eventId, role, interaction.user.id);
      if (!select) {
        return interaction.reply({ content: `Nao ha vagas livres para ${roleLabel(role)}.`, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({
        content: 'Clique na arma para ver e selecionar sua build:',
        components: [select],
        flags: MessageFlags.Ephemeral
      });
    }
    if (action === 'raid_helper') {
      const helperName = await events.joinRaidAvalonHelper(interaction, eventId, extra);
      return interaction.reply({ content: `Voce entrou como ${helperName}.`, flags: MessageFlags.Ephemeral });
    }
    if (action === 'change_role') {
      const select = eventRoleChangeSelect(event, interaction.user.id);
      if (!select) {
        return interaction.reply({ content: 'Nao ha funcoes disponiveis para trocar neste evento.', flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({
        content: 'Escolha sua nova funcao:',
        components: [select],
        flags: MessageFlags.Ephemeral
      });
    }
    if (action === 'join_role') {
      const role = extra;
      const visualMeta = eventsRepo.getVisualEventBuildMeta(eventId);
      if (visualMeta && weaponSelectionModes.requiresWeapon(visualMeta.composition_mode)) {
        const options = events.visualWeaponFamilies(eventId, role, interaction.client, interaction.guild);
        if (!options.length) {
          return interaction.reply({ content: `Não há armas disponíveis para ${roleLabel(role)}.`, flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
          content: `Escolha a **família** da arma que você usará como ${roleLabel(role)}:`,
          components: [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`event_weapon_family:select:${eventId}:${role}`)
              .setPlaceholder('Escolha a família da arma')
              .addOptions(options)
          )],
          flags: MessageFlags.Ephemeral
        });
      }
      if (visualMeta && weaponSelectionModes.normalize(visualMeta.composition_mode) === 'role_free') {
        await events.joinEvent(interaction, eventId, role);
        return interaction.reply({ content: `Você entrou como ${roleLabel(role)} sem precisar informar arma.`, flags: MessageFlags.Ephemeral });
      }
      const customMeta = eventsRepo.getCustomEventMeta(eventId);
      if (customMeta?.dps_policy === 'role_free' && role === 'dps') {
        await events.joinEvent(interaction, eventId, role);
        return interaction.reply({ content: 'Você entrou como DPS sem precisar informar arma.', flags: MessageFlags.Ephemeral });
      }
      if (eventsRepo.getCustomEventMeta(eventId) || eventsRepo.getVisualEventBuildMeta(eventId)) {
        const options = events.customEventSlotOptions(eventId, role, interaction.user.id);
        const choosingDpsWeapon = role === 'dps' && eventsRepo.listCustomEventDpsWeapons(eventId).length > 0;
        if (options.length === 0) {
          return interaction.reply({ content: `Nao ha vagas livres para ${roleLabel(role)}.`, flags: MessageFlags.Ephemeral });
        }
        const selects = [];
        for (let start = 0; start < options.length; start += 25) {
          const page = Math.floor(start / 25) + 1;
          const pageOptions = options.slice(start, start + 25);
          const pageSuffix = options.length > 25 ? ` (${page}/${Math.ceil(options.length / 25)})` : '';
          selects.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`event_custom_slot:join:${eventId}:${page}`)
              .setPlaceholder(choosingDpsWeapon ? `Escolha sua arma de DPS${pageSuffix}` : `Escolha uma vaga de ${roleLabel(role)}${pageSuffix}`)
              .addOptions(pageOptions)
          ));
        }
        return interaction.reply({
          content: choosingDpsWeapon
            ? 'Qual arma você vai usar? As escolhas já ocupadas aparecem com a quantidade restante.'
            : `Escolha exatamente qual vaga de **${roleLabel(role)}** voce quer:`,
          components: selects,
          flags: MessageFlags.Ephemeral
        });
      }
      try {
        await events.joinEvent(interaction, eventId, role);
      } catch (error) {
        if (String(error.message || '').includes('Nao ha vaga')) {
          return interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
        }
        throw error;
      }
      const confirmation = `Voce entrou como ${roleLabel(role)}.`;
      if (isEphemeralInteractionMessage(interaction)) {
        return interaction.update({
          content: confirmation,
          ...events.eventDetailsPayload(eventId, { viewerCanManage: canManageEvent(interaction.member, event), client: interaction.client })
        });
      }
      return interaction.reply({ content: confirmation, flags: MessageFlags.Ephemeral });
    }
    if (action === 'auto_join') {
      const acknowledged = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      if (!acknowledged) return null;
      let role;
      try {
        role = await events.autoJoinRunningEvent(interaction, eventId);
      } catch (error) {
        if (error.message.includes('Nao ha vagas livres')) {
          return safeEditReply(interaction, { content: 'Nao ha vagas livres neste evento. Use Assistir se quiser acompanhar.' });
        }
        throw error;
      }
      const updated = eventsRepo.getEvent(eventId);
      const voiceText = updated?.voice_channel_id ? ` Sala: <#${updated.voice_channel_id}>.` : '';
      const moveText = interaction.member?.voice?.channel ? ' Estou te movendo para a sala.' : ' Entre em uma call primeiro ou clique na sala do evento.';
      return safeEditReply(interaction, { content: `Voce entrou como ${roleLabel(role)}.${moveText}${voiceText}` });
    }
    if (action === 'spectate') {
      const acknowledged = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      if (!acknowledged) return null;
      await events.spectateEvent(interaction, eventId);
      const updated = eventsRepo.getEvent(eventId);
      const voiceText = updated?.voice_channel_id ? ` Sala: <#${updated.voice_channel_id}>.` : '';
      const moveText = interaction.member?.voice?.channel ? ' Estou te movendo para a sala.' : ' Entre em uma call primeiro ou clique na sala do evento.';
      return safeEditReply(interaction, { content: `Voce entrou como espectador. Seu tempo nao sera contado.${moveText}${voiceText}` });
    }
    if (action === 'pause') {
      const acknowledged = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      if (!acknowledged) return null;
      await events.pauseParticipation(interaction, eventId);
      return safeEditReply(interaction, { content: 'Sua participacao foi pausada. Seu tempo parou de contar.' });
    }
    if (!canManageEvent(interaction.member, event)) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode gerenciar este evento.', flags: MessageFlags.Ephemeral });
    }
    if (action === 'start') {
      if (event.creator_id !== interaction.user.id) {
        if (!canForceStartFinish(interaction.member)) {
          return interaction.reply({ content: 'Somente o criador do evento pode iniciar. Staff/ADM podem iniciar com confirmacao.', flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
          content: 'Voce esta ciente que esse evento nao foi criado por voce e que vai iniciar o evento do criador, neh?',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`event:confirm_start:${eventId}:${interaction.user.id}`).setLabel('Sim, iniciar').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`event:abort_start:${eventId}:${interaction.user.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }
      const acknowledged = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      if (!acknowledged) return null;
      const voice = await events.startEvent(interaction, eventId);
      return safeEditReply(interaction, { content: `Evento iniciado. Sala criada: ${voice.name}.` });
    }
    if (action === 'confirm_start') {
      if (extra !== interaction.user.id) {
        return interaction.reply({ content: 'Essa confirmacao nao foi criada para voce.', flags: MessageFlags.Ephemeral });
      }
      if (!canForceStartFinish(interaction.member)) {
        return interaction.reply({ content: 'Somente Staff/ADM podem confirmar inicio de evento de outro criador.', flags: MessageFlags.Ephemeral });
      }
      const acknowledged = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      if (!acknowledged) return null;
      const voice = await events.startEvent(interaction, eventId);
      return safeEditReply(interaction, { content: `Evento iniciado. Sala criada: ${voice.name}.` });
    }
    if (action === 'abort_start') {
      return interaction.reply({ content: 'Inicio cancelado.', flags: MessageFlags.Ephemeral });
    }
    if (action === 'finish') {
      if (event.creator_id !== interaction.user.id) {
        if (!canForceStartFinish(interaction.member)) {
          return interaction.reply({ content: 'Somente o criador do evento pode finalizar. Staff/ADM podem finalizar com confirmacao.', flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
          content: 'Voce esta ciente que esse evento nao foi criado por voce e que vai interromper o evento do criador, neh?',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`event:confirm_finish:${eventId}:${interaction.user.id}`).setLabel('Sim, finalizar').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`event:abort_finish:${eventId}:${interaction.user.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }
      return showLootModal(interaction, eventId);
    }
    if (action === 'confirm_finish') {
      if (extra !== interaction.user.id) {
        return interaction.reply({ content: 'Essa confirmacao nao foi criada para voce.', flags: MessageFlags.Ephemeral });
      }
      if (!canForceStartFinish(interaction.member)) {
        return interaction.reply({ content: 'Somente Staff/ADM podem confirmar finalizacao de evento de outro criador.', flags: MessageFlags.Ephemeral });
      }
      return showLootModal(interaction, eventId);
    }
    if (action === 'abort_finish') {
      return interaction.reply({ content: 'Finalizacao cancelada.', flags: MessageFlags.Ephemeral });
    }
    if (action === 'confirm_cancel') {
      if (extra !== interaction.user.id) {
        return interaction.reply({ content: 'Essa confirmacao nao foi criada para voce.', flags: MessageFlags.Ephemeral });
      }
      if (!canForceStartFinish(interaction.member)) {
        return interaction.reply({ content: 'Somente Staff/ADM podem confirmar cancelamento de evento de outro criador.', flags: MessageFlags.Ephemeral });
      }
      return showModal(interaction, `event:cancel_modal:${eventId}`, 'Cancelar Evento', [
        textInput('reason', 'Motivo do cancelamento')
      ]);
    }
    if (action === 'abort_cancel') {
      return interaction.reply({ content: 'Cancelamento abortado.', flags: MessageFlags.Ephemeral });
    }
    if (action === 'approve') {
      if (!can(interaction.member, 'approvePayment')) {
        return interaction.reply({ content: 'Voce nao tem permissao para aprovar pagamento.', flags: MessageFlags.Ephemeral });
      }
      if (interaction.message?.id) {
        eventsRepo.updateReviewMetadata(eventId, { finance_message_id: interaction.message.id });
      }
      const current = eventsRepo.getEvent(eventId);
      if (!current || current.status !== 'pending_payment') {
        await interaction.message.edit({ components: [] }).catch(() => {});
        return interaction.reply({ content: 'Este evento nao esta pendente de pagamento. O botao foi removido.', flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const paymentResult = events.approveEventPayment({ eventId, actorId: interaction.user.id });
      await events.syncEventWorkflowMessages(interaction.client, eventId);
      const transactions = Array.isArray(paymentResult) ? paymentResult : (paymentResult.transactions || []);
      const raidRewards = await events.grantRaidAvalonRewards({ guild: interaction.guild, eventId, actorId: interaction.user.id });
      if (transactions.length > 0) {
        await finance.notifyBalanceTransactions({ client: interaction.client, transactions });
      }

      let campaignText = '';
      if (paymentResult.campaignChoices?.decisions?.length) {
        const dmResult = await campaigns.sendEventPayoutDms({
          client: interaction.client,
          eventId,
          choices: paymentResult.campaignChoices
        });
        await campaigns.refreshActiveCampaignProgress(interaction.client);
        campaignText = ` Campanha @${paymentResult.campaignChoices.campaign.role_name || '900m'}: ${dmResult.sent} DM(s) enviada(s), ${dmResult.failed} falha(s). Quem nao responder em 24h recebe no saldo normal.`;
      }

      await interaction.message.edit({
        content: `Evento #${eventId} finalizado por <@${interaction.user.id}>.${campaignText}`,
        embeds: [events.reviewEmbed(eventId)],
        components: []
      }).catch(() => {});
      await events.scheduleReviewChannelDeletion(interaction.client, eventId, 14);
      await balanceBackup.postEventBalanceBackup(interaction.client, eventId);
      const raidText = raidRewards.granted || raidRewards.points
        ? ` Carreira: ${raidRewards.points} ponto(s) registrado(s), ${raidRewards.granted} tag(s) nova(s).`
        : '';
      const paymentText = paymentResult.campaignChoices?.decisions?.length
        ? `Pagamento aprovado. O bot perguntou por DM se cada membro quer doar sua parte para @${paymentResult.campaignChoices.campaign.role_name || '900m'}.${campaignText}`
        : 'Pagamento aprovado e saldos depositados.';
      return interaction.editReply({ content: `${paymentText}${raidText}` });
    }
    if (action === 'return_review') {
      if (!can(interaction.member, 'approvePayment')) {
        return interaction.reply({ content: 'Voce nao tem permissao para devolver evento.', flags: MessageFlags.Ephemeral });
      }
      if (interaction.message?.id) {
        eventsRepo.updateReviewMetadata(eventId, { finance_message_id: interaction.message.id });
      }
      const current = eventsRepo.getEvent(eventId);
      if (!current || current.status !== 'pending_payment') {
        await interaction.message.edit({ components: [] }).catch(() => {});
        return interaction.reply({ content: 'Este evento nao esta pendente de pagamento. O botao foi removido.', flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reviewChannel = await events.returnEventToReview({ client: interaction.client, eventId, actorId: interaction.user.id });
      await interaction.message.edit({
        content: `Evento #${eventId} devolvido para revisao por <@${interaction.user.id}>.${reviewChannel ? ` Revisao: <#${reviewChannel.id}>` : ''}`,
        embeds: [events.reviewEmbed(eventId)],
        components: []
      }).catch(() => {});
      return interaction.editReply({ content: `Evento devolvido para o criador revisar.${reviewChannel ? ` Canal: <#${reviewChannel.id}>` : ''}` });
    }
    if (action === 'cancel') {
      if (event.creator_id !== interaction.user.id) {
        if (!canForceStartFinish(interaction.member)) {
          return interaction.reply({ content: 'Somente o criador do evento pode cancelar. Staff/ADM podem cancelar com confirmacao.', flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
          content: 'Voce esta ciente que esse evento nao foi criado por voce e que vai cancelar o evento do criador, neh?',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`event:confirm_cancel:${eventId}:${interaction.user.id}`).setLabel('Sim, cancelar').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`event:abort_cancel:${eventId}:${interaction.user.id}`).setLabel('Voltar').setStyle(ButtonStyle.Secondary)
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }
      return showModal(interaction, `event:cancel_modal:${eventId}`, 'Cancelar Evento', [
        textInput('reason', 'Motivo do cancelamento')
      ]);
    }
  }

  if (scope === 'deposit') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para deposito.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'create') {
      return showModal(interaction, 'deposit:create_modal', 'Criar deposito rapido', [
        textInput('lootTotal', 'Valor total', true, 'Ex: 50m'),
        textInput('repair', 'Reparo', true, 'Ex: 2m ou 0'),
        textInput('silverBags', 'Sacos de prata', true, 'Ex: 500k ou 0'),
        textInput('taxPercent', 'Taxa %', true, 'Ex: 10')
      ]);
    }

    if (action === 'create_list') {
      return showModal(interaction, 'deposit:create_list_modal', 'Deposito por lista', [
        textInput('totalAmount', 'Valor total liquido', true, 'Ex: 48m'),
        textInput('reason', 'Motivo', false, 'Ex: Split DPS meter / ajuste de evento'),
        textInput('names', 'Lista de nomes', true, 'Cole a lista do DPS meter ou um nome por linha', TextInputStyle.Paragraph)
      ]);
    }

    if (action === 'confirm') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await deposit.confirmDraft({ draftId: id, actorId: interaction.user.id, client: interaction.client });
      await clearSourceMessage(interaction, 'Deposito aplicado.');
      return interaction.editReply({
        content: `Deposito aplicado nos saldos. ${result.participants.length} membro(s) receberam ${formatSilver(result.amount)}.`
      });
    }

    if (action === 'list_confirm') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await deposit.confirmListDraft({ draftId: id, actorId: interaction.user.id, client: interaction.client });
      await clearSourceMessage(interaction, 'Deposito por lista aplicado.');
      return interaction.editReply({
        content: `Deposito por lista aplicado. ${result.participants.length} membro(s) receberam ${formatSilver(result.amount)}. Sobra: ${formatSilver(result.remainder)}.`
      });
    }

    if (action === 'list_cancel') {
      deposit.cancelDraft(id);
      await clearSourceMessage(interaction, 'Deposito por lista cancelado.');
      return interaction.reply({ content: 'Deposito por lista cancelado.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'cancel') {
      deposit.cancelDraft(id);
      await clearSourceMessage(interaction, 'Deposito cancelado.');
      return interaction.reply({ content: 'Deposito cancelado.', flags: MessageFlags.Ephemeral });
    }
  }

  if (scope === 'event_review') {
    const eventId = Number(id);
    const event = eventsRepo.getEvent(eventId);
    if (!canManageEvent(interaction.member, event)) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode editar a revisao.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'recalculate') {
      if (event.status !== 'review') {
        return interaction.reply({ content: 'Esse evento nao esta mais em revisao.', flags: MessageFlags.Ephemeral });
      }
      const review = eventsRepo.getReview(eventId);
      if (!review) {
        return interaction.reply({ content: 'A revisao de loot desse evento nao foi encontrada.', flags: MessageFlags.Ephemeral });
      }
      return showModal(interaction, `event_review:recalculate_modal:${eventId}:${interaction.message.id}`, 'Refazer calculo do loot', [
        editTextInput('lootTotal', 'Loot total', String(review.loot_total), { maxLength: 30 }),
        editTextInput('repair', 'Reparo', String(review.repair), { maxLength: 30 }),
        editTextInput('silverBags', 'Sacos de prata', String(review.silver_bags), { maxLength: 30 }),
        editTextInput('taxPercent', 'Taxa em porcentagem', String(review.tax_percent), { maxLength: 3 }),
        editTextInput('evidenceNotes', 'Evidencias / observacao', review.evidence_notes || '', {
          required: false,
          style: TextInputStyle.Paragraph,
          maxLength: 1000
        })
      ]);
    }

    if (action === 'edit') {
      return interaction.reply({
        content: 'Escolha o membro que deseja editar usando a busca do Discord:',
        components: [reviewUserSelect(eventId, interaction.message.id, 'edit', 'Buscar membro para editar')],
        flags: MessageFlags.Ephemeral
      });
    }

    if (action === 'add') {
      return interaction.reply({
        content: 'Escolha o membro que deseja adicionar usando a busca do Discord:',
        components: [reviewUserSelect(eventId, interaction.message.id, 'add', 'Buscar membro para adicionar')],
        flags: MessageFlags.Ephemeral
      });
    }

    if (action === 'remove') {
      return interaction.reply({
        content: 'Escolha o membro que deseja remover usando a busca do Discord:',
        components: [reviewUserSelect(eventId, interaction.message.id, 'remove', 'Buscar membro para remover')],
        flags: MessageFlags.Ephemeral
      });
    }

    if (action === 'submit') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (interaction.message?.id) {
        eventsRepo.updateReviewMetadata(eventId, { review_message_id: interaction.message.id });
      }
      events.submitEventToFinance({ eventId, actorId: interaction.user.id });
      const reviewChannel = await events.moveReviewChannelToClosed(interaction.client, eventId);
      await events.postDpsMeterSummary(interaction.client, eventId);
      const financeMessage = await safeSend(interaction.client, ids.channels.finance, {
        content: `Evento #${eventId} enviado para aprovacao financeira.${reviewChannel ? ` Revisao: <#${reviewChannel.id}>` : ''}`,
        embeds: [events.reviewEmbed(eventId)],
        components: events.reviewComponents(eventId, 'finance')
      });
      if (financeMessage?.id) {
        eventsRepo.updateReviewMetadata(eventId, { finance_message_id: financeMessage.id });
      }
      await interaction.message.edit({
        content: `Evento #${eventId} enviado para aprovacao financeira.${reviewChannel ? ` Canal movido para finalizados: <#${reviewChannel.id}>` : ''}`,
        embeds: [events.reviewEmbed(eventId)],
        components: []
      });
      await events.syncEventWorkflowMessages(interaction.client, eventId);
      return interaction.editReply({ content: 'Evento enviado ao financeiro para aprovacao.' });
    }
  }

  if (scope === 'balance_reversal') {
    if (!can(interaction.member, 'withdrawBalance')) {
      return interaction.reply({ content: 'Sem permissao para criar estorno.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'create') {
      return showModal(interaction, 'balance_reversal:create_modal', 'Estorno de pagamento por lista', [
        textInput('percentage', 'Porcentagem a retirar', true, 'Ex: 50'),
        textInput('reason', 'Motivo', true, 'Ex: split feito como 30m; correto era 15m'),
        textInput('confirmation', 'Digite CONFIRMAR', true, 'CONFIRMAR'),
        textInput('list', 'Lista original com valores', true, 'Cole nome | funcao | tempo | valor', TextInputStyle.Paragraph)
      ]);
    }

    if (action === 'confirm') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await balanceReversal.confirmDraft({
        draftId: id,
        actorId: interaction.user.id,
        client: interaction.client
      });
      await clearSourceMessage(interaction, 'Estorno por lista aplicado.');
      return interaction.editReply({
        content: `Estorno aplicado: -${formatSilver(result.total)} em ${result.participants.length} saldo(s), correspondente a ${result.percentage}% dos valores informados.`
      });
    }

    if (action === 'cancel') {
      balanceReversal.cancelDraft(id);
      await clearSourceMessage(interaction, 'Estorno por lista cancelado.');
      return interaction.reply({ content: 'Estorno cancelado. Nenhum saldo foi alterado.', flags: MessageFlags.Ephemeral });
    }
  }

  if (interaction.customId === 'finance:balance') {
    const balance = financeRepo.getBalance(interaction.user.id);
    return interaction.reply({ content: `Seu saldo: ${formatSilver(balance)} prata.`, flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'finance:withdraw') {
    return showModal(interaction, 'finance:withdraw_modal', 'Solicitar Saque', [
      textInput('amount', 'Valor em numeros', true, 'Ex: 1000000 sem ponto, virgula ou letra'),
      textInput('note', 'Observacao', false)
    ]);
  }

  if (interaction.customId === 'finance:payment_request') {
    return showModal(interaction, 'finance:payment_request_modal', 'Pedir Pagamento', [
      textInput('amount', 'Valor pedido', true, 'Ex: 12m ou 12000000'),
      textInput('service', 'O que voce fez?', true, 'Ex: vendi loot da guild'),
      textInput('description', 'Motivo / descricao', true, 'Explique o servico, item, combinado ou venda', TextInputStyle.Paragraph),
      textInput('evidence', 'Print/link/prova', false, 'Ex: https://prnt.sc/... ou "sem print"')
    ]);
  }

  if (scope === 'finance' && action === 'confirm_withdraw') {
    const draft = finance.takeWithdrawDraft(id);
    if (!draft) {
      return interaction.update({ content: 'Essa confirmacao expirou. Abra o saque novamente.', components: [] });
    }
    if (draft.userId !== interaction.user.id) {
      return interaction.reply({ content: 'Essa confirmacao de saque nao foi criada para voce.', flags: MessageFlags.Ephemeral });
    }
    const currentBalance = financeRepo.getBalance(interaction.user.id);
    const negativeWarning = draft.amount > currentBalance
      ? `ATENCAO: saldo atual ${formatSilver(currentBalance)}. Se pagar este saque, o membro ficara com ${formatSilver(currentBalance - draft.amount)}.`
      : '';
    const request = finance.requestWithdraw({ userId: interaction.user.id, amount: draft.amount, note: draft.note });
    audit.createAuditLog({
      type: 'withdraw_requested',
      actorId: interaction.user.id,
      targetId: interaction.user.id,
      afterValue: draft.amount,
      reason: draft.note
    });
    const staffMessage = await safeSend(interaction.client, ids.channels.finance, {
      content: withdrawRequestContent({
        id: request.lastInsertRowid,
        user_id: interaction.user.id,
        amount: draft.amount,
        note: draft.note,
        status: 'requested'
      }, { warning: negativeWarning }),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`finance:pay_withdraw:${request.lastInsertRowid}`).setLabel('Pagar saque').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`finance:refuse_withdraw:${request.lastInsertRowid}`).setLabel('Recusar saque').setStyle(ButtonStyle.Danger)
        )
      ]
    });
    if (staffMessage) {
      financeRepo.setWithdrawStaffMessage({
        id: Number(request.lastInsertRowid),
        channelId: staffMessage.channelId || staffMessage.channel?.id || ids.channels.finance,
        messageId: staffMessage.id
      });
    }
    return interaction.update({ content: `Saque solicitado para a staff: ${formatSilver(draft.amount)}.`, components: [] });
  }

  if (scope === 'finance' && action === 'cancel_withdraw') {
    finance.takeWithdrawDraft(id);
    return interaction.update({ content: 'Solicitacao de saque cancelada. Nada foi enviado para a staff.', components: [] });
  }

  if (scope === 'finance' && action === 'confirm_payment_request') {
    const draft = finance.takePaymentRequestDraft(id);
    if (!draft) {
      return interaction.update({ content: 'Essa confirmacao expirou. Abra o pedido novamente.', components: [] });
    }
    if (draft.userId !== interaction.user.id) {
      return interaction.reply({ content: 'Essa confirmacao de pedido nao foi criada para voce.', flags: MessageFlags.Ephemeral });
    }
    const request = finance.requestPayment({
      userId: interaction.user.id,
      amount: draft.amount,
      service: draft.service,
      description: draft.description,
      evidence: draft.evidence
    });
    const requestId = request.lastInsertRowid;
    audit.createAuditLog({
      type: 'payment_request_created',
      actorId: interaction.user.id,
      targetId: interaction.user.id,
      afterValue: draft.amount,
      reason: draft.service,
      metadata: {
        description: draft.description,
        evidence: draft.evidence
      }
    });
    await safeSend(interaction.client, ids.channels.finance, {
      content: paymentRequestContent({
        id: requestId,
        user_id: interaction.user.id,
        amount: draft.amount,
        service: draft.service,
        description: draft.description,
        evidence: draft.evidence,
        status: 'requested'
      }),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`finance:approve_payment_request:${requestId}`).setLabel('Aprovar e depositar').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`finance:refuse_payment_request:${requestId}`).setLabel('Recusar').setStyle(ButtonStyle.Danger)
        )
      ]
    });
    return interaction.update({ content: `Pedido de pagamento enviado para a staff: ${formatSilver(draft.amount)}.`, components: [] });
  }

  if (scope === 'finance' && action === 'cancel_payment_request') {
    finance.takePaymentRequestDraft(id);
    return interaction.update({ content: 'Pedido de pagamento cancelado. Nada foi enviado para a staff.', components: [] });
  }

  if (scope === 'finance' && action === 'approve_payment_request') {
    if (!can(interaction.member, 'approvePayment')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    const request = financeRepo.getPaymentRequest(Number(id));
    if (!request) return interaction.reply({ content: 'Pedido de pagamento nao encontrado.', flags: MessageFlags.Ephemeral });
    if (request.status === 'approved') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Esse pedido ja foi aprovado. Removi os botoes antigos.', flags: MessageFlags.Ephemeral });
    }
    if (request.status === 'refused') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Esse pedido ja foi recusado. Removi os botoes antigos.', flags: MessageFlags.Ephemeral });
    }
    if (request.status !== 'requested') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: `Esse pedido nao esta pendente. Status atual: ${request.status}.`, flags: MessageFlags.Ephemeral });
    }
    const transaction = finance.approvePaymentRequest({ requestId: Number(id), actorId: interaction.user.id });
    await finance.notifyBalanceTransactions({ client: interaction.client, transactions: [transaction] });
    const approvedRequest = financeRepo.getPaymentRequest(Number(id)) || { ...request, status: 'approved', reviewed_by: interaction.user.id };
    await interaction.message.edit({
      content: paymentRequestContent(approvedRequest, { status: 'approved', reviewedBy: interaction.user.id }),
      components: []
    }).catch(() => {});
    await safeSend(interaction.client, ids.channels.bankLogs, {
      content: `Pedido de pagamento #${id} aprovado por <@${interaction.user.id}>: ${formatSilver(request.amount)} para <@${request.user_id}>. Servico: ${request.service}`
    });
    return interaction.reply({ content: 'Pedido aprovado e saldo depositado.', flags: MessageFlags.Ephemeral });
  }

  if (scope === 'finance' && action === 'refuse_payment_request') {
    if (!can(interaction.member, 'approvePayment')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    const request = financeRepo.getPaymentRequest(Number(id));
    if (!request) return interaction.reply({ content: 'Pedido de pagamento nao encontrado.', flags: MessageFlags.Ephemeral });
    if (request.status === 'approved') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Esse pedido ja foi aprovado. Nao da para recusar depois do deposito.', flags: MessageFlags.Ephemeral });
    }
    if (request.status === 'refused') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Esse pedido ja foi recusado. Removi os botoes antigos.', flags: MessageFlags.Ephemeral });
    }
    if (request.status !== 'requested') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: `Esse pedido nao pode mais ser recusado. Status atual: ${request.status}.`, flags: MessageFlags.Ephemeral });
    }
    finance.refusePaymentRequest({ requestId: Number(id), actorId: interaction.user.id });
    const refusedRequest = financeRepo.getPaymentRequest(Number(id)) || { ...request, status: 'refused', reviewed_by: interaction.user.id };
    await interaction.message.edit({
      content: paymentRequestContent(refusedRequest, { status: 'refused', reviewedBy: interaction.user.id }),
      components: []
    }).catch(() => {});
    const user = await interaction.client.users.fetch(request.user_id).catch(() => null);
    await user?.send(`Seu pedido de pagamento #${id} no valor de ${formatSilver(request.amount)} foi recusado pela staff. Servico: ${request.service}`).catch(() => {});
    return interaction.reply({ content: 'Pedido recusado. Nenhum saldo foi alterado.', flags: MessageFlags.Ephemeral });
  }

  if (scope === 'finance' && ['approve_withdraw', 'refuse_withdraw', 'pay_withdraw'].includes(action) && interaction.message?.id) {
    financeRepo.setWithdrawStaffMessage({
      id: Number(id),
      channelId: interaction.channelId,
      messageId: interaction.message.id
    });
  }

  if (scope === 'finance' && action === 'approve_withdraw') {
    if (!can(interaction.member, 'approvePayment')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    const request = financeRepo.getWithdrawRequest(Number(id));
    if (!request) return interaction.reply({ content: 'Solicitacao de saque nao encontrada.', flags: MessageFlags.Ephemeral });
    if (request.status === 'approved') {
      return interaction.reply({ content: 'Esse saque ja esta aprovado. Use Pagar saque quando o pagamento for feito.', flags: MessageFlags.Ephemeral });
    }
    if (request.status === 'paid') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Esse saque ja foi pago. Removi os botoes antigos.', flags: MessageFlags.Ephemeral });
    }
    if (request.status !== 'requested') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: `Esse saque nao esta mais solicitando aprovacao. Status atual: ${request.status}.`, flags: MessageFlags.Ephemeral });
    }
    finance.approveWithdraw({ requestId: Number(id), actorId: interaction.user.id });
    const approvedRequest = financeRepo.getWithdrawRequest(Number(id)) || { ...request, status: 'approved', reviewed_by: interaction.user.id };
    await interaction.message.edit({
      content: withdrawRequestContent(approvedRequest, { approvedBy: interaction.user.id }),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`finance:pay_withdraw:${id}`).setLabel('Pagar saque').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`finance:refuse_withdraw:${id}`).setLabel('Recusar saque').setStyle(ButtonStyle.Danger)
        )
      ]
    }).catch(() => {});
    return interaction.reply({ content: 'Saque aprovado. O saldo ainda nao foi descontado; use Pagar saque quando pagar.', flags: MessageFlags.Ephemeral });
  }

  if (scope === 'finance' && action === 'refuse_withdraw') {
    if (!can(interaction.member, 'approvePayment')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    const request = financeRepo.getWithdrawRequest(Number(id));
    if (!request) return interaction.reply({ content: 'Solicitacao de saque nao encontrada.', flags: MessageFlags.Ephemeral });
    if (request.status === 'paid') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Esse saque ja foi pago. Nao da para recusar depois do pagamento.', flags: MessageFlags.Ephemeral });
    }
    if (request.status === 'refused') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Esse saque ja foi recusado. Removi os botoes antigos.', flags: MessageFlags.Ephemeral });
    }
    if (!['requested', 'approved'].includes(request.status)) {
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: `Esse saque nao pode mais ser recusado. Status atual: ${request.status}.`, flags: MessageFlags.Ephemeral });
    }
    finance.refuseWithdraw({ requestId: Number(id), actorId: interaction.user.id });
    const refusedRequest = financeRepo.getWithdrawRequest(Number(id)) || { ...request, status: 'refused', reviewed_by: interaction.user.id };
    await interaction.message.edit({ content: withdrawRequestContent(refusedRequest, { status: 'refused', refusedBy: interaction.user.id }), components: [] }).catch(() => {});
    return interaction.reply({ content: 'Saque recusado. Nenhum saldo foi alterado.', flags: MessageFlags.Ephemeral });
  }

  if (scope === 'finance' && action === 'pay_withdraw') {
    if (!can(interaction.member, 'approvePayment')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    const transaction = finance.payWithdraw({ requestId: Number(id), actorId: interaction.user.id });
    await finance.notifyBalanceTransactions({ client: interaction.client, transactions: [transaction] });
    const paidRequest = financeRepo.getWithdrawRequest(Number(id)) || {
      id: Number(id),
      user_id: transaction.userId,
      amount: Math.abs(transaction.amount),
      status: 'paid',
      paid_by: interaction.user.id
    };
    await interaction.message.edit({ content: withdrawRequestContent(paidRequest, { status: 'paid', paidBy: interaction.user.id }), components: [] }).catch(() => {});
    return interaction.reply({ content: 'Saque pago e saldo descontado.', flags: MessageFlags.Ephemeral });
  }

  if (scope === 'admin_menu') {
    if (!can(interaction.member, 'approvePayment') && !can(interaction.member, 'approveRegistration') && !can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Sem permissao para usar o menu ADM.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      ...operations.adminMenuPayload(action),
      flags: MessageFlags.Ephemeral
    });
  }

  if (scope === 'tutorial' && action === 'member_checklist') {
    return interaction.reply({
      ...memberOnboarding.checklistPayload(),
      flags: MessageFlags.Ephemeral
    });
  }

  if (scope === 'tutorial' && action === 'staff_html') {
    if (!can(interaction.member, 'approvePayment') && !can(interaction.member, 'approveRegistration') && !can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Sem permissao para baixar o tutorial da staff.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      content: 'Tutorial HTML gerado.',
      files: [staffTutorial.htmlAttachment()],
      flags: MessageFlags.Ephemeral
    });
  }
  if (interaction.customId === 'admin:remove_balance') {
    if (!can(interaction.member, 'withdrawBalance')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    return interaction.reply({
      content: 'Escolha o membro que vai ter saldo retirado usando a busca do Discord:',
      components: [adminRemoveBalanceUserSelect()],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'admin:refresh_pending_queue') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para atualizar pendencias.', flags: MessageFlags.Ephemeral });
    }
    await operations.refreshPendingQueueMessage(interaction);
    return interaction.reply({ content: 'Fila de pendencias atualizada.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'admin:daily_report') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para gerar relatorio ADM.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...operations.adminDailyReportPayload(), flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'admin:test_backup') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para testar backup.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...operations.backupTestPayload(), flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'admin:pending_html') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para exportar pendencias.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...operations.pendingQueueHtmlPayload(), flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'admin:presence_report') {
    if (!can(interaction.member, 'approveRegistration') && !can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para gerar relatorio de presenca.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...operations.presenceReportPayload(30), flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'admin:member_rank_html') {
    if (!can(interaction.member, 'approveRegistration') && !can(interaction.member, 'approvePayment') && !can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Sem permissao para gerar rank geral.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return interaction.editReply(await memberProfile.rankHtmlPayload(interaction.guild));
  }

  if (interaction.customId === 'admin:member_profile') {
    if (!can(interaction.member, 'approveRegistration') && !can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para ver perfil de membro.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      content: 'Escolha o membro para abrir o perfil:',
      components: [adminMemberProfileUserSelect()],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'admin:refresh_career_panel') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para atualizar carreira.', flags: MessageFlags.Ephemeral });
    }
    await events.refreshRaidAvalonCareerPanel(interaction.client);
    return interaction.reply({ content: 'Painel de carreira atualizado.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'admin:preview_career_rebuild') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para recalcular carreira.', flags: MessageFlags.Ephemeral });
    }
    const preview = events.previewCareerRebuild();
    return interaction.reply({
      content: careerRebuildPreviewText(preview),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`admin:confirm_career_rebuild:${interaction.user.id}`).setLabel('Confirmar recalculo').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('admin:cancel_career_rebuild').setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }

  if (scope === 'admin' && action === 'confirm_career_rebuild') {
    if (id !== interaction.user.id) {
      return interaction.reply({ content: 'Essa confirmacao nao foi criada para voce.', flags: MessageFlags.Ephemeral });
    }
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para recalcular carreira.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = events.rebuildCareerPoints({ actorId: interaction.user.id });
    await events.refreshRaidAvalonCareerPanel(interaction.client);
    return interaction.editReply({ content: careerRebuildResultText(result) });
  }

  if (interaction.customId === 'admin:cancel_career_rebuild') {
    return interaction.reply({ content: 'Recalculo de carreira cancelado.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'admin:verify_pending_registrations') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para verificar pedidos pendentes.', flags: MessageFlags.Ephemeral });
    }
      return interaction.reply({
        content: [
        'Use o comando `/sincronizar_albion arquivo:<csv/tsv>` e anexe a lista oficial de membros da guild no Albion.',
        'O bot vai mostrar uma previa antes de salvar vinculos e aprovar pendentes.',
        'Encontrados sao vinculados ao Albion name; registros pendentes encontrados viram Membro.'
      ].join('\n'),
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'inactive_events:preview') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para verificar inativos de eventos.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const preview = await inactiveEvents.createPreview({
      guild: interaction.guild,
      actorId: interaction.user.id
    });
    return interaction.editReply(inactiveEvents.previewPayload(preview));
  }

  if (scope === 'inactive_events') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para aplicar inativos de eventos.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'confirm') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await inactiveEvents.applyPreview({
        guild: interaction.guild,
        previewId: id,
        actorId: interaction.user.id
      });
      await interaction.message.edit({ components: [] }).catch(() => {});
      await inactiveEvents.postArchiveLog(interaction.client, result);
      return interaction.editReply(inactiveEvents.applyPayload(result));
    }

    if (action === 'cancel') {
      inactiveEvents.cancelPreview(id, interaction.user.id);
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Verificacao de inativos cancelada. Nenhum cargo foi alterado.', flags: MessageFlags.Ephemeral });
    }
  }

  if (interaction.customId === 'inactive_guests:preview') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para verificar convidados inativos.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const preview = await inactiveGuests.createPreview({
      guild: interaction.guild,
      actorId: interaction.user.id
    });
    return interaction.editReply(inactiveGuests.previewPayload(preview));
  }

  if (scope === 'inactive_guests') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para aplicar convidados inativos.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'confirm') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await inactiveGuests.applyPreview({
        guild: interaction.guild,
        previewId: id,
        actorId: interaction.user.id
      });
      await interaction.message.edit({ components: [] }).catch(() => {});
      await inactiveGuests.postArchiveLog(interaction.client, result);
      return interaction.editReply(inactiveGuests.applyPayload(result));
    }

    if (action === 'cancel') {
      inactiveGuests.cancelPreview(id, interaction.user.id);
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Verificacao de convidados inativos cancelada. Nenhum cargo foi alterado.', flags: MessageFlags.Ephemeral });
    }
  }

  if (scope === 'albion_fame') {
    if (!can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Voce nao tem permissao para importar fama Albion.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'confirm') {
      const preview = albionFame.takePreview(id);
      const result = albionFame.applyPreview(preview);
      return interaction.update({
        content: `Fama total Albion salva. Jogadores: ${result.rowsCount}.`,
        embeds: [],
        components: []
      });
    }

    if (action === 'cancel') {
      albionFame.cancelPreview(id);
      return interaction.update({ content: 'Importacao de fama Albion cancelada.', embeds: [], components: [] });
    }
  }

  if (scope === 'albion_sync') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para sincronizar Albion.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'confirm') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await albionVerification.applyAlbionSyncPreview({
        guild: interaction.guild,
        previewId: id,
        actorId: interaction.user.id
      });
      const reconciliation = await albionVerification.reconcileMemberRoles({
        guild: interaction.guild,
        result,
        actorId: interaction.user.id,
        days: 7
      });
      const notice = await albionVerification.postIdentificationNotice(
        interaction.client,
        reconciliation,
        result.preview.verificationId
      );
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.editReply({
        content: [
          albionVerification.syncApplyText(result),
          `Cargos removidos por nick sem vinculo: ${reconciliation.removedUnlinked}`,
          `Cargos removidos por mais de 7 dias sem call: ${reconciliation.removedInactive}`,
          `Promovidos/recuperados como Membro: ${reconciliation.promoted}`,
          `Falhas ao ajustar cargos: ${reconciliation.failed}`,
          notice.users
            ? `${notice.users} aviso(s) agendado(s) em lotes de 5, a cada 10 minutos, em <#${ids.channels.inactivityNotice}>.`
            : 'Nenhum aviso de identificacao precisou ser publicado.'
        ].join('\n'),
        files: [albionVerification.syncApplyAttachment(result)]
      });
    }

    if (action === 'cancel') {
      albionVerification.cancelAlbionSyncPreview(id, interaction.user.id);
      await interaction.message.edit({ components: [] }).catch(() => {});
      return interaction.reply({ content: 'Sincronizacao cancelada. Nenhum vinculo foi alterado.', flags: MessageFlags.Ephemeral });
    }
  }
  if (scope === 'registration') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para aprovar registro.', flags: MessageFlags.Ephemeral });
    }
    const registrationId = Number(id);
    const asMember = action === 'member';
    const result = await registration.approveRegistration({
      guild: interaction.guild,
      registrationId,
      actorId: interaction.user.id,
      asMember,
      note: asMember ? 'Aprovado como membro' : 'Mantido como convidado'
    });
    await interaction.message.edit({ components: [] }).catch(() => {});
    return interaction.reply({
      content: `Registro #${registrationId} de <@${result.discord_id}> resolvido: ${asMember ? 'Membro' : 'Convidado'}.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'csv:export_balances') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    return interaction.reply({ content: 'Saldos exportados em HTML. Abra o arquivo e use Baixar CSV se precisar de planilha.', files: [csv.balancesAttachment()], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'guild:export_members_html') {
    if (!can(interaction.member, 'approveRegistration') && !can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const attachment = await albionVerification.membersHtmlAttachment(interaction.guild);
    return interaction.editReply({
      content: 'Lista HTML Discord x Albion gerada com base na ultima verificacao.',
      files: [attachment]
    });
  }

  if (interaction.customId === 'csv:export_transactions') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    return interaction.reply({ content: 'Logs financeiros exportados em HTML.', files: [csv.transactionsAttachment()], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'csv:export_audit') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    return interaction.reply({ content: 'Auditoria exportada em HTML.', files: [csv.auditAttachment()], flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'csv:import_help') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    return interaction.reply({
      content: 'Para importar CSV com seguranca, use `/importar arquivo:<seu csv>`. O bot vai mostrar uma previa e pedir confirmacao antes de alterar saldos.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (scope === 'csv' && action === 'confirm_import') {
    if (!can(interaction.member, 'importCsv')) return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    const session = csv.takeImportPreview(id);
    if (!session) return interaction.reply({ content: 'Previa expirada ou ja usada. Envie o CSV novamente com `/importar`.', flags: MessageFlags.Ephemeral });
    if (session.actorId !== interaction.user.id) {
      return interaction.reply({ content: 'Somente quem enviou a importacao pode confirmar.', flags: MessageFlags.Ephemeral });
    }
    const transactions = csv.applyBalanceImport({ preview: session.preview, actorId: interaction.user.id });
    await finance.notifyBalanceTransactions({ client: interaction.client, transactions });
    await interaction.message.edit({ content: `Importacao aplicada. ${session.preview.found} saldos processados.`, components: [] }).catch(() => {});
    return interaction.reply({ content: 'CSV importado e saldos atualizados.', flags: MessageFlags.Ephemeral });
  }

  if (scope === 'csv' && action === 'cancel_import') {
    csv.takeImportPreview(id);
    await interaction.message.edit({ content: 'Importacao cancelada.', components: [] }).catch(() => {});
    return interaction.reply({ content: 'Importacao cancelada.', flags: MessageFlags.Ephemeral });
  }
}

function showLootModal(interaction, eventId) {
  return showModal(interaction, `event:loot:${eventId}`, 'Loot do Evento', [
    textInput('lootTotal', 'Loot total'),
    textInput('repair', 'Reparo'),
    textInput('silverBags', 'Sacos de prata'),
    textInput('taxPercent', 'Taxa % 0 a 100'),
    textInput('evidenceNotes', 'DPS/Fama links ou obs', false, 'CSV do loot logger: anexe no canal de revisao', TextInputStyle.Paragraph)
  ]);
}

async function clearSourceMessage(interaction, fallbackContent) {
  await interaction.message.delete().catch(async () => {
    await interaction.message.edit({ content: fallbackContent, embeds: [], components: [] }).catch(() => {});
  });
}

function pausedFeatureReply(interaction) {
  return interaction.reply({
    content: 'Esse recurso foi pausado para simplificar o bot. Use os paineis principais de evento, saldo, registro ou ADM.',
    flags: MessageFlags.Ephemeral
  });
}

function careerRebuildPreviewText(preview) {
  return [
    '**Previa do recalculo de carreira**',
    '',
    'Esse processo vai apagar a carreira atual e recriar a partir dos eventos aprovados.',
    'Ele usa o ledger para evitar ponto duplicado por evento/membro/categoria.',
    'Regra nova: Tank, Healer, Suporte, DPS e Caller. Scout/Looter contam como Suporte.',
    '',
    `Eventos aprovados encontrados: ${preview.approvedEvents}`,
    `Eventos com pontos: ${preview.eventsWithPoints}`,
    `Membros afetados: ${preview.uniqueMembers}`,
    `Participacoes com pontos: ${preview.participantsWithPoints}`,
    `Participacoes ignoradas: ${preview.skippedParticipants}`,
    `Movimentos que serao criados: ${preview.transactionsToCreate}`,
    `Pontos totais previstos: ${preview.pointsToCreate}`,
    `Movimentos atuais no ledger: ${preview.existingTransactions}`,
    '',
    'Confirme apenas se voce quer reconstruir a carreira inteira com base no banco atual.'
  ].join('\n');
}

function careerRebuildResultText(result) {
  return [
    '**Carreira recalculada**',
    '',
    `Eventos aprovados analisados: ${result.approvedEvents}`,
    `Eventos com pontos: ${result.eventsWithPoints}`,
    `Membros afetados: ${result.uniqueMembers}`,
    `Movimentos criados: ${result.insertedTransactions}`,
    `Pontos inseridos: ${result.insertedPoints}`,
    `Participacoes ignoradas: ${result.skippedParticipants}`,
    '',
    'O painel de carreira foi atualizado.'
  ].join('\n');
}

module.exports = {
  handleButton
};

function reviewUserSelect(eventId, reviewMessageId, mode, placeholder) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`event_review_user_select:${mode}:${eventId}:${reviewMessageId}`)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function adminRemoveBalanceUserSelect() {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('admin_remove_balance_select:user')
      .setPlaceholder('Buscar membro para retirar saldo')
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function adminMemberProfileUserSelect() {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('admin_profile_select:user')
      .setPlaceholder('Buscar membro para abrir perfil')
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function raidWeaponSelect(eventId, role, discordId) {
  const options = events.raidWeaponRoleOptions(eventId, role, discordId);
  if (!options.length) return null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`event_raid_weapon_select:weapon:${eventId}:${role}`)
      .setPlaceholder(`Escolher ${roleLabel(role)}`)
      .addOptions(options)
  );
}

function raidWeaponSlotSelect(eventId, discordId) {
  const options = events.raidWeaponSlotOptions(eventId, discordId);
  if (!options.length) return null;
  const event = eventsRepo.getEvent(eventId);
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`event_raid_weapon_select:slot:${eventId}`)
      .setPlaceholder(event?.content_type === 'raid_dragon' ? 'Escolher vaga da Raid Dragão' : 'Escolher vaga da Raid Avalon')
      .addOptions(options)
  );
}

function eventRoleChangeSelect(event, discordId) {
  if (!event) return null;
  const participants = eventsRepo.listParticipants(event.id);
  const current = participants.find((participant) => (
    participant.discord_id === discordId && !participant.is_spectator && !participant.is_paused
  ));
  const roleSlots = [
    ['tank', Number(event.tank_slots || 0)],
    ['healer', Number(event.healer_slots || 0)],
    ['support', Number(event.support_slots || 0)],
    ['dps', Number(event.dps_slots || 0)]
  ];
  const options = roleSlots.map(([role, slots]) => {
    const usedByOthers = participants.filter((participant) => (
      participant.role === role && !participant.is_spectator && !participant.is_paused && participant.discord_id !== discordId
    )).length;
    const isCurrent = current?.role === role;
    if (!isCurrent && usedByOthers >= slots) return null;
    if (slots <= 0 && !isCurrent) return null;
    return {
      label: rolePlainLabel(role),
      value: role,
      description: isCurrent ? 'Sua funcao atual' : `${usedByOthers}/${slots} ocupado(s)`
    };
  }).filter(Boolean);

  if (!options.length) return null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`event:join:${event.id}`)
      .setPlaceholder('Escolher nova funcao')
      .addOptions(options)
  );
}

function rolePlainLabel(role) {
  const labels = {
    tank: 'Tank',
    healer: 'Healer',
    support: 'Suporte',
    dps: 'DPS'
  };
  return labels[role] || role;
}

function roleLabel(role) {
  const labels = {
    tank: '\u{1F6E1}\uFE0F Tank',
    healer: '\u{1F49A} Healer',
    support: '\u{1F6A9} Suporte',
    dps: '\u2694\uFE0F DPS'
  };
  return labels[role] || role;
}
