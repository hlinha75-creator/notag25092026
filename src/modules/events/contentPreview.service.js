const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const ids = require('../../config/ids');
const repo = require('./contentPreview.repository');

const timeSlots = [
  { key: '1800', label: '18:00 UTC' },
  { key: '2000', label: '20:00 UTC' },
  { key: '2200', label: '22:00 UTC' },
  { key: '0000', label: '00:00 UTC' }
];
const validSlots = new Set(timeSlots.map((slot) => slot.key));

function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function displayDate(previewDate) {
  const date = new Date(`${previewDate}T12:00:00.000Z`);
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(date);
  const day = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(date);
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${day}`;
}

function previewPayload(previewDate, options = {}) {
  const preview = repo.getPreview(previewDate) || { status: 'open' };
  const closed = preview.status !== 'open';
  const counts = new Map(repo.interestCounts(previewDate).map((row) => [row.time_slot, Number(row.total)]));
  const proposals = repo.listProposals(previewDate);
  const lines = [
    'Indique os horários em que você pode participar.',
    'Callers podem enviar uma proposta com conteúdo e quantidade desejada de jogadores.',
    '',
    closed
      ? '**Sondagem encerrada.** Aguarde a publicação oficial dos eventos.'
      : 'A sondagem fica aberta até **16:00 UTC**. Votar demonstra interesse, mas não confirma o evento.',
    ''
  ];

  for (const slot of timeSlots) {
    const slotProposals = proposals.filter((proposal) => proposal.time_slot === slot.key);
    lines.push(`## ${slot.label} — ${counts.get(slot.key) || 0} interessado(s)`);
    if (!slotProposals.length) {
      lines.push('> Livre — aguardando proposta de caller.');
    } else {
      for (const proposal of slotProposals.slice(0, 8)) {
        lines.push(`> **${proposal.content_name}** — Caller <@${proposal.caller_id}> — Meta: ${proposal.target_players} players`);
      }
      if (slotProposals.length > 8) lines.push(`> +${slotProposals.length - 8} proposta(s)`);
    }
    lines.push('');
  }

  const embed = new EmbedBuilder()
    .setColor(closed ? 0x718096 : 0x2f855a)
    .setTitle(`📊 PRÉVIA DE CONTEÚDOS — ${displayDate(previewDate).toUpperCase()}`)
    .setDescription(lines.join('\n').slice(0, 4096))
    .setFooter({ text: closed ? 'Resultado da sondagem diária' : 'Você pode clicar novamente para retirar seu interesse' })
    .setTimestamp(new Date());

  const interestRow = new ActionRowBuilder().addComponents(
    ...timeSlots.map((slot) => new ButtonBuilder()
      .setCustomId(`content_preview:interest:${previewDate}:${slot.key}`)
      .setLabel(`${slot.label.slice(0, 5)} • ${counts.get(slot.key) || 0}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(closed))
  );
  const proposalRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`content_preview:propose:${previewDate}`)
      .setLabel('Quero puxar um evento')
      .setEmoji('📣')
      .setStyle(ButtonStyle.Success)
      .setDisabled(closed)
  );

  return {
    content: options.mentionMembers ? `<@&${ids.roles.member}>` : '',
    embeds: [embed],
    components: [interestRow, proposalRow],
    allowedMentions: options.mentionMembers ? { parse: [], roles: [ids.roles.member] } : { parse: [] }
  };
}

function summaryPayload(previewDate) {
  const counts = new Map(repo.interestCounts(previewDate).map((row) => [row.time_slot, Number(row.total)]));
  const proposals = repo.listProposals(previewDate);
  const lines = [
    `📋 **RESUMO DA PRÉVIA — ${displayDate(previewDate).toUpperCase()}**`,
    '',
    ...timeSlots.flatMap((slot) => {
      const slotProposals = proposals.filter((proposal) => proposal.time_slot === slot.key);
      return [
        `**${slot.label}:** ${counts.get(slot.key) || 0} interessado(s)`,
        ...(slotProposals.length
          ? slotProposals.map((proposal) => `• ${proposal.content_name} — <@${proposal.caller_id}> — meta ${proposal.target_players}`)
          : ['• Nenhuma proposta']),
        ''
      ];
    }),
    'A liderança já pode avaliar a aceitação e criar os eventos oficiais.'
  ];
  return {
    content: `<@&${ids.roles.caller}> <@&${ids.roles.staff}>\n${lines.join('\n').slice(0, 1900)}`,
    allowedMentions: { parse: [], roles: [ids.roles.caller, ids.roles.staff] }
  };
}

function proposalModal(previewDate) {
  return new ModalBuilder()
    .setCustomId(`content_preview:proposal:${previewDate}`)
    .setTitle('Propor conteúdo')
    .addComponents(
      inputRow('timeSlot', 'Horario UTC', '18:00, 20:00, 22:00 ou 00:00', TextInputStyle.Short, 5),
      inputRow('contentName', 'Conteúdo sugerido', 'Ex: Roaming T7 patrocinado', TextInputStyle.Short, 80),
      inputRow('targetPlayers', 'Quantidade desejada de jogadores', 'Ex: 20', TextInputStyle.Short, 3)
    );
}

function inputRow(customId, label, placeholder, style, maxLength) {
  return new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setPlaceholder(placeholder)
      .setStyle(style)
      .setMaxLength(maxLength)
      .setRequired(true)
  );
}

function normalizeTimeSlot(value) {
  const digits = String(value || '').replace(/\D/g, '').padStart(4, '0');
  if (!validSlots.has(digits)) throw new Error('Horário inválido. Use 18:00, 20:00, 22:00 ou 00:00.');
  return digits;
}

function canParticipate(member) {
  return [ids.roles.member, ids.roles.caller, ids.roles.staff, ids.roles.adm]
    .some((roleId) => memberHasRole(member, roleId));
}

function canPropose(member) {
  return [ids.roles.caller, ids.roles.staff, ids.roles.adm]
    .some((roleId) => memberHasRole(member, roleId));
}

function memberHasRole(member, roleId) {
  if (!member || !roleId) return false;
  if (member.roles?.cache?.has(roleId)) return true;
  if (Array.isArray(member.roles) && member.roles.includes(roleId)) return true;
  return Array.isArray(member._roles) && member._roles.includes(roleId);
}

async function refreshPreviewMessage(client, previewDate) {
  const preview = repo.getPreview(previewDate);
  if (!preview?.channel_id || !preview.message_id) return null;
  const channel = await client.channels.fetch(preview.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return null;
  const message = await channel.messages.fetch(preview.message_id).catch(() => null);
  if (!message) return null;
  return message.edit(previewPayload(previewDate));
}

async function publishPreview(client, previewDate) {
  const preview = repo.ensurePreview(previewDate);
  if (preview.message_id) return preview;
  const channel = await client.channels.fetch(ids.channels.pingContent).catch(() => null);
  if (!channel?.isTextBased()) throw new Error('Canal da previa de conteudos nao encontrado.');
  const message = await channel.send(previewPayload(previewDate, { mentionMembers: true }));
  repo.attachMessage({ previewDate, channelId: channel.id, messageId: message.id });
  return message;
}

async function closePreview(client, previewDate) {
  let preview = repo.getPreview(previewDate);
  if (!preview) return null;
  if (preview.status === 'closed' && preview.summary_message_id) return preview;
  if (preview.status === 'open') {
    preview = repo.closePreview(previewDate);
    await refreshPreviewMessage(client, previewDate);
  }
  if (preview.summary_message_id) return preview;
  const channel = await client.channels.fetch(preview.channel_id || ids.channels.pingContent).catch(() => null);
  if (!channel?.isTextBased()) return preview;
  const summary = await channel.send(summaryPayload(previewDate));
  repo.attachSummaryMessage(previewDate, summary.id);
  return repo.getPreview(previewDate);
}

async function archivePreview(client, previewDate) {
  let preview = repo.getPreview(previewDate);
  if (!preview || (preview.status === 'closed' && preview.channel_id === ids.channels.archive)) return preview || null;
  if (preview.status === 'open' || !preview.summary_message_id) {
    preview = await closePreview(client, previewDate);
  }
  if (!preview?.channel_id || !preview.message_id || !preview.summary_message_id) return preview;

  const sourceChannel = await client.channels.fetch(preview.channel_id).catch(() => null);
  const archiveChannel = await client.channels.fetch(ids.channels.archive).catch(() => null);
  if (!sourceChannel?.isTextBased() || !archiveChannel?.isTextBased()) return preview;
  if (sourceChannel.id === archiveChannel.id) {
    return repo.archivePreview({
      previewDate,
      channelId: archiveChannel.id,
      messageId: preview.message_id,
      summaryMessageId: preview.summary_message_id
    });
  }

  const sourcePreview = await sourceChannel.messages.fetch(preview.message_id).catch(() => null);
  const sourceSummary = await sourceChannel.messages.fetch(preview.summary_message_id).catch(() => null);
  const archivedPreview = await archiveChannel.send(previewPayload(previewDate));
  let archivedSummary;
  try {
    archivedSummary = await archiveChannel.send(summaryPayload(previewDate));
  } catch (error) {
    await archivedPreview.delete().catch(() => {});
    throw error;
  }

  await Promise.all([
    sourcePreview?.delete().catch(() => {}),
    sourceSummary?.delete().catch(() => {})
  ]);
  return repo.archivePreview({
    previewDate,
    channelId: archiveChannel.id,
    messageId: archivedPreview.id,
    summaryMessageId: archivedSummary.id
  });
}

async function processDailyContentPreview(client, now = new Date()) {
  const today = utcDateKey(now);
  repo.closeStalePreviews(today);
  const hour = now.getUTCHours();
  if (hour >= 10 && hour < 16) return publishPreview(client, today);
  if (hour >= 18) return archivePreview(client, today);
  if (hour >= 16) return closePreview(client, today);
  return null;
}

async function disableOpenPreviews(client) {
  const previews = repo.listOpenPreviews();
  for (const preview of previews) {
    const channel = preview.channel_id
      ? await client.channels.fetch(preview.channel_id).catch(() => null)
      : null;
    if (channel?.isTextBased()) {
      const message = preview.message_id
        ? await channel.messages.fetch(preview.message_id).catch(() => null)
        : null;
      await message?.delete().catch(() => {});
      const summary = preview.summary_message_id
        ? await channel.messages.fetch(preview.summary_message_id).catch(() => null)
        : null;
      await summary?.delete().catch(() => {});
    }
    repo.closePreview(preview.preview_date);
  }
  return previews.length;
}

async function submitProposal(interaction, previewDate) {
  if (!canPropose(interaction.member)) throw new Error('Somente callers e membros da staff podem enviar propostas.');
  const timeSlot = normalizeTimeSlot(interaction.fields.getTextInputValue('timeSlot'));
  const contentName = interaction.fields.getTextInputValue('contentName').replace(/\s+/g, ' ').trim();
  const targetPlayers = Number.parseInt(interaction.fields.getTextInputValue('targetPlayers'), 10);
  if (contentName.length < 3) throw new Error('Informe um conteúdo com pelo menos 3 caracteres.');
  if (!Number.isInteger(targetPlayers) || targetPlayers < 2 || targetPlayers > 100) {
    throw new Error('A quantidade de jogadores deve estar entre 2 e 100.');
  }
  repo.upsertProposal({ previewDate, timeSlot, callerId: interaction.user.id, contentName, targetPlayers });
  await refreshPreviewMessage(interaction.client, previewDate);
  return { timeSlot, contentName, targetPlayers };
}

module.exports = {
  archivePreview,
  canParticipate,
  canPropose,
  closePreview,
  disableOpenPreviews,
  displayDate,
  normalizeTimeSlot,
  previewPayload,
  processDailyContentPreview,
  proposalModal,
  publishPreview,
  refreshPreviewMessage,
  submitProposal,
  summaryPayload,
  timeSlots,
  utcDateKey
};
