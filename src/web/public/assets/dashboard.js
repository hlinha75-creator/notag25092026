const state = { data: null, lastLoadedAt: 0, currentView: window.location.hash.slice(1) || 'overview', financeTab: 'withdrawals', csrf: null, userId: null, permissions: { full: true, registrations: true }, registrationPreview: null, memberRosterPreview: null, memberRosterSourceName: null, famePreview: null, famePreviewSort: 'delta-desc', fameCategory: 'pve', fameSourceName: null, operationalPreview: null, operationalKind: 'food', operationalSourceName: null, rankingCategory: 'overall', editingEventId: null };
const number = new Intl.NumberFormat('pt-BR');
const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

function formatCompact(value) {
  const numeric = Number(value || 0);
  const absolute = Math.abs(numeric);
  const formatScaled = (divisor, suffix) => {
    const scaled = numeric / divisor;
    const decimals = Math.abs(scaled) >= 100 ? 0 : 1;
    return `${scaled.toFixed(decimals).replace(/\.0$/, '')}${suffix}`;
  };
  if (absolute >= 1_000_000_000) return formatScaled(1_000_000_000, 'b');
  if (absolute >= 1_000_000) return formatScaled(1_000_000, 'm');
  if (absolute >= 1_000) return formatScaled(1_000, 'k');
  return String(Math.round(numeric));
}

const compact = { format: formatCompact };
const silver = { format: formatCompact };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function formatSilver(value) {
  return `${silver.format(Number(value || 0))} prata`;
}

function formatExactSilver(value) {
  return `${number.format(Number(value || 0))} prata`;
}

function parseDatabaseDate(value) {
  if (!value) return null;
  const normalized = /Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, includeTime = true) {
  const date = parseDatabaseDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: 'short', ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(date);
}

function formatGameDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : formatDate(value);
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

function controlValue(id, fallback = '') {
  return document.querySelector(`#${id}`)?.value ?? fallback;
}

function includesQuery(row, query, fields) {
  const normalized = normalizeText(query).trim();
  return !normalized || fields.some((field) => normalizeText(row[field]).includes(normalized));
}

function dateValue(value) {
  return parseDatabaseDate(value)?.getTime() || 0;
}

function sortRows(rows, sort, options) {
  const compare = options[sort] || options.default;
  return [...rows].sort(compare);
}

function setSummary(id, shown, total) {
  const target = document.querySelector(`#${id}`);
  if (target) target.textContent = `Exibindo ${number.format(shown)} de ${number.format(total)} registros`;
}

function badge(status) {
  const labels = {
    member: 'Membro', pending: 'Pendente', unregistered: 'Aguardando cadastro', guest: 'Convidado',
    overdue: 'Cadastro atrasado', link_review: 'Análise de vínculo', rejected: 'Devolvido',
    approved_member: 'Membro', approved_linked: 'Vínculo aprovado', approved_guest: 'Convidado',
    created: 'Criado', running: 'Em andamento', approved: 'Aprovado', cancelled: 'Cancelado', pending_payment: 'Aguardando pagamento',
    draft: 'Rascunho', submitted: 'Em revisão', review: 'Revisão', requested: 'Aguardando aprovação',
    paid: 'Pago', refused: 'Recusado'
  };
  const safe = escapeHtml(status || 'sem status');
  return `<span class="badge ${safe}">${escapeHtml(labels[status] || status || 'Sem status')}</span>`;
}

function emptyRow(columns, text = 'Nenhum registro encontrado.') {
  return `<tr><td colspan="${columns}" class="empty-row">${escapeHtml(text)}</td></tr>`;
}

function metricCard(label, value, note, _color = '#5865f2', noteClass = '') {
  return `<article class="metric-card"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong><span class="metric-note ${escapeHtml(noteClass)}">${escapeHtml(note)}</span></article>`;
}

function renderRanking(targetId, rows, type, limit = rows.length) {
  const target = document.querySelector(`#${targetId}`);
  const selected = rows.slice(0, limit);
  if (!selected.length) {
    target.innerHTML = '<div class="empty-row">Ranking ainda sem dados para este período.</div>';
    return;
  }
  target.innerHTML = selected.map((row, index) => {
    const value = type === 'pve'
      ? `${compact.format(Number(row.amount || 0))} fama`
      : `${number.format(Number(row.events || 0))} evento${Number(row.events) === 1 ? '' : 's'}`;
    return `<div class="ranking-row"><span class="ranking-position">${index + 1}</span><span class="ranking-name">${escapeHtml(row.albion_name)}</span><span class="ranking-value">${escapeHtml(value)}</span></div>`;
  }).join('');
}

function renderActivity(rows) {
  const target = document.querySelector('#activity-chart');
  const max = Math.max(1, ...rows.map((row) => Number(row.participations || 0)));
  const weekdays = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];
  target.innerHTML = rows.map((row) => {
    const value = Number(row.participations || 0);
    const percent = Math.max(value ? 10 : 3, Math.round((value / max) * 100));
    const bucket = Math.min(100, Math.max(10, Math.ceil(percent / 10) * 10));
    const parsed = parseDatabaseDate(`${row.day}T12:00:00Z`);
    return `<div class="bar-column" title="${value} participações"><i class="h-${bucket}"></i><small>${parsed ? weekdays[parsed.getDay()] : escapeHtml(row.day)}</small></div>`;
  }).join('');
}

function renderCampaign(campaign) {
  const target = document.querySelector('#campaign-card');
  const title = document.querySelector('#campaign-title');
  if (!campaign) {
    title.textContent = 'Nenhuma campanha ativa';
    target.innerHTML = '<div class="empty-row">Não há uma campanha aberta neste momento.</div>';
    return;
  }
  title.textContent = campaign.title;
  const ratio = campaign.goal_amount > 0 ? Math.min(100, Math.round((campaign.raised / campaign.goal_amount) * 100)) : 0;
  const bucket = Math.min(100, Math.max(0, Math.round(ratio / 5) * 5));
  target.innerHTML = `<div class="campaign-progress"><div class="campaign-values"><strong>${escapeHtml(silver.format(campaign.raised))}</strong><span>de ${escapeHtml(formatSilver(campaign.goal_amount))}</span></div><div class="progress-track"><i class="p-${bucket}"></i></div><div class="campaign-meta"><span>${ratio}% concluído</span><span>${number.format(campaign.contributors)} contribuidores</span></div></div>`;
}

function transactionRows(rows, depositsOnly = false) {
  const selected = depositsOnly ? rows.filter((row) => Number(row.amount) > 0 && String(row.type).toLowerCase().includes('deposit')) : rows;
  if (!selected.length) return emptyRow(5, depositsOnly ? 'Nenhum depósito registrado.' : 'Nenhuma movimentação registrada.');
  return selected.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.albion_name)}</td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.reason)}</td><td>${formatDate(row.created_at)}</td><td class="number-cell ${Number(row.amount) >= 0 ? 'positive-value' : 'negative-value'}">${Number(row.amount) >= 0 ? '+' : ''}${escapeHtml(compact.format(row.amount))}</td></tr>`).join('');
}

function renderOverview(data) {
  const overview = data.overview;
  const campaign = overview.campaign;
  document.querySelector('#overview-metrics').innerHTML = [
    metricCard('Dívida real com membros', formatExactSilver(overview.totalMemberBalance), 'Soma dos saldos positivos de membros ativos', '#23a55a'),
    metricCard('Campanha ativa', campaign ? silver.format(campaign.raised) : '—', campaign ? `Meta: ${silver.format(campaign.goal_amount)}` : 'Nenhuma campanha aberta', '#f0b232'),
    metricCard('Membros ativos', number.format(overview.activeMembers), 'Cadastros com status membro', '#5865f2'),
    metricCard('Depósitos — 7 dias', formatSilver(overview.deposits7d.amount), `${number.format(overview.deposits7d.count)} registros`, '#37c9ef')
  ].join('');
  renderActivity(overview.activity);
  renderCampaign(campaign);
  renderRanking('pve-ranking-mini', data.rankings.pve.rows, 'pve', 5);
  renderRanking('participation-ranking-mini', data.rankings.participation.rows, 'participation', 5);
  const deposits = overview.recentDeposits;
  document.querySelector('#recent-deposits-table').innerHTML = deposits.length
    ? deposits.slice(0, 7).map((row) => `<tr><td class="primary-cell">${escapeHtml(row.albion_name)}</td><td>${escapeHtml(row.reason)}</td><td>${formatDate(row.created_at)}</td><td class="number-cell positive-value">+${escapeHtml(compact.format(row.amount))}</td></tr>`).join('')
    : emptyRow(4, 'Nenhum depósito recente encontrado.');
}

function renderMembers(members) {
  const query = controlValue('member-search');
  const status = controlValue('member-status');
  const filtered = members.filter((row) => (!status || row.registration_status === status) && includesQuery(row, query, ['albion_name', 'discord_name', 'registration_status']));
  const sorted = sortRows(filtered, controlValue('member-sort', 'name-asc'), {
    'name-asc': (a, b) => collator.compare(a.albion_name || '', b.albion_name || ''),
    'name-desc': (a, b) => collator.compare(b.albion_name || '', a.albion_name || ''),
    'balance-desc': (a, b) => Number(b.balance || 0) - Number(a.balance || 0),
    'balance-asc': (a, b) => Number(a.balance || 0) - Number(b.balance || 0),
    'events-desc': (a, b) => Number(b.events_total || 0) - Number(a.events_total || 0),
    'events-asc': (a, b) => Number(a.events_total || 0) - Number(b.events_total || 0),
    default: (a, b) => collator.compare(a.albion_name || '', b.albion_name || '')
  });
  setSummary('members-summary', sorted.length, members.length);
  document.querySelector('#members-table').innerHTML = sorted.length ? sorted.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.albion_name || 'Sem nome Albion')}</td><td>${badge(row.registration_status)}</td><td>${escapeHtml(row.discord_name || '—')}</td><td>${number.format(row.events_total)}</td><td class="number-cell">${escapeHtml(formatSilver(row.balance))}</td></tr>`).join('') : emptyRow(5);
}

