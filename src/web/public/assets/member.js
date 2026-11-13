const state = { data: null, session: null, view: 'overview', rankingCategory: 'overall', expandedSeasonPlayer: null, lastLoadedAt: 0, withdrawDraft: null, editingWithdrawId: null };
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('pt-BR');
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function formatSilver(value) {
  return compact.format(Number(value || 0)).toLowerCase();
}

function parseSilverInput(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '').replace(',', '.');
  const match = raw.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!match) return null;
  const multiplier = match[2] === 'm' ? 1000000 : match[2] === 'k' ? 1000 : 1;
  const amount = Math.round(Number(match[1]) * multiplier);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours}h ${minutes}min` : `${minutes}min`;
}

function statusLabel(status) {
  const labels = { member: 'Membro', guest: 'Convidado', pending: 'Em análise', unregistered: 'Sem cadastro', approved_guest: 'Aprovado como convidado', approved_member: 'Aprovado como membro', created: 'Aberto', running: 'Em andamento', review: 'Em revisão', pending_payment: 'Financeiro', approved: 'Finalizado', cancelled: 'Cancelado', requested: 'Pendente', paid: 'Pago', refused: 'Recusado' };
  return labels[status] || status || 'Pendente';
}

function badge(status) {
  return `<span class="badge ${escapeHtml(status || 'pending')}">${escapeHtml(statusLabel(status))}</span>`;
}

function empty(message) {
  return `<div class="portal-empty">${escapeHtml(message)}</div>`;
}

function metric(label, value, note, color = '#5865f2', className = '') {
  return `<article class="metric-card ${className}" style="--metric-color:${color}"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong><small class="metric-note">${escapeHtml(note)}</small></article>`;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Não foi possível carregar os dados.');
  return body;
}

function renderSession() {
  const user = state.session.user;
  document.querySelector('#session-name').textContent = user.name || user.username;
  if (user.avatarUrl) document.querySelector('#session-avatar').src = user.avatarUrl;
  document.querySelector('#access-label').textContent = user.accessLevel === 'member' ? 'Acesso de Membro' : 'Acesso limitado de Convidado';
  document.querySelectorAll('.member-only').forEach((element) => { element.hidden = user.accessLevel !== 'member'; });
  document.querySelector('#staff-switch').hidden = !user.canAccessStaff;
}

function renderOverview(data) {
  const profile = data.profile;
  document.querySelector('#welcome-title').textContent = `Olá, ${profile.albionName || profile.discordName || 'jogador'}`;
  document.querySelector('#overview-access').textContent = statusLabel(profile.accessLevel);
  document.querySelector('#welcome-copy').textContent = profile.accessLevel === 'member'
    ? 'Seu perfil de Membro está ativo. Acompanhe atividades, desempenho e financeiro.'
    : 'Seu acesso é de Convidado. Você pode acompanhar cadastro, eventos públicos e financeiro.';
  document.querySelector('#member-metrics').innerHTML = [
    metric('Saldo atual', formatSilver(data.overview.balance), `${data.overview.pendingWithdraws} saque(s) pendente(s)`, '#23a55a'),
    metric('Eventos', integer.format(data.overview.events), 'Participações registradas'),
    metric('Tempo ativo', formatDuration(data.overview.activeSeconds), 'Somente como participante', '#d99a43'),
    metric('Loot recebido', formatSilver(data.overview.lootReceived), 'Eventos aprovados', '#33a7d8')
  ].join('');
  document.querySelector('#overview-events').innerHTML = data.events.length ? data.events.slice(0, 5).map((event) => eventCard(event, false)).join('') : empty('Nenhum evento aberto agora.');
  document.querySelector('#overview-transactions').innerHTML = data.finance.transactions.length ? data.finance.transactions.slice(0, 6).map((row) => `
    <div class="portal-list-row"><div><strong>${escapeHtml(row.reason)}</strong><small>${formatDate(row.created_at)}</small></div><b class="${row.amount >= 0 ? 'positive' : 'negative'}">${row.amount >= 0 ? '+' : ''}${escapeHtml(formatSilver(row.amount))}</b></div>`).join('') : empty('Nenhuma movimentação financeira.');
}

function renderRegistration(data) {
  const profile = data.profile;
  document.querySelector('#registration-status').textContent = statusLabel(profile.registrationStatus);
  const registration = data.registration;
  document.querySelector('#registration-card').innerHTML = `
    <div class="panel-head"><div><span>Personagem Albion</span><h3>${escapeHtml(profile.albionName || 'Ainda não informado')}</h3></div>${badge(profile.registrationStatus)}</div>
    <dl class="portal-details"><div><dt>Status da análise</dt><dd>${escapeHtml(statusLabel(registration?.status || profile.registrationStatus))}</dd></div><div><dt>Solicitado em</dt><dd>${formatDate(registration?.created_at)}</dd></div><div><dt>Observação</dt><dd>${escapeHtml(registration?.review_note || 'Nenhuma observação da Staff.')}</dd></div></dl>`;
  document.querySelector('#linked-accounts').innerHTML = profile.linkedAccounts.length ? profile.linkedAccounts.map((account) => `
    <div class="portal-list-row"><div><strong>${escapeHtml(account.discordName || account.discordId)}</strong><small>${escapeHtml(account.discordId)}</small></div>${account.primary ? '<span class="access-chip">Principal</span>' : '<span class="access-chip subtle">Vinculada</span>'}</div>`).join('') : empty('Nenhuma conta vinculada encontrada.');
}

const eventRoleLabels = { tank: 'Tank', healer: 'Healer', support: 'Suporte', dps: 'DPS' };

function roleLabel(role) {
  return eventRoleLabels[role] || role || 'Participante';
}

function eventPeople(event) {
  const participants = event.participantList || [];
  const spectators = event.spectatorList || [];
  if (!participants.length && !spectators.length) return '<p class="event-people-empty">Ninguém inscrito ainda.</p>';
  const people = (rows, spectator = false) => rows.map((row) => `<li><span>${escapeHtml(row.display_name)}</span><small>${escapeHtml(spectator ? 'Espectador' : roleLabel(row.role))}</small></li>`).join('');
  return `<details class="event-people"><summary>Ver lista completa (${integer.format(participants.length + spectators.length)})</summary><ul>${people(participants)}${people(spectators, true)}</ul></details>`;
}

function eventActions(event) {
  const own = event.ownParticipation;
  const isSpectator = Boolean(own?.is_spectator);
  const isCustom = event.signupMode === 'custom';
  const isDiscordOnly = !['standard', 'custom'].includes(event.signupMode);
  const options = Object.entries(event.roles || {}).map(([role, availability]) => {
    const ownRole = own && !isSpectator && own.role === role;
    const disabled = availability.available <= 0 && !ownRole;
    return `<option value="${escapeHtml(role)}" ${ownRole ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${escapeHtml(roleLabel(role))} — ${integer.format(availability.available)} livre(s)</option>`;
  }).join('');
  const customOptions = (event.customSlots || []).map((slot) => (
    `<option value="${escapeHtml(slot.dynamic ? `${slot.role}|weapon|${slot.weaponKey}` : `${slot.role}|slot|${slot.slotIndex}`)}" ${slot.current ? 'selected' : ''}>${escapeHtml(slot.label)}</option>`
  )).join('');
  const currentSlot = (event.customSlots || []).find((slot) => slot.current);
  const currentLabel = isSpectator ? 'Espectador' : (currentSlot?.label || roleLabel(own?.role));
  const current = own ? `<div class="event-current ${isSpectator ? 'spectator' : ''}">Sua inscrição: <strong>${escapeHtml(currentLabel)}</strong></div>` : '';
  let participantControl;
  if (isCustom && customOptions) {
    participantControl = `<label class="event-role-field" for="event-slot-${event.id}"><span>Função e equipamento</span><select id="event-slot-${event.id}">${customOptions}</select></label><button class="button button-primary event-action" type="button" data-event-id="${event.id}" data-event-action="join">${own && !isSpectator ? 'Atualizar função' : 'Participar'}</button>`;
  } else if (isCustom) {
    participantControl = '<p class="event-special-note">Não há vagas livres neste momento. Você ainda pode entrar como espectador.</p>';
  } else if (isDiscordOnly) {
    participantControl = '<p class="event-special-note">Este evento usa uma composição especial que ainda deve ser escolhida pelo painel do Discord.</p>';
  } else {
    participantControl = `<label class="event-role-field" for="event-role-${event.id}"><span>Função</span><select id="event-role-${event.id}">${options}</select></label><button class="button button-primary event-action" type="button" data-event-id="${event.id}" data-event-action="join">${own && !isSpectator ? 'Atualizar função' : 'Participar'}</button>`;
  }
  return `<div class="event-signup">${current}${participantControl}<button class="button button-secondary event-action" type="button" data-event-id="${event.id}" data-event-action="spectate" ${isSpectator ? 'disabled' : ''}>${isSpectator ? 'Você é espectador' : 'Entrar como espectador'}</button><small>Espectadores não ocupam vaga nem recebem loot.</small></div>`;
}

function renderEventDescription(event) {
  const raw = String(event.description || event.location || 'Detalhes no Discord.');
  const urlMatch = raw.match(/https?:\/\/[^\s<]+/i);
  if (!urlMatch) return escapeHtml(raw);

  const before = raw.slice(0, urlMatch.index).replace(/[>\-:|\s]+$/g, '').trim();
  const after = raw.slice(urlMatch.index + urlMatch[0].length).trim();
  const parts = [];
  if (before) parts.push(`<span>${escapeHtml(before)}</span>`);
  parts.push(`<a class="event-build-link" href="${escapeHtml(urlMatch[0])}" target="_blank" rel="noopener noreferrer">Ver builds</a>`);
  if (after) parts.push(`<span>${escapeHtml(after)}</span>`);
  return `<span class="event-description">${parts.join('')}</span>`;
}

function eventCard(event, interactive = true) {
  const total = Number(event.capacity || 20);
  return `<article class="event-mini-card ${event.status === 'running' ? 'running' : ''}"><div><span>${escapeHtml(event.event_code)}</span>${badge(event.status)}</div><h4>${escapeHtml(event.title)}</h4><p>${renderEventDescription(event)}</p><footer><span>${escapeHtml(event.scheduled_time || 'Horário a confirmar')}</span><strong>${integer.format(event.participants || 0)}/${integer.format(total)} participantes</strong></footer>${interactive ? `${eventPeople(event)}${eventActions(event)}` : ''}</article>`;
}

function renderEvents(data) {
  document.querySelector('#portal-events').innerHTML = data.events.length ? data.events.map((event) => eventCard(event, true)).join('') : empty('Nenhum evento disponível.');
  document.querySelector('#event-history').innerHTML = data.eventHistory.length ? data.eventHistory.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.title)}<span class="secondary-text">${escapeHtml(row.event_code)}</span></td><td>${escapeHtml(row.is_spectator ? 'Espectador' : roleLabel(row.role))}</td><td>${badge(row.status)}</td><td>${escapeHtml(formatDuration(row.seconds))}</td><td class="number-cell">${escapeHtml(formatSilver(row.payout_amount))}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">Nenhuma participação registrada.</td></tr>';
}

function showEventFeedback(message, error = false) {
  const feedback = document.querySelector('#event-action-feedback');
  feedback.textContent = message;
  feedback.classList.toggle('error', error);
  feedback.hidden = false;
}

async function changeEventParticipation(button) {
  if (!state.session?.csrf) return showEventFeedback('Sua sessão precisa ser renovada. Saia e entre novamente.', true);
  const eventId = button.dataset.eventId;
  const action = button.dataset.eventAction;
  const event = state.data?.events?.find((candidate) => String(candidate.id) === String(eventId));
  let role = '';
  let slotIndex = '';
  let weaponKey = '';
  if (action === 'join' && event?.signupMode === 'custom') {
    const selectedSlot = document.querySelector(`#event-slot-${eventId}`)?.value || '';
    const [selectedRole, type, value] = selectedSlot.split('|');
    role = selectedRole;
    if (type === 'weapon') weaponKey = value;
    else slotIndex = value;
  } else if (action === 'join') {
    role = document.querySelector(`#event-role-${eventId}`)?.value || '';
  }
  button.disabled = true;
  button.classList.add('busy');
  try {
    const response = await fetch('/api/portal/events/participation', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: state.session.csrf, eventId, action, role, slotIndex, weaponKey })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Não foi possível atualizar sua participação.');
    state.data = body.portal;
    state.lastLoadedAt = Date.now();
    render(state.data);
    setView('events');
    showEventFeedback(body.result.message);
  } catch (error) {
    showEventFeedback(error.message, true);
    button.disabled = false;
    button.classList.remove('busy');
  }
}

