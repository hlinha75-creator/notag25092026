const roleInfo = {
  tank: { label: 'Tank', emoji: '🛡️' },
  healer: { label: 'Healer', emoji: '✋' },
  support: { label: 'Suporte', emoji: '🟧' },
  dps: { label: 'DPS', emoji: '⚔️' }
};

const state = {
  step: 1,
  csrf: null,
  catalog: [],
  roleRules: {},
  eventTypes: [],
  savedConfigurations: [],
  lastPublishedEventId: null,
  lastConfiguration: null,
  counts: { tank: 1, healer: 1, support: 1, dps: 7 },
  dpsPool: [],
  slots: [],
  activeSlotKey: null,
  activeFamily: null
};

const form = document.querySelector('#pingcontent-form');
const picker = document.querySelector('#weapon-dialog');
const errorBox = document.querySelector('#form-error');
const draftKey = 'notag-pingcontent-draft-v1';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function itemImage(itemId) {
  const tier = Number(form.elements.tier?.value || 8);
  const quality = ['Normal', 'Bom', 'Notável', 'Excelente', 'Obra-prima'].indexOf(form.elements.quality?.value) + 1 || 4;
  return `https://render.albiononline.com/v1/item/${String(itemId).replace(/^T4_/, `T${tier}_`)}.png?quality=${quality}`;
}

function weaponById(itemId) {
  for (const family of state.catalog) {
    const weapon = family.weapons.find((candidate) => candidate.itemId === itemId);
    if (weapon) return { ...weapon, familyKey: family.key, familyLabel: family.label };
  }
  return null;
}

function currentSlot() {
  return state.slots.find((slot) => `${slot.role}:${slot.index}` === state.activeSlotKey) || null;
}

function familyRule(familyKey, role = currentSlot()?.role) {
  const rule = state.roleRules[role] || { recommended: [], excluded: [] };
  return {
    allowed: !rule.excluded.includes(familyKey),
    recommended: rule.recommended.includes(familyKey)
  };
}

function pickerGuidance(role) {
  if (role === 'tank') return 'Recomendado para Tank: Maças, Martelos e Metamorfos. As outras famílias continuam disponíveis.';
  if (role === 'healer') return 'Recomendado para Healer: Natureza, Sagrado e Metamorfos. As outras famílias continuam disponíveis.';
  return 'Para Suporte e DPS: Natureza, Sagrado, Maças e Martelos não aparecem nesta função.';
}

function ensureSlots() {
  const previous = new Map(state.slots.map((slot) => [`${slot.role}:${slot.index}`, slot]));
  state.slots = Object.entries(state.counts).flatMap(([role, count]) => Array.from({ length: count }, (_, index) => {
    const key = `${role}:${index + 1}`;
    return previous.get(key) || { role, index: index + 1, itemId: null, note: '', buildUrl: '' };
  }));
}

function updateCapacity() {
  const total = Object.values(state.counts).reduce((sum, count) => sum + count, 0);
  document.querySelector('#capacity-total').textContent = total;
  const fill = document.querySelector('#capacity-fill');
  fill.className = `capacity-${Math.min(20, Math.max(0, total))}`;
  for (const [role, count] of Object.entries(state.counts)) document.querySelector(`#count-${role}`).textContent = count;
}

function renderSlots() {
  ensureSlots();
  updateCapacity();
  const target = document.querySelector('#slot-groups');
  target.innerHTML = Object.entries(roleInfo).filter(([role]) => state.counts[role] > 0).map(([role, info]) => {
    if (role === 'dps') return dpsPoolGroup(info);
    const slots = state.slots.filter((slot) => slot.role === role);
    const complete = slots.filter((slot) => slot.itemId).length;
    return `<details class="slot-group" open>
      <summary><span class="slot-group-title">${info.emoji} ${info.label}<small>${complete}/${slots.length} armas escolhidas</small></span>${slots.length > 1 ? `<button class="repeat-role" type="button" data-repeat-role="${role}">Repetir a primeira arma</button>` : ''}</summary>
      <div class="slot-grid">${slots.map(slotCard).join('')}</div>
    </details>`;
  }).join('') || '<article class="pc-tip"><span>⚠️</span><div><strong>Composição vazia</strong><p>Adicione pelo menos uma vaga para continuar.</p></div></article>';
}

