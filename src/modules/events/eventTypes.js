const eventTypes = [
  {
    key: 'roaming',
    label: 'Roaming T6',
    emoji: '🌪️',
    creationKind: 'common',
    visualComposition: true,
    buildForum: 'build-roaming-t6',
    description: 'Conteúdo em mapa aberto e busca por lutas.'
  },
  {
    key: 'group_dungeon',
    label: 'DG de Grupo',
    emoji: '🌀',
    creationKind: 'common',
    visualComposition: true,
    buildForum: 'build-dg-grupo',
    description: 'Dungeon em grupo, fama e PvE.'
  },
  {
    key: 'outposts',
    label: 'Outposts',
    emoji: '🏰',
    creationKind: 'common',
    visualComposition: true,
    buildForum: 'build-outposts',
    description: 'Composição organizada para postos avançados.'
  },
  {
    key: 'static',
    label: 'Static',
    emoji: '🗿',
    creationKind: 'common',
    visualComposition: true,
    buildForum: 'build-fixa-static',
    description: 'Grupo organizado para dungeon estática.'
  },
  {
    key: 'gank',
    label: 'Gank T8',
    emoji: '🗡️',
    creationKind: 'common',
    visualComposition: true,
    buildForum: 'build-gank-t8',
    description: 'Grupo de gank com composição definida.'
  },
  {
    key: 'raid_avalon',
    label: 'Raid Avalon',
    emoji: '⚔️',
    creationKind: 'raid',
    description: 'Raid Avalon Full com composição própria.'
  },
  {
    key: 'dragons',
    label: 'Dragões',
    emoji: '🐉',
    creationKind: 'common',
    visualComposition: true,
    description: 'Conteúdo organizado de dragões.'
  },
  {
    key: 'raid_dragon',
    label: 'Raid Dragão',
    emoji: '🐲',
    creationKind: 'raid',
    buildForum: 'build-raid-dragon',
    description: 'Raid de 20 jogadores no Santuário do Dragão.'
  },
  {
    key: 'avalon_roads',
    label: 'Estradas Avalon',
    emoji: '🛣️',
    creationKind: 'common',
    visualComposition: true,
    description: 'Conteúdo nas Estradas de Avalon.'
  },
  {
    key: 'cta',
    label: 'CTA',
    emoji: '📣',
    creationKind: 'custom',
    description: 'Composição visual e cardápio dinâmico de DPS.'
  },
  {
    key: 'for_fun',
    label: 'For Fun',
    emoji: '🎉',
    creationKind: 'common',
    visualComposition: true,
    description: 'Atividade casual, treino ou conteúdo livre.'
  },
  {
    key: 'faction_red_zone',
    label: 'Facção Red Zone',
    emoji: '🚩',
    creationKind: 'common',
    visualComposition: true,
    description: 'Facção em zona vermelha.'
  },
  {
    key: 'transport',
    label: 'Transporte',
    emoji: '🐂',
    creationKind: 'common',
    visualComposition: true,
    description: 'Transporte organizado da guilda.'
  },
  {
    key: 'world_boss',
    label: 'World Boss',
    emoji: '👑',
    creationKind: 'world',
    buildForum: 'build-world-boss',
    description: 'Farm de World Boss com composição própria.'
  }
];

const legacyType = {
  key: 'other',
  label: 'Outro',
  emoji: '📅',
  creationKind: 'common',
  description: 'Evento antigo ainda não classificado.'
};

const byKey = new Map([...eventTypes, legacyType].map((type) => [type.key, type]));

function findEventType(value) {
  return byKey.get(String(value || '').trim()) || null;
}

function normalizeEventType(value, { allowLegacy = false } = {}) {
  const type = findEventType(value);
  if (!type || (!allowLegacy && type.key === legacyType.key)) {
    throw new Error('Escolha um tipo de evento válido.');
  }
  return type.key;
}

function eventTypeLabel(value) {
  return findEventType(value)?.label || legacyType.label;
}

function eventTypeEmoji(value) {
  return findEventType(value)?.emoji || legacyType.emoji;
}

function creationKindFor(value) {
  return findEventType(value)?.creationKind || legacyType.creationKind;
}

function usesVisualComposition(value) {
  return Boolean(findEventType(value)?.visualComposition);
}

function visualBuildForumFor(value) {
  return findEventType(value)?.buildForum || null;
}

function discordOptions() {
  return eventTypes.map((type) => ({
    label: type.label,
    value: type.key,
    emoji: type.emoji,
    description: type.description
  }));
}

module.exports = {
  creationKindFor,
  discordOptions,
  eventTypeEmoji,
  eventTypeLabel,
  eventTypes,
  findEventType,
  normalizeEventType,
  usesVisualComposition,
  visualBuildForumFor
};
