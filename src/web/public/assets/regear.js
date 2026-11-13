const state = { data: null };
const silver = new Intl.NumberFormat('pt-BR');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

function formatSilver(value) {
  const amount = Number(value || 0);
  if (!amount) return 'Sem estimativa';
  return `${silver.format(amount)} prata`;
}

function formatDate(value, withTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', withTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'short' });
}

function itemCard(item) {
  return `<li><img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy"><span>${escapeHtml(item.type)}</span>${item.count > 1 ? `<b>×${item.count}</b>` : ''}</li>`;
}

const regearLabels = { pending: 'Aguardando', approved: 'Aprovado', paid: 'Pago' };

function statusActions(row) {
  if (!state.data?.canManage) return '';
  return `<div class="regear-actions" aria-label="Alterar status do regear">
    <button type="button" data-regear-status="pending" data-event-id="${row.eventId}" ${row.regearStatus === 'pending' ? 'disabled' : ''}>Aguardando</button>
    <button type="button" data-regear-status="approved" data-event-id="${row.eventId}" ${row.regearStatus === 'approved' ? 'disabled' : ''}>Aprovar</button>
    <button type="button" data-regear-status="paid" data-event-id="${row.eventId}" ${row.regearStatus === 'paid' ? 'disabled' : ''}>Marcar pago</button>
  </div>`;
}

function deathCard(row, staff) {
  const roles = row.roles.length ? row.roles.map((role) => `<span class="role">${escapeHtml(role.name)}</span>`).join('') : '<span class="role muted">Sem cargo identificado</span>';
  return `<article class="death-card">
    <div class="death-main">
      <div class="death-mark">☠</div>
      <div class="death-copy"><div class="death-meta"><time datetime="${escapeHtml(row.occurredAt)}">${escapeHtml(formatDate(row.occurredAt))}</time><span>Evento #${row.eventId}</span><span class="regear-status ${escapeHtml(row.regearStatus)}">${escapeHtml(regearLabels[row.regearStatus] || row.regearStatus)}</span></div><h3>${escapeHtml(row.victimName)} <small>foi derrotado por</small> ${escapeHtml(row.killerName)}</h3><p>${escapeHtml(row.killerGuild || 'Sem guilda')} · ${row.participants} participante${row.participants === 1 ? '' : 's'} · IP ${row.victimIp || '—'} × ${row.killerIp || '—'}</p>${staff ? `<div class="roles">${roles}</div>` : ''}</div>
      <div class="death-value"><span>Perda estimada</span><strong>${escapeHtml(formatSilver(row.lossValue))}</strong><small>${row.pricedItems}/${row.totalItems} itens com preço</small>${statusActions(row)}</div>
    </div>
    <details><summary>Ver equipamentos e detalhes</summary><div class="death-detail"><ul class="equipment">${row.equipment.length ? row.equipment.map(itemCard).join('') : '<li class="no-equipment">Equipamentos não informados pela API.</li>'}</ul><a href="${escapeHtml(row.detailUrl)}" target="_blank" rel="noopener noreferrer">Abrir no KillBoard #1 ↗</a></div></details>
  </article>`;
}

function filteredRows() {
  const rows = state.data?.rows || [];
  if (state.data?.mode !== 'staff') return rows;
  const player = document.querySelector('#filter-player').value.trim().toLowerCase();
  const role = document.querySelector('#filter-role').value;
  const status = document.querySelector('#filter-status').value;
  const dateFrom = document.querySelector('#filter-date-from').value;
  const dateTo = document.querySelector('#filter-date-to').value;
  const timeFrom = document.querySelector('#filter-time-from').value;
  const timeTo = document.querySelector('#filter-time-to').value;
  return rows.filter((row) => {
    const date = new Date(row.occurredAt);
    const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const localTime = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const matchesPlayer = !player || `${row.victimName} ${row.victimDiscordName || ''}`.toLowerCase().includes(player);
    const matchesRole = !role || row.roles.some((candidate) => candidate.id === role);
    const matchesStatus = !status || row.regearStatus === status;
    return matchesPlayer && matchesRole && matchesStatus && (!dateFrom || localDate >= dateFrom) && (!dateTo || localDate <= dateTo)
      && (!timeFrom || localTime >= timeFrom) && (!timeTo || localTime <= timeTo);
  });
}

function renderMetrics(summary) {
  const values = [
    [silver.format(summary.deaths), 'No histórico disponível'],
    [formatSilver(summary.totalLost), 'Soma das perdas estimadas'],
    [silver.format(summary.pending), 'Aguardando análise'],
    [silver.format(summary.approved), 'Aguardando pagamento'],
    [silver.format(summary.paid), 'Processo concluído']
  ];
  document.querySelectorAll('#metrics article').forEach((card, index) => {
    card.querySelector('strong').textContent = values[index][0];
    card.querySelector('small').textContent = values[index][1];
  });
}

async function updateRegearStatus(button) {
  const status = button.dataset.regearStatus;
  const eventId = button.dataset.eventId;
  if (status === 'paid' && !window.confirm(`Confirmar que o regear do evento #${eventId} foi pago?`)) return;
  button.disabled = true;
  try {
    const response = await fetch('/api/regear/status', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: state.data.csrf, eventId, status })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Não foi possível atualizar o regear.');
    state.data = body.regear;
    renderMetrics(state.data.summary);
    renderRows();
  } catch (error) {
    document.querySelector('#error').textContent = error.message;
    document.querySelector('#error').hidden = false;
    button.disabled = false;
  }
}

function renderRows() {
  const rows = filteredRows();
  document.querySelector('#death-list').innerHTML = rows.map((row) => deathCard(row, state.data.mode === 'staff')).join('');
  document.querySelector('#result-count').textContent = `${silver.format(rows.length)} de ${silver.format(state.data.rows.length)} morte${state.data.rows.length === 1 ? '' : 's'}`;
  document.querySelector('#empty').hidden = rows.length > 0;
}

function configureStaffView(data) {
  const staff = data.mode === 'staff';
  document.querySelector('#staff-link').hidden = !staff;
  document.querySelector('#staff-filters').hidden = !staff;
  if (!staff) return;
  document.querySelector('#mode-label').textContent = 'Visão da staff';
  document.querySelector('#page-heading').textContent = 'Mortes da guilda';
  document.querySelector('#page-description').textContent = 'Consulte todas as mortes e refine a lista por jogador, cargo, data e horário.';
  document.querySelector('#history-heading').textContent = 'Histórico da guilda';
  const roleSelect = document.querySelector('#filter-role');
  roleSelect.innerHTML = '<option value="">Todos os cargos</option>' + data.availableRoles.map((role) => `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name)}</option>`).join('');
}

async function load() {
  document.querySelector('#loading').hidden = false;
  document.querySelector('#error').hidden = true;
  try {
    const response = await fetch('/api/regear', { headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Não foi possível carregar o histórico.');
    state.data = body;
    configureStaffView(body);
    renderMetrics(body.summary);
    renderRows();
  } catch (error) {
    document.querySelector('#error').textContent = error.message;
    document.querySelector('#error').hidden = false;
  } finally {
    document.querySelector('#loading').hidden = true;
  }
}

document.querySelector('#refresh-button').addEventListener('click', load);
document.querySelector('#death-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-regear-status]');
  if (button) updateRegearStatus(button);
});
document.querySelectorAll('#staff-filters input, #staff-filters select').forEach((control) => control.addEventListener('input', renderRows));
document.querySelector('#clear-filters').addEventListener('click', () => {
  document.querySelectorAll('#staff-filters input, #staff-filters select').forEach((control) => { control.value = ''; });
  renderRows();
});
load();
