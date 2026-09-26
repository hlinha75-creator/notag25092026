const ids = require('../../config/ids');
const { itemImage } = require('./weaponCatalog');
const customEventWeaponCatalog = require('./customEventWeaponCatalog.service');

const tagRoles = new Map([
  ['TANK', 'tank'],
  ['HEALER', 'healer'],
  ['SUPORTE', 'support'],
  ['DPS MELEE', 'dps'],
  ['DPS RANGED', 'dps']
]);

const roleLabels = {
  tank: 'Tank',
  healer: 'Healer',
  support: 'Suporte',
  dps: 'DPS'
};

const fallbackBuilds = [
  ['caca_espiritos', 'Caça-espíritos', 'dps', 'DPS MELEE'],
  ['cajado_pustulento', 'Cajado Pustulento', 'healer', 'HEALER'],
  ['queda_santa', 'Queda Santa', 'healer', 'HEALER'],
  ['cajado_exaltado', 'Cajado Exaltado', 'healer', 'HEALER'],
  ['cancao_da_alvorada', 'Canção da Alvorada', 'dps', 'DPS RANGED'],
  ['arco_longo', 'Arco Longo', 'dps', 'DPS RANGED'],
  ['arco_plangente', 'Arco Plangente', 'dps', 'DPS RANGED'],
  ['quebra_reino', 'Quebra-reino', 'dps', 'DPS MELEE'],
  ['cajado_putrido', 'Cajado Pútrido', 'dps', 'DPS RANGED'],
  ['manoplas_cravadas', 'Manoplas Cravadas', 'dps', 'DPS MELEE'],
  ['prisma', 'Prisma', 'dps', 'DPS RANGED'],
  ['cajado_de_feiticeiro', 'Cajado de Feiticeiro', 'dps', 'DPS RANGED'],
  ['cajado_oculto', 'Cajado Oculto', 'support', 'SUPORTE'],
  ['cajado_arcano_elevado', 'Cajado Arcano Elevado', 'support', 'SUPORTE'],
  ['cajado_enraizado', 'Cajado Enraizado', 'support', 'SUPORTE'],
  ['maca_pesada', 'Maça Pesada', 'tank', 'TANK'],
  ['martelo_de_batalha', 'Martelo de Batalha', 'tank', 'TANK'],
  ['jurador', 'Jurador', 'tank', 'TANK'],
  ['maca_petrea', 'Maça Pétrea', 'tank', 'TANK'],
  ['mao_da_justica', 'Mão da Justiça', 'tank', 'TANK']
].map(([key, name, role, sourceTag]) => ({ key, name, role, sourceTag }));

async function loadCatalog(client, guild) {
  await fetchAvailableEmojis(client, guild);
  const channel = await client.channels.fetch(ids.channels.outpostBuilds).catch(() => null);
  if (!channel?.threads || !Array.isArray(channel.availableTags)) {
    return attachAvailableEmojis(fallbackBuilds, client, guild);
  }

  const tagsById = new Map(channel.availableTags.map((tag) => [tag.id, String(tag.name || '').toUpperCase()]));
  const threads = await fetchForumThreads(channel);
  const builds = [];
  for (const thread of threads) {
    const sourceTags = [...(thread.appliedTags || [])].map((tagId) => tagsById.get(tagId)).filter(Boolean);
    const sourceTag = sourceTags.find((tag) => tagRoles.has(tag));
    if (!sourceTag) continue;
    const starter = await thread.fetchStarterMessage().catch(() => null);
    const attachment = starter?.attachments?.first?.() || [...(starter?.attachments?.values?.() || [])][0];
    builds.push({
      key: normalizeKey(thread.name),
      name: cleanName(thread.name),
      role: tagRoles.get(sourceTag),
      sourceTag,
      threadId: thread.id,
      buildUrl: `https://discord.com/channels/${guild.id}/${thread.id}`,
      iconUrl: attachment?.url || null
    });
  }

  const catalog = builds.length ? builds : fallbackBuilds;
  return attachAvailableEmojis(dedupeBuilds(catalog), client, guild);
}

async function fetchForumThreads(channel) {
  const result = new Map();
  const active = await channel.threads.fetchActive().catch(() => null);
  for (const thread of active?.threads?.values?.() || []) result.set(thread.id, thread);

  let before;
  for (let page = 0; page < 10; page += 1) {
    const archived = await channel.threads.fetchArchived({ limit: 100, before }).catch(() => null);
    if (!archived) break;
    const rows = [...archived.threads.values()];
    for (const thread of rows) result.set(thread.id, thread);
    if (!archived.hasMore || rows.length === 0) break;
    const archiveTimestamp = rows.at(-1).archiveTimestamp;
    if (!archiveTimestamp) break;
    before = new Date(archiveTimestamp);
  }
  return [...result.values()];
}

