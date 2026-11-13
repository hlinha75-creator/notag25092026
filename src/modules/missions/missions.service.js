const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const env = require('../../config/env');
const ids = require('../../config/ids');
const repo = require('./missions.repository');

const REMINDER_DELAY_MS = 12 * 60 * 60 * 1000;

function isAuthorizedCreator(message) {
  return env.missionAuthorIds.includes(message.author.id);
}

function parseMissionContent(content, botUserId) {
  const mentionPattern = new RegExp(`<@!?${botUserId}>`, 'g');
  const lines = String(content || '').replace(mentionPattern, '').replace(/\r/g, '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();

  const title = lines[0]?.trim();
  const objective = lines[1]?.trim();
  const description = lines.slice(2).join('\n').trim();
  if (!title || !objective || !description) {
    throw new Error('Use 3 partes: primeira linha = titulo; segunda linha = objetivo; terceira linha em diante = descricao.');
  }
  return { title, objective, description };
}

function truncate(value, maxLength) {
  const text = String(value || '').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function attachmentPayloads(message) {
  const attachments = Array.from(message.attachments?.values?.() || []).slice(0, 10);
  return attachments.map((attachment, index) => {
    const originalName = String(attachment.name || `arquivo-${index + 1}`);
    const safeName = originalName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .slice(-80) || `arquivo-${index + 1}`;
    const name = `missao-${index + 1}-${safeName}`;
    const isImage = String(attachment.contentType || '').startsWith('image/')
      || /\.(?:png|jpe?g|gif|webp)$/i.test(originalName);
    return {
      file: new AttachmentBuilder(attachment.url, { name }),
      imageName: isImage ? name : null
    };
  });
}

async function missionAttachmentPayloads(message) {
  const direct = attachmentPayloads(message);
  if (direct.length > 0 || !message.channel.messages?.fetch) return direct;

  try {
    const recent = await message.channel.messages.fetch({ limit: 25, before: message.id });
    const currentTime = Number(message.createdTimestamp || Date.now());
    const previous = Array.from(recent.values()).find((candidate) => {
      const candidateTime = Number(candidate.createdTimestamp || candidate.createdAt?.getTime?.() || 0);
      const age = currentTime - candidateTime;
      const mentionsBot = candidate.mentions?.users?.has?.(message.client.user.id)
        || new RegExp(`<@!?${message.client.user.id}>`).test(candidate.content || '');
      return candidate.author?.id === message.author.id
        && age >= 0
        && age <= 10 * 60 * 1000
        && mentionsBot
        && Number(candidate.attachments?.size || 0) > 0;
    });
    return previous ? attachmentPayloads(previous) : direct;
  } catch (error) {
    console.error('[MISSOES] Nao foi possivel procurar anexos da tentativa anterior:', error);
    return direct;
  }
}

function missionComponents(mission) {
  if (mission.status === 'available') {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mission:claim:${mission.id}`)
        .setLabel('Resgatar missao')
        .setEmoji('\uD83D\uDE4B')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`mission:question:${mission.id}`)
        .setLabel('Duvida')
        .setEmoji('\u2753')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`mission:edit:${mission.id}`)
        .setLabel('Editar missao')
        .setEmoji('\u270F\uFE0F')
        .setStyle(ButtonStyle.Secondary)
    )];
  }
  if (mission.status === 'claimed') {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mission:complete:${mission.id}`)
        .setLabel('Concluir missao')
        .setEmoji('\u2705')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`mission:release:${mission.id}`)
        .setLabel('Desistir e liberar')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`mission:question:${mission.id}`)
        .setLabel('Duvida')
        .setEmoji('\u2753')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`mission:edit:${mission.id}`)
        .setLabel('Editar missao')
        .setEmoji('\u270F\uFE0F')
        .setStyle(ButtonStyle.Secondary)
    )];
  }
  return [];
}

function missionEmbed(mission) {
  const status = {
    available: '\uD83D\uDFE2 Disponivel para resgate',
    claimed: `\uD83D\uDFE1 Em andamento por <@${mission.assignee_id}>`,
    completed: `\u2705 Concluida por <@${mission.assignee_id}>`,
    cancelled: '\u274C Cancelada'
  }[mission.status] || mission.status;
  const colors = { available: 0x57f287, claimed: 0xfee75c, completed: 0x5865f2, cancelled: 0xed4245 };
  const details = [
    '**Objetivo**',
    truncate(mission.objective, 900),
    '',
    '**Descricao**',
    truncate(mission.description, 2600),
    '',
    '**Status**',
    status
  ];
  if (mission.status === 'claimed' && mission.reminder_due_at) {
    details.push(`Lembrete de conclusao <t:${Math.floor(new Date(mission.reminder_due_at).getTime() / 1000)}:R>.`);
  }
  if (mission.thread_id) {
    details.push('', '**Duvidas**', `<#${mission.thread_id}>`);
  }
  const embed = new EmbedBuilder()
    .setColor(colors[mission.status] || 0x5865f2)
    .setTitle(truncate(`\uD83D\uDCDC Missao #${mission.id} \u2014 ${mission.title}`, 256))
    .setDescription(details.join('\n'))
    .setFooter({ text: `Criada por ${mission.creator_id}` })
    .setTimestamp(new Date(mission.created_at));
  if (mission.image_attachment_name) {
    embed.setImage(`attachment://${mission.image_attachment_name}`);
  }
  return embed;
}

