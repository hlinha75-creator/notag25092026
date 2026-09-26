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
const ids = require('../../config/ids');
const repo = require('./wtb.repository');

function listingType(order) {
  return order.listing_type === 'sell' ? 'sell' : 'buy';
}

function listingCopy(order) {
  if (listingType(order) === 'sell') {
    return {
      code: 'WTS', ownerLabel: 'Vendedor', ownerRole: 'vendedor', offererRole: 'comprador',
      openStatus: '\uD83D\uDFE2 Procurando compradores', closedStatus: '\u26AB Venda finalizada',
      offerButton: 'Tenho interesse', closeButton: 'Finalizar venda', closedNoun: 'venda',
      editTitle: 'Titulo da venda', offerTitle: 'Demonstrar interesse',
      offerItemsLabel: 'O que deseja comprar e quanto?', confirmButton: 'Confirmar venda'
    };
  }
  return {
    code: 'WTB', ownerLabel: 'Comprador', ownerRole: 'comprador', offererRole: 'vendedor',
    openStatus: '\uD83D\uDFE2 Procurando vendedores', closedStatus: '\u26AB Compra finalizada',
    offerButton: 'Tenho para vender', closeButton: 'Finalizar compra', closedNoun: 'compra',
    editTitle: 'Titulo da compra', offerTitle: 'Oferecer itens',
    offerItemsLabel: 'O que voce tem e qual quantidade?', confirmButton: 'Confirmar entrega'
  };
}

function ownerId(order) {
  return order.owner_id || order.buyer_id;
}

function offererId(offer) {
  return offer.offerer_id || offer.seller_id;
}

function truncate(value, maxLength) {
  const text = String(value || '').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function parseOrderContent(content, botUserId) {
  const mentionPattern = new RegExp(`<@!?${botUserId}>`, 'g');
  const lines = String(content || '').replace(mentionPattern, '').replace(/\r/g, '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const title = lines[0]?.trim();
  const items = lines[1]?.trim();
  const terms = lines.slice(2).join('\n').trim();
  if (!title || !items || !terms) {
    throw new Error('Use 3 partes: primeira linha = titulo; segunda linha = itens e quantidades; terceira linha em diante = preco, local e condicoes.');
  }
  return { title, items, terms };
}

function attachmentPayloads(message, type) {
  return Array.from(message.attachments?.values?.() || []).slice(0, 10).map((attachment, index) => {
    const originalName = String(attachment.name || `arquivo-${index + 1}`);
    const safeName = originalName.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80) || `arquivo-${index + 1}`;
    const name = `${type}-${index + 1}-${safeName}`;
    const isImage = String(attachment.contentType || '').startsWith('image/')
      || /\.(?:png|jpe?g|gif|webp)$/i.test(originalName);
    return { file: new AttachmentBuilder(attachment.url, { name }), imageName: isImage ? name : null };
  });
}

function orderComponents(order) {
  if (order.status === 'closed') return [];
  const copy = listingCopy(order);
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`wtb:offer:${order.id}`).setLabel(copy.offerButton).setEmoji('\uD83E\uDD1D').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`wtb:question:${order.id}`).setLabel('Negociar / duvida').setEmoji('\uD83D\uDCAC').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`wtb:edit:${order.id}`).setLabel('Editar').setEmoji('\u270F\uFE0F').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`wtb:close:${order.id}`).setLabel(copy.closeButton).setStyle(ButtonStyle.Danger)
  )];
}

function orderEmbed(order) {
  const summary = repo.offerSummary(order.id);
  const copy = listingCopy(order);
  const status = order.status === 'open' ? copy.openStatus : copy.closedStatus;
  const lines = [
    '**Itens e quantidades**', truncate(order.items, 1000), '',
    '**Preco, entrega e condicoes**', truncate(order.terms, 1800), '',
    `**${copy.ownerLabel}**`, `<@${ownerId(order)}>`, '',
    '**Status**', status, '',
    '**Ofertas**', `${summary.offered} aguardando confirmacao \u00B7 ${summary.confirmed} negociacao(oes) confirmada(s)`
  ];
  if (summary.confirmedOffers.length) {
    lines.push('', '**Ultimas negociacoes confirmadas**');
    for (const offer of summary.confirmedOffers) {
      lines.push(`\u2705 <@${offer.offerer_id}> \u2014 ${truncate(offer.items.replace(/\s+/g, ' '), 150)}`);
    }
  }
  if (order.thread_id) lines.push('', '**Negociacao**', `<#${order.thread_id}>`);
  const embed = new EmbedBuilder()
    .setColor(order.status === 'open' ? 0x57f287 : 0x747f8d)
    .setTitle(truncate(`\uD83D\uDED2 ${copy.code} #${order.id} \u2014 ${order.title}`, 256))
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'O bot organiza o anuncio; pagamento e entrega sao combinados entre comprador e vendedor.' })
    .setTimestamp(new Date(order.created_at));
  if (order.image_attachment_name) embed.setImage(`attachment://${order.image_attachment_name}`);
  return embed;
}

