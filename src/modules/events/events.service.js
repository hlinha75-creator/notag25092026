const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  OverwriteType,
  PermissionFlagsBits
} = require('discord.js');
const ids = require('../../config/ids');
const { transaction } = require('../../database/connection');
const audit = require('../audit/audit.repository');
const finance = require('../finance/finance.service');
const campaigns = require('../campaigns/campaigns.service');
const repo = require('./events.repository');
const { calculateNetLoot, calculatePayouts } = require('./lootCalculator');
const { formatSilver } = require('../../utils/silver');
const { backupDatabase } = require('../../database/backup');
const { normalizeAllowedMentions, safeSend } = require('../../utils/discord');
const { embedFieldValue, embedLinesFields } = require('./eventPresentation');
const { eventTypeEmoji, eventTypeLabel, usesVisualComposition } = require('./eventTypes');
const compositionRules = require('./compositionRules');
const weaponSelectionModes = require('./weaponSelectionModes');
const weaponCatalog = require('./weaponCatalog');
const customEventWeaponCatalog = require('./customEventWeaponCatalog.service');
const sponsoredCtaBuilds = require('./sponsoredCtaBuilds.service');
const {
  addEventRoleToMember,
  checkEventStartWarnings,
  deleteWarningMessage,
  ensureEventTempRole,
  eventReminderPayload,
  parseAlbionEventTime,
  removeEventRoleFromMember,
  removeWarningRole
} = require('./eventReminders.service');

const roleConfigs = {
  tank: { label: 'Tank', slots: 'tank_slots', style: ButtonStyle.Primary },
  healer: { label: 'Healer', slots: 'healer_slots', style: ButtonStyle.Success },
  support: { label: 'Suporte', slots: 'support_slots', style: ButtonStyle.Secondary },
  dps: { label: 'DPS', slots: 'dps_slots', style: ButtonStyle.Danger }
};
const eventRoles = Object.keys(roleConfigs);
const eventVoiceMoveSettleMs = process.env.NODE_ENV === 'test' ? 0 : 2500;
const eventVoiceMoveRetrySettleMs = process.env.NODE_ENV === 'test' ? 0 : 1200;
const lootReviewCorrectionDrafts = new Map();
const lootReviewCorrectionDraftLifetimeMs = 10 * 60 * 1000;
let inactiveEventVoiceCleanupPromise = null;
const pingContentIndexMessageKey = 'ping-content:event-index';
const pingContentAutoIndexEnabled = false;
const emojiRefs = {
  role: {
    tank: { name: 'Tank', id: '1517095771659436153' },
    healer: { name: 'Healer', id: '1517096201915334829' },
    support: { name: 'Support', id: '1517095620769349662' },
    dps: { name: 'DPS', id: '1517096370412982423' }
  },
  weapon: {
    martelo: { name: 'Martelo', id: '1517096973352702032' },
    incubus: { name: 'Incubus', id: '1517096493457342474' },
    quebra: { name: 'RealBreaker', id: '1517097073768665180' },
    quebra_reinos: { name: 'RealBreaker', id: '1517097073768665180' },
    hallow: { name: 'QuesaSanta', id: '1481801328161329152' },
    queda_santa: { name: 'QuesaSanta', id: '1481801328161329152' },
    fallen: { name: 'Fallen', id: '1517097238336110742' },
    raiz: { name: 'Iron', id: '1517097588518813767' },
    raiz_ferrea: { name: 'Iron', id: '1517097588518813767' },
    sc: { name: 'Shadow', id: '1517097701148459131' },
    shadow_caller: { name: 'Shadow', id: '1517097701148459131' },
    danacao: { name: 'Damnation', id: '1517097839107379211' },
    damnation: { name: 'Damnation', id: '1517097839107379211' },
    enig: { name: 'Enig', id: '1517098127490940968' },
    enigmatico: { name: 'Enig', id: '1517098127490940968' },
    aguia: { name: 'LightCaller', id: '1517098287251853312' },
    lc: { name: 'LightCaller', id: '1517098287251853312' },
    uivo_frio: { name: 'Chill', id: '1517098366155227279' },
    chill: { name: 'Chill', id: '1517098366155227279' },
    furabruma: { name: 'Furabruma', id: '1517189201232138240' },
    fura_bruma: { name: 'Furabruma', id: '1517189201232138240' },
    repetidor: { name: 'Repetidor', id: '1517098209749766255' },
    martelo_de_cristal: { name: 'raid_martelo_cristal', id: '1544717922218410089' },
    monge_negro: { name: 'raid_monge_negro', id: '1544717929176764538' },
    sagrado_healer_do_tank: { name: 'raid_sagrado', id: '1544717933119414352' },
    corrompido_healer_dos_healers: { name: 'raid_corrompido', id: '1544717935648440420' },
    corrompido_healer_da_party: { name: 'raid_corrompido', id: '1544717935648440420' },
    chama_sombria: { name: 'raid_chama_sombria', id: '1544717937666035793' },
    enigmatico_1: { name: 'raid_enigmatico', id: '1544717938932711534' },
    enigmatico_2: { name: 'raid_enigmatico', id: '1544717938932711534' },
    aguia_lightcaller: { name: 'raid_aguia', id: '1544717942779019305' },
    prisma: { name: 'raid_prisma', id: '1544717944511008848' },
    fulgurante: { name: 'raid_fulgurante', id: '1544717946356502568' },
    repetidor_fura_bruma: { name: 'raid_repetidor', id: '1544717940698652734' }
  }
};
const raidAvalonSlots = { tank: 3, healer: 3, support: 3, dps: 11 };
const raidAvalonWeaponSlots = {
  tank: ['Martelo', 'Incubus', 'Quebra Reinos'],
  healer: ['Fallen', 'Raiz', 'Hallow'],
  support: ['SC', 'Enig', 'Danacao'],
  dps: ['Aguia', 'Uivo Frio', 'Furabruma', 'Repetidor 1', 'Repetidor 2', 'Repetidor 3', 'Repetidor 4', 'Repetidor 5', 'Repetidor 6', 'Repetidor 7', 'Repetidor 8']
};
const raidAvalonUnlockRules = {
  raiz: 6,
  quebra_reinos: 7,
  danacao: 8,
  hallow: 9
};
const raidAvalonWeapons = Object.fromEntries(
  Object.entries(raidAvalonWeaponSlots).map(([role, weapons]) => [role, [...new Set(weapons)]])
);
const raidDragonSlots = { tank: 3, healer: 3, support: 3, dps: 11 };
const raidDragonWeaponSlots = {
  tank: ['Martelo de Cristal', 'Incubus', 'Monge Negro'],
  healer: ['Sagrado - Healer do Tank', 'Corrompido - Healer dos Healers', 'Corrompido - Healer da Party'],
  support: ['Chama Sombria', 'Enigmático 1', 'Enigmático 2'],
  dps: [
    ...Array.from({ length: 11 }, (_, index) => `Repetidor/Fura-Bruma ${index + 1}`),
    'Águia (Lightcaller)',
    'Prisma',
    'Fulgurante'
  ]
};
const raidDragonWeapons = Object.fromEntries(
  Object.entries(raidDragonWeaponSlots).map(([role, weapons]) => [role, [...new Set(weapons)]])
);
const raidAvalonWeaponInfo = {
  martelo: {
    iconUrl: 'https://albiononlinegrind.com/images/fallback/T8_2H_HAMMER_CRYSTAL.png',
    buildUrl: 'https://prnt.sc/Y-z2-06j746K'
  },
  incubus: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_MACE_HELL.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/TU9zh2Ez58aR'
  },
  quebra_reinos: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_AXE_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/mn4C8rnsSsaY'
  },
  quebra: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_AXE_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/mn4C8rnsSsaY'
  },
  queda_santa: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_HOLYSTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/LOnzuabDHwiE'
  },
  hallow: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_HOLYSTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/LOnzuabDHwiE'
  },
  corrompido: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_HOLYSTAFF_HELL.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/J7lD2RLeVkti'
  },
  fallen: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_HOLYSTAFF_HELL.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/J7lD2RLeVkti'
  },
  raiz_ferrea: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_NATURESTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/tbnvRFhoZPaG'
  },
  raiz: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_NATURESTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/tbnvRFhoZPaG'
  },
  shadow_caller: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_CURSEDSTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/mpbQ1v8vgR-f'
  },
  sc: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_CURSEDSTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/mpbQ1v8vgR-f'
  },
  danacao: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_CURSEDSTAFF_MORGANA.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/mpbQ1v8vgR-f'
  },
  enigmatico: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_ENIGMATICSTAFF.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/sYmochYnSwfo'
  },
  enig: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_ENIGMATICSTAFF.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/sYmochYnSwfo'
  },
  repetidor: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_REPEATINGCROSSBOW_UNDEAD.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/zJhF3t_ePQIb'
  },
  aguia: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_SHAPESHIFTER_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/GPBXB_qGTYTD'
  },
  lc: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_SHAPESHIFTER_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/GPBXB_qGTYTD'
  },
  uivo_frio: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_FROSTSTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/wekmGkxwXrl0'
  },
  chill: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_FROSTSTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/wekmGkxwXrl0'
  },
  mist_repetidor: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_REPEATINGCROSSBOW_UNDEAD.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/zJhF3t_ePQIb'
  },
  mistpiercer: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_BOW_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/rMl0DPRnsss7'
  },
  furabruma: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_BOW_AVALON.png?count=1&quality=1',
    buildUrl: 'https://prnt.sc/rMl0DPRnsss7'
  }
};
const raidDragonWeaponInfo = {
  martelo_de_cristal: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_HAMMER_CRYSTAL.png?count=1&quality=1',
    buildUrl: 'https://discord.com/channels/1480232409105699030/1544706651741749279'
  },
  incubus: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_MACE_HELL.png?count=1&quality=1',
    buildUrl: 'https://discord.com/channels/1480232409105699030/1544706657722834974'
  },
  monge_negro: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_COMBATSTAFF_MORGANA.png?count=1&quality=1',
    buildUrl: 'https://discord.com/channels/1480232409105699030/1544706664379318292'
  },
  sagrado_healer_do_tank: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_HOLYSTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://discord.com/channels/1480232409105699030/1544706669882249226'
  },
  corrompido_healer_dos_healers: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_HOLYSTAFF_HELL.png?count=1&quality=1',
    buildUrl: 'https://discord.com/channels/1480232409105699030/1544706676672962591'
  },
  corrompido_healer_da_party: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_HOLYSTAFF_HELL.png?count=1&quality=1',
    buildUrl: 'https://discord.com/channels/1480232409105699030/1544706683337572523'
  },
  chama_sombria: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_MAIN_CURSEDSTAFF_AVALON.png?count=1&quality=1',
    buildUrl: 'https://discord.com/channels/1480232409105699030/1544706689540821042'
  },
  enigmatico_1: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_ENIGMATICSTAFF.png?count=1&quality=1',
    buildUrl: 'https://discord.com/channels/1480232409105699030/1544706694943211641'
  },
  enigmatico_2: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_ENIGMATICSTAFF.png?count=1&quality=1',
    buildUrl: 'https://discord.com/channels/1480232409105699030/1544706703013183538'
  },
  repetidor_fura_bruma: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_REPEATINGCROSSBOW_UNDEAD.png?count=1&quality=1',
    buildUrl: 'https://discord.com/channels/1480232409105699030/1544704399945764974'
  },
  aguia_lightcaller: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_SHAPESHIFTER_AVALON.png?count=1&quality=1',
    buildUrl: 'https://discord.com/channels/1480232409105699030/1544706718670393358'
  },
  prisma: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_ICECRYSTAL_UNDEAD.png?count=1&quality=1',
    buildUrl: 'https://discord.com/channels/1480232409105699030/1544706724987146364'
  },
  fulgurante: {
    iconUrl: 'https://render.albiononline.com/v1/item/T8_2H_INFERNOSTAFF_MORGANA.png?count=1&quality=1',
    buildUrl: 'https://discord.com/channels/1480232409105699030/1544706731089592351'
  }
};
const raidProfiles = {
  raid_avalon: {
    slots: raidAvalonSlots,
    weaponSlots: raidAvalonWeaponSlots,
    weapons: raidAvalonWeapons,
    unlockRules: raidAvalonUnlockRules,
    weaponInfo: raidAvalonWeaponInfo,
    title: 'Raid Avalon Full'
  },
  raid_dragon: {
    slots: raidDragonSlots,
    weaponSlots: raidDragonWeaponSlots,
    weapons: raidDragonWeapons,
    unlockRules: {},
    weaponInfo: raidDragonWeaponInfo,
    title: 'Raid Dragão'
  }
};
const raidAvalonHelpers = {
  scout: 'Scout',
  looter: 'Looter',
  uper: 'Uper'
};
const worldBossSlots = [
  { key: 'main_tank', label: 'Main Tank', role: 'tank', kind: 'main', emoji: '<:Incubus:1517096493457342474>' },
  { key: 'main_heal', label: 'Main Healer', role: 'healer', kind: 'main', emoji: '<:QuedaSanta:1481801328161329152>' },
  { key: 'badon', label: 'Badon', role: 'support', kind: 'main', emoji: '<:Badon:1481800829819158705>' },
  { key: 'shadowcaller', label: 'Shadowcaller', role: 'support', kind: 'main', emoji: '<:Shadow:1517097701148459131>' },
  { key: 'perma_support', label: 'Permafrost', role: 'support', kind: 'main', emoji: '<:perm:1526996726123204698>' },
  { key: 'lightcaller', label: 'Aguia', role: 'dps', kind: 'main', emoji: '<:LightCaller:1517098287251853312>' },
  { key: 'mistpiercer_1', label: 'Mistpiercer 1', role: 'dps', kind: 'main', emoji: '<:Fura_Mist:1517189201232138240>' },
  { key: 'mistpiercer_2', label: 'Mistpiercer 2', role: 'dps', kind: 'main', emoji: '<:Fura_Mist:1517189201232138240>' },
  { key: 'mistpiercer_3', label: 'Mistpiercer 3', role: 'dps', kind: 'main', emoji: '<:Fura_Mist:1517189201232138240>' },
  { key: 'looter', label: 'Looter', role: 'dps', kind: 'main', emoji: '<:Looter:1528440806208442519>' },
  { key: 'scout_sw_gate', label: 'Portao SW (Mobile)', role: 'scout', kind: 'mobile', emoji: '<:oxt3:1527018389019562024>' },
  { key: 'scout_nw_gate', label: 'Portao NW (Mobile)', role: 'scout', kind: 'mobile', emoji: '<:oxt3:1527018389019562024>' },
  { key: 'scout_ne_gate', label: 'Portao NE (Mobile)', role: 'scout', kind: 'mobile', emoji: '<:oxt3:1527018389019562024>' },
  { key: 'scout_sw_bridge', label: 'Ponte SW (Ativo)', role: 'scout', kind: 'active', emoji: '<:oxt3:1527018389019562024>' },
  { key: 'scout_se_bridge', label: 'Ponte SE (Ativo)', role: 'scout', kind: 'active', emoji: '<:oxt3:1527018389019562024>' },
  { key: 'scout_ne_bridge', label: 'Ponte NE (Ativo)', role: 'scout', kind: 'active', emoji: '<:oxt3:1527018389019562024>' }
];
const defaultFunctionByRole = {
  tank: 'Incubus',
  healer: 'Hallow',
  support: 'SC',
  dps: 'Furabruma'
};
const careerCategories = {
  tank: { key: 'classe_tank', name: 'Tank' },
  healer: { key: 'classe_healer', name: 'Healer' },
  support: { key: 'classe_support', name: 'Suporte' },
  dps: { key: 'classe_dps', name: 'DPS' },
  caller: { key: 'classe_caller', name: 'Caller' }
};
const careerHelperCategories = {
  scout: 'support',
  looter: 'support'
};

const raidDefaultObservation = 'Se tem duvida ou precisa de build vem 30 min cedo pro PORTAL DE MARTLOCK.';
const legacyRaidDescriptionPattern = /^Raid Avalon Full\s*\|\s*DG\s+.+\s*\|\s*Build\s+.+$/i;

function eventEmbed(event, participants = [], options = {}) {
  const count = (role) => participants.filter((p) => p.role === role && !p.is_spectator && !p.is_paused).length;
  const elapsed = event.started_at ? formatDuration(Math.floor((Date.now() - Date.parse(event.started_at)) / 1000)) : '0m';
  const raidMeta = repo.getRaidAvalonEventMeta(event.id);
  const embed = new EmbedBuilder()
    .setTitle(formatEventTitle(event.title))
    .setColor(event.status === 'running' ? 0x38a169 : event.status === 'cancelled' ? 0xe53e3e : 0x3182ce)
    .setTimestamp(new Date());

  const worldBossMeta = repo.getWorldBossEventMeta(event.id);
  const specialVisualMode = repo.getVisualEventBuildMeta(event.id)?.composition_mode;
  if (worldBossMeta && (!specialVisualMode || weaponSelectionModes.normalize(specialVisualMode) === 'predefined')) {
    return embed
      .setTitle(null)
      .setDescription(worldBossAnnouncementDescription(event));
  }

  if (raidMeta && (!specialVisualMode || weaponSelectionModes.normalize(specialVisualMode) === 'predefined')) {
    const fields = [
      ...eventRoles.map((role) => ({
        name: `${roleStatsLabel(role)} ${count(role)}/${event[roleConfigs[role].slots]}`,
        value: roleOccupants(event, participants, role),
        inline: false
      })),
      { name: 'Auxiliares', value: raidHelpersSummary(participants), inline: false }
    ];
    if (event.status === 'running') {
      fields.unshift({ name: 'Tempo em andamento', value: elapsed, inline: true });
    }
    return embed
      .setTitle(raidAnnouncementTitle(event, raidMeta))
      .setDescription(raidAnnouncementDescription(event))
      .addFields(fields);
  }

  if (event.status === 'running') {
    return embed
      .setTitle(null)
      .setDescription(commonEventAnnouncement(event, participants, { ...options, running: true, elapsed }))
      .addFields(
        { name: 'Voz', value: event.voice_channel_id ? `<#${event.voice_channel_id}>` : 'Sala em criacao', inline: true }
      );
  }

  return embed
    .setTitle(null)
    .setDescription(commonEventAnnouncement(event, participants, options));
}

function worldBossAnnouncementDescription(event) {
  const assignments = new Map(
    repo.listWorldBossAssignments(event.id).map((assignment) => [assignment.slot_key, assignment.discord_id])
  );
  const filled = assignments.size;
  const roleLines = worldBossSlots.slice(0, 10).map((slot) => worldBossSlotLine(slot, assignments));
  const scoutLines = worldBossSlots.slice(10).map((slot) => worldBossSlotLine(slot, assignments));
  const buildUrl = `https://discord.com/channels/${ids.guildId}/${ids.channels.worldBossBuilds}`;
  const status = event.status === 'running' ? '\n\n\u{1F7E2} **EVENTO EM ANDAMENTO**' : '';
  return [
    '# \u2694\uFE0F FARM WORLD BOSS \u2694\uFE0F',
    `> **\u{1F552} Horario:** ${event.scheduled_time || '00:00 as 02:00 UTC'}`,
    `> **\u{1F4CD} Local:** ${event.location || 'DK / Vulcano'}`,
    `> **\u{1F4DA} [BUILDS](${buildUrl})**`,
    '',
    '\u2501'.repeat(22),
    `## ROLES \u2014 ${worldBossFilledCount(assignments, 0, 10)}/10`,
    ...roleLines,
    '',
    '\u2501'.repeat(22),
    `## SCOUTS \u2014 ${worldBossFilledCount(assignments, 10, 16)}/6`,
    ...scoutLines,
    '',
    '\u2501'.repeat(22),
    `**TOTAL: ${filled}/16**${status}`
  ].join('\n').slice(0, 4096);
}