function activeDpsPool() {
  if (form.elements.dpsPolicy?.value === 'role_free') return [];
  if (['free', 'weapon_declared'].includes(form.elements.dpsPolicy?.value)) return state.dpsPool;
  return state.dpsPool.filter((weapon) => weapon.enabled !== false && Number(weapon.maxQuantity) > 0);
}

function dpsPoolGroup(info) {
  const active = activeDpsPool();
  const policy = form.elements.dpsPolicy?.value || 'predefined';
  const help = {
    caller: 'O membro escolhe entre as armas e quantidades definidas pelo caller. As obrigatórias ficam reservadas.',
    free: 'O membro escolhe livremente uma das armas disponíveis. Repetições são permitidas.',
    limited: 'O membro escolhe a arma, mas cada opção respeita o limite configurado abaixo.',
    predefined: 'O caller define as armas disponíveis antes de publicar.',
    role_free: 'O membro entra apenas como DPS, sem informar arma.',
    sheet_limited: 'O membro declara a arma respeitando os limites da planilha.',
    weapon_declared: 'O membro declara a arma, sem limite de repetição.'
  }[policy];
  return `<details class="slot-group dps-pool-group" open>
    <summary><span class="slot-group-title">${info.emoji} ${info.label}<small>${state.counts.dps} vagas · ${active.length} armas no cardápio</small></span></summary>
    <p class="dps-pool-help">${help}</p>
    <div class="dps-pool-grid">${state.dpsPool.map((weapon) => {
      const enabled = ['free', 'weapon_declared'].includes(policy) || weapon.enabled !== false;
      const mandatory = ['caller', 'predefined'].includes(policy) && weapon.mandatory;
      return `<article class="dps-pool-card ${enabled ? '' : 'disabled'}">
        <label class="dps-pool-toggle"><input type="checkbox" data-dps-enabled="${escapeHtml(weapon.weaponKey)}" ${enabled ? 'checked' : ''} ${mandatory || policy === 'free' ? 'disabled' : ''}><img src="${escapeHtml(itemImage(weapon.weaponKey))}" alt=""><span><strong>${escapeHtml(weapon.label)}</strong><small>${mandatory ? 'Obrigatória' : escapeHtml(weapon.albionName || '')}</small></span></label>
        ${['free', 'weapon_declared'].includes(policy) ? '<span class="dps-pool-limit">Sem limite individual</span>' : `<label class="dps-pool-limit"><span>Máximo</span><input type="number" min="1" max="20" data-dps-quantity="${escapeHtml(weapon.weaponKey)}" value="${Number(weapon.maxQuantity)}" ${enabled ? '' : 'disabled'}></label>`}
      </article>`;
    }).join('')}</div>
  </details>`;
}

function slotCard(slot) {
  const weapon = weaponById(slot.itemId);
  const key = `${slot.role}:${slot.index}`;
  return `<article class="slot-card" data-slot-key="${key}">
    <button class="slot-select" type="button" data-pick-slot="${key}">
      ${weapon ? `<img src="${escapeHtml(itemImage(weapon.itemId))}" alt=""><span><strong>${escapeHtml(weapon.name)}</strong><small>${escapeHtml(roleInfo[slot.role].label)} ${slot.index} · ${escapeHtml(weapon.familyLabel)}</small></span>` : `<span class="empty-weapon">+</span><span><strong>Escolher arma</strong><small>${escapeHtml(roleInfo[slot.role].label)} ${slot.index}</small></span>`}
    </button>
    <div class="slot-meta">
      <input data-slot-note="${key}" maxlength="60" value="${escapeHtml(slot.note)}" placeholder="Observação opcional">
      <input data-slot-url="${key}" type="url" maxlength="400" value="${escapeHtml(slot.buildUrl)}" placeholder="Link da build (opcional)">
    </div>
  </article>`;
}

function applyTemplate(name) {
  const templates = {
    20: { tank: 1, healer: 1, support: 1, dps: 17 },
    10: { tank: 1, healer: 1, support: 1, dps: 7 },
    5: { tank: 1, healer: 1, support: 0, dps: 3 },
    blank: { tank: 0, healer: 0, support: 0, dps: 0 }
  };
  state.counts = { ...templates[name] };
  renderSlots();
  saveDraft();
}

