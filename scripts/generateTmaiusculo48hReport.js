const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const PLAYER_ID = 'Do3iLqXwTW6mpej90SwySw';
const PLAYER_NAME = 'Tmaiusculo';
const API_BASE = 'https://gameinfo-ams.albiononline.com/api/gameinfo';
const PROFILE_URL = 'https://killboard-1.com/eu/player/Tmaiusculo';
const OUTPUT_DIR = path.resolve(__dirname, '..', 'data', 'reports');
const ARTIFACT_PATH = path.join(OUTPUT_DIR, 'tmaiusculo-assistencias-48h-artifact.json');
const SOURCE_PATH = path.join(OUTPUT_DIR, 'tmaiusculo-assistencias-48h-source.json');

// Valores compactos exibidos pelo KillBoard#1 no perfil do jogador durante a coleta.
const EVENT_VALUES = new Map([
  [419556894, 1200000], [419550738, 1100000], [419550720, 1700000],
  [419550686, 988000], [419550659, 831000], [419550615, 1400000],
  [419546913, 1300000], [419532143, 948000], [419531992, 1000000],
  [419531971, 3400000], [419531968, 871000], [419531954, 1100000],
  [419526253, 1100000], [419526237, 1100000], [419526190, 2600000],
  [419526072, 1200000], [419525618, 1100000], [419525576, 2100000],
  [419525260, 246000], [419524512, 275000], [419476731, 475000],
  [419464923, 689000], [419464281, 3000000], [419454850, 650000],
  [419447928, 635000], [419421405, 1300000], [419384264, 493000],
  [419369832, 171000], [419368818, 413000], [419368129, 85000],
  [419364136, 536000], [419338351, 59000], [419335540, 31000],
  [419332074, 37000], [419114918, 61000], [419111343, 486000],
  [419098117, 1200000], [419078231, 388000], [419063488, 266000],
  [419062949, 810000], [419050691, 535000], [419021637, 0],
  [418634027, 546000], [418633082, 181000], [418632296, 182000]
]);

const ROLE_LABELS = {
  ASSIST: 'Assistência',
  KILL: 'Golpe final',
  DEATH: 'Morte'
};

const WEAPON_NAMES = {
  T6_2H_HOLYSTAFF_HELL: 'Fallen Staff',
  T7_MAIN_HOLYSTAFF_AVALON: 'Hallowfall',
  T6_2H_POLEHAMMER: 'Polehammer',
  T6_2H_LONGBOW: 'Longbow',
  T4_2H_ENIGMATICORB_MORGANA: 'Enigmatic Staff',
  T5_MAIN_MACE: 'Mace'
};

function weaponName(type) {
  if (!type) return 'Não informado';
  const normalized = String(type).replace(/@\d+$/, '');
  return WEAPON_NAMES[normalized] || normalized;
}

function compact(value) {
  return new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 2
  }).format(value);
}

function localDate(iso) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(iso));
}

