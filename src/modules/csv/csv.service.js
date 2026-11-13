const { AttachmentBuilder } = require('discord.js');
const ids = require('../../config/ids');
const { backupDatabase } = require('../../database/backup');
const { transaction } = require('../../database/connection');
const { formatSilver, parseSilver } = require('../../utils/silver');
const { parseCsv, toCsv } = require('../../utils/csv');
const { htmlReportAttachment } = require('../../utils/htmlReport');
const audit = require('../audit/audit.repository');
const financeRepo = require('../finance/finance.repository');
const registrationRepo = require('../registration/registration.repository');
const finance = require('../finance/finance.service');
const voiceRepo = require('../voice/voice.repository');

const importPreviews = new Map();

function exactSilver(amount) {
  return `${new Intl.NumberFormat('pt-BR').format(Number(amount || 0))} prata`;
}

function activeMemberBalanceRows() {
  return financeRepo.listActivePositiveBalances().map((row) => ({
    jogador: row.albion_name || row.discord_name || row.discord_id,
    discord: row.discord_name || '',
    discord_id: row.discord_id,
    saldo_prata: Number(row.balance || 0),
    atualizado_em: row.last_updated || ''
  }));
}

function activeMemberBalancesHtmlAttachment() {
  const rows = activeMemberBalanceRows();
  const total = rows.reduce((sum, row) => sum + row.saldo_prata, 0);
  return htmlReportAttachment({
    title: 'Saldos positivos gerais',
    subtitle: 'Todos os saldos positivos, independente do cargo atual.',
    fileName: 'saldos-geral-membros.html',
    csvName: 'saldos-geral-membros.csv',
    rows,
    columns: [
      { key: 'jogador', label: 'Jogador' },
      { key: 'discord', label: 'Discord' },
      { key: 'discord_id', label: 'Discord ID' },
      { key: 'saldo_prata', label: 'Saldo exato', align: 'right', format: exactSilver },
      { key: 'atualizado_em', label: 'Atualizado em' }
    ],
    summary: [
      ['Cadastros com saldo positivo', rows.length],
      ['Total', exactSilver(total)]
    ]
  });
}

function activeMemberBalancesCsvAttachment() {
  const rows = activeMemberBalanceRows();
  const content = toCsv(rows, ['jogador', 'discord', 'discord_id', 'saldo_prata', 'atualizado_em']);
  return new AttachmentBuilder(Buffer.from(`\uFEFF${content}`, 'utf8'), { name: 'saldos-geral-membros.csv' });
}

function balancesAttachment() {
  const rows = financeRepo.listBalances();
  return htmlReportAttachment({
    title: 'Saldos da guilda',
    fileName: 'saldos-guilda.html',
    csvName: 'saldos-guilda.csv',
    rows,
    columns: [
      'discord_id',
      'discord_name',
      'albion_name',
      { key: 'balance', label: 'balance', align: 'right', format: formatSilver },
      'last_updated'
    ],
    summary: [
      ['Membros com saldo', rows.length],
      ['Total', formatSilver(rows.reduce((total, row) => total + Number(row.balance || 0), 0))]
    ]
  });
}

async function balancesHtmlAttachment(guild = null) {
  const rows = financeRepo.listAllBalances().map((row) => ({
    discord_id: row.discord_id || '',
    discord_name: row.discord_name || '',
    albion_name: row.albion_name || '',
    balance: Number(row.balance || 0),
    last_updated: row.last_updated || '',
    guild_status: '',
    voice_seconds: 0,
    voice_time: ''
  }));
  const enrichedRows = guild ? await discordMemberBalanceRows(rows, guild) : rows;
  return new AttachmentBuilder(Buffer.from(renderBalancesHtml(enrichedRows), 'utf8'), { name: 'saldos-guilda.html' });
}