function changeCount(role, delta) {
  const next = Math.max(0, state.counts[role] + delta);
  const total = Object.values(state.counts).reduce((sum, count) => sum + count, 0) - state.counts[role] + next;
  if (total > 20) return showError('A composição aceita no máximo 20 jogadores.');
  state.counts[role] = next;
  renderSlots();
  saveDraft();
}

function openPicker(key) {
  state.activeSlotKey = key;
  state.activeFamily = null;
  const slot = currentSlot();
  document.querySelector('#picker-slot').textContent = `${roleInfo[slot.role].label.toUpperCase()} ${slot.index}`;
  document.querySelector('#weapon-search').value = '';
  renderFamilies();
  document.querySelector('#family-grid').scrollTop = 0;
  picker.showModal();
}

function renderFamilies(query = '') {
  state.activeFamily = null;
  const normalized = query.trim().toLocaleLowerCase('pt-BR');
  const role = currentSlot()?.role;
  const families = state.catalog
    .filter((family) => familyRule(family.key, role).allowed)
    .filter((family) => !normalized
      || `${family.label} ${family.labelEn}`.toLocaleLowerCase('pt-BR').includes(normalized)
      || family.weapons.some((weapon) => weapon.name.toLocaleLowerCase('pt-BR').includes(normalized)))
    .sort((left, right) => Number(familyRule(right.key, role).recommended) - Number(familyRule(left.key, role).recommended));
  document.querySelector('#picker-title').textContent = 'Selecione uma família';
  document.querySelector('#picker-guidance').textContent = pickerGuidance(role);
  document.querySelector('#family-grid').hidden = false;
  document.querySelector('#weapon-grid').hidden = true;
  document.querySelector('#picker-back').hidden = true;
  document.querySelector('#family-grid').innerHTML = families.map((family) => `<button class="family-card" type="button" data-family="${escapeHtml(family.key)}">${familyRule(family.key, role).recommended ? '<em>Recomendado</em>' : ''}<img src="${escapeHtml(family.icon)}" alt=""><strong>${escapeHtml(family.label)}</strong><small>${escapeHtml(family.labelEn)} · 8 armas</small></button>`).join('');
}

function renderWeapons(familyKey, query = '') {
  const family = state.catalog.find((candidate) => candidate.key === familyKey);
  if (!family || !familyRule(familyKey).allowed) return;
  state.activeFamily = familyKey;
  const normalized = query.trim().toLocaleLowerCase('pt-BR');
  const weapons = family.weapons.filter((weapon) => !normalized || weapon.name.toLocaleLowerCase('pt-BR').includes(normalized));
  document.querySelector('#picker-title').textContent = family.label;
  document.querySelector('#family-grid').hidden = true;
  document.querySelector('#weapon-grid').hidden = false;
  document.querySelector('#picker-back').hidden = false;
  document.querySelector('#weapon-grid').innerHTML = weapons.map((weapon) => `<button class="weapon-card" type="button" data-weapon="${escapeHtml(weapon.itemId)}"><img src="${escapeHtml(itemImage(weapon.itemId))}" alt=""><strong>${escapeHtml(weapon.name)}</strong><small>${escapeHtml(family.labelEn)}</small></button>`).join('') || '<p>Nenhuma arma encontrada.</p>';
  document.querySelector('#weapon-grid').scrollTop = 0;
}

function chooseWeapon(itemId) {
  const slot = currentSlot();
  const weapon = weaponById(itemId);
  if (!slot || !weapon || !familyRule(weapon.familyKey, slot.role).allowed) return;
  slot.itemId = itemId;
  picker.close();
  renderSlots();
  saveDraft();
}

function repeatRole(role) {
  const slots = state.slots.filter((slot) => slot.role === role);
  const source = slots.find((slot) => slot.itemId);
  if (!source) return showError(`Escolha primeiro uma arma para ${roleInfo[role].label}.`);
  for (const slot of slots) slot.itemId = source.itemId;
  renderSlots();
  saveDraft();
}