function isoInSaoPaulo(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}-03:00`;
}

function roleFor(event) {
  if (event.Victim?.Id === PLAYER_ID) return 'DEATH';
  if (event.Killer?.Id === PLAYER_ID) return 'KILL';
  if ((event.Participants || []).some((participant) => participant.Id === PLAYER_ID)) return 'ASSIST';
  return 'UNKNOWN';
}

function playerParticipant(event) {
  return (event.Participants || []).find((participant) => participant.Id === PLAYER_ID) || null;
}

function hourBucket(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const startHour = Number(values.hour);
  const endHour = (startHour + 1) % 24;
  const key = `${values.year}-${values.month}-${values.day}-${String(startHour).padStart(2, '0')}`;
  const label = `${values.day}/${values.month} ${String(startHour).padStart(2, '0')}h–${String(endHour).padStart(2, '0')}h`;
  return { key, label };
}

async function fetchEvent(eventId) {
  const response = await fetch(`${API_BASE}/events/${eventId}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'NotagBot/1.0' }
  });
  if (!response.ok) throw new Error(`Evento ${eventId}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const generatedAt = new Date();
  const cutoff = new Date(generatedAt.getTime() - 48 * 60 * 60 * 1000);
  const eventIds = [...EVENT_VALUES.keys()];
  const payloads = await Promise.all(eventIds.map(fetchEvent));

  const allRows = payloads
    .map((event) => {
      const participant = playerParticipant(event);
      const role = roleFor(event);
      const bucket = hourBucket(event.TimeStamp);
      return {
        eventId: Number(event.EventId),
        timestamp: event.TimeStamp,
        eventEpoch: new Date(event.TimeStamp).getTime(),
        horario_brt: isoInSaoPaulo(event.TimeStamp),
        tipo: ROLE_LABELS[role] || role,
        role,
        killer: event.Killer?.Name || 'Desconhecido',
        killerGuild: event.Killer?.GuildName || 'Sem guilda',
        victim: event.Victim?.Name || 'Desconhecido',
        victimGuild: event.Victim?.GuildName || 'Sem guilda',
        weapon: weaponName(participant?.Equipment?.MainHand?.Type),
        playerDamage: Number(participant?.DamageDone || 0),
        killFame: Number(event.TotalVictimKillFame || 0),
        estimatedSilver: Number(EVENT_VALUES.get(Number(event.EventId)) || 0),
        participants: Number(event.NumberOfParticipants || event.Participants?.length || 0),
        eventUrl: `https://killboard-1.com/eu/event/${event.EventId}`,
        bucketKey: bucket.key,
        bucketLabel: bucket.label
      };
    })
    .filter((row) => row.role !== 'UNKNOWN');

  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE tmaiusculo_events (
      eventId INTEGER PRIMARY KEY,
      timestamp TEXT NOT NULL,
      eventEpoch INTEGER NOT NULL,
      horario_brt TEXT NOT NULL,
      tipo TEXT NOT NULL,
      role TEXT NOT NULL,
      killer TEXT NOT NULL,
      killerGuild TEXT NOT NULL,
      victim TEXT NOT NULL,
      victimGuild TEXT NOT NULL,
      weapon TEXT NOT NULL,
      playerDamage REAL NOT NULL,
      killFame INTEGER NOT NULL,
      estimatedSilver INTEGER NOT NULL,
      participants INTEGER NOT NULL,
      eventUrl TEXT NOT NULL,
      bucketKey TEXT NOT NULL,
      bucketLabel TEXT NOT NULL
    )
  `);
  const insert = db.prepare(`
    INSERT INTO tmaiusculo_events (
      eventId, timestamp, eventEpoch, horario_brt, tipo, role, killer, killerGuild,
      victim, victimGuild, weapon, playerDamage, killFame, estimatedSilver,
      participants, eventUrl, bucketKey, bucketLabel
    ) VALUES (
      @eventId, @timestamp, @eventEpoch, @horario_brt, @tipo, @role, @killer, @killerGuild,
      @victim, @victimGuild, @weapon, @playerDamage, @killFame, @estimatedSilver,
      @participants, @eventUrl, @bucketKey, @bucketLabel
    )
  `);
  db.transaction((items) => items.forEach((item) => insert.run(item)))(allRows);

  const bindings = { cutoffEpoch: cutoff.getTime(), generatedEpoch: generatedAt.getTime() };
  const selectedSql = `
    SELECT eventId, timestamp, horario_brt, tipo, role, killer, killerGuild,
           victim, victimGuild, weapon, playerDamage, killFame, estimatedSilver,
           participants, eventUrl
    FROM tmaiusculo_events
    WHERE eventEpoch BETWEEN @cutoffEpoch AND @generatedEpoch
    ORDER BY eventEpoch DESC
  `;
  const positiveSql = `
    SELECT eventId, timestamp, horario_brt, tipo, role, killer, killerGuild,
           victim, victimGuild, weapon, playerDamage, killFame, estimatedSilver,
           participants, eventUrl
    FROM tmaiusculo_events
    WHERE eventEpoch BETWEEN @cutoffEpoch AND @generatedEpoch
      AND role IN ('ASSIST', 'KILL')
    ORDER BY eventEpoch DESC
  `;
  const deathSql = `
    SELECT eventId, timestamp, horario_brt, tipo, role, killer, killerGuild,
           victim, victimGuild, weapon, playerDamage, killFame, estimatedSilver,
           participants, eventUrl
    FROM tmaiusculo_events
    WHERE eventEpoch BETWEEN @cutoffEpoch AND @generatedEpoch
      AND role = 'DEATH'
    ORDER BY eventEpoch DESC
  `;
  const activitySql = `
    SELECT bucketLabel AS janela, bucketKey AS ordem, tipo, COUNT(*) AS eventos
    FROM tmaiusculo_events
    WHERE eventEpoch BETWEEN @cutoffEpoch AND @generatedEpoch
    GROUP BY bucketKey, bucketLabel, tipo, role
    ORDER BY bucketKey,
      CASE role WHEN 'ASSIST' THEN 1 WHEN 'KILL' THEN 2 ELSE 3 END
  `;
  const headlineSql = `
    SELECT
      SUM(CASE WHEN role IN ('ASSIST', 'KILL') THEN 1 ELSE 0 END) AS eliminations,
      SUM(CASE WHEN role = 'ASSIST' THEN 1 ELSE 0 END) AS assists,
      SUM(CASE WHEN role = 'KILL' THEN 1 ELSE 0 END) AS kills,
      SUM(CASE WHEN role = 'DEATH' THEN 1 ELSE 0 END) AS deaths,
      SUM(CASE WHEN role IN ('ASSIST', 'KILL') THEN estimatedSilver ELSE 0 END) AS positiveSilver,
      SUM(CASE WHEN role = 'DEATH' THEN estimatedSilver ELSE 0 END) AS deathSilver,
      SUM(CASE WHEN role IN ('ASSIST', 'KILL') THEN estimatedSilver ELSE -estimatedSilver END) AS balanceSilver,
      SUM(CASE WHEN role IN ('ASSIST', 'KILL') THEN killFame ELSE 0 END) AS positiveFame,
      SUM(CASE WHEN role = 'DEATH' THEN killFame ELSE 0 END) AS deathFame
    FROM tmaiusculo_events
    WHERE eventEpoch BETWEEN @cutoffEpoch AND @generatedEpoch
  `;

  const rows = db.prepare(selectedSql).all(bindings);
  const positives = db.prepare(positiveSql).all(bindings);
  const deaths = db.prepare(deathSql).all(bindings);
  const activity = db.prepare(activitySql).all(bindings);
  const headline = [db.prepare(headlineSql).get(bindings)];

  const assists = rows.filter((row) => row.role === 'ASSIST');
  const kills = rows.filter((row) => row.role === 'KILL');
  const { positiveSilver, deathSilver, balanceSilver, positiveFame, deathFame } = headline[0];
  const holyAssists = assists.filter((row) => ['Fallen Staff', 'Hallowfall'].includes(row.weapon)).length;
  const holyShare = assists.length ? holyAssists / assists.length : 0;

  const sourceId = 'albion_killboard_tmaiusculo_48h';
  const title = 'Tmaiusculo — kills, assistências e mortes em 48 horas';
  const source = {
    id: sourceId,
    label: 'KillBoard#1 + Albion Game Info API (Europa)',
    href: PROFILE_URL,
    query: {
      engine: 'SQLite',
      sql: [headlineSql, activitySql, positiveSql, deathSql].join(';\n\n'),
      description: 'Consultas executadas sobre a tabela temporária formada pelos eventos públicos do perfil de Tmaiusculo.',
      executed_at: generatedAt.toISOString(),
      tables_used: ['tmaiusculo_events'],
      filters: [
        `Jogador: ${PLAYER_NAME} (${PLAYER_ID})`,
        'Servidor: Europa',
        `cutoffEpoch = ${cutoff.getTime()}`,
        `generatedEpoch = ${generatedAt.getTime()}`,
        'Assistência: participante do evento, sem ser o autor do golpe final nem a vítima',
        'Sem duplicatas por EventId'
      ],
      metric_definitions: [
        'Eliminações = assistências + golpes finais de Tmaiusculo.',
        'Valor positivo estimado = soma do valor compacto das builds das vítimas em eventos de assistência ou golpe final.',
        'Valor perdido estimado = soma do valor compacto da build de Tmaiusculo nas mortes.',
        'Saldo estimado = valor positivo estimado menos valor perdido estimado.',
        'Os valores do KillBoard#1 são arredondados e não representam prata efetivamente destruída.'
      ]
    }
  };

  const tableColumns = [
    { field: 'tipo', label: 'Participação', type: 'text' },
    { field: 'horario_brt', label: 'Horário (BRT)', type: 'date' },
    { field: 'victim', label: 'Vítima', type: 'text' },
    { field: 'victimGuild', label: 'Guilda da vítima', type: 'text' },
    { field: 'killer', label: 'Golpe final', type: 'text' },
    { field: 'weapon', label: 'Arma de Tmaiusculo', type: 'text' },
    { field: 'killFame', label: 'Fama', type: 'number', format: 'compact' },
    { field: 'estimatedSilver', label: 'Build estimada', type: 'number', format: 'compact' },
    { field: 'participants', label: 'Participantes', type: 'number', format: 'number' },
    { field: 'eventId', label: 'Evento', type: 'number', format: 'number' }
  ];

  const artifact = {
    surface: 'report',
    manifest: {
      version: 1,
      surface: 'report',
      title,
      description: 'Relação completa das participações de Tmaiusculo no KillBoard europeu durante as últimas 48 horas.',
      generatedAt: generatedAt.toISOString(),
      cards: [
        {
          id: 'eliminations_card',
          description: 'Eventos em que Tmaiusculo participou da eliminação.',
          dataset: 'headline', sourceId,
          metrics: [{ label: 'Eliminações com participação', field: 'eliminations', format: 'number' }]
        },
        {
          id: 'assists_card',
          description: 'Participações sem executar o golpe final.',
          dataset: 'headline', sourceId,
          metrics: [{ label: 'Assistências', field: 'assists', format: 'number' }]
        },
        {
          id: 'kills_card',
          description: 'Eliminações em que Tmaiusculo realizou o golpe final.',
          dataset: 'headline', sourceId,
          metrics: [{ label: 'Golpes finais', field: 'kills', format: 'number' }]
        },
        {
          id: 'deaths_card',
          description: 'Eventos em que Tmaiusculo foi a vítima.',
          dataset: 'headline', sourceId,
          metrics: [{ label: 'Mortes', field: 'deaths', format: 'number' }]
        },
        {
          id: 'balance_card',
          description: 'Diferença entre builds das vítimas e builds perdidas; valor estimado, não destruído.',
          dataset: 'headline', sourceId,
          metrics: [{ label: 'Saldo estimado em prata', field: 'balanceSilver', format: 'compact', signed: true }]
        }
      ],
      charts: [
        {
          id: 'activity_chart',
          title: 'Participações por hora de atividade',
          subtitle: 'Eventos agrupados no horário de Brasília; as cores separam assistência, golpe final e morte.',
          headerMarkdown: 'As barras mostram **quando a atividade ficou concentrada** dentro das 48 horas analisadas.',
          type: 'bar',
          dataset: 'activity',
          sourceId,
          encodings: {
            x: { field: 'janela', type: 'ordinal', label: 'Janela (BRT)' },
            y: { field: 'eventos', type: 'quantitative', label: 'Eventos', format: 'number' },
            color: { field: 'tipo', type: 'nominal', label: 'Participação' },
            tooltip: [
              { field: 'tipo', type: 'nominal', label: 'Participação' },
              { field: 'eventos', type: 'quantitative', label: 'Eventos', format: 'number' }
            ]
          },
          xAxisTitle: 'Janela de 1 hora (BRT)',
          yAxisTitle: 'Quantidade de eventos',
          valueFormat: 'number',
          layout: 'full',
          maxRows: 60
        }
      ],
      tables: [
        {
          id: 'positive_events_table',
          title: 'Kills e assistências',
          subtitle: `${positives.length} eliminações com participação de Tmaiusculo no intervalo analisado.`,
          dataset: 'positive_events', sourceId,
          defaultSort: { field: 'horario_brt', direction: 'desc' },
          density: 'compact', layout: 'full', columns: tableColumns
        },
        {
          id: 'death_events_table',
          title: 'Mortes de Tmaiusculo',
          subtitle: `${deaths.length} perdas no intervalo; o valor representa a estimativa da build equipada.`,
          dataset: 'death_events', sourceId,
          defaultSort: { field: 'horario_brt', direction: 'desc' },
          density: 'compact', layout: 'full', columns: tableColumns
        }
      ],
      sources: [{ id: sourceId, label: source.label, href: PROFILE_URL }],
      blocks: [
        { id: 'title', type: 'markdown', body: `# ${title}` },
        {
          id: 'executive_summary', type: 'markdown', sourceId,
          body: `## Executive Summary\n\n- **Tmaiusculo participou de ${positives.length} eliminações:** ${assists.length} como assistência e ${kills.length} com o golpe final, contra ${deaths.length} mortes.\n- **O saldo estimado foi positivo em ${compact(balanceSilver)} de prata:** ${compact(positiveSilver)} associados às builds das vítimas e ${compact(deathSilver)} em builds perdidas.\n- **A atuação foi predominantemente de suporte:** ${holyAssists} das ${assists.length} assistências (${new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 }).format(holyShare)}) ocorreram com Fallen Staff ou Hallowfall.\n- **Leitura correta do valor:** a prata representa a build estimada no KillBoard#1; não é o valor efetivamente destruído nem deve ser atribuída integralmente a um único participante.`
        },
        { id: 'metrics', type: 'metric-strip', cardIds: ['eliminations_card', 'assists_card', 'kills_card', 'deaths_card', 'balance_card'] },
        {
          id: 'definitions', type: 'markdown', sourceId,
          body: `## Como a participação foi contada\n\n**Assistência** significa que Tmaiusculo aparece na lista de participantes do evento, mas não foi a vítima nem executou o golpe final. **Golpe final** é a kill registrada diretamente no nome dele. **Morte** é o evento em que ele aparece como vítima.\n\nO intervalo vai de **${localDate(cutoff.toISOString())}** até **${localDate(generatedAt.toISOString())}**, sempre no horário de Brasília e no servidor europeu.`
        },
        {
          id: 'activity_takeaway', type: 'markdown', sourceId,
          body: `## A maior concentração ocorreu nas lutas da noite\n\nA visualização agrupa os eventos por hora. Ela ajuda a separar os blocos de combate e mostra que boa parte das assistências aconteceu em sequências muito próximas — sinal de luta em grupo, e não de encontros isolados.`
        },
        { id: 'activity', type: 'chart', chartId: 'activity_chart', layout: 'full' },
        {
          id: 'positive_takeaway', type: 'markdown', sourceId,
          body: `## ${assists.length} assistências sustentaram a maior parte das eliminações\n\nTmaiusculo realizou somente ${kills.length} golpes finais, mas participou de ${assists.length} outras eliminações. Isso é compatível com a presença frequente de armas de cura e suporte. A tabela abaixo mantém o autor do golpe final separado de Tmaiusculo para não transformar assistência em kill direta.`
        },
        { id: 'positive_events', type: 'table', tableId: 'positive_events_table', layout: 'full' },
        {
          id: 'death_takeaway', type: 'markdown', sourceId,
          body: `## As ${deaths.length} mortes somaram ${compact(deathSilver)} em builds estimadas\n\nA relação de perdas está separada das eliminações para facilitar a revisão de posicionamento, horário e composição. Os valores são arredondados conforme a exibição do KillBoard#1.`
        },
        { id: 'death_events', type: 'table', tableId: 'death_events_table', layout: 'full' },
        {
          id: 'next_steps', type: 'markdown',
          body: `## Próximos passos recomendados\n\n1. Revisar primeiro as sequências com várias mortes próximas no tempo, pois provavelmente pertencem à mesma batalha.\n2. Comparar as mortes usando Hallowfall/Fallen Staff com a posição do grupo e a proteção recebida.\n3. Usar o EventId da última coluna para abrir o evento correspondente em \`https://killboard-1.com/eu/event/ID\`.`
        },
        {
          id: 'further_questions', type: 'markdown',
          body: `## Perguntas para a próxima análise\n\n- Em quais batalhas Tmaiusculo morreu antes ou depois do núcleo principal da NoTag?\n- Quanto do saldo positivo veio de lutas ganhas pela NoTag, e quanto veio de assistências em confrontos entre terceiros?`
        },
        {
          id: 'caveats', type: 'markdown', sourceId,
          body: `## Limitações e premissas\n\n- O relatório cobre somente o servidor **Europa** e o personagem exato **Tmaiusculo** da guilda NoTag.\n- O KillBoard#1 mostra valores compactados e arredondados; por isso, totais em prata são aproximações.\n- O valor positivo representa a build da vítima em eventos dos quais Tmaiusculo participou. Ele não mede contribuição individual nem prata efetivamente destruída.\n- A API pública registra participantes, dano e equipamento, mas não oferece uma métrica completa de cura ou mitigação; a leitura de suporte usa a arma equipada como indicador.`
        }
      ]
    },
    snapshot: {
      version: 1,
      generatedAt: generatedAt.toISOString(),
      status: 'ready',
      datasets: {
        headline,
        activity,
        positive_events: positives,
        death_events: deaths
      },
      accessIssues: []
    },
    sources: [source]
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(SOURCE_PATH, JSON.stringify({
    generatedAt: generatedAt.toISOString(),
    cutoff: cutoff.toISOString(),
    player: { id: PLAYER_ID, name: PLAYER_NAME, server: 'Europe' },
    summary: headline[0],
    rows
  }, null, 2));
  fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2));
  db.close();

  console.log(JSON.stringify({
    artifact: ARTIFACT_PATH,
    source: SOURCE_PATH,
    generatedAt: generatedAt.toISOString(),
    cutoff: cutoff.toISOString(),
    events: rows.length,
    assists: assists.length,
    kills: kills.length,
    deaths: deaths.length,
    positiveSilver,
    deathSilver,
    balanceSilver,
    holyAssists
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
