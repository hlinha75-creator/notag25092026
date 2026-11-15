const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} = require('discord.js');
const env = require('../../config/env');
const ids = require('../../config/ids');
const repo = require('./temporaryVoice.repository');

const TRIGGER_NAME = '+ Criar Sala';
const DEFAULT_GUEST_ACCESS = 'listen';
const LIMIT_OPTIONS = [0, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 99];
const GUEST_ACCESS_MODES = {
  talk: {
    label: 'Entrar e falar',
    description: 'Pessoas sem a tag Membro podem entrar e falar.',
    permissions: { ViewChannel: true, Connect: true, Speak: true, Stream: true }
  },
  listen: {
    label: 'Entrar sem falar',
    description: 'Pessoas sem a tag Membro entram, mas ficam sem falar.',
    permissions: { ViewChannel: true, Connect: true, Speak: false, Stream: false }
  },
  view: {
    label: 'Apenas ver a sala',
    description: 'Pessoas sem a tag Membro veem a sala, mas não entram.',
    permissions: { ViewChannel: true, Connect: false, Speak: false, Stream: false }
  },
  hidden: {
    label: 'Sala oculta',
    description: 'Pessoas sem a tag Membro não veem a sala.',
    permissions: { ViewChannel: false, Connect: false, Speak: false, Stream: false }
  }
};
const creatingForMember = new Map();
const ensuringForGuild = new Map();

function memberRoleIds() {
  return [...new Set([ids.roles.member, ids.roles.staff, ids.roles.adm].filter(Boolean))];
}

function guestAccessPermissions(mode = DEFAULT_GUEST_ACCESS) {
  return { ...(GUEST_ACCESS_MODES[mode] || GUEST_ACCESS_MODES[DEFAULT_GUEST_ACCESS]).permissions };
}

function roomPermissionOverwrites(guild, member) {
  const memberPermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
    PermissionFlagsBits.Stream
  ];
  return [
    {
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
      deny: [PermissionFlagsBits.Speak, PermissionFlagsBits.Stream]
    },
    ...memberRoleIds().map((id) => ({ id, allow: memberPermissions })),
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.MoveMembers,
        PermissionFlagsBits.MuteMembers,
        PermissionFlagsBits.DeafenMembers
      ]
    }
  ];
}

function controlPanelPayload(channelId, ownerId) {
  return {
    content: [
      `## Controles da sala de <@${ownerId}>`,
      'Somente o criador pode alterar estas opções.',
      'Padrão: **sem limite** e pessoas sem a tag Membro **entram sem falar**.'
    ].join('\n'),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`temp_voice:limit:${channelId}`)
          .setLabel('Limite de pessoas')
          .setEmoji('👥')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`temp_voice:access:${channelId}`)
          .setLabel('Acesso sem tag')
          .setEmoji('🏷️')
          .setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

function ownerRecord(interaction, channelId) {
  const record = repo.getByChannel(channelId);
  if (!record || record.guild_id !== interaction.guildId) return null;
  return record.owner_id === interaction.user.id ? record : false;
}

async function fetchOwnedRoom(interaction, channelId) {
  const ownership = ownerRecord(interaction, channelId);
  if (ownership === false) throw new Error('Somente o criador pode configurar esta sala.');
  if (!ownership) throw new Error('Esta sala temporária não está mais ativa.');
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    throw new Error('A sala temporária não foi encontrada.');
  }
  return channel;
}

function limitLabel(value) {
  return Number(value) === 0 ? 'Sem limite' : `${value} pessoas`;
}

async function handleButton(interaction) {
  const [, action, channelId] = interaction.customId.split(':');
  const channel = await fetchOwnedRoom(interaction, channelId);
  if (action === 'limit') {
    const options = LIMIT_OPTIONS.map((value) => ({
      label: limitLabel(value),
      value: String(value),
      default: channel.userLimit === value
    }));
    return interaction.reply({
      content: `Limite atual: **${limitLabel(channel.userLimit)}**. Escolha o novo limite:`,
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`temp_voice_select:limit:${channelId}`)
          .setPlaceholder('Escolher limite de pessoas')
          .addOptions(options)
      )],
      flags: MessageFlags.Ephemeral
    });
  }
  if (action === 'access') {
    return interaction.reply({
      content: 'Escolha o que pessoas sem a tag Membro podem fazer:',
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`temp_voice_select:access:${channelId}`)
          .setPlaceholder('Escolher acesso sem tag')
          .addOptions(Object.entries(GUEST_ACCESS_MODES).map(([value, mode]) => ({
            label: mode.label,
            description: mode.description,
            value
          })))
      )],
      flags: MessageFlags.Ephemeral
    });
  }
  return null;
}