function scheduledTime() {
  const date = form.elements.eventDate.value;
  const time = form.elements.eventTime.value;
  if (!date || !time) return '';
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year} ${time} UTC`;
}

function selectedEventType() {
  return state.eventTypes.find((type) => type.key === form.elements.contentType.value) || { label: 'Evento', emoji: '📅' };
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return false;
}

function clearError() { errorBox.hidden = true; errorBox.textContent = ''; }

function validateStep(step) {
  clearError();
  if (step === 1) {
    for (const name of ['contentType', 'title', 'eventDate', 'eventTime', 'location']) {
      if (!form.elements[name].value.trim()) return showError('Escolha o tipo e preencha nome, data, horário e local para continuar.');
    }
  }
  if (step === 2) {
    if (!state.slots.length) return showError('Adicione pelo menos uma vaga à composição.');
    const missing = state.slots.find((slot) => slot.role !== 'dps' && !slot.itemId);
    if (missing) return showError(`Escolha a arma de ${roleInfo[missing.role].label} ${missing.index}.`);
    if (state.counts.dps > 0) {
      const active = activeDpsPool();
      const policy = form.elements.dpsPolicy?.value || 'predefined';
      if (['caller', 'predefined'].includes(policy) && active.filter((weapon) => weapon.mandatory).length < 2) return showError('Prisma e Luvas Cravadas são obrigatórias.');
      const capacity = active.reduce((sum, weapon) => sum + Number(weapon.maxQuantity || 0), 0);
      if (['caller', 'predefined'].includes(policy) && state.counts.dps < 2) return showError('Use pelo menos 2 vagas de DPS para comportar as armas obrigatórias.');
      if (!['free', 'weapon_declared', 'role_free'].includes(policy) && capacity < state.counts.dps) return showError(`O estoque oferece ${capacity} escolhas, mas existem ${state.counts.dps} vagas de DPS.`);
    }
  }
  return true;
}

function goToStep(next) {
  const target = Math.max(1, Math.min(4, Number(next)));
  if (target > state.step) {
    for (let step = state.step; step < target; step += 1) if (!validateStep(step)) return;
  }
  state.step = target;
  document.querySelectorAll('.pc-stage').forEach((section) => {
    const active = Number(section.dataset.stage) === target;
    section.hidden = !active;
    section.classList.toggle('active', active);
  });
  document.querySelectorAll('.pc-step').forEach((button) => {
    const step = Number(button.dataset.goStep);
    button.classList.toggle('active', step === target);
    button.classList.toggle('done', step < target);
  });
  document.querySelector('#previous-step').hidden = target === 1;
  document.querySelector('#next-step').hidden = target === 4;
  document.querySelector('#publish-event').hidden = target !== 4;
  document.querySelector('#copy-markdown').hidden = target !== 4;
  if (target === 4) renderPreview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderPreview() {
  const values = Object.fromEntries(new FormData(form).entries());
  const type = selectedEventType();
  const requirements = `T${values.tier}.${values.enchantment} · ${values.quality}${values.itemPower ? ` · ${values.itemPower} IP mínimo` : ''}`;
  const roleBlocks = Object.entries(roleInfo).filter(([role]) => state.counts[role]).map(([role, info]) => {
    if (role === 'dps') {
      const policy = form.elements.dpsPolicy?.value || 'predefined';
      const choices = activeDpsPool().map((weapon) => {
        const rule = ['free', 'weapon_declared'].includes(policy) ? 'sem limite individual' : `máximo ${Number(weapon.maxQuantity)}${['caller', 'predefined'].includes(policy) && weapon.mandatory ? ' · obrigatória' : ''}`;
        return `<div class="preview-slot"><img src="${escapeHtml(itemImage(weapon.weaponKey))}" alt=""><span>${info.emoji} <b>${escapeHtml(weapon.label)}</b> — ${rule}</span><i>Disponível</i></div>`;
      }).join('');
      const policyLabel = { caller: 'definidas pelo caller', free: 'escolha livre', limited: 'escolha com limites', predefined: 'predefinidas', role_free: 'livre sem informar arma', sheet_limited: 'limitada pela planilha', weapon_declared: 'livre com arma declarada' }[policy];
      return `<p class="preview-role">${info.emoji} ${info.label} — ${state.counts.dps} vagas · ${policyLabel}</p>${choices}`;
    }
    const lines = state.slots.filter((slot) => slot.role === role).map((slot) => {
      const weapon = weaponById(slot.itemId);
      return `<div class="preview-slot"><img src="${escapeHtml(itemImage(slot.itemId))}" alt=""><span>${info.emoji} <b>${escapeHtml(info.label)}${state.counts[role] > 1 ? ` ${slot.index}` : ''}</b> — T${escapeHtml(values.tier)}.${escapeHtml(values.enchantment)} ${escapeHtml(weapon?.name || 'Arma')} ${slot.note ? `· ${escapeHtml(slot.note)}` : ''}</span><i>Vazio</i></div>`;
    }).join('');
    return `<p class="preview-role">${info.emoji} ${escapeHtml(info.label)}</p>${lines}`;
  }).join('');
  document.querySelector('#discord-preview').innerHTML = `<h2 class="preview-title">${escapeHtml(type.emoji)} ${escapeHtml(values.title || 'Evento da Notag')}</h2><p class="preview-meta">${escapeHtml(type.label)} · 🕒 <b>${escapeHtml(scheduledTime())}</b> · 📍 <b>${escapeHtml(values.location)}</b></p><p class="preview-detail"><b>Descrição:</b> ${escapeHtml(values.description || 'Pergunte na call')}</p><p class="preview-detail"><b>Requisitos:</b> ${escapeHtml(requirements)}</p><p class="preview-detail"><b>Loot:</b> ${escapeHtml(values.lootRules || 'Não informado')}</p><p class="preview-detail"><b>Consumíveis:</b> ${escapeHtml(values.consumables || 'Não informado')}</p><p class="preview-detail"><b>Montaria:</b> ${escapeHtml(values.mount || 'Não informado')}</p><div class="preview-composition"><h3>Composição (0/${state.slots.length})</h3>${roleBlocks}<p><b>Espectadores:</b> Vazio</p></div>`;
  document.querySelector('#review-checklist').innerHTML = [type.label, `${state.slots.length} vagas configuradas`, `${activeDpsPool().length} opções no cardápio DPS`, requirements, values.audience === 'public' ? 'Membros e convidados' : values.audience === 'staff' ? 'Somente staff' : 'Somente membros'].map((text) => `<li>${escapeHtml(text)}</li>`).join('');
}

function markdownValue(value, fallback = 'Não informado') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function markdownWeapon(slot, values) {
  const weapon = weaponById(slot.itemId);
  const label = `T${values.tier}.${values.enchantment} ${weapon?.name || 'Arma'}`;
  const url = /^https?:\/\/\S+$/i.test(slot.buildUrl || '') ? slot.buildUrl : '';
  return `${url ? `[${label}](${url})` : label}${slot.note ? ` · ${markdownValue(slot.note, '')}` : ''}`;
}

function eventMarkdown() {
  const values = Object.fromEntries(new FormData(form).entries());
  const type = selectedEventType();
  const audience = values.audience === 'public' ? 'Membros e convidados' : values.audience === 'staff' ? 'Somente staff' : 'Somente membros';
  const requirements = `T${values.tier}.${values.enchantment} · ${values.quality}${values.itemPower ? ` · ${values.itemPower} IP mínimo` : ''}`;
  const composition = Object.entries(roleInfo).filter(([role]) => state.counts[role]).flatMap(([role, info]) => {
    if (role === 'dps') {
      const policy = form.elements.dpsPolicy?.value || 'predefined';
      return [
        `### ${info.emoji} ${info.label} — ${state.counts.dps} vagas`,
        ...activeDpsPool().map((weapon) => `- **${weapon.label}:** ${['free', 'weapon_declared'].includes(policy) ? 'sem limite individual' : `máximo ${weapon.maxQuantity}${['caller', 'predefined'].includes(policy) && weapon.mandatory ? ' · obrigatória' : ''}`}`),
        ''
      ];
    }
    const slots = state.slots.filter((slot) => slot.role === role);
    return [`### ${info.emoji} ${info.label}`, ...slots.map((slot) => `- **${info.label}${slots.length > 1 ? ` ${slot.index}` : ''}:** ${markdownWeapon(slot, values)} — Vazio`), ''];
  });
  return [
    `## ${type.emoji} ${markdownValue(values.title, 'Evento da Notag')}`,
    '',
    `**Tipo:** ${type.label}`,
    `**Data:** ${scheduledTime()}`,
    `**Local:** ${markdownValue(values.location)}`,
    `**Descrição:** ${markdownValue(values.description, 'Pergunte na call')}`,
    `**Acesso:** ${audience}`,
    `**Requisitos:** ${requirements}`,
    `**Loot:** ${markdownValue(values.lootRules)}`,
    `**Consumíveis:** ${markdownValue(values.consumables)}`,
    `**Montaria:** ${markdownValue(values.mount)}`,
    '',
    `## Composição (0/${state.slots.length})`,
    '',
    ...composition,
    '**Espectadores:** Vazio'
  ].join('\n').trim();
}

