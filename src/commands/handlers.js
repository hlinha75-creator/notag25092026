const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits
} = require('discord.js');
const { can, hasRole } = require('../config/permissions');
const { upsertSetupPanels } = require('../modules/setup/panels');
const financeRepo = require('../modules/finance/finance.repository');
const csv = require('../modules/csv/csv.service');
const { formatSilver } = require('../utils/silver');
const albionVerification = require('../modules/albion/guildVerification.service');
const ids = require('../config/ids');
const albionFame = require('../modules/albion/fame.service');
const memberList = require('../modules/members/memberList.service');
const inactiveEvents = require('../modules/members/inactiveEvents.service');
const inactiveGuests = require('../modules/members/inactiveGuests.service');
const dailyPveRanking = require('../modules/albion/dailyPveRanking.service');
const accountLinks = require('../modules/accounts/accountLinks.service');
const guildReverification = require('../modules/members/guildReverification.service');
const guildReverificationRepo = require('../modules/members/guildReverification.repository');
const giveaways = require('../modules/giveaways/giveaways.service');
const seasonPoints = require('../modules/albion/seasonPoints.service');
const seasonAnnouncement = require('../modules/albion/seasonAnnouncement.service');
const { getDatabase } = require('../database/connection');
const sponsoredCtaBuilds = require('../modules/events/sponsoredCtaBuilds.service');
const events = require('../modules/events/events.service');
const eventsRepo = require('../modules/events/events.repository');
const eventNotificationPreferences = require('../modules/events/eventNotificationPreferences.service');
const academy = require('../modules/tutorials/academy.service');
const callerSchedule = require('../modules/operations/callerSchedule.service');

function input(id, label, style = TextInputStyle.Short, required = true) {
  return new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
}

function modal(customId, title, inputs) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(inputs.map((field) => new ActionRowBuilder().addComponents(field)));
}