function registrationActions(row) {
  const id = escapeHtml(row.discord_id);
  if (row.queue_status === 'member') return '<span class="muted-value">Concluído</span>';
  const analyzeLabel = row.queue_status === 'link_review' ? 'Analisar vínculo' : (row.requested_albion_name ? 'Analisar' : 'Cadastrar');
  const analyze = `<button class="button button-primary registration-action" type="button" data-action="analyze" data-discord-id="${id}">${analyzeLabel}</button>`;
  const reject = ['pending', 'link_review'].includes(row.queue_status)
    ? `<button class="button button-danger registration-action" type="button" data-action="reject" data-discord-id="${id}">Devolver</button>` : '';
  const remind = ['unregistered', 'overdue', 'rejected', 'guest'].includes(row.queue_status)
    ? `<button class="button button-ghost registration-action" type="button" data-action="remind" data-discord-id="${id}">Reenviar aviso</button>` : '';
  return `<div class="table-actions">${analyze}${reject}${remind}</div>`;
}

function waitingLabel(hours) {
  const value = Number(hours || 0);
  if (value < 1) return 'menos de 1h';
  if (value < 24) return `${value}h`;
  return `${Math.floor(value / 24)}d ${value % 24}h`;
}

function registrationRosterNote(row) {
  if (row.roster_status === 'current') {
    const lastSeen = row.roster_last_seen ? ` · ${row.roster_last_seen}` : '';
    return `<small class="roster-state current">Na lista atual${escapeHtml(lastSeen)}</small>`;
  }
  if (row.roster_status === 'absent') return '<small class="roster-state absent">Não encontrado na lista atual</small>';
  return '';
}

function renderRegistrations(registrations = [], pending = 0, memberRoster = null) {
  const counts = registrations.reduce((result, row) => {
    result[row.queue_status || 'unregistered'] = (result[row.queue_status || 'unregistered'] || 0) + 1;
    return result;
  }, {});
  document.querySelector('#registration-metrics').innerHTML = [
    metricCard('Para analisar', number.format((counts.pending || 0) + (counts.link_review || 0)), `${number.format(counts.link_review || 0)} vínculo(s)`, '#f0b232'),
    metricCard('Atrasados', number.format(counts.overdue || 0), 'Mais de 24 horas', '#ed4245'),
    metricCard('Aguardando cadastro', number.format((counts.unregistered || 0) + (counts.guest || 0)), 'Convidados sem envio', '#5865f2'),
    metricCard('Lista atual da guilda', memberRoster ? number.format(memberRoster.memberCount) : '—', memberRoster ? `${number.format(memberRoster.linkedCount)} vinculados ao Discord` : 'Ainda não importada', '#37c9ef')
  ].join('');
  const query = controlValue('registration-search');
  const status = controlValue('registration-status');
  const filtered = registrations.filter((row) => (!status || row.queue_status === status) && includesQuery(row, query, ['requested_albion_name', 'albion_name', 'discord_name', 'discord_display_name', 'queue_status']));
  const priority = { link_review: 0, pending: 1, overdue: 2, unregistered: 3, rejected: 4, guest: 5, member: 6 };
  const sorted = sortRows(filtered, controlValue('registration-sort', 'priority'), {
    priority: (a, b) => (priority[a.queue_status] ?? 9) - (priority[b.queue_status] ?? 9) || Number(b.waiting_hours || 0) - Number(a.waiting_hours || 0),
    'waiting-desc': (a, b) => Number(b.waiting_hours || 0) - Number(a.waiting_hours || 0),
    'waiting-asc': (a, b) => Number(a.waiting_hours || 0) - Number(b.waiting_hours || 0),
    'name-asc': (a, b) => collator.compare(a.requested_albion_name || a.discord_name || '', b.requested_albion_name || b.discord_name || ''),
    'name-desc': (a, b) => collator.compare(b.requested_albion_name || b.discord_name || '', a.requested_albion_name || a.discord_name || ''),
    default: (a, b) => (priority[a.queue_status] ?? 9) - (priority[b.queue_status] ?? 9)
  });
  setSummary('registrations-summary', sorted.length, registrations.length);
  document.querySelector('#registrations-table').innerHTML = sorted.length ? sorted.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.requested_albion_name || row.albion_name || 'Não informado')}${row.linked_owner_id ? `<small>Já vinculado a ${escapeHtml(row.linked_owner_name || row.linked_owner_id)}</small>` : ''}${registrationRosterNote(row)}</td><td>${escapeHtml(row.discord_display_name || row.discord_name || row.discord_id)}<small>${escapeHtml(row.discord_id)}</small></td><td>${badge(row.queue_status)}</td><td>${escapeHtml(waitingLabel(row.waiting_hours))}</td><td>${registrationActions(row)}</td></tr>`).join('') : emptyRow(5);
}

function renderMemberRosterCurrent(roster) {
  const target = document.querySelector('#member-roster-current');
  if (!roster) {
    target.textContent = 'Nenhuma lista importada. Abra para enviar a lista atual do jogo.';
    return;
  }
  target.textContent = `${number.format(roster.memberCount)} membros · ${number.format(roster.onlineCount)} online · ${number.format(roster.linkedCount)} vinculados · atualizada ${formatDate(roster.createdAt)}`;
}

function rosterDifference(label, values, tone = '') {
  if (!values?.length) return `<div class="roster-difference ${tone}"><strong>${escapeHtml(label)}</strong><span>Nenhum</span></div>`;
  const names = values.slice(0, 12).map((value) => escapeHtml(typeof value === 'string' ? value : (value.albionName || value.characterName || value.discordName))).join(', ');
  const remaining = values.length > 12 ? ` +${values.length - 12}` : '';
  return `<div class="roster-difference ${tone}"><strong>${escapeHtml(label)} (${number.format(values.length)})</strong><span>${names}${remaining}</span></div>`;
}

function resetMemberRosterPreview() {
  state.memberRosterPreview = null;
  document.querySelector('#member-roster-status').textContent = 'Aguardando lista';
  document.querySelector('#member-roster-status').className = 'badge';
  document.querySelector('#member-roster-empty').hidden = false;
  document.querySelector('#member-roster-preview-content').hidden = true;
}

function renderMemberRosterPreview(preview) {
  state.memberRosterPreview = preview;
  const status = document.querySelector('#member-roster-status');
  status.textContent = 'Pronta para confirmar';
  status.className = 'badge member';
  document.querySelector('#member-roster-empty').hidden = true;
  document.querySelector('#member-roster-preview-content').hidden = false;
  document.querySelector('#member-roster-metrics').innerHTML = [
    metricCard('Membros no jogo', number.format(preview.memberCount), `${number.format(preview.onlineCount)} online`, '#5865f2'),
    metricCard('Vínculo automático', number.format(preview.automaticCount), 'Nome exato e único no Discord', '#23a55a'),
    metricCard('Pedir confirmação', number.format(preview.confirmationCount), 'Correspondência parecida por DM', '#f0b232'),
    metricCard('Revisão da staff', number.format(preview.pendingMatchCount), 'Sem correspondência segura', '#ed4245')
  ].join('');
  document.querySelector('#member-roster-differences').innerHTML = [
    rosterDifference('Promoções automáticas', preview.automaticMatches, 'positive'),
    rosterDifference('Confirmações por DM', preview.confirmationMatches, 'warning'),
    rosterDifference('Sem correspondência segura', preview.pendingMatches),
    rosterDifference('Entraram desde a lista anterior', preview.additions, 'positive'),
    rosterDifference('Saíram desde a lista anterior', preview.removals, 'negative'),
    rosterDifference('Na guilda sem vínculo Discord', preview.unlinked),
    rosterDifference('Cadastros Membro fora da lista', preview.registeredOutside, 'warning'),
    ...(preview.duplicates.length ? [rosterDifference('Duplicados ignorados', preview.duplicates, 'warning')] : [])
  ].join('');
  setSummary('member-roster-preview-summary', preview.sample.length, preview.memberCount);
  const matchBadge = (row) => {
    if (row.matchType === 'linked') return '<span class="badge member">Já vinculado</span>';
    if (row.matchType === 'automatic') return `<span class="badge member">Automático: ${escapeHtml(row.match?.discordName || '')}</span>`;
    if (row.matchType === 'confirmation') return `<span class="badge pending">Confirmar: ${escapeHtml(row.match?.discordName || '')}</span>`;
    return '<span class="badge rejected">Revisão da staff</span>';
  };
  document.querySelector('#member-roster-preview-table').innerHTML = preview.sample.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.characterName)}</td><td>${escapeHtml(row.lastSeen || '—')}</td><td>${escapeHtml(row.roles.join(', ') || '—')}</td><td>${matchBadge(row)}</td></tr>`).join('') || emptyRow(4);
}