function worldBossSlotLine(slot, assignments) {
  const discordId = assignments.get(slot.key);
  return `> ${slot.emoji} **${slot.label}** - ${discordId ? `<@${discordId}>` : '\u{1F7E1} Livre'}`;
}

function worldBossFilledCount(assignments, start, end) {
  return worldBossSlots.slice(start, end).filter((slot) => assignments.has(slot.key)).length;
}

function commonEventAnnouncement(event, participants, options = {}) {
  const title = formatEventTitle(event.title).toUpperCase();
  const totalSlots = eventRoles.reduce((total, role) => total + Number(event[roleConfigs[role].slots] || 0), 0);
  const active = participants.filter((participant) => !participant.is_spectator && !participant.is_paused);
  const spectators = participants.filter((participant) => participant.is_spectator);
  const paused = participants.filter((participant) => !participant.is_spectator && participant.is_paused);
  const customMeta = repo.getCustomEventMeta(event.id);
  const visualBuildMeta = repo.getVisualEventBuildMeta(event.id);
  const customSlots = customMeta || visualBuildMeta ? repo.listCustomEventSlots(event.id) : [];
  const dpsPool = customMeta ? repo.listCustomEventDpsWeapons(event.id) : [];
  const filled = active.length;
  const timing = options.running
    ? `em andamento - ${options.elapsed || '0m'}`
    : customMeta
      ? event.scheduled_time
      : eventTimeLabel(event.scheduled_time);
  const lines = [
    `## ${eventEmoji(event)} ${title}${timing ? ` (${timing})` : ''}`,
    '',
    ...(customMeta
      ? customEventDetailLines(event, customMeta)
      : [
          `**Tipo:** ${eventTypeLabel(event.content_type)}`,
          `**Local:** ${event.location || 'Nao informado'}`,
          `**Build:** ${event.description || 'Nao informado'}`,
          visualBuildMeta ? `**Imagens das builds:** <#${visualBuildMeta.builds_channel_id}>` : null,
          `**Acesso:** ${eventAudienceLabel(event.audience)}`
        ].filter(Boolean)),
    '',
    `### Composicao (${filled}/${totalSlots})`,
    '',
    ...compositionLines(event, active, customSlots, dpsPool, visualBuildMeta, options.client),
    '',
    ...(!customMeta && !visualBuildMeta && Number(event.dps_slots || 0) > 0
      ? ['**Looter:** ultima vaga de DPS - levar Javali Espectral e recolher os sacos do chao.', '']
      : []),
    `**Espectadores:** ${spectators.length ? spectators.map((participant) => `<@${participant.discord_id}>`).join(', ') : 'Vazio'}`,
    ...(paused.length ? [`**Pausados:** ${paused.map((participant) => `<@${participant.discord_id}>`).join(', ')}`] : [])
  ];
  return lines.join('\n').slice(0, 4096);
}

function eventAudienceLabel(audience) {
  if (audience === 'staff') return 'Interno da Staff';
  if (audience === 'member') return 'Exclusivo para Membros';
  return 'Publico para Membros e Convidados';
}

function customEventDetailLines(event, customMeta) {
  const dpsPolicyLabels = {
    caller: 'Definidas pelo caller',
    free: 'Escolha livre dos membros',
    limited: 'Escolha dos membros com limite por arma',
    predefined: 'Predefinidas pelo caller',
    role_free: 'Livre por função, sem informar arma',
    sheet_limited: 'Escolha informada respeitando a planilha',
    weapon_declared: 'Escolha informada sem limite por arma'
  };
  return [
    `**Tipo:** ${eventTypeLabel(event.content_type)}`,
    `**Local:** ${event.location || 'Nao informado'}`,
    `**Descricao:** ${event.description || 'Nao informado'}`,
    `**Acesso:** ${eventAudienceLabel(event.audience)}`,
    `**Loot:** ${customMeta.loot_rules || 'Nao informado'}`,
    `**Consumiveis:** ${customMeta.consumables || 'Nao informado'}`,
    `**Montaria:** ${customMeta.mount_requirement || 'Nao informado'}`,
    ids.channels.outpostBuilds
      ? `**Onde estão as builds:** [abrir fórum](https://discord.com/channels/${ids.guildId}/${ids.channels.outpostBuilds})`
      : null,
    `**Armas DPS:** ${dpsPolicyLabels[customMeta.dps_policy] || dpsPolicyLabels.caller}`
  ].filter(Boolean);
}

function compositionLines(event, participants, customSlots = [], dpsPool = [], visualBuildMeta = null, client = null) {
  const remaining = new Map();
  const labels = new Map(customSlots.map((slot) => [`${slot.role}:${slot.slot_index}`, slot]));
  const dpsLabels = new Map(dpsPool.map((weapon) => [weapon.weapon_key, weapon]));
  const rulesSnapshot = visualBuildMeta
    ? compositionRules.parseSnapshot(visualBuildMeta.rules_json, event.content_type)
    : null;
  const buildsFallbackUrl = visualBuildMeta?.builds_channel_id
    ? `https://discord.com/channels/${ids.guildId}/${visualBuildMeta.builds_channel_id}`
    : null;
  for (const role of eventRoles) {
    remaining.set(role, participants.filter((participant) => (
      participant.role === role && participant.custom_slot_index == null
    )));
  }

  return eventRoles.flatMap((role) => {
    const slots = Number(event[roleConfigs[role].slots] || 0);
    return Array.from({ length: slots }, (_, index) => {
      const slotIndex = index + 1;
      const participant = participants.find((candidate) => (
        candidate.role === role && Number(candidate.custom_slot_index) === slotIndex
      )) || remaining.get(role).shift();
      const customSlot = labels.get(`${role}:${slotIndex}`);
      const dynamicDps = role === 'dps' ? dpsLabels.get(participant?.custom_weapon_key) : null;
      const selectedWeapon = participant?.custom_weapon_key ? weaponCatalog.findWeapon(participant.custom_weapon_key) : null;
      const selectedRule = selectedWeapon && rulesSnapshot
        ? compositionRules.ruleFor(rulesSnapshot, participant.custom_weapon_key)
        : null;
      const effectiveCustomSlot = customSlot ? {
        ...customSlot,
        build_url: compositionRules.ruleFor(rulesSnapshot, customSlot.build_key).buildUrl
          || customSlot.build_url
          || buildsFallbackUrl
      } : customSlot;
      const selectedWeaponWithEmoji = selectedWeapon
        ? sponsoredCtaBuilds.attachAvailableEmojis([{
            ...selectedWeapon,
            key: participant.custom_weapon_key
          }], client, null)[0]
        : null;
      const dynamicVisual = selectedWeaponWithEmoji ? {
        weapon_label: selectedWeapon.name,
        build_url: selectedRule?.buildUrl || buildsFallbackUrl,
        emoji_name: selectedWeaponWithEmoji.emojiId
          ? selectedWeaponWithEmoji.emojiName
          : customEventWeaponCatalog.familySymbols[selectedWeapon.familyKey],
        emoji_id: selectedWeaponWithEmoji.emojiId
      } : null;
      const dynamicWeapon = visualBuildMeta && dynamicVisual ? dynamicVisual : dynamicDps || dynamicVisual;
      const customLabel = dynamicWeapon ? formatCustomDpsWeapon(dynamicWeapon) : formatCustomEventBuild(effectiveCustomSlot);
      const roleLabel = roleLineLabel(role, index, slots, {
        reserveLooter: customSlots.length === 0 && dpsPool.length === 0
      });
      const slotLabel = customLabel
        ? `${roleLabel} - ${customLabel}`
        : roleLabel;
      const participantLabel = participant
        ? `${dynamicWeapon ? `${customDpsWeaponEmoji(dynamicWeapon)} ` : ''}<@${participant.discord_id}>`
        : 'Vazio';
      return `${slotLabel} > ${participantLabel}`;
    });
  });
}

function formatCustomDpsWeapon(weapon) {
  if (!weapon) return '';
  return weapon.build_url ? `[${weapon.weapon_label}](${weapon.build_url})` : weapon.weapon_label;
}

function customDpsWeaponEmoji(weapon) {
  return formatCustomEmoji({ name: weapon?.emoji_name, id: weapon?.emoji_id })
    || weaponEmoji(weapon?.weapon_label)
    || '\u2694\uFE0F';
}

function formatCustomEventBuild(slot) {
  if (!slot?.slot_label) return '';
  const emoji = formatCustomEmoji({ name: slot.emoji_name, id: slot.emoji_id });
  const label = slot.build_url
    ? `[${slot.slot_label}](${slot.build_url})`
    : slot.slot_label;
  return `${emoji} ${label}`.trim();
}

function roleLineLabel(role, index, total, options = {}) {
  if (options.reserveLooter !== false && role === 'dps' && index === total - 1) {
    return '\u{1F417} **Looter**';
  }
  const labels = {
    tank: '\u{1F6E1}\uFE0F **Tank**',
    healer: '\u270B **Healer**',
    support: '\u{1F7E7} **Suporte**',
    dps: `\u2694\uFE0F **DPS ${index + 1}**`
  };
  if (role === 'dps') return labels.dps;
  return total > 1 ? `${labels[role]} ${index + 1}` : labels[role];
}
function eventEmoji(event) {
  return eventTypeEmoji(event.content_type);
}
function eventTimeLabel(value) {
  const start = parseAlbionEventTime(value);
  if (!start) return value || '';
  return discordTimestamp(start, 'R');
}

function roleOccupants(event, participants, role) {
  if (repo.getRaidAvalonEventMeta(event.id)) {
    return raidRoleSlotsSummary(event, participants, role);
  }

  const users = participants
    .filter((p) => p.role === role && !p.is_spectator && !p.is_paused)
    .map((p) => raidParticipantLabel(p));
  const text = users.length > 0 ? users.join(', ') : 'Vazio';
  return text.length > 1024 ? `${text.slice(0, 1018)}...` : text;
}

function raidRoleSlotsSummary(event, participants, role) {
  const profile = raidProfileForEvent(event);
  const roleParticipants = participants.filter((p) => p.role === role && !p.is_spectator && !p.is_paused);
  const dpsCount = raidDpsCount(participants);
  const remaining = new Map();
  for (const participant of roleParticipants) {
    const raid = repo.getRaidAvalonParticipant({ eventId: participant.event_id, discordId: participant.discord_id });
    const key = weaponKey(raid?.weapon_name);
    if (!key) continue;
    if (!remaining.has(key)) remaining.set(key, []);
    remaining.get(key).push({ participant, raid });
  }

  if (event.content_type === 'raid_dragon' && role === 'dps') {
    const occupiedLines = roleParticipants.map((participant) => {
      const raid = repo.getRaidAvalonParticipant({ eventId: participant.event_id, discordId: participant.discord_id });
      const weapon = raid?.weapon_name || 'DPS';
      const count = careerPointsForCategory(participant.discord_id, role);
      return `${weaponEmoji(weapon)} ${weapon} <@${participant.discord_id}> | ${raid?.item_power || '?'} IP (${count})`.trim();
    });
    const freeLines = Array.from(
      { length: Math.max(0, raidDragonSlots.dps - occupiedLines.length) },
      (_, index) => `${weaponEmoji('Repetidor/Fura-Bruma')} Repetidor/Fura-Bruma ${occupiedLines.length + index + 1} \u{1F7E2} Livre`.trim()
    );
    return [
      ...occupiedLines,
      ...freeLines,
      'ℹ️ Águia, Prisma ou Fulgurante substituem uma vaga base • máximo 1 de cada.'
    ].join('\n');
  }

  const lines = (profile.weaponSlots[role] || []).map((weapon) => {
    const key = weaponKey(weapon);
    const match = remaining.get(key)?.shift();
    const label = `${weaponEmoji(weapon)} ${raidWeaponDisplayName(event, weapon)}`.trim();
    if (!match && !isRaidWeaponUnlocked(weapon, dpsCount, event.id)) return `${label} \u{1F512} libera com ${raidWeaponRequiredDps(weapon, event.id)} DPS`;
    if (!match) return `${label} \u{1F7E2} Livre`;
    const count = careerPointsForCategory(match.participant.discord_id, role);
    return `${label} <@${match.participant.discord_id}> | ${match.raid.item_power || '?'} IP (${count})`;
  });

  return lines.join('\n') || 'Vazio';
}

function raidHelpersSummary(participants) {
  const helpers = participants.filter((participant) => participant.is_spectator);
  if (helpers.length === 0) return 'Vazio';
  return helpers.map((participant) => {
    const raid = repo.getRaidAvalonParticipant({ eventId: participant.event_id, discordId: participant.discord_id });
    const label = raid?.helper_role ? raidAvalonHelpers[raid.helper_role] || raid.helper_role : 'Assistir';
    const countText = careerHelperCategories[raid?.helper_role] ? ` (${careerPointsForCategory(participant.discord_id, 'support')})` : '';
    return `<@${participant.discord_id}> - ${label}${countText}`;
  }).join('\n');
}

function raidDpsCount(participants) {
  return participants.filter((participant) => participant.role === 'dps' && !participant.is_spectator && !participant.is_paused).length;
}

function raidWeaponRequiredDps(weapon, eventId = null) {
  const profile = raidProfileForEventId(eventId);
  return profile.unlockRules[weaponKey(weapon)] || 0;
}

function isRaidWeaponUnlocked(weapon, dpsCount, eventId = null) {
  const required = raidWeaponRequiredDps(weapon, eventId);
  return required <= 0 || Number(dpsCount || 0) >= required;
}

function raidParticipantLabel(participant) {
  const raid = repo.getRaidAvalonParticipant({ eventId: participant.event_id, discordId: participant.discord_id });
  if (!raid?.weapon_name && !raid?.helper_role) return `<@${participant.discord_id}>`;
  const details = [
    raid.weapon_name,
    raid.item_power ? `IP ${raid.item_power}` : null,
    raid.helper_role ? raidAvalonHelpers[raid.helper_role] || raid.helper_role : null
  ].filter(Boolean).join(' | ');
  return `<@${participant.discord_id}> - ${details}`;
}

function runningParticipantsSummary(participants) {
  const order = { tank: 1, healer: 2, support: 3, dps: 4, spectator: 5 };
  const lines = participants
    .slice()
    .sort((a, b) => (order[a.role] || 99) - (order[b.role] || 99))
    .map((participant) => {
      const role = participant.is_spectator ? 'spectator' : participant.role;
      return `${raidParticipantLabel(participant)} - ${roleLabel(role)}`;
    });

  if (lines.length === 0) return 'Nenhum participante ainda.';

  const visible = [];
  let totalLength = 0;
  for (const line of lines) {
    const nextLength = totalLength + line.length + (visible.length > 0 ? 1 : 0);
    if (nextLength > 950) break;
    visible.push(line);
    totalLength = nextLength;
  }

  const hidden = lines.length - visible.length;
  if (hidden > 0) visible.push(`... e mais ${hidden}`);
  return visible.join('\n');
}

function eventComponents(event, options = {}) {
  if (!['created', 'running'].includes(event.status)) return [];

  const rows = [];
  const specialVisualMode = repo.getVisualEventBuildMeta(event.id)?.composition_mode;
  const usesSpecialComposition = !specialVisualMode || weaponSelectionModes.normalize(specialVisualMode) === 'predefined';
  const isWorldBoss = Boolean(repo.getWorldBossEventMeta(event.id)) && usesSpecialComposition;
  if (isWorldBoss) {
    if (event.status === 'created') {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`event:wb_slot:${event.id}:wb`).setLabel('Escolher funcao').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`event:wb_manage:${event.id}:wb`).setLabel('Gerenciar vagas').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`event:edit:${event.id}:wb`).setLabel('Editar').setEmoji('\u270F\uFE0F').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`event:start:${event.id}:wb`).setLabel('Iniciar').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`event:cancel:${event.id}:wb`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
      ));
    } else {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`event:pause:${event.id}:wb`).setLabel('Pausar participacao').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`event:finish:${event.id}:wb`).setLabel('Finalizar').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`event:cancel:${event.id}:wb`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
      ));
    }
    return rows;
  }
  const isRaid = isRaidAvalonEvent(event) && usesSpecialComposition;
  if (isRaid) {
    rows.push(new ActionRowBuilder().addComponents(
      eventRoles.map((role) => new ButtonBuilder()
        .setCustomId(`event:raid_role:${event.id}:${role}`)
        .setLabel(roleButtonLabel(role))
        .setEmoji(roleButtonEmoji(role))
        .setStyle(roleConfigs[role].style))
    ));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`event:spectate:${event.id}:raid`).setLabel('Assistir').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:raid_slot:${event.id}:raid`).setLabel('Trocar vaga').setStyle(ButtonStyle.Primary),
      ...Object.entries(raidAvalonHelpers).map(([key, label]) => new ButtonBuilder()
        .setCustomId(`event:raid_helper:${event.id}:${key}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Secondary))
    ));
  } else if (event.status === 'created') {
    rows.push(new ActionRowBuilder().addComponents(
      eventRoles.map((role) => new ButtonBuilder()
        .setCustomId(`event:join_role:${event.id}:${role}`)
        .setLabel(roleButtonLabel(role))
        .setEmoji(roleButtonEmoji(role))
        .setStyle(roleConfigs[role].style))
    ));
  } else if (event.status === 'running') {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`event:change_role:${event.id}:main`)
        .setLabel('Trocar funcao')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`event:manage_players:${event.id}:main`)
        .setLabel('Gerenciar jogadores')
        .setStyle(ButtonStyle.Secondary)
    ));
  }

  const buttons = event.status === 'running'
    ? isRaid
    ? [
      new ButtonBuilder().setCustomId(`event:pause:${event.id}:raid`).setLabel('Pausar participacao').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:finish:${event.id}:raid`).setLabel('Finalizar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`event:cancel:${event.id}:raid`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    ]
    : [
      new ButtonBuilder().setCustomId(`event:auto_join:${event.id}:main`).setLabel('Quero participar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event:spectate:${event.id}:main`).setLabel('Assistir').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:pause:${event.id}:main`).setLabel('Pausar participacao').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:finish:${event.id}:main`).setLabel('Finalizar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`event:cancel:${event.id}:main`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    ]
    : isRaid
    ? [
      new ButtonBuilder().setCustomId(`event:edit:${event.id}:raid`).setLabel('Editar').setEmoji('\u270F\uFE0F').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:start:${event.id}:raid`).setLabel('Iniciar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event:cancel:${event.id}:raid`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    ]
    : [
      new ButtonBuilder().setCustomId(`event:spectate:${event.id}:main`).setLabel('Assistir').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:edit:${event.id}:main`).setLabel('Editar').setEmoji('\u270F\uFE0F').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:start:${event.id}:main`).setLabel('Iniciar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event:cancel:${event.id}:main`).setLabel('Cancelar').setStyle(ButtonStyle.Danger)
    ];

  rows.push(new ActionRowBuilder().addComponents(buttons));
  return filterEventManagementComponents(rows, options.viewerCanManage);
}

function filterEventManagementComponents(rows, viewerCanManage) {
  if (viewerCanManage !== false) return rows;
  const managementActions = new Set(['edit', 'start', 'finish', 'cancel', 'manage_players']);
  return rows
    .map((row) => {
      const visible = row.components.filter((component) => {
        const action = String(component.data?.custom_id || '').split(':')[1];
        return !managementActions.has(action);
      });
      return visible.length ? new ActionRowBuilder().addComponents(visible) : null;
    })
    .filter(Boolean);
}

