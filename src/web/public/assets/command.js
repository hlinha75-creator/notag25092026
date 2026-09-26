const number = new Intl.NumberFormat('pt-BR');
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const state = { data: null, filtered: [], selected: new Set(), columns: [] };

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const deep = (row, path) => path.split('.').reduce((value, key) => value?.[key], row);
const duration = (seconds) => `${number.format(Math.round(Number(seconds || 0) / 3600))}h`;
const silver = (value) => `${compact.format(Number(value || 0))}`;
const days = (value) => value == null ? '—' : `${number.format(value)} d`;
const score = (row) => Math.round(Math.min(100, row.events.total * 3 + row.events.created * 5 + row.events.transport * 2 + row.events.worldBoss * 2 + Object.values(row.roles).filter(Boolean).length * 2 + Math.min(20, row.weekly.voiceSeconds / 3600) + (row.weekly.active ? 10 : 0)));

const columns = [
  { id:'member', label:'Personagem', value:r=>r.albionName || r.discordName || 'Sem identificação', render:r=>`<span class="member-name">${escapeHtml(r.albionName || 'Sem personagem')}</span><span class="member-sub">${escapeHtml(r.discordName || 'Discord não vinculado')}</span>` },
  { id:'hierarchy', label:'Cargo', value:r=>r.hierarchy },
  { id:'weekly.active', label:'Semana', value:r=>r.weekly.active ? 1 : 0, render:r=>`<span class="status ${r.weekly.active?'active':'inactive'}">${r.weekly.active?'Ativo':'Sem atividade'}</span>` },
  { id:'score', label:'Contribuição', value:score, render:r=>`<span class="score">${score(r)}</span>`, numeric:true },
  { id:'linkedAccounts', label:'Contas vinculadas', value:r=>r.linkedAccounts.length, render:r=>r.linkedAccounts.length ? escapeHtml(r.linkedAccounts.map(a=>a.label||a.albionName||a.discordName||a.id).join(', ')) : '—' },
  { id:'discordDays', label:'Dias no Discord', value:r=>r.discordDays, render:r=>days(r.discordDays), numeric:true },
  { id:'guildDays', label:'Dias na guilda', value:r=>r.guildDays, render:r=>days(r.guildDays), numeric:true },
  { id:'fame.total', label:'Fama total', render:r=>compact.format(r.fame.total), numeric:true },
  { id:'fame.pve', label:'Fama PvE', render:r=>compact.format(r.fame.pve), numeric:true },
  { id:'fame.pvp', label:'Fama PvP', render:r=>compact.format(r.fame.pvp), numeric:true },
  { id:'fame.gathering', label:'Coleta', render:r=>compact.format(r.fame.gathering), numeric:true },
  { id:'fame.crafting', label:'Craft', render:r=>compact.format(r.fame.crafting), numeric:true },
  { id:'events.total', label:'Eventos', numeric:true },
  { id:'events.totalSeconds', label:'Tempo em eventos', render:r=>duration(r.events.totalSeconds), numeric:true },
  { id:'events.transport', label:'Transporte', numeric:true },
  { id:'events.raid', label:'Raid', numeric:true },
  { id:'events.worldBoss', label:'World boss', numeric:true },
  { id:'events.roaming', label:'Roaming', numeric:true },
  { id:'events.farm', label:'Farm', numeric:true },
  { id:'events.created', label:'Eventos criados', numeric:true },
  { id:'weekly.voiceSeconds', label:'Voz na semana', render:r=>duration(r.weekly.voiceSeconds), numeric:true },
  { id:'finance.balance', label:'Saldo', render:r=>silver(r.finance.balance), numeric:true },
  { id:'finance.received', label:'Recebeu', render:r=>silver(r.finance.received), numeric:true },
  { id:'finance.withdrawn', label:'Sacou', render:r=>silver(r.finance.withdrawn), numeric:true },
  { id:'finance.movement', label:'Movimentação', render:r=>silver(r.finance.movement), numeric:true },
  { id:'roles.tank', label:'Tank', numeric:true }, { id:'roles.healer', label:'Healer', numeric:true },
  { id:'roles.support', label:'Support', numeric:true }, { id:'roles.dps', label:'DPS', numeric:true }, { id:'roles.scout', label:'Scout', numeric:true }
];
const defaults = ['member','hierarchy','weekly.active','score','fame.total','events.total','events.totalSeconds','events.transport','events.worldBoss','finance.balance','roles.tank','roles.healer','roles.support','roles.dps','roles.scout'];