async function analyzeMemberRoster() {
  const rosterText = document.querySelector('#member-roster-text').value;
  const button = document.querySelector('#member-roster-analyze');
  button.disabled = true;
  button.textContent = 'Analisando…';
  try {
    const response = await postForm('/api/staff/member-roster', {
      action: 'preview',
      sourceName: state.memberRosterSourceName || 'Lista copiada do Albion',
      rosterText
    });
    renderMemberRosterPreview(response.result.preview);
    showRegistrationFeedback(response.result.message);
  } catch (error) {
    resetMemberRosterPreview();
    showRegistrationFeedback(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Analisar lista';
  }
}

async function confirmMemberRoster() {
  if (!state.memberRosterPreview) return;
  const button = document.querySelector('#member-roster-confirm');
  button.disabled = true;
  button.textContent = 'Salvando…';
  try {
    const response = await postForm('/api/staff/member-roster', {
      action: 'confirm',
      sourceName: state.memberRosterSourceName || 'Lista copiada do Albion',
      rosterText: document.querySelector('#member-roster-text').value
    });
    state.data = response.dashboard;
    document.querySelector('#member-roster-text').value = '';
    document.querySelector('#member-roster-file').value = '';
    state.memberRosterSourceName = null;
    document.querySelector('#member-roster-source').textContent = 'Nenhum arquivo selecionado';
    resetMemberRosterPreview();
    render(state.data);
    showRegistrationFeedback(response.result.message);
  } catch (error) {
    showRegistrationFeedback(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Confirmar e automatizar';
  }
}

function renderEvents(events) {
  const query = controlValue('event-search');
  const status = controlValue('event-status');
  const eventDate = (row) => row.ended_at || row.started_at || row.created_at;
  const filtered = events.filter((row) => (!status || row.status === status) && includesQuery(row, query, ['title', 'event_code', 'location', 'status', 'review_status']));
  const sorted = sortRows(filtered, controlValue('event-sort', 'date-desc'), {
    'date-desc': (a, b) => dateValue(eventDate(b)) - dateValue(eventDate(a)),
    'date-asc': (a, b) => dateValue(eventDate(a)) - dateValue(eventDate(b)),
    'participants-desc': (a, b) => Number(b.participants || 0) - Number(a.participants || 0),
    'participants-asc': (a, b) => Number(a.participants || 0) - Number(b.participants || 0),
    'name-asc': (a, b) => collator.compare(a.title || '', b.title || ''),
    'name-desc': (a, b) => collator.compare(b.title || '', a.title || ''),
    default: (a, b) => dateValue(eventDate(b)) - dateValue(eventDate(a))
  });
  setSummary('events-summary', sorted.length, events.length);
  document.querySelector('#events-table').innerHTML = sorted.length ? sorted.map(eventManagementRow).join('') : emptyRow(6);
}

function eventAudienceLabel(audience) {
  if (audience === 'staff') return 'Staff';
  if (audience === 'member') return 'Membros';
  return 'Público';
}

function eventTypeLabel(contentType) {
  return state.data?.eventTypes?.find((type) => type.key === contentType)?.label || 'Outro';
}

function eventTypeOptions(selected = '') {
  return (state.data?.eventTypes || []).map((type) => (
    `<option value="${escapeHtml(type.key)}" ${type.key === selected ? 'selected' : ''}>${escapeHtml(type.emoji)} ${escapeHtml(type.label)}</option>`
  )).join('');
}

function eventCapacity(row) {
  return Number(row.tank_slots || 0) + Number(row.healer_slots || 0) + Number(row.support_slots || 0) + Number(row.dps_slots || 0);
}

function eventManagementActions(row) {
  if (row.status === 'created') {
    const edit = row.event_kind === 'standard'
      ? `<button class="button button-ghost staff-event-action" type="button" data-action="edit" data-event-id="${row.id}">Editar</button>`
      : '';
    return `${edit}<button class="button button-success staff-event-action" type="button" data-action="start" data-event-id="${row.id}">Iniciar</button><button class="button button-danger staff-event-action" type="button" data-action="cancel" data-event-id="${row.id}">Cancelar</button>`;
  }
  if (row.status === 'running') {
    return `<button class="button button-primary staff-event-action" type="button" data-action="finish" data-event-id="${row.id}">Finalizar</button><button class="button button-danger staff-event-action" type="button" data-action="cancel" data-event-id="${row.id}">Cancelar</button>`;
  }
  if (row.status === 'review') {
    return `<button class="button button-primary staff-event-action" type="button" data-action="submit_review" data-event-id="${row.id}">Enviar ao financeiro</button>`;
  }
  if (row.status === 'pending_payment') {
    return `<button class="button button-success staff-event-action" type="button" data-action="approve_payment" data-event-id="${row.id}">Aprovar pagamento</button><button class="button button-ghost staff-event-action" type="button" data-action="return_review" data-event-id="${row.id}">Devolver</button>`;
  }
  return '<span class="secondary-text">Sem ação</span>';
}

function eventManagementRow(row) {
  const creator = row.creator_name || row.creator_id || 'Desconhecido';
  const capacity = eventCapacity(row);
  const spectators = Number(row.spectators || 0);
  const schedule = row.scheduled_time
    ? escapeHtml(row.scheduled_time)
    : formatDate(row.started_at || row.created_at);
  return `<tr><td class="primary-cell">${escapeHtml(row.title)}<span class="secondary-text">${escapeHtml(eventTypeLabel(row.content_type))} · ${escapeHtml(row.event_code)} · por ${escapeHtml(creator)}</span></td><td><strong>${escapeHtml(eventAudienceLabel(row.audience))}</strong><span class="secondary-text">${escapeHtml(row.location || 'Local a confirmar')}</span></td><td>${badge(row.status)}</td><td>${number.format(row.participants || 0)}/${number.format(capacity)}<span class="secondary-text">${number.format(spectators)} espectador(es)</span></td><td>${schedule}</td><td><div class="staff-event-actions">${eventManagementActions(row)}</div></td></tr>`;
}

function eventManagementMarkup() {
  return `
    <div id="staff-event-feedback" class="finance-action-feedback" hidden></div>
    <article class="panel event-management-panel">
      <div class="panel-head"><div><span>Discord + site</span><h3 id="staff-event-form-title">Criar novo evento</h3></div><a class="button button-primary" href="/pingcontent">Criador visual com armas</a></div>
      <form id="staff-event-form" class="staff-event-form">
        <input type="hidden" name="eventId">
        <label class="event-field event-title-field"><span>Qual tipo de evento?</span><select name="contentType" required><option value="">Selecione o tipo</option>${eventTypeOptions()}</select></label>
        <label class="event-field event-title-field"><span>Título</span><input name="title" maxlength="80" required placeholder="Ex: Roaming 4.2"></label>
        <label class="event-field"><span>Data e hora (opcional)</span><input name="scheduledTime" maxlength="80" placeholder="Ex: 30/07 20:00 UTC"></label>
        <label class="event-field"><span>Local</span><input name="location" maxlength="100" placeholder="Ex: Pergunte na Call"></label>
        <label class="event-field"><span>Público</span><select name="audience"><option value="public">Convidados e Membros</option><option value="member">Somente Membros</option><option value="staff">Interno da Staff</option></select></label>
        <label class="event-field event-description-field"><span>Build ou descrição</span><textarea name="description" maxlength="500" rows="3" placeholder="Build, IP, objetivo e observações"></textarea></label>
        <fieldset class="event-slots"><legend>Composição</legend>
          <label><span>Tank</span><input type="number" name="tankSlots" min="0" max="20" value="1" required></label>
          <label><span>Healer</span><input type="number" name="healerSlots" min="0" max="20" value="1" required></label>
          <label><span>Suporte</span><input type="number" name="supportSlots" min="0" max="20" value="1" required></label>
          <label><span>DPS</span><input type="number" name="dpsSlots" min="0" max="20" value="17" required></label>
        </fieldset>
        <div class="staff-event-form-actions"><button class="button button-primary" id="staff-event-submit" type="submit">Criar e publicar</button><button class="button button-ghost" id="staff-event-reset" type="button" hidden>Cancelar edição</button></div>
      </form>
    </article>`;
}

function finishEventDialogMarkup() {
  return `<dialog class="event-dialog" id="finish-event-dialog"><form id="finish-event-form" class="event-finish-form"><input type="hidden" name="eventId"><div class="dialog-head"><div><span>Encerrar atividade</span><h3>Finalizar evento e criar revisão</h3></div><button type="button" class="icon-button" data-close-event-dialog aria-label="Fechar">×</button></div><p>O bot moverá todos para Aguardando Evento, apagará a call e criará o canal privado de revisão.</p><div class="event-finish-grid"><label class="event-field"><span>Loot total</span><input name="lootTotal" required placeholder="Ex: 50m"></label><label class="event-field"><span>Reparo</span><input name="repair" value="0" required></label><label class="event-field"><span>Sacos de prata</span><input name="silverBags" value="0" required></label><label class="event-field"><span>Taxa %</span><input type="number" name="taxPercent" min="0" max="100" value="0" required></label><label class="event-field event-description-field"><span>Evidências ou observações</span><textarea name="evidenceNotes" maxlength="1000" rows="3" placeholder="DPS meter, fama total ou observações"></textarea></label></div><div class="dialog-actions"><button type="button" class="button button-ghost" data-close-event-dialog>Voltar</button><button type="submit" class="button button-primary">Finalizar e revisar</button></div></form></dialog>`;
}

function renderOperations(operations) {
  document.querySelector('#operations-metrics').innerHTML = [
    metricCard('Eventos ativos', number.format(operations.activeEvents), 'Criados, em andamento ou revisão', '#5865f2'),
    metricCard('Revisões pendentes', number.format(operations.reviewsPending), 'Loot splits aguardando conclusão', '#f0b232'),
    metricCard('Cadastros pendentes', number.format(operations.registrationsPending), 'Solicitações aguardando staff', '#37c9ef'),
    metricCard('Financeiro pendente', number.format(Number(operations.paymentRequestsPending || 0) + Number(operations.withdrawRequestsPending || 0)), `${number.format(operations.withdrawRequestsPending || 0)} saque(s)`, '#23a55a')
  ].join('');
}

function withdrawActionButtons(request) {
  if (['requested', 'approved'].includes(request.status)) {
    return `<button class="button button-success staff-withdraw-action" type="button" data-action="pay" data-request-id="${request.id}">Marcar como pago</button><button class="button button-danger staff-withdraw-action" type="button" data-action="refuse" data-request-id="${request.id}">Recusar saque</button>`;
  }
  return '';
}

function renderWithdrawRequests(withdrawals) {
  const pending = withdrawals.filter((request) => ['requested', 'approved'].includes(request.status));
  document.querySelector('#withdrawals-summary').textContent = `${number.format(pending.length)} pendente(s)`;
  document.querySelector('#staff-withdraw-list').innerHTML = pending.length ? pending.map((request) => {
    const exceedsBalance = Number(request.amount || 0) > Number(request.current_balance || 0);
    return `
    <div class="staff-withdraw-row ${exceedsBalance ? 'withdraw-over-balance' : ''}">
      <div class="staff-withdraw-main"><strong>Saque #${request.id} · ${escapeHtml(request.member_name)}</strong><small>${formatDate(request.created_at)}${request.note ? ` · ${escapeHtml(request.note)}` : ''}</small></div>
      <div class="staff-withdraw-values"><b>${escapeHtml(formatSilver(request.amount))}</b><small>Saldo: ${escapeHtml(formatSilver(request.current_balance))}</small>${exceedsBalance ? '<em>Pedido acima do saldo disponível</em>' : ''}</div>
      <div>${badge(request.status)}</div>
      <div class="staff-withdraw-actions">${withdrawActionButtons(request)}</div>
    </div>`;
  }).join('') : '<div class="empty-row">Nenhum saque aguardando ação da staff.</div>';
}

function setFinanceTab(tab) {
  const allowed = new Set(['withdrawals', 'balances', 'transactions']);
  state.financeTab = allowed.has(tab) ? tab : 'withdrawals';
  document.querySelectorAll('[data-finance-tab]').forEach((button) => {
    const selected = button.dataset.financeTab === state.financeTab;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  document.querySelectorAll('[data-finance-panel]').forEach((panel) => {
    const selected = panel.dataset.financePanel === state.financeTab;
    panel.classList.toggle('active', selected);
    panel.hidden = !selected;
  });
}

function renderMemberBalances(rows = []) {
  const query = controlValue('member-balance-search');
  const sort = controlValue('member-balance-sort', 'balance-desc');
  const filtered = rows.filter((row) => includesQuery(row, query, ['albion_name', 'discord_name', 'discord_id']));
  const selected = sortRows(filtered, sort, {
    'balance-desc': (a, b) => Number(b.balance || 0) - Number(a.balance || 0),
    'balance-asc': (a, b) => Number(a.balance || 0) - Number(b.balance || 0),
    'name-asc': (a, b) => collator.compare(a.albion_name || a.discord_name || a.discord_id, b.albion_name || b.discord_name || b.discord_id),
    'name-desc': (a, b) => collator.compare(b.albion_name || b.discord_name || b.discord_id, a.albion_name || a.discord_name || a.discord_id),
    default: (a, b) => Number(b.balance || 0) - Number(a.balance || 0)
  });
  setSummary('member-balances-summary', selected.length, rows.length);
  document.querySelector('#member-balances-table').innerHTML = selected.length ? selected.map((row) => `
    <tr>
      <td class="primary-cell">${escapeHtml(row.albion_name || row.discord_name || row.discord_id)}</td>
      <td>${escapeHtml(row.discord_name || '—')}</td>
      <td class="number-cell positive-value">${escapeHtml(formatExactSilver(row.balance))}</td>
      <td>${formatDate(row.last_updated)}</td>
    </tr>`).join('') : emptyRow(4, 'Nenhum membro com saldo positivo encontrado.');
}

function renderFinance(finance, totalBalance) {
  const campaign = finance.campaign;
  const pendingWithdrawals = finance.withdrawals.filter((request) => ['requested', 'approved'].includes(request.status));
  const pendingWithdrawalsTotal = pendingWithdrawals.reduce((sum, request) => sum + Number(request.amount || 0), 0);
  document.querySelector('#finance-metrics').innerHTML = [
    metricCard('Dívida real com membros', formatExactSilver(totalBalance), `${number.format(finance.memberBalances?.length || 0)} membros com saldo positivo`, '#23a55a'),
    metricCard('Campanha arrecadada', campaign ? formatSilver(campaign.raised) : '—', campaign?.title || 'Sem campanha ativa', '#f0b232'),
    metricCard('Saques pendentes', `${number.format(pendingWithdrawals.length)} pedidos`, `${formatExactSilver(pendingWithdrawalsTotal)} solicitado`, '#5865f2')
  ].join('');
  const metricCards = document.querySelectorAll('#finance-metrics .metric-card');
  [[metricCards[0], 'balances'], [metricCards[2], 'withdrawals']].forEach(([card, target]) => {
    if (!card) return;
    card.classList.add('interactive');
    card.dataset.financeTarget = target;
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
  });
  document.querySelector('#finance-tab-withdrawals-count').textContent = number.format(pendingWithdrawals.length);
  document.querySelector('#finance-tab-balances-count').textContent = number.format(finance.memberBalances?.length || 0);
  renderMemberBalances(finance.memberBalances || []);
  renderWithdrawRequests(finance.withdrawals);
  const transactionQuery = controlValue('transaction-search');
  const kind = controlValue('transaction-kind');
  const transactionFiltered = finance.transactions.filter((row) => {
    const amount = Number(row.amount || 0);
    return (!kind || (kind === 'credit' ? amount >= 0 : amount < 0)) && includesQuery(row, transactionQuery, ['albion_name', 'type', 'reason']);
  });
  const transactionSorted = sortTransactions(transactionFiltered, controlValue('transaction-sort', 'date-desc'));
  setSummary('transactions-summary', transactionSorted.length, finance.transactions.length);
  document.querySelector('#transactions-table').innerHTML = transactionRows(transactionSorted);

  const allDeposits = finance.transactions.filter((row) => Number(row.amount) > 0 && String(row.type).toLowerCase().includes('deposit'));
  const depositQuery = controlValue('deposit-search');
  const depositFiltered = allDeposits.filter((row) => includesQuery(row, depositQuery, ['albion_name', 'type', 'reason']));
  const depositSorted = sortTransactions(depositFiltered, controlValue('deposit-sort', 'date-desc'));
  setSummary('deposits-summary', depositSorted.length, allDeposits.length);
  document.querySelector('#deposits-table').innerHTML = transactionRows(depositSorted, true);
  setFinanceTab(state.financeTab);
}

function showStaffFinanceFeedback(message, error = false) {
  const feedback = document.querySelector('#staff-finance-feedback');
  feedback.textContent = message;
  feedback.classList.toggle('error', error);
  feedback.hidden = false;
}

async function manageStaffWithdrawal(button) {
  const action = button.dataset.action;
  const requestId = button.dataset.requestId;
  const prompts = {
    pay: `Confirmar que o saque #${requestId} já foi entregue? O valor será descontado do saldo agora.`,
    refuse: `Recusar o saque #${requestId}? Nenhum saldo será alterado.`
  };
  if (prompts[action] && !window.confirm(prompts[action])) return;
  button.disabled = true;
  const previousScrollY = window.scrollY;
  try {
    const body = await postForm('/api/staff/withdrawals', { requestId, action });
    state.data = body.dashboard;
    state.lastLoadedAt = Date.now();
    render(state.data);
    switchView('finance', { scroll: false });
    showStaffFinanceFeedback(body.result.message);
    window.requestAnimationFrame(() => window.scrollTo({ top: previousScrollY }));
  } catch (error) {
    showStaffFinanceFeedback(error.message, true);
    button.disabled = false;
  }
}

function sortTransactions(rows, sort) {
  return sortRows(rows, sort, {
    'date-desc': (a, b) => dateValue(b.created_at) - dateValue(a.created_at),
    'date-asc': (a, b) => dateValue(a.created_at) - dateValue(b.created_at),
    'amount-desc': (a, b) => Number(b.amount || 0) - Number(a.amount || 0),
    'amount-asc': (a, b) => Number(a.amount || 0) - Number(b.amount || 0),
    'name-asc': (a, b) => collator.compare(a.albion_name || '', b.albion_name || ''),
    'name-desc': (a, b) => collator.compare(b.albion_name || '', a.albion_name || ''),
    default: (a, b) => dateValue(b.created_at) - dateValue(a.created_at)
  });
}

function renderRankings(rankings) {
  document.querySelector('#pve-period').textContent = rankings.pve.label;
  document.querySelector('#participation-period').textContent = rankings.participation.label;
  renderRanking('pve-ranking-full', rankings.pve.rows, 'pve');
  renderRanking('participation-ranking-full', rankings.participation.rows, 'participation');
  renderSeasonRanking(rankings.season);
  renderFameRankings(rankings.fame);
}

function renderSeasonRanking(season) {
  if (!season) return;
  const pointsFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const query = controlValue('season-ranking-search');
  const link = controlValue('ranking-link');
  const rows = season.rows.filter((row) => (
    (!link || (link === 'linked' ? row.linked : !row.linked))
    && includesQuery(row, query, ['name'])
  ));
  const capturedAt = season.capturedAt ? season.capturedAt.split('-').reverse().join('/') : 'data não informada';
  const missing = Object.values(season.missingRanks || {}).reduce((sum, ranks) => sum + ranks.length, 0);
  document.querySelector('#season-ranking-period').textContent = `Snapshot ${season.snapshotLabel} · ${capturedAt}`;
  document.querySelector('#season-ranking-metrics').innerHTML = [
    metricCard('Pontos da guilda', number.format(season.officialGuildPoints), 'Total oficial no snapshot'),
    metricCard('Estimativa distribuída', pointsFormat.format(season.distributedEstimate), 'Somente linhas capturadas'),
    metricCard('Jogadores pontuando', number.format(season.rows.length), 'Ao menos uma categoria Black'),
    metricCard('Linhas pendentes', number.format(missing), missing ? 'Revisar capturas incompletas' : 'Capturas individuais completas')
  ].join('');
  setSummary('season-ranking-summary', rows.length, season.rows.length);
  document.querySelector('#season-ranking-table').innerHTML = rows.length ? rows.map((row) => (
    `<tr><td class="ranking-table-position">#${number.format(row.rank)}</td>`
    + `<td class="primary-cell">${escapeHtml(row.name)}<small>${row.linked ? 'Vinculado ao Discord' : 'Sem vínculo confirmado'}</small></td>`
    + `<td>${escapeHtml(row.mainCategory?.label || '—')}<small>${row.mainCategory ? `${pointsFormat.format(row.mainCategory.points)} pts` : ''}</small></td>`
    + `<td class="number-cell ranking-primary-value">${escapeHtml(pointsFormat.format(row.totalPoints))} pts</td></tr>`
  )).join('') : emptyRow(4, 'Nenhum jogador encontrado com estes filtros.');
  document.querySelector('#season-ranking-note').textContent = 'Fórmula: pontos da categoria × contribuição Black do jogador ÷ total da categoria. Totais exibidos em k/m produzem pequena margem de arredondamento.';
}

const fameCategoryLabels = { pve: 'PvE', pvp: 'PvP', gathering: 'Coleta', crafting: 'Craft' };
const fameRankingConfigs = {
  overall: { label: 'Geral', title: 'Classificação geral', valueField: 'overall_score', rankField: 'overall_rank', score: true },
  pve: { label: 'PvE', title: 'Classificação PvE', valueField: 'pve_fame', rankField: 'pve_fame_rank' },
  pvp: { label: 'PvP', title: 'Classificação PvP', valueField: 'pvp_fame', rankField: 'pvp_fame_rank' },
  gathering: { label: 'Coleta', title: 'Classificação de coleta', valueField: 'gathering_fame', rankField: 'gathering_fame_rank' },
  crafting: { label: 'Craft', title: 'Classificação de craft', valueField: 'crafting_fame', rankField: 'crafting_fame_rank' }
};

function fameValue(row, config) {
  const value = row[config.valueField];
  if (value === null || value === undefined || (!config.score && Number(value) <= 0)) return 'Sem pontos';
  return config.score ? `${Number(value).toFixed(1)} pts` : compact.format(value);
}

function renderFameRankings(fameData) {
  const rows = fameData?.rows || [];
  const config = fameRankingConfigs[state.rankingCategory] || fameRankingConfigs.overall;
  const query = controlValue('ranking-search');
  const linkFilter = controlValue('ranking-link');
  const sort = controlValue('ranking-sort', 'rank');
  const hasValue = (row) => row[config.rankField] !== null && row[config.rankField] !== undefined;
  const filtered = rows.filter((row) => includesQuery(row, query, ['albion_name', 'discord_name'])
    && (!linkFilter || (linkFilter === 'linked' ? row.linked : !row.linked)));
  const positiveFirst = (a, b, direction) => {
    if (hasValue(a) !== hasValue(b)) return hasValue(a) ? -1 : 1;
    const difference = (Number(a[config.valueField] || 0) - Number(b[config.valueField] || 0)) * direction;
    return difference || Number(a[config.rankField] || Number.MAX_SAFE_INTEGER) - Number(b[config.rankField] || Number.MAX_SAFE_INTEGER)
      || collator.compare(a.albion_name || '', b.albion_name || '');
  };
  const sorted = sortRows(filtered, sort, {
    rank: (a, b) => Number(a[config.rankField] || Number.MAX_SAFE_INTEGER) - Number(b[config.rankField] || Number.MAX_SAFE_INTEGER)
      || collator.compare(a.albion_name || '', b.albion_name || ''),
    'value-desc': (a, b) => positiveFirst(a, b, -1),
    'value-asc': (a, b) => positiveFirst(a, b, 1),
    'name-asc': (a, b) => collator.compare(a.albion_name || '', b.albion_name || ''),
    'name-desc': (a, b) => collator.compare(b.albion_name || '', a.albion_name || ''),
    default: (a, b) => Number(a[config.rankField] || Number.MAX_SAFE_INTEGER) - Number(b[config.rankField] || Number.MAX_SAFE_INTEGER)
  });

  const imports = fameData?.imports || [];
  const latestImports = state.rankingCategory === 'overall'
    ? imports.map((item) => item.latest).filter(Boolean)
    : imports.filter((item) => item.category === state.rankingCategory).map((item) => item.latest).filter(Boolean);
  const latest = latestImports.sort((a, b) => dateValue(b.created_at) - dateValue(a.created_at))[0] || null;
  const classified = rows.filter(hasValue).length;
  const linked = rows.filter((row) => row.linked).length;
  document.querySelector('#fame-ranking-metrics').innerHTML = [
    metricCard('Jogadores no histórico', number.format(rows.length), 'Inclui ausentes preservados', '#5865f2'),
    metricCard('Classificados', number.format(classified), 'Jogadores com pontuação', '#23a55a'),
    metricCard('Vinculados', number.format(linked), `${number.format(Math.max(0, rows.length - linked))} aguardando Discord`, '#37c9ef'),
    metricCard('Última atualização', latest ? formatDate(latest.created_at) : '—', config.label, '#f0b232')
  ].join('');
  document.querySelector('#fame-ranking-title').textContent = config.title;
  document.querySelector('#fame-ranking-scope').textContent = config.label;
  document.querySelector('#fame-ranking-period').textContent = latest ? `All-time · ${formatDate(latest.created_at)}` : 'All-time · sem importação';
  setSummary('fame-ranking-summary', sorted.length, rows.length);

  const generalColumns = '<tr><th>Posição</th><th>Jogador</th><th>Vínculo</th><th class="number-cell">Índice geral</th><th class="number-cell">PvE</th><th class="number-cell">PvP</th><th class="number-cell">Coleta</th><th class="number-cell">Craft</th></tr>';
  const categoryColumns = `<tr><th>Posição</th><th>Jogador</th><th>Vínculo</th><th class="number-cell">Pontos ${escapeHtml(config.label)}</th><th class="number-cell">Índice geral</th></tr>`;
  document.querySelector('#fame-ranking-head').innerHTML = state.rankingCategory === 'overall' ? generalColumns : categoryColumns;
  document.querySelector('#fame-ranking-table').innerHTML = sorted.length ? sorted.map((row) => {
    const position = row[config.rankField] ? `#${number.format(row[config.rankField])}` : '—';
    const discordLabel = row.discord_name || (row.linked ? 'Discord vinculado' : 'Sem Discord');
    const player = `<td class="primary-cell">${escapeHtml(row.albion_name)}<span class="secondary-text">${escapeHtml(discordLabel)}</span></td>`;
    const link = `<td>${row.linked ? '<span class="badge member">Vinculado</span>' : '<span class="badge pending">Aguardando vínculo</span>'}</td>`;
    if (state.rankingCategory === 'overall') {
      return `<tr><td class="ranking-table-position">${position}</td>${player}${link}<td class="number-cell ranking-primary-value">${escapeHtml(fameValue(row, config))}</td><td class="number-cell">${Number(row.pve_fame || 0) > 0 ? escapeHtml(compact.format(row.pve_fame)) : '<span class="no-points">Sem pontos</span>'}</td><td class="number-cell">${Number(row.pvp_fame || 0) > 0 ? escapeHtml(compact.format(row.pvp_fame)) : '<span class="no-points">Sem pontos</span>'}</td><td class="number-cell">${Number(row.gathering_fame || 0) > 0 ? escapeHtml(compact.format(row.gathering_fame)) : '<span class="no-points">Sem pontos</span>'}</td><td class="number-cell">${Number(row.crafting_fame || 0) > 0 ? escapeHtml(compact.format(row.crafting_fame)) : '<span class="no-points">Sem pontos</span>'}</td></tr>`;
    }
    const overall = row.overall_score === null ? 'Sem pontos' : `${Number(row.overall_score).toFixed(1)} pts`;
    return `<tr><td class="ranking-table-position">${position}</td>${player}${link}<td class="number-cell ranking-primary-value">${escapeHtml(fameValue(row, config))}</td><td class="number-cell">${escapeHtml(overall)}</td></tr>`;
  }).join('') : emptyRow(state.rankingCategory === 'overall' ? 8 : 5, 'Nenhum jogador encontrado com estes filtros.');
}

function resetFamePreview() {
  state.famePreview = null;
  state.famePreviewSort = 'delta-desc';
  document.querySelector('#fame-preview-empty').hidden = false;
  document.querySelector('#fame-preview-content').hidden = true;
  document.querySelector('#fame-preview-status').textContent = 'Aguardando tabela';
  document.querySelector('#fame-confirm-reductions').checked = false;
}

function renderFameImportStatus(fameData) {
  const imports = fameData?.imports || [];
  for (const button of document.querySelectorAll('.fame-category')) {
    const item = imports.find((entry) => entry.category === button.dataset.category);
    const small = button.querySelector('small');
    small.textContent = item?.latest
      ? `${formatDate(item.latest.created_at)} · ${number.format(item.latest.rows_count)} jogadores`
      : 'Sem importação';
  }
}

function renderFamePreview(preview) {
  state.famePreview = preview;
  document.querySelector('#fame-preview-empty').hidden = true;
  document.querySelector('#fame-preview-content').hidden = false;
  document.querySelector('#fame-preview-status').textContent = preview.errors.length
    ? `${preview.errors.length} erro${preview.errors.length === 1 ? '' : 's'}`
    : 'Pronta para confirmar';
  const summary = preview.summary;
  document.querySelector('#fame-preview-metrics').innerHTML = [
    metricCard('Encontrados', number.format(summary.players), `${number.format(summary.withPoints)} com pontuação`, '#5865f2'),
    metricCard('Vinculados', number.format(summary.linked), 'Contas Discord reconhecidas', '#23a55a'),
    metricCard('Aguardam vínculo', number.format(summary.unmatched), 'Visíveis somente para a staff', '#37c9ef'),
    metricCard('Reduções', number.format(summary.reductions), 'Exigem confirmação especial', '#f0b232')
  ].join('');
  document.querySelector('#fame-reduction-warning').hidden = summary.reductions === 0;
  document.querySelector('#fame-preview-summary').textContent = `${summary.missing} ausentes preservados · ${summary.zero} sem pontos · ${summary.errors} erros`;
  document.querySelector('#fame-preview-errors').textContent = preview.errors.length
    ? preview.errors.slice(0, 3).map((error) => `Linha ${error.line}: ${error.message}`).join(' · ')
    : '';
  document.querySelector('#fame-confirm').disabled = preview.errors.length > 0;
  const deltaDescending = state.famePreviewSort !== 'delta-asc';
  const deltaHeader = document.querySelector('#fame-delta-header');
  const deltaSort = document.querySelector('#fame-delta-sort');
  deltaHeader.setAttribute('aria-sort', deltaDescending ? 'descending' : 'ascending');
  deltaSort.innerHTML = `Alteração <span aria-hidden="true">${deltaDescending ? '↓' : '↑'}</span>`;
  deltaSort.title = deltaDescending
    ? 'Ordenado do maior para o menor. Clique para inverter.'
    : 'Ordenado do menor para o maior. Clique para inverter.';
  const sortedRows = [...preview.rows].sort((left, right) => {
    const difference = deltaDescending
      ? Number(right.delta || 0) - Number(left.delta || 0)
      : Number(left.delta || 0) - Number(right.delta || 0);
    return difference || collator.compare(left.albionName || '', right.albionName || '');
  });
  document.querySelector('#fame-preview-table').innerHTML = sortedRows.length
    ? sortedRows.map((row) => {
      const deltaClass = row.delta < 0 ? 'negative-value' : 'positive-value';
      return `<tr><td class="primary-cell">${escapeHtml(row.albionName)}${row.guildRole ? `<span class="secondary-text">${escapeHtml(row.guildRole)}</span>` : ''}</td><td>${row.discordId ? '<span class="badge member">Vinculado</span>' : '<span class="badge pending">Sem Discord</span>'}</td><td class="number-cell">${escapeHtml(compact.format(row.previousAmount))}</td><td class="number-cell">${escapeHtml(compact.format(row.amount))}</td><td class="number-cell ${deltaClass}">${row.delta >= 0 ? '+' : ''}${escapeHtml(compact.format(row.delta))}</td></tr>`;
    }).join('')
    : emptyRow(5, 'Nenhum jogador válido encontrado.');
}

const operationalLabels = { food: 'alimento', guild_history: 'histórico da guilda', bank: 'banco da guilda' };
const historyLabels = { role_assigned: 'Cargo atribuído', role_removed: 'Cargo removido', accepted: 'Entrada aceita', invited: 'Convite', left: 'Saiu', kicked: 'Expulso', other: 'Outra ação' };

function resetOperationalPreview() {
  state.operationalPreview = null;
  document.querySelector('#albion-data-preview-empty').hidden = false;
  document.querySelector('#albion-data-preview-content').hidden = true;
  document.querySelector('#albion-data-preview-status').textContent = 'Aguardando tabela';
}

function renderOperationalPreview(preview) {
  state.operationalPreview = preview;
  const summary = preview.summary;
  document.querySelector('#albion-data-preview-empty').hidden = true;
  document.querySelector('#albion-data-preview-content').hidden = false;
  document.querySelector('#albion-data-preview-status').textContent = preview.previousImport
    ? 'Arquivo já importado' : preview.errors.length ? `${preview.errors.length} erro(s)` : 'Pronta para confirmar';
  const metrics = preview.kind === 'food'
    ? [metricCard('Jogadores', number.format(summary.rows), `${number.format(summary.linked)} vinculados`), metricCard('Contribuíram', number.format(summary.contributors), 'Com valor acima de zero'), metricCard('Total', compact.format(summary.totalAmount), 'Alimento acumulado')]
    : preview.kind === 'guild_history'
      ? [metricCard('Registros', number.format(summary.rows), `${number.format(summary.newRows)} novos`), metricCard('Repetidos', number.format(summary.duplicates), 'Serão ignorados'), metricCard('Alvos ausentes', number.format(summary.missingTargets), 'Limitação do arquivo exportado')]
      : [metricCard('Registros', number.format(summary.rows), `${number.format(summary.newRows)} novos`), metricCard('Depósitos', compact.format(summary.deposits), 'Entrada de prata'), metricCard('Saldo líquido', compact.format(summary.netChange), 'No período importado')];
  document.querySelector('#albion-data-preview-metrics').innerHTML = metrics.join('');
  document.querySelector('#albion-data-preview-summary').textContent = preview.previousImport
    ? `Este arquivo já foi salvo em ${formatDate(preview.previousImport.created_at)}.`
    : `${number.format(summary.errors)} erro(s) encontrado(s).`;
  document.querySelector('#albion-data-preview-errors').textContent = preview.errors.slice(0, 3).map((error) => `Linha ${error.line}: ${error.message}`).join(' · ');
  document.querySelector('#albion-data-confirm').disabled = Boolean(preview.previousImport || preview.errors.length);
  if (preview.kind === 'food') {
    document.querySelector('#albion-data-preview-head').innerHTML = '<tr><th>Jogador</th><th class="number-cell">Anterior</th><th class="number-cell">Novo</th><th class="number-cell">Alteração</th></tr>';
    document.querySelector('#albion-data-preview-table').innerHTML = preview.rows.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.albionName)}</td><td class="number-cell">${compact.format(row.previousAmount)}</td><td class="number-cell">${compact.format(row.amount)}</td><td class="number-cell ${row.delta < 0 ? 'negative-value' : 'positive-value'}">${row.delta >= 0 ? '+' : ''}${compact.format(row.delta)}</td></tr>`).join('') || emptyRow(4);
  } else if (preview.kind === 'guild_history') {
    document.querySelector('#albion-data-preview-head').innerHTML = '<tr><th>Data</th><th>Responsável</th><th>Ação</th><th>Alvo</th></tr>';
    document.querySelector('#albion-data-preview-table').innerHTML = preview.rows.map((row) => `<tr><td>${formatGameDate(row.eventAt)}</td><td>${escapeHtml(row.actorName)}</td><td>${escapeHtml(historyLabels[row.actionType] || row.actionType)}</td><td>${escapeHtml(row.targetName || 'Não disponível')}</td></tr>`).join('') || emptyRow(4);
  } else {
    document.querySelector('#albion-data-preview-head').innerHTML = '<tr><th>Data</th><th>Jogador</th><th>Motivo</th><th class="number-cell">Valor</th></tr>';
    document.querySelector('#albion-data-preview-table').innerHTML = preview.rows.map((row) => `<tr><td>${formatGameDate(row.eventAt)}</td><td>${escapeHtml(row.playerName)}</td><td>${escapeHtml(row.reason)}</td><td class="number-cell ${row.amount < 0 ? 'negative-value' : 'positive-value'}">${row.amount > 0 ? '+' : ''}${compact.format(row.amount)}</td></tr>`).join('') || emptyRow(4);
  }
}

function renderOperationalData(data) {
  const operational = data || { imports: [], food: {}, history: {}, bank: {} };
  for (const button of document.querySelectorAll('[data-operational-kind]')) {
    const latest = operational.imports?.find((item) => item.kind === button.dataset.operationalKind)?.latest;
    button.querySelector('small').textContent = latest ? `${formatDate(latest.created_at)} · ${number.format(latest.inserted_count)} salvos` : button.dataset.operationalKind === 'food' ? 'Contribuição para construção' : button.dataset.operationalKind === 'bank' ? 'Depósitos e retiradas' : 'Cargos, entradas e saídas';
  }
  const food = operational.food || {};
  document.querySelector('#albion-food-metrics').innerHTML = [metricCard('Total', compact.format(food.total), 'Alimento registrado'), metricCard('Colaboradores', number.format(food.contributors || 0), 'Com contribuição'), metricCard('Última captura', food.latest ? formatDate(food.latest.created_at) : '—', food.latest?.source_name || 'Sem importação')].join('');
  document.querySelector('#albion-food-table').innerHTML = food.rows?.length ? food.rows.map((row, index) => `<tr><td>#${index + 1}</td><td class="primary-cell">${escapeHtml(row.albion_name)}</td><td>${escapeHtml(row.guild_role || '—')}</td><td class="number-cell">${compact.format(row.amount)}</td><td class="number-cell ${row.delta < 0 ? 'negative-value' : 'positive-value'}">${row.delta >= 0 ? '+' : ''}${compact.format(row.delta)}</td></tr>`).join('') : emptyRow(5, 'Nenhuma contribuição importada.');
  const history = operational.history || {};
  document.querySelector('#albion-history-metrics').innerHTML = [metricCard('Ações', number.format(history.total || 0), 'Histórico preservado'), metricCard('Entradas', number.format((history.counts?.accepted || 0) + (history.counts?.invited || 0)), 'Aceites e convites'), metricCard('Saídas', number.format((history.counts?.left || 0) + (history.counts?.kicked || 0)), 'Saídas e expulsões')].join('');
  document.querySelector('#albion-history-table').innerHTML = history.rows?.length ? history.rows.map((row) => `<tr><td>${formatGameDate(row.event_at)}</td><td>${escapeHtml(row.actor_name)}</td><td>${escapeHtml(historyLabels[row.action_type] || row.action_type)}</td><td>${escapeHtml(row.target_name || 'Não disponível')}</td></tr>`).join('') : emptyRow(4, 'Nenhuma ação importada.');
  const bank = operational.bank || {};
  document.querySelector('#albion-bank-metrics').innerHTML = [metricCard('Depósitos', compact.format(bank.deposits), 'Entradas'), metricCard('Retiradas', compact.format(Math.abs(bank.withdrawals || 0)), 'Saídas de membros'), metricCard('Saldo líquido', compact.format(bank.netChange), `${number.format(bank.total || 0)} movimentações`)].join('');
  document.querySelector('#albion-bank-table').innerHTML = bank.rows?.length ? bank.rows.map((row) => `<tr><td>${formatGameDate(row.event_at)}</td><td>${escapeHtml(row.player_name)}</td><td>${escapeHtml(row.reason)}</td><td class="number-cell ${row.amount < 0 ? 'negative-value' : 'positive-value'}">${row.amount > 0 ? '+' : ''}${compact.format(row.amount)}</td></tr>`).join('') : emptyRow(4, 'Nenhuma movimentação importada.');
}

function renderAudit(rows) {
  const query = controlValue('audit-search');
  const filtered = rows.filter((row) => includesQuery(row, query, ['type', 'actor_id', 'target_id', 'reason']));
  const sorted = sortRows(filtered, controlValue('audit-sort', 'date-desc'), {
    'date-desc': (a, b) => dateValue(b.created_at) - dateValue(a.created_at),
    'date-asc': (a, b) => dateValue(a.created_at) - dateValue(b.created_at),
    'type-asc': (a, b) => collator.compare(a.type || '', b.type || ''),
    'type-desc': (a, b) => collator.compare(b.type || '', a.type || ''),
    default: (a, b) => dateValue(b.created_at) - dateValue(a.created_at)
  });
  setSummary('audit-summary', sorted.length, rows.length);
  document.querySelector('#audit-table').innerHTML = sorted.length ? sorted.map((row) => `<tr><td class="primary-cell">${escapeHtml(row.type)}</td><td>${escapeHtml(row.actor_id || 'Sistema')}</td><td>${escapeHtml(row.target_id || '—')}</td><td>${escapeHtml(row.reason || '—')}</td><td>${formatDate(row.created_at)}</td></tr>`).join('') : emptyRow(5);
}

function render(data) {
  renderMemberRosterCurrent(data.memberRoster || null);
  renderRegistrations(data.registrations || [], data.operations?.registrationsPending || 0, data.memberRoster || null);
  if (state.permissions.full) {
    renderOverview(data);
    renderMembers(data.members);
    renderEvents(data.events);
    renderOperations(data.operations);
    renderFinance(data.finance, data.overview.totalMemberBalance);
    renderRankings(data.rankings);
    renderFameImportStatus(data.rankings.fame);
    renderOperationalData(data.albionOperational);
    renderAudit(data.audit);
  }
  document.querySelector('#freshness').textContent = data.freshness ? `Dados até ${formatDate(data.freshness)}` : `Atualizado ${formatDate(data.generatedAt)}`;
}

async function fetchJson(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (response.status === 401) {
    window.location.assign('/?login=required');
    throw new Error('Sessão encerrada.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os dados.');
  return data;
}

async function postForm(path, values) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...values, csrf: state.csrf || '' })
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) window.location.assign('/?login=required');
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a ação.');
  return data;
}

