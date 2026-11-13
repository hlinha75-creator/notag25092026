const names = {
  categories: {
    activeEvents: '⚔️ EVENTOS ATIVOS',
    closedEvents: '📁 EVENTOS FINALIZADOS'
  },
  channels: {
    createEvent: '➕criar-evento',
    participate: 'ping-main',
    deposit: '💰depositos',
    finance: '🧾financeiro-staff',
    consultBalance: '💵consultar-saldo',
    bankLogs: '📒logs-do-banco',
    guildBalances: '🏦saldos-da-guilda',
    adminPanel: '🛠️painel-adm',
    archive: '📦arquivos-csv',
    register: '📝registro',
    registrationRequests: '📥solicitacoes-registro',
    waitingVoice: '🔊 Aguardando Evento'
  }
};

const extraRenames = [
  { kind: 'channel', key: 'moderatorOnly', id: '1499491577163419761', name: '🛡️moderator-only' },
  { kind: 'category', key: 'recruitmentCategory', id: '1481251367426461737', name: '🛡️ RECRUTAMENTO' },
  { kind: 'channel', key: 'welcome', id: '1507460239023407175', name: '👋bem-vindo' },

  { kind: 'category', key: 'guildBankCategory', id: '1481251378679775286', name: '💰 BANCO DA GUILDA' },
  { kind: 'channel', key: 'recruitmentVoice', id: '1492707387700674600', name: '🎤 Recrutamento' },
  { kind: 'channel', key: 'nagacaburosVoice', id: '1481313916909916260', name: '🔊 Nagacaburos' },
  { kind: 'channel', key: 'goldChestVoice', id: '1493604388923773038', name: '🔊 Bau Dourado' },
  { kind: 'channel', key: 'avaVoice', id: '1481297980215656622', name: '🔊 HO Ava | Deeps | Faction' },
  { kind: 'channel', key: 'privateVoice', id: '1481309599322734835', name: '🔒 Privado' },
  { kind: 'channel', key: 'gatheringVoice', id: '1489944901914333374', name: '🌿 Coleta' },
  { kind: 'channel', key: 'hoLochVoice', id: '1497751995552108596', name: '🔊 HO Loch' },
  { kind: 'channel', key: 'xotinhaVoice', id: '1488144990562685078', name: '🔊 Xotinha' },
  { kind: 'channel', key: 'awayVoice', id: '1481715463275679856', name: '💤 Ausente' },

  { kind: 'category', key: 'memberManagementCategory', id: '1481251399454163058', name: '👥 GESTAO DE MEMBROS' },
  { kind: 'channel', key: 'memberExit', id: '1482334950639534110', name: '🚪saida-membros' },
  { kind: 'channel', key: 'memberList', id: '1482334951637516289', name: '📋lista-membros' },

  { kind: 'category', key: 'guildManagementCategory', id: '1481251409281417360', name: '👑 GESTAO DA GUILDA' },
  { kind: 'channel', key: 'staff', id: '1481330015303106570', name: '😎staff' },
  { kind: 'channel', key: 'eventPanel', id: '1481251409897852940', name: '📊painel-de-eventos' },
  { kind: 'channel', key: 'addBalance', id: '1496280233219719209', name: '➕adicionar-saldo' },

  { kind: 'category', key: 'killboardCategory', id: '1481317631280812052', name: '💀 KILLBOARD' },
  { kind: 'channel', key: 'killFeed', id: '1481317632140513395', name: '💀kill-feed' },

  { kind: 'category', key: 'infoCategory', id: '1481321865174712320', name: '🛡️ INFO NOTAG' },
  { kind: 'channel', key: 'wtsItems', id: '1492305645628555334', name: '🛒wts-sell-itens' },
  { kind: 'channel', key: 'wtbItems', id: '1540997572171141191', name: '🛒wtb-buy-itens' },
  { kind: 'channel', key: 'routes', id: '1481322725338251328', name: '🗺️rotas' },
  { kind: 'channel', key: 'dailyBonus', id: '1481322804929626203', name: '🎁daily-bonus' },
  { kind: 'channel', key: 'eightHundredPlus', id: '1481326429634297876', name: '🛡️800-plus' },
  { kind: 'channel', key: 'printEightHundredSpec', id: '1481329368738299965', name: '📸print-800-spec' },
  { kind: 'channel', key: 'dpsMeter', id: '1482081003143958568', name: '📊dps-meter' },
  { kind: 'channel', key: 'usefulSites', id: '1485355323094073394', name: '🔗sites-uteis' },
  { kind: 'channel', key: 'nagaGankGathering', id: '1481323789970309161', name: '💀gank-coleta-do-naga' },
  { kind: 'channel', key: 'gathererDiaries', id: '1481324028349382827', name: '📚diarios-de-coletor' },
  { kind: 'channel', key: 'clips', id: '1481323716070605051', name: '🎥clips' },
  { kind: 'channel', key: 'updates', id: '1484596122776506451', name: '⬆️atualizacoes' },
  { kind: 'channel', key: 'avalonRaidChests', id: '1494504728833560676', name: '💎baus-da-raid-avalon' },
  { kind: 'channel', key: 'reloCore', id: '1495495899147665648', name: '🤝relo-core' },
  { kind: 'channel', key: 'infoForum', id: '1486347262366978140', name: '🛡️info' },
  { kind: 'channel', key: 'avalonBuildsForum', id: '1500923240426639410', name: '🎯builds-raid-avalon' },

  { kind: 'category', key: 'importantCategory', id: '1497902778771701800', name: '📌 IMPORTANTE' },
  { kind: 'channel', key: 'rules', id: '1481325786710409357', name: '📜regras' },
  { kind: 'channel', key: 'announcements', id: '1484312044772655154', name: '📢avisos' },
  { kind: 'channel', key: 'guildEnergies', id: '1480953351393771572', name: '⚡energias-guilda' },
  { kind: 'channel', key: 'notagChat', id: '1481363760110243910', name: '💬chat-notag' }
];