function missionPayload(mission) {
  return {
    embeds: [missionEmbed(mission)],
    components: missionComponents(mission),
    allowedMentions: { parse: [] }
  };
}

async function handleMissionMessage(message) {
  if (!message.guild || message.author.bot) return false;
  if (message.channelId !== ids.channels.serviceMissions) return false;
  if (!message.client.user || !message.mentions.users.has(message.client.user.id)) return false;
  if (!isAuthorizedCreator(message)) return false;

  let parsed;
  try {
    parsed = parseMissionContent(message.content, message.client.user.id);
  } catch (error) {
    await message.reply({
      content: `${error.message}\nA mensagem original foi mantida para voce corrigir.`,
      allowedMentions: { users: [message.author.id], repliedUser: true }
    }).catch(() => {});
    return true;
  }

  const existing = repo.getMissionBySourceMessage(message.id);
  if (existing) return true;

  const attachments = await missionAttachmentPayloads(message);
  const imageAttachmentName = attachments.find((attachment) => attachment.imageName)?.imageName || null;

  const mission = repo.createMission({
    guildId: message.guildId,
    channelId: message.channelId,
    sourceMessageId: message.id,
    creatorId: message.author.id,
    imageAttachmentName,
    ...parsed
  });

  try {
    const publication = await message.channel.send({
      ...missionPayload(mission),
      files: attachments.map((attachment) => attachment.file)
    });
    repo.attachPublishedMessage(mission.id, publication.id);
    await message.delete();
  } catch (error) {
    repo.removeUnpublishedMission(mission.id);
    throw error;
  }
  return true;
}

async function fetchMissionMessage(client, mission) {
  const channel = await client.channels.fetch(mission.channel_id);
  if (!channel?.isTextBased() || !mission.message_id) return null;
  return channel.messages.fetch(mission.message_id);
}

async function syncMissionMessage(client, mission) {
  const message = await fetchMissionMessage(client, mission);
  if (!message) return null;
  await message.edit(missionPayload(mission));
  return message;
}

function assigneeError(result, userId) {
  if (!result.mission) return 'Essa missao nao existe mais.';
  if (result.mission.status === 'completed') return 'Essa missao ja foi concluida.';
  if (result.mission.assignee_id !== userId) return 'Somente quem resgatou a missao pode fazer isso.';
  if (!result.changed) return 'A missao mudou enquanto voce clicava. Tente novamente.';
  return null;
}