function showToast(message) {
  const toast = document.querySelector('#error-toast');
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 6000);
}

function setupEventManagementUI() {
  const view = document.querySelector('#view-events');
  if (!view || document.querySelector('#staff-event-form')) return;
  const heading = view.querySelector('.view-heading');
  const description = heading?.querySelector('p');
  if (description) description.textContent = 'Crie, publique e acompanhe eventos sincronizados com o Discord.';
  heading.insertAdjacentHTML('beforebegin', eventManagementMarkup());
  document.body.insertAdjacentHTML('beforeend', finishEventDialogMarkup());
  view.querySelector('thead tr').innerHTML = '<th>Evento</th><th>Público e local</th><th>Status</th><th>Participação</th><th>Horário</th><th>Ações</th>';
  document.querySelector('#staff-event-form').addEventListener('submit', submitStaffEventForm);
  document.querySelector('#staff-event-reset').addEventListener('click', resetStaffEventForm);
  document.querySelector('#events-table').addEventListener('click', handleStaffEventAction);
  document.querySelector('#finish-event-form').addEventListener('submit', submitFinishEventForm);
  document.querySelectorAll('[data-close-event-dialog]').forEach((button) => button.addEventListener('click', () => document.querySelector('#finish-event-dialog').close()));
}

function showEventFeedback(message, error = false) {
  const feedback = document.querySelector('#staff-event-feedback');
  feedback.textContent = message;
  feedback.classList.toggle('error', error);
  feedback.hidden = false;
}