const rankingConfig = {
  overall: { rank: 'overall_rank', value: 'overall_score', label: 'Geral', suffix: ' pts' },
  pve: { rank: 'pve_fame_rank', value: 'pve_fame', label: 'PvE' },
  pvp: { rank: 'pvp_fame_rank', value: 'pvp_fame', label: 'PvP' },
  gathering: { rank: 'gathering_fame_rank', value: 'gathering_fame', label: 'Coleta' },
  crafting: { rank: 'crafting_fame_rank', value: 'crafting_fame', label: 'Craft' }
};

function seasonRankingRows(rows, ownName) {
  return rows.map((row) => {
    const expanded = state.expandedSeasonPlayer === row.name;
    const categories = (row.categories || []).map((category) => `
      <tr>
        <td>${escapeHtml(category.label)}</td>
        <td class="number-cell">${escapeHtml(integer.format(category.amount))}</td>
        <td class="number-cell">${escapeHtml(decimal.format(category.points))} pts</td>
      </tr>`).join('');
    return `<tr class="${row.name.toLowerCase() === String(ownName || '').toLowerCase() ? 'own-ranking-row' : ''}">
      <td>#${row.rank}</td>
      <td class="primary-cell"><button class="season-player-toggle" type="button" data-season-player="${escapeHtml(row.name)}" aria-expanded="${expanded}">${escapeHtml(row.name)}<small>${escapeHtml(row.mainCategory?.label || 'Contribuição Black')}</small></button></td>
      <td class="number-cell">${escapeHtml(decimal.format(row.totalPoints))} pts</td>
    </tr>
    <tr class="season-detail-row" ${expanded ? '' : 'hidden'}>
      <td colspan="3"><div class="season-breakdown"><div class="season-breakdown-title"><strong>Detalhamento de ${escapeHtml(row.name)}</strong><span>Total: ${escapeHtml(decimal.format(row.totalPoints))} pontos</span></div><div class="table-wrap"><table><thead><tr><th>Categoria</th><th class="number-cell">Contribuição</th><th class="number-cell">Pontos gerados</th></tr></thead><tbody>${categories}</tbody></table></div></div></td>
    </tr>`;
  }).join('');
}

