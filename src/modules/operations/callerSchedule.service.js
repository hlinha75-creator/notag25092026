const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder
} = require('discord.js');
const { getDatabase, transaction } = require('../../database/connection');
const { hasAnyRole } = require('../../config/permissions');

const slots = [
  { key: '1030', label: '10:30' },
  { key: '1200', label: '12:00' },
  { key: '1400', label: '14:00' },
  { key: '1600', label: '16:00' },
  { key: '1800', label: '18:00' },
  { key: '2000', label: '20:00' },
  { key: '2215', label: '22:15' },
  { key: '0000', label: '00:00' }
];

const contents = {
  group_dungeon: { label: 'DG Grupo 8+', emoji: '\u2694\uFE0F' },
  roaming: { label: 'Roaming 4.2', emoji: '\uD83D\uDCCD' },
  world_boss: { label: 'Farming World Boss', emoji: '\uD83D\uDC80' }
};

function requireCaller(member) {
  if (!hasAnyRole(member, ['caller', 'staff', 'adm'])) {
    throw new Error('Somente Caller, Staff ou ADM pode assumir um horario.');
  }
}

function requireStaff(member) {
  if (!hasAnyRole(member, ['staff', 'adm'])) {
    throw new Error('Somente Staff ou ADM pode publicar ou encerrar a escala.');
  }
}

const createSchedule = transaction(({ guildId, channelId, date, actorId }) => {
  const db = getDatabase();
  db.prepare(`
    UPDATE caller_content_schedules
    SET status = 'closed', closed_at = CURRENT_TIMESTAMP
    WHERE guild_id = ? AND status = 'open'
  `).run(guildId);
  const result = db.prepare(`
    INSERT INTO caller_content_schedules (guild_id, channel_id, schedule_date, created_by)
    VALUES (?, ?, ?, ?)
  `).run(guildId, channelId, date, actorId);
  return Number(result.lastInsertRowid);
});

function attachMessage(scheduleId, messageId) {
  getDatabase().prepare(`
    UPDATE caller_content_schedules SET message_id = ? WHERE id = ?
  `).run(messageId, scheduleId);
}

function getSchedule(scheduleId) {
  const schedule = getDatabase().prepare('SELECT * FROM caller_content_schedules WHERE id = ?').get(scheduleId);
  if (!schedule) throw new Error('Essa escala nao existe mais.');
  return schedule;
}

function listAssignments(scheduleId) {
  return getDatabase().prepare(`
    SELECT slot_key, caller_id, content_key
    FROM caller_content_assignments
    WHERE schedule_id = ?
    ORDER BY slot_key
  `).all(scheduleId);
}

function schedulePayload(scheduleId) {
  const schedule = getSchedule(scheduleId);
  const bySlot = new Map(listAssignments(scheduleId).map((item) => [item.slot_key, item]));
  const lines = slots.map((slot) => {
    const assignment = bySlot.get(slot.key);
    if (!assignment) return `\u25FB\uFE0F **${slot.label}** — disponivel`;
    const content = contents[assignment.content_key]?.label || assignment.content_key;
    return `\u2705 **${slot.label}** — ${content} — <@${assignment.caller_id}>`;
  });
  const closed = schedule.status === 'closed';
  const embed = new EmbedBuilder()
    .setTitle('\uD83D\uDCC5 Escala de Callers — Conteudos da HO Spring')
    .setDescription([
      `**Data:** ${schedule.schedule_date}`,
      'Escolha um horario e depois o conteudo que voce vai puxar.',
      'DG Grupo 8+ e Roaming 4.2 saem da **HO de Spring**. O horario de 00:00 e reservado ao **Farming World Boss**.',
      '',
      ...lines,
      '',
      closed ? '**Escala encerrada.**' : 'Use o menu abaixo para assumir ou alterar seu proprio horario.'
    ].join('\n'))
    .setColor(closed ? 0x718096 : 0x2f855a)
    .setFooter({ text: `Escala #${schedule.id}` });

  if (closed) return { embeds: [embed], components: [], allowedMentions: { parse: [] } };
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`caller_schedule:slot:${schedule.id}`)
          .setPlaceholder('Escolha um horario')
          .addOptions(slots.map((slot) => {
            const assignment = bySlot.get(slot.key);
            return {
              label: slot.label,
              value: slot.key,
              description: assignment
                ? `${contents[assignment.content_key]?.label || assignment.content_key} — ocupado`
                : slot.key === '0000' ? 'Farming World Boss' : 'Disponivel'
            };
          }))
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`caller_schedule:release:${schedule.id}`)
          .setLabel('Liberar meus horarios')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`caller_schedule:close:${schedule.id}`)
          .setLabel('Encerrar escala')
          .setStyle(ButtonStyle.Danger)
      )
    ],
    allowedMentions: { parse: [] }
  };
}