async function discordMemberBalanceRows(balanceRows, guild) {
  const members = await guild.members.fetch().catch(() => null);
  if (!members) return balanceRows;

  const byDiscordId = new Map(balanceRows.filter((row) => row.discord_id).map((row) => [row.discord_id, row]));
  const voiceByDiscordId = voiceTotalsByDiscordId();
  const rows = [];

  for (const member of members.values()) {
    if (member.user?.bot) continue;
    const existing = byDiscordId.get(member.id);
    const voiceSeconds = voiceByDiscordId.get(member.id) || 0;
    rows.push({
      discord_id: member.id,
      discord_name: member.displayName || member.user?.tag || member.user?.username || member.id,
      albion_name: existing?.albion_name || '',
      balance: Number(existing?.balance || 0),
      last_updated: existing?.last_updated || '',
      guild_status: memberGuildStatus(member),
      voice_seconds: voiceSeconds,
      voice_time: formatVoiceTime(voiceSeconds)
    });
  }

  for (const row of balanceRows) {
    if (!row.discord_id || members.has(row.discord_id)) continue;
    const voiceSeconds = voiceByDiscordId.get(row.discord_id) || 0;
    rows.push({
      ...row,
      guild_status: 'Fora do Discord',
      voice_seconds: voiceSeconds,
      voice_time: formatVoiceTime(voiceSeconds)
    });
  }

  return rows.sort((a, b) => balanceName(a).localeCompare(balanceName(b), 'pt-BR', { sensitivity: 'base' }));
}

function voiceTotalsByDiscordId() {
  const totals = new Map();
  for (const session of voiceRepo.listSessions(100000)) {
    totals.set(session.discord_id, (totals.get(session.discord_id) || 0) + Number(session.seconds || 0));
  }
  return totals;
}

function memberGuildStatus(member) {
  if (member.roles.cache.has(ids.roles.member)) return 'Membro';
  if (member.roles.cache.has(ids.roles.guest)) return 'Convidado';
  if (member.roles.cache.has(ids.roles.noTag)) return 'Sem tag';
  return 'Sem cargo';
}

