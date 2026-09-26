const integer = new Intl.NumberFormat('pt-BR');
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const hours = (seconds) => `${integer.format(Math.round(Number(seconds || 0) / 3600))}h`;
const days = (value) => value == null ? '—' : `${integer.format(value)} dias`;
const silver = (value) => compact.format(Number(value || 0)).toLowerCase();

function contributionScore(member) {
  return Math.round(Math.min(100,
    member.events.total * 3 + member.events.created * 5 + member.events.transport * 2
    + member.events.worldBoss * 2 + Object.values(member.roles).filter(Boolean).length * 2
    + Math.min(20, member.weekly.voiceSeconds / 3600) + (member.weekly.active ? 10 : 0)
  ));
}

function metric(label, value, note) {
  return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;
}

function detail(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function render(data, session) {
  const member = data.member;
  const score = contributionScore(member);
  document.querySelector('#member-name').textContent = member.albionName || member.discordName || 'Seu desempenho na NOTAG';
  document.querySelector('#freshness').textContent = `Atualizado ${dateTime.format(new Date(data.generatedAt))}`;
  document.querySelector('#definitions').textContent = `${data.definitions.weeklyActivity} ${data.definitions.eventCategories}`;
  document.querySelector('#staff-intelligence').hidden = !session?.user?.canAccessIntelligence;

  document.querySelector('#metrics').innerHTML = [
    metric('Eventos', integer.format(member.events.total), `${hours(member.events.totalSeconds)} registrados`),
    metric('Fama total', compact.format(member.fame.total), `PvE ${compact.format(member.fame.pve)}`),
    metric('Voz na semana', hours(member.weekly.voiceSeconds), member.weekly.active ? 'Atividade registrada' : 'Sem registro recente'),
    metric('Saldo', silver(member.finance.balance), 'Disponível no portal')
  ].join('');

  document.querySelector('#score').textContent = score;
  document.querySelector('#score-bar').style.width = `${score}%`;
  document.querySelector('#score-copy').textContent = score >= 75
    ? 'Participação muito consistente nos registros da guilda.'
    : score >= 40 ? 'Boa base de participação; frequência e variedade elevam este índice.'
      : 'Seu índice cresce com eventos, tempo em voz, criação de conteúdo e variedade de funções.';

  const activities = [
    ['Transporte', member.events.transport], ['Raid', member.events.raid],
    ['World boss', member.events.worldBoss], ['Roaming', member.events.roaming], ['Farm', member.events.farm]
  ];
  const activityMax = Math.max(1, ...activities.map(([, value]) => value));
  document.querySelector('#activity-bars').innerHTML = activities.map(([label, value]) => `
    <div><span>${escapeHtml(label)}</span><div><i style="width:${Math.round(value / activityMax * 100)}%"></i></div><strong>${integer.format(value)}</strong></div>
  `).join('');

  const positionLabels = { contribution: 'Contribuição', events: 'Eventos', eventHours: 'Tempo em evento', fame: 'Fama total' };
  document.querySelector('#positions').innerHTML = Object.entries(data.positions).map(([key, ranking]) => `
    <div><span>${escapeHtml(positionLabels[key])}</span><strong>${ranking.position ? `#${ranking.position}` : '—'}</strong><small>${ranking.total ? `entre ${integer.format(ranking.total)}` : 'sem classificação'}</small></div>
  `).join('');

  const roleLabels = { tank: 'Tank', healer: 'Healer', support: 'Suporte', dps: 'DPS', scout: 'Scout' };
  document.querySelector('#roles').innerHTML = Object.entries(roleLabels).map(([key, label]) => `
    <div><span>${escapeHtml(label)}</span><strong>${integer.format(member.roles[key])}</strong></div>
  `).join('');

  const weekly = document.querySelector('#weekly-status');
  weekly.textContent = member.weekly.active ? 'Ativo na semana' : 'Sem atividade na semana';
  weekly.className = `status ${member.weekly.active ? 'active' : 'inactive'}`;
  document.querySelector('#personal-detail').innerHTML = [
    detail('Hierarquia', member.hierarchy), detail('Discord', member.discordName || 'Não vinculado'),
    detail('Tempo no Discord', days(member.discordDays)), detail('Tempo na guilda', days(member.guildDays)),
    detail('Eventos criados', integer.format(member.events.created)), detail('Recebimentos', silver(member.finance.received)),
    detail('Saques pagos', silver(member.finance.withdrawn)), detail('Contas vinculadas', integer.format(member.linkedAccounts.length))
  ].join('');
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Não foi possível carregar seus dados.');
  return body;
}

async function load() {
  const refresh = document.querySelector('#refresh');
  refresh.disabled = true;
  try {
    const [data, session] = await Promise.all([
      fetchJson('/api/intelligence/membro'),
      fetchJson('/api/portal/session')
    ]);
    render(data, session);
  } catch (error) {
    const toast = document.querySelector('#toast');
    toast.textContent = error.message;
    toast.hidden = false;
  } finally {
    refresh.disabled = false;
  }
}

document.querySelector('#refresh').addEventListener('click', load);
load();
