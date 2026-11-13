const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase, transaction } = require('../../database/connection');
const { hasRole, isOwner } = require('../../config/permissions');

const RULES_KEY = 'notag-rules:v1';
const HELP_VOICE_NAME = 'ME AJUDEM';
const TRIGGER_PATTERN = /^(?:publicar\s+)?(?:aviso\s+obrigat[oó]rio|regras?\s+(?:da\s+)?season|novas?\s+regras?)(?:\s*[:\-]\s*)?/i;

function campaign() {
  return getDatabase().prepare('SELECT * FROM mandatory_rule_campaigns WHERE rule_key = ?').get(RULES_KEY);
}

function acknowledgementCount() {
  const row = getDatabase().prepare(`
    SELECT COUNT(*) AS total
    FROM mandatory_rule_members
    WHERE rule_key = ? AND acknowledged_at IS NOT NULL
  `).get(RULES_KEY);
  return Number(row?.total || 0);
}

function pendingCount() {
  const row = getDatabase().prepare(`
    SELECT COUNT(*) AS total
    FROM mandatory_rule_members
    WHERE rule_key = ? AND acknowledged_at IS NULL
  `).get(RULES_KEY);
  return Number(row?.total || 0);
}

function publicComponents(includeDetails = true) {
  const buttons = [new ButtonBuilder()
      .setCustomId(`mandatory_rules:ack:v1`)
      .setLabel(`Li e estou ciente (${acknowledgementCount()})`)
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)];
  if (includeDetails) {
    buttons.push(new ButtonBuilder()
      .setCustomId(`mandatory_rules:details:v1`)
      .setLabel('Ver regras completas')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Secondary));
  }
  return [new ActionRowBuilder().addComponents(...buttons)];
}

function staffComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mandatory_rules:pending:v1`)
      .setLabel(`Ver pendentes (${pendingCount()})`)
      .setEmoji('👥')
      .setStyle(ButtonStyle.Secondary)
  )];
}

function staffControlPayload() {
  return {
    content: [
      '🛡️ **CONTROLE INTERNO — LEITURA DAS REGRAS**',
      `Confirmaram: **${acknowledgementCount()}** · Pendentes: **${pendingCount()}**`,
      'A lista fica disponível somente para a equipe autorizada.'
    ].join('\n'),
    components: staffComponents(),
    allowedMentions: { parse: [] }
  };
}

function defaultRulesEmbed() {
  return new EmbedBuilder()
    .setColor(0xf2bd4a)
    .setTitle('📢 ANTES DE PERGUNTAR, CONFIRA O DISCORD')
    .setDescription([
      'A staff e os callers têm paciência para ajudar. Porém, antes de perguntar, precisamos que você procure a informação que já foi publicada.',
      '',
      'Saber ler os avisos e usar o Discord faz parte dos requisitos para estar na **NoTag**.'
    ].join('\n'))
    .addFields(
      {
        name: '📖 Leia primeiro',
        value: [
          'Antes de perguntar, confira o **canal de avisos**, a **descrição do conteúdo**, as mensagens fixadas e as regras completas.',
          'Se a resposta não estiver lá ou continuar confusa, pode perguntar: nós ajudaremos.'
        ].join('\n')
      },
      {
        name: '💰 Split feito pelo bot',
        value: [
          '• Conteúdos Royal: taxa de **20%**.',
          '• Demais conteúdos: taxa de **30%**.',
          '• Exemplo: em **1.000.000**, o bot desconta **300.000** e adiciona **700.000** ao saldo.'
        ].join('\n')
      },
      {
        name: '✅ Confirme a leitura',
        value: 'Leia as regras completas e clique em **Li e estou ciente**. A confirmação serve para a staff acompanhar quem já leu; seu acesso não depende do botão.'
      }
    )
    .setFooter({ text: 'NoTag • Leia primeiro. Se ainda tiver dúvida, pode perguntar.' });
}

function fullRulesEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📖 REGRAS COMPLETAS DA NOTAG')
    .setDescription('Estas regras valem para membros, callers e staff. Leia com atenção antes de confirmar.')
    .addFields(
      {
        name: '1. Discord e leitura são obrigatórios',
        value: [
          '• Para entrar na NoTag, é obrigatório usar o Discord e conversar em call de voz.',
          '• Antes de perguntar, leia o canal de avisos, a descrição do conteúdo e as mensagens fixadas.',
          '• Saber encontrar as informações publicadas no Discord é um requisito para permanecer na guild.',
          '• Se a informação não estiver publicada ou continuar confusa, pergunte: a equipe terá prazer em ajudar.'
        ].join('\n')
      },
      {
        name: '2. Taxa do Albion ≠ taxa dos eventos',
        value: [
          'A taxa nativa da guild no Albion é descontada automaticamente pelo jogo quando a prata cai do chão.',
          'A taxa explicada aqui é outra: ela é calculada pelo bot quando a guild vende o loot e adiciona o pagamento em saldo.'
        ].join('\n')
      },
      {
        name: '3. Taxas dos splits pelo bot',
        value: [
          '• Conteúdos realizados no Royal: **20%**.',
          '• Demais conteúdos administrados pelo bot: **30%**.',
          '• Distribuição dos 30%: **5% caller + 5% transporte + 15% vendedor + 5% caixa da guild**.',
          '• Exemplo: loot vendido por **1.000.000** → desconto de **300.000** → saldo do membro de **700.000**.',
          '• Se o caller fizer a divisão manual, registra **0** no bot e não há saldo automatizado.'
        ].join('\n')
      },
      {
        name: '4. Como a guild usa esses recursos',
        value: 'Os recursos ajudam a pagar o trabalho de caller, transporte e venda, fortalecer o caixa, manter builds no baú e criar mais conteúdos em grupo.'
      },
      {
        name: '5. Onde nos encontramos',
        value: [
          '• Portal principal: **Bridgewatch**.',
          '• HO: **Sunkenbough Spring**, mapa T8.',
          '• World Boss: Smuggler’s Den de **Frostspring Volcano**, mapa T7.'
        ].join('\n')
      },
      {
        name: '6. Confirmação de leitura',
        value: 'Clique em **Li e estou ciente** para registrar que você leu. A staff poderá consultar quem confirmou e quem ainda está pendente, sem remover cargos ou limitar canais.'
      }
    )
    .setFooter({ text: 'As regras de regear ficam em um aviso separado.' });
}

function fullRulesPayload() {
  return {
    embeds: [fullRulesEmbed()],
    allowedMentions: { parse: [] }
  };
}

function customRulesEmbed(text) {
  return new EmbedBuilder()
    .setColor(0xf2bd4a)
    .setTitle('📢 AVISO OBRIGATÓRIO — CONFIRMAÇÃO NECESSÁRIA')
    .setDescription(String(text).slice(0, 4096))
    .addFields({
      name: '✅ Confirmação',
      value: 'Clique em **Li e estou ciente** para registrar sua leitura. A confirmação não remove nem bloqueia cargos.'
    });
}

function announcementPayload(customText) {
  return {
    content: `<@&${ids.roles.member}> <@&${ids.roles.caller}> <@&${ids.roles.staff}>`,
    embeds: [customText ? customRulesEmbed(customText) : defaultRulesEmbed()],
    components: publicComponents(!customText),
    allowedMentions: { roles: [ids.roles.member, ids.roles.caller, ids.roles.staff] }
  };
}

function isRelevantMember(member) {
  return ['member', 'caller', 'staff', 'adm'].some((roleName) => hasRole(member, roleName));
}

function canPublish(member) {
  return isOwner(member) || hasRole(member, 'staff') || hasRole(member, 'adm');
}

function stripBotMention(content, botId) {
  return String(content || '').replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
}

function parseTrigger(content, botId) {
  const withoutMention = stripBotMention(content, botId);
  if (!TRIGGER_PATTERN.test(withoutMention)) return null;
  const remainder = withoutMention.replace(TRIGGER_PATTERN, '').trim();
  return { customText: remainder || null };
}

function trackMembers(members) {
  const insert = getDatabase().prepare(`
    INSERT INTO mandatory_rule_members (rule_key, user_id, had_member_role)
    VALUES (?, ?, ?)
    ON CONFLICT(rule_key, user_id) DO UPDATE SET
      had_member_role = MAX(mandatory_rule_members.had_member_role, excluded.had_member_role)
  `);
  const run = transaction((rows) => {
    for (const member of rows) insert.run(RULES_KEY, member.id, hasRole(member, 'member') ? 1 : 0);
  });
  run([...members].filter((member) => !member.user?.bot && isRelevantMember(member)));
}

function upsertCampaign({ guildId, channelId, messageId, helpVoiceChannelId, createdBy }) {
  getDatabase().prepare(`
    INSERT INTO mandatory_rule_campaigns
      (rule_key, guild_id, announcement_channel_id, announcement_message_id, help_voice_channel_id, member_role_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(rule_key) DO UPDATE SET
      guild_id = excluded.guild_id,
      announcement_channel_id = excluded.announcement_channel_id,
      announcement_message_id = excluded.announcement_message_id,
      help_voice_channel_id = excluded.help_voice_channel_id,
      member_role_id = excluded.member_role_id,
      updated_at = CURRENT_TIMESTAMP
  `).run(RULES_KEY, guildId, channelId, messageId, helpVoiceChannelId, ids.roles.member, createdBy);
  return campaign();
}

async function ensureHelpVoiceChannel(guild) {
  const existingCampaign = campaign();
  if (existingCampaign?.help_voice_channel_id) {
    const saved = await guild.channels.fetch(existingCampaign.help_voice_channel_id).catch(() => null);
    if (saved?.type === ChannelType.GuildVoice) {
      await saved.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: true, Connect: true });
      return saved;
    }
  }

  const fetched = await guild.channels.fetch();
  const existing = [...fetched.values()].find((channel) => (
    channel.type === ChannelType.GuildVoice && channel.name.toLocaleUpperCase('pt-BR') === HELP_VOICE_NAME
  ));
  if (existing) {
    await existing.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: true, Connect: true });
    return existing;
  }

  const waiting = await guild.channels.fetch(ids.channels.waitingVoice).catch(() => null);
  return guild.channels.create({
    name: HELP_VOICE_NAME,
    type: ChannelType.GuildVoice,
    parent: waiting?.parentId || undefined,
    permissionOverwrites: [{
      id: guild.roles.everyone.id,
      allow: ['ViewChannel', 'Connect']
    }],
    reason: 'Call de suporte para membros pendentes das regras'
  });
}

function hasActiveGroupCall(guild, helpVoiceChannelId) {
  for (const channel of guild.channels.cache.values()) {
    if (!channel.isVoiceBased?.() || channel.id === helpVoiceChannelId) continue;
    const humans = [...channel.members.values()].filter((member) => !member.user?.bot);
    if (humans.length >= 2) return true;
  }
  return false;
}

function pendingRows() {
  return getDatabase().prepare(`
    SELECT * FROM mandatory_rule_members
    WHERE rule_key = ? AND acknowledged_at IS NULL
    ORDER BY user_id
  `).all(RULES_KEY);
}

async function removePendingMemberRoles(guild) {
  let removed = 0;
  let failed = 0;
  const markRemoved = getDatabase().prepare(`
    UPDATE mandatory_rule_members
    SET role_removed_at = COALESCE(role_removed_at, CURRENT_TIMESTAMP)
    WHERE rule_key = ? AND user_id = ?
  `);
  for (const row of pendingRows().filter((item) => item.had_member_role)) {
    const member = await guild.members.fetch(row.user_id).catch(() => null);
    if (!member || !member.roles.cache.has(ids.roles.member)) {
      markRemoved.run(RULES_KEY, row.user_id);
      continue;
    }
    const ok = await member.roles.remove(ids.roles.member, 'Confirmação das novas regras pendente')
      .then(() => true)
      .catch((error) => {
        console.error(`[REGRAS] Falha ao remover cargo Membro de ${row.user_id}:`, error);
        return false;
      });
    if (ok) {
      markRemoved.run(RULES_KEY, row.user_id);
      removed += 1;
    } else failed += 1;
  }
  return { removed, failed };
}

async function restoreRolesRemovedByCampaign(guild) {
  let restored = 0;
  let failed = 0;
  const rows = getDatabase().prepare(`
    SELECT * FROM mandatory_rule_members
    WHERE rule_key = ?
      AND had_member_role = 1
      AND role_removed_at IS NOT NULL
      AND role_restored_at IS NULL
    ORDER BY user_id
  `).all(RULES_KEY);
  const markRestored = getDatabase().prepare(`
    UPDATE mandatory_rule_members
    SET role_restored_at = CURRENT_TIMESTAMP
    WHERE rule_key = ? AND user_id = ?
  `);

  for (const row of rows) {
    const member = await guild.members.fetch(row.user_id).catch(() => null);
    if (!member) {
      markRestored.run(RULES_KEY, row.user_id);
      continue;
    }
    if (member.roles.cache.has(ids.roles.member)) {
      markRestored.run(RULES_KEY, row.user_id);
      continue;
    }
    const ok = await member.roles.add(ids.roles.member, 'Campanha alterada para confirmação informativa')
      .then(() => true)
      .catch((error) => {
        console.error(`[REGRAS] Falha ao restaurar cargo Membro de ${row.user_id}:`, error);
        return false;
      });
    if (ok) {
      markRestored.run(RULES_KEY, row.user_id);
      restored += 1;
    } else failed += 1;
  }
  return { restored, failed };
}

async function enforceIfVoiceQuiet(client) {
  const current = campaign();
  if (!current) return { enforced: false, reason: 'no_campaign' };
  const guild = await client.guilds.fetch(current.guild_id).catch(() => null);
  if (!guild) return { enforced: false, reason: 'guild_unavailable' };
  const result = await restoreRolesRemovedByCampaign(guild);
  if (current.status !== 'acknowledgement_only') {
    getDatabase().prepare(`
      UPDATE mandatory_rule_campaigns
      SET status = 'acknowledgement_only', updated_at = CURRENT_TIMESTAMP
      WHERE rule_key = ?
    `).run(RULES_KEY);
  }
  return { enforced: false, reason: 'acknowledgement_only', ...result };
}

async function updateAnnouncementMessage(client) {
  const current = campaign();
  if (!current?.announcement_message_id) return false;
  const channel = await client.channels.fetch(current.announcement_channel_id).catch(() => null);
  const message = channel?.messages ? await channel.messages.fetch(current.announcement_message_id).catch(() => null) : null;
  if (!message) return false;
  const isCustom = message.embeds?.[0]?.title?.includes('AVISO OBRIGATÓRIO');
  await message.edit(isCustom ? { components: publicComponents(false) } : announcementPayload());
  await upsertStaffControlMessage(client);
  return true;
}

async function upsertStaffControlMessage(client) {
  const key = 'mandatory-rules:staff-control:v1';
  const channel = await client.channels.fetch(ids.channels.staff).catch(() => null);
  if (!channel?.isTextBased()) return null;
  const db = getDatabase();
  const saved = db.prepare('SELECT * FROM persistent_bot_messages WHERE message_key = ?').get(key);
  let message = saved?.message_id
    ? await channel.messages.fetch(saved.message_id).catch(() => null)
    : null;
  message = message
    ? await message.edit(staffControlPayload())
    : await channel.send(staffControlPayload());
  db.prepare(`
    INSERT INTO persistent_bot_messages (message_key, channel_id, message_id, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(message_key) DO UPDATE SET
      channel_id = excluded.channel_id,
      message_id = excluded.message_id,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, channel.id, message.id);
  return message;
}