function formatVoiceTime(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}h${String(minutes).padStart(2, '0')}m`;
}

function balanceName(row) {
  return row.albion_name || row.discord_name || row.discord_id || '';
}

function renderBalancesHtml(rows) {
  const generatedAt = new Date().toISOString();
  const json = JSON.stringify(rows).replace(/</g, '\\u003c');
  const csvColumns = ['discord_id', 'discord_name', 'albion_name', 'balance', 'last_updated', 'guild_status', 'voice_seconds', 'voice_time'];
  const csvData = toCsv(rows, csvColumns);
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Saldos da guilda</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #1f2937;
      --muted: #667085;
      --line: #d9dee7;
      --accent: #0f766e;
      --danger: #b42318;
      --warn: #b54708;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(1180px, calc(100% - 32px));
      margin: 24px auto 40px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-end;
      margin-bottom: 18px;
    }
    h1 { margin: 0 0 6px; font-size: 28px; }
    p { margin: 0; color: var(--muted); }
    .header-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    button {
      border: 0;
      border-radius: 7px;
      padding: 10px 12px;
      color: #fff;
      background: #2563eb;
      font-weight: 800;
      cursor: pointer;
    }
    button.secondary { background: #475467; }
    .filters, .metrics, .table-wrap {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .filters {
      display: grid;
      grid-template-columns: minmax(220px, 1.3fr) repeat(4, minmax(140px, 1fr));
      gap: 12px;
      padding: 14px;
      margin-bottom: 14px;
    }
    label {
      display: grid;
      gap: 6px;
      font-size: 12px;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
    }
    input, select {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 10px;
      font: inherit;
      color: var(--text);
      background: #fff;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 1px;
      overflow: hidden;
      margin-bottom: 14px;
    }
    .metric {
      padding: 14px;
      background: #fff;
    }
    .metric span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .metric strong {
      display: block;
      margin-top: 5px;
      font-size: 22px;
    }
    .table-wrap { overflow: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 860px;
      background: #fff;
    }
    th, td {
      padding: 11px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      background: #f8fafc;
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      z-index: 1;
    }
    td.amount, th.amount { text-align: right; }
    .name { font-weight: 800; }
    .sub { color: var(--muted); font-size: 13px; margin-top: 2px; }
    .positive { color: var(--accent); font-weight: 800; }
    .negative { color: var(--danger); font-weight: 800; }
    .zero { color: var(--warn); font-weight: 800; }
    .empty {
      padding: 28px;
      text-align: center;
      color: var(--muted);
    }
    @media (max-width: 820px) {
      main { width: min(100% - 20px, 1180px); margin-top: 14px; }
      header { display: block; }
      .filters { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Saldos da guilda</h1>
        <p>Gerado em ${escapeHtml(generatedAt)}. Use os filtros para procurar membros e faixas de saldo.</p>
      </div>
      <div class="header-actions">
        <p id="visibleCount">0 linhas</p>
        <button onclick="downloadCsv()">Baixar CSV</button>
        <button class="secondary" onclick="copyCsv()">Copiar CSV</button>
      </div>
    </header>

    <section class="filters">
      <label>Buscar
        <input id="search" type="search" placeholder="Nick, Discord ou ID">
      </label>
      <label>Status
        <select id="status">
          <option value="">Todos</option>
          <option value="positive">Saldo positivo</option>
          <option value="zero">Saldo zero</option>
          <option value="negative">Saldo negativo</option>
        </select>
      </label>
      <label>Tag
        <select id="guildStatus">
          <option value="">Todos</option>
          <option value="Membro">Membro</option>
          <option value="Convidado">Convidado</option>
          <option value="Sem tag">Sem tag</option>
          <option value="Sem cargo">Sem cargo</option>
          <option value="Fora do Discord">Fora do Discord</option>
        </select>
      </label>
      <label>Saldo minimo
        <input id="minBalance" type="number" inputmode="numeric" placeholder="Ex: 0">
      </label>
      <label>Ordenar
        <select id="sort">
          <option value="name">Nome A-Z</option>
          <option value="balance_desc">Maior saldo</option>
          <option value="balance_asc">Menor saldo</option>
          <option value="voice_desc">Mais tempo em call</option>
          <option value="updated_desc">Atualizado recente</option>
        </select>
      </label>
    </section>

    <section class="metrics" id="metrics"></section>
    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Membro</th>
            <th>Discord</th>
            <th>Tag</th>
            <th>ID</th>
            <th class="amount">Saldo</th>
            <th>Call voz</th>
            <th>Atualizado</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </section>
  </main>
  <script>
    const balances = ${json};
    const csvData = ${JSON.stringify(csvData)};
    const csvName = 'saldos-guilda.csv';
    const search = document.querySelector('#search');
    const status = document.querySelector('#status');
    const guildStatus = document.querySelector('#guildStatus');
    const minBalance = document.querySelector('#minBalance');
    const sort = document.querySelector('#sort');
    const rowsEl = document.querySelector('#rows');
    const metricsEl = document.querySelector('#metrics');
    const visibleCount = document.querySelector('#visibleCount');

    for (const input of [search, status, guildStatus, minBalance, sort]) {
      input.addEventListener('input', render);
      input.addEventListener('change', render);
    }

    function normalize(value) {
      return String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
    }

    function filteredRows() {
      const query = normalize(search.value);
      const min = minBalance.value === '' ? null : Number(minBalance.value);
      const statusValue = status.value;
      const guildStatusValue = guildStatus.value;
      return balances
        .filter((row) => !query || normalize(row.albion_name + ' ' + row.discord_name + ' ' + row.discord_id + ' ' + row.guild_status).includes(query))
        .filter((row) => statusValue !== 'positive' || row.balance > 0)
        .filter((row) => statusValue !== 'zero' || row.balance === 0)
        .filter((row) => statusValue !== 'negative' || row.balance < 0)
        .filter((row) => !guildStatusValue || row.guild_status === guildStatusValue)
        .filter((row) => min == null || row.balance >= min)
        .sort(sorter(sort.value));
    }

    function sorter(mode) {
      if (mode === 'balance_desc') return (a, b) => b.balance - a.balance || nameOf(a).localeCompare(nameOf(b));
      if (mode === 'balance_asc') return (a, b) => a.balance - b.balance || nameOf(a).localeCompare(nameOf(b));
      if (mode === 'voice_desc') return (a, b) => Number(b.voice_seconds || 0) - Number(a.voice_seconds || 0) || nameOf(a).localeCompare(nameOf(b));
      if (mode === 'updated_desc') return (a, b) => String(b.last_updated).localeCompare(String(a.last_updated));
      return (a, b) => nameOf(a).localeCompare(nameOf(b));
    }

    function nameOf(row) {
      return row.albion_name || row.discord_name || row.discord_id || '';
    }

    function render() {
      const rows = filteredRows();
      const total = rows.reduce((sum, row) => sum + row.balance, 0);
      const positive = rows.filter((row) => row.balance > 0).length;
      const zero = rows.filter((row) => row.balance === 0).length;
      const negative = rows.filter((row) => row.balance < 0).length;
      const voiceTotal = rows.reduce((sum, row) => sum + Number(row.voice_seconds || 0), 0);
      visibleCount.textContent = rows.length + ' linhas';
      metricsEl.innerHTML = [
        metric('Membros Discord', rows.length),
        metric('Total filtrado', silver(total)),
        metric('Positivos', positive),
        metric('Zerados', zero),
        metric('Call voz', voiceTime(voiceTotal))
      ].join('');
      rowsEl.innerHTML = rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="7" class="empty">Nenhum saldo encontrado com esses filtros.</td></tr>';
    }

    function metric(label, value) {
      return '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
    }

    function rowHtml(row) {
      const klass = row.balance > 0 ? 'positive' : row.balance < 0 ? 'negative' : 'zero';
      return '<tr>' +
        '<td><div class="name">' + escapeHtml(row.albion_name || '-') + '</div><div class="sub">' + escapeHtml(row.discord_name || '-') + '</div></td>' +
        '<td>' + escapeHtml(row.discord_name || '-') + '</td>' +
        '<td>' + escapeHtml(row.guild_status || '-') + '</td>' +
        '<td>' + escapeHtml(row.discord_id || '-') + '</td>' +
        '<td class="amount ' + klass + '">' + silver(row.balance) + '</td>' +
        '<td>' + escapeHtml(row.voice_time || '0h00m') + '</td>' +
        '<td>' + escapeHtml(row.last_updated || '-') + '</td>' +
      '</tr>';
    }

    function silver(value) {
      return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
    }

    function voiceTime(seconds) {
      const total = Math.max(0, Number(seconds || 0));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      return hours + 'h' + String(minutes).padStart(2, '0') + 'm';
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char]));
    }

    function downloadCsv() {
      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = csvName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    async function copyCsv() {
      try {
        await navigator.clipboard.writeText(csvData);
        alert('CSV copiado.');
      } catch (error) {
        downloadCsv();
        alert('Seu navegador bloqueou copiar. Baixei o CSV no lugar.');
      }
    }

    render();
  </script>
</body>
</html>`;
}