function orderPayload(order) {
  if (order.status === 'closed') {
    const summary = repo.offerSummary(order.id);
    const copy = listingCopy(order);
    return {
      content: truncate(`\u26AB ${copy.code} #${order.id} finalizado \u00B7 ${order.title} \u00B7 ${copy.ownerRole} <@${ownerId(order)}> \u00B7 ${summary.confirmed} negociacao(oes) confirmada(s)`, 1900),
      embeds: [],
      components: [],
      attachments: [],
      allowedMentions: { parse: [] }
    };
  }
  return { embeds: [orderEmbed(order)], components: orderComponents(order), allowedMentions: { parse: [] } };
}

async function handleOrderMessage(message) {
  if (!message.guild || message.author.bot) return false;
  const type = message.channelId === ids.channels.wtsSellOrders
    ? 'sell'
    : message.channelId === ids.channels.wtbBuyOrders ? 'buy' : null;
  if (!type) return false;
  if (!message.client.user || !message.mentions.users.has(message.client.user.id)) return false;
  let parsed;
  try {
    parsed = parseOrderContent(message.content, message.client.user.id);
  } catch (error) {
    await message.reply({
      content: `${error.message}\nA mensagem original foi mantida para voce corrigir.`,
      allowedMentions: { users: [message.author.id], repliedUser: true }
    }).catch(() => {});
    return true;
  }
  if (repo.getOrderBySourceMessage(message.id)) return true;
  const attachments = attachmentPayloads(message, type);
  const order = repo.createOrder({
    guildId: message.guildId,
    channelId: message.channelId,
    sourceMessageId: message.id,
    ownerId: message.author.id,
    listingType: type,
    imageAttachmentName: attachments.find((attachment) => attachment.imageName)?.imageName || null,
    ...parsed
  });
  try {
    const publication = await message.channel.send({
      ...orderPayload(order),
      files: attachments.map((attachment) => attachment.file)
    });
    repo.attachPublishedMessage(order.id, publication.id);
    await message.delete();
  } catch (error) {
    repo.removeUnpublishedOrder(order.id);
    throw error;
  }
  return true;
}

async function fetchOrderMessage(client, order) {
  const channel = await client.channels.fetch(order.channel_id);
  if (!channel?.isTextBased() || !order.message_id) return null;
  return channel.messages.fetch(order.message_id);
}

async function syncOrderMessage(client, order) {
  const publication = await fetchOrderMessage(client, order);
  if (!publication) return null;
  await publication.edit(orderPayload(order));
  return publication;
}

function canManageOrder(interaction, order) {
  if (!order) return false;
  if (interaction.user.id === ownerId(order) || interaction.guild?.ownerId === interaction.user.id) return true;
  const cache = interaction.member?.roles?.cache;
  return Boolean(cache?.has?.(ids.roles.adm) || cache?.has?.(ids.roles.staff));
}

async function ensureOrderThread(client, order, openerId) {
  const copy = listingCopy(order);
  let thread = order.thread_id ? await client.channels.fetch(order.thread_id).catch(() => null) : null;
  let created = false;
  if (!thread) {
    const publication = await fetchOrderMessage(client, order);
    if (!publication) throw new Error('Nao encontrei a mensagem do anuncio para abrir a negociacao.');
    thread = publication.thread || await publication.startThread({
      name: truncate(`${copy.code.toLowerCase()}-${order.id}-${order.title}`.replace(/[^a-zA-Z0-9\s_-]/g, ''), 100),
      autoArchiveDuration: 1440,
      reason: `Negociacao do anuncio ${copy.code} #${order.id}`
    });
    const saved = repo.setOrderThread({ id: order.id, threadId: thread.id });
    if (!saved.changed && saved.order?.thread_id !== thread.id) {
      thread = await client.channels.fetch(saved.order.thread_id);
    } else {
      order = saved.order;
      created = true;
      await syncOrderMessage(client, order);
    }
  }
  if (thread.archived) await thread.setArchived(false, `Nova negociacao ${copy.code}`).catch(() => {});
  await thread.members?.add(openerId).catch(() => {});
  if (created) {
    await thread.send({
      content: `\uD83D\uDCAC Negociacao do anuncio **${truncate(order.title, 150)}**.\n${copy.ownerLabel}: <@${ownerId(order)}>. Usem este topico para combinar preco, quantidade e entrega.`,
      allowedMentions: { users: [ownerId(order)] }
    });
  }
  return thread;
}

