const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'America/Sao_Paulo' });
const timeOnly = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const state = { data: null, players: [] };

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const pad = (value) => String(value).padStart(2, '0');
const hours = (seconds) => `${number.format(Number(seconds || 0) / 3600)}h`;
const duration = (seconds) => {
  if (seconds == null) return 'tempo não identificado';
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return hour ? `${hour}h ${minute}min` : `${minute}min`;
};
const relativeDate = (value) => value ? dateTime.format(new Date(value)) : '—';
const windowLabel = (window) => window ? `${pad(window.startHour)}h–${pad(window.endHour)}h` : 'Sem faixa definida';
const calendarDate = (value) => shortDate.format(new Date(`${value}T12:00:00Z`)).replace('.', '');

function renderMetrics(data) {
  const cards = [
    ['Ativos agora', data.summary.activeNow, 'Jogadores em call neste momento', true],
    ['Jogadores no período', data.summary.uniquePlayers, `${data.period.days} dias analisados`],
    ['Melhor janela', data.summary.peakLabel || 'Sem dados', data.summary.peakLabel ? `Média de ${number.format(data.summary.peakAverage)} simultâneos` : 'Aguardando histórico'],
    ['Tempo acumulado', hours(data.summary.totalVoiceSeconds), `${number.format(data.period.validSessions)} sessões válidas`]
  ];
  document.querySelector('#metrics').innerHTML = cards.map(([label, value, note, positive]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong class="${positive ? 'positive' : ''}">${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join('');
}

function renderQuality(data) {
  const notice = document.querySelector('#quality-notice');
  if (!data.period.ignoredAnomalous && !data.period.ignoredShort) {
    notice.hidden = true;
    return;
  }
  notice.hidden = false;
  notice.innerHTML = `<strong>Proteção da análise:</strong> ${number.format(data.period.ignoredAnomalous)} sessão(ões) acima de 12 horas ou inválida(s) e ${number.format(data.period.ignoredShort)} sessão(ões) com menos de 1 minuto foram ignoradas para não criar picos falsos.`;
}

function renderLive(data) {
  document.querySelector('#live-count').textContent = number.format(data.activeNow.length);
  document.querySelector('#live-list').innerHTML = data.activeNow.length ? data.activeNow.map((player) => `<article class="live-player"><i></i><div><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(player.channelName)}</small></div><span>${escapeHtml(duration(player.seconds))}</span></article>`).join('') : '<div class="empty">Nenhum jogador está em call agora.</div>';
}

function renderBestWindows(data) {
  document.querySelector('#best-windows').innerHTML = data.bestWindows.length ? data.bestWindows.map((window) => `<li><div><strong>${escapeHtml(window.weekdayLabel)}, ${pad(window.startHour)}h–${pad(window.endHour)}h</strong><small>${number.format(window.sampleDays)} dia(s) usado(s) na média</small></div><b>${number.format(window.averageConcurrent)}</b></li>`).join('') : '<li class="empty">Ainda não existe histórico suficiente.</li>';
}

function renderHeatmap(data) {
  const max = Math.max(0, ...data.heatmap.map((cell) => cell.averageConcurrent));
  let html = '<div class="heat-label"></div>' + Array.from({ length: 24 }, (_, hour) => `<div class="heat-hour">${pad(hour)}</div>`).join('');
  const order = [1, 2, 3, 4, 5, 6, 0];
  for (const weekday of order) {
    const cells = data.heatmap.filter((cell) => cell.weekday === weekday);
    html += `<div class="heat-label">${escapeHtml(cells[0]?.weekdayLabel || '')}</div>`;
    html += cells.map((cell) => {
      const ratio = max ? cell.averageConcurrent / max : 0;
      const level = ratio <= 0 ? 0 : Math.max(1, Math.ceil(ratio * 5));
      const title = `${cell.weekdayLabel}, ${pad(cell.hour)}h — média ${number.format(cell.averageConcurrent)} jogadores; ${number.format(cell.uniquePlayers)} únicos`;
      return `<div class="heat-cell ${level ? `level-${level}` : ''}" title="${escapeHtml(title)}">${number.format(cell.averageConcurrent)}</div>`;
    }).join('');
  }
  document.querySelector('#heatmap').innerHTML = html;
}

function renderCalendar(data) {
  const recent = data.calendar.slice(-31);
  const summary = data.calendarSummary || {};
  const trend = summary.weekOverWeekPercent;
  const trendLabel = trend == null ? 'Aguardando duas semanas' : `${trend >= 0 ? '↑' : '↓'} ${number.format(Math.abs(trend))}% vs semana anterior`;
  document.querySelector('#calendar-insights').innerHTML = [
    ['Dia mais forte', summary.strongestDay ? `${summary.strongestDay.weekdayLabel}, ${calendarDate(summary.strongestDay.date)}` : 'Sem dados', summary.strongestDay ? `Pico de ${number.format(summary.strongestDay.peakConcurrent)} às ${windowLabel(summary.strongestDay.bestWindow)}` : 'Aguardando histórico'],
    ['Pico diário médio', number.format(summary.averageDailyPeak || 0), `${number.format(summary.averageDailyUniquePlayers || 0)} jogadores únicos por dia`],
    ['Tendência semanal', trendLabel, trend == null ? 'Disponível com 14 dias completos' : 'Comparação pela média dos picos'],
    ['Melhor fim de semana', summary.bestWeekend ? `${summary.bestWeekend.weekdayLabel}, ${calendarDate(summary.bestWeekend.date)}` : 'Sem dados', summary.bestWeekend ? `Pico de ${number.format(summary.bestWeekend.peakConcurrent)} às ${windowLabel(summary.bestWeekend.bestWindow)}` : 'Aguardando sábado ou domingo']
  ].map(([label, value, note]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join('');

  const intensityLabels = { weak: 'Fraco', normal: 'Normal', strong: 'Forte', peak: 'Pico', in_progress: 'Em andamento' };
  document.querySelector('#calendar').innerHTML = recent.map((row) => {
    const comparison = row.isInProgress
      ? `Dados parciais até ${timeOnly.format(new Date(data.generatedAt))}`
      : row.comparisonPercent == null
        ? 'Sem base suficiente para comparar'
        : `${row.comparisonPercent >= 0 ? '↑' : '↓'} ${number.format(Math.abs(row.comparisonPercent))}% vs outros ${row.weekdayLabel.toLocaleLowerCase('pt-BR')}s`;
    const comparisonClass = row.comparisonPercent > 0 ? 'positive' : row.comparisonPercent < 0 ? 'negative' : '';
    return `<button class="calendar-day intensity-${escapeHtml(row.intensity)}" type="button" data-date="${escapeHtml(row.date)}"><header><div><time datetime="${escapeHtml(row.date)}">${pad(row.day)}</time><span>${escapeHtml(row.weekdayLabel.slice(0, 3))}</span></div><b>${escapeHtml(intensityLabels[row.intensity] || 'Normal')}</b></header><div class="day-peak"><span>Pico simultâneo</span><strong>${number.format(row.peakConcurrent)}</strong></div><div class="day-window"><span>Melhor faixa</span><strong>${escapeHtml(windowLabel(row.bestWindow))}</strong></div><p class="day-comparison ${comparisonClass}">${escapeHtml(comparison)}</p><footer><span>${number.format(row.uniquePlayers)} únicos</span><span>${escapeHtml(hours(row.totalVoiceSeconds))} em call</span></footer></button>`;
  }).join('');
}

function openDayDetail(date) {
  const row = state.data?.calendar.find((item) => item.date === date);
  if (!row) return;
  const hourly = row.hourly || [];
  const players = row.players || [];
  const max = Math.max(0, ...hourly.map((hour) => hour.averageConcurrent));
  const chart = hourly.map((hour) => {
    const level = max > 0 && hour.averageConcurrent > 0 ? Math.max(1, Math.ceil((hour.averageConcurrent / max) * 10)) : 0;
    const unavailable = hour.observedSeconds <= 0 ? ' unavailable' : '';
    return `<div class="day-hour${unavailable}" title="${pad(hour.hour)}h: média ${number.format(hour.averageConcurrent)}, ${number.format(hour.uniquePlayers)} únicos"><span>${number.format(hour.averageConcurrent)}</span><i class="bar-level-${level}"></i><small>${pad(hour.hour)}</small></div>`;
  }).join('');
  const comparisonDetail = row.isInProgress
    ? 'Dia em andamento; os valores ainda são parciais.'
    : row.comparisonPercent == null
      ? 'Ainda não há dias comparáveis suficientes.'
      : `${number.format(Math.abs(row.comparisonPercent))}% ${row.comparisonPercent >= 0 ? 'acima' : 'abaixo'} do padrão de ${row.weekdayLabel.toLocaleLowerCase('pt-BR')}.`;
  document.querySelector('#day-detail').innerHTML = `<header class="day-detail-head"><span class="eyebrow">DETALHE DO DIA</span><h2>${escapeHtml(row.weekdayLabel)}, ${escapeHtml(calendarDate(row.date))}</h2><p>${escapeHtml(comparisonDetail)}</p></header><div class="day-detail-metrics"><article><span>Pico simultâneo</span><strong>${number.format(row.peakConcurrent)}</strong></article><article><span>Melhor faixa</span><strong>${escapeHtml(windowLabel(row.bestWindow))}</strong></article><article><span>Jogadores únicos</span><strong>${number.format(row.uniquePlayers)}</strong></article><article><span>Tempo em call</span><strong>${escapeHtml(hours(row.totalVoiceSeconds))}</strong></article></div><section class="day-hour-section"><h3>Movimento hora a hora</h3><div class="day-hour-chart">${chart}</div></section><section class="day-player-section"><h3>Jogadores que apareceram</h3><div class="day-player-list">${players.length ? players.map((player) => `<span>${escapeHtml(player)}</span>`).join('') : '<p>Nenhum jogador registrado.</p>'}</div></section>`;
  document.querySelector('#day-dialog').showModal();
}

function renderPlayers() {
  if (!state.data) return;
  const query = document.querySelector('#player-search').value.trim().toLocaleLowerCase('pt-BR');
  state.players = state.data.players.filter((player) => !query || player.name.toLocaleLowerCase('pt-BR').includes(query));
  document.querySelector('#player-summary').textContent = `${number.format(state.players.length)} de ${number.format(state.data.players.length)} jogadores exibidos`;
  document.querySelector('#players').innerHTML = state.players.length ? state.players.map((player) => {
    const days = player.typicalDays.map((day) => day.label.slice(0, 3)).join(', ') || '—';
    const peakHours = player.peakHours.map((item) => `${pad(item.hour)}h`).join(', ') || '—';
    return `<tr><td><strong>${escapeHtml(player.name)}</strong><small>${number.format(player.sessions)} sessão(ões)</small></td><td><span class="status ${player.activeNow ? 'live' : ''}">${player.activeNow ? `Em ${escapeHtml(player.activeNow.channelName)}` : 'Fora de call'}</span></td><td>${escapeHtml(days)}</td><td>${escapeHtml(peakHours)}</td><td>${number.format(player.activeDays)}</td><td>${escapeHtml(hours(player.totalVoiceSeconds))}</td><td>${escapeHtml(relativeDate(player.lastSeen))}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">Nenhum jogador corresponde à busca.</td></tr>';
}

async function loadData() {
  const button = document.querySelector('#refresh');
  button.disabled = true;
  try {
    const days = document.querySelector('#period').value;
    const response = await fetch(`/api/primetime?days=${encodeURIComponent(days)}`, { headers: { Accept: 'application/json' } });
    if (response.status === 401 || response.status === 403) {
      location.href = '/?login=required';
      return;
    }
    if (!response.ok) throw new Error('Não foi possível carregar o Prime Time.');
    state.data = await response.json();
    document.querySelector('#freshness').textContent = `Atualizado em ${dateTime.format(new Date(state.data.generatedAt))} · fuso de São Paulo`;
    renderMetrics(state.data);
    renderQuality(state.data);
    renderLive(state.data);
    renderBestWindows(state.data);
    renderHeatmap(state.data);
    renderCalendar(state.data);
    renderPlayers();
  } catch (error) {
    document.querySelector('#freshness').textContent = error.message || 'Falha ao carregar os dados.';
    document.querySelector('#metrics').innerHTML = '<article class="metric empty">Não foi possível carregar o analisador. Tente atualizar.</article>';
  } finally {
    button.disabled = false;
  }
}

document.querySelector('#refresh').addEventListener('click', loadData);
document.querySelector('#period').addEventListener('change', loadData);
document.querySelector('#player-search').addEventListener('input', renderPlayers);
document.querySelector('#calendar').addEventListener('click', (event) => {
  const day = event.target.closest('.calendar-day[data-date]');
  if (day) openDayDetail(day.dataset.date);
});
document.querySelector('#day-dialog .dialog-close').addEventListener('click', () => document.querySelector('#day-dialog').close());
document.querySelector('#day-dialog').addEventListener('click', (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
loadData();
