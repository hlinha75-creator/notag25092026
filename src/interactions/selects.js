const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const events = require('../modules/events/events.service');
const eventsRepo = require('../modules/events/events.repository');
const deposit = require('../modules/deposit/deposit.service');
const memberProfile = require('../modules/members/profile.service');
const { can } = require('../config/permissions');
const customEventWizard = require('../modules/events/customEventWizard.service');
const customEventWizardComponents = require('../modules/events/customEventWizard.components');
const eventNotificationPreferences = require('../modules/events/eventNotificationPreferences.service');
const eventTypes = require('../modules/events/eventTypes');
const groupDungeonWizard = require('../modules/events/groupDungeonWizard.service');
const sponsoredCtaBuilds = require('../modules/events/sponsoredCtaBuilds.service');
const customEventWeaponCatalog = require('../modules/events/customEventWeaponCatalog.service');
const compositionRules = require('../modules/events/compositionRules');
const weaponSelectionModes = require('../modules/events/weaponSelectionModes');
const eventTemplateComponents = require('../modules/events/eventTemplates.components');

async function handleSelect(interaction) {
  const [scope, action, id, messageId, extra] = interaction.customId.split(':');
  if (['auction_channel_select', 'faq_tutorial', 'poll'].includes(scope)) {
    return pausedFeatureReply(interaction);
  }

  if (scope === 'event_create_type' && action === 'select') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar evento.', flags: MessageFlags.Ephemeral });
    }
    const contentType = eventTypes.normalizeEventType(interaction.values[0]);
    const kind = eventTypes.creationKindFor(contentType);
    const saved = eventsRepo.listSavedEventConfigurations(interaction.user.id, kind, contentType, 25);
    if (saved.length) return interaction.update(savedEventConfigurationsPayload(kind, contentType, saved));
    const recent = eventsRepo.listRecentEventConfigurations(interaction.user.id, kind, 5, contentType);
    if (recent.length) return interaction.update(eventTypeReusePayload(kind, contentType, recent));
    if (['raid', 'world'].includes(kind)) return interaction.update(specialWeaponModePayload(kind, contentType));
    return showEventTemplateModal(interaction, kind, null, contentType);
  }

  if (scope === 'event_special_mode' && action === 'select') {
    const contentType = messageId;
    const kind = id;
    const mode = weaponSelectionModes.normalize(interaction.values[0]);
    return showEventTemplateModal(interaction, kind, { _weaponMode: mode }, contentType);
  }

  if (scope === 'visual_composition_mode' && action === 'select') {
    const draft = customEventWizard.setCompositionMode({
      id,
      creatorId: interaction.user.id,
      mode: interaction.values[0]
    });
    await interaction.deferUpdate();
    draft.rulesSnapshot = await compositionRules.loadSnapshot(draft.contentType);
    await Promise.all([
      interaction.client.application?.emojis?.fetch?.().catch(() => null),
      interaction.guild?.emojis?.fetch?.().catch(() => null)
    ]);
    const catalog = sponsoredCtaBuilds.attachAvailableEmojis(
      customEventWeaponCatalog.mergeCatalog([]),
      interaction.client,
      interaction.guild
    );
    customEventWizard.setCatalog({ id: draft.id, creatorId: interaction.user.id, builds: catalog });
    if (draft.compositionMode !== 'predefined') {
      return interaction.editReply(await groupDungeonWizard.completionPayload({
        client: interaction.client,
        guild: interaction.guild,
        draft
      }));
    }
    return interaction.editReply(customEventWizardComponents.compositionPayload(
      customEventWizard.compositionStep({ id: draft.id, creatorId: interaction.user.id })
    ));
  }

  if (scope === 'event_weapon_family' && action === 'select') {
    const role = messageId;
    const familyKey = interaction.values[0];
    await interaction.deferUpdate();
    const familyBuilds = customEventWeaponCatalog.weaponsForFamily(
      customEventWeaponCatalog.mergeCatalog([]),
      role,
      familyKey
    );
    await sponsoredCtaBuilds.ensureAvailableEmojis(familyBuilds, interaction.client, interaction.guild);
    const options = events.visualWeaponsForFamily(Number(id), role, familyKey, interaction.client, interaction.guild);
    if (!options.length) {
      return interaction.editReply({ content: 'Não há armas disponíveis nessa família para a regra atual.', components: [] });
    }
    return interaction.editReply({
      content: `Escolha a arma de **${roleLabel(role)}**. A regra da planilha aparece na descrição:`,
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`event_weapon:select:${id}:${role}:${familyKey}`)
          .setPlaceholder('Escolha sua arma')
          .addOptions(options)
      )]
    });
  }

  if (scope === 'event_weapon' && action === 'select') {
    try {
      const build = await events.joinVisualEventWeapon(interaction, Number(id), messageId, interaction.values[0]);
      return interaction.update({ content: `Você entrou como **${roleLabel(messageId)} — ${build.name}**.`, components: [] });
    } catch (error) {
      return interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
    }
  }

  if (scope === 'group_dungeon_forum' && action === 'select') {
    await interaction.deferUpdate();
    const draft = await groupDungeonWizard.selectForum({
      client: interaction.client,
      guild: interaction.guild,
      draftId: id,
      creatorId: interaction.user.id,
      channelId: interaction.values[0]
    });
    return interaction.editReply(groupDungeonWizard.nextPayload(draft));
  }

  if (scope === 'event_notification_types' && action === 'select') {
    eventNotificationPreferences.savePreference(interaction.user.id, {
      enabled: true,
      eventTypes: interaction.values
    });
    const { flags, ...payload } = eventNotificationPreferences.preferencePayload(
      interaction.user.id,
      'Tipos de evento atualizados.'
    );
    return interaction.update(payload);
  }

  if (scope === 'event_template' && action === 'select') {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Voce nao tem permissao para criar evento.', flags: MessageFlags.Ephemeral });
    }
    const previous = eventsRepo.getEventConfiguration(interaction.user.id, id, interaction.values[0]);
    if (!previous) {
      return interaction.reply({ content: 'Esse modelo nao esta mais disponivel.', flags: MessageFlags.Ephemeral });
    }
    return showEventTemplateModal(interaction, id, previous, messageId);
  }

  if (scope === 'event_saved' && ['select', 'delete'].includes(action)) {
    if (!can(interaction.member, 'createEvent')) {
      return interaction.reply({ content: 'Você não tem permissão para gerenciar configurações.', flags: MessageFlags.Ephemeral });
    }
    const templateId = interaction.values[0];
    if (action === 'delete') {
      if (!eventsRepo.deleteSavedEventConfiguration(interaction.user.id, templateId)) {
        return interaction.reply({ content: 'Essa configuração já não existe.', flags: MessageFlags.Ephemeral });
      }
      const remaining = eventsRepo.listSavedEventConfigurations(interaction.user.id, id, messageId, 25);
      return interaction.update(remaining.length
        ? savedEventConfigurationsPayload(id, messageId, remaining, 'Configuração excluída. O evento original foi preservado.')
        : { content: 'Configuração excluída. O evento original foi preservado. Você pode criar do zero.', components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`event_create:new:${id}:${messageId}`).setLabel('Criar do zero').setStyle(ButtonStyle.Primary)
          )] });
    }
    const previous = eventsRepo.getSavedEventConfiguration(interaction.user.id, templateId);
    if (!previous) return interaction.reply({ content: 'Essa configuração já não existe.', flags: MessageFlags.Ephemeral });
    previous._savedId = Number(templateId);
    return showEventTemplateModal(interaction, id, previous, messageId);
  }

  if (scope === 'event_notification_phases' && action === 'select') {
    eventNotificationPreferences.savePreference(interaction.user.id, {
      enabled: true,
      phases: interaction.values
    });
    const { flags, ...payload } = eventNotificationPreferences.preferencePayload(
      interaction.user.id,
      'Horários de aviso atualizados.'
    );
    return interaction.update(payload);
  }

  if (scope === 'custom_event_policy' && action === 'select') {
    let draft = customEventWizard.setDpsPolicy({
      id,
      creatorId: interaction.user.id,
      policy: interaction.values[0]
    });
    draft = customEventWizard.setRulesSnapshot({
      id,
      creatorId: interaction.user.id,
      rulesSnapshot: await compositionRules.loadSnapshot('cta')
    });
    const labels = {
      caller: 'O caller define as armas e quantidades.',
      free: 'Cada DPS escolhe a arma, respeitando as regras da planilha.',
      limited: 'Cada DPS escolhe, respeitando o limite configurado por arma.',
      predefined: 'O caller define as armas antes de publicar.',
      role_free: 'Cada DPS entra pela função, sem precisar informar arma.',
      sheet_limited: 'Cada DPS informa a arma e respeita as regras da planilha.',
      weapon_declared: 'Cada DPS informa a arma, sem limite de repetição.'
    };
    return interaction.update({
      content: `${labels[draft.dpsPolicy]} Continue para configurar loot e requisitos.`,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`custom_event:details:${draft.id}`)
          .setLabel('Continuar: loot e requisitos')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`custom_event:cancel:${draft.id}`)
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Danger)
      )]
    });
  }

  if (scope === 'custom_event_build' && action === 'select') {
    const position = Number(messageId);
    const next = customEventWizard.selectBuild({
      id,
      creatorId: interaction.user.id,
      position,
      buildKey: interaction.values[0]
    });
    if (!next.complete) return interaction.update(customEventWizardComponents.compositionPayload(next));

    await interaction.deferUpdate();
    const event = await events.createCustomEventFromDraft(interaction, next.draft);
    customEventWizard.removeDraft(id, interaction.user.id);
    return interaction.editReply({
      content: `CTA ${event.event_code} criado com a composicao do catalogo.`,
      embeds: [],
      components: eventTemplateComponents.saveConfigurationComponents(event.id, 'custom', 'cta')
    });
  }

  if (scope === 'custom_event_family' && action === 'select') {
    const position = Number(messageId);
    const step = customEventWizard.compositionStep({
      id,
      creatorId: interaction.user.id,
      position
    });
    const familyKey = interaction.values[0];
    await interaction.deferUpdate();
    const familyBuilds = customEventWeaponCatalog.weaponsForFamily(step.draft.catalog, step.slot.role, familyKey);
    const enriched = await sponsoredCtaBuilds.ensureAvailableEmojis(
      familyBuilds,
      interaction.client,
      interaction.guild
    );
    const enrichedByKey = new Map(enriched.map((build) => [build.key, build]));
    customEventWizard.setCatalog({
      id,
      creatorId: interaction.user.id,
      builds: step.draft.catalog.map((build) => enrichedByKey.get(build.key) || build)
    });
    const refreshed = customEventWizard.compositionStep({ id, creatorId: interaction.user.id, position });
    return interaction.editReply(customEventWizardComponents.weaponPayload(refreshed, familyKey));
  }

  if (scope === 'custom_event_weapon' && action === 'select') {
    const selection = customEventWizard.setSlotBuild({
      id,
      creatorId: interaction.user.id,
      position: Number(messageId),
      familyKey: extra,
      buildKey: interaction.values[0]
    });
    return interaction.update(customEventWizardComponents.selectionPayload(selection));
  }

  if (scope === 'event' && action === 'join') {
    const role = interaction.values[0];
    if (eventsRepo.getCustomEventMeta(Number(id)) || eventsRepo.getVisualEventBuildMeta(Number(id))) {
      const options = events.customEventSlotOptions(Number(id), role, interaction.user.id);
      const choosingDpsWeapon = role === 'dps' && eventsRepo.listCustomEventDpsWeapons(Number(id)).length > 0;
      if (options.length === 0) {
        return interaction.update({ content: `Nao ha vagas livres para ${roleLabel(role)}.`, components: [] });
      }
      return interaction.update({
        content: choosingDpsWeapon
          ? 'Agora escolha qual arma de DPS você vai usar. A composição será atualizada para todos.'
          : `Agora escolha exatamente qual vaga de **${roleLabel(role)}** voce quer:`,
        components: customSlotSelectRows(Number(id), role, options)
      });
    }
    try {
      await events.joinEvent(interaction, Number(id), role);
    } catch (error) {
      if (String(error.message || '').includes('Nao ha vaga')) {
        return interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
      }
      throw error;
    }
    return interaction.reply({ content: `Voce entrou como ${roleLabel(role)}.`, flags: MessageFlags.Ephemeral });
  }

  if (scope === 'event_custom_slot' && action === 'join') {
    const [role, slotIndex] = interaction.values[0].split('|');
    if (role === 'dps_weapon') {
      try {
        const weapon = await events.joinCustomEventDpsWeapon(interaction, Number(id), slotIndex);
        return interaction.update({ content: `Você entrou como **DPS — ${weapon.weapon_label}**.`, components: [] });
      } catch (error) {
        return interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
      }
    }
    try {
      await events.joinCustomEventSlot(interaction, Number(id), role, Number(slotIndex));
    } catch (error) {
      if (String(error.message || '').includes('vaga')) {
        return interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
      }
      throw error;
    }
    const event = eventsRepo.getEvent(Number(id));
    const isLooter = role === 'dps' && Number(slotIndex) === Number(event?.dps_slots);
    const label = isLooter ? 'Looter' : `${roleLabel(role)} ${slotIndex}`;
    return interaction.update({ content: `Voce entrou na vaga **${label}**.`, components: [] });
  }

  if (scope === 'event_manage_player_select' && action === 'select') {
    const eventId = Number(id);
    const event = eventsRepo.getEvent(eventId);
    if (!event || event.status !== 'running') {
      return interaction.update({ content: 'O evento nao esta em andamento.', components: [] });
    }
    if (event.creator_id !== interaction.user.id && !can(interaction.member, 'assumeEvent')) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode gerenciar os jogadores.', flags: MessageFlags.Ephemeral });
    }
    const discordId = interaction.values[0];
    const participant = eventsRepo.getParticipant({ eventId, discordId });
    if (!participant || participant.is_spectator || participant.is_paused) {
      return interaction.update({ content: 'Esse jogador nao esta na composicao ativa.', components: [] });
    }
    const roles = events.managedParticipantRoleOptions(eventId, discordId);
    const buttons = roles.map((role) => new ButtonBuilder()
      .setCustomId(`event_manage_player:role_${role}:${eventId}:${discordId}`)
      .setLabel(`Mover para ${roleLabel(role)}`)
      .setStyle(ButtonStyle.Primary));
    buttons.push(new ButtonBuilder()
      .setCustomId(`event_manage_player:pause:${eventId}:${discordId}`)
      .setLabel('Remover da composicao')
      .setStyle(ButtonStyle.Danger));
    return interaction.update({
      content: [
        `Gerenciando <@${discordId}>. Funcao atual: **${roleLabel(participant.role)}**.`,
        'Escolha uma nova funcao ou remova o jogador da composicao.'
      ].join('\n'),
      components: [new ActionRowBuilder().addComponents(buttons)],
      allowedMentions: { parse: [] }
    });
  }

  if (scope === 'event_manage_slot' && action === 'assign') {
    const eventId = Number(id);
    const event = eventsRepo.getEvent(eventId);
    if (!event || event.status !== 'running') {
      return interaction.update({ content: 'O evento nao esta em andamento.', components: [] });
    }
    if (event.creator_id !== interaction.user.id && !can(interaction.member, 'assumeEvent')) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode gerenciar os jogadores.', flags: MessageFlags.Ephemeral });
    }
    const [selectedRole, selectedValue] = interaction.values[0].split('|');
    const role = selectedRole === 'dps_weapon' ? 'dps' : selectedRole;
    const weaponKey = selectedRole === 'dps_weapon' ? selectedValue : null;
    const slotIndex = weaponKey ? null : selectedValue;
    await events.reassignManagedParticipant(interaction, {
      eventId,
      discordId: messageId,
      role,
      slotIndex: slotIndex == null ? null : Number(slotIndex),
      weaponKey
    });
    if (weaponKey) {
      const weapon = eventsRepo.listCustomEventDpsWeapons(eventId).find((candidate) => candidate.weapon_key === weaponKey);
      return interaction.update({
        content: `<@${messageId}> agora ocupa **DPS — ${weapon?.weapon_label || 'arma selecionada'}**.`,
        components: [],
        allowedMentions: { parse: [] }
      });
    }
    const slot = eventsRepo.listCustomEventSlots(eventId).find((candidate) => (
      candidate.role === role && Number(candidate.slot_index) === Number(slotIndex)
    ));
    return interaction.update({
      content: `<@${messageId}> agora ocupa **${slot?.slot_label || roleLabel(role)}**.`,
      components: [],
      allowedMentions: { parse: [] }
    });
  }

  if (scope === 'event_raid_weapon_select' && action === 'weapon') {
    const role = messageId;
    const weaponKey = interaction.values[0];
    const weapon = events.raidWeaponName(role, weaponKey, Number(id));
    const raidLabel = eventsRepo.getEvent(Number(id))?.content_type === 'raid_dragon' ? 'Raid Dragão' : 'Raid Full';
    return showModal(interaction, `event:raid_join:${id}:${role}:${weaponKey}`, `${raidLabel} - ${weapon}`, [
      input('itemPower', 'IP da arma', '', 'Ex: 1500')
    ]);
  }

  if (scope === 'event_raid_weapon_select' && action === 'slot') {
    const [role, weaponKey] = interaction.values[0].split('|');
    const weapon = events.raidWeaponName(role, weaponKey, Number(id));
    const raidLabel = eventsRepo.getEvent(Number(id))?.content_type === 'raid_dragon' ? 'Raid Dragão' : 'Raid Full';
    return showModal(interaction, `event:raid_join:${id}:${role}:${weaponKey}`, `${raidLabel} - ${weapon}`, [
      input('itemPower', 'IP da arma', '', 'Ex: 1500')
    ]);
  }

  if (scope === 'event_world_boss_slot' && action === 'slot') {
    const slotKey = interaction.values[0];
    const slot = events.worldBossSlot(slotKey);
    if (!slot) throw new Error('Vaga de World Boss invalida.');
    return interaction.update({
      content: worldBossConfirmationText(slot.label),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`event:wb_confirm:${id}:${slotKey}`).setLabel('Confirmar funcao').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`event:wb_abort:${id}:${slotKey}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }

  if (scope === 'event_world_boss_slot' && action === 'remove') {
    const slot = await events.removeWorldBossSlot(interaction, Number(id), interaction.values[0]);
    return interaction.update({ content: `Vaga liberada: **${slot.label}**.`, components: [] });
  }

  if (scope === 'event_review_select') {
    const eventId = Number(id);
    const event = eventsRepo.getEvent(eventId);
    if (!event) throw new Error('Evento nao encontrado.');
    if (event.creator_id !== interaction.user.id && !can(interaction.member, 'assumeEvent')) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode editar a revisao.', flags: MessageFlags.Ephemeral });
    }

    const discordId = interaction.values[0];
    const participant = eventsRepo.getParticipant({ eventId, discordId });
    if (!participant) throw new Error('Participante nao encontrado.');

    if (action === 'edit') {
      const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
      return showModal(interaction, `event_review:edit_modal:${eventId}:${messageId}`, 'Editar membro do split', [
        input('userId', 'Membro', discordId),
        input('role', 'Funcao', roleLabel(participant.role), 'Ex: tank, healer, sup, dps'),
        input('minutes', 'Tempo contado em minutos', String(Math.round(seconds / 60)), 'Ex: 75 para 1h15min'),
        input('reason', 'Motivo do ajuste', '', 'Ex: caiu da call e voltou', false)
      ]);
    }

    if (action === 'remove') {
      return showModal(interaction, `event_review:remove_modal:${eventId}:${messageId}`, 'Remover membro do split', [
        input('userId', 'Membro', discordId),
        input('reason', 'Motivo da remocao', '', 'Ex: estava como espectador', false)
      ]);
    }
  }

  if (scope === 'event_review_user_select') {
    const eventId = Number(id);
    const event = eventsRepo.getEvent(eventId);
    if (!event) throw new Error('Evento nao encontrado.');
    if (event.creator_id !== interaction.user.id && !can(interaction.member, 'assumeEvent')) {
      return interaction.reply({ content: 'Somente o criador ou alguem autorizado pode editar a revisao.', flags: MessageFlags.Ephemeral });
    }

    const discordId = interaction.values[0];

    if (action === 'add') {
      return showModal(interaction, `event_review:add_modal:${eventId}:${messageId}`, 'Adicionar membro ao split', [
        input('userId', 'Membro', discordId),
        input('role', 'Funcao', '', 'Ex: tank, healer, sup, dps'),
        input('minutes', 'Tempo contado em minutos', '', 'Ex: 75 para 1h15min'),
        input('reason', 'Motivo da inclusao', '', 'Ex: entrou depois e nao clicou participar', false)
      ]);
    }

    const participant = eventsRepo.getParticipant({ eventId, discordId });
    if (!participant) {
      return interaction.reply({
        content: 'Esse membro ainda nao esta no split. Use Adicionar membro para colocar ele na revisao.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (action === 'edit') {
      const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
      return showModal(interaction, `event_review:edit_modal:${eventId}:${messageId}`, 'Editar membro do split', [
        input('userId', 'Membro', discordId),
        input('role', 'Funcao', roleLabel(participant.role), 'Ex: tank, healer, sup, dps'),
        input('minutes', 'Tempo contado em minutos', String(Math.round(seconds / 60)), 'Ex: 75 para 1h15min'),
        input('reason', 'Motivo do ajuste', '', 'Ex: caiu da call e voltou', false)
      ]);
    }

    if (action === 'remove') {
      return showModal(interaction, `event_review:remove_modal:${eventId}:${messageId}`, 'Remover membro do split', [
        input('userId', 'Membro', discordId),
        input('reason', 'Motivo da remocao', '', 'Ex: estava como espectador', false)
      ]);
    }
  }

  if (scope === 'admin_remove_balance_select') {
    if (!can(interaction.member, 'withdrawBalance')) {
      return interaction.reply({ content: 'Sem permissao para retirar saldo.', flags: MessageFlags.Ephemeral });
    }

    const discordId = interaction.values[0];
    return showModal(interaction, 'admin:remove_balance_modal', 'Retirar Saldo', [
      input('userId', 'Membro', discordId),
      input('amount', 'Valor', '', 'Ex: 1000000 ou 1m'),
      input('reason', 'Motivo', '', 'Ex: saque pago, ajuste manual'),
      input('confirmation', 'CONFIRMAR se ficar negativo', '', 'Digite CONFIRMAR se o saldo ficar negativo', false)
    ]);
  }

  if (scope === 'admin_profile_select') {
    if (!can(interaction.member, 'approveRegistration') && !can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para ver perfil de membro.', flags: MessageFlags.Ephemeral });
    }
    const discordId = interaction.values[0];
    return interaction.reply({ ...(await memberProfile.memberProfilePayload(discordId, interaction.guild)), flags: MessageFlags.Ephemeral });
  }

  if (scope === 'deposit_select') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissao para editar deposito.', flags: MessageFlags.Ephemeral });
    }

    const draft = deposit.addParticipants({ draftId: id, userIds: interaction.values });
    await interaction.update({
      content: 'Participantes atualizados. Voce pode selecionar mais membros ou confirmar o deposito.',
      embeds: [deposit.draftEmbed(draft)],
      components: deposit.draftComponents(draft.id)
    });
  }

  if (!interaction.replied && !interaction.deferred) {
    return interaction.reply({
      content: 'Este menu está desatualizado. Clique novamente em **Criar Evento** para abrir a versão atual.',
      flags: MessageFlags.Ephemeral
    });
  }
  return null;
}

module.exports = {
  handleSelect
};

function pausedFeatureReply(interaction) {
  return interaction.reply({
    content: 'Esse recurso foi pausado para simplificar o bot. Use os paineis principais de evento, saldo, registro ou ADM.',
    flags: MessageFlags.Ephemeral
  });
}

function showModal(interaction, customId, title, inputs) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(inputs.map((component) => new ActionRowBuilder().addComponents(component)));
  return interaction.showModal(modal);
}

function input(id, label, value = '', placeholder = null, required = true) {
  const component = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setRequired(required);
  if (value) component.setValue(value);
  if (placeholder) component.setPlaceholder(placeholder);
  return component;
}

function showEventTemplateModal(interaction, kind, previous = null, contentType = null) {
  if (kind === 'custom') {
    const composition = previous
      ? [previous.tank_slots, previous.healer_slots, previous.support_slots, previous.dps_slots].join(',')
      : '';
    const description = input('description', 'Descrição', previous?.description || '', 'Montaria, food, poção, OC, swap etc.', false)
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1000);
    const customId = previous?._savedId
      ? `event:custom_basic:saved:${previous._savedId}`
      : previous ? `event:custom_basic:reuse:${previous.id}` : 'event:custom_basic';
    return showModal(interaction, customId, 'Criar CTA', [
      input('title', 'Título', previous?.title || '', 'Ex: Fame Farm T6').setMaxLength(100),
      input('scheduledTime', 'Data e hora (UTC)', '', 'Ex: 21:00 (hoje) ou 25/08 22:00'),
      input('location', 'Local', previous?.location || '', 'Ex: Portal de Bridgewatch').setMaxLength(100),
      description,
      input('composition', 'Tank, Healer, Suporte, DPS', composition, 'Ex: 2,2,2,14').setMaxLength(40)
    ]);
  }
  if (kind === 'raid') {
    const mode = previous?.composition_mode || previous?._weaponMode || 'predefined';
    const selectedType = contentType || previous?.content_type || 'raid_avalon';
    const isDragonRaid = selectedType === 'raid_dragon';
    const modalAction = isDragonRaid ? 'create_raid_dragon' : 'create_raid_full';
    const modalTitle = isDragonRaid ? 'Criar Raid Dragão' : 'Raid Avalon Full';
    return showModal(interaction, `event:${modalAction}:${weaponSelectionModes.normalize(mode)}`, modalTitle, [
      input('scheduledTime', 'Dia e hora Albion', '', 'Ex: hoje 20:30 ou 16/06 20:30'),
      input('location', 'We mass from', previous?.location || '', 'Ex: Bridgewatch Portal').setMaxLength(100),
      input('dungeonTier', isDragonRaid ? 'Tier da Raid' : 'Tier da DG', previous?.dungeon_tier || '', 'Ex: T8.1').setMaxLength(40),
      input('buildTier', 'Tier da build', previous?.build_tier || '', 'Ex: T8 equivalente').setMaxLength(80),
      input(
        'observation',
        'Observacao',
        events.raidObservationText(previous?.description),
        'Ex: Chegue 30 min antes se precisar de build',
        false
      ).setStyle(TextInputStyle.Paragraph).setMaxLength(500)
    ]);
  }
  if (kind === 'world') {
    const mode = previous?.composition_mode || previous?._weaponMode || 'predefined';
    return showModal(interaction, `event:create_world_boss:${weaponSelectionModes.normalize(mode)}`, 'Criar World Boss', [
      input('eventDate', 'Data do Farm', '', 'Ex: 20/07/2026')
    ]);
  }
  const slots = previous
    ? [previous.tank_slots, previous.healer_slots, previous.support_slots, previous.dps_slots].join(',')
    : '';
  const selectedType = contentType || previous?.content_type || 'other';
  const customId = previous
    ? `event:create:${selectedType}:${previous._savedId ? 'saved' : 'reuse'}:${previous._savedId || previous.id}`
    : `event:create:${selectedType}`;
  return showModal(interaction, customId, `Criar ${eventTypes.eventTypeLabel(selectedType)}`, [
    input('title', 'Content', previous?.title || '', 'Ex: DG Grupo T8+', false).setMaxLength(80),
    input('location', 'Local', previous?.location || '', 'Ex: Martlock Portal > HO Loch', false).setMaxLength(100),
    input('scheduledTime', 'Data/Hora', '', 'Ex: 23/06 15:00 utc', false),
    input('description', 'Tier da Build', previous?.description || '', 'Ex: T8 equivalente + set Skip', false).setMaxLength(500),
    input('slots', 'Tank, Healer, Suporte, DPS', slots, 'Ex: 1,1,1,3', false).setMaxLength(40)
  ]);
}

function specialWeaponModePayload(kind, contentType) {
  return {
    content: `Escolha como as armas funcionarão em **${eventTypes.eventTypeLabel(contentType)}**:`,
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`event_special_mode:select:${kind}:${contentType}`)
        .setPlaceholder('Escolha o modo das armas')
        .addOptions(weaponSelectionModes.options())
    )]
  };
}

function savedEventConfigurationsPayload(kind, contentType, saved, notice = '') {
  const typeLabel = eventTypes.eventTypeLabel(contentType);
  const options = saved.map((template) => ({
    label: String(template.name).slice(0, 100),
    value: String(template.id),
    description: String(`${template.title} • ${template.tank_slots}/${template.healer_slots}/${template.support_slots}/${template.dps_slots}`).slice(0, 100)
  }));
  return {
    content: [notice, `Configurações salvas de **${typeLabel}**. Usar ou excluir uma configuração não altera eventos anteriores.`].filter(Boolean).join('\n'),
    components: [
      new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`event_saved:select:${kind}:${contentType}`)
        .setPlaceholder('Usar configuração salva')
        .addOptions(options)),
      new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`event_saved:delete:${kind}:${contentType}`)
        .setPlaceholder('Excluir uma configuração salva')
        .addOptions(options)),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`event_create:new:${kind}:${contentType}`).setLabel('Criar do zero').setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

function eventTypeReusePayload(kind, contentType, recent) {
  const typeLabel = eventTypes.eventTypeLabel(contentType);
  return {
    content: `Encontrei seus últimos modelos de **${typeLabel}**. A data e a hora serão solicitadas novamente.`,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`event_template:select:${kind}:${contentType}`)
          .setPlaceholder('Escolher entre os últimos eventos')
          .addOptions(recent.map((event) => ({
            label: String(event.title || typeLabel).slice(0, 100),
            value: String(event.id),
            description: String(`${event.scheduled_time || 'Sem data'} • ${event.tank_slots}/${event.healer_slots}/${event.support_slots}/${event.dps_slots}`).slice(0, 100)
          })))
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`event_create:reuse:${kind}:${contentType}`).setLabel('Repetir último').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`event_create:new:${kind}:${contentType}`).setLabel('Criar do zero').setStyle(ButtonStyle.Secondary)
      )
    ]
  };
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

function worldBossConfirmationText(slotLabel) {
  return [
    '## \u26A0\uFE0F CONFIRMACAO DA FUNCAO',
    '',
    `Voce escolheu: **${slotLabel}**`,
    '',
    '\u2022 Avise com antecedencia caso precise desistir.',
    '\u2022 Use **Gerenciar vagas** para liberar a funcao e retirar seu ping.',
    '\u2022 A organizacao esta pagando o mapa.',
    '\u2022 O loot de dentro do World Boss sera usado para pagar o rent.',
    '\u2022 Scouts Ativos recebem **1m de loot** como auxilio.',
    '\u2022 DPS devem usar arma **T9 ou 6.3**.',
    '\u2022 Main Roles devem seguir exatamente a imagem da build.',
    '\u2022 Nao teremos FE/Basilisco.',
    '\u2022 O foco e aprender, adaptar o content e criar constancia.',
    '\u2022 Scout Mobile com funcao DPS pode acumular as duas vagas.'
  ].join('\n');
}

function customSlotSelectRows(eventId, role, options) {
  const choosingDpsWeapon = role === 'dps' && eventsRepo.listCustomEventDpsWeapons(eventId).length > 0;
  const rows = [];
  for (let start = 0; start < options.length; start += 25) {
    const page = Math.floor(start / 25) + 1;
    const pageSuffix = options.length > 25 ? ` (${page}/${Math.ceil(options.length / 25)})` : '';
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`event_custom_slot:join:${eventId}:${page}`)
        .setPlaceholder(choosingDpsWeapon ? `Escolha sua arma de DPS${pageSuffix}` : `Escolha uma vaga de ${roleLabel(role)}${pageSuffix}`)
        .addOptions(options.slice(start, start + 25))
    ));
  }
  return rows;
}