function input(id, label, style, maxLength, value = null, required = true) {
  const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style)
    .setRequired(required).setMaxLength(maxLength);
  if (value) field.setValue(truncate(value, maxLength));
  return new ActionRowBuilder().addComponents(field);
}

function editModal(order) {
  const copy = listingCopy(order);
  return new ModalBuilder().setCustomId(`wtb:edit_submit:${order.id}`).setTitle(`Editar ${copy.code} #${order.id}`).addComponents(
    input('title', copy.editTitle, TextInputStyle.Short, 200, order.title),
    input('items', 'Itens e quantidades', TextInputStyle.Paragraph, 1000, order.items),
    input('terms', 'Preco, local e condicoes', TextInputStyle.Paragraph, 1800, order.terms)
  );
}

function offerModal(order) {
  const copy = listingCopy(order);
  return new ModalBuilder().setCustomId(`wtb:offer_submit:${order.id}`).setTitle(`${copy.offerTitle} #${order.id}`).addComponents(
    input('items', copy.offerItemsLabel, TextInputStyle.Paragraph, 1000),
    input('note', 'Preco ou observacao', TextInputStyle.Paragraph, 1000, null, false)
  );
}

async function handleButton(interaction) {
  const [, action, idText] = interaction.customId.split(':');
  const id = Number(idText);
  if (!Number.isInteger(id) || id <= 0) {
    return interaction.reply({ content: 'Anuncio de mercado invalido.', flags: MessageFlags.Ephemeral });
  }

  if (action === 'confirm_offer' || action === 'withdraw_offer') {
    const offer = repo.getOffer(id);
    const order = offer ? repo.getOrder(offer.order_id) : null;
    const copy = order ? listingCopy(order) : null;
    if (!offer || !order) return interaction.reply({ content: 'Oferta nao encontrada.', flags: MessageFlags.Ephemeral });
    if (action === 'confirm_offer' && !canManageOrder(interaction, order)) {
      return interaction.reply({ content: `Somente o ${copy.ownerRole} do anuncio ou a staff pode confirmar.`, flags: MessageFlags.Ephemeral });
    }
    if (action === 'withdraw_offer' && interaction.user.id !== offererId(offer)) {
      return interaction.reply({ content: 'Somente quem enviou a oferta pode retira-la.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = action === 'confirm_offer'
      ? repo.confirmOffer({ id })
      : repo.withdrawOffer({ id, offererId: interaction.user.id });
    if (!result.changed) return interaction.editReply('Essa oferta ja foi tratada.');
    await syncOrderMessage(interaction.client, result.order);
    const text = action === 'confirm_offer'
      ? `\u2705 Negociacao confirmada por <@${interaction.user.id}> com <@${offererId(offer)}>.`
      : `Oferta retirada por <@${offererId(offer)}>.`;
    await interaction.message?.edit({ content: text, components: [], allowedMentions: { parse: [] } }).catch(() => {});
    return interaction.editReply(action === 'confirm_offer' ? 'Negociacao confirmada.' : 'Sua oferta foi retirada.');
  }

  const order = repo.getOrder(id);
  if (!order) return interaction.reply({ content: 'Anuncio de mercado nao encontrado.', flags: MessageFlags.Ephemeral });
  const copy = listingCopy(order);
  if (action === 'offer') {
    if (order.status !== 'open') return interaction.reply({ content: `Essa ${copy.closedNoun} ja foi finalizada.`, flags: MessageFlags.Ephemeral });
    if (interaction.user.id === ownerId(order)) return interaction.reply({ content: `Voce e o ${copy.ownerRole} deste anuncio.`, flags: MessageFlags.Ephemeral });
    return interaction.showModal(offerModal(order));
  }
  if (action === 'edit') {
    if (!canManageOrder(interaction, order)) return interaction.reply({ content: `Somente o ${copy.ownerRole} ou a staff pode editar.`, flags: MessageFlags.Ephemeral });
    return interaction.showModal(editModal(order));
  }
  if (action === 'question') {
    if (order.status !== 'open') return interaction.reply({ content: `Essa ${copy.closedNoun} ja foi finalizada.`, flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const thread = await ensureOrderThread(interaction.client, order, interaction.user.id);
    return interaction.editReply({ content: `Negociacao: https://discord.com/channels/${order.guild_id}/${thread.id}`, allowedMentions: { parse: [] } });
  }
  if (action === 'close') {
    if (!canManageOrder(interaction, order)) return interaction.reply({ content: `Somente o ${copy.ownerRole} ou a staff pode alterar o status.`, flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = repo.setOrderStatus({ id, status: 'closed' });
    if (!result.changed) return interaction.editReply('O anuncio ja esta finalizado.');
    await syncOrderMessage(interaction.client, result.order);
    return interaction.editReply(`${copy.closedNoun === 'compra' ? 'Compra' : 'Venda'} finalizada e compactada no canal.`);
  }
  return interaction.reply({ content: 'Acao de mercado desconhecida.', flags: MessageFlags.Ephemeral });
}

async function handleModal(interaction) {
  const [, action, idText] = interaction.customId.split(':');
  const id = Number(idText);
  if (!Number.isInteger(id) || id <= 0) return interaction.reply({ content: 'Anuncio de mercado invalido.', flags: MessageFlags.Ephemeral });
  const order = repo.getOrder(id);
  if (!order) return interaction.reply({ content: 'Anuncio de mercado nao encontrado.', flags: MessageFlags.Ephemeral });
  const copy = listingCopy(order);

  if (action === 'edit_submit') {
    if (!canManageOrder(interaction, order)) return interaction.reply({ content: `Somente o ${copy.ownerRole} ou a staff pode editar.`, flags: MessageFlags.Ephemeral });
    const title = interaction.fields.getTextInputValue('title').trim();
    const items = interaction.fields.getTextInputValue('items').trim();
    const terms = interaction.fields.getTextInputValue('terms').trim();
    if (!title || !items || !terms) return interaction.reply({ content: 'Todos os campos sao obrigatorios.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = repo.updateOrder({ id, title, items, terms });
    await syncOrderMessage(interaction.client, result.order);
    return interaction.editReply('Anuncio atualizado.');
  }

  if (action === 'offer_submit') {
    if (order.status !== 'open') return interaction.reply({ content: `Essa ${copy.closedNoun} ja foi finalizada.`, flags: MessageFlags.Ephemeral });
    if (interaction.user.id === ownerId(order)) return interaction.reply({ content: `Voce e o ${copy.ownerRole} deste anuncio.`, flags: MessageFlags.Ephemeral });
    const items = interaction.fields.getTextInputValue('items').trim();
    const note = interaction.fields.getTextInputValue('note').trim();
    if (!items) return interaction.reply({ content: 'Informe os itens e quantidades.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = repo.createOffer({ orderId: id, offererId: interaction.user.id, items, note });
    if (!result.changed) return interaction.editReply(`Essa ${copy.closedNoun} ja foi finalizada.`);
    const thread = await ensureOrderThread(interaction.client, order, interaction.user.id);
    await thread.send({
      content: [
        `\uD83E\uDD1D Oferta #${result.offer.id} de <@${interaction.user.id}> para <@${ownerId(order)}>`,
        `**Itens/quantidade:** ${truncate(items, 1000)}`,
        note ? `**Preco/observacao:** ${truncate(note, 1000)}` : null
      ].filter(Boolean).join('\n'),
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`wtb:confirm_offer:${result.offer.id}`).setLabel(copy.confirmButton).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`wtb:withdraw_offer:${result.offer.id}`).setLabel('Retirar oferta').setStyle(ButtonStyle.Secondary)
      )],
      allowedMentions: { users: [ownerId(order), interaction.user.id] }
    });
    await syncOrderMessage(interaction.client, repo.getOrder(id));
    return interaction.editReply({ content: `Oferta registrada em https://discord.com/channels/${order.guild_id}/${thread.id}`, allowedMentions: { parse: [] } });
  }
  return interaction.reply({ content: 'Formulario de mercado desconhecido.', flags: MessageFlags.Ephemeral });
}

async function reconcileOrderMessages(client) {
  const orders = repo.listPublishedOrders();
  let updated = 0;
  for (const order of orders) {
    try {
      if (await syncOrderMessage(client, order)) updated += 1;
    } catch (error) {
      console.error(`[MARKETPLACE] Falha ao sincronizar anuncio #${order.id}:`, error);
    }
  }
  return { checked: orders.length, updated };
}

module.exports = {
  handleButton,
  handleModal,
  handleOrderMessage,
  orderComponents,
  orderEmbed,
  orderPayload,
  parseOrderContent,
  reconcileOrderMessages
};