function transactionsAttachment() {
  const rows = financeRepo.listTransactions(5000).map((row) => ({
    id: row.id,
    type: row.type,
    user_id: row.user_id,
    amount: row.amount,
    before_balance: row.before_balance,
    after_balance: row.after_balance,
    reason: row.reason,
    created_by: row.created_by,
    created_at: row.created_at
  }));
  return htmlReportAttachment({
    title: 'Logs financeiros',
    fileName: 'logs-financeiros.html',
    csvName: 'logs-financeiros.csv',
    rows,
    columns: [
      'id',
      'type',
      'user_id',
      { key: 'amount', label: 'amount', align: 'right', format: formatSilver },
      { key: 'before_balance', label: 'before_balance', align: 'right', format: formatSilver },
      { key: 'after_balance', label: 'after_balance', align: 'right', format: formatSilver },
      'reason',
      'created_by',
      'created_at'
    ],
    summary: [
      ['Transacoes', rows.length],
      ['Entradas', formatSilver(rows.filter((row) => Number(row.amount || 0) > 0).reduce((total, row) => total + Number(row.amount || 0), 0))],
      ['Saidas', formatSilver(rows.filter((row) => Number(row.amount || 0) < 0).reduce((total, row) => total + Number(row.amount || 0), 0))]
    ]
  });
}

function auditAttachment() {
  const rows = audit.listAuditLogs(5000);
  return htmlReportAttachment({
    title: 'Auditoria',
    fileName: 'audit-logs.html',
    csvName: 'audit-logs.csv',
    rows,
    columns: ['id', 'type', 'actor_id', 'target_id', 'before_value', 'after_value', 'reason', 'metadata', 'created_at'],
    summary: [['Registros', rows.length]]
  });
}

