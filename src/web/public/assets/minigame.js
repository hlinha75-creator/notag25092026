const zones = {
  'ancient-forest': {
    name: 'FLORESTA ANTIGA', shortName: 'FLORESTA', resource: 'wood', resourceLabel: 'madeira',
    action: 'Cortando carvalho ancestral...', activity: 'Madeira, animais e ervas', rate: 14,
    safety: 'REGIÃO SEGURA', weather: 'BOSQUE ÚMIDO', weatherIcon: '♣', tool: '🪓', capacity: 30
  },
  'abandoned-mine': {
    name: 'MINA ABANDONADA', shortName: 'MINA', resource: 'ore', resourceLabel: 'minério',
    action: 'Extraindo ferro e carvão...', activity: 'Ferro, carvão e cristais', rate: 18,
    safety: 'REGIÃO SEGURA', weather: 'SUBTERRÂNEO', weatherIcon: '◈', tool: '⛏', capacity: 30
  },
  'royal-fields': {
    name: 'CAMPOS REAIS', shortName: 'CAMPOS', resource: 'food', resourceLabel: 'comida',
    action: 'Colhendo trigo dourado...', activity: 'Comida, plantas e animais', rate: 22,
    safety: 'REGIÃO SEGURA', weather: 'SOL DOURADO', weatherIcon: '☼', tool: '♨', capacity: 30
  },
  'red-desert': {
    name: 'DESERTO VERMELHO', shortName: 'DESERTO', resource: 'ore', resourceLabel: 'minério',
    action: 'Garimpando minério rubro...', activity: 'Minérios raros e monstros', rate: 12,
    safety: 'REGIÃO DE RISCO', weather: 'CALOR EXTREMO', weatherIcon: '☀', tool: '⛏', capacity: 24
  },
  'frozen-mountains': {
    name: 'MONTANHAS GELADAS', shortName: 'GELO', resource: 'stone', resourceLabel: 'cristal',
    action: 'Lapidando cristal glacial...', activity: 'Recursos T4/T5 e bosses', rate: 10,
    safety: 'REGIÃO HOSTIL', weather: 'NEVASCA', weatherIcon: '❄', tool: '✦', capacity: 20
  },
  'black-lands': {
    name: 'TERRAS NEGRAS', shortName: 'TERRAS NEGRAS', resource: 'ore', resourceLabel: 'fragmento',
    action: 'Extraindo fragmentos sombrios...', activity: 'Recursos raríssimos e PvP', rate: 8,
    safety: 'ZONA DE PVP', weather: 'CORRUPÇÃO', weatherIcon: '☠', tool: '◆', capacity: 18
  }
};

const simulatedPlayers = [
  { id: 'robert', name: 'RobertXVII', level: 18, zoneId: 'abandoned-mine', instanceId: 1, tone: 'violet', activity: 'mining', partyId: 'notag-one' },
  { id: 'horsix', name: 'Horsix', level: 9, zoneId: 'abandoned-mine', instanceId: 1, tone: 'green', activity: 'mining', partyId: 'notag-one' },
  { id: 'naga', name: 'Naga', level: 15, zoneId: 'ancient-forest', instanceId: 1, tone: 'red', activity: 'walking', partyId: 'notag-one' },
  { id: 'lunar', name: 'LunarFox', level: 21, zoneId: 'ancient-forest', instanceId: 1, tone: 'blue', activity: 'gathering' },
  { id: 'vulto', name: 'Vulto', level: 17, zoneId: 'ancient-forest', instanceId: 1, tone: 'shadow', activity: 'gathering' },
  { id: 'maya', name: 'Maya', level: 11, zoneId: 'royal-fields', instanceId: 1, tone: 'gold', activity: 'gathering' },
  { id: 'redpanda', name: 'RedPanda', level: 16, zoneId: 'royal-fields', instanceId: 1, tone: 'red', activity: 'walking' },
  { id: 'sabedoria', name: 'Sabedoria', level: 24, zoneId: 'red-desert', instanceId: 1, tone: 'gold', activity: 'mining' },
  { id: 'kael', name: 'Kael', level: 20, zoneId: 'red-desert', instanceId: 1, tone: 'blue', activity: 'walking' },
  { id: 'boreal', name: 'Boreal', level: 28, zoneId: 'frozen-mountains', instanceId: 1, tone: 'blue', activity: 'mining' },
  { id: 'aurora', name: 'Aurora', level: 26, zoneId: 'frozen-mountains', instanceId: 1, tone: 'violet', activity: 'gathering' },
  { id: 'noctis', name: 'Noctis', level: 34, zoneId: 'black-lands', instanceId: 1, tone: 'shadow', activity: 'mining' },
  { id: 'raven', name: 'Raven', level: 31, zoneId: 'black-lands', instanceId: 1, tone: 'red', activity: 'walking' }
];