function columnValue(column, row) { return column.value ? column.value(row) : deep(row, column.id); }
function renderMetrics(summary) {
  const cards = [['Membros relacionados',summary.members,'Snapshot + cadastros'],['Ativos na semana',summary.activeWeekly,'Voz ou evento'],['Sem atividade',summary.inactiveWeekly,'Revisar individualmente'],['Sem Discord',summary.unlinked,'Aguardam vínculo'],['Horas em eventos',summary.eventHours,'Histórico acumulado']];
  document.querySelector('#metrics').innerHTML = cards.map(([label,value,note])=>`<article class="metric"><span>${label}</span><strong>${number.format(value)}</strong><small>${note}</small></article>`).join('');
}
function loadColumnSelection() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('notag-command-columns')); } catch {}
  state.selected = new Set(Array.isArray(saved) && saved.length ? saved : defaults);
  document.querySelector('#column-options').innerHTML = columns.map(column=>`<label><input type="checkbox" value="${column.id}" ${state.selected.has(column.id)?'checked':''}>${column.label}</label>`).join('');
}
function renderTable() {
  const selected = columns.filter(column=>state.selected.has(column.id));
  document.querySelector('#member-head').innerHTML = `<tr>${selected.map(c=>`<th class="${c.numeric?'num':''}">${escapeHtml(c.label)}</th>`).join('')}</tr>`;
  document.querySelector('#member-body').innerHTML = state.filtered.length ? state.filtered.map((row,index)=>`<tr data-index="${index}">${selected.map(column=>`<td class="${column.numeric?'num':''}">${column.render ? column.render(row) : escapeHtml(columnValue(column,row) ?? '—')}</td>`).join('')}</tr>`).join('') : `<tr><td class="empty" colspan="${selected.length}">Nenhum membro corresponde aos filtros.</td></tr>`;
  document.querySelector('#result-summary').textContent = `${number.format(state.filtered.length)} de ${number.format(state.data.members.length)} membros exibidos`;
}
function applyFilters() {
  if (!state.data) return;
  const query = document.querySelector('#search').value.trim().toLowerCase();
  const hierarchy = document.querySelector('#hierarchy').value;
  const weekly = document.querySelector('#weekly').value;
  const eventType = document.querySelector('#event-type').value;
  const minEvents = Number(document.querySelector('#min-events').value || 0);
  state.filtered = state.data.members.filter(row => {
    const haystack = [row.albionName,row.discordName,row.hierarchy,...row.linkedAccounts.flatMap(a=>[a.label,a.albionName,a.discordName,a.id])].filter(Boolean).join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (!hierarchy || row.hierarchy===hierarchy) && (!weekly || row.weekly.active===(weekly==='active')) && (!eventType || row.events[eventType]>0) && row.events.total>=minEvents;
  });
  const sort = document.querySelector('#sort').value;
  const rules = { 'score-desc':(a,b)=>score(b)-score(a), 'name-asc':(a,b)=>String(a.albionName||a.discordName||'').localeCompare(String(b.albionName||b.discordName||''),'pt-BR'), 'events-desc':(a,b)=>b.events.total-a.events.total, 'hours-desc':(a,b)=>b.events.totalSeconds-a.events.totalSeconds, 'fame-desc':(a,b)=>b.fame.total-a.fame.total, 'balance-desc':(a,b)=>b.finance.balance-a.finance.balance, 'inactive-first':(a,b)=>Number(a.weekly.active)-Number(b.weekly.active) };
  state.filtered.sort(rules[sort]); renderTable();
}
function detailList(items) { return `<dl>${items.map(([key,value])=>`<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`; }
function openDetail(row) {
  document.querySelector('#member-detail').innerHTML = `<header class="detail-head"><span class="eyebrow">FICHA DO MEMBRO</span><h2>${escapeHtml(row.albionName||'Sem personagem')}</h2><p>${escapeHtml(row.discordName||'Discord não vinculado')} · ${escapeHtml(row.hierarchy)}</p></header><div class="detail-grid">
    <section class="detail-card"><h3>Identidade</h3>${detailList([['Discord',row.discordName||'—'],['Contas',row.linkedAccounts.map(a=>a.label||a.albionName||a.id).join(', ')||'—'],['Dias no Discord',days(row.discordDays)],['Dias na guilda',days(row.guildDays)]])}</section>
    <section class="detail-card"><h3>Atividade</h3>${detailList([['Status semanal',row.weekly.active?'Ativo':'Sem atividade'],['Eventos na semana',number.format(row.weekly.events)],['Voz na semana',duration(row.weekly.voiceSeconds)],['Contribuição',`${score(row)}/100`]])}</section>
    <section class="detail-card"><h3>Eventos</h3>${detailList([['Total',number.format(row.events.total)],['Tempo total',duration(row.events.totalSeconds)],['Transporte',number.format(row.events.transport)],['Raid / World boss',`${row.events.raid} / ${row.events.worldBoss}`],['Roaming / Farm',`${row.events.roaming} / ${row.events.farm}`],['Criados',number.format(row.events.created)]])}</section>
    <section class="detail-card"><h3>Funções</h3>${detailList([['Tank',row.roles.tank],['Healer',row.roles.healer],['Support',row.roles.support],['DPS',row.roles.dps],['Scout',row.roles.scout]])}</section>
    <section class="detail-card"><h3>Fama</h3>${detailList([['Total',number.format(row.fame.total)],['PvE',number.format(row.fame.pve)],['PvP',number.format(row.fame.pvp)],['Coleta',number.format(row.fame.gathering)],['Craft',number.format(row.fame.crafting)]])}</section>
    <section class="detail-card"><h3>Financeiro</h3>${detailList([['Saldo',silver(row.finance.balance)],['Recebeu',silver(row.finance.received)],['Sacou',silver(row.finance.withdrawn)],['Movimentação',silver(row.finance.movement)]])}</section></div>`;
  document.querySelector('#member-dialog').showModal();
}
function csvCell(value) { return `"${String(value??'').replace(/"/g,'""')}"`; }
function exportCsv() {
  const selected = columns.filter(column=>state.selected.has(column.id));
  const rows = [selected.map(c=>csvCell(c.label)).join(';'),...state.filtered.map(row=>selected.map(c=>csvCell(columnValue(c,row))).join(';'))];
  const blob = new Blob([`\uFEFF${rows.join('\n')}`],{type:'text/csv;charset=utf-8'}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=`notag-intelligence-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
}
async function loadData() {
  document.querySelector('#refresh').disabled=true;
  try { const response=await fetch('/api/intelligence/staff',{headers:{Accept:'application/json'}}); if(response.status===401||response.status===403){location.href='/';return;} if(!response.ok)throw new Error('Falha ao carregar'); state.data=await response.json(); renderMetrics(state.data.summary); document.querySelector('#freshness').textContent=`Atualizado ${date.format(new Date(state.data.generatedAt))}`; document.querySelector('#definitions').textContent=`${state.data.definitions.weeklyActivity} ${state.data.definitions.eventCategories}`; const options=[...new Set(state.data.members.map(m=>m.hierarchy))].sort(); document.querySelector('#hierarchy').innerHTML='<option value="">Todos os cargos</option>'+options.map(v=>`<option>${escapeHtml(v)}</option>`).join(''); applyFilters(); }
  catch { document.querySelector('#member-body').innerHTML='<tr><td class="empty">Não foi possível carregar os dados. Tente atualizar.</td></tr>'; }
  finally { document.querySelector('#refresh').disabled=false; }
}
loadColumnSelection(); loadData();
document.querySelectorAll('.filters input,.filters select').forEach(el=>el.addEventListener(el.tagName==='INPUT'?'input':'change',applyFilters));
document.querySelector('#column-options').addEventListener('change',event=>{event.target.checked?state.selected.add(event.target.value):state.selected.delete(event.target.value); if(!state.selected.size){state.selected.add('member'); event.target.checked=true;} localStorage.setItem('notag-command-columns',JSON.stringify([...state.selected])); renderTable();});
document.querySelector('#clear-filters').addEventListener('click',()=>{document.querySelectorAll('.filters input').forEach(el=>el.value='');document.querySelectorAll('.filters select').forEach(el=>el.selectedIndex=0);applyFilters();});
document.querySelector('#refresh').addEventListener('click',loadData); document.querySelector('#export-csv').addEventListener('click',exportCsv);
document.querySelector('#member-body').addEventListener('click',event=>{const row=event.target.closest('tr[data-index]');if(row)openDetail(state.filtered[Number(row.dataset.index)]);});
document.querySelector('.dialog-close').addEventListener('click',()=>document.querySelector('#member-dialog').close());
document.querySelector('#member-dialog').addEventListener('click',event=>{if(event.target===event.currentTarget)event.currentTarget.close();});