async function publishRules(message, customText) {
  const guild = message.guild;
  const members = await guild.members.fetch();
  const helpVoice = await ensureHelpVoiceChannel(guild);
  const announcementChannel = await guild.channels.fetch(ids.channels.announcements);
  if (!announcementChannel?.isTextBased()) throw new Error('O canal de avisos não está disponível.');
  await announcementChannel.permissionOverwrites.edit(guild.roles.everyone.id, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: false
  });

  const existingCampaign = campaign();
  let publication = existingCampaign?.announcement_message_id
    ? await announcementChannel.messages.fetch(existingCampaign.announcement_message_id).catch(() => null)
    : null;
  publication = publication
    ? await publication.edit(announcementPayload(customText))
    : await announcementChannel.send(announcementPayload(customText));
  upsertCampaign({
    guildId: guild.id,
    channelId: announcementChannel.id,
    messageId: publication.id,
    helpVoiceChannelId: helpVoice.id,
    createdBy: message.author.id
  });
  trackMembers(members.values());
  await publication.edit({ components: publicComponents(!customText) });
  await upsertStaffControlMessage(message.client);
  const enforcement = await enforceIfVoiceQuiet(message.client);
  return { publication, helpVoice, enforcement };
}

async function handleStaffMessage(message) {
  if (!message.guild || message.author.bot || message.channelId !== ids.channels.staff) return false;
  if (!message.client.user || !message.mentions.users.has(message.client.user.id)) return false;
  const trigger = parseTrigger(message.content, message.client.user.id);
  if (!trigger) return false;
  if (!canPublish(message.member)) {
    await message.reply({ content: 'Somente Staff ou ADM pode publicar um aviso obrigatório.', allowedMentions: { repliedUser: true } });
    return true;
  }
  try {
    const result = await publishRules(message, trigger.customText);
    const status = [
      'A campanha apenas registrará quem confirmou a leitura; nenhum cargo será removido.',
      result.enforcement.restored
        ? `${result.enforcement.restored} cargo(s) removido(s) anteriormente foram restaurados.`
        : null
    ].filter(Boolean).join(' ');
    await message.reply({
      content: `Aviso publicado em <#${ids.channels.announcements}>. A call **${HELP_VOICE_NAME}** está pronta. ${status}`,
      allowedMentions: { parse: [], repliedUser: false }
    });
  } catch (error) {
    await message.reply({ content: `Não consegui publicar o aviso: ${error.message}`, allowedMentions: { repliedUser: true } }).catch(() => {});
  }
  return true;
}