function renderRankings(data) {
  if (data.profile.accessLevel !== 'member') return;
  const note = document.querySelector('#member-ranking-note');
  const scoreHeading = document.querySelector('#ranking-score-heading');
  const query = document.querySelector('#ranking-search').value.trim().toLowerCase();

  if (state.rankingCategory === 'season') {
    const season = data.rankings.season;
    const own = season?.own;
    document.querySelector('#personal-ranks').innerHTML = [
      metric('Minha posição', own ? `#${own.rank}` : '—', own ? `${decimal.format(own.totalPoints)} pontos` : 'Sem pontuação Black', '#f2bd4a', 'ranking-summary-card active'),
      metric('Pontos da guilda', integer.format(season?.officialGuildPoints || 0), `Snapshot ${season?.snapshotLabel || 'Ouro'}`, '#f2bd4a'),
      metric('Jogadores', integer.format(season?.playerCount || 0), 'Com contribuição Black registrada', '#23a55a'),
      metric('Estimativa distribuída', decimal.format(season?.distributedEstimate || 0), `Temporada ${season?.season || 33}`, '#33a7d8')
    ].join('');
    const rows = (season?.rows || []).filter((row) => !query || row.name.toLowerCase().includes(query));
    document.querySelector('#member-ranking-table').innerHTML = rows.length ? seasonRankingRows(rows, data.profile.albionName) : '<tr><td colspan="3" class="empty-cell">Nenhum jogador encontrado.</td></tr>';
    scoreHeading.textContent = 'Pontos estimados';
    note.textContent = 'Estimativa proporcional baseada somente nos rankings Black do Guild Might. Totais exibidos pelo jogo em k/m podem gerar pequena margem de arredondamento.';
    note.hidden = false;
    return;
  }

  const own = data.rankings.own || {};
  document.querySelector('#personal-ranks').innerHTML = Object.entries(rankingConfig).map(([key, config]) => metric(
    config.label,
    own[config.rank] ? `#${own[config.rank]}` : '—',
    own[config.value] ? compact.format(own[config.value]).toLowerCase() : 'Sem pontuação',
    '#5865f2',
    `ranking-summary-card${state.rankingCategory === key ? ' active' : ''}`,
  )).join('');
  const config = rankingConfig[state.rankingCategory];
  const rows = data.rankings.rows.filter((row) => row[config.rank] && (!query || row.albion_name.toLowerCase().includes(query))).sort((a, b) => a[config.rank] - b[config.rank]);
  document.querySelector('#member-ranking-table').innerHTML = rows.length ? rows.map((row) => `<tr class="${row.discord_id === data.profile.primaryDiscordId ? 'own-ranking-row' : ''}"><td>#${row[config.rank]}</td><td class="primary-cell">${escapeHtml(row.albion_name)}</td><td class="number-cell">${escapeHtml(compact.format(row[config.value]).toLowerCase())}${config.suffix || ''}</td></tr>`).join('') : '<tr><td colspan="3" class="empty-cell">Nenhum jogador encontrado.</td></tr>';
  scoreHeading.textContent = 'Pontuação';
  note.hidden = true;
}