async function handleSelect(interaction) {
  const [, action, channelId] = interaction.customId.split(':');
  const channel = await fetchOwnedRoom(interaction, channelId);
  if (action === 'limit') {
    const limit = Number(interaction.values[0]);
    if (!LIMIT_OPTIONS.includes(limit)) throw new Error('Limite inválido.');
    await channel.setUserLimit(limit, `Limite alterado pelo criador ${interaction.user.tag}`);
    return interaction.update({
      content: `Limite atualizado para **${limitLabel(limit)}**.`,
      components: []
    });
  }
  if (action === 'access') {
    const modeKey = interaction.values[0];
    const mode = GUEST_ACCESS_MODES[modeKey];
    if (!mode) throw new Error('Opção de acesso inválida.');
    await channel.permissionOverwrites.edit(
      interaction.guild.roles.everyone.id,
      guestAccessPermissions(modeKey),
      { reason: `Acesso sem tag alterado pelo criador ${interaction.user.tag}` }
    );
    const privilegedPermissions = { ViewChannel: true, Connect: true, Speak: true, Stream: true };
    await Promise.all(memberRoleIds().map((roleId) => channel.permissionOverwrites.edit(
      roleId,
      privilegedPermissions,
      { reason: 'Mantendo acesso de membros e equipe na sala temporária' }
    )));
    return interaction.update({
      content: `Acesso sem tag atualizado para **${mode.label}**.`,
      components: []
    });
  }
  return null;
}

function isTriggerName(name) {
  const normalized = String(name || '')
    .normalize('NFKD')
    .replace(/[\p{M}\uFE0F]/gu, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  return /^[+✚➕]criarsala$/u.test(normalized);
}

function memberRoomName(member) {
  const rawName = member?.displayName || member?.user?.globalName || member?.user?.username || 'Membro';
  const cleanName = String(rawName).replace(/[\r\n]/g, ' ').trim().slice(0, 80) || 'Membro';
  return `🔊・${cleanName}`;
}

async function fetchChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache?.get?.(channelId)
    || guild.channels.fetch(channelId).catch(() => null);
}

async function resolveParentId(guild) {
  if (env.tempVoiceCategoryId) {
    const category = await fetchChannel(guild, env.tempVoiceCategoryId);
    if (category?.type === ChannelType.GuildCategory) return category.id;
  }
  const waiting = await fetchChannel(guild, ids.channels.waitingVoice);
  return waiting?.parentId || null;
}