function getTrackedMember(userId) {
  return getDatabase().prepare(`
    SELECT * FROM mandatory_rule_members WHERE rule_key = ? AND user_id = ?
  `).get(RULES_KEY, userId);
}

async function acknowledge(interaction) {
  const current = campaign();
  if (!current) throw new Error('Este aviso não está mais ativo.');
  let tracked = getTrackedMember(interaction.user.id);
  if (!tracked && isRelevantMember(interaction.member)) {
    trackMembers([interaction.member]);
    tracked = getTrackedMember(interaction.user.id);
  }
  if (!tracked) throw new Error('Você não faz parte do público deste aviso.');

  const added = !tracked.acknowledged_at;
  getDatabase().prepare(`
    UPDATE mandatory_rule_members
    SET acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP)
    WHERE rule_key = ? AND user_id = ?
  `).run(RULES_KEY, interaction.user.id);
  getDatabase().prepare(`
    INSERT OR IGNORE INTO announcement_acknowledgements (announcement_key, user_id)
    VALUES (?, ?)
  `).run(RULES_KEY, interaction.user.id);

  let restored = false;
  if (tracked.had_member_role && !interaction.member.roles.cache.has(ids.roles.member)) {
    restored = await interaction.member.roles.add(ids.roles.member, 'Leu e confirmou as novas regras da NoTag')
      .then(() => true)
      .catch((error) => {
        console.error(`[REGRAS] Falha ao devolver cargo Membro para ${interaction.user.id}:`, error);
        return false;
      });
    if (restored) {
      getDatabase().prepare(`
        UPDATE mandatory_rule_members SET role_restored_at = CURRENT_TIMESTAMP
        WHERE rule_key = ? AND user_id = ?
      `).run(RULES_KEY, interaction.user.id);
    }
  }
  if (interaction.client) {
    await upsertStaffControlMessage(interaction.client).catch((error) => {
      console.error('[REGRAS] Falha ao atualizar controle interno:', error);
    });
  }
  const isCustom = interaction.message?.embeds?.[0]?.title?.includes('AVISO OBRIGATÓRIO');
  return { added, restored, components: publicComponents(!isCustom) };
}