async function copyMarkdown() {
  if (!validateStep(1) || !validateStep(2)) return;
  const markdown = eventMarkdown();
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(markdown);
  else {
    const textarea = document.createElement('textarea');
    textarea.value = markdown;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  const button = document.querySelector('#copy-markdown');
  button.textContent = 'Markdown copiado ✓';
  toast('Markdown copiado. Nenhum evento foi criado e nenhum ping foi enviado.');
  window.setTimeout(() => { button.textContent = 'Copiar Markdown'; }, 1800);
}

function draftPayload() {
  return {
    updatedAt: Date.now(),
    fields: Object.fromEntries(new FormData(form).entries()),
    counts: state.counts,
    slots: state.slots,
    dpsPool: state.dpsPool,
    dpsPolicy: form.elements.dpsPolicy?.value || 'predefined'
  };
}

function saveDraft() {
  try { localStorage.setItem(draftKey, JSON.stringify(draftPayload())); } catch { /* armazenamento opcional */ }
}

function applyConfiguration(config) {
  if (!config) return;
  for (const [name, value] of Object.entries(config.fields || config)) {
    if (form.elements[name] && value != null && typeof value !== 'object') form.elements[name].value = value;
  }
  if (config.scheduledTime) setSchedule(config.scheduledTime);
  if (config.counts) state.counts = { ...state.counts, ...config.counts };
  if (Array.isArray(config.dpsPool) && config.dpsPool.length) {
    const previous = new Map(config.dpsPool.map((weapon) => [weapon.weaponKey || weapon.weapon_key, weapon]));
    state.dpsPool = state.dpsPool.map((definition) => {
      const saved = previous.get(definition.weaponKey);
      return saved ? { ...definition, ...saved, weaponKey: definition.weaponKey } : { ...definition, enabled: false };
    });
  }
  const slots = Array.isArray(config.slots) ? config.slots.filter((slot) => roleInfo[slot.role] && Number(slot.index) > 0) : [];
  if (slots.length) {
    state.slots = slots.map((slot) => ({
      role: slot.role,
      index: Number(slot.index),
      itemId: weaponById(slot.itemId) && familyRule(weaponById(slot.itemId).familyKey, slot.role).allowed ? slot.itemId : null,
      note: slot.note || '',
      buildUrl: slot.buildUrl || ''
    }));
    if (!config.counts) {
      state.counts = Object.fromEntries(Object.keys(roleInfo).map((role) => [role, state.slots.filter((slot) => slot.role === role).length]));
    }
  }
  renderSlots();
  saveDraft();
}

function normalizeSavedConfiguration(saved) {
  const config = saved?.configuration || {};
  return {
    contentType: config.content_type || saved.contentType,
    title: config.title,
    description: config.description,
    location: config.location,
    audience: config.audience,
    dpsPolicy: config.dps_policy || 'predefined',
    counts: { tank: Number(config.tank_slots || 0), healer: Number(config.healer_slots || 0), support: Number(config.support_slots || 0), dps: Number(config.dps_slots || 0) },
    slots: (config.slots || []).map((slot) => ({ role: slot.role, index: Number(slot.slot_index ?? slot.index), itemId: slot.build_key || slot.buildKey || null, buildUrl: slot.build_url || slot.buildUrl || '', note: '' })),
    dpsPool: (config.dpsPool || []).map((weapon) => ({ weaponKey: weapon.weapon_key || weapon.weaponKey, maxQuantity: Number(weapon.max_quantity || weapon.maxQuantity), mandatory: Boolean(weapon.mandatory), enabled: true }))
  };
}

function renderSavedConfigurations() {
  const select = document.querySelector('#saved-configurations');
  select.innerHTML = '<option value="">Configurações salvas</option>' + state.savedConfigurations.map((saved) => `<option value="${saved.id}">${escapeHtml(saved.name)} · ${escapeHtml(saved.contentType)}</option>`).join('');
  document.querySelector('#delete-configuration').disabled = !select.value;
}

async function configurationAction(action, values) {
  const body = new URLSearchParams({ csrf: state.csrf, action, ...values });
  const response = await fetch('/api/staff/pingcontent', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível atualizar a configuração.');
  return data.result;
}

function setSchedule(value) {
  const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})/);
  if (!match) return;
  form.elements.eventDate.value = `${match[3]}-${match[2]}-${match[1]}`;
  form.elements.eventTime.value = match[4];
}

function restoreLocalDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey));
    if (!draft || Date.now() - Number(draft.updatedAt || 0) > 7 * 24 * 60 * 60 * 1000) return;
    applyConfiguration(draft);
    document.querySelector('#draft-state').textContent = 'Rascunho recuperado deste navegador';
  } catch { /* rascunho inválido é ignorado */ }
}

function toast(message) {
  const target = document.querySelector('#pc-toast');
  target.textContent = message;
  target.hidden = false;
}

async function postEvent() {
  const values = Object.fromEntries(new FormData(form).entries());
  const submittedDpsPool = state.dpsPool.map((weapon) => (
    ['free', 'weapon_declared'].includes(values.dpsPolicy) ? { ...weapon, enabled: true } : weapon
  ));
  const body = new URLSearchParams({
    csrf: state.csrf,
    contentType: values.contentType,
    title: values.title,
    description: values.description,
    scheduledTime: scheduledTime(),
    location: values.location,
    audience: values.audience,
    tier: values.tier,
    enchantment: values.enchantment,
    quality: values.quality,
    itemPower: values.itemPower,
    lootRules: values.lootRules,
    consumables: values.consumables,
    mount: values.mount,
    slots: JSON.stringify(state.slots),
    dpsPool: JSON.stringify(submittedDpsPool),
    dpsPolicy: values.dpsPolicy || 'predefined'
  });
  const response = await fetch('/api/staff/pingcontent', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível criar o evento.');
  return data.result;
}

async function initialize() {
  try {
    const response = await fetch('/api/staff/pingcontent');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível abrir o criador.');
    state.csrf = data.csrf;
    state.catalog = data.catalog || [];
    state.roleRules = data.roleRules || {};
    state.eventTypes = data.eventTypes || [];
    form.elements.contentType.innerHTML = '<option value="">Selecione o tipo do evento</option>' + state.eventTypes.map((type) => `<option value="${escapeHtml(type.key)}">${escapeHtml(type.emoji)} ${escapeHtml(type.label)}</option>`).join('');
    state.dpsPool = (data.defaultDpsPool || []).map((weapon) => ({ ...weapon, enabled: true }));
    state.lastConfiguration = data.lastConfiguration;
    state.savedConfigurations = data.savedConfigurations || [];
    document.querySelector('#pc-user').textContent = data.user?.name || data.user?.username || 'Staff';
    document.querySelector('#load-last').hidden = !state.lastConfiguration;
    renderSavedConfigurations();
    renderSlots();
    restoreLocalDraft();
  } catch (error) {
    showError(error.message);
  }
}

document.querySelectorAll('[data-template]').forEach((button) => button.addEventListener('click', () => applyTemplate(button.dataset.template)));
document.querySelectorAll('[data-counter]').forEach((button) => button.addEventListener('click', () => changeCount(button.dataset.counter, Number(button.dataset.delta))));
document.querySelectorAll('[data-go-step]').forEach((button) => button.addEventListener('click', () => goToStep(button.dataset.goStep)));
document.querySelector('#previous-step').addEventListener('click', () => goToStep(state.step - 1));
document.querySelector('#next-step').addEventListener('click', () => goToStep(state.step + 1));
document.querySelector('#load-last').addEventListener('click', () => { applyConfiguration(state.lastConfiguration); toast('Última configuração carregada. Ajuste o que precisar.'); });
document.querySelector('#saved-configurations').addEventListener('change', (event) => {
  const saved = state.savedConfigurations.find((item) => String(item.id) === event.target.value);
  document.querySelector('#delete-configuration').disabled = !saved;
  if (saved) { applyConfiguration(normalizeSavedConfiguration(saved)); toast(`Configuração ${saved.name} carregada.`); }
});
document.querySelector('#save-configuration').addEventListener('click', async () => {
  const name = window.prompt('Nome da configuração:');
  if (!name) return;
  try {
    const saved = await configurationAction('save_config', { eventId: state.lastPublishedEventId, name });
    state.savedConfigurations = state.savedConfigurations.filter((item) => item.id !== saved.id);
    state.savedConfigurations.unshift({ id: saved.id, name: saved.name, contentType: saved.content_type, configuration: JSON.parse(saved.config_json) });
    renderSavedConfigurations(); toast('Configuração salva para usar depois.');
  } catch (error) { showError(error.message); }
});
document.querySelector('#delete-configuration').addEventListener('click', async () => {
  const select = document.querySelector('#saved-configurations');
  const saved = state.savedConfigurations.find((item) => String(item.id) === select.value);
  if (!saved || !window.confirm(`Excluir a configuração ${saved.name}? O evento original será preservado.`)) return;
  try {
    await configurationAction('delete_config', { templateId: saved.id });
    state.savedConfigurations = state.savedConfigurations.filter((item) => item.id !== saved.id);
    renderSavedConfigurations(); toast('Configuração excluída; evento original preservado.');
  } catch (error) { showError(error.message); }
});
document.querySelector('#copy-markdown').addEventListener('click', () => copyMarkdown().catch((error) => showError(`Não foi possível copiar: ${error.message}`)));
document.querySelector('#slot-groups').addEventListener('click', (event) => {
  const pickerButton = event.target.closest('[data-pick-slot]');
  if (pickerButton) return openPicker(pickerButton.dataset.pickSlot);
  const repeatButton = event.target.closest('[data-repeat-role]');
  if (repeatButton) { event.preventDefault(); return repeatRole(repeatButton.dataset.repeatRole); }
});
document.querySelector('#slot-groups').addEventListener('input', (event) => {
  const dpsQuantityKey = event.target.dataset.dpsQuantity;
  if (dpsQuantityKey) {
    const weapon = state.dpsPool.find((candidate) => candidate.weaponKey === dpsQuantityKey);
    if (weapon) weapon.maxQuantity = Math.max(1, Math.min(20, Number(event.target.value) || 1));
    saveDraft();
    return;
  }
  const noteKey = event.target.dataset.slotNote;
  const urlKey = event.target.dataset.slotUrl;
  const key = noteKey || urlKey;
  if (!key) return;
  const slot = state.slots.find((candidate) => `${candidate.role}:${candidate.index}` === key);
  if (!slot) return;
  if (noteKey) slot.note = event.target.value;
  if (urlKey) slot.buildUrl = event.target.value;
  saveDraft();
});
document.querySelector('#slot-groups').addEventListener('change', (event) => {
  const dpsEnabledKey = event.target.dataset.dpsEnabled;
  if (!dpsEnabledKey) return;
  const weapon = state.dpsPool.find((candidate) => candidate.weaponKey === dpsEnabledKey);
  if (!weapon || weapon.mandatory) return;
  weapon.enabled = event.target.checked;
  renderSlots();
  saveDraft();
});
document.querySelector('#family-grid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-family]');
  if (button) renderWeapons(button.dataset.family, document.querySelector('#weapon-search').value);
});
document.querySelector('#weapon-grid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-weapon]');
  if (button) chooseWeapon(button.dataset.weapon);
});
document.querySelector('#weapon-search').addEventListener('input', (event) => state.activeFamily ? renderWeapons(state.activeFamily, event.target.value) : renderFamilies(event.target.value));
document.querySelector('#picker-back').addEventListener('click', () => { document.querySelector('#weapon-search').value = ''; renderFamilies(); });
document.querySelector('#picker-close').addEventListener('click', () => picker.close());
form.addEventListener('input', () => saveDraft());
form.addEventListener('change', () => { if (state.step === 2) renderSlots(); saveDraft(); });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!validateStep(1) || !validateStep(2)) return;
  if (!window.confirm(`Publicar ${form.elements.title.value} no Discord com ${state.slots.length} vagas?`)) return;
  const button = document.querySelector('#publish-event');
  button.disabled = true;
  button.textContent = 'Publicando…';
  try {
    const result = await postEvent();
    state.lastPublishedEventId = result.event.id;
    document.querySelector('#save-configuration').hidden = false;
    localStorage.removeItem(draftKey);
    button.textContent = 'Publicado ✓';
    toast(result.message);
  } catch (error) {
    showError(error.message);
    button.disabled = false;
    button.textContent = 'Criar e publicar no Discord';
  }
});

initialize();