function contentChoicePayload(scheduleId, slotKey) {
  const schedule = getSchedule(scheduleId);
  if (schedule.status !== 'open') throw new Error('Essa escala ja foi encerrada.');
  const slot = slots.find((item) => item.key === slotKey);
  if (!slot) throw new Error('Horario invalido.');
  const allowed = slotKey === '0000' ? ['world_boss'] : ['group_dungeon', 'roaming'];
  return {
    content: `Horario escolhido: **${slot.label}**. Agora selecione o conteudo:`,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`caller_schedule:content:${scheduleId}:${slotKey}`)
          .setPlaceholder('Escolha o conteudo')
          .addOptions(allowed.map((key) => ({
            label: contents[key].label,
            value: key,
            emoji: contents[key].emoji
          })))
      )
    ],
    flags: MessageFlags.Ephemeral
  };
}

const assignSlot = transaction(({ scheduleId, slotKey, callerId, contentKey }) => {
  const schedule = getSchedule(scheduleId);
  if (schedule.status !== 'open') throw new Error('Essa escala ja foi encerrada.');
  const slot = slots.find((item) => item.key === slotKey);
  if (!slot) throw new Error('Horario invalido.');
  const allowed = slotKey === '0000' ? ['world_boss'] : ['group_dungeon', 'roaming'];
  if (!allowed.includes(contentKey)) throw new Error('Conteudo invalido para esse horario.');
  const current = getDatabase().prepare(`
    SELECT caller_id FROM caller_content_assignments WHERE schedule_id = ? AND slot_key = ?
  `).get(scheduleId, slotKey);
  if (current && current.caller_id !== callerId) {
    throw new Error(`O horario ${slot.label} ja foi assumido por outro caller.`);
  }
  getDatabase().prepare(`
    INSERT INTO caller_content_assignments (schedule_id, slot_key, caller_id, content_key)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(schedule_id, slot_key) DO UPDATE SET
      caller_id = excluded.caller_id,
      content_key = excluded.content_key,
      updated_at = CURRENT_TIMESTAMP
  `).run(scheduleId, slotKey, callerId, contentKey);
  return { slot, content: contents[contentKey] };
});

function releaseCaller(scheduleId, callerId) {
  const schedule = getSchedule(scheduleId);
  if (schedule.status !== 'open') throw new Error('Essa escala ja foi encerrada.');
  return getDatabase().prepare(`
    DELETE FROM caller_content_assignments WHERE schedule_id = ? AND caller_id = ?
  `).run(scheduleId, callerId).changes;
}

function closeSchedule(scheduleId) {
  getSchedule(scheduleId);
  getDatabase().prepare(`
    UPDATE caller_content_schedules
    SET status = 'closed', closed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(scheduleId);
}

async function refreshPublicMessage(client, scheduleId) {
  const schedule = getSchedule(scheduleId);
  if (!schedule.message_id) return null;
  const channel = await client.channels.fetch(schedule.channel_id).catch(() => null);
  const message = channel?.isTextBased()
    ? await channel.messages.fetch(schedule.message_id).catch(() => null)
    : null;
  if (message) await message.edit(schedulePayload(scheduleId));
  return message;
}

async function publishFromCommand(interaction) {
  requireStaff(interaction.member);
  const date = interaction.options.getString('data') || new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(new Date());
  const scheduleId = createSchedule({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    date,
    actorId: interaction.user.id
  });
  const message = await interaction.channel.send(schedulePayload(scheduleId));
  attachMessage(scheduleId, message.id);
  return scheduleId;
}

async function handleSelect(interaction) {
  requireCaller(interaction.member);
  const [, action, scheduleIdText, slotFromId] = interaction.customId.split(':');
  const scheduleId = Number(scheduleIdText);
  if (action === 'slot') {
    const slotKey = interaction.values[0];
    const current = listAssignments(scheduleId).find((item) => item.slot_key === slotKey);
    if (current && current.caller_id !== interaction.user.id) {
      throw new Error('Esse horario ja foi assumido. Escolha outro horario disponivel.');
    }
    return interaction.reply(contentChoicePayload(scheduleId, slotKey));
  }
  if (action === 'content') {
    const result = assignSlot({
      scheduleId,
      slotKey: slotFromId,
      callerId: interaction.user.id,
      contentKey: interaction.values[0]
    });
    await refreshPublicMessage(interaction.client, scheduleId);
    return interaction.update({
      content: `Confirmado: **${result.content.label}** as **${result.slot.label}**.`,
      components: []
    });
  }
}

async function handleButton(interaction) {
  const [, action, scheduleIdText] = interaction.customId.split(':');
  const scheduleId = Number(scheduleIdText);
  if (action === 'release') {
    requireCaller(interaction.member);
    const removed = releaseCaller(scheduleId, interaction.user.id);
    await refreshPublicMessage(interaction.client, scheduleId);
    return interaction.reply({
      content: removed ? `${removed} horario(s) liberado(s).` : 'Voce nao tinha horarios nessa escala.',
      flags: MessageFlags.Ephemeral
    });
  }
  if (action === 'close') {
    requireStaff(interaction.member);
    closeSchedule(scheduleId);
    await interaction.update(schedulePayload(scheduleId));
  }
}

module.exports = {
  assignSlot,
  attachMessage,
  closeSchedule,
  contentChoicePayload,
  contents,
  createSchedule,
  getSchedule,
  handleButton,
  handleSelect,
  listAssignments,
  publishFromCommand,
  releaseCaller,
  requireStaff,
  schedulePayload,
  slots
};