function resetStaffEventForm() {
  const form = document.querySelector('#staff-event-form');
  form.reset();
  form.elements.eventId.value = '';
  form.elements.contentType.value = '';
  form.elements.tankSlots.value = '1';
  form.elements.healerSlots.value = '1';
  form.elements.supportSlots.value = '1';
  form.elements.dpsSlots.value = '17';
  state.editingEventId = null;
  document.querySelector('#staff-event-form-title').textContent = 'Criar novo evento';
  document.querySelector('#staff-event-submit').textContent = 'Criar e publicar';
  document.querySelector('#staff-event-reset').hidden = true;
}

function editStaffEvent(eventId) {
  const row = state.data?.events.find((event) => Number(event.id) === Number(eventId));
  if (!row) return showEventFeedback('Evento não encontrado.', true);
  const form = document.querySelector('#staff-event-form');
  form.elements.eventId.value = row.id;
  form.elements.contentType.value = row.content_type === 'other' ? '' : row.content_type;
  form.elements.title.value = row.title || '';
  form.elements.description.value = row.description || '';
  form.elements.location.value = row.location || '';
  form.elements.scheduledTime.value = row.scheduled_time || '';
  form.elements.audience.value = row.audience || 'public';
  form.elements.tankSlots.value = row.tank_slots || 0;
  form.elements.healerSlots.value = row.healer_slots || 0;
  form.elements.supportSlots.value = row.support_slots || 0;
  form.elements.dpsSlots.value = row.dps_slots || 0;
  state.editingEventId = row.id;
  document.querySelector('#staff-event-form-title').textContent = `Editar ${row.event_code}`;
  document.querySelector('#staff-event-submit').textContent = 'Salvar e atualizar Discord';
  document.querySelector('#staff-event-reset').hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function submitStaffEventForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.querySelector('#staff-event-submit');
  button.disabled = true;
  try {
    const response = await postForm('/api/staff/events', {
      ...formValues(form),
      action: state.editingEventId ? 'edit' : 'create'
    });
    state.data = response.dashboard;
    render(state.data);
    showEventFeedback(response.result.message);
    resetStaffEventForm();
  } catch (error) {
    showEventFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function handleStaffEventAction(event) {
  const button = event.target.closest('.staff-event-action');
  if (!button) return;
  const eventId = button.dataset.eventId;
  const action = button.dataset.action;
  const row = state.data?.events.find((item) => Number(item.id) === Number(eventId));
  if (action === 'edit') return editStaffEvent(eventId);
  if (action === 'finish') {
    const dialog = document.querySelector('#finish-event-dialog');
    document.querySelector('#finish-event-form').elements.eventId.value = eventId;
    return dialog.showModal();
  }
  const questions = {
    start: `Iniciar ${row?.event_code || 'este evento'} e criar a sala de voz?`,
    cancel: `Cancelar ${row?.event_code || 'este evento'}? Esta ação encerra a publicação no Discord.`,
    submit_review: `Enviar ${row?.event_code || 'este evento'} para aprovação financeira? A revisão será fechada para edição.`,
    return_review: `Devolver ${row?.event_code || 'este evento'} para revisão? Nenhum saldo será alterado.`,
    approve_payment: `Aprovar o pagamento de ${row?.event_code || 'este evento'}? Os saldos ou as escolhas da campanha serão processados agora.`
  };
  const question = questions[action] || `Confirmar ação em ${row?.event_code || 'este evento'}?`;
  if (!window.confirm(question)) return;
  button.disabled = true;
  try {
    const response = await postForm('/api/staff/events', { action, eventId });
    state.data = response.dashboard;
    render(state.data);
    showEventFeedback(response.result.message);
  } catch (error) {
    showEventFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function submitFinishEventForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const response = await postForm('/api/staff/events', { ...formValues(form), action: 'finish' });
    state.data = response.dashboard;
    render(state.data);
    showEventFeedback(response.result.message);
    document.querySelector('#finish-event-dialog').close();
    form.reset();
  } catch (error) {
    showEventFeedback(error.message, true);
  } finally {
    submit.disabled = false;
  }
}

function showRegistrationFeedback(message, error = false) {
  const feedback = document.querySelector('#registration-feedback');
  feedback.textContent = message;
  feedback.classList.toggle('error', error);
  feedback.hidden = false;
}

function openRegistrationDialog(discordId) {
  const row = state.data?.registrations?.find((item) => String(item.discord_id) === String(discordId));
  if (!row) return showRegistrationFeedback('Cadastro não encontrado.', true);
  const dialog = document.querySelector('#registration-dialog');
  const form = document.querySelector('#registration-form');
  form.reset();
  form.elements.discordId.value = row.discord_id;
  form.elements.albionName.value = row.requested_albion_name || row.albion_name || '';
  document.querySelector('#registration-dialog-title').textContent = `Validar ${row.discord_display_name || row.discord_name || row.discord_id}`;
  document.querySelector('#registration-preview').hidden = true;
  document.querySelector('#registration-preview').innerHTML = '';
  document.querySelector('#registration-dialog-submit').textContent = 'Consultar Albion';
  state.registrationPreview = null;
  dialog.showModal();
}

function renderRegistrationPreview(preview) {
  const target = document.querySelector('#registration-preview');
  target.hidden = false;
  target.innerHTML = `<span class="badge ${preview.linkRequired ? 'link_review' : 'member'}">${preview.linkRequired ? 'Análise de vínculo' : 'Na guilda NoTag'}</span><dl><div><dt>Personagem</dt><dd>${escapeHtml(preview.albionName)}</dd></div><div><dt>Guilda</dt><dd>${escapeHtml(preview.guildName)}</dd></div><div><dt>Discord</dt><dd>${escapeHtml(preview.displayName)}</dd></div>${preview.owner ? `<div><dt>Perfil atual</dt><dd>${escapeHtml(preview.owner.albionName || preview.owner.discordName || preview.owner.discordId)} · ${escapeHtml(preview.owner.discordId)}</dd></div>` : ''}</dl><p>${preview.linkRequired ? 'Ao confirmar, esta conta Discord será vinculada ao perfil existente, preservando saldo e histórico.' : 'Ao confirmar, o cargo Membro e o apelido serão atualizados.'}</p>`;
  document.querySelector('#registration-dialog-submit').textContent = preview.linkRequired ? 'Autorizar vínculo e aprovar' : 'Aprovar como Membro';
}

async function submitRegistrationForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = document.querySelector('#registration-dialog-submit');
  submit.disabled = true;
  try {
    const values = formValues(form);
    if (!state.registrationPreview) {
      const response = await postForm('/api/staff/registrations', { ...values, action: 'preview' });
      state.registrationPreview = response.result.preview;
      form.elements.albionName.value = response.result.preview.albionName;
      renderRegistrationPreview(response.result.preview);
    } else {
      const response = await postForm('/api/staff/registrations', {
        action: 'confirm',
        discordId: state.registrationPreview.discordId,
        albionName: state.registrationPreview.albionName
      });
      state.data = response.dashboard;
      render(state.data);
      showRegistrationFeedback(response.result.message);
      document.querySelector('#registration-dialog').close();
      state.registrationPreview = null;
    }
  } catch (error) {
    const target = document.querySelector('#registration-preview');
    target.hidden = false;
    target.innerHTML = `<div class="registration-error">${escapeHtml(error.message)}</div>`;
    state.registrationPreview = null;
    submit.textContent = 'Consultar novamente';
  } finally {
    submit.disabled = false;
  }
}

async function handleRegistrationAction(event) {
  const button = event.target.closest('.registration-action');
  if (!button) return;
  const action = button.dataset.action;
  const discordId = button.dataset.discordId;
  if (action === 'analyze') return openRegistrationDialog(discordId);
  let reason = '';
  if (action === 'reject') {
    const answer = window.prompt('Motivo da devolução (opcional):', '');
    if (answer === null) return;
    reason = answer;
  } else if (action === 'remind' && !window.confirm('Reenviar por DM as instruções de cadastro?')) {
    return;
  }
  button.disabled = true;
  try {
    const response = await postForm('/api/staff/registrations', { action, discordId, reason });
    state.data = response.dashboard;
    render(state.data);
    showRegistrationFeedback(response.result.message);
  } catch (error) {
    showRegistrationFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function setupRegistrationUI() {
  document.querySelector('#registrations-table').addEventListener('click', handleRegistrationAction);
  document.querySelector('#registration-form').addEventListener('submit', submitRegistrationForm);
  document.querySelector('#registration-dialog-close').addEventListener('click', () => document.querySelector('#registration-dialog').close());
  document.querySelector('#registration-dialog-x').addEventListener('click', () => document.querySelector('#registration-dialog').close());
  document.querySelector('#registration-form').elements.albionName.addEventListener('input', () => {
    state.registrationPreview = null;
    document.querySelector('#registration-preview').hidden = true;
    document.querySelector('#registration-dialog-submit').textContent = 'Consultar Albion';
  });
  document.querySelector('#member-roster-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      event.target.value = '';
      return showRegistrationFeedback('O arquivo deve ter no máximo 512 KB.', true);
    }
    state.memberRosterSourceName = file.name;
    document.querySelector('#member-roster-source').textContent = file.name;
    document.querySelector('#member-roster-text').value = await file.text();
    resetMemberRosterPreview();
  });
  document.querySelector('#member-roster-text').addEventListener('input', resetMemberRosterPreview);
  document.querySelector('#member-roster-analyze').addEventListener('click', analyzeMemberRoster);
  document.querySelector('#member-roster-confirm').addEventListener('click', confirmMemberRoster);
}

async function loadDashboard({ manual = false } = {}) {
  const button = document.querySelector('#refresh-button');
  if (manual) button.classList.add('spinning');
  try {
    const data = await fetchJson('/api/dashboard');
    state.data = data;
    state.lastLoadedAt = Date.now();
    render(data);
    document.querySelector('#loading-panel').hidden = true;
    switchView(state.currentView, { scroll: false });
  } catch (error) {
    const toast = document.querySelector('#error-toast');
    toast.textContent = error.message;
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 6000);
  } finally {
    button.classList.remove('spinning');
  }
}

