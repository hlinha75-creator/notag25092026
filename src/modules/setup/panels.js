const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const operations = require('../operations/operations.service');
const staffTutorial = require('../tutorials/staffTutorial.service');
const memberOnboarding = require('../tutorials/memberOnboarding.service');
const eventNotificationPreferences = require('../events/eventNotificationPreferences.service');
const { COMPOSITION_SHEET_URL } = require('../events/compositionRules');

const archiveEmbed = new EmbedBuilder()
  .setTitle('Arquivar')
  .setDescription('Exportacao e importacao manual de dados.')
  .setColor(0x805ad5);

const archiveComponents = [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('csv:export_balances').setLabel('Exportar saldos').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('csv:export_transactions').setLabel('Logs financeiros').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('csv:export_audit').setLabel('Auditoria').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('guild:export_members_html').setLabel('Discord x Albion').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('csv:import_help').setLabel('Importar CSV').setStyle(ButtonStyle.Primary)
  )
];

const panels = [
  {
    type: 'create_event',
    channelId: ids.channels.createEvent,
    embed: new EmbedBuilder()
      .setTitle('Criar evento')
      .setDescription('Um único fluxo para todos os conteúdos. Clique abaixo, escolha o tipo e siga as etapas.')
      .setColor(0x3182ce),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel:create_event').setLabel('Criar Evento').setEmoji('➕').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setLabel('Planilha de composições').setEmoji('📋').setURL(COMPOSITION_SHEET_URL).setStyle(ButtonStyle.Link)
      )
    ]
  },
  {
    type: 'registration',
    channelId: ids.channels.register,
    embed: new EmbedBuilder().setTitle('Registro').setDescription('Clique para registrar seu nick do Albion e liberar acesso inicial.').setColor(0x38a169),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel:registration').setLabel('Registrar Nick').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('panel:member_profile').setLabel('Meu perfil').setStyle(ButtonStyle.Secondary)
      )
    ]
  },
  {
    type: 'balance',
    channelId: ids.channels.consultBalance,
    embed: new EmbedBuilder().setTitle('Saldo').setDescription('Consulte saldo ou solicite saque.').setColor(0x38a169),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('finance:balance').setLabel('Consultar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('finance:withdraw').setLabel('Sacar').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('finance:payment_request').setLabel('Service').setStyle(ButtonStyle.Danger)
      )
    ]
  },
  {
    type: 'admin',
    channelId: ids.channels.adminPanel,
    dynamic: operations.adminPanelPayload
  },
  {
    type: 'deposit',
    channelId: ids.channels.deposit,
    embed: new EmbedBuilder().setTitle('Deposito').setDescription('Staff pode criar deposito rapido dividido igualmente entre participantes.').setColor(0x38a169),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('deposit:create').setLabel('Criar deposito').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('deposit:create_list').setLabel('Deposito por lista').setStyle(ButtonStyle.Success)
      )
    ]
  },
  {
    type: 'archive',
    channelId: ids.channels.archive,
    embed: archiveEmbed,
    components: archiveComponents
  },
  {
    type: 'member_tutorial',
    channelId: ids.channels.memberTutorial,
    dynamic: memberOnboarding.panelPayload
  },
  {
    type: 'staff_tutorial',
    channelId: ids.channels.staffTutorial,
    dynamic: staffTutorial.panelPayload
  }
];

const disabledPanelChannelIds = [
  ids.channels.memberList,
  ids.channels.notagChat,
  '1521169204059836607',
  ids.channels.pveCareer
].filter(Boolean);

async function upsertSetupPanels(client) {
  const db = getDatabase();
  const results = [];
  for (const panel of panels) {
    const channel = await client.channels.fetch(panel.channelId).catch(() => null);
    if (!channel?.isTextBased() || !channel.messages) {
      results.push({ type: panel.type, channelId: panel.channelId, ok: false, error: 'canal não encontrado ou incompatível' });
      continue;
    }
    const previous = db.prepare('SELECT * FROM setup_messages WHERE channel_id = ?').get(panel.channelId);
    let message = previous ? await channel.messages.fetch(previous.message_id).catch(() => null) : null;
    try {
      const payload = panel.dynamic
        ? await panel.dynamic(channel.guild)
        : { embeds: panel.embeds || [panel.embed], components: panel.components };
      if (message) {
        await message.edit(payload);
      } else {
        message = await channel.send(payload);
      }
      db.prepare(`
        INSERT INTO setup_messages (channel_id, message_id, panel_type, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(channel_id) DO UPDATE SET message_id = excluded.message_id, panel_type = excluded.panel_type, updated_at = CURRENT_TIMESTAMP
      `).run(panel.channelId, message.id, panel.type);
      results.push({ type: panel.type, channelId: panel.channelId, ok: true });
    } catch (error) {
      results.push({
        type: panel.type,
        channelId: panel.channelId,
        ok: false,
        error: String(error?.message || error).slice(0, 160)
      });
    }
  }
  await deleteDisabledSetupPanels(client, db);
  results.push(...await eventNotificationPreferences.upsertQuestionPanels(client));
  return results;
}

async function deleteDisabledSetupPanels(client, db) {
  for (const channelId of disabledPanelChannelIds) {
    const previous = db.prepare('SELECT * FROM setup_messages WHERE channel_id = ?').get(channelId);
    if (!previous) continue;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    const message = channel?.messages
      ? await channel.messages.fetch(previous.message_id).catch(() => null)
      : null;
    await message?.delete().catch(() => {});
    db.prepare('DELETE FROM setup_messages WHERE channel_id = ?').run(channelId);
  }
}

module.exports = {
  upsertSetupPanels
};

