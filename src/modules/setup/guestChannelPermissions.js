const { ChannelType, PermissionFlagsBits } = require('discord.js');
const ids = require('../../config/ids');

const ACCESS_PERMISSIONS = Object.freeze({
  hidden: Object.freeze({
    ViewChannel: false
  }),
  readOnly: Object.freeze({
    ViewChannel: true,
    SendMessages: false,
    SendMessagesInThreads: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    AddReactions: false,
    Connect: false,
    Speak: false,
    Stream: false
  }),
  writable: Object.freeze({
    ViewChannel: true,
    SendMessages: true,
    SendMessagesInThreads: true,
    CreatePublicThreads: true,
    CreatePrivateThreads: false,
    AddReactions: true
  }),
  voice: Object.freeze({
    ViewChannel: true,
    Connect: true,
    Speak: true,
    Stream: false,
    SendMessages: false,
    SendMessagesInThreads: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false
  })
});

function accessModeForChannel(channelId, access = ids.guestChannelAccess) {
  if (access.readOnly.includes(channelId)) return 'readOnly';
  if (access.writable.includes(channelId)) return 'writable';
  if (access.voice.includes(channelId)) return 'voice';
  return 'hidden';
}

function permissionsForChannel(channelId, access = ids.guestChannelAccess) {
  return { ...ACCESS_PERMISSIONS[accessModeForChannel(channelId, access)] };
}

function editableGuildChannels(guild) {
  return [...guild.channels.cache.values()]
    .filter((channel) => !channel.isThread?.() && channel.permissionOverwrites?.edit)
    .sort((left, right) => {
      const leftCategory = left.type === ChannelType.GuildCategory ? 0 : 1;
      const rightCategory = right.type === ChannelType.GuildCategory ? 0 : 1;
      return leftCategory - rightCategory || (left.rawPosition ?? 0) - (right.rawPosition ?? 0);
    });
}

function overwriteMatches(overwrite, permissions) {
  if (!overwrite) return false;
  return Object.entries(permissions).every(([permission, allowed]) => {
    const flag = PermissionFlagsBits[permission];
    const hasAllow = (overwrite.allow.bitfield & flag) === flag;
    const hasDeny = (overwrite.deny.bitfield & flag) === flag;
    return allowed ? hasAllow && !hasDeny : hasDeny && !hasAllow;
  });
}

function validateAccessChannels(channels, access = ids.guestChannelAccess) {
  const configuredIds = [...access.readOnly, ...access.writable, ...access.voice];
  const duplicated = configuredIds.filter((id, index) => configuredIds.indexOf(id) !== index);
  if (duplicated.length > 0) {
    throw new Error(`Canais repetidos na politica de Convidado: ${[...new Set(duplicated)].join(', ')}`);
  }

  const availableIds = new Set(channels.map((channel) => channel.id));
  const missing = configuredIds.filter((id) => !availableIds.has(id));
  if (missing.length > 0) {
    throw new Error(`Canais da politica de Convidado nao encontrados: ${missing.join(', ')}`);
  }
}

async function syncGuestChannelPermissions(guild, options = {}) {
  const apply = options.apply === true;
  const access = options.access || ids.guestChannelAccess;
  const guestRole = guild.roles.cache.get(ids.roles.guest) || await guild.roles.fetch(ids.roles.guest);
  if (!guestRole) throw new Error(`Cargo Convidado nao encontrado: ${ids.roles.guest}`);

  await guild.channels.fetch();
  const channels = editableGuildChannels(guild);
  validateAccessChannels(channels, access);

  const results = [];
  for (const channel of channels) {
    const mode = accessModeForChannel(channel.id, access);
    const permissions = permissionsForChannel(channel.id, access);
    const current = channel.permissionOverwrites.cache.get(guestRole.id);
    const changed = !overwriteMatches(current, permissions);

    if (apply && changed) {
      await channel.permissionOverwrites.edit(
        guestRole,
        permissions,
        { reason: 'Politica de acesso do cargo Convidado' }
      );
    }

    results.push({
      id: channel.id,
      name: channel.name,
      mode,
      changed
    });
  }

  return results;
}

module.exports = {
  ACCESS_PERMISSIONS,
  accessModeForChannel,
  permissionsForChannel,
  overwriteMatches,
  validateAccessChannels,
  syncGuestChannelPermissions
};