async function loadSession() {
  const { user, csrf, permissions } = await fetchJson('/api/session');
  state.csrf = csrf;
  state.userId = user.id;
  state.permissions = permissions || { full: true, registrations: true };
  document.querySelector('#intelligence-link').hidden = !state.permissions.intelligence;
  if (!state.permissions.full) {
    state.currentView = 'registrations';
    document.querySelectorAll('.nav-item').forEach((item) => { item.hidden = item.dataset.view !== 'registrations'; });
    document.querySelectorAll('.nav-group').forEach((group) => { group.hidden = !group.querySelector('.nav-item:not([hidden])'); });
    document.querySelector('#sidebar .app-brand small').textContent = 'Cadastros da comunidade';
    switchView('registrations');
  } else {
    setupEventManagementUI();
  }
  document.querySelector('#user-name').textContent = user.name;
  if (user.avatarUrl) {
    const avatar = document.querySelector('#user-avatar');
    avatar.src = user.avatarUrl;
    avatar.alt = `Avatar de ${user.name}`;
    avatar.hidden = false;
  }
}

async function analyzeFameTable() {
  const text = document.querySelector('#fame-text').value.trim();
  if (!text) return showToast('Cole a tabela ou selecione um arquivo primeiro.');
  const button = document.querySelector('#fame-analyze');
  button.disabled = true;
  button.textContent = 'Analisando…';
  try {
    const preview = await postForm('/api/fame/import/preview', {
      category: state.fameCategory,
      sourceName: state.fameSourceName || 'texto-colado',
      text
    });
    renderFamePreview(preview);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Analisar tabela';
  }
}