const populations = { 'ancient-forest': [8, 6], 'abandoned-mine': [12, 9], 'royal-fields': [7, 5], 'red-desert': [5, 3], 'frozen-mountains': [4, 2], 'black-lands': [3, 2] };
const zoneInstances = Object.fromEntries(Object.entries(zones).map(([zoneId, zone]) => [zoneId, populations[zoneId].map((population, index) => ({ id: index + 1, population, capacity: zone.capacity }))]));

const defaultState = {
  resources: { wood: 1240, stone: 860, ore: 415, food: 92 },
  location: { zoneId: 'abandoned-mine', instanceId: 1 },
  party: null,
  followingPlayerId: null,
  pending: 7,
  progress: 35,
  eventProgress: 67,
  lastUpdatedAt: Date.now()
};

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(defaultState));
}

// Este gateway concentra estado, presença, viagem e escolha de instância. A UI
// poderá trocar esta implementação local por API/WebSocket sem mudar de contrato.
const gameGateway = {
  loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem('notag-frontier-state'));
      if (!saved?.resources) return cloneDefaultState();
      const legacyZones = { wood: 'ancient-forest', stone: 'abandoned-mine', ore: 'abandoned-mine', food: 'royal-fields' };
      const zoneId = zones[saved.location?.zoneId] ? saved.location.zoneId : (legacyZones[saved.activity] || defaultState.location.zoneId);
      const elapsedMinutes = Math.min(480, Math.max(0, (Date.now() - Number(saved.lastUpdatedAt || Date.now())) / 60000));
      return {
        ...cloneDefaultState(), ...saved,
        location: { zoneId, instanceId: Number(saved.location?.instanceId || 1) },
        pending: Number(saved.pending || 0) + elapsedMinutes * zones[zoneId].rate,
        lastUpdatedAt: Date.now()
      };
    } catch { return cloneDefaultState(); }
  },
  saveState(value) { localStorage.setItem('notag-frontier-state', JSON.stringify(value)); },
  selectInstance(zoneId, options = {}) {
    const instances = zoneInstances[zoneId];
    const preferredIds = [...(options.partyMemberIds || []), options.followPlayerId].filter(Boolean);
    const preferredPlayers = simulatedPlayers.filter((player) => preferredIds.includes(player.id) && player.zoneId === zoneId);
    const preferred = instances.find((instance) => preferredPlayers.some((player) => player.instanceId === instance.id) && instance.population < instance.capacity);
    return preferred || instances.filter((instance) => instance.population < instance.capacity).sort((a, b) => b.population - a.population)[0] || instances[0];
  },
  travel(zoneId, options = {}) { return { zoneId, instanceId: this.selectInstance(zoneId, options).id }; },
  playersAt(location) { return simulatedPlayers.filter((player) => player.zoneId === location.zoneId && player.instanceId === location.instanceId); },
  subscribePresence(onUpdate) {
    const messages = [
      ['RobertXVII', 'encontrou um cristal instável!'],
      ['Naga', 'está reunindo uma party de viagem.'],
      ['Horsix', 'ganhou +12% de bônus de grupo.']
    ];
    let index = 0;
    return window.setInterval(() => { onUpdate(messages[index % messages.length]); index += 1; }, 13000);
  }
};