async function handleButton(interaction) {
  const [, action, idText] = interaction.customId.split(':');
  const id = Number(idText);
  if (!Number.isInteger(id) || id <= 0) {
    return interaction.reply({ content: 'Missao invalida.', flags: MessageFlags.Ephemeral });
  }

  if (action === 'edit') {
    if (!env.missionAuthorIds.includes(interaction.user.id)) {
      return interaction.reply({ content: 'Somente as contas autorizadas podem editar missoes.', flags: MessageFlags.Ephemeral });
    }
    const mission = repo.getMission(id);
    if (!mission || !['available', 'claimed'].includes(mission.status)) {
      return interaction.reply({ content: 'Essa missao nao pode mais ser editada.', flags: MessageFlags.Ephemeral });
    }
    return interaction.showModal(new ModalBuilder()
      .setCustomId(`mission:edit_submit:${id}`)
      .setTitle(`Editar missao #${id}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('title').setLabel('Titulo').setStyle(TextInputStyle.Short)
            .setRequired(true).setMaxLength(200).setValue(truncate(mission.title, 200))
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('objective').setLabel('Objetivo').setStyle(TextInputStyle.Paragraph)
            .setRequired(true).setMaxLength(1000).setValue(truncate(mission.objective, 1000))
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('description').setLabel('Descricao').setStyle(TextInputStyle.Paragraph)
            .setRequired(true).setMaxLength(3000).setValue(truncate(mission.description, 3000))
        )
      ));
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (action === 'question') {
    const mission = repo.getMission(id);
    if (!mission || !['available', 'claimed'].includes(mission.status)) {
      return interaction.editReply('Essa missao nao esta mais aberta para duvidas.');
    }
    let thread = mission.thread_id
      ? await interaction.client.channels.fetch(mission.thread_id).catch(() => null)
      : null;
    let created = false;
    if (!thread) {
      const publication = await fetchMissionMessage(interaction.client, mission);
      if (!publication) return interaction.editReply('Nao encontrei a mensagem da missao para abrir o topico.');
      thread = publication.thread || await publication.startThread({
        name: truncate(`duvidas-missao-${mission.id}-${mission.title}`.replace(/[^a-zA-Z0-9\s_-]/g, ''), 100),
        autoArchiveDuration: 1440,
        reason: `Duvidas da missao #${mission.id}`
      });
      const saved = repo.setMissionThread({ id: mission.id, threadId: thread.id });
      if (!saved.changed && saved.mission?.thread_id !== thread.id) {
        thread = await interaction.client.channels.fetch(saved.mission.thread_id);
      } else {
        created = true;
        await syncMissionMessage(interaction.client, saved.mission);
      }
    }
    if (thread.archived) await thread.setArchived(false, 'Nova duvida na missao').catch(() => {});
    await thread.members?.add(interaction.user.id).catch(() => {});
    if (created) {
      await thread.send({
        content: [
          `\u2753 <@${interaction.user.id}> abriu este topico para tirar duvidas sobre a missao **${truncate(mission.title, 120)}**.`,
          `<@${mission.creator_id}>, responda aqui quando puder.`,
          'Escreva sua pergunta abaixo.'
        ].join('\n'),
        allowedMentions: { users: [interaction.user.id, mission.creator_id] }
      });
    }
    return interaction.editReply({
      content: `Topico de duvidas: https://discord.com/channels/${mission.guild_id}/${thread.id}`,
      allowedMentions: { parse: [] }
    });
  }

  if (action === 'claim') {
    const now = new Date();
    const result = repo.claimMission({
      id,
      assigneeId: interaction.user.id,
      claimedAt: now.toISOString(),
      reminderDueAt: new Date(now.getTime() + REMINDER_DELAY_MS).toISOString()
    });
    if (!result.changed) {
      const text = result.mission?.status === 'claimed'
        ? `Essa missao ja esta sendo feita por <@${result.mission.assignee_id}>.`
        : 'Essa missao nao esta mais disponivel.';
      return interaction.editReply({ content: text, allowedMentions: { parse: [] } });
    }
    await syncMissionMessage(interaction.client, result.mission);
    return interaction.editReply('Missao resgatada. Agora ela esta bloqueada para os outros membros.');
  }

  if (action === 'complete') {
    const result = repo.completeMission({ id, assigneeId: interaction.user.id, completedAt: new Date().toISOString() });
    const error = assigneeError(result, interaction.user.id);
    if (error) return interaction.editReply(error);
    await syncMissionMessage(interaction.client, result.mission);
    if (interaction.message?.id !== result.mission.message_id) {
      await interaction.message.edit({
        content: `\u2705 Missao #${id} marcada como concluida por <@${interaction.user.id}>.`,
        components: [],
        allowedMentions: { parse: [] }
      }).catch(() => {});
    }
    return interaction.editReply('Missao concluida. Obrigado!');
  }

  if (action === 'release') {
    const result = repo.releaseMission({ id, assigneeId: interaction.user.id });
    const error = assigneeError(result, interaction.user.id);
    if (error) return interaction.editReply(error);
    await syncMissionMessage(interaction.client, result.mission);
    if (interaction.message?.id !== result.mission.message_id) {
      await interaction.message.edit({ content: `Missao #${id} liberada novamente.`, components: [] }).catch(() => {});
    }
    return interaction.editReply('Voce liberou a missao para outro membro resgatar.');
  }

  if (action === 'extend') {
    const result = repo.postponeReminder({
      id,
      assigneeId: interaction.user.id,
      reminderDueAt: new Date(Date.now() + REMINDER_DELAY_MS).toISOString()
    });
    const error = assigneeError(result, interaction.user.id);
    if (error) return interaction.editReply(error);
    await syncMissionMessage(interaction.client, result.mission);
    await interaction.message.edit({
      content: `\u23F3 <@${interaction.user.id}> confirmou que ainda esta fazendo a missao #${id}. Perguntarei novamente em 12 horas.`,
      components: [],
      allowedMentions: { parse: [] }
    }).catch(() => {});
    return interaction.editReply('Tudo certo. Vou perguntar novamente em 12 horas.');
  }

  return interaction.editReply('Acao de missao desconhecida.');
}

