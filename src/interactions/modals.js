const { can, hasRole, isOwner } = require('../config/permissions');
const ids = require('../config/ids');
const events = require('../modules/events/events.service');
const eventsRepo = require('../modules/events/events.repository');
const customEventWizard = require('../modules/events/customEventWizard.service');
const weaponSelectionModes = require('../modules/events/weaponSelectionModes');
const eventTemplateComponents = require('../modules/events/eventTemplates.components');
const customEventWizardComponents = require('../modules/events/customEventWizard.components');
const sponsoredCtaBuilds = require('../modules/events/sponsoredCtaBuilds.service');
const customEventWeaponCatalog = require('../modules/events/customEventWeaponCatalog.service');
const groupDungeonWizard = require('../modules/events/groupDungeonWizard.service');
const eventTypes = require('../modules/events/eventTypes');
const eventCreationRecovery = require('../modules/events/eventCreationRecovery.service');
const registration = require('../modules/registration/registration.service');
const finance = require('../modules/finance/finance.service');
const balanceReversal = require('../modules/finance/balanceReversal.service');
const { parseSilver, formatSilver } = require('../utils/silver');
const { safeSend, baseEmbed } = require('../utils/discord');
const { safeDeferReply, safeEditReply, safeReply } = require('../utils/interactions');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const financeRepo = require('../modules/finance/finance.repository');
const deposit = require('../modules/deposit/deposit.service');
const lochMarket = require('../modules/community/lochMarket.service');
const springHideout = require('../modules/community/springHideout.service');

function intField(fields, name) {
  const value = Number.parseInt(fields.getTextInputValue(name), 10);
  if (Number.isNaN(value) || value < 0) throw new Error(`Campo invalido: ${name}`);
  return value;
}

