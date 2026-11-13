const families = [
  family('sword', 'Espadas', 'Swords', '#4da6ff', [
    ['T4_MAIN_SWORD', 'Broadsword'], ['T4_2H_CLAYMORE', 'Claymore'], ['T4_2H_DUALSWORD', 'Dual Swords'],
    ['T4_MAIN_SCIMITAR_MORGANA', 'Clarent Blade'], ['T4_2H_CLEAVER_HELL', 'Carving Sword'],
    ['T4_2H_DUALSCIMITAR_UNDEAD', 'Galatine Pair'], ['T4_2H_CLAYMORE_AVALON', 'Kingmaker'],
    ['T4_MAIN_SWORD_CRYSTAL', 'Infinity Blade']
  ]),
  family('axe', 'Machados', 'Axes', '#ef665b', [
    ['T4_MAIN_AXE', 'Battleaxe'], ['T4_2H_AXE', 'Greataxe'], ['T4_2H_HALBERD', 'Halberd'],
    ['T4_2H_HALBERD_MORGANA', 'Carrioncaller'], ['T4_2H_SCYTHE_HELL', 'Infernal Scythe'],
    ['T4_2H_DUALAXE_KEEPER', 'Bear Paws'], ['T4_2H_AXE_AVALON', 'Realmbreaker'],
    ['T4_2H_SCYTHE_CRYSTAL', 'Crystal Reaper']
  ]),
  family('mace', 'Maças', 'Maces', '#efb34b', [
    ['T4_MAIN_MACE', 'Mace'], ['T4_2H_MACE', 'Heavy Mace'], ['T4_2H_FLAIL', 'Morning Star'],
    ['T4_MAIN_ROCKMACE_KEEPER', 'Bedrock Mace'], ['T4_MAIN_MACE_HELL', 'Incubus Mace'],
    ['T4_2H_MACE_MORGANA', 'Camlann Mace'], ['T4_2H_DUALMACE_AVALON', 'Oathkeepers'],
    ['T4_MAIN_MACE_CRYSTAL', 'Dreadstorm Monarch']
  ]),
  family('hammer', 'Martelos', 'Hammers', '#83b7d9', [
    ['T4_MAIN_HAMMER', 'Hammer'], ['T4_2H_HAMMER', 'Great Hammer'], ['T4_2H_POLEHAMMER', 'Polehammer'],
    ['T4_2H_HAMMER_UNDEAD', 'Tombhammer'], ['T4_2H_DUALHAMMER_HELL', 'Forge Hammers'],
    ['T4_2H_RAM_KEEPER', 'Grovekeeper'], ['T4_2H_HAMMER_AVALON', 'Hand of Justice'],
    ['T4_2H_HAMMER_CRYSTAL', 'Truebolt Hammer']
  ]),
  family('war_gloves', 'Luvas de Guerra', 'War Gloves', '#e89567', [
    ['T4_2H_KNUCKLES_SET1', 'Brawler Gloves'], ['T4_2H_KNUCKLES_SET2', 'Battle Bracers'],
    ['T4_2H_KNUCKLES_SET3', 'Spiked Gauntlets'], ['T4_2H_KNUCKLES_KEEPER', 'Ursine Maulers'],
    ['T4_2H_KNUCKLES_HELL', 'Hellfire Hands'], ['T4_2H_KNUCKLES_MORGANA', 'Ravenstrike Cestus'],
    ['T4_2H_KNUCKLES_AVALON', 'Fists of Avalon'], ['T4_2H_KNUCKLES_CRYSTAL', 'Forcepulse Bracers']
  ]),
  family('crossbow', 'Bestas', 'Crossbows', '#d78357', [
    ['T4_2H_CROSSBOW', 'Crossbow'], ['T4_2H_CROSSBOWLARGE', 'Heavy Crossbow'],
    ['T4_MAIN_1HCROSSBOW', 'Light Crossbow'], ['T4_2H_REPEATINGCROSSBOW_UNDEAD', 'Weeping Repeater'],
    ['T4_2H_DUALCROSSBOW_HELL', 'Boltcasters'], ['T4_2H_CROSSBOWLARGE_MORGANA', 'Siegebow'],
    ['T4_2H_CROSSBOW_CANNON_AVALON', 'Energy Shaper'], ['T4_2H_DUALCROSSBOW_CRYSTAL', 'Arclight Blasters']
  ]),
  family('bow', 'Arcos', 'Bows', '#63b789', [
    ['T4_2H_BOW', 'Bow'], ['T4_2H_LONGBOW', 'Longbow'], ['T4_2H_WARBOW', 'Warbow'],
    ['T4_2H_LONGBOW_UNDEAD', 'Whispering Bow'], ['T4_2H_BOW_HELL', 'Wailing Bow'],
    ['T4_2H_BOW_KEEPER', 'Bow of Badon'], ['T4_2H_BOW_AVALON', 'Mistpiercer'],
    ['T4_2H_BOW_CRYSTAL', 'Skystrider Bow']
  ]),
  family('dagger', 'Adagas', 'Daggers', '#d95e8d', [
    ['T4_MAIN_DAGGER', 'Dagger'], ['T4_2H_DAGGERPAIR', 'Dagger Pair'], ['T4_2H_CLAWPAIR', 'Claws'],
    ['T4_MAIN_RAPIER_MORGANA', 'Bloodletter'], ['T4_MAIN_DAGGER_HELL', 'Demonfang'],
    ['T4_2H_DUALSICKLE_UNDEAD', 'Deathgivers'], ['T4_2H_DAGGER_KATAR_AVALON', 'Bridled Fury'],
    ['T4_2H_DAGGERPAIR_CRYSTAL', 'Twin Slayers']
  ]),
  family('spear', 'Lanças', 'Spears', '#e88f42', [
    ['T4_MAIN_SPEAR', 'Spear'], ['T4_2H_SPEAR', 'Pike'], ['T4_2H_GLAIVE', 'Glaive'],
    ['T4_MAIN_SPEAR_KEEPER', 'Heron Spear'], ['T4_2H_HARPOON_HELL', 'Spirithunter'],
    ['T4_2H_TRIDENT_UNDEAD', 'Trinity Spear'], ['T4_MAIN_SPEAR_LANCE_AVALON', 'Daybreaker'],
    ['T4_2H_GLAIVE_CRYSTAL', 'Rift Glaive']
  ]),
  family('quarterstaff', 'Bordões', 'Quarterstaffs', '#d7b14b', [
    ['T4_2H_QUARTERSTAFF', 'Quarterstaff'], ['T4_2H_IRONCLADEDSTAFF', 'Iron-clad Staff'],
    ['T4_2H_DOUBLEBLADEDSTAFF', 'Double Bladed Staff'], ['T4_2H_COMBATSTAFF_MORGANA', 'Black Monk Stave'],
    ['T4_2H_TWINSCYTHE_HELL', 'Soulscythe'], ['T4_2H_ROCKSTAFF_KEEPER', 'Staff of Balance'],
    ['T4_2H_QUARTERSTAFF_AVALON', 'Grailseeker'], ['T4_2H_DOUBLEBLADEDSTAFF_CRYSTAL', 'Phantom Twinblade']
  ]),
  family('shapeshifter', 'Metamorfos', 'Shapeshifter Staffs', '#a879d8', [
    ['T4_2H_SHAPESHIFTER_SET1', 'Prowling Staff'], ['T4_2H_SHAPESHIFTER_SET2', 'Rootbound Staff'],
    ['T4_2H_SHAPESHIFTER_SET3', 'Primal Staff'], ['T4_2H_SHAPESHIFTER_MORGANA', 'Bloodmoon Staff'],
    ['T4_2H_SHAPESHIFTER_HELL', 'Hellspawn Staff'], ['T4_2H_SHAPESHIFTER_KEEPER', 'Earthrune Staff'],
    ['T4_2H_SHAPESHIFTER_AVALON', 'Lightcaller'], ['T4_2H_SHAPESHIFTER_CRYSTAL', 'Stillgaze Staff']
  ]),
  family('nature', 'Natureza', 'Nature Staffs', '#62bf59', [
    ['T4_MAIN_NATURESTAFF', 'Nature Staff'], ['T4_2H_NATURESTAFF', 'Great Nature Staff'],
    ['T4_2H_WILDSTAFF', 'Wild Staff'], ['T4_MAIN_NATURESTAFF_KEEPER', 'Druidic Staff'],
    ['T4_2H_NATURESTAFF_HELL', 'Blight Staff'], ['T4_2H_NATURESTAFF_KEEPER', 'Rampant Staff'],
    ['T4_MAIN_NATURESTAFF_AVALON', 'Ironroot Staff'], ['T4_MAIN_NATURESTAFF_CRYSTAL', 'Forgebark Staff']
  ]),
  family('fire', 'Fogo', 'Fire Staffs', '#ef5b3d', [
    ['T4_MAIN_FIRESTAFF', 'Fire Staff'], ['T4_2H_FIRESTAFF', 'Great Fire Staff'],
    ['T4_2H_INFERNOSTAFF', 'Infernal Staff'], ['T4_MAIN_FIRESTAFF_KEEPER', 'Wildfire Staff'],
    ['T4_2H_FIRESTAFF_HELL', 'Brimstone Staff'], ['T4_2H_INFERNOSTAFF_MORGANA', 'Blazing Staff'],
    ['T4_2H_FIRE_RINGPAIR_AVALON', 'Dawnsong'], ['T4_MAIN_FIRESTAFF_CRYSTAL', 'Flamewalker Staff']
  ]),
  family('holy', 'Sagrado', 'Holy Staffs', '#f1d369', [
    ['T4_MAIN_HOLYSTAFF', 'Holy Staff'], ['T4_2H_HOLYSTAFF', 'Great Holy Staff'],
    ['T4_2H_DIVINESTAFF', 'Divine Staff'], ['T4_MAIN_HOLYSTAFF_MORGANA', 'Lifetouch Staff'],
    ['T4_2H_HOLYSTAFF_HELL', 'Fallen Staff'], ['T4_2H_HOLYSTAFF_UNDEAD', 'Redemption Staff'],
    ['T4_MAIN_HOLYSTAFF_AVALON', 'Hallowfall'], ['T4_2H_HOLYSTAFF_CRYSTAL', 'Exalted Staff']
  ]),
  family('arcane', 'Arcano', 'Arcane Staffs', '#a96be2', [
    ['T4_MAIN_ARCANESTAFF', 'Arcane Staff'], ['T4_2H_ARCANESTAFF', 'Great Arcane Staff'],
    ['T4_2H_ENIGMATICSTAFF', 'Enigmatic Staff'], ['T4_MAIN_ARCANESTAFF_UNDEAD', 'Witchwork Staff'],
    ['T4_2H_ARCANESTAFF_HELL', 'Occult Staff'], ['T4_2H_ENIGMATICORB_MORGANA', 'Malevolent Locus'],
    ['T4_2H_ARCANE_RINGPAIR_AVALON', 'Evensong'], ['T4_2H_ARCANESTAFF_CRYSTAL', 'Astral Staff']
  ]),
  family('frost', 'Gelo', 'Frost Staffs', '#54bce8', [
    ['T4_MAIN_FROSTSTAFF', 'Frost Staff'], ['T4_2H_FROSTSTAFF', 'Great Frost Staff'],
    ['T4_2H_GLACIALSTAFF', 'Glacial Staff'], ['T4_MAIN_FROSTSTAFF_KEEPER', 'Hoarfrost Staff'],
    ['T4_2H_ICEGAUNTLETS_HELL', 'Icicle Staff'], ['T4_2H_ICECRYSTAL_UNDEAD', 'Permafrost Prism'],
    ['T4_MAIN_FROSTSTAFF_AVALON', 'Chillhowl'], ['T4_2H_FROSTSTAFF_CRYSTAL', 'Arctic Staff']
  ]),
  family('cursed', 'Amaldiçoado', 'Cursed Staffs', '#c94476', [
    ['T4_MAIN_CURSEDSTAFF', 'Cursed Staff'], ['T4_2H_CURSEDSTAFF', 'Great Cursed Staff'],
    ['T4_2H_DEMONICSTAFF', 'Demonic Staff'], ['T4_MAIN_CURSEDSTAFF_UNDEAD', 'Lifecurse Staff'],
    ['T4_2H_SKULLORB_HELL', 'Cursed Skull'], ['T4_2H_CURSEDSTAFF_MORGANA', 'Damnation Staff'],
    ['T4_MAIN_CURSEDSTAFF_AVALON', 'Shadowcaller'], ['T4_MAIN_CURSEDSTAFF_CRYSTAL', 'Rotcaller Staff']
  ])
];