async function confirmFameImport() {
  if (!state.famePreview) return;
  const reductions = Number(state.famePreview.summary.reductions || 0);
  const confirmed = document.querySelector('#fame-confirm-reductions').checked;
  if (reductions > 0 && !confirmed) return showToast('Revise e confirme os valores All-time menores.');
  const button = document.querySelector('#fame-confirm');
  button.disabled = true;
  button.textContent = 'Salvando…';
  try {
    const result = await postForm('/api/fame/import/confirm', {
      previewId: state.famePreview.previewId,
      confirmReductions: String(confirmed)
    });
    showToast(`${result.categoryLabel} atualizado com ${result.summary.players} jogadores.`);
    document.querySelector('#fame-text').value = '';
    state.fameSourceName = null;
    document.querySelector('#fame-source-name').textContent = 'Nenhum arquivo selecionado';
    resetFamePreview();
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Confirmar importação';
  }
}

async function undoFameImport() {
  const label = fameCategoryLabels[state.fameCategory];
  if (!window.confirm(`Desfazer a importação mais recente de ${label}?`)) return;
  try {
    const result = await postForm('/api/fame/import/undo', { category: state.fameCategory });
    showToast(`Importação de ${result.categoryLabel} desfeita. ${result.restoredRows} jogadores restaurados.`);
    resetFamePreview();
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
  }
}

