const { getDatabase } = require('../database/connection');
const { battleSummary } = require('../modules/albion/battleReports.service');

const SLOT_LABELS = {
  MainHand: 'Arma principal',
  OffHand: 'Mão secundária',
  Head: 'Cabeça',
  Armor: 'Peito',
  Shoes: 'Botas',
  Bag: 'Bolsa',
  Cape: 'Capa',
  Mount: 'Montaria',
  Potion: 'Poção',
  Food: 'Comida'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseEvent(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function formatSilver(value) {
  return `${Math.round(Number(value || 0)).toLocaleString('pt-BR')} prata`;
}

function compactSilver(value) {
  const amount = Number(value || 0);
  const sign = amount < 0 ? '-' : '';
  const absolute = Math.abs(amount);
  if (absolute >= 1_000_000) return `${sign}${(absolute / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} M`;
  if (absolute >= 1_000) return `${sign}${(absolute / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `${sign}${Math.round(absolute).toLocaleString('pt-BR')}`;
}

function formatDateTime(value, includeDate = true) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Horário não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    ...(includeDate ? { dateStyle: 'short' } : {}),
    timeStyle: 'short'
  }).format(date);
}

function playerName(player, fallback = 'Desconhecido') {
  return escapeHtml(player?.Name || fallback);
}

function guildLabel(player) {
  const guild = player?.GuildName || 'Sem guilda';
  const alliance = player?.AllianceName ? ` • ${player.AllianceName}` : '';
  return `${escapeHtml(guild)}${escapeHtml(alliance)}`;
}

function equipmentItems(rawEvent) {
  return Object.entries(rawEvent?.Victim?.Equipment || {})
    .filter(([, item]) => item?.Type)
    .map(([slot, item]) => ({
      slot: SLOT_LABELS[slot] || slot,
      type: String(item.Type),
      quality: Math.max(1, Number(item.Quality || 1)),
      count: Math.max(1, Number(item.Count || 1))
    }));
}

function eventParticipants(rawEvent) {
  const seen = new Set();
  return [rawEvent?.Killer, ...(rawEvent?.Participants || [])].filter((player) => {
    if (!player?.Name) return false;
    const key = String(player.Id || player.Name).toLocaleLowerCase('en-US');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function itemCard(item) {
  const image = `https://render.albiononline.com/v1/item/${encodeURIComponent(item.type)}.png?quality=${item.quality}`;
  return `<li class="battle-item">
    <img src="${image}" alt="" loading="lazy" width="58" height="58">
    <span><small>${escapeHtml(item.slot)}</small><strong>${escapeHtml(item.type)}</strong>${item.count > 1 ? `<em>${item.count} unidades</em>` : ''}</span>
  </li>`;
}

function participantChip(player) {
  return `<span class="battle-chip"><strong>${playerName(player)}</strong><small>${guildLabel(player)}</small></span>`;
}

function eventCard(row, index, type) {
  const raw = parseEvent(row.raw_event_json);
  const killer = raw.Killer || {};
  const victim = raw.Victim || { Name: row.victim_name, GuildName: row.victim_guild };
  const items = equipmentItems(raw);
  const participants = eventParticipants(raw);
  const killboardUrl = `https://killboard-1.com/eu/event/${encodeURIComponent(row.event_id)}`;
  const tone = type === 'kill' ? 'positive' : 'negative';
  const label = type === 'kill' ? 'Eliminação' : 'Perda NoTag';
  return `<details class="battle-event battle-event-${tone}">
    <summary>
      <span class="battle-event-index">${index + 1}</span>
      <span class="battle-event-result"><small>${label} • ${formatDateTime(row.event_at, false)}</small><strong>${playerName(victim, row.victim_name)}</strong><em>${guildLabel(victim)}</em></span>
      <span class="battle-event-killer"><small>Eliminado por</small><strong>${playerName(killer)}</strong><em>${guildLabel(killer)}</em></span>
      <span class="battle-event-value"><small>Build estimada</small><strong>${compactSilver(row.victim_build_value)}</strong><em>${Number(row.priced_items || 0)}/${Number(row.total_items || 0)} itens com preço</em></span>
      <span class="battle-event-open">Detalhes</span>
    </summary>
    <div class="battle-event-details">
      <section>
        <div class="battle-detail-heading"><h3>Build equipada</h3><span>${formatSilver(row.victim_build_value)}</span></div>
        ${items.length ? `<ul class="battle-equipment">${items.map(itemCard).join('')}</ul>` : '<p class="battle-empty">Equipamentos não informados pela API do Albion.</p>'}
      </section>
      <section>
        <div class="battle-detail-heading"><h3>Participantes da eliminação</h3><span>${participants.length}</span></div>
        ${participants.length ? `<div class="battle-chips">${participants.map(participantChip).join('')}</div>` : '<p class="battle-empty">Nenhum participante informado pela API do Albion.</p>'}
      </section>
      <a class="button button-secondary battle-killboard-link" href="${killboardUrl}" target="_blank" rel="noopener noreferrer">Abrir evento no KillBoard #1 ↗</a>
    </div>
  </details>`;
}

function eventSection(title, description, events, type) {
  return `<section class="battle-section" id="${type === 'kill' ? 'eliminacoes' : 'perdas'}">
    <div class="battle-section-heading">
      <div><span class="kicker"><i></i> Relação completa</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>
      <strong>${events.length}</strong>
    </div>
    <div class="battle-event-list">
      ${events.length ? events.map((row, index) => eventCard(row, index, type)).join('') : '<p class="battle-empty">Nenhum evento nesta categoria.</p>'}
    </div>
  </section>`;
}

function notFoundPage() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Batalha não encontrada — Notag</title><link rel="stylesheet" href="/assets/styles.css"><link rel="stylesheet" href="/assets/battle-report.css"></head><body class="landing-body"><main class="battle-not-found shell"><img src="/assets/notag-logo.jpeg" alt=""><h1>Relatório não encontrado</h1><p>Esta batalha não existe ou ainda não foi publicada.</p><a class="button button-primary" href="/">Voltar para a Notag</a></main></body></html>`;
}

function renderBattleReportPage(battleId, db = getDatabase()) {
  const id = Number(battleId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const publicBattle = db.prepare("SELECT id FROM albion_battles WHERE id = ? AND status = 'reported'").get(id);
  if (!publicBattle) return null;
  const summary = battleSummary(db, id);
  if (!summary) return null;
  const positive = summary.balance >= 0;
  const members = [...summary.members].sort((left, right) => left.localeCompare(right, 'pt-BR'));
  const title = `Batalha #${id} — Relatório completo Notag`;
  const description = `Relatório da batalha #${id}: ${summary.kills.length} eliminações, ${summary.deaths.length} perdas e saldo estimado de ${compactSilver(summary.balance)} em prata.`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/assets/styles.css?v=20260819-1">
  <link rel="stylesheet" href="/assets/battle-report.css?v=20260819-1">
</head>
<body class="landing-body battle-report-body">
  <header class="public-header shell">
    <a class="public-brand" href="/" aria-label="Página inicial da Notag"><img src="/assets/notag-logo.jpeg" alt="Brasão da guilda Notag"><span>NOTAG</span></a>
    <nav class="public-nav" aria-label="Navegação do relatório"><a href="#eliminacoes">Eliminações</a><a href="#perdas">Perdas</a><a class="button button-ghost" href="/portal">Meu portal</a></nav>
  </header>
  <main class="battle-main shell">
    <section class="battle-hero">
      <div class="battle-hero-copy">
        <span class="battle-status battle-status-${positive ? 'positive' : 'negative'}">${positive ? 'Saldo positivo' : 'Saldo negativo'}</span>
        <span class="kicker"><i></i> Killboard NoTag</span>
        <h1>Relatório completo da batalha <strong>#${id}</strong></h1>
        <p>${formatDateTime(summary.battle.started_at)} até ${formatDateTime(summary.battle.last_event_at, false)} • horário de Brasília</p>
      </div>
      <div class="battle-balance battle-balance-${positive ? 'positive' : 'negative'}"><small>Saldo estimado</small><strong>${summary.balance >= 0 ? '+' : ''}${compactSilver(summary.balance)}</strong><span>prata em builds equipadas</span></div>
    </section>
    <section class="battle-metrics" aria-label="Resumo da batalha">
      <article><small>Inimigos eliminados</small><strong>${summary.kills.length}</strong><span>${compactSilver(summary.enemyValue)} prata</span></article>
      <article><small>Mortes da NoTag</small><strong>${summary.deaths.length}</strong><span>${compactSilver(summary.notagValue)} prata</span></article>
      <article><small>Eficiência por valor</small><strong>${(summary.efficiency * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</strong><span>eliminado ÷ valor movimentado</span></article>
      <article><small>Membros NoTag</small><strong>${members.length}</strong><span>${summary.events.length} mortes no total</span></article>
      <article><small>Cobertura de preços</small><strong>${summary.pricedItems}/${summary.totalItems}</strong><span>itens equipados avaliados</span></article>
    </section>
    <section class="battle-members">
      <div><span class="kicker"><i></i> Formação identificada</span><h2>Membros da NoTag envolvidos</h2></div>
      <div class="battle-member-list">${members.map((name) => `<span>${escapeHtml(name)}</span>`).join('')}</div>
    </section>
    ${eventSection('Inimigos eliminados', 'Todas as builds inimigas eliminadas nesta batalha. Abra cada linha para ver equipamento e participantes.', summary.kills, 'kill')}
    ${eventSection('Perdas da NoTag', 'Todas as builds perdidas pela NoTag nesta batalha, ordenadas pelo horário do evento.', summary.deaths, 'death')}
    <p class="battle-disclaimer">Valores estimados pelo mercado europeu do Albion Online. O relatório considera somente os itens equipados, não o inventário nem o valor efetivamente destruído.</p>
  </main>
  <footer class="public-footer shell"><div class="public-brand compact"><img src="/assets/notag-logo.jpeg" alt=""><span>NOTAG</span></div><p>Relatório automático de batalha.</p><a href="/">Página inicial</a><a href="/portal">Portal do membro</a></footer>
</body>
</html>`;
}

module.exports = {
  escapeHtml,
  notFoundPage,
  renderBattleReportPage
};