const state = gameGateway.loadState();
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const resourceNodes = Object.fromEntries(Object.keys(defaultState.resources).map((key) => [key, document.querySelector(`#resource-${key}`)]));
const rateNodes = Object.fromEntries(Object.keys(defaultState.resources).map((key) => [key, document.querySelector(`#rate-${key}`)]));
const pendingNode = document.querySelector('#pending-value');
const pendingLabelNode = document.querySelector('#pending-label');
const progressNode = document.querySelector('#farm-progress-fill');
const zoneNode = document.querySelector('#zone-name');
const zoneSafetyNode = document.querySelector('#zone-safety');
const zoneActivityNode = document.querySelector('#zone-activity');
const weatherNameNode = document.querySelector('#weather-name');
const weatherIconNode = document.querySelector('#weather-icon');
const farmLabelNode = document.querySelector('#farm-label');
const toolIconNode = document.querySelector('#tool-icon');
const instanceNameNode = document.querySelector('#instance-name');
const instanceCapacityNode = document.querySelector('#instance-capacity');
const activityList = document.querySelector('#activity-list');
const chatMessages = document.querySelector('#chat-messages');
const playersLayer = document.querySelector('#players-layer');
const worldMessage = document.querySelector('#world-message');
const toast = document.querySelector('#game-toast');
let toastTimer;
let travelling = false;

function currentZone() { return zones[state.location.zoneId]; }
function currentInstance() { return zoneInstances[state.location.zoneId].find((instance) => instance.id === state.location.instanceId) || zoneInstances[state.location.zoneId][0]; }

function createPlayer(player, slot) {
  const wrapper = document.createElement('div');
  wrapper.className = `player player-slot-${slot} player-tone-${player.tone || 'gold'} ${player.activity || 'mining'}`;
  wrapper.dataset.playerId = player.id;
  const nameplate = document.createElement('span');
  nameplate.className = 'nameplate';
  if (player.id === 'you') {
    const you = document.createElement('b');
    you.textContent = 'VOCÊ';
    nameplate.append(you, document.createTextNode(' '));
  } else {
    nameplate.append(document.createTextNode(`${player.name} `));
  }
  const level = document.createElement('i');
  level.textContent = String(player.level);
  nameplate.append(level);
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  wrapper.append(nameplate, avatar);
  if (player.id === 'you') {
    wrapper.classList.add('player-you');
    const hit = document.createElement('small');
    hit.className = 'hit';
    hit.textContent = '+1';
    wrapper.append(hit);
  }
  return wrapper;
}

function renderPlayers() {
  playersLayer.replaceChildren();
  const visiblePlayers = [{ id: 'you', name: 'VOCÊ', level: 12, tone: 'gold', activity: 'mining' }, ...gameGateway.playersAt(state.location).slice(0, 3)];
  visiblePlayers.forEach((player, index) => playersLayer.append(createPlayer(player, index + 1)));
}

function render() {
  const zone = currentZone();
  const instance = currentInstance();
  Object.entries(state.resources).forEach(([key, value]) => { resourceNodes[key].textContent = number.format(Math.floor(value)); });
  Object.keys(rateNodes).forEach((key) => { rateNodes[key].textContent = key === zone.resource ? `+${zone.rate}/min` : '+0/min'; });
  pendingNode.textContent = number.format(Math.floor(state.pending));
  pendingLabelNode.textContent = zone.resourceLabel;
  progressNode.style.width = `${state.progress}%`;
  zoneNode.textContent = zone.name;
  zoneSafetyNode.textContent = zone.safety;
  zoneActivityNode.textContent = zone.activity;
  weatherNameNode.textContent = zone.weather;
  weatherIconNode.textContent = zone.weatherIcon;
  farmLabelNode.textContent = zone.action;
  toolIconNode.textContent = zone.tool;
  instanceNameNode.textContent = `${zone.shortName} #${instance.id}`;
  instanceCapacityNode.textContent = `${instance.population}/${instance.capacity}`;
  document.querySelector('#local-online').textContent = String(instance.population);
  document.querySelector('#pixel-world').dataset.zone = state.location.zoneId;
  activityList.querySelectorAll('button').forEach((button) => button.classList.toggle('active', button.dataset.zone === state.location.zoneId));
  renderPlayers();
  gameGateway.saveState(state);
}