async function handleCommand(interaction) {
  if (interaction.commandName === 'escala_callers') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const scheduleId = await callerSchedule.publishFromCommand(interaction);
    return interaction.editReply({ content: `Escala #${scheduleId} publicada neste canal.` });
  }

  if (interaction.commandName === 'cartilha') {
    const trackKey = interaction.options.getString('funcao') || 'progress';
    const payload = trackKey === 'progress'
      ? academy.progressPayload(interaction.user.id)
      : academy.startPayload(interaction.user.id, trackKey);
    return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === 'notificacoes') {
    return interaction.reply(eventNotificationPreferences.preferencePayload(interaction.user.id));
  }

  if (interaction.commandName === 'give') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const action = interaction.options.getSubcommand();
    if (action === 'criar') {
      const result = await giveaways.createFromCommand(interaction);
      return interaction.editReply({ content: result.content, allowedMentions: { parse: [] } });
    }
    if (action === 'editar') {
      const result = await giveaways.editFromCommand(interaction);
      return interaction.editReply({ content: result.content, allowedMentions: { parse: [] } });
    }
    if (action === 'cancelar') return interaction.editReply(await giveaways.cancelFromCommand(interaction));
    if (action === 'encerrar') return interaction.editReply(await giveaways.finishFromCommand(interaction));
    if (action === 'refazer') return interaction.editReply(await giveaways.rerollFromCommand(interaction));
    throw new Error('Acao de sorteio desconhecida.');
  }

  if (interaction.commandName === 'setup') {
    if (!can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Voce nao tem permissao para rodar o setup.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const results = await upsertSetupPanels(interaction.client);
    const failures = results.filter((result) => !result.ok);
    const lines = [`Painéis atualizados: **${results.length - failures.length}**.`];
    if (failures.length) {
      lines.push(
        `Falhas: **${failures.length}**.`,
        ...failures.map((failure) => `• ${failure.type} (<#${failure.channelId}>): ${failure.error}`)
      );
    }
    return interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
  }

  if (interaction.commandName === 'saldo') {
    const user = interaction.options.getUser('membro') || interaction.user;
    if (user.id !== interaction.user.id && !can(interaction.member, 'withdrawBalance')) {
      return interaction.reply({ content: 'Voce so pode consultar seu proprio saldo.', flags: MessageFlags.Ephemeral });
    }
    const balance = financeRepo.getBalance(user.id);
    return interaction.reply({ content: `Saldo de ${user}: ${formatSilver(balance)} prata.`, flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === 'registro') {
    return interaction.showModal(modal('registration:submit', 'Registro Albion', [
      input('albionName', 'Nome do personagem no Albion')
    ]));
  }

  if (interaction.commandName === 'saldosgeral') {
    if (interaction.channelId !== ids.channels.staff) {
      return interaction.reply({
        content: `Use este comando somente no canal <#${ids.channels.staff}>.`,
        flags: MessageFlags.Ephemeral
      });
    }
    if (!hasRole(interaction.member, 'staff')) {
      return interaction.reply({ content: 'Somente quem possui a tag Staff pode consultar os saldos gerais.', flags: MessageFlags.Ephemeral });
    }
    const rows = financeRepo.listActivePositiveBalances();
    const total = rows.reduce((sum, row) => sum + Number(row.balance || 0), 0);
    return interaction.reply({
      content: [
        '**Lista geral de saldos positivos**',
        `Total exato: **${new Intl.NumberFormat('pt-BR').format(total)} prata**`,
        `Cadastros com saldo positivo: **${rows.length}**`,
        '',
        'Qual formato você deseja exportar?'
      ].join('\n'),
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('general_balances:csv').setLabel('Exportar CSV').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('general_balances:html').setLabel('Exportar HTML').setStyle(ButtonStyle.Secondary)
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.commandName === 'sincronizar_builds') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'Voce precisa da permissao Gerenciar Servidor para sincronizar as builds.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const refreshExisting = interaction.options.getBoolean('atualizar_existentes') || false;
    const result = await sponsoredCtaBuilds.syncEmojis(interaction.client, interaction.guild, { refreshExisting });
    const affectedEventIds = eventsRepo.replaceEventEmojiReferences(result.replacements);
    const openEventIds = new Set(eventsRepo.listInteractiveEvents().map((event) => event.id));
    await Promise.allSettled(
      affectedEventIds
        .filter((eventId) => openEventIds.has(eventId))
        .map((eventId) => events.refreshEventMessage(interaction.client, eventId))
    );
    return interaction.editReply({
      content: [
        `Catalogo visual: **${result.total}** armas/builds encontradas.`,
        `Emojis criados: **${result.created.length}**.`,
        `Emojis atualizados: **${result.refreshed.length}**.`,
        `Ja existentes: **${result.existing.length}**.`,
        `Sem imagem: **${result.skipped.length}**.`,
        `Falhas: **${result.failed.length}**.`,
        result.failed.length ? `\n${result.failed.slice(0, 8).join('\n')}` : null
      ].filter(Boolean).join('\n')
    });
  }

  if (interaction.commandName === 'verificar_membros') {
    if (!can(interaction.member, 'approveRegistration') && !can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Voce nao tem permissao para verificar os membros.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const days = interaction.options.getInteger('dias');
    const filter = days === 75 ? 'members_75_days' : 'members_60_days';
    return interaction.editReply({ embeds: [await memberList.filteredEmbed(interaction.guild, filter)] });
  }

  if (interaction.commandName === 'temporada') {
    const action = interaction.options.getSubcommand();
    const ranking = seasonPoints.calculateSeasonRanking();
    const format = (value) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

    if (action === 'publicar') {
      if (!can(interaction.member, 'publishSeason')) {
        return interaction.reply({ content: 'Somente a Staff ou ADM pode publicar o anúncio da temporada.', flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const results = await seasonAnnouncement.publishSeasonAnnouncement(interaction.client);
      const lines = results.map((result) => result.ok
        ? `✅ <#${result.channelId}> — ${result.updated ? 'mensagem atualizada' : 'mensagem publicada'}`
        : `❌ <#${result.channelId}> — ${result.error}`);
      return interaction.editReply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
    }

    if (action === 'ranking') {
      const limit = interaction.options.getInteger('limite') || 10;
      const rows = seasonPoints.topSeasonPlayers(limit);
      const embed = new EmbedBuilder()
        .setTitle(`Temporada ${ranking.season} - ranking Black`)
        .setDescription([
          `Snapshot **${ranking.snapshotLabel}** de ${ranking.capturedAt.split('-').reverse().join('/')}.`,
          rows.map((row) => `**#${row.rank}** ${row.name} - **${format(row.totalPoints)}** pts`).join('\n')
        ].join('\n\n'))
        .setColor(0xf2bd4a)
        .setFooter({ text: 'Estimativa proporcional; categorias com totais em k/m possuem pequena margem de arredondamento.' });
      return interaction.reply({ embeds: [embed] });
    }

    const registered = getDatabase().prepare('SELECT albion_name FROM users WHERE discord_id = ?').get(interaction.user.id);
    const name = interaction.options.getString('jogador') || registered?.albion_name;
    if (!name) {
      return interaction.reply({
        content: 'Informe o nome do jogador ou registre seu nome do Albion primeiro.',
        flags: MessageFlags.Ephemeral
      });
    }
    const player = seasonPoints.findSeasonPlayer(name);
    if (!player) {
      return interaction.reply({
        content: `Nao encontrei **${name}** no snapshot Ouro da Temporada ${ranking.season}.`,
        flags: MessageFlags.Ephemeral
      });
    }
    const details = player.categories.slice(0, 8)
      .map((category) => `${category.label}: **${format(category.points)}** pts (${new Intl.NumberFormat('pt-BR').format(category.amount)})`)
      .join('\n');
    const embed = new EmbedBuilder()
      .setTitle(`${player.name} - Temporada ${ranking.season}`)
      .setDescription('Pontos estimados usando apenas as contribuicoes Black dos rankings do Guild Might.')
      .addFields(
        { name: 'Rank estimado', value: `#${player.rank}`, inline: true },
        { name: 'Total estimado', value: `${format(player.totalPoints)} pts`, inline: true },
        { name: 'Snapshot', value: ranking.snapshotLabel, inline: true },
        { name: 'Por categoria', value: details || 'Sem contribuicoes.', inline: false }
      )
      .setColor(0xf2bd4a)
      .setFooter({ text: 'Formula: pontos da categoria x contribuicao do jogador / total da categoria.' });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (interaction.commandName === 'mesclar_contas') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para mesclar contas.', flags: MessageFlags.Ephemeral });
    }
    const primary = interaction.options.getUser('principal');
    const secondary = interaction.options.getUser('secundaria');
    const preview = accountLinks.createMergePreview({
      primaryUser: primary,
      secondaryUser: secondary,
      actorId: interaction.user.id,
      label: interaction.options.getString('nome')
    });
    return interaction.reply({
      content: [
        '**Confirmar mesclagem de contas?**',
        `Principal: <@${preview.primaryId}> (${preview.primaryName})`,
        `Secundaria: <@${preview.secondaryId}> (${preview.secondaryName})`,
        preview.label ? `Nome: ${preview.label}` : null,
        '',
        'Saldo e historico financeiro passarao para a principal. Voz, eventos e carreira das duas contas serao somados no mesmo perfil.'
      ].filter((line) => line !== null).join('\n'),
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`accounts:merge:${preview.id}`).setLabel('Confirmar mesclagem').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`accounts:cancel_merge:${preview.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }

  if (interaction.commandName === 'publicar_rank') {
    if (!can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Voce nao tem permissao para publicar rankings.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const period = interaction.options.getString('periodo');
    const result = period === 'daily'
      ? await dailyPveRanking.replaceDailyRanking(interaction.client)
      : await dailyPveRanking.publishRanking(interaction.client, { period });
    return interaction.editReply({
      content: period === 'daily' && result.replacedMessageId
        ? `Ranking diario de hoje atualizado em <#${result.channelId}>; a publicacao anterior foi removida.`
        : `Ranking ${period === 'weekly' ? 'semanal' : 'diario'} publicado em <#${result.channelId}> com ${result.totalPlayers} jogadores.`
    });
  }

  if (interaction.commandName === 'exportar') {
    if (!can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Voce nao tem permissao para exportar.', flags: MessageFlags.Ephemeral });
    }
    const type = interaction.options.getString('tipo');
    const date = interaction.options.getString('data');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const attachment = type === 'balances'
      ? csv.balancesAttachment()
      : type === 'transactions'
        ? csv.transactionsAttachment()
        : type === 'voice'
          ? csv.voiceAttachment()
          : type === 'voice_daily'
            ? csv.voiceDailyAttachment(date || undefined)
            : type === 'members_discord'
              ? await memberList.csvAttachment(interaction.guild)
              : csv.auditAttachment();
    return interaction.editReply({ content: 'Exportacao HTML gerada. Abra o arquivo e use Baixar CSV se precisar de planilha.', files: [attachment] });
  }

  if (interaction.commandName === 'importar') {
    if (!can(interaction.member, 'importCsv')) {
      return interaction.reply({ content: 'Voce nao tem permissao para importar.', flags: MessageFlags.Ephemeral });
    }
    const attachment = interaction.options.getAttachment('arquivo');
    if (!attachment?.url) {
      return interaction.reply({ content: 'Anexe um CSV valido.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error('Nao consegui baixar o CSV anexado.');
    const csvText = await response.text();
    const preview = csv.previewBalanceImport(csvText);
    const sessionId = csv.saveImportPreview({ preview, actorId: interaction.user.id });
    const sample = preview.changes
      .slice(0, 8)
      .map((change) => `<@${change.userId}>: ${formatSilver(change.before)} -> ${formatSilver(change.after)}`)
      .join('\n') || 'Nenhuma alteracao encontrada.';

    return interaction.editReply({
      content: [
        'Previa da importacao CSV:',
        `Encontrados: ${preview.found}`,
        `Nao encontrados: ${preview.missing}`,
        `Total antes: ${formatSilver(preview.totalBefore)}`,
        `Total depois: ${formatSilver(preview.totalAfter)}`,
        '',
        sample
      ].join('\n'),
      files: [csv.importPreviewAttachment(preview)],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`csv:confirm_import:${sessionId}`).setLabel('Confirmar importacao').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`csv:cancel_import:${sessionId}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }

  if (interaction.commandName === 'sincronizar_albion') {
    const syncType = interaction.options.getString('tipo') || 'membros';
    const requiredPermission = ['fama_total', 'fama_pve'].includes(syncType) ? 'importCsv' : 'approveRegistration';
    if (!can(interaction.member, requiredPermission)) {
      return interaction.reply({ content: 'Voce nao tem permissao para sincronizar esse tipo de dado Albion.', flags: MessageFlags.Ephemeral });
    }

    const attachment = interaction.options.getAttachment('arquivo');
    if (!attachment?.url) {
      return interaction.reply({ content: 'Anexe um CSV/TSV valido.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error('Nao consegui baixar o arquivo anexado.');
    const text = await response.text();

    if (['fama_total', 'fama_pve'].includes(syncType)) {
      const preview = syncType === 'fama_pve'
        ? albionFame.previewPveFame(text, {
          sourceName: attachment.name,
          actorId: interaction.user.id
        })
        : albionFame.previewFameTotals(text, {
          sourceName: attachment.name,
          actorId: interaction.user.id
        });
      const previewId = albionFame.savePreview(preview);
      return interaction.editReply({
        content: albionFame.previewText(preview),
        files: [albionFame.previewAttachment(preview)],
        components: albionFame.confirmComponents(previewId)
      });
    }

    const { id, preview } = await albionVerification.previewAlbionSync(interaction.guild, text, interaction.user.id);
    return interaction.editReply({
      content: albionVerification.syncPreviewText(preview),
      files: [albionVerification.syncPreviewAttachment(preview)],
      allowedMentions: { parse: [] },
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`albion_sync:confirm:${id}`).setLabel('Confirmar sincronizacao').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`albion_sync:cancel:${id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }
  if (interaction.commandName === 'inativos') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para verificar inativos.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const type = interaction.options.getString('tipo');
    if (type === 'eventos') {
      const preview = await inactiveEvents.createPreview({
        guild: interaction.guild,
        actorId: interaction.user.id,
        daysMin: interaction.options.getInteger('dias_minimos') || inactiveEvents.defaultDaysMin,
        minutesMin: interaction.options.getInteger('tempo_minimo') || inactiveEvents.defaultMinutesMin
      });
      return interaction.editReply(inactiveEvents.previewPayload(preview));
    }

    const preview = await inactiveGuests.createPreview({
      guild: interaction.guild,
      actorId: interaction.user.id,
      daysMin: interaction.options.getInteger('dias_minimos') || inactiveGuests.defaultDaysMin
    });
    return interaction.editReply(inactiveGuests.previewPayload(preview));
  }
  if (interaction.commandName === 'verificacao_guild') {
    if (!can(interaction.member, 'approveRegistration')) {
      return interaction.reply({ content: 'Voce nao tem permissao para gerenciar a verificacao da guilda.', flags: MessageFlags.Ephemeral });
    }
    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (subcommand === 'iniciar') {
      const attachment = interaction.options.getAttachment('arquivo');
      const announcementChannel = interaction.options.getChannel('canal_avisos')
        || await interaction.guild.channels.fetch(ids.channels.inactivityNotice);
      if (!announcementChannel?.isTextBased()) throw new Error('O canal configurado para os avisos nao esta disponivel.');
      const response = await fetch(attachment.url);
      if (!response.ok) throw new Error('Nao consegui baixar a lista da guilda.');
      const result = await guildReverification.startCampaign({
        guild: interaction.guild,
        actorId: interaction.user.id,
        rosterText: await response.text(),
        announcementChannelId: announcementChannel.id,
        verifiedRoleId: interaction.options.getRole('cargo_verificado').id,
        voiceChannelIds: [
          interaction.options.getChannel('sala_recrutamento').id,
          interaction.options.getChannel('sala_eventos').id
        ],
        deadlineAt: interaction.options.getString('prazo_utc') || undefined
      });
      const deadline = guildReverification.deadlineText(result.campaign.deadline_at);
      await guildReverification.postPendingList(announcementChannel, result.campaign, [
        '📢 **CONFIRMACAO OBRIGATORIA DOS MEMBROS**',
        '',
        `Prazo: ${deadline}.`,
        'Entre em **Recrutamento** ou **Aguardando Evento**, procure uma pessoa da staff (nome iniciado por `.`) e diga: “Ola, no jogo eu sou o jogador [nome]”.',
        'Quem acumular mais de **30 minutos em call com staff presente** podera ser dispensado automaticamente.',
        'Ao final, quem permanecer pendente entrara na lista para remocao da guilda no jogo.'
      ].join('\n'));
      return interaction.editReply({
        content: `Campanha iniciada com ${result.roster.length} jogadores; ${result.linked} vinculados ao Discord e ${result.roster.length - result.linked} sem vinculo.`,
        files: [guildReverification.campaignAttachment(result.campaign)]
      });
    }

    const campaign = guildReverificationRepo.getActiveCampaign();
    if (!campaign) throw new Error('Nao existe campanha de verificacao ativa.');

    if (subcommand === 'confirmar') {
      const user = interaction.options.getUser('membro');
      const item = await guildReverification.confirmMember({ guild: interaction.guild, discordId: user.id, actorId: interaction.user.id });
      return interaction.editReply({ content: `${item.albion_name} foi confirmado e recebeu a tag <@&${campaign.verified_role_id}>.`, allowedMentions: { parse: [] } });
    }
    if (subcommand === 'atualizar') {
      const result = await guildReverification.refreshQualifications(interaction.client);
      const status = guildReverification.summary(campaign);
      return interaction.editReply({ content: `Atualizado: ${result.qualified.length} nova(s) dispensa(s). Pendentes: ${status.pending}; confirmados: ${status.verified}; dispensados por voz: ${status.voiceQualified}.` });
    }
    if (subcommand === 'status') {
      const status = guildReverification.summary(campaign);
      return interaction.editReply({
        content: `Total: ${status.total}; pendentes: ${status.pending}; confirmados: ${status.verified}; dispensados por voz: ${status.voiceQualified}.`,
        files: [guildReverification.campaignAttachment(campaign)]
      });
    }
    if (subcommand === 'finalizar') {
      const result = await guildReverification.finishIfNeeded(interaction.client, new Date(), true);
      return interaction.editReply({ content: `Campanha encerrada. Lista final publicada com ${result.pending.length} jogador(es) pendente(s).` });
    }
  }
}

module.exports = {
  handleCommand,
  input,
  modal
};