async function handleModal(interaction) {
  if (interaction.customId.startsWith('event_config:save:')) {
    if (!can(interaction.member, 'createEvent')) {
      return safeReply(interaction, { content: 'Você não tem permissão para salvar configurações.', flags: MessageFlags.Ephemeral });
    }
    const [, , eventId, kind, contentType] = interaction.customId.split(':');
    const saved = eventsRepo.saveEventConfiguration({
      creatorId: interaction.user.id,
      eventId: Number(eventId),
      kind,
      contentType,
      name: fieldOrDefault(interaction, 'name', '')
    });
    return safeReply(interaction, {
      content: `Configuração **${saved.name}** salva. Ela aparecerá ao criar outro evento deste tipo.`,
      flags: MessageFlags.Ephemeral
    });
  }
  if (interaction.customId.startsWith('content_preview:proposal:')) {
    return interaction.reply({ content: 'A prévia de conteúdos foi desativada.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId.startsWith('event:group_build_links:')) {
    const draftId = interaction.customId.split(':')[2];
    const draft = customEventWizard.getDraft(draftId, interaction.user.id);
    const page = groupDungeonWizard.manualLinkPage(draft);
    const links = page.map((build, index) => ({
      ...build,
      url: fieldOrDefault(interaction, `link_${index}`, '')
    }));
    groupDungeonWizard.saveManualLinks({ draftId, creatorId: interaction.user.id, links });
    return interaction.reply({
      ...groupDungeonWizard.nextPayload(draft),
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'loch:suggestion_modal') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const suggestionText = interaction.fields.getTextInputValue('suggestion').trim();
    if (suggestionText.length < 3) throw new Error('Escreva uma sugestão com pelo menos 3 caracteres.');
    const suggestionId = lochMarket.createSuggestion({ authorId: interaction.user.id, suggestion: suggestionText });
    const staffChannel = await interaction.client.channels.fetch(ids.channels.staff).catch(() => null);
    if (!staffChannel?.isTextBased()) throw new Error('Nao foi possivel encontrar o canal da staff. Tente novamente mais tarde.');
    const staffMessage = await staffChannel.send(lochMarket.suggestionStaffPayload({
      id: suggestionId,
      authorId: interaction.user.id,
      suggestion: suggestionText
    }));
    lochMarket.attachStaffMessage(suggestionId, staffChannel.id, staffMessage.id);
    return interaction.editReply({ content: `Sua sugestão #${suggestionId} foi enviada para a staff. Obrigado pela opinião!` });
  }

  if (interaction.customId.startsWith('loch:answer_modal:')) {
    if (!isOwner(interaction.member) && !hasRole(interaction.member, 'staff') && !hasRole(interaction.member, 'adm')) {
      return interaction.reply({ content: 'Somente a staff pode responder sugestões.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const suggestionId = Number(interaction.customId.split(':')[2]);
    const suggestion = lochMarket.getSuggestion(suggestionId);
    if (!suggestion) throw new Error('Sugestão não encontrada.');
    if (suggestion.status === 'answered') return interaction.editReply({ content: 'Essa sugestão já foi respondida.' });
    const answer = interaction.fields.getTextInputValue('answer').trim();
    const author = await interaction.client.users.fetch(suggestion.author_id).catch(() => null);
    if (!author) throw new Error('Nao foi possivel localizar o autor da sugestao.');
    const delivered = await author.send({
      embeds: [
        baseEmbed(`Resposta da staff sobre sua sugestão #${suggestion.id}`)
          .addFields(
            { name: 'Sua sugestão', value: suggestion.suggestion.slice(0, 1024), inline: false },
            { name: 'Resposta', value: answer.slice(0, 1024), inline: false }
          )
      ],
      allowedMentions: { parse: [] }
    }).then(() => true).catch(() => false);
    if (!delivered) {
      return interaction.editReply({ content: 'Não consegui enviar a resposta por DM. O membro pode estar com as mensagens privadas fechadas; a sugestão continua pendente.' });
    }
    const answered = lochMarket.markAnswered({ id: suggestionId, staffId: interaction.user.id, answer });
    await interaction.message?.edit(lochMarket.answeredStaffPayload(answered)).catch(() => {});
    return interaction.editReply({ content: 'Resposta enviada ao autor por mensagem privada.' });
  }

  if (interaction.customId === 'spring_ho:suggestion_modal') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const suggestionText = interaction.fields.getTextInputValue('suggestion').trim();
    if (suggestionText.length < 3) throw new Error('Escreva uma sugestão com pelo menos 3 caracteres.');
    const suggestionId = springHideout.createSuggestion({ authorId: interaction.user.id, suggestion: suggestionText });
    const staffChannel = await interaction.client.channels.fetch(ids.channels.staff).catch(() => null);
    if (!staffChannel?.isTextBased()) throw new Error('Nao foi possivel encontrar o canal da staff. Tente novamente mais tarde.');
    const staffMessage = await staffChannel.send(springHideout.suggestionStaffPayload({
      id: suggestionId,
      authorId: interaction.user.id,
      suggestion: suggestionText
    }));
    springHideout.attachStaffMessage(suggestionId, staffChannel.id, staffMessage.id);
    return interaction.editReply({ content: `Sua sugestão #${suggestionId} foi enviada para a staff. Obrigado pela opinião!` });
  }

  if (interaction.customId.startsWith('spring_ho:answer_modal:')) {
    if (!isOwner(interaction.member) && !hasRole(interaction.member, 'staff') && !hasRole(interaction.member, 'adm')) {
      return interaction.reply({ content: 'Somente a staff pode responder sugestões.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const suggestionId = Number(interaction.customId.split(':')[2]);
    const suggestion = springHideout.getSuggestion(suggestionId);
    if (!suggestion) throw new Error('Sugestão não encontrada.');
    if (suggestion.status === 'answered') return interaction.editReply({ content: 'Essa sugestão já foi respondida.' });
    const answer = interaction.fields.getTextInputValue('answer').trim();
    const author = await interaction.client.users.fetch(suggestion.author_id).catch(() => null);
    if (!author) throw new Error('Nao foi possivel localizar o autor da sugestao.');
    const delivered = await author.send({
      embeds: [
        baseEmbed(`Resposta da staff sobre sua sugestão #${suggestion.id}`)
          .addFields(
            { name: 'Sua sugestão', value: suggestion.suggestion.slice(0, 1024), inline: false },
            { name: 'Resposta', value: answer.slice(0, 1024), inline: false }
          )
      ],
      allowedMentions: { parse: [] }
    }).then(() => true).catch(() => false);
    if (!delivered) {
      return interaction.editReply({ content: 'Não consegui enviar a resposta por DM. O membro pode estar com as mensagens privadas fechadas; a sugestão continua pendente.' });
    }
    const answered = springHideout.markAnswered({ id: suggestionId, staffId: interaction.user.id, answer });
    await interaction.message?.edit(springHideout.answeredStaffPayload(answered)).catch(() => {});
    return interaction.editReply({ content: 'Resposta enviada ao autor por mensagem privada.' });
  }

  if (interaction.customId === 'campaign:donate_balance_modal') {
    const amount = parseSilver(interaction.fields.getTextInputValue('amount'));
    const balance = financeRepo.getBalance(interaction.user.id);
    if (amount <= 0) throw new Error('Informe um valor maior que zero.');
    if (balance <= 0) throw new Error('Voce nao tem saldo positivo para doar.');
    if (amount > balance) {
      throw new Error(`Voce tentou doar ${formatSilver(amount)}, mas seu saldo atual e ${formatSilver(balance)}.`);
    }
    return interaction.reply({
      content: [
        '**Confirmar doacao para @900m**',
        `Seu saldo atual: ${formatSilver(balance)}.`,
        `Valor da doacao: ${formatSilver(amount)}.`,
        `Saldo depois: ${formatSilver(balance - amount)}.`
      ].join('\n'),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`campaign:confirm_balance_donation:${amount}:${interaction.user.id}`)
            .setLabel(`Confirmar ${formatSilver(amount)}`)
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`campaign:cancel_balance_donation:${interaction.user.id}`)
            .setLabel('Cancelar')
            .setStyle(ButtonStyle.Secondary)
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
  if (
    interaction.customId.startsWith('member_panel:') ||
    interaction.customId.startsWith('member_panel_staff:') ||
    interaction.customId.startsWith('auction:') ||
    interaction.customId === 'poll:create'
  ) {
    return interaction.reply({
      content: 'Esse recurso foi pausado para simplificar o bot. Use os paineis principais de evento, saldo, registro ou ADM.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId.startsWith('event:edit_') && interaction.customId.includes('_modal:')) {
    const eventId = Number(interaction.customId.split(':').at(-1));
    const event = eventsRepo.getEvent(eventId);
    if (!event) throw new Error('Evento nao encontrado.');
    if (event.creator_id !== interaction.user.id && !can(interaction.member, 'assumeEvent')) {
      return safeReply(interaction, {
        content: 'Somente o criador ou alguem autorizado pode editar este evento.',
        flags: MessageFlags.Ephemeral
      });
    }
    if (event.status !== 'created') {
      return safeReply(interaction, {
        content: 'Somente eventos que ainda nao foram iniciados podem ser editados.',
        flags: MessageFlags.Ephemeral
      });
    }
    const acknowledged = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    if (!acknowledged) return null;

    if (interaction.customId.startsWith('event:edit_info_modal:')) {
      const title = fieldOrDefault(interaction, 'title', '').slice(0, 80);
      if (!title) throw new Error('Informe o titulo do evento.');
      const customMeta = eventsRepo.getCustomEventMeta(eventId);
      const typedScheduledTime = fieldOrDefault(interaction, 'scheduledTime', '').slice(0, 80);
      await events.updateCreatedEvent({
        client: interaction.client,
        guild: interaction.guild,
        eventId,
        actorId: interaction.user.id,
        patch: {
          title,
          location: fieldOrDefault(interaction, 'location', '').slice(0, 100),
          scheduled_time: customMeta && typedScheduledTime
            ? customEventWizard.normalizeCtaDateTime(typedScheduledTime)
            : typedScheduledTime || null,
          description: fieldOrDefault(interaction, 'description', '').slice(0, 500)
        }
      });
      return safeEditReply(interaction, { content: `Evento ${event.event_code} atualizado. Os participantes foram mantidos.` });
    }

    if (interaction.customId.startsWith('event:edit_slots_modal:')) {
      const slots = parseSlots(fieldOrDefault(interaction, 'slots', ''));
      if (slots.length !== 4) {
        throw new Error('Use 4 numeros para vagas. Ex: 1,2,1,6 para Tank, Healer, Suporte e DPS.');
      }
      await events.updateCreatedEventSlots({
        client: interaction.client,
        guild: interaction.guild,
        eventId,
        actorId: interaction.user.id,
        patch: {
          tank_slots: slots[0],
          healer_slots: slots[1],
          support_slots: slots[2],
          dps_slots: slots[3]
        }
      });
      return safeEditReply(interaction, { content: `Vagas do evento ${event.event_code} atualizadas. Os inscritos foram mantidos.` });
    }

    if (interaction.customId.startsWith('event:edit_custom_details_modal:')) {
      await events.updateCustomEventDetails({
        client: interaction.client,
        guild: interaction.guild,
        eventId,
        actorId: interaction.user.id,
        details: {
          lootRules: fieldOrDefault(interaction, 'lootRules', ''),
          consumables: fieldOrDefault(interaction, 'consumables', ''),
          mountRequirement: fieldOrDefault(interaction, 'mountRequirement', '')
        }
      });
      return safeEditReply(interaction, { content: `Requisitos do evento ${event.event_code} atualizados.` });
    }

    const labelsByRole = Object.fromEntries(['tank', 'healer', 'support', 'dps'].map((role) => {
      const count = Number(event[`${role}_slots`] || 0);
      const raw = interaction.fields.getTextInputValue(role);
      return [role, count === 0 ? [] : String(raw).split('|').map((value) => value.trim())];
    }));
    await events.updateCustomEventSlotLabels({
      client: interaction.client,
      eventId,
      actorId: interaction.user.id,
      labelsByRole
    });
    return safeEditReply(interaction, { content: `Armas e funcoes do evento ${event.event_code} atualizadas.` });
  }

  if (interaction.customId === 'event:custom_basic' || interaction.customId.startsWith('event:custom_basic:reuse:') || interaction.customId.startsWith('event:custom_basic:saved:')) {
    if (!can(interaction.member, 'createEvent')) {
      return safeReply(interaction, { content: 'Voce nao tem permissao para criar CTA.', flags: MessageFlags.Ephemeral });
    }
    const templateId = interaction.customId.startsWith('event:custom_basic:reuse:') || interaction.customId.startsWith('event:custom_basic:saved:')
      ? interaction.customId.split(':')[3]
      : null;
    const previous = templateId
      ? interaction.customId.includes(':saved:')
        ? eventsRepo.getSavedEventConfiguration(interaction.user.id, templateId)
        : eventsRepo.getEventConfiguration(interaction.user.id, 'custom', templateId)
      : null;
    const draft = customEventWizard.createDraft({
      creatorId: interaction.user.id,
      contentType: 'cta',
      title: fieldOrDefault(interaction, 'title', ''),
      scheduledTime: fieldOrDefault(interaction, 'scheduledTime', ''),
      location: fieldOrDefault(interaction, 'location', ''),
      description: fieldOrDefault(interaction, 'description', ''),
      composition: fieldOrDefault(interaction, 'composition', ''),
      template: previous ? {
        lootRules: previous.loot_rules,
        consumables: previous.consumables,
        mount: previous.mount_requirement,
        slots: previous.slots,
        dpsPool: previous.dpsPool,
        dpsPolicy: previous.dps_policy
      } : null
    });
    return interaction.reply({
      content: [
        `Dados basicos salvos. Composicao: ${draft.composition.tank},${draft.composition.healer},${draft.composition.support},${draft.composition.dps}.`,
        `Como os ${draft.composition.dps} DPS escolherão as armas?`
      ].join('\n'),
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`custom_event_policy:select:${draft.id}`)
          .setPlaceholder('Escolha a regra das armas de DPS')
          .addOptions(require('../modules/events/dpsWeaponPool').policyOptions())
      )],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId.startsWith('event:custom_details:')) {
    const draftId = interaction.customId.split(':')[2];
    const currentDraft = customEventWizard.getDraft(draftId, interaction.user.id);
    const draft = customEventWizard.saveDetails({
      id: draftId,
      creatorId: interaction.user.id,
      lootRules: fieldOrDefault(interaction, 'lootRules', ''),
      consumables: fieldOrDefault(interaction, 'consumables', ''),
      mount: fieldOrDefault(interaction, 'mount', ''),
      dpsPoolText: currentDraft.dpsPolicy === 'free' ? null : fieldOrDefault(interaction, 'dpsPool', '')
    });
    const acknowledged = await deferCustomWizardMessage(interaction);
    if (!acknowledged) return null;
    const forumBuilds = await sponsoredCtaBuilds.loadCatalog(interaction.client, interaction.guild);
    const dpsBuilds = sponsoredCtaBuilds.attachAvailableEmojis(draft.dpsPool.map((weapon) => ({
      key: weapon.weaponKey,
      name: weapon.label,
      role: 'dps',
      iconUrl: weapon.imageUrl
    })), interaction.client, interaction.guild);
    const builds = sponsoredCtaBuilds.attachAvailableEmojis(
      customEventWeaponCatalog.mergeCatalog([...forumBuilds, ...dpsBuilds]),
      interaction.client,
      interaction.guild
    );
    customEventWizard.setCatalog({ id: draft.id, creatorId: interaction.user.id, builds });
    const step = customEventWizard.compositionStep({ id: draft.id, creatorId: interaction.user.id });
    if (step.complete) {
      const event = await events.createCustomEventFromDraft(interaction, draft);
      customEventWizard.removeDraft(draft.id, interaction.user.id);
      return safeEditReply(interaction, { content: `CTA ${event.event_code} criado com o cardápio dinâmico de DPS.`, components: eventTemplateComponents.saveConfigurationComponents(event.id, 'custom', 'cta') });
    }
    return safeEditReply(interaction, customEventWizardComponents.compositionPayload(step));
  }

  if (interaction.customId.startsWith('event:custom_slots:')) {
    const [, , draftId, pageText] = interaction.customId.split(':');
    const current = customEventWizard.slotPage({ id: draftId, creatorId: interaction.user.id, page: pageText });
    const values = current.slots.map((_, index) => interaction.fields.getTextInputValue(`slot_${index}`));
    const saved = customEventWizard.saveSlotPage({
      id: draftId,
      creatorId: interaction.user.id,
      page: pageText,
      values
    });
    const nextPage = saved.page + 1;
    if (nextPage < saved.totalPages) {
      return updateCustomWizardMessage(interaction, {
        content: `Composicao ${saved.page + 1}/${saved.totalPages} salva.`,
        components: [customEventStepRow(
          `custom_event:slots:${draftId}:${nextPage}`,
          `Composicao ${nextPage + 1}/${saved.totalPages}`,
          draftId
        )]
      });
    }

    const acknowledged = await deferCustomWizardMessage(interaction);
    if (!acknowledged) return null;
    const event = await events.createCustomEventFromDraft(interaction, saved.draft);
    customEventWizard.removeDraft(draftId, interaction.user.id);
    return safeEditReply(interaction, {
      content: `CTA ${event.event_code} criado.`,
      components: eventTemplateComponents.saveConfigurationComponents(event.id, 'custom', 'cta')
    });
  }

  if (interaction.customId === 'event:create' || interaction.customId.startsWith('event:create:')) {
    if (!can(interaction.member, 'createEvent')) {
      return safeReply(interaction, { content: 'Voce nao tem permissao para criar evento.', flags: MessageFlags.Ephemeral });
    }
    const acknowledged = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    if (!acknowledged) return null;
    const title = fieldOrDefault(interaction, 'title', 'DG Grupo T8+');
    const description = fieldOrDefault(interaction, 'description', 'T8 equivalente');
    const location = fieldOrDefault(interaction, 'location', 'Pergunte na Call');
    const scheduledTime = fieldOrDefault(interaction, 'scheduledTime', defaultAlbionTime(10));
    const slotsText = fieldOrDefault(interaction, 'slots', '1,1,1,3');
    const slots = parseSlots(slotsText);
    const contentType = interaction.customId.split(':')[2] || 'other';
    try {
      if (contentType !== 'other') eventTypes.normalizeEventType(contentType);
      if (slots.length !== 4 || slots.some((value) => Number.isNaN(value) || value < 0)) {
        throw new Error('Use 4 numeros para vagas. Ex: 3,3,2,12 ou Tank 3 Healer 3 Sup 2 DPS 12.');
      }
      if (eventTypes.usesVisualComposition(contentType) && slots.reduce((sum, count) => sum + count, 0) > 20) {
        throw new Error(`${eventTypes.eventTypeLabel(contentType)} aceita no máximo 20 vagas na composição visual.`);
      }
    } catch (error) {
      return recoverEventCreation(interaction, contentType, { title, description, location, scheduledTime, slotsText }, error);
    }
    if (eventTypes.usesVisualComposition(contentType)) {
      let draft;
      try {
        const customIdParts = interaction.customId.split(':');
        const templateId = ['reuse', 'saved'].includes(customIdParts[3]) ? customIdParts[4] : null;
        const previous = templateId
          ? customIdParts[3] === 'saved'
            ? eventsRepo.getSavedEventConfiguration(interaction.user.id, templateId)
            : eventsRepo.getEventConfiguration(interaction.user.id, 'common', templateId)
          : null;
        if (previous && previous.content_type !== contentType) {
          throw new Error(`O modelo escolhido nao pertence a ${eventTypes.eventTypeLabel(contentType)}.`);
        }
        draft = customEventWizard.createDraft({
          creatorId: interaction.user.id,
          contentType,
          title,
          description,
          location,
          scheduledTime,
          composition: slots.join(','),
          template: previous ? {
            slots: previous.slots,
            compositionMode: previous.composition_mode,
            buildsChannelId: previous.builds_channel_id,
            buildsChannelName: previous.builds_channel_name
          } : null
        });
      } catch (error) {
        return recoverEventCreation(interaction, contentType, { title, description, location, scheduledTime, slotsText }, error);
      }
      return safeEditReply(interaction, {
        content: [
          '**Como as armas serão definidas?**',
          '• **Membros escolhem:** o caller informa somente as quantidades por função; cada participante escolhe sua arma respeitando a planilha.',
          '• **Caller predefine:** o caller escolhe agora a arma de cada vaga.'
        ].join('\n'),
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`visual_composition_mode:select:${draft.id}`)
            .setPlaceholder('Escolha o modo da composição')
            .addOptions(weaponSelectionModes.options())
        )]
      });
    }
    const event = await events.createEventFromModal(interaction, {
      title,
      description,
      location,
      scheduledTime,
      tankSlots: slots[0],
      healerSlots: slots[1],
      supportSlots: slots[2],
      dpsSlots: slots[3],
      contentType
    });
    return safeEditReply(interaction, { content: `Evento ${event.event_code} criado.`, components: eventTemplateComponents.saveConfigurationComponents(event.id, 'common', contentType) });
  }

  if (interaction.customId === 'event:create_raid_full' || interaction.customId.startsWith('event:create_raid_full:')) {
    if (!can(interaction.member, 'createEvent')) {
      return safeReply(interaction, { content: 'Voce nao tem permissao para criar Raid Avalon Full.', flags: MessageFlags.Ephemeral });
    }
    const acknowledged = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    if (!acknowledged) return null;
    const event = await events.createRaidAvalonFullFromModal(interaction, {
      scheduledTime: fieldOrDefault(interaction, 'scheduledTime', defaultAlbionTime(10)),
      location: fieldOrDefault(interaction, 'location', 'Pergunte na Call'),
      dungeonTier: fieldOrDefault(interaction, 'dungeonTier', 'Nao informado'),
      buildTier: fieldOrDefault(interaction, 'buildTier', 'Nao informado'),
      observation: fieldOrDefault(interaction, 'observation', '')
    });
    const weaponMode = interaction.customId.split(':')[2] || 'predefined';
    await events.configureSpecialWeaponMode(event.id, 'raid_avalon', weaponMode);
    return safeEditReply(interaction, { content: `Raid Avalon Full ${event.event_code} criada com 20 vagas.`, components: eventTemplateComponents.saveConfigurationComponents(event.id, 'raid', 'raid_avalon') });
  }

  if (interaction.customId === 'event:create_raid_dragon' || interaction.customId.startsWith('event:create_raid_dragon:')) {
    if (!can(interaction.member, 'createEvent')) {
      return safeReply(interaction, { content: 'Voce nao tem permissao para criar Raid Dragão.', flags: MessageFlags.Ephemeral });
    }
    const acknowledged = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    if (!acknowledged) return null;
    const event = await events.createRaidDragonFromModal(interaction, {
      scheduledTime: fieldOrDefault(interaction, 'scheduledTime', defaultAlbionTime(10)),
      location: fieldOrDefault(interaction, 'location', 'Pergunte na Call'),
      dungeonTier: fieldOrDefault(interaction, 'dungeonTier', 'Nao informado'),
      buildTier: fieldOrDefault(interaction, 'buildTier', 'Nao informado'),
      observation: fieldOrDefault(interaction, 'observation', '')
    });
    const weaponMode = interaction.customId.split(':')[2] || 'predefined';
    await events.configureSpecialWeaponMode(event.id, 'raid_dragon', weaponMode);
    return safeEditReply(interaction, { content: `Raid Dragão ${event.event_code} criada com 20 vagas.`, components: eventTemplateComponents.saveConfigurationComponents(event.id, 'raid', 'raid_dragon') });
  }

  if (interaction.customId === 'event:create_world_boss' || interaction.customId.startsWith('event:create_world_boss:')) {
    if (!can(interaction.member, 'createEvent')) {
      return safeReply(interaction, { content: 'Voce nao tem permissao para criar World Boss.', flags: MessageFlags.Ephemeral });
    }
    const acknowledged = await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    if (!acknowledged) return null;
    const event = await events.createWorldBossFromModal(interaction, {
      eventDate: fieldOrDefault(interaction, 'eventDate', '')
    });
    const weaponMode = interaction.customId.split(':')[2] || 'predefined';
    await events.configureSpecialWeaponMode(event.id, 'world_boss', weaponMode);
    return safeEditReply(interaction, { content: `World Boss ${event.event_code} criado com 16 vagas.`, components: eventTemplateComponents.saveConfigurationComponents(event.id, 'world', 'world_boss') });
  }

  if (interaction.customId.startsWith('event:raid_join:')) {
    const [, , eventIdText, role, weaponKey] = interaction.customId.split(':');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const itemPower = intField(interaction.fields, 'itemPower');
    const weaponName = weaponKey ? events.raidWeaponName(role, weaponKey, Number(eventIdText)) : interaction.fields.getTextInputValue('weapon');
    const weapon = await events.joinRaidAvalonRole(interaction, {
      eventId: Number(eventIdText),
      role,
      weapon: weaponName,
      itemPower
    });
    const buildUrl = events.raidWeaponBuildUrl(role, weaponKey || weapon, Number(eventIdText));
    const buildText = buildUrl ? `\nLembrete da build: ${buildUrl}` : '';
    const event = eventsRepo.getEvent(Number(eventIdText));
    const raidLabel = event?.content_type === 'raid_dragon' ? 'Raid Dragão' : 'Raid Avalon Full';
    return interaction.editReply({ content: `Voce entrou na ${raidLabel} como ${roleLabel(role)} usando ${weapon} IP ${itemPower}.${buildText}` });
  }

  if (interaction.customId === 'registration:submit') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const albionName = interaction.fields.getTextInputValue('albionName').trim();
    const registrationId = await registration.submitRegistration({ interaction, albionName });
    await safeSend(interaction.client, ids.channels.registrationRequests, {
      embeds: [
        baseEmbed('Registro pendente')
          .addFields(
            { name: 'Membro', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Albion', value: albionName, inline: true },
            { name: 'Registro', value: `#${registrationId}`, inline: true }
          )
      ]
      ,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`registration:member:${registrationId}`).setLabel('Aprovar Membro').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`registration:guest:${registrationId}`).setLabel('Manter Convidado').setStyle(ButtonStyle.Secondary)
        )
      ]
    });
    return interaction.editReply({ content: 'Registro enviado. Voce recebeu Convidado e a staff vai revisar.' });
  }

  if (interaction.customId.startsWith('event:loot:')) {
    const eventId = Number(interaction.customId.split(':')[2]);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const event = eventsRepo.getEvent(eventId);
    if (!event) throw new Error('Evento nao encontrado.');
    if (event.status === 'running') {
      await events.finishEvent(interaction, eventId);
    } else if (event.status !== 'review') {
      throw new Error('Este evento nao pode receber revisao de loot neste status.');
    }
    const result = events.saveLootReview({
      eventId,
      lootTotal: parseSilver(interaction.fields.getTextInputValue('lootTotal')),
      repair: parseSilver(interaction.fields.getTextInputValue('repair')),
      silverBags: parseSilver(interaction.fields.getTextInputValue('silverBags')),
      taxPercent: intField(interaction.fields, 'taxPercent'),
      evidenceNotes: interaction.fields.getTextInputValue('evidenceNotes').trim()
    });
    const reviewChannel = await events.createPostEventReviewSpace(interaction, eventId);
    return interaction.editReply({
      content: `Revisao criada em <#${reviewChannel.id}>. Loot liquido: ${formatSilver(result.netLoot)}. Anexe o CSV do loot logger nesse canal e ajuste a participacao antes de enviar ao financeiro.`
    });
  }

  if (interaction.customId.startsWith('event_review:')) {
    const [, action, eventIdRaw, messageId] = interaction.customId.split(':');
    const eventId = Number(eventIdRaw);
    const event = require('../modules/events/events.repository').getEvent(eventId);
    if (!event) throw new Error('Evento nao encontrado.');
    if (event.creator_id !== interaction.user.id && !can(interaction.member, 'assumeEvent')) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode editar a revisao.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'recalculate_modal') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const draft = events.createLootReviewCorrectionDraft({
        eventId,
        actorId: interaction.user.id,
        reviewMessageId: messageId,
        lootTotal: parseSilver(interaction.fields.getTextInputValue('lootTotal')),
        repair: parseSilver(interaction.fields.getTextInputValue('repair')),
        silverBags: parseSilver(interaction.fields.getTextInputValue('silverBags')),
        taxPercent: intField(interaction.fields, 'taxPercent'),
        evidenceNotes: interaction.fields.getTextInputValue('evidenceNotes').trim()
      });
      return interaction.editReply({
        content: [
          '**Confira a correcao antes de aplicar:**',
          `Loot total: **${formatSilver(draft.lootTotal)}**`,
          `Reparo: **${formatSilver(draft.repair)}**`,
          `Sacos de prata: **${formatSilver(draft.silverBags)}**`,
          `Taxa: **${draft.taxPercent}%**`,
          `Loot liquido: **${formatSilver(draft.previous.netLoot)} -> ${formatSilver(draft.netLoot)}**`,
          '',
          'Nenhum valor foi alterado ainda.'
        ].join('\n'),
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`event_loot_correction:confirm:${draft.id}`).setLabel('Confirmar correcao').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`event_loot_correction:cancel:${draft.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
          )
        ]
      });
    }

    if (action === 'edit_modal' || action === 'add_modal') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const targetId = cleanUserId(interaction.fields.getTextInputValue('userId'));
      const role = normalizeRole(interaction.fields.getTextInputValue('role'));
      const minutes = parseMinutes(interaction.fields.getTextInputValue('minutes'));
      const reason = interaction.fields.getTextInputValue('reason') || 'Ajuste manual de participacao';
      if (!targetId || Number.isNaN(minutes) || minutes < 0) throw new Error('Informe membro e tempo validos.');

      if (action === 'edit_modal') {
        events.editParticipantReview({ eventId, actorId: interaction.user.id, discordId: targetId, role, minutes, reason });
      } else {
        events.addParticipantReview({ eventId, actorId: interaction.user.id, discordId: targetId, role, minutes, reason });
      }
      await updateReviewMessage(interaction, eventId, messageId);
      return interaction.editReply({ content: 'Participacao atualizada e split recalculado.' });
    }

    if (action === 'remove_modal') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const targetId = cleanUserId(interaction.fields.getTextInputValue('userId'));
      const reason = interaction.fields.getTextInputValue('reason') || 'Removido da revisao';
      if (!targetId) throw new Error('Informe um membro valido.');
      events.removeParticipantReview({ eventId, actorId: interaction.user.id, discordId: targetId, reason });
      await updateReviewMessage(interaction, eventId, messageId);
      return interaction.editReply({ content: 'Participante removido e split recalculado.' });
    }
  }

  if (interaction.customId === 'finance:withdraw_modal') {
    const rawAmount = interaction.fields.getTextInputValue('amount');
    const amount = parseWithdrawAmount(rawAmount);
    const note = interaction.fields.getTextInputValue('note');
    const draft = finance.createWithdrawDraft({ userId: interaction.user.id, amount, note, rawAmount });
    const balance = financeRepo.getBalance(interaction.user.id);
    return interaction.reply({
      content: [
        'Confira seu pedido de saque antes de enviar para a staff:',
        `Digitado: \`${rawAmount}\``,
        `Valor do saque: **${formatSilver(amount)}**`,
        `Seu saldo atual: **${formatSilver(balance)}**`,
        'Confirma que esse valor esta correto?'
      ].join('\n'),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`finance:confirm_withdraw:${draft.id}`).setLabel('Confirmar saque').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`finance:cancel_withdraw:${draft.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'finance:payment_request_modal') {
    const rawAmount = interaction.fields.getTextInputValue('amount');
    const amount = parseSilver(rawAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error('Valor de pedido invalido. Informe um valor maior que zero. Ex: 12m ou 12000000.');
    }
    const service = interaction.fields.getTextInputValue('service').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    const evidence = interaction.fields.getTextInputValue('evidence').trim();
    if (!service || !description) {
      throw new Error('Informe o que voce fez e o motivo/descricao do pedido.');
    }
    const draft = finance.createPaymentRequestDraft({
      userId: interaction.user.id,
      amount,
      service,
      description,
      evidence
    });
    return interaction.reply({
      content: [
        'Confira seu pedido de pagamento antes de enviar para a staff:',
        `Digitado: \`${rawAmount}\``,
        `Valor pedido: **${formatSilver(amount)}**`,
        `Servico: **${truncateText(service, 180)}**`,
        `Motivo: ${truncateText(description, 500)}`,
        evidence ? `Prova: ${truncateText(evidence, 300)}` : 'Prova: nao informada',
        '',
        'Confirma que esse pedido esta correto?'
      ].join('\n'),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`finance:confirm_payment_request:${draft.id}`).setLabel('Enviar para staff').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`finance:cancel_payment_request:${draft.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'deposit:create_modal') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar deposito.', flags: MessageFlags.Ephemeral });
    }

    const draft = deposit.createDraft({
      actorId: interaction.user.id,
      lootTotal: parseSilver(interaction.fields.getTextInputValue('lootTotal')),
      repair: parseSilver(interaction.fields.getTextInputValue('repair')),
      silverBags: parseSilver(interaction.fields.getTextInputValue('silverBags')),
      taxPercent: intField(interaction.fields, 'taxPercent')
    });

    return interaction.reply({
      content: 'Deposito criado. Selecione os participantes abaixo usando a busca do Discord.',
      embeds: [deposit.draftEmbed(draft)],
      components: deposit.draftComponents(draft.id),
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === 'deposit:create_list_modal') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar deposito por lista.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const draft = await deposit.createListDraft({
      actorId: interaction.user.id,
      guild: interaction.guild,
      totalAmount: parseSilver(interaction.fields.getTextInputValue('totalAmount')),
      reason: fieldOrDefault(interaction, 'reason', 'Deposito por lista'),
      rawList: interaction.fields.getTextInputValue('names')
    });

    return interaction.editReply({
      content: 'Previa do deposito por lista. Confira nomes e valores antes de confirmar.',
      embeds: [deposit.listDraftEmbed(draft)],
      components: deposit.listDraftComponents(draft.id, draft.matched.length > 0)
    });
  }

  if (interaction.customId === 'balance_reversal:create_modal') {
    if (!can(interaction.member, 'withdrawBalance')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar estorno.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const confirmation = interaction.fields.getTextInputValue('confirmation').trim().toUpperCase();
    if (confirmation !== 'CONFIRMAR') {
      return interaction.editReply({ content: 'Digite CONFIRMAR para gerar a previa do estorno. Nenhum saldo foi alterado.' });
    }
    const percentage = Number(String(interaction.fields.getTextInputValue('percentage')).replace(',', '.'));
    const draft = await balanceReversal.createDraft({
      actorId: interaction.user.id,
      guild: interaction.guild,
      percentage,
      reason: interaction.fields.getTextInputValue('reason').trim(),
      rawList: interaction.fields.getTextInputValue('list')
    });
    return interaction.editReply({
      content: balanceReversal.canConfirm(draft)
        ? 'Confira a previa. Clique em Confirmar estorno para retirar os saldos.'
        : 'A lista precisa ser corrigida. Nenhum saldo foi alterado.',
      embeds: [balanceReversal.draftEmbed(draft)],
      components: balanceReversal.draftComponents(draft)
    });
  }

  if (interaction.customId === 'admin:remove_balance_modal') {
    if (!can(interaction.member, 'withdrawBalance')) {
      return interaction.reply({ content: 'Voce nao tem permissao para retirar saldo.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const targetRaw = interaction.fields.getTextInputValue('userId').trim();
    const targetId = targetRaw.replace(/[<@!>]/g, '');
    const amount = Math.abs(parseSilver(interaction.fields.getTextInputValue('amount')));
    const reason = interaction.fields.getTextInputValue('reason').trim();
    const confirmation = interaction.fields.getTextInputValue('confirmation').trim();
    const before = financeRepo.getBalance(targetId);
    const after = before - amount;
    if (after < 0 && confirmation !== 'CONFIRMAR') {
      return interaction.editReply({ content: 'Essa retirada deixa saldo negativo. Digite CONFIRMAR no campo de confirmacao.' });
    }
    finance.applyBalanceTransaction({
      type: 'manual_remove',
      userId: targetId,
      amount: -amount,
      reason,
      referenceType: 'admin_panel',
      referenceId: null,
      createdBy: interaction.user.id
    });
    await finance.notifyBalanceTransactions({
      client: interaction.client,
      transactions: [{
        userId: targetId,
        amount: -amount,
        reason,
        afterBalance: after
      }]
    });
    await safeSend(interaction.client, ids.channels.bankLogs, {
      content: `Saldo retirado de <@${targetId}>: -${formatSilver(amount)} por <@${interaction.user.id}>. Motivo: ${reason}`
    });
    return interaction.editReply({ content: `Saldo retirado. Novo saldo: ${formatSilver(after)}.` });
  }
}

function cleanUserId(value) {
  return String(value || '').trim().replace(/[<@!>]/g, '');
}

function parseSlots(value) {
  const numbers = String(value || '').match(/\d+/g) || [];
  return numbers.slice(0, 4).map((number) => Number.parseInt(number, 10));
}

function fieldOrDefault(interaction, id, fallback) {
  const value = interaction.fields.getTextInputValue(id).trim();
  return value || fallback;
}

function defaultAlbionTime(minutesAhead) {
  const albionTime = new Date(Date.now() + minutesAhead * 60 * 1000);
  const hours = String(albionTime.getUTCHours()).padStart(2, '0');
  const minutes = String(albionTime.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function recoverEventCreation(interaction, contentType, values, error) {
  const retryId = eventCreationRecovery.remember({ creatorId: interaction.user.id, contentType, values });
  return safeEditReply(interaction, {
    content: `Não foi possível criar o evento: ${error.message}\nSeus dados foram mantidos por 30 minutos.`,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`event_create_retry:open:${retryId}`)
        .setLabel('Corrigir e tentar novamente')
        .setStyle(ButtonStyle.Primary)
    )]
  });
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const aliases = {
    t: 'tank',
    tanque: 'tank',
    tank: 'tank',
    tanks: 'tank',
    h: 'healer',
    healer: 'healer',
    healers: 'healer',
    heal: 'healer',
    healeres: 'healer',
    cura: 'healer',
    curandeiro: 'healer',
    curandeira: 'healer',
    s: 'support',
    suporte: 'support',
    suport: 'support',
    support: 'support',
    supports: 'support',
    sup: 'support',
    d: 'dps',
    dps: 'dps',
    dano: 'dps',
    damage: 'dps'
  };
  if (!aliases[role]) throw new Error('Funcao invalida. Exemplos aceitos: tank, tanque, healer, cura, sup, suporte, dps, dano.');
  return aliases[role];
}

function roleLabel(role) {
  const labels = {
    tank: 'Tank',
    healer: 'Healer',
    support: 'Suporte',
    dps: 'DPS'
  };
  return labels[role] || role;
}

function parseMinutes(value) {
  const text = String(value || '').trim().toLowerCase().replace(',', '.');
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*h/);
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*m/);
  if (hourMatch || minuteMatch) {
    return (hourMatch ? Number(hourMatch[1]) * 60 : 0) + (minuteMatch ? Number(minuteMatch[1]) : 0);
  }
  const minutes = Number.parseFloat(text);
  if (Number.isNaN(minutes)) throw new Error('Tempo invalido. Use minutos. Ex: 75 para 1h15min.');
  return minutes;
}

function parseWithdrawAmount(value) {
  const text = String(value || '').trim().replace(/\s+/g, '');
  if (!/^\d+$/.test(text)) {
    throw new Error('Valor de saque invalido. Digite somente numeros, sem ponto, virgula, letra ou simbolo. Ex: 1000000');
  }
  const amount = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('Valor de saque invalido. Digite um numero inteiro maior que zero.');
  }
  return amount;
}

async function updateReviewMessage(interaction, eventId, messageId) {
  const message = messageId ? await interaction.channel?.messages.fetch(messageId).catch(() => null) : null;
  if (message) {
    await message.edit({
      embeds: [events.reviewEmbed(eventId)],
      components: events.reviewComponents(eventId, 'review')
    });
  }
}

module.exports = {
  handleModal
};

function truncateText(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function customEventStepRow(nextCustomId, nextLabel, draftId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(nextCustomId).setLabel(nextLabel).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`custom_event:cancel:${draftId}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
  );
}

function updateCustomWizardMessage(interaction, payload) {
  if (interaction.isFromMessage?.()) {
    return interaction.update(payload);
  }
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

async function deferCustomWizardMessage(interaction) {
  if (!interaction.isFromMessage?.()) {
    return safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
  }
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferUpdate();
    return true;
  } catch (error) {
    if (error?.code === 10062 || error?.code === 40060) return false;
    throw error;
  }
}