async function analyzeOperationalData() {
  const text = document.querySelector('#albion-data-text').value.trim();
  if (!text) return showToast('Cole a tabela ou selecione um arquivo primeiro.');
  const button = document.querySelector('#albion-data-analyze');
  button.disabled = true;
  button.textContent = 'Analisando…';
  try {
    const preview = await postForm('/api/staff/albion-data', { action: 'preview', kind: state.operationalKind, sourceName: state.operationalSourceName || 'texto-colado', text });
    renderOperationalPreview(preview);
  } catch (error) { showToast(error.message); } finally {
    button.disabled = false;
    button.textContent = 'Analisar tabela';
  }
}

async function confirmOperationalData() {
  if (!state.operationalPreview) return;
  const button = document.querySelector('#albion-data-confirm');
  button.disabled = true;
  button.textContent = 'Salvando…';
  try {
    const response = await postForm('/api/staff/albion-data', { action: 'confirm', previewId: state.operationalPreview.previewId });
    state.data = response.dashboard;
    render(state.data);
    showToast(`${response.result.kindLabel}: ${number.format(response.result.insertedRows)} registros salvos.`);
    document.querySelector('#albion-data-text').value = '';
    document.querySelector('#albion-data-source').textContent = 'Nenhum arquivo selecionado';
    state.operationalSourceName = null;
    resetOperationalPreview();
  } catch (error) { showToast(error.message); } finally {
    button.disabled = false;
    button.textContent = 'Confirmar importação';
  }
}

function switchView(view, { scroll = true } = {}) {
  const next = document.querySelector(`#view-${view}`);
  if (!next) return;
  state.currentView = view;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${view}`);
  document.querySelectorAll('.view').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  next.classList.add('active');
  document.querySelector('#page-title').textContent = next.dataset.title;
  document.querySelector('#page-kicker').textContent = next.dataset.kicker;
  closeSidebar();
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openSidebar() {
  document.querySelector('#sidebar').classList.add('open');
  document.querySelector('#mobile-scrim').classList.add('open');
}

function closeSidebar() {
  document.querySelector('#sidebar').classList.remove('open');
  document.querySelector('#mobile-scrim').classList.remove('open');
}

setupRegistrationUI();
document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.go)));
document.querySelector('#menu-toggle').addEventListener('click', openSidebar);
document.querySelector('#sidebar-close').addEventListener('click', closeSidebar);
document.querySelector('#mobile-scrim').addEventListener('click', closeSidebar);
document.querySelector('#refresh-button').addEventListener('click', () => loadDashboard({ manual: true }));
document.querySelectorAll('.fame-category').forEach((button) => button.addEventListener('click', () => {
  state.fameCategory = button.dataset.category;
  document.querySelectorAll('.fame-category').forEach((item) => item.classList.toggle('active', item === button));
  document.querySelector('#fame-import-title').textContent = `Importar ${fameCategoryLabels[state.fameCategory]}`;
  resetFamePreview();
}));
document.querySelector('#fame-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 512 * 1024) return showToast('O arquivo deve ter no máximo 512 KB.');
  state.fameSourceName = file.name;
  document.querySelector('#fame-source-name').textContent = file.name;
  document.querySelector('#fame-text').value = await file.text();
  resetFamePreview();
});
document.querySelector('#fame-analyze').addEventListener('click', analyzeFameTable);
document.querySelector('#fame-confirm').addEventListener('click', confirmFameImport);
document.querySelector('#fame-undo').addEventListener('click', undoFameImport);
document.querySelector('#fame-delta-sort').addEventListener('click', () => {
  if (!state.famePreview) return;
  state.famePreviewSort = state.famePreviewSort === 'delta-desc' ? 'delta-asc' : 'delta-desc';
  renderFamePreview(state.famePreview);
});
document.querySelectorAll('[data-operational-kind]').forEach((button) => button.addEventListener('click', () => {
  state.operationalKind = button.dataset.operationalKind;
  document.querySelectorAll('[data-operational-kind]').forEach((item) => item.classList.toggle('active', item === button));
  document.querySelector('#albion-data-import-title').textContent = `Importar ${operationalLabels[state.operationalKind]}`;
  resetOperationalPreview();
}));
document.querySelector('#albion-data-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 640 * 1024) return showToast('O arquivo deve ter no máximo 640 KB.');
  state.operationalSourceName = file.name;
  document.querySelector('#albion-data-source').textContent = file.name;
  document.querySelector('#albion-data-text').value = await file.text();
  resetOperationalPreview();
});
document.querySelector('#albion-data-text').addEventListener('input', resetOperationalPreview);
document.querySelector('#albion-data-analyze').addEventListener('click', analyzeOperationalData);
document.querySelector('#albion-data-confirm').addEventListener('click', confirmOperationalData);
document.querySelector('#staff-withdraw-list').addEventListener('click', (event) => {
  const button = event.target.closest('.staff-withdraw-action');
  if (button) manageStaffWithdrawal(button);
});
document.querySelector('#finance-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-finance-tab]');
  if (button) setFinanceTab(button.dataset.financeTab);
});
document.querySelector('#finance-metrics').addEventListener('click', (event) => {
  const card = event.target.closest('[data-finance-target]');
  if (card) setFinanceTab(card.dataset.financeTarget);
});
document.querySelector('#finance-metrics').addEventListener('keydown', (event) => {
  const card = event.target.closest('[data-finance-target]');
  if (card && ['Enter', ' '].includes(event.key)) {
    event.preventDefault();
    setFinanceTab(card.dataset.financeTarget);
  }
});
document.querySelectorAll('.ranking-tab').forEach((button) => button.addEventListener('click', () => {
  state.rankingCategory = button.dataset.rankingCategory;
  document.querySelectorAll('.ranking-tab').forEach((item) => {
    const selected = item === button;
    item.classList.toggle('active', selected);
    item.setAttribute('aria-selected', String(selected));
  });
  if (state.data) renderFameRankings(state.data.rankings.fame);
}));
document.querySelectorAll('.table-controls input, .table-controls select').forEach((control) => {
  control.addEventListener(control.matches('input') ? 'input' : 'change', () => {
    if (!state.data) return;
    if (state.permissions.full) {
      renderMembers(state.data.members);
      renderEvents(state.data.events);
      renderFinance(state.data.finance, state.data.overview.totalMemberBalance);
      renderRankings(state.data.rankings);
      renderAudit(state.data.audit);
    }
    renderRegistrations(state.data.registrations || [], state.data.operations?.registrationsPending || 0, state.data.memberRoster || null);
  });
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - state.lastLoadedAt >= 30000) loadDashboard();
});

loadSession().then(() => loadDashboard()).catch(() => {});
window.setInterval(() => { if (!document.hidden) loadDashboard(); }, 30000);