async function createEventFromModal(interaction, fields) {
  return createEventFromFields(interaction, {
    creatorId: interaction.user.id,
    ...fields
  });
}

async function createCustomEventFromDraft(interaction, draft) {
  const event = await createEventFromFields(interaction, {
    creatorId: draft.creatorId,
    title: draft.title,
    description: draft.description,
    location: draft.location,
    scheduledTime: draft.scheduledTime,
    tankSlots: draft.composition.tank,
    healerSlots: draft.composition.healer,
    supportSlots: draft.composition.support,
    dpsSlots: draft.composition.dps,
    contentType: draft.contentType || 'cta',
    audience: draft.catalog?.length ? 'member' : 'public'
  });
  repo.createCustomEventMeta({
    eventId: event.id,
    eventDay: draft.day,
    timeRange: draft.timeRange,
    lootRules: draft.lootRules,
    consumables: draft.consumables,
    mountRequirement: draft.mount,
    slots: draft.slotDefinitions,
    dpsPool: draft.dpsPool,
    dpsPolicy: draft.dpsPolicy
  });
  if (['sheet_limited', 'weapon_declared'].includes(draft.dpsPolicy)) {
    const configured = new Map(draft.slotDefinitions.map((slot) => [`${slot.role}:${slot.index}`, slot]));
    const slots = eventRoles.flatMap((role) => Array.from({ length: Number(draft.composition[role] || 0) }, (_, index) => (
      configured.get(`${role}:${index + 1}`) || { role, index: index + 1, value: '', buildKey: null, buildUrl: null }
    )));
    repo.createVisualEventBuildMeta({
      eventId: event.id,
      buildsChannelId: draft.buildsChannelId || ids.channels.outpostBuilds,
      buildsChannelName: draft.buildsChannelName || null,
      slots,
      compositionMode: draft.dpsPolicy,
      rulesSnapshot: draft.rulesSnapshot || await compositionRules.loadSnapshot(draft.contentType || 'cta'),
      sheetUrl: compositionRules.COMPOSITION_SHEET_URL
    });
  }
  await refreshEventMessage(interaction.client, event.id);
  return repo.getEvent(event.id);
}

async function createVisualEventFromDraft(interaction, draft) {
  if (!usesVisualComposition(draft.contentType)) {
    throw new Error('Este rascunho nao pertence a um evento com composicao visual.');
  }
  if (!draft.buildsChannelId) throw new Error('Escolha o fórum com as imagens das builds.');
  if (weaponSelectionModes.normalize(draft.compositionMode) === 'predefined') {
    const errors = compositionRules.validateSlots(draft.slotDefinitions, draft.rulesSnapshot);
    if (errors.length) throw new Error(`A composição não respeita a planilha:\n- ${errors.join('\n- ')}`);
  }
  const event = await createEventFromFields(interaction, {
    creatorId: draft.creatorId,
    title: draft.title,
    description: draft.description,
    location: draft.location,
    scheduledTime: draft.scheduledTime,
    tankSlots: draft.composition.tank,
    healerSlots: draft.composition.healer,
    supportSlots: draft.composition.support,
    dpsSlots: draft.composition.dps,
    contentType: draft.contentType
  });
  repo.createVisualEventBuildMeta({
    eventId: event.id,
    buildsChannelId: draft.buildsChannelId,
    buildsChannelName: draft.buildsChannelName,
    slots: draft.slotDefinitions,
    compositionMode: draft.compositionMode,
    rulesSnapshot: draft.rulesSnapshot,
    sheetUrl: compositionRules.COMPOSITION_SHEET_URL
  });
  await refreshEventMessage(interaction.client, event.id);
  return repo.getEvent(event.id);
}

async function createGroupDungeonFromDraft(interaction, draft) {
  return createVisualEventFromDraft(interaction, draft);
}

async function createRaidAvalonFullFromModal(interaction, fields) {
  const event = await createEventFromFields(interaction, {
    creatorId: interaction.user.id,
    title: 'Raid Avalon Full',
    description: raidObservationText(fields.observation || raidDefaultObservation),
    location: fields.location,
    scheduledTime: fields.scheduledTime,
    tankSlots: raidAvalonSlots.tank,
    healerSlots: raidAvalonSlots.healer,
    supportSlots: raidAvalonSlots.support,
    dpsSlots: raidAvalonSlots.dps,
    contentType: 'raid_avalon',
    postChannelId: ids.channels.participate
  });
  repo.createRaidAvalonEventMeta({
    eventId: event.id,
    dungeonTier: fields.dungeonTier,
    buildTier: fields.buildTier
  });
  await refreshEventMessage(interaction.client, event.id);
  return repo.getEvent(event.id);
}

async function createRaidDragonFromModal(interaction, fields) {
  const event = await createEventFromFields(interaction, {
    creatorId: interaction.user.id,
    title: raidProfiles.raid_dragon.title,
    description: raidObservationText(fields.observation || raidDefaultObservation),
    location: fields.location,
    scheduledTime: fields.scheduledTime,
    tankSlots: raidDragonSlots.tank,
    healerSlots: raidDragonSlots.healer,
    supportSlots: raidDragonSlots.support,
    dpsSlots: raidDragonSlots.dps,
    contentType: 'raid_dragon',
    postChannelId: ids.channels.participate
  });
  repo.createRaidAvalonEventMeta({
    eventId: event.id,
    dungeonTier: fields.dungeonTier,
    buildTier: fields.buildTier
  });
  await refreshEventMessage(interaction.client, event.id);
  return repo.getEvent(event.id);
}

async function createWorldBossFromModal(interaction, fields) {
  const pingRoles = [ids.roles.core, ids.roles.member].filter(Boolean);
  const eventDate = String(fields.eventDate || '').trim();
  if (!/^\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?$/.test(eventDate)) {
    throw new Error('Informe a data no formato DD/MM/AAAA. Ex: 20/07/2026.');
  }
  const event = await createEventFromFields(interaction, {
    creatorId: interaction.user.id,
    title: 'Farm World Boss',
    description: `BUILDS > https://discord.com/channels/${ids.guildId}/${ids.channels.worldBossBuilds}`,
    location: 'DK / Vulcano',
    scheduledTime: `${eventDate} 00:00 as 02:00 UTC`,
    tankSlots: 1,
    healerSlots: 1,
    supportSlots: 3,
    dpsSlots: 5,
    contentType: 'world_boss',
    postChannelId: ids.channels.worldBoss,
    messageContent: pingRoles.map((roleId) => `<@&${roleId}>`).join(' '),
    allowedMentions: { parse: [], roles: pingRoles }
  });
  repo.createWorldBossEventMeta({
    eventId: event.id,
    massing: ''
  });
  await refreshEventMessage(interaction.client, event.id);
  return repo.getEvent(event.id);
}

async function configureSpecialWeaponMode(eventId, contentType, mode) {
  const normalizedMode = weaponSelectionModes.normalize(mode);
  if (normalizedMode === 'predefined') return repo.getEvent(eventId);
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento não encontrado para configurar as armas.');
  const slots = eventRoles.flatMap((role) => Array.from(
    { length: Number(event[roleConfigs[role].slots] || 0) },
    (_, index) => ({ role, index: index + 1, value: '', buildKey: null, buildUrl: null })
  ));
  const buildsChannelId = contentType === 'world_boss'
    ? ids.channels.worldBossBuilds
    : contentType === 'raid_dragon'
      ? ids.channels.raidDragonBuilds
      : ids.channels.outpostBuilds;
  repo.createVisualEventBuildMeta({
    eventId,
    buildsChannelId,
    buildsChannelName: null,
    slots,
    compositionMode: normalizedMode,
    rulesSnapshot: await compositionRules.loadSnapshot(contentType),
    sheetUrl: compositionRules.COMPOSITION_SHEET_URL
  });
  return repo.getEvent(eventId);
}

async function createEventFromFields(interaction, fields) {
  const event = repo.createEvent({
    creatorId: fields.creatorId || interaction.user.id,
    title: fields.title,
    description: fields.description,
    location: fields.location,
    scheduledTime: fields.scheduledTime,
    tankSlots: fields.tankSlots,
    healerSlots: fields.healerSlots,
    supportSlots: fields.supportSlots,
    dpsSlots: fields.dpsSlots,
    contentType: fields.contentType || 'other',
    audience: fields.audience || 'public'
  });

  const channelId = eventPostChannelId(fields);
  const channel = await interaction.client.channels.fetch(channelId);
  if (isPingContentChannel(channel.id)) {
    await syncPingContentIndex(interaction.client, channel).catch((error) => {
      console.error('[EVENTO] Falha ao preparar o indice do ping-content:', error);
    });
  }
  const defaultMentionRoles = [ids.roles.member].filter(Boolean);
  const messageContent = fields.messageContent
    ?? (defaultMentionRoles.map((roleId) => `<@&${roleId}>`).join(' ') || undefined);
  const allowedMentions = fields.allowedMentions
    ?? (defaultMentionRoles.length ? { parse: [], roles: defaultMentionRoles } : { parse: [] });
  const message = await channel.send({
    content: messageContent,
    ...eventPublicationPayload(event, [], channel.id, interaction.client),
    allowedMentions
  });
  repo.updateEvent(event.id, { message_id: message.id, message_channel_id: channel.id });
  if (isPingContentChannel(channel.id)) {
    await syncPingContentIndex(interaction.client, channel).catch((error) => {
      console.error('[EVENTO] Falha ao atualizar o indice do ping-content:', error);
    });
  }
  if (interaction.guild) {
    await ensureEventTempRole(interaction.guild, event).catch(() => null);
  }

  audit.createAuditLog({
    type: 'event_created',
    actorId: interaction.user.id,
    targetId: String(event.id),
    afterValue: event.event_code,
    reason: 'Evento criado'
  });

  return event;
}

async function refreshEventMessage(client, eventId) {
  const event = repo.getEvent(eventId);
  if (!event) return null;
  const participants = repo.listParticipants(eventId);
  const publication = await findStoredEventPublication(client, event);
  const channel = publication?.channel || null;
  const message = publication?.message || null;
  if (message) {
    const payload = eventPublicationPayload(event, participants, channel.id, client);
    await message.edit(payload);
    if (String(event.message_id || '') !== String(message.id) || String(event.message_channel_id || '') !== String(channel.id)) {
      repo.updateEvent(event.id, { message_id: message.id, message_channel_id: channel.id });
    }
    if (isPingContentChannel(channel.id)) {
      await syncPingContentIndex(client, channel).catch((error) => {
        console.error('[EVENTO] Falha ao atualizar o indice do ping-content:', error);
      });
    }
    return message;
  }

  if (!['created', 'running'].includes(event.status)) return null;
  const replacementChannel = await fetchEventRepairChannel(client, event);
  if (!replacementChannel || typeof replacementChannel.send !== 'function') return null;
  const payload = eventPublicationPayload(event, participants, replacementChannel.id, client);
  const replacement = await replacementChannel.send(payload).catch(() => null);
  if (!replacement) return null;
  repo.updateEvent(event.id, { message_id: replacement.id, message_channel_id: replacementChannel.id });
  if (isPingContentChannel(replacementChannel.id)) {
    await syncPingContentIndex(client, replacementChannel).catch((error) => {
      console.error('[EVENTO] Falha ao atualizar o indice do ping-content:', error);
    });
  }
  return replacement;
}

async function syncEventPublication(client, eventId, { channelId, content, allowedMentions } = {}) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  if (!['created', 'running'].includes(event.status)) throw new Error('Evento nao pode ser publicado neste status.');

  const targetChannelId = channelId || event.message_channel_id || eventPostChannelId(event);
  const participants = repo.listParticipants(eventId);
  const payload = {
    content: content || null,
    ...eventPublicationPayload(event, participants, targetChannelId, client),
    allowedMentions: allowedMentions ? normalizeAllowedMentions(allowedMentions) : undefined
  };
  const currentChannel = event.message_id ? await fetchEventMessageChannel(client, event) : null;
  const currentMessage = event.message_id
    ? await currentChannel?.messages?.fetch(event.message_id).catch(() => null)
    : null;
  if (currentMessage && currentChannel?.id === targetChannelId) {
    await currentMessage.edit(payload);
    if (isPingContentChannel(targetChannelId)) {
      await syncPingContentIndex(client, currentChannel).catch((error) => {
        console.error('[EVENTO] Falha ao atualizar o indice do ping-content:', error);
      });
    }
    return currentMessage;
  }

  const targetChannel = await client.channels.fetch(targetChannelId).catch(() => null);
  if (!targetChannel || typeof targetChannel.send !== 'function') {
    throw new Error('Canal de publicacao do evento nao encontrado.');
  }
  if (isPingContentChannel(targetChannel.id)) {
    await syncPingContentIndex(client, targetChannel).catch((error) => {
      console.error('[EVENTO] Falha ao preparar o indice do ping-content:', error);
    });
  }
  const existingTargetMessage = await findEventPublication(targetChannel, eventId);
  if (existingTargetMessage) {
    await existingTargetMessage.edit(payload);
    await currentMessage?.delete().catch(() => {});
    repo.updateEvent(eventId, { message_id: existingTargetMessage.id, message_channel_id: targetChannel.id });
    await syncAffectedPingContentIndexes(client, currentChannel, targetChannel);
    return existingTargetMessage;
  }

  await currentMessage?.delete().catch(() => {});
  const message = await targetChannel.send(payload);
  repo.updateEvent(eventId, { message_id: message.id, message_channel_id: targetChannel.id });
  await syncAffectedPingContentIndexes(client, currentChannel, targetChannel);
  return message;
}

function eventPublicationPayload(event, participants, channelId = null, client = null) {
  return {
    embeds: [eventEmbed(event, participants, { channelId, client })],
    components: eventComponents(event)
  };
}

function isPingContentChannel(channelId) {
  return Boolean(ids.channels.pingContent)
    && String(channelId || '') === String(ids.channels.pingContent);
}

function pingContentIndexPayload(events = repo.listInteractiveEvents()) {
  const published = events
    .filter((event) => (
      event.message_id
      && isPingContentChannel(event.message_channel_id)
      && ['created', 'running'].includes(event.status)
    ))
    .sort(comparePingContentEvents);
  const lines = [
    'Escolha um content abaixo para consultar a composicao ou participar.',
    ''
  ];

  if (!published.length) {
    lines.push('*Nenhum content ativo neste momento.*');
  } else {
    for (const [index, event] of published.entries()) {
      const participants = repo.listParticipants(event.id);
      const active = participants.filter((participant) => !participant.is_spectator && !participant.is_paused);
      const totalSlots = eventRoles.reduce((total, role) => total + Number(event[roleConfigs[role].slots] || 0), 0);
      const status = pingContentIndexStatus(event, active.length, totalSlots);
      const url = `https://discord.com/channels/${ids.guildId}/${event.message_channel_id}/${event.message_id}`;
      const entry = [
        `### ${index + 1}. ${eventEmoji(event)} ${formatEventTitle(event.title)}`,
        `\u{1F552} **${event.scheduled_time || 'Horario nao informado'}**  \u2022  \u{1F465} **${active.length}/${totalSlots}**  \u2022  ${status}`,
        `[\u{1F517} Ir para o evento](${url})`
      ];
      const candidate = [...lines, ...entry, ''].join('\n');
      if (candidate.length > 3900) {
        lines.push(`*... e mais ${published.length - index} content(s) ativo(s).*`);
        break;
      }
      lines.push(...entry, '');
    }
  }

  return {
    embeds: [new EmbedBuilder()
      .setTitle('\u{1F4CB} CONTENTS ATIVOS')
      .setDescription(lines.join('\n').trim())
      .setColor(0x3182ce)
      .setFooter({ text: 'Lista atualizada automaticamente pelo bot' })
      .setTimestamp(new Date())],
    allowedMentions: { parse: [] }
  };
}

function comparePingContentEvents(left, right) {
  const leftTime = parseAlbionEventTime(left.scheduled_time)?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightTime = parseAlbionEventTime(right.scheduled_time)?.getTime() ?? Number.POSITIVE_INFINITY;
  return leftTime - rightTime || Number(left.id) - Number(right.id);
}

function pingContentIndexStatus(event, activeCount, totalSlots) {
  if (event.status === 'running') return '\u{1F7E2} Em andamento';
  if (totalSlots > 0 && activeCount >= totalSlots) return '\u{1F534} Lotado';
  if (totalSlots > 0 && activeCount / totalSlots >= 0.8) return '\u{1F7E0} Quase completo';
  return '\u{1F7E1} Aguardando';
}

async function syncPingContentIndex(client, providedChannel = null) {
  if (!pingContentAutoIndexEnabled) return null;
  if (!ids.channels.pingContent) return null;
  let channel = providedChannel && isPingContentChannel(providedChannel.id) ? providedChannel : null;
  if (!channel && typeof client?.channels?.fetch === 'function') {
    channel = await client.channels.fetch(ids.channels.pingContent).catch(() => null);
  }
  if (!channel || typeof channel.send !== 'function') return null;

  const stored = repo.getPersistentMessage(pingContentIndexMessageKey);
  let existing = null;
  if (
    stored?.channel_id
    && String(stored.channel_id) === String(channel.id)
    && typeof channel.messages?.fetch === 'function'
  ) {
    existing = await channel.messages.fetch(stored.message_id).catch(() => null);
  }
  const payload = pingContentIndexPayload();
  const edited = existing ? await existing.edit(payload) : null;
  const message = existing ? (edited || existing) : await channel.send(payload);
  if (!message?.id) return null;
  repo.setPersistentMessage({
    key: pingContentIndexMessageKey,
    channelId: channel.id,
    messageId: message.id
  });
  if (!message.pinned && typeof message.pin === 'function') {
    await message.pin('Indice automatico dos contents ativos').catch(() => {});
  }
  return message;
}

async function syncAffectedPingContentIndexes(client, ...channels) {
  if (!channels.some((channel) => isPingContentChannel(channel?.id))) return null;
  const pingChannel = channels.find((channel) => isPingContentChannel(channel?.id)) || null;
  return syncPingContentIndex(client, pingChannel).catch((error) => {
    console.error('[EVENTO] Falha ao atualizar o indice do ping-content:', error);
    return null;
  });
}

function eventDetailsPayload(eventId, options = {}) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  const participants = repo.listParticipants(eventId);
  return {
    embeds: [eventEmbed(event, participants, { client: options.client })],
    components: eventComponents(event, { viewerCanManage: options.viewerCanManage })
  };
}

async function findEventPublication(channel, eventId) {
  if (typeof channel?.messages?.fetch !== 'function') return null;
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!recent || typeof recent.values !== 'function') return null;
  const eventIdText = String(eventId);
  for (const message of recent.values()) {
    const components = message.components || message.payload?.components;
    const matches = components?.some((row) => (row.components || row.data?.components)?.some((component) => (
      String(component.customId || component.data?.custom_id || '').split(':').includes(eventIdText)
    )));
    if (matches) return message;
  }
  return null;
}