function pendingPages() {
  const rows = pendingRows();
  if (!rows.length) return ['**Pendentes (0):**\nTodos confirmaram.'];
  const pages = [];
  let page = `**Pendentes (${rows.length}):**`;
  for (const row of rows) {
    const line = `<@${row.user_id}>`;
    if (`${page}\n${line}`.length > 1900) {
      pages.push(page);
      page = `**Pendentes (${rows.length}) — continuação:**\n${line}`;
    } else page += `\n${line}`;
  }
  pages.push(page);
  return pages;
}

async function handleMemberUpdate(oldMember, newMember) {
  const current = campaign();
  if (!current || newMember.guild.id !== current.guild_id || newMember.user?.bot) return false;
  if (!isRelevantMember(newMember)) return false;
  trackMembers([newMember]);
  return false;
}

module.exports = {
  HELP_VOICE_NAME,
  RULES_KEY,
  acknowledge,
  acknowledgementCount,
  announcementPayload,
  campaign,
  defaultRulesEmbed,
  enforceIfVoiceQuiet,
  fullRulesEmbed,
  fullRulesPayload,
  handleMemberUpdate,
  handleStaffMessage,
  hasActiveGroupCall,
  isRelevantMember,
  parseTrigger,
  pendingCount,
  pendingPages,
  publicComponents,
  publishRules,
  restoreRolesRemovedByCampaign,
  staffComponents,
  staffControlPayload,
  trackMembers,
  upsertStaffControlMessage,
  updateAnnouncementMessage
};