function voiceAttachment() {
  const rows = voiceRepo.listSessions(20000).map((row) => ({
    ...row,
    weekday: weekdayName(row.joined_at),
    joined_hour: hourOfDay(row.joined_at),
    duration_minutes: Math.round((row.seconds / 60) * 100) / 100
  }));
  const columns = [
    'id',
    'discord_id',
    'discord_name',
    'albion_name',
    'channel_id',
    'channel_name',
    'category_id',
    'category_name',
    'joined_at',
    'left_at',
    'seconds',
    'duration_minutes',
    'weekday',
    'joined_hour'
  ];
  return htmlReportAttachment({
    title: 'Sessoes de voz',
    fileName: 'voice-sessions.html',
    csvName: 'voice-sessions.csv',
    rows,
    columns,
    summary: [
      ['Sessoes', rows.length],
      ['Tempo total', formatVoiceTime(rows.reduce((total, row) => total + Number(row.seconds || 0), 0))]
    ]
  });
}

function voiceDailyAttachment(dateText = todayIsoDate()) {
  dateText = normalizeIsoDate(dateText);
  const sessions = voiceRepo.listSessions(50000).filter((session) => dateInSaoPaulo(session.joined_at) === dateText);
  const byMember = new Map();

  for (const session of sessions) {
    const key = session.discord_id;
    const item = byMember.get(key) || {
      date: dateText,
      discord_id: session.discord_id,
      discord_name: session.discord_name || '',
      albion_name: session.albion_name || '',
      voice_sessions: 0,
      voice_seconds: 0,
      voice_minutes: 0,
      first_joined_at: session.joined_at,
      last_left_at: session.left_at || '',
      top_channels: new Map(),
      favorite_hours: new Map(),
      weekday: weekdayName(session.joined_at)
    };

    item.voice_sessions += 1;
    item.voice_seconds += session.seconds;
    item.voice_minutes = Math.round((item.voice_seconds / 60) * 100) / 100;
    if (session.joined_at < item.first_joined_at) item.first_joined_at = session.joined_at;
    if ((session.left_at || '') > item.last_left_at) item.last_left_at = session.left_at || '';
    incrementMap(item.top_channels, session.channel_name || 'Sem canal', session.seconds);
    incrementMap(item.favorite_hours, hourOfDay(session.joined_at), session.seconds);
    byMember.set(key, item);
  }

  const rows = [...byMember.values()].map((item) => ({
    ...item,
    top_channels: topKeys(item.top_channels, 5).join('|'),
    favorite_hours: topKeys(item.favorite_hours, 5).join('|')
  }));

  const columns = [
    'date',
    'discord_id',
    'discord_name',
    'albion_name',
    'voice_sessions',
    'voice_seconds',
    'voice_minutes',
    'first_joined_at',
    'last_left_at',
    'weekday',
    'top_channels',
    'favorite_hours'
  ];
  return htmlReportAttachment({
    title: `Voz diaria ${dateText}`,
    fileName: `voice-daily-${dateText}.html`,
    csvName: `voice-daily-${dateText}.csv`,
    rows,
    columns,
    summary: [
      ['Membros', rows.length],
      ['Sessoes', rows.reduce((total, row) => total + Number(row.voice_sessions || 0), 0)],
      ['Tempo total', formatVoiceTime(rows.reduce((total, row) => total + Number(row.voice_seconds || 0), 0))]
    ]
  });
}

function todayIsoDate() {
  return formatSaoPauloDate(new Date());
}

function normalizeIsoDate(dateText) {
  const normalized = String(dateText || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : todayIsoDate();
}

function dateInSaoPaulo(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return todayIsoDate();
  return formatSaoPauloDate(date);
}

function formatSaoPauloDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function incrementMap(map, key, value) {
  map.set(key, (map.get(key) || 0) + value);
}

function topKeys(map, limit) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => key);
}

function weekdayName(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return '';
  return ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][date.getDay()];
}

function hourOfDay(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return '';
  return String(date.getHours()).padStart(2, '0');
}

