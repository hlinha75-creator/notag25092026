const {
  families,
  familyRuleForRole,
  itemImage
} = require('./weaponCatalog');

const familySymbols = {
  sword: '⚔️',
  axe: '🪓',
  mace: '🔨',
  hammer: '⚒️',
  war_gloves: '🥊',
  crossbow: '🏹',
  bow: '🏹',
  dagger: '🗡️',
  spear: '🔱',
  quarterstaff: '🦯',
  shapeshifter: '🐾',
  nature: '🌿',
  fire: '🔥',
  holy: '✨',
  arcane: '🔮',
  frost: '❄️',
  cursed: '🩸',
  forum: '📚'
};

function mergeCatalog(forumBuilds = []) {
  const visual = families.flatMap((family) => family.weapons.map((weapon) => ({
    key: weapon.itemId,
    itemId: weapon.itemId,
    name: weapon.name,
    familyKey: family.key,
    familyLabel: family.label,
    familyLabelEn: family.labelEn,
    familySymbol: familySymbols[family.key] || '⚔️',
    iconUrl: itemImage(weapon.itemId),
    buildUrl: null,
    emojiName: familySymbols[family.key] || '⚔️',
    emojiId: null,
    source: 'albion'
  })));
  const forum = forumBuilds.map((build) => ({
    ...build,
    familyKey: 'forum',
    familyLabel: 'Builds do fórum',
    familyLabelEn: 'Builds oficiais da guilda',
    familySymbol: familySymbols.forum,
    source: 'forum'
  }));
  return [...visual, ...forum];
}

function allowedForRole(build, role) {
  if (!build) return false;
  if (build.familyKey === 'forum' || !build.familyKey) return build.role === role;
  return familyRuleForRole(role, build.familyKey).allowed;
}

function familiesForRole(catalog, role) {
  const choices = new Map();
  for (const build of catalog.filter((candidate) => allowedForRole(candidate, role))) {
    const key = build.familyKey || 'forum';
    if (!choices.has(key)) {
      choices.set(key, {
        key,
        label: build.familyLabel || 'Builds do fórum',
        labelEn: build.familyLabelEn || 'Builds oficiais da guilda',
        symbol: build.familySymbol || familySymbols[key] || familySymbols.forum,
        iconUrl: build.iconUrl || null,
        recommended: key !== 'forum' && familyRuleForRole(role, key).recommended,
        count: 0
      });
    }
    choices.get(key).count += 1;
  }
  return [...choices.values()].sort((left, right) => {
    if (left.recommended !== right.recommended) return Number(right.recommended) - Number(left.recommended);
    if (left.key === 'forum') return 1;
    if (right.key === 'forum') return -1;
    return left.label.localeCompare(right.label, 'pt-BR');
  });
}

function weaponsForFamily(catalog, role, familyKey) {
  return catalog
    .filter((build) => (build.familyKey || 'forum') === familyKey && allowedForRole(build, role))
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
    .slice(0, 25);
}

function familyOptions(catalog, role) {
  return familiesForRole(catalog, role).map((family) => ({
    label: family.label.slice(0, 100),
    value: family.key.slice(0, 100),
    description: `${family.recommended ? 'Recomendado • ' : ''}${family.count} opções`.slice(0, 100),
    emoji: { name: family.symbol }
  }));
}

function weaponOptions(catalog, role, familyKey) {
  return weaponsForFamily(catalog, role, familyKey).map((build) => ({
    label: build.name.slice(0, 100),
    value: build.key.slice(0, 100),
    description: `${build.familyLabel || 'Build do fórum'}${build.sourceTag ? ` • ${build.sourceTag}` : ''}`.slice(0, 100),
    emoji: build.emojiId
      ? { id: build.emojiId, name: build.emojiName }
      : { name: build.familySymbol || familySymbols[familyKey] || '⚔️' }
  }));
}

function familyByKey(catalog, role, familyKey) {
  return familiesForRole(catalog, role).find((family) => family.key === familyKey) || null;
}

module.exports = {
  allowedForRole,
  familiesForRole,
  familyByKey,
  familyOptions,
  familySymbols,
  mergeCatalog,
  weaponOptions,
  weaponsForFamily
};