async function handleEditModal(interaction) {
  const id = Number(interaction.customId.split(':')[2]);
  if (!env.missionAuthorIds.includes(interaction.user.id)) {
    return interaction.reply({ content: 'Somente as contas autorizadas podem editar missoes.', flags: MessageFlags.Ephemeral });
  }
  const title = interaction.fields.getTextInputValue('title').trim();
  const objective = interaction.fields.getTextInputValue('objective').trim();
  const description = interaction.fields.getTextInputValue('description').trim();
  if (!title || !objective || !description) {
    return interaction.reply({ content: 'Titulo, objetivo e descricao sao obrigatorios.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = repo.updateMission({ id, title, objective, description });
  if (!result.changed) return interaction.editReply('Essa missao nao pode mais ser editada.');
  await syncMissionMessage(interaction.client, result.mission);
  return interaction.editReply('Missao atualizada com sucesso.');
}

function reminderComponents(mission) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mission:complete:${mission.id}`)
      .setLabel('Sim, conclui')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`mission:extend:${mission.id}`)
      .setLabel('Ainda estou fazendo')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`mission:release:${mission.id}`)
      .setLabel('Desistir e liberar')
      .setStyle(ButtonStyle.Secondary)
  )];
}

async function processDueReminders(client, now = new Date()) {
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const due = repo.listDueReminders(now.toISOString(), staleBefore);
  let sent = 0;
  for (const mission of due) {
    const reservedAt = new Date().toISOString();
    if (!repo.reserveReminder(mission.id, reservedAt, staleBefore).changes) continue;
    try {
      const channel = await client.channels.fetch(mission.channel_id);
      if (!channel?.isTextBased()) throw new Error(`Canal ${mission.channel_id} nao aceita mensagens.`);
      await channel.send({
        content: `<@${mission.assignee_id}>, voce concluiu a missao **${truncate(mission.title, 120)}**?`,
        components: reminderComponents(mission),
        allowedMentions: { users: [mission.assignee_id] },
        reply: mission.message_id ? { messageReference: mission.message_id, failIfNotExists: false } : undefined
      });
      repo.markReminderSent(mission.id, reservedAt, new Date().toISOString());
      sent += 1;
    } catch (error) {
      repo.clearReminderReservation(mission.id, reservedAt);
      console.error(`[MISSOES] Falha ao lembrar missao #${mission.id}:`, error);
    }
  }
  return { checked: due.length, sent };
}

function databaseTimestamp(value) {
  const text = String(value || '');
  const normalized = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`;
  return new Date(normalized).getTime();
}

async function repairMissingMissionImages(client) {
  const missions = repo.listMissionsWithoutImage();
  let repaired = 0;
  for (const mission of missions) {
    try {
      const channel = await client.channels.fetch(mission.channel_id);
      if (!channel?.isTextBased()) continue;
      const recent = await channel.messages.fetch({ limit: 100 });
      const missionTime = databaseTimestamp(mission.created_at);
      const source = Array.from(recent.values())
        .filter((candidate) => {
          const candidateTime = Number(candidate.createdTimestamp || candidate.createdAt?.getTime?.() || 0);
          const mentionsBot = candidate.mentions?.users?.has?.(client.user.id)
            || new RegExp(`<@!?${client.user.id}>`).test(candidate.content || '');
          return candidate.author?.id === mission.creator_id
            && candidateTime <= missionTime
            && missionTime - candidateTime <= 10 * 60 * 1000
            && mentionsBot
            && Number(candidate.attachments?.size || 0) > 0;
        })
        .sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0))[0];
      if (!source) continue;

      const attachments = attachmentPayloads(source);
      const imageName = attachments.find((attachment) => attachment.imageName)?.imageName;
      if (!imageName) continue;
      const publication = await channel.messages.fetch(mission.message_id);
      const updated = { ...mission, image_attachment_name: imageName };
      await publication.edit({
        ...missionPayload(updated),
        files: attachments.map((attachment) => attachment.file)
      });
      repo.setMissionImage(mission.id, imageName);
      repaired += 1;
    } catch (error) {
      console.error(`[MISSOES] Falha ao recuperar imagem da missao #${mission.id}:`, error);
    }
  }
  return { checked: missions.length, repaired };
}

async function reconcileMissionMessages(client) {
  const missions = repo.listOpenMissions();
  let updated = 0;
  for (const mission of missions) {
    try {
      if (await syncMissionMessage(client, mission)) updated += 1;
    } catch (error) {
      console.error(`[MISSOES] Falha ao sincronizar a missao #${mission.id}:`, error);
    }
  }
  return { checked: missions.length, updated };
}

module.exports = {
  REMINDER_DELAY_MS,
  handleButton,
  handleEditModal,
  handleMissionMessage,
  isAuthorizedCreator,
  missionComponents,
  missionEmbed,
  missionPayload,
  parseMissionContent,
  processDueReminders,
  reconcileMissionMessages,
  repairMissingMissionImages
};