async function updateCreatedEvent({ client, guild, eventId, actorId, patch, publication }) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  if (event.status !== 'created') throw new Error('Somente eventos ainda nao iniciados podem ser editados.');

  await deleteWarningMessage(client, event).catch(() => {});
  await removeWarningRole(guild, event).catch(() => {});
  const updated = repo.updateEvent(eventId, {
    ...patch,
    warning_role_id: null,
    warning_message_id: null,
    warning_sent: 0,
    reminder_10_sent: 0,
    reminder_start_sent: 0,
    temp_role_delete_after: null
  });
  if (
    Object.prototype.hasOwnProperty.call(patch, 'scheduled_time')
    && String(patch.scheduled_time || '') !== String(event.scheduled_time || '')
  ) {
    repo.clearEventReminderDispatches(eventId);
  }
  await syncEventPublication(client, eventId, publication);
  audit.createAuditLog({
    type: 'event_edited',
    actorId,
    targetId: String(eventId),
    beforeValue: JSON.stringify({
      title: event.title,
      description: event.description,
      location: event.location,
      scheduledTime: event.scheduled_time,
      contentType: event.content_type,
      audience: event.audience
    }),
    afterValue: JSON.stringify({
      title: updated.title,
      description: updated.description,
      location: updated.location,
      scheduledTime: updated.scheduled_time,
      contentType: updated.content_type,
      audience: updated.audience
    }),
    reason: 'Evento editado'
  });
  return repo.getEvent(eventId);
}

function validateEventSlotPatch(eventId, patch) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  if (repo.getRaidAvalonEventMeta(eventId) || repo.getWorldBossEventMeta(eventId)) {
    throw new Error('A composicao deste tipo de evento e fixa. Edite somente as informacoes.');
  }

  const slotColumns = {
    tank: 'tank_slots',
    healer: 'healer_slots',
    support: 'support_slots',
    dps: 'dps_slots'
  };
  const limits = {};
  for (const [role, column] of Object.entries(slotColumns)) {
    const value = Number(patch[column]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`A quantidade de ${role} deve ser um numero inteiro maior ou igual a zero.`);
    }
    limits[role] = value;
  }
  const total = Object.values(limits).reduce((sum, value) => sum + value, 0);
  const maxSlots = repo.getCustomEventMeta(eventId) ? 40 : 20;
  if (total < 1) throw new Error('O evento precisa ter pelo menos uma vaga.');
  if (total > maxSlots) throw new Error(`O evento aceita no maximo ${maxSlots} vagas.`);

  const participants = repo.listParticipants(eventId);
  for (const role of eventRoles) {
    const assigned = participants.filter((participant) => !participant.is_spectator && participant.role === role);
    const highestCustomSlot = assigned.reduce(
      (highest, participant) => Math.max(highest, Number(participant.custom_slot_index || 0)),
      0
    );
    if (assigned.length > limits[role] || highestCustomSlot > limits[role]) {
      throw new Error(`Nao e possivel reduzir ${role} para ${limits[role]}: existem participantes nessas vagas.`);
    }
  }
  return limits;
}

async function updateCreatedEventSlots({ client, guild, eventId, actorId, patch }) {
  const limits = validateEventSlotPatch(eventId, patch);
  const customMeta = repo.getCustomEventMeta(eventId);
  let slots = null;
  if (customMeta) {
    const currentLabels = new Map(repo.listCustomEventSlots(eventId).map((slot) => [
      `${slot.role}:${slot.slot_index}`,
      slot.slot_label
    ]));
    slots = eventRoles.flatMap((role) => Array.from({ length: limits[role] }, (_, index) => ({
      role,
      index: index + 1,
      value: currentLabels.get(`${role}:${index + 1}`) || ''
    })));
  }

  const updated = await updateCreatedEvent({ client, guild, eventId, actorId, patch });
  if (customMeta) {
    repo.createCustomEventMeta({
      eventId,
      eventDay: customMeta.event_day,
      timeRange: customMeta.time_range,
      lootRules: customMeta.loot_rules,
      consumables: customMeta.consumables,
      mountRequirement: customMeta.mount_requirement,
      dpsPolicy: customMeta.dps_policy,
      slots
    });
    await refreshEventMessage(client, eventId);
  }
  return updated;
}

async function updateCustomEventDetails({ client, guild, eventId, actorId, details }) {
  const event = repo.getEvent(eventId);
  const customMeta = repo.getCustomEventMeta(eventId);
  if (!event || !customMeta) throw new Error('Este nao e um CTA.');
  if (event.status !== 'created') throw new Error('Somente eventos ainda nao iniciados podem ser editados.');
  const legacySchedule = details.eventDay || details.timeRange
    ? `${String(details.eventDay || '').trim()} ${String(details.timeRange || '').trim()}`.trim()
    : null;
  const scheduledTime = legacySchedule || String(details.scheduledTime || event.scheduled_time || '').trim();
  if (!scheduledTime) throw new Error('Informe a data e hora do CTA.');
  const [eventDay, ...timeParts] = scheduledTime.split(/\s+/);
  const timeRange = timeParts.join(' ');
  repo.createCustomEventMeta({
    eventId,
    eventDay,
    timeRange,
    lootRules: String(details.lootRules || '').trim(),
    consumables: String(details.consumables || '').trim(),
    mountRequirement: String(details.mountRequirement || '').trim(),
    dpsPolicy: customMeta.dps_policy,
    slots: repo.listCustomEventSlots(eventId).map((slot) => ({
      role: slot.role,
      index: slot.slot_index,
      value: slot.slot_label
    }))
  });
  return updateCreatedEvent({
    client,
    guild,
    eventId,
    actorId,
    patch: { scheduled_time: scheduledTime }
  });
}

async function updateCustomEventSlotLabels({ client, eventId, actorId, labelsByRole }) {
  const event = repo.getEvent(eventId);
  const customMeta = repo.getCustomEventMeta(eventId);
  if (!event || !customMeta) throw new Error('Este nao e um CTA.');
  if (event.status !== 'created') throw new Error('Somente eventos ainda nao iniciados podem ser editados.');
  const slots = [];
  for (const role of eventRoles) {
    const count = Number(event[roleConfigs[role].slots] || 0);
    const labels = Array.isArray(labelsByRole[role]) ? labelsByRole[role] : [];
    if (labels.length !== count) {
      throw new Error(`Informe exatamente ${count} nome(s) para ${role}, separados por |.`);
    }
    labels.forEach((value, index) => slots.push({ role, index: index + 1, value: String(value).trim() }));
  }
  repo.createCustomEventMeta({
    eventId,
    eventDay: customMeta.event_day,
    timeRange: customMeta.time_range,
    lootRules: customMeta.loot_rules,
    consumables: customMeta.consumables,
    mountRequirement: customMeta.mount_requirement,
    dpsPolicy: customMeta.dps_policy,
    slots
  });
  await refreshEventMessage(client, eventId);
  audit.createAuditLog({
    type: 'event_edited',
    actorId,
    targetId: String(eventId),
    afterValue: JSON.stringify(labelsByRole),
    reason: 'Nomes das vagas do evento editados'
  });
  return repo.getEvent(eventId);
}

function eventPostChannelId(fields = {}) {
  if (fields.postChannelId) return fields.postChannelId;
  return isRaidEventFields(fields) ? ids.channels.participate : ids.channels.pingContent || ids.channels.participate;
}

function isRaidEventFields(fields = {}) {
  const text = `${fields.title || ''} ${fields.description || ''}`.toLowerCase();
  return /\braid\b/.test(text);
}

async function repairMisroutedEventPublications(client) {
  const repaired = [];
  for (const event of repo.listInteractiveEvents()) {
    if (event.message_channel_id !== ids.channels.participate) continue;
    if (repo.getRaidAvalonEventMeta(event.id) || isRaidEventFields(event)) continue;
    await syncEventPublication(client, event.id, { channelId: ids.channels.pingContent });
    repaired.push(event.id);
  }
  return repaired;
}

async function fetchEventMessageChannel(client, event) {
  const channelIds = [event.message_channel_id, ids.channels.worldBoss, ids.channels.participate, ids.channels.pingContent].filter(Boolean);
  for (const channelId of [...new Set(channelIds)]) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) return channel;
  }
  return null;
}

async function findStoredEventPublication(client, event) {
  if (!client || !event) return null;
  const channelIds = [
    event.message_channel_id,
    ids.channels.worldBoss,
    ids.channels.participate,
    ids.channels.pingContent
  ].filter(Boolean);
  const channels = [];
  for (const channelId of [...new Set(channelIds.map(String))]) {
    const channel = await client.channels?.fetch?.(channelId).catch(() => null);
    if (!channel) continue;
    channels.push(channel);
    if (event.message_id && typeof channel.messages?.fetch === 'function') {
      const message = await channel.messages.fetch(event.message_id).catch(() => null);
      if (message) return { channel, message };
    }
  }
  for (const channel of channels) {
    const message = await findEventPublication(channel, event.id).catch(() => null);
    if (message) return { channel, message };
  }
  return null;
}

async function fetchEventRepairChannel(client, event) {
  const channelId = event.message_channel_id
    || (repo.getWorldBossEventMeta(event.id) ? ids.channels.worldBoss : eventPostChannelId(event));
  if (!channelId || typeof client?.channels?.fetch !== 'function') return null;
  return client.channels.fetch(channelId).catch(() => null);
}
async function refreshRunningEventMessages(client) {
  // Open signups also need refreshing so a restart repairs missing controls.
  const events = repo.listInteractiveEvents();
  for (const event of events) {
    await refreshEventMessage(client, event.id).catch((error) => console.error(`Falha ao atualizar ${event.event_code}:`, error));
  }
}

async function joinEvent(interaction, eventId, role) {
  const event = repo.getEvent(eventId);
  if (!event || !['created', 'running'].includes(event.status)) throw new Error('Evento nao esta aberto.');
  await assertEventAudience(interaction, event);
  if (!canJoinEventRole(event, interaction.user.id, role)) {
    throw new Error(`Nao ha vaga livre para ${roleButtonLabel(role)} neste evento.`);
  }
  const previous = repo.getParticipant({ eventId, discordId: interaction.user.id });
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role, isSpectator: 0 });
  await addEventRoleToMember(interaction.guild, event, interaction.user.id).catch(() => {});
  let voiceResult = null;
  if (event.status === 'running') {
    voiceResult = await ensureParticipantVoiceSession(interaction, event);
  }
  audit.createAuditLog({
    type: previous?.is_spectator ? 'event_spectator_promoted' : 'event_joined',
    actorId: interaction.user.id,
    targetId: String(eventId),
    beforeValue: previous ? JSON.stringify({ role: previous.role, isSpectator: previous.is_spectator }) : null,
    afterValue: role,
    metadata: { voiceResult }
  });
  await refreshEventMessage(interaction.client, eventId);
}

function customEventSlotOptions(eventId, role, discordId) {
  const event = repo.getEvent(eventId);
  const configured = repo.getCustomEventMeta(eventId) || repo.getVisualEventBuildMeta(eventId);
  if (!event || !configured || !eventRoles.includes(role)) return [];
  if (role === 'dps' && repo.listCustomEventDpsWeapons(eventId).length > 0) {
    return customEventDpsWeaponOptions(eventId, discordId);
  }
  const participants = repo.listParticipants(eventId);
  const occupied = new Map(
    participants
      .filter((participant) => (
        !participant.is_spectator
        && !participant.is_paused
        && participant.role === role
        && participant.custom_slot_index != null
      ))
      .map((participant) => [Number(participant.custom_slot_index), participant.discord_id])
  );
  const slots = repo.listCustomEventSlots(eventId).filter((slot) => slot.role === role);
  return slots
    .filter((slot) => !occupied.has(slot.slot_index) || occupied.get(slot.slot_index) === discordId)
    .map((slot) => {
      const baseLabel = `${roleButtonLabel(role)} ${slot.slot_index}`;
      return {
        label: String(slot.slot_label ? `${baseLabel} - ${slot.slot_label}` : baseLabel).slice(0, 100),
        value: `${role}|${slot.slot_index}`,
        description: occupied.get(slot.slot_index) === discordId ? 'Sua vaga atual' : 'Vaga livre',
        ...(slot.emoji_id ? { emoji: { id: slot.emoji_id, name: slot.emoji_name || 'build' } } : {})
      };
    });
}

function customEventDpsWeaponOptions(eventId, discordId) {
  const event = repo.getEvent(eventId);
  const pool = repo.listCustomEventDpsWeapons(eventId);
  if (!event || pool.length === 0) return [];
  const active = repo.listParticipants(eventId).filter((participant) => (
    participant.role === 'dps' && !participant.is_spectator && !participant.is_paused
  ));
  const others = active.filter((participant) => participant.discord_id !== discordId);
  if (others.length >= Number(event.dps_slots || 0)) return [];
  const current = active.find((participant) => participant.discord_id === discordId);
  const used = (key) => others.filter((participant) => participant.custom_weapon_key === key).length;
  const missingMandatory = pool.filter((weapon) => weapon.mandatory && used(weapon.weapon_key) === 0).length;
  const remainingAfter = Number(event.dps_slots || 0) - others.length - 1;
  return pool.filter((weapon) => (
    used(weapon.weapon_key) < Number(weapon.max_quantity)
    && (weapon.mandatory || remainingAfter >= missingMandatory)
  )).map((weapon) => {
    const remaining = Number(weapon.max_quantity) - used(weapon.weapon_key);
    const isCurrent = current?.custom_weapon_key === weapon.weapon_key;
    return {
      label: String(`${weapon.weapon_label} — ${remaining}/${weapon.max_quantity} disponível`).slice(0, 100),
      value: `dps_weapon|${weapon.weapon_key}`,
      description: isCurrent ? 'Sua arma atual' : weapon.mandatory ? 'Obrigatória na composição' : 'Arma permitida',
      ...(weapon.emoji_id ? { emoji: { id: weapon.emoji_id, name: weapon.emoji_name || 'arma' } } : {})
    };
  });
}

async function joinCustomEventDpsWeapon(interaction, eventId, weaponKey) {
  const event = repo.getEvent(eventId);
  if (!event || !['created', 'running'].includes(event.status)) throw new Error('Evento nao esta aberto.');
  await assertEventAudience(interaction, event);
  const previous = repo.getParticipant({ eventId, discordId: interaction.user.id });
  const result = repo.assignCustomDpsWeapon({ eventId, discordId: interaction.user.id, weaponKey });
  const messages = {
    invalid: 'Essa arma não faz parte do cardápio deste evento.',
    full: 'Não há mais vagas de DPS neste evento.',
    stock: 'A última vaga dessa arma acabou de ser ocupada. Escolha outra.',
    mandatory: 'As vagas restantes estão reservadas para as armas obrigatórias da planilha.'
  };
  if (!result.assigned) throw new Error(messages[result.reason] || 'Não foi possível reservar essa arma.');
  await addEventRoleToMember(interaction.guild, event, interaction.user.id).catch(() => {});
  let voiceResult = null;
  if (event.status === 'running') voiceResult = await ensureParticipantVoiceSession(interaction, event);
  audit.createAuditLog({
    type: previous?.is_spectator ? 'event_spectator_promoted' : 'event_joined',
    actorId: interaction.user.id,
    targetId: String(eventId),
    beforeValue: previous ? JSON.stringify({ role: previous.role, weaponKey: previous.custom_weapon_key }) : null,
    afterValue: JSON.stringify({ role: 'dps', weaponKey }),
    metadata: { voiceResult }
  });
  await refreshEventMessage(interaction.client, eventId);
  return result.weapon;
}

async function joinCustomEventSlot(interaction, eventId, role, slotIndex) {
  const event = repo.getEvent(eventId);
  if (!event || !['created', 'running'].includes(event.status)) throw new Error('Evento nao esta aberto.');
  await assertEventAudience(interaction, event);
  if (!repo.getCustomEventMeta(eventId) && !repo.getVisualEventBuildMeta(eventId)) {
    throw new Error('Esse evento nao possui uma composicao visual configurada.');
  }
  const slot = repo.listCustomEventSlots(eventId).find((candidate) => (
    candidate.role === role && candidate.slot_index === Number(slotIndex)
  ));
  if (!slot) throw new Error('Essa vaga nao existe neste evento.');
  const occupied = repo.listParticipants(eventId).find((participant) => (
    !participant.is_spectator
    && !participant.is_paused
    && participant.role === role
    && Number(participant.custom_slot_index) === Number(slotIndex)
    && participant.discord_id !== interaction.user.id
  ));
  if (occupied) throw new Error('Essa vaga acabou de ser ocupada. Escolha outra.');

  const previous = repo.getParticipant({ eventId, discordId: interaction.user.id });
  try {
    repo.upsertParticipant({
      eventId,
      discordId: interaction.user.id,
      role,
      customSlotIndex: Number(slotIndex),
      isSpectator: 0
    });
  } catch (error) {
    if (String(error.code || '').startsWith('SQLITE_CONSTRAINT')) {
      throw new Error('Essa vaga acabou de ser ocupada. Escolha outra.');
    }
    throw error;
  }
  await addEventRoleToMember(interaction.guild, event, interaction.user.id).catch(() => {});
  let voiceResult = null;
  if (event.status === 'running') voiceResult = await ensureParticipantVoiceSession(interaction, event);
  audit.createAuditLog({
    type: previous?.is_spectator ? 'event_spectator_promoted' : 'event_joined',
    actorId: interaction.user.id,
    targetId: String(eventId),
    beforeValue: previous ? JSON.stringify({
      role: previous.role,
      slotIndex: previous.custom_slot_index,
      isSpectator: previous.is_spectator
    }) : null,
    afterValue: JSON.stringify({ role, slotIndex: Number(slotIndex) }),
    metadata: { voiceResult }
  });
  await refreshEventMessage(interaction.client, eventId);
  return slot;
}

function visualWeaponFamilies(eventId, role, client = null, guild = null) {
  const meta = repo.getVisualEventBuildMeta(eventId);
  if (!meta || !weaponSelectionModes.requiresWeapon(meta.composition_mode)) return [];
  const catalog = sponsoredCtaBuilds.attachAvailableEmojis(customEventWeaponCatalog.mergeCatalog([]), client, guild);
  return customEventWeaponCatalog.familyOptions(catalog, role);
}

function visualWeaponsForFamily(eventId, role, familyKey, client = null, guild = null) {
  const meta = repo.getVisualEventBuildMeta(eventId);
  if (!meta || !weaponSelectionModes.requiresWeapon(meta.composition_mode)) return [];
  const snapshot = compositionRules.parseSnapshot(meta.rules_json, repo.getEvent(eventId)?.content_type);
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator && !participant.is_paused);
  const slots = participants.map((participant) => ({ role: participant.role, buildKey: participant.custom_weapon_key }));
  const catalog = sponsoredCtaBuilds.attachAvailableEmojis(customEventWeaponCatalog.mergeCatalog([]), client, guild);
  const respectsSheet = weaponSelectionModes.respectsSheet(meta.composition_mode);
  return customEventWeaponCatalog.weaponsForFamily(catalog, role, familyKey)
    .filter((build) => !respectsSheet || compositionRules.canAdd(slots, snapshot, build.key, role))
    .map((build) => ({
      label: build.name.slice(0, 100),
      value: build.key,
      description: (respectsSheet
        ? compositionRules.ruleLabel(compositionRules.ruleFor(snapshot, build.key))
        : 'Sem limite por arma').slice(0, 100),
      emoji: build.emojiId
        ? { id: build.emojiId, name: build.emojiName || 'arma' }
        : { name: build.familySymbol || '⚔️' }
    }));
}