function previewBalanceImport(csvText) {
  const rows = parseCsv(csvText);
  const changes = [];
  let found = 0;
  let missing = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  for (const row of rows) {
    const normalized = normalizeBalanceRow(row);
    const discordId = normalized.discordId;
    const albionName = normalized.albionName;
    const discordName = normalized.discordName;
    const amount = parseSilver(normalized.balance);
    let user = discordId ? registrationRepo.getUser(discordId) : null;
    if (!user && albionName) {
      user = require('../../database/connection')
        .getDatabase()
        .prepare('SELECT * FROM users WHERE lower(albion_name) = lower(?)')
        .get(albionName);
    }

    if (!user && !discordId) {
      missing += 1;
      continue;
    }

    const userId = user?.discord_id || discordId;
    if (!user && discordId) {
      registrationRepo.upsertUser({
        discordId,
        discordName: discordName || discordId,
        albionName,
        registrationStatus: albionName ? 'guest' : 'unregistered'
      });
    }

    const before = financeRepo.getBalance(userId);
    totalBefore += before;
    totalAfter += amount;
    found += 1;
    changes.push({ userId, albionName: user?.albion_name || albionName || discordName, before, after: amount });
  }

  return { found, missing, totalBefore, totalAfter, changes };
}

function normalizeBalanceRow(row) {
  const discordId = firstValue(row, ['discord_id', 'Discord_ID', 'ID', 'id']);
  const explicitAlbionName = firstValue(row, ['albion_name', 'Albion_Name', 'Albion', 'Nick']);
  return {
    discordId,
    discordName: firstValue(row, ['discord_name', 'Discord_Name', 'Nome', 'name']),
    albionName: explicitAlbionName || (discordId ? '' : firstValue(row, ['Nome'])),
    balance: firstValue(row, ['balance', 'Balance', 'Saldo', 'saldo']) || '0'
  };
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') return String(row[key]).trim();
  }
  return '';
}

function saveImportPreview({ preview, actorId }) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  importPreviews.set(id, { preview, actorId, createdAt: Date.now() });
  return id;
}

function importPreviewAttachment(preview) {
  const rows = preview.changes.map((change) => ({
    user_id: change.userId,
    albion_name: change.albionName || '',
    before_balance: change.before,
    after_balance: change.after,
    diff: change.after - change.before
  }));
  return htmlReportAttachment({
    title: 'Previa de importacao de saldos',
    fileName: 'previa-importacao-saldos.html',
    csvName: 'previa-importacao-saldos.csv',
    rows,
    columns: [
      'user_id',
      'albion_name',
      { key: 'before_balance', label: 'before_balance', align: 'right', format: formatSilver },
      { key: 'after_balance', label: 'after_balance', align: 'right', format: formatSilver },
      { key: 'diff', label: 'diff', align: 'right', format: formatSilver }
    ],
    summary: [
      ['Encontrados', preview.found],
      ['Nao encontrados', preview.missing],
      ['Total antes', formatSilver(preview.totalBefore)],
      ['Total depois', formatSilver(preview.totalAfter)]
    ]
  });
}

function takeImportPreview(id) {
  const session = importPreviews.get(id);
  importPreviews.delete(id);
  return session;
}

const applyBalanceImport = transaction(({ preview, actorId }) => {
  backupDatabase('before_csv_import');
  const transactions = [];
  for (const change of preview.changes) {
    const diff = change.after - change.before;
    if (diff !== 0) {
      const item = {
        type: 'csv_import',
        userId: change.userId,
        amount: diff,
        reason: 'Importacao CSV de saldos',
        referenceType: 'csv_import',
        referenceId: null,
        createdBy: actorId
      };
      finance.applyBalanceTransaction(item);
      transactions.push(item);
    }
  }
  audit.createAuditLog({
    type: 'csv_import_applied',
    actorId,
    reason: 'Importacao CSV confirmada',
    metadata: {
      found: preview.found,
      missing: preview.missing,
      totalBefore: preview.totalBefore,
      totalAfter: preview.totalAfter
    }
  });
  return transactions;
});

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

module.exports = {
  activeMemberBalanceRows,
  activeMemberBalancesCsvAttachment,
  activeMemberBalancesHtmlAttachment,
  applyBalanceImport,
  auditAttachment,
  balancesAttachment,
  balancesHtmlAttachment,
  importPreviewAttachment,
  saveImportPreview,
  previewBalanceImport,
  takeImportPreview,
  transactionsAttachment,
  voiceAttachment,
  voiceDailyAttachment
};