function plannedRenames(ids) {
  return [
    ...Object.entries(names.categories).map(([key, name]) => ({
      kind: 'category',
      key,
      id: ids.categories[key],
      name
    })),
    ...Object.entries(names.channels).map(([key, name]) => ({
      kind: 'channel',
      key,
      id: ids.channels[key],
      name
    })),
    ...extraRenames
  ];
}

async function renameConfiguredChannels(guild, ids, { apply = false } = {}) {
  await guild.channels.fetch();

  const results = [];
  for (const item of plannedRenames(ids)) {
    const channel = guild.channels.cache.get(item.id);
    if (!channel) {
      results.push({ ...item, status: 'missing' });
      continue;
    }

    if (channel.name === item.name) {
      results.push({ ...item, status: 'same', oldName: channel.name });
      continue;
    }

    results.push({ ...item, status: apply ? 'renamed' : 'preview', oldName: channel.name });
    if (apply) {
      await channel.setName(item.name, 'Padronizacao de nomes dos canais da guild Notag');
    }
  }

  return results;
}

function formatRenameResults(results, { apply = false } = {}) {
  const header = apply ? 'Renomes aplicados:' : 'Previa dos renomes:';
  const lines = results.map((item) => {
    if (item.status === 'missing') return `- ${item.kind}.${item.key}: nao encontrado (${item.id})`;
    if (item.status === 'same') return `- ${item.kind}.${item.key}: ja esta como "${item.name}"`;
    return `- ${item.kind}.${item.key}: "${item.oldName}" -> "${item.name}"`;
  });

  const footer = apply ? null : 'Para aplicar, use npm run rename:channels no ambiente administrativo.';
  return [header, ...lines, footer].filter(Boolean).join('\n').slice(0, 1900);
}

module.exports = {
  formatRenameResults,
  extraRenames,
  names,
  plannedRenames,
  renameConfiguredChannels
};