async function joinVisualEventWeapon(interaction, eventId, role, weaponKey) {
  const event = repo.getEvent(eventId);
  const meta = repo.getVisualEventBuildMeta(eventId);
  if (!event || !['created', 'running'].includes(event.status)) throw new Error('Evento nao esta aberto.');
  if (!meta || !weaponSelectionModes.requiresWeapon(meta.composition_mode)) throw new Error('Este evento não usa declaração livre de armas.');
  await assertEventAudience(interaction, event);
  const build = customEventWeaponCatalog.mergeCatalog([]).find((candidate) => (
    candidate.key === weaponKey && customEventWeaponCatalog.allowedForRole(candidate, role)
  ));
  if (!build) throw new Error('Essa arma não está disponível para esta função.');
  const snapshot = compositionRules.parseSnapshot(meta.rules_json, event.content_type);
  const respectsSheet = weaponSelectionModes.respectsSheet(meta.composition_mode);
  const constraint = respectsSheet ? compositionRules.ruleFor(snapshot, weaponKey) : { max: null };
  const requiredKeys = (respectsSheet ? Object.entries(snapshot.weapons || {}) : [])
    .filter(([, rule]) => rule.role === role && Number(rule.min || 0) > 0)
    .map(([key]) => key);
  const result = repo.assignVisualCompositionWeapon({
    eventId,
    discordId: interaction.user.id,
    role,
    weaponKey,
    maxQuantity: constraint.max,
    requiredKeys
  });
  const messages = {
    invalid: 'Essa arma não faz parte deste evento.',
    full: `Não há mais vagas de ${roleConfigs[role]?.label || role}.`,
    stock: `${build.name} atingiu o limite definido na planilha.`,
    mandatory: 'As vagas restantes estão reservadas para armas obrigatórias da planilha.'
  };
  if (!result.assigned) throw new Error(messages[result.reason] || 'Não foi possível reservar essa arma.');
  await addEventRoleToMember(interaction.guild, event, interaction.user.id).catch(() => {});
  await refreshEventMessage(interaction.client, eventId);
  return build;
}

function canJoinEventRole(event, discordId, role) {
  if (!eventRoles.includes(role)) return false;
  const slots = Number(event[roleConfigs[role].slots] || 0);
  const participants = repo.listParticipants(event.id);
  const current = participants.find((participant) => (
    participant.discord_id === discordId && !participant.is_spectator && !participant.is_paused
  ));
  if (current?.role === role) return true;
  const used = participants.filter((participant) => (
    participant.role === role && !participant.is_spectator && !participant.is_paused && participant.discord_id !== discordId
  )).length;
  return slots > used;
}

function worldBossSlotOptions(eventId, discordId) {
  if (!repo.getWorldBossEventMeta(eventId)) return [];
  const occupied = new Map(
    repo.listWorldBossAssignments(eventId).map((assignment) => [assignment.slot_key, assignment.discord_id])
  );
  return worldBossSlots
    .filter((slot) => !occupied.has(slot.key) || occupied.get(slot.key) === discordId)
    .map((slot) => ({
      label: slot.label,
      value: slot.key,
      description: occupied.get(slot.key) === discordId ? 'Sua vaga atual' : 'Vaga livre'
    }));
}

function worldBossMemberSlotOptions(eventId, discordId) {
  const assigned = new Set(
    repo.listWorldBossAssignments(eventId)
      .filter((assignment) => assignment.discord_id === discordId)
      .map((assignment) => assignment.slot_key)
  );
  return worldBossSlots
    .filter((slot) => assigned.has(slot.key))
    .map((slot) => ({ label: slot.label, value: slot.key, description: 'Liberar esta vaga' }));
}

function worldBossSlot(slotKey) {
  return worldBossSlots.find((candidate) => candidate.key === slotKey) || null;
}

async function joinWorldBossSlot(interaction, eventId, slotKey) {
  const event = repo.getEvent(eventId);
  if (!event || !['created', 'running'].includes(event.status)) throw new Error('Evento nao esta aberto.');
  if (!repo.getWorldBossEventMeta(eventId)) throw new Error('Esse evento nao e um World Boss.');
  const slot = worldBossSlot(slotKey);
  if (!slot) throw new Error('Vaga de World Boss invalida.');

  const ownAssignments = repo.listWorldBossAssignments(eventId)
    .filter((assignment) => assignment.discord_id === interaction.user.id);
  const ownSlots = ownAssignments.map((assignment) => worldBossSlot(assignment.slot_key)).filter(Boolean);
  const removeSlotKeys = worldBossReplacementSlots(slot, ownSlots);
  const result = repo.assignWorldBossSlot({
    eventId,
    slotKey,
    discordId: interaction.user.id,
    removeSlotKeys
  });
  if (!result.assigned) {
    throw new Error(`A vaga ${slot.label} ja esta ocupada por <@${result.occupied.discord_id}>.`);
  }

  const previous = repo.getParticipant({ eventId, discordId: interaction.user.id });
  const participantRole = worldBossParticipantRole(eventId, interaction.user.id);
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role: participantRole, isSpectator: 0 });
  await addEventRoleToMember(interaction.guild, event, interaction.user.id).catch(() => {});
  let voiceResult = null;
  if (event.status === 'running') voiceResult = await ensureParticipantVoiceSession(interaction, event);
  audit.createAuditLog({
    type: 'world_boss_slot_joined',
    actorId: interaction.user.id,
    targetId: String(eventId),
    beforeValue: previous?.role || null,
    afterValue: slot.key,
    metadata: { voiceResult }
  });
  await refreshEventMessage(interaction.client, eventId);
  return slot;
}

function worldBossReplacementSlots(selected, ownSlots) {
  if (ownSlots.some((slot) => slot.key === selected.key)) return [];
  const main = ownSlots.find((slot) => slot.kind === 'main');
  const mobile = ownSlots.find((slot) => slot.kind === 'mobile');
  const active = ownSlots.find((slot) => slot.kind === 'active');

  if (selected.kind === 'main') {
    if (active) throw new Error('Libere sua vaga de Scout Ativo antes de escolher uma funcao principal.');
    if (mobile && selected.role !== 'dps') {
      throw new Error('Scout Mobile so pode acumular com uma funcao DPS. Libere o scout primeiro.');
    }
    return main ? [main.key] : [];
  }
  if (selected.kind === 'mobile') {
    if (active) throw new Error('Libere sua vaga de Scout Ativo antes de escolher Scout Mobile.');
    if (main && main.role !== 'dps') {
      throw new Error('Scout Mobile so pode acumular com uma funcao DPS. Libere sua funcao atual primeiro.');
    }
    return mobile ? [mobile.key] : [];
  }
  if (main || mobile) {
    throw new Error('Scout Ativo e uma funcao exclusiva. Libere suas outras vagas primeiro.');
  }
  return active ? [active.key] : [];
}

function worldBossParticipantRole(eventId, discordId) {
  const slots = repo.listWorldBossAssignments(eventId)
    .filter((assignment) => assignment.discord_id === discordId)
    .map((assignment) => worldBossSlot(assignment.slot_key))
    .filter(Boolean);
  return slots.find((slot) => slot.kind === 'main')?.role || 'scout';
}

async function removeWorldBossSlot(interaction, eventId, slotKey) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'created') throw new Error('So e possivel liberar vagas antes do evento iniciar.');
  if (!repo.getWorldBossEventMeta(eventId)) throw new Error('Esse evento nao e um World Boss.');
  const slot = worldBossSlot(slotKey);
  if (!slot) throw new Error('Vaga de World Boss invalida.');
  const removed = repo.removeWorldBossAssignment({ eventId, discordId: interaction.user.id, slotKey });
  if (!removed.changes) throw new Error('Essa vaga nao pertence a voce.');
  const remaining = repo.listWorldBossAssignments(eventId)
    .filter((assignment) => assignment.discord_id === interaction.user.id);
  if (remaining.length === 0) {
    repo.removeParticipant({ eventId, discordId: interaction.user.id });
    await removeEventRoleFromMember(interaction.guild, event, interaction.user.id).catch(() => {});
  } else {
    repo.upsertParticipant({
      eventId,
      discordId: interaction.user.id,
      role: worldBossParticipantRole(eventId, interaction.user.id),
      isSpectator: 0
    });
  }
  audit.createAuditLog({
    type: 'world_boss_slot_left',
    actorId: interaction.user.id,
    targetId: String(eventId),
    beforeValue: slot.key,
    reason: 'Vaga liberada antes do inicio'
  });
  await refreshEventMessage(interaction.client, eventId);
  return slot;
}

async function leaveWorldBoss(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'created') throw new Error('So e possivel sair da composicao antes do evento iniciar.');
  if (!repo.getWorldBossEventMeta(eventId)) throw new Error('Esse evento nao e um World Boss.');
  const removed = repo.removeWorldBossAssignment({ eventId, discordId: interaction.user.id });
  if (!removed.changes) throw new Error('Voce nao esta inscrito neste World Boss.');
  repo.removeParticipant({ eventId, discordId: interaction.user.id });
  await removeEventRoleFromMember(interaction.guild, event, interaction.user.id).catch(() => {});
  audit.createAuditLog({
    type: 'world_boss_slot_left',
    actorId: interaction.user.id,
    targetId: String(eventId),
    reason: 'Saida voluntaria antes do inicio'
  });
  await refreshEventMessage(interaction.client, eventId);
}

async function joinRaidAvalonRole(interaction, { eventId, role, weapon, itemPower }) {
  const event = repo.getEvent(eventId);
  if (!event || !['created', 'running'].includes(event.status)) throw new Error('Evento nao esta aberto.');
  if (!repo.getRaidAvalonEventMeta(eventId)) throw new Error('Esse evento nao e uma raid especial.');
  if (!canJoinEventRole(event, interaction.user.id, role)) {
    throw new Error(`Não há mais vagas de ${roleConfigs[role]?.label || role}.`);
  }
  const normalizedWeapon = normalizeRaidWeapon(eventId, role, weapon);
  const normalizedWeaponKey = weaponKey(normalizedWeapon);
  const occupied = repo
    .listRaidAvalonParticipants(eventId)
    .find((participant) => participant.weapon_key === normalizedWeaponKey && participant.discord_id !== interaction.user.id);
  if (occupied) throw new Error(`A vaga ${normalizedWeapon} ja esta ocupada por <@${occupied.discord_id}>.`);
  const currentParticipant = repo.getRaidAvalonParticipant({ eventId, discordId: interaction.user.id });
  const isKeepingOwnSlot = currentParticipant?.weapon_key === normalizedWeaponKey;
  if (!isKeepingOwnSlot && !isRaidWeaponUnlocked(normalizedWeapon, raidDpsCount(repo.listParticipants(eventId)), eventId)) {
    throw new Error(`${normalizedWeapon} libera com ${raidWeaponRequiredDps(normalizedWeapon, eventId)} DPS inscritos.`);
  }
  const previous = repo.getParticipant({ eventId, discordId: interaction.user.id });
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role, isSpectator: 0 });
  await addEventRoleToMember(interaction.guild, event, interaction.user.id).catch(() => {});
  repo.upsertRaidAvalonParticipant({
    eventId,
    discordId: interaction.user.id,
    weaponKey: normalizedWeaponKey,
    weaponName: normalizedWeapon,
    itemPower,
    helperRole: null
  });
  let voiceResult = null;
  if (event.status === 'running') {
    voiceResult = await ensureParticipantVoiceSession(interaction, event);
  }
  audit.createAuditLog({
    type: previous?.is_spectator ? 'raid_avalon_spectator_promoted' : 'raid_avalon_joined',
    actorId: interaction.user.id,
    targetId: String(eventId),
    beforeValue: previous ? JSON.stringify({ role: previous.role, isSpectator: previous.is_spectator }) : null,
    afterValue: JSON.stringify({ role, weapon: normalizedWeapon, itemPower }),
    metadata: { voiceResult }
  });
  await refreshEventMessage(interaction.client, eventId);
  return normalizedWeapon;
}

async function joinRaidAvalonHelper(interaction, eventId, helperRole) {
  const event = repo.getEvent(eventId);
  if (!event || !['created', 'running'].includes(event.status)) throw new Error('Evento nao esta aberto.');
  if (!repo.getRaidAvalonEventMeta(eventId)) throw new Error('Esse evento nao e uma Raid Avalon Full.');
  if (!raidAvalonHelpers[helperRole]) throw new Error('Funcao auxiliar invalida.');
  const previous = repo.getParticipant({ eventId, discordId: interaction.user.id });
  const now = new Date().toISOString();
  if (event.status === 'running' && previous && !previous.is_spectator) {
    closeParticipantOpenSession(eventId, interaction.user.id, now);
    repo.refreshParticipantSeconds(eventId);
  }
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role: helperRole, isSpectator: 1 });
  repo.upsertRaidAvalonParticipant({ eventId, discordId: interaction.user.id, helperRole });
  audit.createAuditLog({
    type: 'raid_avalon_helper_joined',
    actorId: interaction.user.id,
    targetId: String(eventId),
    beforeValue: previous ? JSON.stringify({ role: previous.role, isSpectator: previous.is_spectator }) : null,
    afterValue: helperRole
  });
  if (event.status === 'running') {
    await moveMemberToEventVoice(interaction, event);
  }
  await refreshEventMessage(interaction.client, eventId);
  return raidAvalonHelpers[helperRole];
}

async function pauseParticipation(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'running') throw new Error('Evento nao esta em andamento.');
  const participant = repo.getParticipant({ eventId, discordId: interaction.user.id });
  if (!participant || participant.is_spectator) throw new Error('Voce nao esta participando deste evento.');
  const now = new Date().toISOString();
  closeParticipantOpenSession(eventId, interaction.user.id, now);
  repo.refreshParticipantSeconds(eventId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const waiting = await interaction.guild.channels.fetch(ids.channels.waitingVoice).catch(() => null);
  if (member?.voice?.channelId === event.voice_channel_id && waiting) {
    await member.voice.setChannel(waiting).catch(() => {});
  }
  audit.createAuditLog({ type: 'event_participation_paused', actorId: interaction.user.id, targetId: String(eventId), reason: 'Pausa manual' });
  await refreshEventMessage(interaction.client, eventId);
}

async function spectateEvent(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event || !['created', 'running'].includes(event.status)) throw new Error('Evento nao esta aberto.');
  await assertEventAudience(interaction, event);
  const previous = repo.getParticipant({ eventId, discordId: interaction.user.id });
  const now = new Date().toISOString();
  if (event.status === 'running' && previous && !previous.is_spectator) {
    closeParticipantOpenSession(eventId, interaction.user.id, now);
    repo.refreshParticipantSeconds(eventId);
  }
  repo.upsertParticipant({ eventId, discordId: interaction.user.id, role: 'spectator', isSpectator: 1 });
  await addEventRoleToMember(interaction.guild, event, interaction.user.id).catch(() => {});
  audit.createAuditLog({
    type: 'event_spectator',
    actorId: interaction.user.id,
    targetId: String(eventId),
    beforeValue: previous ? JSON.stringify({ role: previous.role, isSpectator: previous.is_spectator }) : null
  });
  if (event.status === 'running') await moveMemberToEventVoice(interaction, event);
  await refreshEventMessage(interaction.client, eventId);
}

async function assertEventAudience(interaction, event) {
  const audience = event?.audience || 'public';
  if (audience === 'public') return;
  const member = interaction.member || await interaction.guild?.members?.fetch?.(interaction.user.id).catch(() => null);
  const hasAnyRole = (roleIds) => roleIds.filter(Boolean).some((roleId) => member?.roles?.cache?.has?.(roleId));
  const isStaff = hasAnyRole([ids.roles.adm, ids.roles.staff]);
  if (audience === 'member' && (isStaff || hasAnyRole([ids.roles.member]))) return;
  if (audience === 'staff' && isStaff) return;
  throw new Error(audience === 'member'
    ? 'Este evento e exclusivo para membros da Notag.'
    : 'Este evento e interno da Staff.');
}

function managedParticipantRoleOptions(eventId, discordId) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'running') return [];
  if (repo.getRaidAvalonEventMeta(eventId) || repo.getWorldBossEventMeta(eventId)) return [];
  const participant = repo.getParticipant({ eventId, discordId });
  if (!participant || participant.is_spectator || participant.is_paused) return [];
  const custom = Boolean(repo.getCustomEventMeta(eventId) || repo.getVisualEventBuildMeta(eventId));
  return eventRoles.filter((role) => (
    custom
      ? customEventSlotOptions(eventId, role, discordId).length > 0
      : canJoinEventRole(event, discordId, role)
  ));
}

async function reassignManagedParticipant(interaction, { eventId, discordId, role, slotIndex = null, weaponKey = null }) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'running') throw new Error('Evento nao esta em andamento.');
  if (repo.getRaidAvalonEventMeta(eventId) || repo.getWorldBossEventMeta(eventId)) {
    throw new Error('Este tipo de evento usa um gerenciamento proprio de funcoes.');
  }
  const participant = repo.getParticipant({ eventId, discordId });
  if (!participant || participant.is_spectator || participant.is_paused) {
    throw new Error('Esse jogador nao esta na composicao ativa.');
  }
  if (!eventRoles.includes(role)) throw new Error('Funcao invalida.');

  const custom = Boolean(repo.getCustomEventMeta(eventId) || repo.getVisualEventBuildMeta(eventId));
  if (custom) {
    if (role === 'dps' && weaponKey && repo.listCustomEventDpsWeapons(eventId).length > 0) {
      const result = repo.assignCustomDpsWeapon({ eventId, discordId, weaponKey });
      if (!result.assigned) throw new Error('Essa arma de DPS não está mais disponível.');
    } else {
      const numericSlot = Number(slotIndex);
      const available = customEventSlotOptions(eventId, role, discordId)
        .some((option) => option.value === `${role}|${numericSlot}`);
      if (!available) throw new Error('Essa vaga nao esta mais disponivel.');
      repo.upsertParticipant({
        eventId,
        discordId,
        role,
        customSlotIndex: numericSlot,
        isSpectator: 0
      });
    }
  } else {
    if (!canJoinEventRole(event, discordId, role)) {
      throw new Error(`Nao ha vaga livre para ${roleButtonLabel(role)} neste evento.`);
    }
    repo.upsertParticipant({ eventId, discordId, role, isSpectator: 0 });
  }

  audit.createAuditLog({
    type: 'event_participant_reassigned',
    actorId: interaction.user.id,
    targetId: String(eventId),
    beforeValue: JSON.stringify({
      discordId,
      role: participant.role,
      slotIndex: participant.custom_slot_index
    }),
    afterValue: JSON.stringify({ discordId, role, slotIndex: custom ? Number(slotIndex) : null }),
    reason: 'Funcao alterada durante o evento'
  });
  await refreshEventMessage(interaction.client, eventId);
  return repo.getParticipant({ eventId, discordId });
}

async function pauseManagedParticipant(interaction, eventId, discordId) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'running') throw new Error('Evento nao esta em andamento.');
  if (repo.getRaidAvalonEventMeta(eventId) || repo.getWorldBossEventMeta(eventId)) {
    throw new Error('Este tipo de evento usa um gerenciamento proprio de funcoes.');
  }
  const participant = repo.getParticipant({ eventId, discordId });
  if (!participant || participant.is_spectator || participant.is_paused) {
    throw new Error('Esse jogador nao esta na composicao ativa.');
  }

  const now = new Date().toISOString();
  closeParticipantOpenSession(eventId, discordId, now);
  repo.refreshParticipantSeconds(eventId);
  repo.upsertParticipant({
    eventId,
    discordId,
    role: participant.role,
    isSpectator: 0,
    isPaused: 1,
    customSlotIndex: null
  });

  const member = await interaction.guild.members.fetch(discordId).catch(() => null);
  const waiting = await interaction.guild.channels.fetch(ids.channels.waitingVoice).catch(() => null);
  if (member?.voice?.channelId === event.voice_channel_id && waiting) {
    await member.voice.setChannel(waiting).catch(() => {});
  }
  audit.createAuditLog({
    type: 'event_participant_paused_by_manager',
    actorId: interaction.user.id,
    targetId: String(eventId),
    beforeValue: JSON.stringify({
      discordId,
      role: participant.role,
      slotIndex: participant.custom_slot_index
    }),
    reason: 'Participacao pausada pelo criador ou staff'
  });
  await refreshEventMessage(interaction.client, eventId);
  return repo.getParticipant({ eventId, discordId });
}