function sortedTriggerCandidates(guild, parentId) {
  return [...(guild.channels.cache?.values?.() || [])]
    .filter((channel) => (
      channel.type === ChannelType.GuildVoice
        && isTriggerName(channel.name)
        && (!parentId || channel.parentId === parentId)
    ))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

async function reconcileTriggerChannels(guild, parentId) {
  if (env.tempVoiceTriggerChannelId) {
    const configured = await fetchChannel(guild, env.tempVoiceTriggerChannelId);
    if (configured?.type === ChannelType.GuildVoice) {
      if (configured.name !== TRIGGER_NAME) {
        await configured.setName?.(TRIGGER_NAME, 'Padronizando o gatilho de salas temporarias').catch(() => {});
      }
      await removeDuplicateTriggers(sortedTriggerCandidates(guild, parentId), configured);
      return configured;
    }
  }
  await guild.channels.fetch().catch(() => null);
  const candidates = sortedTriggerCandidates(guild, parentId);
  const canonical = candidates[0] || null;
  if (!canonical) return null;
  if (canonical.name !== TRIGGER_NAME) {
    await canonical.setName?.(TRIGGER_NAME, 'Padronizando o gatilho de salas temporarias').catch(() => {});
  }
  await removeDuplicateTriggers(candidates, canonical);
  return canonical;
}

async function removeDuplicateTriggers(candidates, canonical) {
  for (const duplicate of candidates) {
    if (duplicate.id === canonical.id || duplicate.members?.size > 0) continue;
    await duplicate.delete('Removendo gatilho duplicado de salas temporarias').catch(() => {});
  }
}

async function ensureTriggerChannel(guild) {
  const current = ensuringForGuild.get(guild.id);
  if (current) return current;
  const task = (async () => {
    const parentId = await resolveParentId(guild);
    const existing = await reconcileTriggerChannels(guild, parentId);
    if (existing) return existing;
    await guild.channels.create({
      name: TRIGGER_NAME,
      type: ChannelType.GuildVoice,
      parent: parentId || undefined,
      reason: 'Canal para criacao automatica de salas temporarias'
    });
    await guild.channels.fetch().catch(() => null);
    return reconcileTriggerChannels(guild, parentId);
  })().finally(() => ensuringForGuild.delete(guild.id));
  ensuringForGuild.set(guild.id, task);
  return task;
}

async function deleteIfEmpty(guild, channelId) {
  const record = repo.getByChannel(channelId);
  if (!record) return { deleted: false, reason: 'not_temporary' };
  const channel = await fetchChannel(guild, channelId);
  if (!channel) {
    repo.remove(channelId);
    return { deleted: false, reason: 'missing' };
  }
  if (channel.members?.size > 0) return { deleted: false, reason: 'occupied' };
  await channel.delete('Sala temporaria ficou vazia');
  repo.remove(channelId);
  return { deleted: true };
}

async function createOrReuseRoom(newState, trigger) {
  const member = newState.member;
  const guild = newState.guild;
  const key = `${guild.id}:${member.id}`;
  const pending = creatingForMember.get(key);
  if (pending) return pending;
  const task = (async () => {
    const saved = repo.getByOwner(guild.id, member.id);
    if (saved) {
      const existing = await fetchChannel(guild, saved.channel_id);
      if (existing?.type === ChannelType.GuildVoice) {
        await member.voice.setChannel(existing, 'Retorno para a propria sala temporaria');
        return { channel: existing, created: false };
      }
      repo.remove(saved.channel_id);
    }
    const channel = await guild.channels.create({
      name: memberRoomName(member),
      type: ChannelType.GuildVoice,
      parent: trigger.parentId || undefined,
      permissionOverwrites: roomPermissionOverwrites(guild, member),
      reason: `Sala temporaria criada por ${member.user?.tag || member.id}`
    });
    repo.save({ channelId: channel.id, guildId: guild.id, ownerId: member.id, triggerChannelId: trigger.id });
    try {
      await member.voice.setChannel(channel, 'Sala temporaria criada');
    } catch (error) {
      repo.remove(channel.id);
      await channel.delete('Falha ao mover o criador para a sala temporaria').catch(() => {});
      throw error;
    }
    await channel.send(controlPanelPayload(channel.id, member.id)).catch((error) => {
      console.error(`[VOZ TEMPORARIA] Falha ao publicar controles na sala ${channel.id}:`, error);
    });
    return { channel, created: true };
  })().finally(() => creatingForMember.delete(key));
  creatingForMember.set(key, task);
  return task;
}

async function handleVoiceStateUpdate(oldState, newState) {
  if (oldState.channelId === newState.channelId) return null;
  const member = newState.member || oldState.member;
  if (!member || member.user?.bot) return null;
  let result = null;
  if (newState.channelId) {
    const trigger = await ensureTriggerChannel(newState.guild);
    if (newState.channelId === trigger.id) result = await createOrReuseRoom(newState, trigger);
  }
  if (oldState.channelId && oldState.channelId !== result?.channel?.id) {
    await deleteIfEmpty(oldState.guild, oldState.channelId);
  }
  return result;
}

async function initializeGuild(guild) {
  const trigger = await ensureTriggerChannel(guild);
  let deleted = 0;
  for (const record of repo.listByGuild(guild.id)) {
    const result = await deleteIfEmpty(guild, record.channel_id).catch(() => ({ deleted: false }));
    if (result.deleted) deleted += 1;
  }
  return { trigger, deleted };
}

function handleChannelDelete(channel) {
  if (channel?.id) repo.remove(channel.id);
}

module.exports = {
  TRIGGER_NAME,
  deleteIfEmpty,
  ensureTriggerChannel,
  handleChannelDelete,
  handleButton,
  handleSelect,
  handleVoiceStateUpdate,
  initializeGuild,
  isTriggerName,
  memberRoomName,
  guestAccessPermissions,
  roomPermissionOverwrites
};