async function syncEmojis(client, guild, { refreshExisting = false } = {}) {
  const { cloneDefaultDpsWeaponPool } = require('./dpsWeaponPool');
  const dpsBuilds = cloneDefaultDpsWeaponPool().map((weapon) => ({
    key: weapon.weaponKey,
    name: weapon.label,
    role: 'dps',
    sourceTag: 'CARDAPIO DPS',
    iconUrl: itemImage(weapon.weaponKey)
  }));
  const forumBuilds = await loadCatalog(client, guild);
  const visualBuilds = customEventWeaponCatalog.mergeCatalog([]);
  const builds = dedupeBuilds([...visualBuilds, ...forumBuilds, ...dpsBuilds]);
  const manager = client.application?.emojis || guild?.emojis;
  if (!manager) throw new Error('O gerenciador de emojis do bot nao esta disponivel.');
  await manager.fetch();
  const created = [];
  const existing = [];
  const refreshed = [];
  const replacements = [];
  const skipped = [];
  const failed = [];

  for (const build of builds) {
    const name = emojiName(build);
    const current = manager.cache.find((emoji) => emoji.name === name);
    if (current) {
      if (!refreshExisting || !build.iconUrl) {
        existing.push(build.name);
        continue;
      }
      try {
        const replacement = await recreateEmoji(manager, current, { attachment: build.iconUrl, name });
        refreshed.push(build.name);
        replacements.push({ name, oldId: current.id, newId: replacement.id });
      } catch (error) {
        failed.push(`${build.name}: ${String(error.message || error).slice(0, 100)}`);
      }
      continue;
    }
    if (!build.iconUrl) {
      skipped.push(build.name);
      continue;
    }
    try {
      await manager.create({ attachment: build.iconUrl, name });
      created.push(build.name);
    } catch (error) {
      failed.push(`${build.name}: ${String(error.message || error).slice(0, 100)}`);
    }
  }

  return { created, existing, refreshed, replacements, skipped, failed, total: builds.length };
}

async function recreateEmoji(manager, current, { attachment, name }) {
  const suffix = Date.now().toString(36).slice(-6);
  const temporaryName = `${name.slice(0, Math.max(1, 25 - suffix.length))}_new_${suffix}`.slice(0, 32);
  const replacement = await manager.create({ attachment, name: temporaryName });
  let oldDeleted = false;
  try {
    await manager.delete(current);
    oldDeleted = true;
    manager.cache?.delete?.(current.id);
    const renamed = typeof manager.edit === 'function'
      ? await manager.edit(replacement, { name })
      : typeof replacement.edit === 'function'
        ? await replacement.edit({ name })
        : Object.assign(replacement, { name });
    return renamed || replacement;
  } catch (error) {
    if (!oldDeleted) {
      await manager.delete(replacement).catch(() => null);
      manager.cache?.delete?.(replacement.id);
    }
    throw error;
  }
}

async function fetchAvailableEmojis(client, guild) {
  await Promise.all([
    client?.application?.emojis?.fetch?.().catch(() => null),
    guild?.emojis?.fetch?.().catch(() => null)
  ]);
}

async function ensureAvailableEmojis(builds, client, guild) {
  const catalog = dedupeBuilds(Array.isArray(builds) ? builds : []);
  await fetchAvailableEmojis(client, guild);
  const manager = client?.application?.emojis || guild?.emojis;
  if (typeof manager?.create !== 'function') {
    return attachAvailableEmojis(catalog, client, guild);
  }

  for (const build of catalog) {
    if (!build.iconUrl) continue;
    const name = emojiName(build);
    const current = manager.cache?.find?.((emoji) => emoji.name === name);
    if (current) continue;
    try {
      const created = await manager.create({ attachment: build.iconUrl, name });
      manager.cache?.set?.(created.id, created);
    } catch {
      // A selecao de arma deve continuar mesmo se o Discord recusar um emoji.
    }
  }

  return attachAvailableEmojis(catalog, client, guild);
}

function attachAvailableEmojis(builds, client, guild) {
  return builds.map((build) => {
    const name = emojiName(build);
    const emoji = client?.application?.emojis?.cache?.find((candidate) => candidate.name === name)
      || guild?.emojis?.cache?.find((candidate) => candidate.name === name);
    return {
      ...build,
      emojiName: emoji?.name || name,
      emojiId: emoji?.id || null
    };
  });
}

function attachGuildEmojis(builds, guild) {
  return attachAvailableEmojis(builds, null, guild);
}

function selectOptions(builds, role) {
  return builds
    .filter((build) => build.role === role)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, 25)
    .map((build) => ({
      label: build.name.slice(0, 100),
      value: build.key.slice(0, 100),
      description: `${build.sourceTag || roleLabels[build.role]}${build.threadId ? ' • build no fórum' : ''}`.slice(0, 100),
      ...(build.emojiId ? { emoji: { id: build.emojiId, name: build.emojiName } } : {})
    }));
}

function emojiName(build) {
  return `cta_${normalizeKey(build.key || build.name)}`.slice(0, 32);
}

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function dedupeBuilds(builds) {
  return [...new Map(builds.map((build) => [build.key, build])).values()];
}

module.exports = {
  attachAvailableEmojis,
  attachGuildEmojis,
  emojiName,
  ensureAvailableEmojis,
  fallbackBuilds,
  fetchForumThreads,
  loadCatalog,
  normalizeKey,
  selectOptions,
  syncEmojis,
  tagRoles
};