async function autoJoinRunningEvent(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'running') throw new Error('Evento nao esta em andamento.');
  const existing = repo.getParticipant({ eventId, discordId: interaction.user.id });
  const role = existing && !existing.is_spectator && !existing.is_paused
    ? existing.role
    : firstAvailableRole(event, repo.listParticipants(eventId));
  if (!role) throw new Error('Nao ha vagas livres neste evento. Use Assistir se quiser acompanhar.');
  await joinEvent(interaction, eventId, role);
  return role;
}

function firstAvailableRole(event, participants) {
  const order = [
    ['tank', event.tank_slots],
    ['healer', event.healer_slots],
    ['support', event.support_slots],
    ['dps', event.dps_slots]
  ];
  for (const [role, slots] of order) {
    const used = participants.filter((participant) => (
      participant.role === role && !participant.is_spectator && !participant.is_paused
    )).length;
    if (used < slots) return role;
  }
  return null;
}

async function moveMemberToEventVoice(interaction, event) {
  if (!event.voice_channel_id) return { moved: false, reason: 'missing_voice' };
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.voice?.channel) return { moved: false, reason: 'not_in_voice' };
  await member.voice.setChannel(event.voice_channel_id).catch(() => {});
  return { moved: true };
}

async function ensureParticipantVoiceSession(interaction, event) {
  if (!event.voice_channel_id) return { moved: false, started: false, reason: 'missing_voice' };
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.voice?.channel) return { moved: false, started: false, reason: 'not_in_voice' };

  const now = new Date().toISOString();
  if (member.voice.channelId !== event.voice_channel_id) {
    const moved = await member.voice.setChannel(event.voice_channel_id).then(() => true).catch(() => false);
    if (!moved) return { moved: false, started: false, reason: 'move_failed' };
  }

  const open = repo.getOpenVoiceSession({ eventId: event.id, discordId: interaction.user.id });
  if (!open) {
    repo.startVoiceSession({ eventId: event.id, discordId: interaction.user.id, joinedAt: now });
    repo.refreshParticipantSeconds(event.id);
    return { moved: true, started: true };
  }

  return { moved: true, started: false };
}

async function startEvent(interaction, eventId) {
  return startEventWithGuild({
    client: interaction.client,
    guild: interaction.guild,
    eventId,
    actorId: interaction.user.id
  });
}

async function startEventWithGuild({ client, guild, eventId, actorId }) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  if (event.status !== 'created') throw new Error('Evento nao pode ser iniciado.');

  const voice = await guild.channels.create({
    name: eventVoiceChannelName(event),
    type: ChannelType.GuildVoice,
    parent: ids.categories.activeEvents,
    reason: `Evento ${event.event_code} iniciado`
  });

  const now = new Date().toISOString();
  repo.updateEvent(eventId, { status: 'running', voice_channel_id: voice.id, started_at: now });
  const startedEvent = repo.getEvent(eventId);
  await deleteWarningMessage(client, startedEvent).catch(() => {});
  // Todos os inscritos acompanham o evento na mesma sala de voz. Espectadores
  // sao movidos junto com o grupo, mas nao iniciam sessao e continuam fora do
  // tempo contabilizado e da divisao do loot.
  const registrations = repo.listParticipants(eventId);
  for (const participant of registrations) {
    const member = guild.members.cache?.get(participant.discord_id)
      || await guild.members.fetch(participant.discord_id).catch(() => null);
    const connectedChannelId = member?.voice?.channelId || member?.voice?.channel?.id || null;
    if (!connectedChannelId) continue;
    const moved = await member.voice.setChannel(voice.id)
      .then(() => true)
      .catch((error) => {
        console.error(`[EVENTO] Nao foi possivel mover ${participant.discord_id} para ${voice.id}:`, error);
        return false;
      });
    if (moved && !participant.is_spectator) {
      repo.startVoiceSession({ eventId, discordId: participant.discord_id, joinedAt: now });
    }
  }

  audit.createAuditLog({ type: 'event_started', actorId, targetId: String(eventId), afterValue: voice.id });
  await refreshEventMessage(client, eventId);
  return voice;
}

function waitForVoiceState(milliseconds) {
  if (!milliseconds) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function returnEventMembersToWaiting(voice, waiting, eventCode) {
  const members = voice?.members ? [...voice.members.values()] : [];
  if (!members.length) return { moved: [], stranded: [] };
  if (!waiting?.id) {
    console.error(`[EVENTO] Sala Aguardando Evento indisponivel ao encerrar ${eventCode}.`);
    return { moved: [], stranded: members };
  }

  const requested = [];
  for (const member of members) {
    const moved = await member.voice.setChannel(waiting.id)
      .then(() => true)
      .catch((error) => {
        console.error(`[EVENTO] Falha ao devolver ${member.id} para ${waiting.id}:`, error);
        return false;
      });
    if (moved) requested.push(member);
  }

  // O cliente do Discord precisa terminar a troca de RTC antes da sala anterior ser apagada.
  await waitForVoiceState(eventVoiceMoveSettleMs);

  const retry = members.filter((member) => member.voice?.channelId !== waiting.id);
  for (const member of retry) {
    await member.voice.setChannel(waiting.id).catch((error) => {
      console.error(`[EVENTO] Segunda tentativa falhou para ${member.id} em ${waiting.id}:`, error);
    });
  }
  if (retry.length) await waitForVoiceState(eventVoiceMoveRetrySettleMs);

  const stranded = members.filter((member) => member.voice?.channelId !== waiting.id);
  return {
    moved: members.filter((member) => member.voice?.channelId === waiting.id),
    stranded
  };
}

async function deleteEventVoiceChannel(voice, reason, eventCode) {
  if (!voice) return { deleted: false, reason: 'missing_channel' };
  try {
    await voice.delete(reason);
    return { deleted: true };
  } catch (error) {
    console.error(`[EVENTO] Falha ao excluir a sala ${voice.id} de ${eventCode}:`, error);
    return { deleted: false, reason: 'delete_failed' };
  }
}

async function finishEvent(interaction, eventId) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'running') throw new Error('Evento nao esta em andamento.');

  const now = new Date().toISOString();
  await closeAllOpenSessions(eventId, now);
  repo.refreshParticipantSeconds(eventId);
  repo.updateEvent(eventId, {
    status: 'review',
    ended_at: now,
    review_required: 1,
    finalized_by: interaction.user.id
  });

  const voice = await interaction.guild.channels.fetch(event.voice_channel_id).catch(() => null);
  const waiting = await interaction.guild.channels.fetch(ids.channels.waitingVoice).catch(() => null);
  const movement = await returnEventMembersToWaiting(voice, waiting, event.event_code);
  if (!movement.stranded.length) {
    await deleteEventVoiceChannel(voice, `Evento ${event.event_code} finalizado`, event.event_code);
  } else {
    console.error(
      `[EVENTO] Sala ${event.voice_channel_id} preservada: ${movement.stranded.length} membro(s) ainda nao chegaram em ${ids.channels.waitingVoice}.`
    );
  }
  const reviewedEvent = repo.getEvent(eventId);
  await deleteWarningMessage(interaction.client, reviewedEvent).catch(() => {});

  audit.createAuditLog({ type: 'event_finished', actorId: interaction.user.id, targetId: String(eventId) });
  await deleteEventMessage(interaction.client, eventId);
}

async function cancelEvent(interaction, eventId, reason) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  const cancelReason = String(reason || '').trim() || 'Sem motivo informado';
  repo.updateEvent(eventId, {
    status: 'cancelled',
    cancel_reason: cancelReason,
    cancelled_by: interaction.user.id
  });
  const voice = event.voice_channel_id ? await interaction.guild.channels.fetch(event.voice_channel_id).catch(() => null) : null;
  const waiting = await interaction.guild.channels.fetch(ids.channels.waitingVoice).catch(() => null);
  const movement = await returnEventMembersToWaiting(voice, waiting, event.event_code);
  if (!movement.stranded.length) {
    await deleteEventVoiceChannel(voice, `Evento cancelado: ${cancelReason}`, event.event_code);
  } else {
    console.error(
      `[EVENTO] Sala ${event.voice_channel_id} preservada apos cancelamento: ${movement.stranded.length} membro(s) ainda conectado(s).`
    );
  }
  await deleteWarningMessage(interaction.client, event).catch(() => {});
  await removeWarningRole(interaction.guild, event).catch(() => {});
  audit.createAuditLog({
    type: 'event_cancelled',
    actorId: interaction.user.id,
    targetId: String(eventId),
    reason: cancelReason,
    metadata: {
      eventCode: event.event_code,
      title: event.title,
      creatorId: event.creator_id,
      previousStatus: event.status
    }
  });
  await safeSend(interaction.client, ids.channels.bankLogs, {
    content: [
      `Evento cancelado: ${event.event_code} | ${event.title}`,
      `Criador: <@${event.creator_id}>`,
      `Cancelado por: <@${interaction.user.id}>`,
      `Status anterior: ${event.status}`,
      `Motivo: ${cancelReason}`
    ].join('\n'),
    allowedMentions: normalizeAllowedMentions({ users: [event.creator_id, interaction.user.id] })
  });
  await deleteEventMessage(interaction.client, eventId);
}

function saveLootReview({ eventId, lootTotal, repair, silverBags, taxPercent, evidenceNotes }) {
  const netLoot = calculateNetLoot({ lootTotal, repair, silverBags, taxPercent });
  repo.refreshParticipantSeconds(eventId);

  transaction(() => {
    repo.upsertReview({ eventId, lootTotal, repair, silverBags, taxPercent, netLoot, status: 'review' });
    repo.updateReviewMetadata(eventId, { evidence_notes: evidenceNotes || null });
    recalculatePayouts(eventId);
    repo.updateEvent(eventId, { status: 'review' });
  })();

  audit.createAuditLog({
    type: 'event_review_submitted',
    targetId: String(eventId),
    afterValue: formatSilver(netLoot),
    metadata: { lootTotal, repair, silverBags, taxPercent, evidenceNotes }
  });
  return { netLoot };
}

function createLootReviewCorrectionDraft({ eventId, actorId, reviewMessageId, lootTotal, repair, silverBags, taxPercent, evidenceNotes }) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  if (event.status !== 'review') throw new Error('O loot so pode ser corrigido enquanto o evento esta em revisao.');

  const previous = repo.getReview(eventId);
  if (!previous) throw new Error('Revisao do evento nao encontrada.');

  const netLoot = calculateNetLoot({ lootTotal, repair, silverBags, taxPercent });
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const draft = {
    id,
    eventId,
    actorId,
    reviewMessageId,
    lootTotal,
    repair,
    silverBags,
    taxPercent,
    evidenceNotes,
    netLoot,
    previous: {
      lootTotal: previous.loot_total,
      repair: previous.repair,
      silverBags: previous.silver_bags,
      taxPercent: previous.tax_percent,
      netLoot: previous.net_loot
    },
    createdAt: Date.now()
  };
  lootReviewCorrectionDrafts.set(id, draft);
  return draft;
}

function getLootReviewCorrectionDraft(draftId) {
  const draft = lootReviewCorrectionDrafts.get(draftId);
  if (!draft) return null;
  if (Date.now() - draft.createdAt > lootReviewCorrectionDraftLifetimeMs) {
    lootReviewCorrectionDrafts.delete(draftId);
    return null;
  }
  return draft;
}

function confirmLootReviewCorrection({ draftId, actorId }) {
  const draft = getLootReviewCorrectionDraft(draftId);
  if (!draft) throw new Error('Essa confirmacao expirou. Abra a correcao do loot novamente.');
  if (draft.actorId !== actorId) throw new Error('Somente quem preparou a correcao pode confirma-la.');

  const event = repo.getEvent(draft.eventId);
  if (!event || event.status !== 'review') {
    lootReviewCorrectionDrafts.delete(draftId);
    throw new Error('O evento nao esta mais em revisao. Nenhuma correcao foi aplicada.');
  }
  const current = repo.getReview(draft.eventId);
  const unchanged = current
    && current.loot_total === draft.previous.lootTotal
    && current.repair === draft.previous.repair
    && current.silver_bags === draft.previous.silverBags
    && current.tax_percent === draft.previous.taxPercent
    && current.net_loot === draft.previous.netLoot;
  if (!unchanged) {
    lootReviewCorrectionDrafts.delete(draftId);
    throw new Error('A revisao mudou depois desta previa. Abra a correcao novamente para usar os valores atuais.');
  }

  transaction(() => {
    repo.upsertReview({
      eventId: draft.eventId,
      lootTotal: draft.lootTotal,
      repair: draft.repair,
      silverBags: draft.silverBags,
      taxPercent: draft.taxPercent,
      netLoot: draft.netLoot,
      status: 'review'
    });
    repo.updateReviewMetadata(draft.eventId, { evidence_notes: draft.evidenceNotes || null });
    recalculatePayouts(draft.eventId);
  })();

  audit.createAuditLog({
    type: 'event_loot_recalculated',
    actorId,
    targetId: String(draft.eventId),
    beforeValue: formatSilver(draft.previous.netLoot),
    afterValue: formatSilver(draft.netLoot),
    reason: `Correcao do loot do evento ${event.event_code}`,
    metadata: {
      before: draft.previous,
      after: {
        lootTotal: draft.lootTotal,
        repair: draft.repair,
        silverBags: draft.silverBags,
        taxPercent: draft.taxPercent,
        netLoot: draft.netLoot
      },
      evidenceNotes: draft.evidenceNotes
    }
  });

  lootReviewCorrectionDrafts.delete(draftId);
  return {
    eventId: draft.eventId,
    reviewMessageId: draft.reviewMessageId,
    netLoot: draft.netLoot,
    previousNetLoot: draft.previous.netLoot
  };
}

function cancelLootReviewCorrection({ draftId, actorId }) {
  const draft = getLootReviewCorrectionDraft(draftId);
  if (!draft) return false;
  if (draft.actorId !== actorId) throw new Error('Somente quem preparou a correcao pode cancela-la.');
  lootReviewCorrectionDrafts.delete(draftId);
  return true;
}

async function createPostEventReviewSpace(interaction, eventId) {
  return ensurePostEventReviewSpace(interaction.guild, interaction.client, eventId);
}

async function ensurePostEventReviewSpace(guild, client, eventId) {
  const event = repo.getEvent(eventId);
  if (!event) throw new Error('Evento nao encontrado.');
  let review = repo.getReview(eventId);
  if (!review) throw new Error('Revisao do evento nao encontrada.');

  let reviewChannel = review.review_channel_id
    ? await guild.channels.fetch(review.review_channel_id).catch(() => null)
    : null;
  if (!reviewChannel) {
    reviewChannel = await createReviewChannel(guild, eventId);
    review = repo.updateReviewMetadata(eventId, {
      review_channel_id: reviewChannel.id,
      review_message_id: null
    });
  }

  let reviewMessage = review?.review_message_id && reviewChannel.messages?.fetch
    ? await reviewChannel.messages.fetch(review.review_message_id).catch(() => null)
    : null;
  const payload = {
    content: [
      `Revisao do evento ${event.event_code}.`,
      'Anexe aqui o CSV do loot logger e prints complementares se precisar.',
      'Depois ajuste a participacao e clique em Enviar Financeiro.'
    ].join('\n'),
    embeds: [reviewEmbed(eventId)],
    components: reviewComponents(eventId, 'review')
  };
  if (reviewMessage) {
    await reviewMessage.edit(payload);
  } else {
    reviewMessage = await reviewChannel.send(payload);
    repo.updateReviewMetadata(eventId, { review_message_id: reviewMessage.id });
  }
  return reviewChannel;
}

async function createReviewChannel(guild, eventId) {
  const event = repo.getEvent(eventId);
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  const creator = await guild.members.fetch(event.creator_id).catch(() => null);
  const creatorName = creator?.displayName || `criador-${event.creator_id.slice(-4)}`;
  const name = reviewChannelName(creatorName, event.scheduled_time || event.event_code);
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      type: OverwriteType.Role,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    ...reviewStaffRoleIds().map((roleId) => ({
      id: roleId,
      type: OverwriteType.Role,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    })),
    {
      id: event.creator_id,
      type: OverwriteType.Member,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    },
    ...participants.map((participant) => ({
      id: participant.discord_id,
      type: OverwriteType.Member,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    }))
  ];

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: ids.categories.activeEvents,
    permissionOverwrites: dedupeOverwrites(overwrites),
    reason: `Revisao do evento ${event.event_code}`
  });
}

async function postDpsMeterSummary(client, eventId) {
  const channel = await client.channels.fetch(ids.channels.dpsMeter).catch(() => null);
  if (!channel) return null;
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  const mentions = participants.map((participant) => `<@${participant.discord_id}>`).join(' ');
  const mentionUserIds = [...new Set(participants.map((participant) => String(participant.discord_id)).filter(Boolean))];
  const message = await channel.send({
    content: mentions || undefined,
    embeds: [dpsMeterEmbed(eventId)],
    allowedMentions: { users: mentionUserIds }
  });
  repo.updateReviewMetadata(eventId, { dps_message_id: message.id });
  return message;
}

async function moveReviewChannelToClosed(client, eventId) {
  const review = repo.getReview(eventId);
  if (!review?.review_channel_id) return null;
  const channel = await client.channels.fetch(review.review_channel_id).catch(() => null);
  if (!channel) return null;
  await channel.setParent(ids.categories.closedEvents, { lockPermissions: false }).catch(() => {});
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone.id, { ViewChannel: false }).catch(() => {});
  return channel;
}

function workflowComponentIds(message) {
  return (message?.components || []).flatMap((row) => row.components || [])
    .map((component) => component.customId || component.custom_id)
    .filter(Boolean);
}

function workflowComponentPrefixes(eventId, mode) {
  if (mode === 'finance') {
    return [`event:approve:${eventId}`, `event:return_review:${eventId}`];
  }
  return [
    `event_review:edit:${eventId}`,
    `event_review:add:${eventId}`,
    `event_review:remove:${eventId}`,
    `event_review:submit:${eventId}`
  ];
}

async function findEventWorkflowMessage(client, { channelId, messageId, eventId, mode }) {
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.messages?.fetch) return null;

  if (messageId) {
    const stored = await channel.messages.fetch(messageId).catch(() => null);
    if (stored) return stored;
  }

  const recent = await channel.messages.fetch({ limit: mode === 'finance' ? 100 : 30 }).catch(() => null);
  if (!recent?.values) return null;
  const expected = workflowComponentPrefixes(eventId, mode);
  return [...recent.values()].find((message) => {
    const idsFound = workflowComponentIds(message);
    return expected.some((customId) => idsFound.includes(customId));
  }) || null;
}

async function syncEventWorkflowMessages(client, eventId) {
  const event = repo.getEvent(eventId);
  let review = repo.getReview(eventId);
  if (!event || !review) return { review: false, finance: false };

  const reviewMessage = await findEventWorkflowMessage(client, {
    channelId: review.review_channel_id,
    messageId: review.review_message_id,
    eventId,
    mode: 'review'
  });
  if (reviewMessage) {
    await reviewMessage.edit({
      embeds: [reviewEmbed(eventId)],
      components: event.status === 'review' ? reviewComponents(eventId, 'review') : []
    }).catch(() => {});
    if (review.review_message_id !== reviewMessage.id) {
      review = repo.updateReviewMetadata(eventId, { review_message_id: reviewMessage.id });
    }
  }

  const financeMessage = await findEventWorkflowMessage(client, {
    channelId: ids.channels.finance,
    messageId: review.finance_message_id,
    eventId,
    mode: 'finance'
  });
  if (financeMessage) {
    await financeMessage.edit({
      embeds: [reviewEmbed(eventId)],
      components: event.status === 'pending_payment' ? reviewComponents(eventId, 'finance') : []
    }).catch(() => {});
    if (review.finance_message_id !== financeMessage.id) {
      repo.updateReviewMetadata(eventId, { finance_message_id: financeMessage.id });
    }
  }

  return { review: Boolean(reviewMessage), finance: Boolean(financeMessage) };
}