function requestRow(row, title) {
  return `<div class="portal-list-row"><div><strong>${escapeHtml(title)}</strong><small>${formatDate(row.created_at)}${row.note ? ` · ${escapeHtml(row.note)}` : ''}</small></div><div class="request-value"><b>${escapeHtml(formatSilver(row.amount))}</b>${badge(row.status)}</div></div>`;
}

function renderFinance(data) {
  const finance = data.finance;
  const pending = finance.withdraws.find((row) => ['requested', 'approved'].includes(row.status));
  document.querySelector('#finance-metrics').innerHTML = [
    metric('Saldo', formatSilver(finance.balance), 'Disponível na conta', '#23a55a'),
    metric('Saques', integer.format(finance.withdraws.length), 'Últimos pedidos'),
    metric('Pagamentos', integer.format(finance.paymentRequests.length), 'Serviços solicitados', '#d99a43')
  ].join('');
  document.querySelector('#withdraw-list').innerHTML = finance.withdraws.length ? finance.withdraws.map((row) => requestRow(row, `Saque #${row.id}`)).join('') : empty('Nenhum saque solicitado.');
  document.querySelector('#payment-list').innerHTML = finance.paymentRequests.length ? finance.paymentRequests.map((row) => requestRow(row, row.service || `Pagamento #${row.id}`)).join('') : empty('Nenhum pagamento solicitado.');
  document.querySelector('#transaction-history').innerHTML = finance.transactions.length ? finance.transactions.map((row) => `<tr><td>${formatDate(row.created_at)}</td><td class="primary-cell">${escapeHtml(row.reason)}</td><td class="number-cell ${row.amount >= 0 ? 'positive' : 'negative'}">${row.amount >= 0 ? '+' : ''}${escapeHtml(formatSilver(row.amount))}</td><td class="number-cell">${escapeHtml(formatSilver(row.after_balance))}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-cell">Nenhuma movimentação.</td></tr>';
  document.querySelector('#withdraw-balance-hint').textContent = `Disponível: ${formatSilver(finance.balance)}`;
  state.editingWithdrawId = null;
  document.querySelector('#withdraw-form').hidden = Boolean(pending);
  document.querySelector('#withdraw-form').reset();
  document.querySelector('#withdraw-review-button').textContent = 'Solicitar saque';
  document.querySelector('#withdraw-edit-cancel-button').hidden = true;
  document.querySelector('#withdraw-review').hidden = true;
  const blocked = document.querySelector('#withdraw-blocked');
  blocked.hidden = !pending;
  blocked.innerHTML = pending ? `
    <span>O saque #${pending.id} está ${escapeHtml(statusLabel(pending.status).toLowerCase())}. Você poderá pedir outro quando ele for concluído.</span>
    ${pending.status === 'requested' ? `<div class="withdraw-request-actions"><button class="button button-secondary" type="button" data-withdraw-action="edit" data-request-id="${pending.id}">Editar valor</button><button class="button button-danger" type="button" data-withdraw-action="cancel" data-request-id="${pending.id}">Cancelar pedido</button></div>` : ''}
  ` : '';
  state.withdrawDraft = null;
}

function showFinanceFeedback(message, error = false) {
  const feedback = document.querySelector('#finance-action-feedback');
  feedback.textContent = message;
  feedback.classList.toggle('error', error);
  feedback.hidden = false;
}

function reviewWithdrawal(event) {
  event.preventDefault();
  const amountRaw = document.querySelector('#withdraw-amount').value;
  const amount = parseSilverInput(amountRaw);
  const balance = Number(state.data?.finance?.balance || 0);
  if (!amount) return showFinanceFeedback('Informe um valor válido. Exemplos: 850k, 1.5m ou 1500000.', true);
  if (amount > balance) return showFinanceFeedback(`Seu saldo disponível é ${formatSilver(balance)}.`, true);
  state.withdrawDraft = { amountRaw, amount, note: document.querySelector('#withdraw-note').value.trim(), requestId: state.editingWithdrawId };
  document.querySelector('#withdraw-review-amount').textContent = `${formatSilver(amount)} de ${formatSilver(balance)} disponíveis`;
  document.querySelector('#withdraw-form').hidden = true;
  document.querySelector('#withdraw-review').hidden = false;
  document.querySelector('#finance-action-feedback').hidden = true;
}

function cancelWithdrawalReview() {
  state.withdrawDraft = null;
  document.querySelector('#withdraw-review').hidden = true;
  document.querySelector('#withdraw-form').hidden = false;
}

function startWithdrawEdit(requestId) {
  const request = state.data?.finance?.withdraws.find((row) => Number(row.id) === Number(requestId));
  if (!request || request.status !== 'requested') return showFinanceFeedback('Este saque não pode mais ser editado.', true);
  state.editingWithdrawId = Number(request.id);
  state.withdrawDraft = null;
  document.querySelector('#withdraw-amount').value = String(request.amount);
  document.querySelector('#withdraw-note').value = request.note || '';
  document.querySelector('#withdraw-review-button').textContent = 'Salvar alteração';
  document.querySelector('#withdraw-edit-cancel-button').hidden = false;
  document.querySelector('#withdraw-blocked').hidden = true;
  document.querySelector('#withdraw-review').hidden = true;
  document.querySelector('#withdraw-form').hidden = false;
  document.querySelector('#withdraw-amount').focus();
}

function cancelWithdrawEdit() {
  state.editingWithdrawId = null;
  state.withdrawDraft = null;
  renderFinance(state.data);
}

async function manageWithdrawal(action, requestId, values = {}) {
  if (!state.session?.csrf) return showFinanceFeedback('Sua sessão precisa ser renovada. Atualize a página e tente novamente.', true);
  const response = await fetch('/api/portal/withdrawals/manage', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: state.session.csrf, action, requestId: String(requestId), ...values })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Não foi possível alterar o saque.');
  state.data = body.portal;
  state.lastLoadedAt = Date.now();
  render(state.data);
  setView('finance');
  showFinanceFeedback(body.result.message);
}

async function cancelPendingWithdrawal(requestId) {
  if (!window.confirm(`Cancelar o saque #${requestId}? Nenhum saldo será alterado.`)) return;
  try {
    await manageWithdrawal('cancel', requestId);
  } catch (error) {
    showFinanceFeedback(error.message, true);
  }
}

async function submitWithdrawal() {
  if (!state.withdrawDraft || !state.session?.csrf) return showFinanceFeedback('Sua sessão precisa ser renovada. Saia e entre novamente.', true);
  const button = document.querySelector('#withdraw-confirm-button');
  button.disabled = true;
  button.textContent = 'Enviando…';
  try {
    if (state.withdrawDraft.requestId) {
      await manageWithdrawal('edit', state.withdrawDraft.requestId, { amount: state.withdrawDraft.amountRaw, note: state.withdrawDraft.note });
    } else {
      const response = await fetch('/api/portal/withdrawals', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ csrf: state.session.csrf, amount: state.withdrawDraft.amountRaw, note: state.withdrawDraft.note })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Não foi possível solicitar o saque.');
      state.data = body.portal;
      state.lastLoadedAt = Date.now();
      render(state.data);
      setView('finance');
      showFinanceFeedback(body.result.message);
    }
  } catch (error) {
    showFinanceFeedback(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Confirmar pedido';
  }
}

function render(data) {
  renderOverview(data);
  renderRegistration(data);
  renderEvents(data);
  renderRankings(data);
  renderFinance(data);
  document.querySelector('#freshness-label').textContent = `Atualizado ${new Date(data.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  document.querySelector('#portal-loading').hidden = true;
}

async function loadPortal() {
  try {
    const data = await fetchJson('/api/portal');
    state.data = data;
    state.lastLoadedAt = Date.now();
    render(data);
  } catch (error) {
    const toast = document.querySelector('#portal-error');
    toast.textContent = error.message;
    toast.hidden = false;
    document.querySelector('#portal-loading').hidden = true;
  }
}

function setView(name) {
  if (name === 'rankings' && state.session?.user.accessLevel !== 'member') name = 'overview';
  state.view = name;
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  const active = document.querySelector(`#view-${name}`);
  document.querySelector('#page-title').textContent = active?.dataset.title || 'Meu portal';
  document.querySelector('#page-kicker').textContent = active?.dataset.kicker || 'Notag';
}

document.querySelectorAll('button.nav-item').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelector('#refresh-button').addEventListener('click', loadPortal);
document.querySelector('#ranking-search').addEventListener('input', () => state.data && renderRankings(state.data));
document.querySelector('#member-ranking-table').addEventListener('click', (event) => {
  const button = event.target.closest('[data-season-player]');
  if (!button) return;
  state.expandedSeasonPlayer = state.expandedSeasonPlayer === button.dataset.seasonPlayer ? null : button.dataset.seasonPlayer;
  if (state.data) renderRankings(state.data);
});
document.querySelectorAll('#member-ranking-tabs button').forEach((button) => button.addEventListener('click', () => {
  state.rankingCategory = button.dataset.category;
  document.querySelectorAll('#member-ranking-tabs button').forEach((item) => item.classList.toggle('active', item === button));
  window.history.replaceState(null, '', state.rankingCategory === 'season' ? '#temporada' : window.location.pathname);
  if (state.data) renderRankings(state.data);
}));
document.querySelector('#portal-events').addEventListener('click', (event) => {
  const button = event.target.closest('.event-action');
  if (button) changeEventParticipation(button);
});
document.querySelector('#withdraw-form').addEventListener('submit', reviewWithdrawal);
document.querySelector('#withdraw-confirm-button').addEventListener('click', submitWithdrawal);
document.querySelector('#withdraw-cancel-button').addEventListener('click', cancelWithdrawalReview);
document.querySelector('#withdraw-edit-cancel-button').addEventListener('click', cancelWithdrawEdit);
document.querySelector('#withdraw-blocked').addEventListener('click', (event) => {
  const button = event.target.closest('[data-withdraw-action]');
  if (!button) return;
  if (button.dataset.withdrawAction === 'edit') startWithdrawEdit(button.dataset.requestId);
  if (button.dataset.withdrawAction === 'cancel') cancelPendingWithdrawal(button.dataset.requestId);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !state.withdrawDraft && Date.now() - state.lastLoadedAt >= 30000) loadPortal();
});
window.setInterval(() => { if (!document.hidden && !state.withdrawDraft) loadPortal(); }, 30000);

Promise.all([fetchJson('/api/portal/session'), loadPortal()]).then(([session]) => {
  state.session = session;
  renderSession();
  const seasonRequested = window.location.hash.toLowerCase() === '#temporada' && session.user.accessLevel === 'member';
  if (seasonRequested) {
    state.rankingCategory = 'season';
    document.querySelectorAll('#member-ranking-tabs button').forEach((item) => item.classList.toggle('active', item.dataset.category === 'season'));
    if (state.data) renderRankings(state.data);
    setView('rankings');
  } else {
    setView('overview');
  }
}).catch(() => {});