function notify(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2500);
}

function addChat(name, message, system = false) {
  const paragraph = document.createElement('p');
  if (system) paragraph.className = 'system';
  const author = document.createElement('b');
  const text = document.createElement('span');
  author.textContent = name;
  text.textContent = message;
  if (!system) author.className = name === 'VOCÊ' ? 'chat-you' : 'chat-player';
  paragraph.append(author, text);
  chatMessages.append(paragraph);
  while (chatMessages.children.length > 18) chatMessages.firstElementChild.remove();
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function settlePending() {
  const collected = Math.floor(state.pending);
  if (collected > 0) state.resources[currentZone().resource] += collected;
  state.pending = 0;
}

function travelTo(zoneId) {
  if (travelling || !zones[zoneId] || zoneId === state.location.zoneId) return;
  travelling = true;
  settlePending();
  const destination = gameGateway.travel(zoneId, { partyMemberIds: state.party?.memberIds || [], followPlayerId: state.followingPlayerId });
  document.querySelector('#pixel-world').classList.add('is-travelling');
  window.setTimeout(() => {
    const previousZone = currentZone().name;
    state.location = destination;
    state.progress = 0;
    document.querySelector('#pixel-world').classList.remove('is-travelling');
    travelling = false;
    render();
    addChat('SISTEMA', `Você saiu de ${previousZone} e entrou em ${currentZone().name} #${destination.instanceId}.`, true);
    notify(`Você chegou a ${currentZone().name}.`);
  }, 420);
}

activityList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-zone]');
  if (button) travelTo(button.dataset.zone);
});

document.querySelector('#collect-button').addEventListener('click', () => {
  const collected = Math.floor(state.pending);
  if (collected < 1) return notify('Continue farmando para acumular recursos.');
  const zone = currentZone();
  state.resources[zone.resource] += collected;
  state.pending -= collected;
  render();
  notify(`+${number.format(collected)} ${zone.resourceLabel} coletado!`);
});

document.querySelector('#event-button').addEventListener('click', () => {
  if (state.resources.stone < 500) return notify('Você precisa de 500 pedras para contribuir.');
  state.resources.stone -= 500;
  state.eventProgress = Math.min(100, state.eventProgress + 1);
  document.querySelector('#event-fill').style.width = `${state.eventProgress}%`;
  document.querySelector('.event-progress span b').textContent = `${state.eventProgress}%`;
  addChat('SISTEMA', 'Você contribuiu com 500 pedras para o Colosso.', true);
  render();
  notify('Contribuição enviada ao evento global!');
});

document.querySelector('#chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.querySelector('#chat-input');
  const message = input.value.trim();
  if (!message) return;
  addChat('VOCÊ', message);
  input.value = '';
});

let secondsRemaining = 4 * 3600 + 27 * 60 + 18;
window.setInterval(() => {
  state.pending += currentZone().rate / 60;
  state.progress = (state.progress + 4) % 100;
  state.lastUpdatedAt = Date.now();
  secondsRemaining = Math.max(0, secondsRemaining - 1);
  const hours = Math.floor(secondsRemaining / 3600);
  const minutes = Math.floor((secondsRemaining % 3600) / 60);
  const seconds = secondsRemaining % 60;
  document.querySelector('#event-timer').textContent = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  render();
}, 1000);

gameGateway.subscribePresence(([name, message]) => {
  worldMessage.replaceChildren();
  const prefix = document.createElement('span');
  const highlight = document.createElement('b');
  prefix.textContent = `${name} `;
  highlight.textContent = message;
  worldMessage.append(prefix, highlight);
  addChat('SISTEMA', `${name} ${message}`, true);
});

window.NotagFrontier = { zones, gameGateway };
document.querySelector('#event-fill').style.width = `${state.eventProgress}%`;
document.querySelector('.event-progress span b').textContent = `${state.eventProgress}%`;
render();
