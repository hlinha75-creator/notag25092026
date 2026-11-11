const { ChannelType, PermissionFlagsBits } = require('discord.js');
const env = require('../../config/env');
const ids = require('../../config/ids');
const repo = require('./temporaryVoice.repository');

const TRIGGER_NAME = '+Criar Sala';
const creatingForMember = new Map();
const ensuringForGuild = new Map();

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

async function findTriggerChannel(guild, parentId) {
  if (env.tempVoiceTriggerChannelId) {
    const configured = await fetchChannel(guild, env.tempVoiceTriggerChannelId);
    if (configured?.type === ChannelType.GuildVoice) return configured;
  }
  await guild.channels.fetch().catch(() => null);
  const channels = [...(guild.channels.cache?.values?.() || [])];
  return channels.find((channel) => (
    channel.type === ChannelType.GuildVoice
      && channel.name === TRIGGER_NAME
      && (!parentId || channel.parentId === parentId)
  )) || null;
}

async function ensureTriggerChannel(guild) {
  const current = ensuringForGuild.get(guild.id);
  if (current) return current;
  const task = (async () => {
    const parentId = await resolveParentId(guild);
    const existing = await findTriggerChannel(guild, parentId);
    if (existing) return existing;
    return guild.channels.create({
      name: TRIGGER_NAME,
      type: ChannelType.GuildVoice,
      parent: parentId || undefined,
      reason: 'Canal para criacao automatica de salas temporarias'
    });
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
      permissionOverwrites: [{
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
      }],
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
  handleVoiceStateUpdate,
  initializeGuild,
  memberRoomName
};