async function reconcileEventWorkflowMessages(client, limit = 200) {
  const reviews = repo.listWorkflowReviews(limit);
  const result = { checked: reviews.length, review: 0, finance: 0, failed: 0 };

  for (const item of reviews) {
    try {
      const synced = await syncEventWorkflowMessages(client, item.event_id);
      if (synced.review) result.review += 1;
      if (synced.finance) result.finance += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`Falha ao sincronizar mensagens do evento ${item.event_id}:`, error);
    }
  }

  return result;
}

async function configuredGuild(client) {
  const cached = client.guilds?.cache?.get?.(ids.guildId);
  if (cached) return cached;
  return client.guilds?.fetch ? client.guilds.fetch(ids.guildId).catch(() => null) : null;
}

async function recoverInterruptedEventReviews(client, limit = 200) {
  const guild = await configuredGuild(client);
  const reviewEvents = repo.listReviewEvents(limit);
  const result = { checked: reviewEvents.length, recovered: 0, failed: 0 };
  if (!guild) {
    result.failed = reviewEvents.length;
    return result;
  }

  for (const event of reviewEvents) {
    try {
      await ensurePostEventReviewSpace(guild, client, event.id);
      result.recovered += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`Falha ao recuperar revisao do evento ${event.event_code}:`, error);
    }
  }
  return result;
}

async function recoverRunningEventsOnStartup(client) {
  const guild = await configuredGuild(client);
  const runningEvents = repo.listActiveEvents();
  const result = { checked: runningEvents.length, restored: 0, sessions: 0, failed: 0 };
  if (!guild) {
    result.failed = runningEvents.length;
    return result;
  }

  for (const event of runningEvents) {
    try {
      const voiceChannel = event.voice_channel_id
        ? await guild.channels.fetch(event.voice_channel_id).catch(() => null)
        : null;
      await refreshEventMessage(client, event.id);
      if (!voiceChannel) {
        result.failed += 1;
        continue;
      }

      const participants = repo.listParticipants(event.id).filter((participant) => !participant.is_spectator);
      for (const participant of participants) {
        const member = voiceChannel.members?.get?.(participant.discord_id)
          || await guild.members.fetch(participant.discord_id).catch(() => null);
        if (member?.voice?.channelId !== voiceChannel.id) continue;
        const started = repo.startVoiceSession({
          eventId: event.id,
          discordId: participant.discord_id,
          joinedAt: new Date().toISOString()
        });
        if (started.changes > 0) result.sessions += 1;
      }
      repo.updateEvent(event.id, { review_required: 0 });
      result.restored += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`Falha ao recuperar evento ${event.event_code}:`, error);
    }
  }
  return result;
}

function isUnknownDiscordChannel(error) {
  return Number(error?.code ?? error?.rawError?.code) === 10003;
}

async function runInactiveEventVoiceChannelCleanup(client, limit) {
  const eventsWithVoice = repo.listInactiveEventsWithVoiceChannels(limit);
  const result = {
    checked: eventsWithVoice.length,
    deleted: 0,
    occupied: 0,
    missing: 0,
    failed: 0
  };
  if (!eventsWithVoice.length) return result;

  const guild = await configuredGuild(client);
  if (!guild) {
    result.failed = eventsWithVoice.length;
    return result;
  }

  for (const event of eventsWithVoice) {
    let channel;
    try {
      channel = await guild.channels.fetch(event.voice_channel_id);
    } catch (error) {
      if (isUnknownDiscordChannel(error)) {
        repo.updateEvent(event.id, { voice_channel_id: null });
        result.missing += 1;
        continue;
      }
      const errorCode = error?.code ?? error?.rawError?.code ?? 'desconhecido';
      console.error(
        `[EVENTO] Falha ao consultar a sala ${event.voice_channel_id} de ${event.event_code} `
        + `(codigo ${errorCode}): ${error?.message || String(error)}`
      );
      result.failed += 1;
      continue;
    }
    if (!channel) {
      repo.updateEvent(event.id, { voice_channel_id: null });
      result.missing += 1;
      continue;
    }
    if (channel.type !== ChannelType.GuildVoice) {
      console.error(`[EVENTO] Canal ${channel.id} de ${event.event_code} nao e uma sala de voz; limpeza ignorada.`);
      result.failed += 1;
      continue;
    }
    if ((channel.members?.size || 0) > 0) {
      result.occupied += 1;
      continue;
    }

    const deletion = await deleteEventVoiceChannel(
      channel,
      `Limpeza de sala vazia do evento encerrado ${event.event_code}`,
      event.event_code
    );
    if (deletion.deleted) {
      repo.updateEvent(event.id, { voice_channel_id: null });
      result.deleted += 1;
    } else {
      result.failed += 1;
    }
  }

  return result;
}

async function cleanupInactiveEventVoiceChannels(client, limit = 500) {
  if (inactiveEventVoiceCleanupPromise) return inactiveEventVoiceCleanupPromise;
  inactiveEventVoiceCleanupPromise = runInactiveEventVoiceChannelCleanup(client, limit);
  try {
    return await inactiveEventVoiceCleanupPromise;
  } finally {
    inactiveEventVoiceCleanupPromise = null;
  }
}

async function scheduleReviewChannelDeletion(client, eventId, hours = 14) {
  const review = repo.getReview(eventId);
  if (!review?.review_channel_id) return;
  const deleteAfter = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  repo.updateReviewMetadata(eventId, { review_channel_delete_after: deleteAfter });
  await cleanupExpiredReviewChannels(client);
}

async function cleanupExpiredReviewChannels(client) {
  const expired = repo.listExpiredReviewChannels(new Date().toISOString());
  for (const review of expired) {
    const channel = await client.channels.fetch(review.review_channel_id).catch(() => null);
    await channel?.delete(`Revisao ${review.event_code} expirada apos aprovacao financeira`).catch(() => {});
    repo.updateReviewMetadata(review.event_id, {
      review_channel_id: null,
      review_channel_delete_after: null
    });
  }
}

function recalculatePayouts(eventId) {
  const review = repo.getReview(eventId);
  if (!review) throw new Error('Revisao do evento nao encontrada.');
  const participants = repo.listParticipants(eventId);
  const payouts = calculatePayouts({ participants, netLoot: review.net_loot });
  repo.clearParticipantPayouts(eventId);
  for (const payout of payouts) {
    repo.setParticipantPayout({ eventId, discordId: payout.discordId, payoutAmount: payout.payout });
  }
  return payouts;
}

function editParticipantReview({ eventId, actorId, discordId, role, minutes, reason }) {
  const before = repo.getParticipant({ eventId, discordId });
  if (!before) throw new Error('Participante nao encontrado neste evento.');
  const manualSeconds = Math.max(0, Math.round(minutes * 60));
  repo.setParticipantReview({ eventId, discordId, role, manualSeconds });
  const payouts = recalculatePayouts(eventId);
  audit.createAuditLog({
    type: 'event_participation_edited',
    actorId,
    targetId: discordId,
    beforeValue: JSON.stringify({ role: before.role, seconds: before.manual_seconds ?? before.calculated_seconds }),
    afterValue: JSON.stringify({ role, seconds: manualSeconds }),
    reason,
    metadata: { eventId, payouts }
  });
}

function addParticipantReview({ eventId, actorId, discordId, role, minutes, reason }) {
  const before = repo.getParticipant({ eventId, discordId });
  const manualSeconds = Math.max(0, Math.round(minutes * 60));
  repo.upsertParticipant({ eventId, discordId, role, isSpectator: 0 });
  repo.setParticipantReview({ eventId, discordId, role, manualSeconds });
  const payouts = recalculatePayouts(eventId);
  audit.createAuditLog({
    type: before ? 'event_participation_readded' : 'event_participation_added',
    actorId,
    targetId: discordId,
    beforeValue: before ? JSON.stringify(before) : null,
    afterValue: JSON.stringify({ role, seconds: manualSeconds }),
    reason,
    metadata: { eventId, payouts }
  });
}

function removeParticipantReview({ eventId, actorId, discordId, reason }) {
  const before = repo.getParticipant({ eventId, discordId });
  if (!before) throw new Error('Participante nao encontrado neste evento.');
  repo.removeParticipant({ eventId, discordId });
  const payouts = recalculatePayouts(eventId);
  audit.createAuditLog({
    type: 'event_participation_removed',
    actorId,
    targetId: discordId,
    beforeValue: JSON.stringify(before),
    reason,
    metadata: { eventId, payouts }
  });
}

function submitEventToFinance({ eventId, actorId }) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'review') throw new Error('Evento nao esta em revisao.');
  recalculatePayouts(eventId);
  repo.updateEvent(eventId, { status: 'pending_payment' });
  const review = repo.getReview(eventId);
  if (review) {
    repo.upsertReview({
      eventId,
      lootTotal: review.loot_total,
      repair: review.repair,
      silverBags: review.silver_bags,
      taxPercent: review.tax_percent,
      netLoot: review.net_loot,
      status: 'pending_approval'
    });
  }
  audit.createAuditLog({ type: 'event_submitted_to_finance', actorId, targetId: String(eventId), reason: event.event_code });
}

async function returnEventToReview({ client, eventId, actorId }) {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'pending_payment') throw new Error('Evento nao esta pendente no financeiro.');
  const review = repo.getReview(eventId);
  if (!review) throw new Error('Revisao do evento nao encontrada.');

  repo.updateEvent(eventId, { status: 'review' });
  repo.upsertReview({
    eventId,
    lootTotal: review.loot_total,
    repair: review.repair,
    silverBags: review.silver_bags,
    taxPercent: review.tax_percent,
    netLoot: review.net_loot,
    status: 'review'
  });
  repo.updateReviewMetadata(eventId, {
    review_channel_delete_after: null
  });

  const channel = review.review_channel_id
    ? await client.channels.fetch(review.review_channel_id).catch(() => null)
    : null;
  if (channel) {
    await channel.setParent(ids.categories.activeEvents, { lockPermissions: false }).catch(() => {});
    const reviewMessage = await channel.send({
      content: `Evento devolvido pelo financeiro para o criador revisar. <@${event.creator_id}>`,
      embeds: [reviewEmbed(eventId)],
      components: reviewComponents(eventId, 'review'),
      allowedMentions: { users: [event.creator_id] }
    }).catch(() => {});
    if (reviewMessage?.id) {
      repo.updateReviewMetadata(eventId, { review_message_id: reviewMessage.id });
    }
  }

  await syncEventWorkflowMessages(client, eventId);

  audit.createAuditLog({ type: 'event_payment_returned_to_review', actorId, targetId: String(eventId), reason: event.event_code });
  return channel;
}

const approveEventPayment = transaction(({ eventId, actorId }) => {
  const event = repo.getEvent(eventId);
  if (!event || event.status !== 'pending_payment') throw new Error('Evento nao esta pendente de pagamento.');
  backupDatabase('before_event_payment');
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator && participant.payout_amount > 0);
  const campaignChoices = campaigns.createEventPayoutChoices({ event, participants, actorId });

  if (campaignChoices?.decisions?.length) {
    repo.updateEvent(eventId, { status: 'approved' });
    repo.markReviewApproved({ eventId, approvedBy: actorId });
    audit.createAuditLog({
      type: 'event_payment_approved_with_campaign_choice',
      actorId,
      targetId: String(eventId),
      reason: event.event_code,
      metadata: { campaignId: campaignChoices.campaign.id, decisions: campaignChoices.decisions.length }
    });
    return { transactions: [], campaignChoices };
  }

  const transactions = [];
  for (const participant of participants) {
    const item = {
      type: 'event_payout',
      userId: participant.discord_id,
      amount: participant.payout_amount,
      reason: `Pagamento do evento ${event.event_code}`,
      referenceType: 'event',
      referenceId: String(event.id),
      createdBy: actorId
    };
    const result = finance.applyBalanceTransaction(item);
    transactions.push(result);
  }
  repo.updateEvent(eventId, { status: 'approved' });
  repo.markReviewApproved({ eventId, approvedBy: actorId });
  audit.createAuditLog({ type: 'event_payment_approved', actorId, targetId: String(eventId), reason: event.event_code });
  return { transactions, campaignChoices: null };
});

async function deleteEventMessage(client, eventId) {
  const event = repo.getEvent(eventId);
  if (!event?.message_id) {
    if (isPingContentChannel(event?.message_channel_id)) await syncPingContentIndex(client);
    return;
  }
  const channel = await fetchEventMessageChannel(client, event);
  const message = await channel?.messages.fetch(event.message_id).catch(() => null);
  await message?.delete().catch(() => {});
  if (isPingContentChannel(event.message_channel_id)) await syncPingContentIndex(client, channel);
}

function reviewEmbed(eventId) {
  const event = repo.getEvent(eventId);
  const review = repo.getReview(eventId);
  repo.refreshParticipantSeconds(eventId);
  const allParticipants = repo.listParticipants(eventId);
  const participants = allParticipants.filter((participant) => !participant.is_spectator);
  const lines = participants.map((participant) => {
    const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
    return `${raidParticipantLabel(participant)} | ${roleLabel(participant.role)} | ${formatDuration(seconds)} | ${formatSilver(participant.payout_amount)}`;
  });

  return new EmbedBuilder()
    .setTitle(event.status === 'approved' ? 'Evento finalizado' : event.status === 'pending_payment' ? 'Pagamento pendente' : 'Revisao de participacao')
    .setDescription(`**${formatEventTitle(event.title)}**\n${event.event_code}`)
    .addFields(
      { name: 'Loot liquido', value: formatSilver(review?.net_loot || 0), inline: true },
      { name: 'Evidencias', value: embedFieldValue(review?.evidence_notes || 'Anexe/cole DPS meter, fama total e CSV do loot logger no canal de revisao.'), inline: false },
      ...embedLinesFields('Participantes', lines, 'Nenhum participante com tempo contabilizado.')
    )
    .setColor(0xd69e2e)
    .setTimestamp(new Date());
}