const roleRules = {
  tank: { recommended: ['mace', 'hammer', 'shapeshifter'], excluded: [] },
  healer: { recommended: ['nature', 'holy', 'shapeshifter'], excluded: [] },
  support: { recommended: [], excluded: ['nature', 'holy', 'mace', 'hammer'] },
  dps: { recommended: [], excluded: ['nature', 'holy', 'mace', 'hammer'] }
};

function family(key, label, labelEn, color, weapons) {
  return {
    key,
    label,
    labelEn,
    color,
    icon: itemImage(weapons[0][0]),
    weapons: weapons.map(([itemId, name]) => ({
      key: itemId,
      itemId,
      name,
      image: itemImage(itemId)
    }))
  };
}

function tierItemId(itemId, tier = 8) {
  return String(itemId).replace(/^T4_/, `T${tier}_`);
}

function itemImage(itemId, tier = 8, quality = 4) {
  return `https://render.albiononline.com/v1/item/${tierItemId(itemId, tier)}.png?quality=${quality}`;
}

function findWeapon(itemId) {
  for (const currentFamily of families) {
    const weapon = currentFamily.weapons.find((candidate) => candidate.itemId === itemId);
    if (weapon) return { ...weapon, familyKey: currentFamily.key, familyLabel: currentFamily.label };
  }
  return null;
}

function familyRuleForRole(role, familyKey) {
  const rule = roleRules[role] || { recommended: [], excluded: [] };
  return {
    allowed: !rule.excluded.includes(familyKey),
    recommended: rule.recommended.includes(familyKey)
  };
}

module.exports = { families, familyRuleForRole, findWeapon, itemImage, roleRules, tierItemId };