function reviewComponents(eventId, mode = 'review') {
  if (mode === 'finance') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`event:approve:${eventId}`).setLabel('Aprovar pagamento').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`event:return_review:${eventId}`).setLabel('Recusar e devolver').setStyle(ButtonStyle.Danger)
      )
    ];
  }

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`event_review:edit:${eventId}`).setLabel('Editar membro').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`event_review:add:${eventId}`).setLabel('Adicionar membro').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event_review:remove:${eventId}`).setLabel('Remover membro').setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`event_review:recalculate:${eventId}`).setLabel('Corrigir valores do loot').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`event_review:submit:${eventId}`).setLabel('Enviar Financeiro').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function formatDuration(seconds) {
  const value = Number(seconds || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}

function dpsMeterEmbed(eventId) {
  const event = repo.getEvent(eventId);
  const review = repo.getReview(eventId);
  repo.refreshParticipantSeconds(eventId);
  const participants = repo.listParticipants(eventId).filter((participant) => !participant.is_spectator);
  const lines = participants.map((participant) => {
    const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
    return `${raidParticipantLabel(participant)} | ${roleLabel(participant.role)} | ${formatDuration(seconds)}`;
  });
  return new EmbedBuilder()
    .setTitle(`RESUMO DPS/FAMA - ${formatEventTitle(event.title)}`)
    .setDescription(event.event_code)
    .addFields(
      { name: 'Criador', value: `<@${event.creator_id}>`, inline: true },
      { name: 'Horario', value: event.scheduled_time || 'Nao informado', inline: true },
      { name: 'Loot liquido', value: formatSilver(review?.net_loot || 0), inline: true },
      { name: 'Evidencias', value: embedFieldValue(review?.evidence_notes || 'Aguardando prints/links/CSV no canal de revisao.'), inline: false },
      ...embedLinesFields('Participantes', lines, 'Nenhum participante.')
    )
    .setColor(0x805ad5)
    .setTimestamp(new Date());
}

function reviewChannelName(creatorName, timeText) {
  const raw = `${creatorName}-${timeText}`.toLowerCase();
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'evento-pendente';
}

function reviewStaffRoleIds() {
  return [ids.roles.staff, ids.roles.adm, ids.roles.treasurer].filter(Boolean);
}

function dedupeOverwrites(overwrites) {
  const seen = new Set();
  return overwrites.filter((overwrite) => {
    if (!overwrite.id || seen.has(overwrite.id)) return false;
    seen.add(overwrite.id);
    return true;
  });
}

function roleLabel(role) {
  const labels = {
    tank: `${roleEmoji('tank')} Tank`,
    healer: `${roleEmoji('healer')} Healer`,
    support: `${roleEmoji('support')} Suporte`,
    dps: `${roleEmoji('dps')} DPS`,
    spectator: '\u{1F441}\uFE0F Espectador',
    scout: 'Scout',
    looter: 'Looter',
    uper: 'Uper'
  };
  return labels[role] || role;
}

function roleStatsLabel(role) {
  const labels = {
    tank: `${roleEmoji('tank')} Tank`,
    healer: `${roleEmoji('healer')} Healer`,
    support: `${roleEmoji('support')} Suporte`,
    dps: `${roleEmoji('dps')} DPS`
  };
  return labels[role] || roleLabel(role);
}

function roleButtonLabel(role) {
  const labels = {
    tank: 'Tank',
    healer: 'Healer',
    support: 'Suporte',
    dps: 'DPS'
  };
  return labels[role] || role;
}

function roleButtonEmoji(role) {
  return emojiRefs.role[role] || undefined;
}

function formatEventTitle(title) {
  return String(title || 'EVENTO').toLocaleUpperCase('pt-BR');
}

function roleEmoji(role) {
  return formatCustomEmoji(emojiRefs.role[role]) || roleConfigs[role]?.label || role;
}

function weaponEmoji(weapon) {
  const key = raidWeaponInfoKey(null, weapon);
  return formatCustomEmoji(emojiRefs.weapon[key]) || '';
}

function formatCustomEmoji(ref) {
  if (!ref?.name) return '';
  if (ref.id) return `<:${ref.name}:${ref.id}>`;
  return /\p{Extended_Pictographic}/u.test(ref.name) ? ref.name : '';
}

function raidAnnouncementTitle(event, raidMeta) {
  const dungeon = raidMeta?.dungeon_tier || '?';
  const build = raidMeta?.build_tier || '?';
  if (event?.content_type === 'raid_dragon') {
    return `RAID DRAGÃO ${dungeon} COM BUILD ${build}`.toLocaleUpperCase('pt-BR');
  }
  return `RAID FULL ${dungeon} COM BUILD ${build}`.toLocaleUpperCase('pt-BR');
}

function raidAnnouncementDescription(event) {
  const observation = raidObservationText(event.description);
  return [
    `<@${event.creator_id}> - ${formatRaidSchedule(event.scheduled_time)}`,
    `We mass from ${event.location || 'local nao informado'}`,
    observation ? `Obs: ${observation}` : null
  ].filter(Boolean).join('\n');
}

function raidObservationText(value) {
  const text = String(value || '').trim();
  if (legacyRaidDescriptionPattern.test(text)) return raidDefaultObservation;
  return text.replace(/^obs:\s*/i, '').trim();
}

function formatRaidSchedule(value) {
  const text = String(value || '').trim();
  if (!text) return 'horario nao informado';
  const startAt = parseAlbionEventTime(text);
  if (!startAt) return text;
  return `${formatAlbionScheduleText(text, startAt)} (${discordTimestamp(startAt, 'R')})`;
}

function formatAlbionScheduleText(text, startAt) {
  const dateMatch = String(text || '').match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?\b/);
  const time = `${String(startAt.getUTCHours()).padStart(2, '0')}:${String(startAt.getUTCMinutes()).padStart(2, '0')}`;
  if (dateMatch) {
    return `${dateMatch[1].padStart(2, '0')}/${dateMatch[2].padStart(2, '0')} as ${time} UTC`;
  }
  return `Hoje as ${time} UTC`;
}

function discordTimestamp(date, style = 'R') {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function isRaidAvalonEvent(event) {
  return Boolean(event?.id && repo.getRaidAvalonEventMeta(event.id));
}

function raidProfileForEvent(event) {
  return raidProfiles[event?.content_type] || raidProfiles.raid_avalon;
}

function raidProfileForEventId(eventId) {
  return eventId ? raidProfileForEvent(repo.getEvent(eventId)) : raidProfiles.raid_avalon;
}

function raidWeaponDisplayName(event, weapon) {
  if (event?.content_type !== 'raid_dragon') return weapon;
  const labels = {
    sagrado_healer_do_tank: 'Sagrado - Tank',
    corrompido_healer_dos_healers: 'Corrompido - Healers',
    corrompido_healer_da_party: 'Corrompido - Party'
  };
  return labels[weaponKey(weapon)] || weapon;
}

function weaponKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function normalizeRaidWeapon(eventId, role, value) {
  const typed = String(value || '').replace(/\s+/g, ' ').trim();
  if (!typed) throw new Error('Informe a arma usada na raid.');
  const allowed = raidProfileForEventId(eventId).weapons[role] || [];
  const match = allowed.find((weapon) => weaponKey(weapon) === weaponKey(typed));
  return match || typed;
}

function raidWeaponSuggestions(role, eventId = null) {
  return (raidProfileForEventId(eventId).weapons[role] || []).join(', ') || 'Arma';
}

function raidWeaponOptions(role, eventId = null) {
  return (raidProfileForEventId(eventId).weapons[role] || []).map((weapon) => ({
    label: weapon,
    value: weaponKey(weapon)
  }));
}

function raidWeaponRoleOptions(eventId, role, discordId) {
  const profile = raidProfileForEventId(eventId);
  const occupied = new Map();
  for (const participant of repo.listRaidAvalonParticipants(eventId)) {
    if (participant.weapon_key) occupied.set(participant.weapon_key, participant.discord_id);
  }
  const dpsCount = raidDpsCount(repo.listParticipants(eventId));

  return (profile.weaponSlots[role] || []).map((weapon) => {
    const key = weaponKey(weapon);
    const owner = occupied.get(key);
    if (owner && owner !== discordId) return null;
    if (!owner && !isRaidWeaponUnlocked(weapon, dpsCount, eventId)) return null;
    return {
      label: raidWeaponDisplayName(repo.getEvent(eventId), weapon),
      value: key,
      description: owner === discordId ? 'Sua vaga atual' : 'Livre'
    };
  }).filter(Boolean);
}

function raidWeaponSlotOptions(eventId, discordId) {
  const profile = raidProfileForEventId(eventId);
  const occupied = new Map();
  for (const participant of repo.listRaidAvalonParticipants(eventId)) {
    if (participant.weapon_key) occupied.set(participant.weapon_key, participant.discord_id);
  }
  const dpsCount = raidDpsCount(repo.listParticipants(eventId));

  return eventRoles.flatMap((role) => (profile.weaponSlots[role] || []).map((weapon) => {
    const key = weaponKey(weapon);
    const owner = occupied.get(key);
    if (owner && owner !== discordId) return null;
    if (!owner && !isRaidWeaponUnlocked(weapon, dpsCount, eventId)) return null;
    return {
      label: raidWeaponDisplayName(repo.getEvent(eventId), weapon),
      value: `${role}|${key}`,
      description: owner === discordId ? `${roleButtonLabel(role)} - sua vaga atual` : `${roleButtonLabel(role)} - livre`
    };
  })).filter(Boolean);
}

function raidWeaponName(role, key, eventId = null) {
  const match = (raidProfileForEventId(eventId).weapons[role] || []).find((weapon) => weaponKey(weapon) === key);
  if (!match) throw new Error('Arma invalida para essa funcao.');
  return match;
}

function raidWeaponBuildUrl(role, keyOrName, eventId = null) {
  const profile = raidProfileForEventId(eventId);
  const key = raidWeaponInfoKey(role, keyOrName, eventId);
  return profile.weaponInfo[key]?.buildUrl || null;
}

function raidWeaponIconUrl(role, keyOrName, eventId = null) {
  const profile = raidProfileForEventId(eventId);
  const key = raidWeaponInfoKey(role, keyOrName, eventId);
  return profile.weaponInfo[key]?.iconUrl || null;
}

function raidWeaponInfoKey(role, keyOrName, eventId = null) {
  const rawKey = weaponKey(keyOrName);
  if (/^repetidor_\d+$/.test(rawKey)) return 'repetidor';
  if (/^repetidor_fura_bruma_\d+$/.test(rawKey)) return 'repetidor_fura_bruma';
  const byKnownWeapon = (raidProfileForEventId(eventId).weapons[role] || []).find((weapon) => weaponKey(weapon) === rawKey);
  return weaponKey(byKnownWeapon || keyOrName);
}

async function grantRaidAvalonRewards({ guild, eventId, actorId = null }) {
  repo.refreshParticipantSeconds(eventId);
  const event = repo.getEvent(eventId);
  const isRaid = Boolean(repo.getRaidAvalonEventMeta(eventId));
  const participants = repo.listParticipants(eventId);
  let granted = 0;
  let points = 0;
  let skipped = 0;
  let duplicates = 0;

  for (const participant of participants) {
    const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
    const category = careerCategoryForParticipant(eventId, participant);
    const functionName = eventFunctionName(eventId, participant);
    const pointInfo = careerPointInfo({ eventId, discordId: participant.discord_id, category, seconds, source: 'event_approval' });
    if (!pointInfo) {
      skipped += 1;
      continue;
    }

    if (isRaid && !participant.is_spectator && functionName) {
      const member = await guild.members.fetch(participant.discord_id).catch(() => null);
      const roleName = `Raid Avalon - ${functionName}`;
      let discordRole = guild.roles.cache.find((item) => item.name.toLowerCase() === roleName.toLowerCase());
      if (!discordRole) {
        discordRole = await guild.roles.create({ name: roleName, mentionable: false, reason: `Tag da funcao ${functionName} na Raid Avalon` }).catch(() => null);
      }
      if (member && discordRole && !member.roles.cache.has(discordRole.id)) {
        const added = await member.roles.add(discordRole, `Completou Raid Avalon com ${functionName}`).then(() => true).catch(() => false);
        if (added) granted += 1;
      }
    }

    const result = repo.addCareerPointTransaction({ ...pointInfo.entry, createdBy: actorId });
    points += result.points;
    if (!result.inserted) duplicates += 1;
  }

  const callerInfo = careerCallerPointInfo({ event, participants, source: 'event_approval' });
  if (callerInfo) {
    const result = repo.addCareerPointTransaction({ ...callerInfo.entry, createdBy: actorId });
    points += result.points;
    if (!result.inserted) duplicates += 1;
  }

  await refreshRaidAvalonCareerPanel(guild.client).catch(() => {});
  return { granted, points, skipped, duplicates };
}

function careerPointInfo({ eventId, discordId, category, seconds, source }) {
  const pointsToAdd = Math.floor(Number(seconds || 0) / 1800);
  const info = careerCategoryInfo(category);
  if (pointsToAdd <= 0 || !discordId || !info) return null;
  return {
    entry: {
      eventId,
      discordId,
      pointType: category === 'caller' ? 'caller' : 'class',
      role: category,
      weaponKey: info.key,
      weaponName: info.name,
      seconds,
      points: pointsToAdd,
      source
    },
    points: pointsToAdd
  };
}

function careerCallerPointInfo({ event, participants, source }) {
  if (!event?.creator_id) return null;
  const creatorParticipant = participants.find((participant) => participant.discord_id === event.creator_id);
  const participantSeconds = creatorParticipant
    ? creatorParticipant.manual_seconds ?? creatorParticipant.calculated_seconds ?? 0
    : 0;
  const seconds = participantSeconds > 0 ? participantSeconds : eventDurationSeconds(event);
  return careerPointInfo({
    eventId: event.id,
    discordId: event.creator_id,
    category: 'caller',
    seconds,
    source
  });
}

function careerCategoryForParticipant(eventId, participant) {
  if (!participant?.is_spectator) return normalizeParticipantRole(participant.role);
  const raid = repo.getRaidAvalonParticipant({ eventId, discordId: participant.discord_id });
  return careerHelperCategories[raid?.helper_role] || null;
}

function careerCategoryInfo(category) {
  return careerCategories[category] || null;
}

function careerPointsForCategory(discordId, category) {
  const info = careerCategoryInfo(category);
  if (!info) return 0;
  return Number(repo.getRaidAvalonCareer({ discordId, weaponKey: info.key })?.points || 0);
}

function eventDurationSeconds(event) {
  if (!event?.started_at) return 0;
  const start = Date.parse(event.started_at);
  const end = Date.parse(event.ended_at || new Date().toISOString());
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

function previewCareerRebuild() {
  return buildCareerRebuildPlan({ refreshSeconds: true }).summary;
}

function rebuildCareerPoints({ actorId }) {
  const plan = buildCareerRebuildPlan({ refreshSeconds: true, createdBy: actorId });
  const result = repo.replaceCareerPointData(plan.entries);
  return {
    ...plan.summary,
    insertedTransactions: result.inserted,
    insertedPoints: result.points
  };
}

function buildCareerRebuildPlan({ refreshSeconds = false, createdBy = null } = {}) {
  const events = repo.listApprovedEventsForCareer();
  const entries = [];
  const members = new Set();
  let participantsWithPoints = 0;
  let skipped = 0;
  let eventsWithPoints = 0;

  for (const event of events) {
    if (refreshSeconds) repo.refreshParticipantSeconds(event.id);
    let eventPoints = 0;
    const participants = repo.listParticipants(event.id);
    for (const participant of participants) {
      const seconds = participant.manual_seconds ?? participant.calculated_seconds ?? 0;
      const category = careerCategoryForParticipant(event.id, participant);
      const pointInfo = careerPointInfo({
        eventId: event.id,
        discordId: participant.discord_id,
        category,
        seconds,
        source: 'career_rebuild'
      });
      if (!pointInfo) {
        skipped += 1;
        continue;
      }
      entries.push({ ...pointInfo.entry, createdBy });
      participantsWithPoints += 1;
      eventPoints += pointInfo.points;
      members.add(participant.discord_id);
    }

    const callerInfo = careerCallerPointInfo({ event, participants, source: 'career_rebuild' });
    if (callerInfo) {
      entries.push({ ...callerInfo.entry, createdBy });
      eventPoints += callerInfo.points;
      members.add(event.creator_id);
    }

    if (eventPoints > 0) eventsWithPoints += 1;
  }

  return {
    entries,
    summary: {
      approvedEvents: events.length,
      eventsWithPoints,
      uniqueMembers: members.size,
      participantsWithPoints,
      skippedParticipants: skipped,
      transactionsToCreate: entries.length,
      pointsToCreate: entries.reduce((total, entry) => total + Number(entry.points || 0), 0),
      existingTransactions: repo.countCareerPointTransactions()
    }
  };
}

async function refreshRaidAvalonCareerPanel(client) {
  const channel = await client.channels.fetch(ids.channels.pveCareer || ids.channels.adminPanel).catch(() => null);
  if (!channel) return null;
  const payload = raidAvalonCareerPanelPayload();
  const previous = repo.getPersistentMessage('raid_avalon_career_panel');
  let message = previous?.message_id
    ? await channel.messages.fetch(previous.message_id).catch(() => null)
    : null;

  if (!message) {
    message = await findExistingCareerPanelMessage(channel, client.user?.id);
  }

  if (message) {
    await message.edit(payload);
    repo.setPersistentMessage({ key: 'raid_avalon_career_panel', channelId: channel.id, messageId: message.id });
    await deleteDuplicateCareerPanelMessages(channel, message.id, client.user?.id).catch(() => {});
    return message;
  }

  const created = await channel.send(payload);
  repo.setPersistentMessage({ key: 'raid_avalon_career_panel', channelId: channel.id, messageId: created.id });
  return created;
}

async function findExistingCareerPanelMessage(channel, botId) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return null;
  return messages.find((message) => isCareerPanelMessage(message, botId)) || null;
}

async function deleteDuplicateCareerPanelMessages(channel, keepMessageId, botId) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return;
  const duplicates = messages.filter((message) => message.id !== keepMessageId && isCareerPanelMessage(message, botId));
  for (const message of duplicates.values()) {
    await message.delete().catch(() => {});
  }
}

function isCareerPanelMessage(message, botId) {
  if (botId && message.author?.id !== botId) return false;
  const title = message.embeds?.[0]?.title || '';
  return ['Raid Avalon - carreira por arma', 'Carreira geral por arma', 'Carreira PvE por categoria'].includes(title);
}

function raidAvalonCareerPanelPayload() {
  const categoryRows = repo.listRaidAvalonCareerByWeapon(16);
  const memberRows = repo.listRaidAvalonCareer(12);
  const categoryLines = categoryRows.map((row, index) => {
    const totalUses = Math.floor(Number(row.points || 0));
    return `${index + 1}. ${careerCategoryEmoji(row.weapon_key)} **${row.weapon_name}** - ${totalUses} ponto(s) | ${row.members} membro(s)`;
  });
  const memberLines = memberRows.map((row, index) => {
    return `${index + 1}. <@${row.discord_id}> | ${careerCategoryEmoji(row.weapon_key)} ${row.weapon_name} | ${row.points} ponto(s)`;
  });

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Carreira PvE por categoria')
        .setDescription([
          'Conta qualquer content aprovado no financeiro.',
          'Regra: 30 minutos = 1 ponto na categoria jogada. Criador tambem soma Caller.',
          'Scout e Looter contam como Suporte. Assistir nao conta.',
          '',
          '**Categorias**',
          categoryLines.length ? categoryLines.join('\n') : 'Nenhum ponto registrado ainda.',
          '',
          '**Top membros por categoria**',
          memberLines.length ? memberLines.join('\n') : 'Nenhum ponto registrado ainda.'
        ].join('\n'))
        .setColor(0x805ad5)
        .setTimestamp(new Date())
    ]
  };
}

function careerCategoryEmoji(key) {
  const emojis = {
    classe_tank: formatCustomEmoji(emojiRefs.role.tank) || '\u{1F6E1}\uFE0F',
    classe_healer: formatCustomEmoji(emojiRefs.role.healer) || '\u{1F49A}',
    classe_support: formatCustomEmoji(emojiRefs.role.support) || '\u{1F7E1}',
    classe_dps: formatCustomEmoji(emojiRefs.role.dps) || '\u2694\uFE0F',
    classe_caller: '\u{1F4E3}'
  };
  return emojis[key] || '';
}

function normalizeParticipantRole(role) {
  return eventRoles.includes(role) ? role : null;
}

function eventFunctionName(eventId, participant) {
  const raid = repo.getRaidAvalonParticipant({ eventId, discordId: participant.discord_id });
  if (raid?.weapon_name) return raid.weapon_name;
  const role = normalizeParticipantRole(participant.role);
  return role ? defaultFunctionByRole[role] : null;
}

function statusLabel(status) {
  const labels = {
    created: '\u{1F7E2} Aberto',
    running: '\u{1F7E2} Em andamento',
    review: '\u{1F7E1} Em revisao',
    pending_payment: '\u{1F7E1} Pendente financeiro',
    approved: '\u2705 Finalizado',
    cancelled: '\u{1F534} Cancelado'
  };
  return labels[status] || status;
}
function eventVoiceChannelName(event) {
  const title = formatEventTitle(event.title).replace(/\s+/g, ' ').trim();
  if (!title) return event.event_code;
  return title.slice(0, 90);
}

async function closeAllOpenSessions(eventId, leftAt) {
  const event = repo.getEvent(eventId);
  if (!event) return;
  const participants = repo.listParticipants(eventId);
  for (const participant of participants) {
    closeParticipantOpenSession(eventId, participant.discord_id, leftAt);
  }
}

function closeParticipantOpenSession(eventId, discordId, leftAt) {
  const open = repo.getOpenVoiceSession({ eventId, discordId });
  if (open) {
    const seconds = Math.max(0, Math.floor((Date.parse(leftAt) - Date.parse(open.joined_at)) / 1000));
    repo.closeOpenVoiceSession({ eventId, discordId, leftAt, seconds });
  }
}

module.exports = {
  approveEventPayment,
  addParticipantReview,
  autoJoinRunningEvent,
  cancelEvent,
  checkEventStartWarnings,
  cleanupInactiveEventVoiceChannels,
  cleanupExpiredReviewChannels,
  createPostEventReviewSpace,
  createEventFromFields,
  createEventFromModal,
  createCustomEventFromDraft,
  createGroupDungeonFromDraft,
  createVisualEventFromDraft,
  createRaidAvalonFullFromModal,
  createRaidDragonFromModal,
  createWorldBossFromModal,
  configureSpecialWeaponMode,
  createLootReviewCorrectionDraft,
  confirmLootReviewCorrection,
  cancelLootReviewCorrection,
  deleteEventMessage,
  editParticipantReview,
  finishEvent,
  eventDetailsPayload,
  pingContentIndexPayload,
  eventReminderPayload,
  grantRaidAvalonRewards,
  joinEvent,
  joinCustomEventSlot,
  joinCustomEventDpsWeapon,
  joinVisualEventWeapon,
  joinRaidAvalonHelper,
  joinRaidAvalonRole,
  joinWorldBossSlot,
  leaveWorldBoss,
  pauseParticipation,
  pauseManagedParticipant,
  postDpsMeterSummary,
  previewCareerRebuild,
  raidWeaponBuildUrl,
  raidDefaultObservation,
  raidObservationText,
  raidWeaponIconUrl,
  raidWeaponName,
  raidWeaponOptions,
  raidWeaponRoleOptions,
  raidWeaponSlotOptions,
  raidWeaponSuggestions,
  reassignManagedParticipant,
  refreshEventMessage,
  refreshRaidAvalonCareerPanel,
  repairMisroutedEventPublications,
  reconcileEventWorkflowMessages,
  recoverInterruptedEventReviews,
  recoverRunningEventsOnStartup,
  refreshRunningEventMessages,
  removeWorldBossSlot,
  removeParticipantReview,
  rebuildCareerPoints,
  returnEventToReview,
  reviewComponents,
  reviewEmbed,
  saveLootReview,
  scheduleReviewChannelDeletion,
  moveReviewChannelToClosed,
  submitEventToFinance,
  spectateEvent,
  startEvent,
  startEventWithGuild,
  syncEventWorkflowMessages,
  syncEventPublication,
  syncPingContentIndex,
  updateCreatedEvent,
  updateCreatedEventSlots,
  updateCustomEventDetails,
  updateCustomEventSlotLabels,
  managedParticipantRoleOptions,
  worldBossMemberSlotOptions,
  worldBossSlot,
  worldBossSlotOptions,
  customEventSlotOptions,
  visualWeaponFamilies,
  visualWeaponsForFamily
};
