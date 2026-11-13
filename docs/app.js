const sections = [
  { id: 'inicio', label: 'Inicio', color: '#0f766e' },
  { id: 'mapa', label: 'Mapa rapido', color: '#2563eb' },
  { id: 'fluxos', label: 'Fluxos', color: '#15803d' },
  { id: 'comandos', label: 'Comandos', color: '#b7791f' },
  { id: 'permissoes', label: 'Permissoes', color: '#b42318' },
  { id: 'operacao', label: 'Operacao', color: '#6d5bd0' },
  { id: 'memoria', label: 'A confirmar', color: '#475467' }
];

const mapCards = [
  {
    icon: 'EV',
    title: 'Eventos',
    text: 'Crie content, gerencie vagas, inicie sala de voz, finalize e mande para revisao de loot.',
    tags: ['caller', 'staff', 'loot split']
  },
  {
    icon: 'SL',
    title: 'Saldos',
    text: 'Consulte, deposite, pague eventos, aprove saques e acompanhe historico financeiro.',
    tags: ['tesouraria', 'saldo', 'pagamento']
  },
  {
    icon: 'RC',
    title: 'Recrutamento',
    text: 'Registre nick Albion, aprove membro ou convidado e sincronize Discord x Albion.',
    tags: ['recrutador', 'registro', 'guild']
  },
  {
    icon: 'MB',
    title: 'Membros',
    text: 'Liste membros, convidados, pendentes, sem tag, inativos e atividade de voz.',
    tags: ['staff', 'inativos', 'relatorio']
  },
  {
    icon: 'AB',
    title: 'Albion semanal',
    text: 'Importe rank PvE, logs da guild e confira resumo semanal com previa antes de salvar.',
    tags: ['rank pve', 'logs', 'csv']
  },
  {
    icon: 'OP',
    title: 'Operacao',
    text: 'Rode local no VS Code, publique comandos, atualize paineis e cuide dos backups.',
    tags: ['vscode', 'discloud', 'backup']
  }
];

const flowSteps = [
  {
    title: 'Criar evento',
    text: 'Staff, caller ou recrutador usa o painel Criar Evento. O bot pede nome do content, local, horario, build e vagas.',
    checklist: ['Use exemplos claros: DG Grupo T8+, HO Loch, T8 equivalente.', 'Vagas seguem a ordem Tank, Healer, Suporte, DPS.', 'Raid Full usa fluxo proprio com composicao de 20 vagas.']
  },
  {
    title: 'Preencher vagas',
    text: 'Membros clicam na funcao ou arma. O bot atualiza a mensagem do evento e mostra ocupados/livres.',
    checklist: ['Membro pode assistir como espectador.', 'Na Raid Full, cada jogador escolhe arma e informa IP.', 'Caller acompanha se a composicao esta fechando.']
  },
  {
    title: 'Iniciar',
    text: 'Ao clicar em Iniciar, o bot abre sala de voz e passa a contar participacao.',
    checklist: ['O bot acompanha entrada e saida da call.', 'Eventos proximos podem gerar cargo temporario de aviso.', 'Se o bot reiniciar, eventos em andamento podem ir para revisao.']
  },
  {
    title: 'Finalizar e informar loot',
    text: 'Caller finaliza e informa loot total, reparo, sacos de prata, taxa e observacoes.',
    checklist: ['Valores aceitam formatos como 10m, 500k ou 12000000.', 'O bot calcula loot liquido.', 'Um canal de revisao e criado para ajustes.']
  },
  {
    title: 'Revisar split',
    text: 'Staff ajusta membros, funcoes e minutos antes de enviar ao financeiro.',
    checklist: ['Adicionar quem participou e nao clicou.', 'Remover espectador que entrou errado no split.', 'Registrar motivo do ajuste para auditoria.']
  },
  {
    title: 'Aprovar e pagar',
    text: 'Tesouraria ou staff aprova o financeiro. O bot deposita saldo e registra transacoes.',
    checklist: ['Conferir valores antes de aprovar.', 'Pagamento aprovado alimenta historico financeiro.', 'Carreira por arma/classe pode ser atualizada.']
  }
];

const commands = [
  ['slash', '/setup', 'Atualiza paineis fixos do bot.', 'staff adm treasurer'],
  ['slash', '/saldo', 'Consulta seu saldo ou, para staff/tesouraria, saldo de outro membro.', 'member staff treasurer'],
  ['slash', '/registro', 'Abre registro de nick Albion.', 'member'],
  ['slash', '/objetivo', 'Avisa objetivo temporario no chat Notag.', 'member staff caller'],
  ['slash', '/exportar', 'Exporta saldos, financeiro, voz, auditoria, Albion e membros.', 'staff treasurer'],
  ['slash', '/importar', 'Importa CSV de saldos com previa e confirmacao.', 'staff treasurer'],
  ['slash', '/sincronizar_albion', 'Sincroniza Discord x Albion por CSV/TSV.', 'staff recruiter'],
  ['slash', '/inativos', 'Gera previa de Membro -> Convidado ou Convidado -> Sem Tag.', 'staff recruiter'],
  ['slash', '/albion', 'Importa rank PvE, logs e mostra resumo semanal.', 'staff treasurer'],
  ['slash', '/relatorio_diario', 'Compara membros Albion e voz Discord.', 'staff treasurer'],
  ['slash', '/renomear_canais', 'Mostra ou aplica padronizacao de canais.', 'staff adm'],
  ['slash', '/auditar_canais', 'Lista canais e marca os conhecidos pelo bot.', 'staff adm'],
  ['painel', 'Criar Evento', 'Botoes Criar Evento e Raid Full.', 'caller staff recruiter'],
  ['painel', 'Saldo', 'Consultar, sacar e pedir pagamento.', 'member staff treasurer'],
  ['painel', 'ADM', 'Pendencias, financeiro, Albion, eventos, membros, arquivos e tutorial.', 'staff adm treasurer'],
  ['painel', 'Deposito', 'Deposito manual ou por lista.', 'staff treasurer'],
  ['painel', 'Lista de membros', 'Atualizar, exportar CSV e filtrar membros.', 'staff recruiter'],
  ['painel', 'Painel do membro', 'Perfil e historico basico.', 'member']
];

const permissions = [
  ['createEvent', ['caller', 'staff', 'adm', 'recruiter'], 'Criar evento normal ou Raid Full.'],
  ['createObjective', ['member', 'caller', 'staff', 'adm', 'recruiter', 'treasurer'], 'Avisar objetivo.'],
  ['approvePayment', ['staff', 'adm', 'treasurer'], 'Aprovar pagamento, setup e rotinas sensiveis.'],
  ['importCsv', ['staff', 'adm', 'treasurer'], 'Importar/exportar CSV e relatorios.'],
  ['withdrawBalance', ['staff', 'adm', 'treasurer'], 'Consultar outro saldo e retirar saldo.'],
  ['approveRegistration', ['staff', 'adm', 'recruiter'], 'Aprovar registro, sincronizar Albion e inativos.'],
  ['assumeEvent', ['staff', 'caller', 'treasurer', 'recruiter', 'adm'], 'Assumir e editar evento de outro criador.']
];

const ops = [
  ['Rodar local', 'Use no VS Code depois de preencher .env.', 'npm start'],
  ['Registrar comandos', 'Rode quando mudar definitions.js.', 'npm run deploy:commands'],
  ['Atualizar paineis', 'Use dentro do Discord para recriar mensagens fixas.', '/setup'],
  ['Backup manual', 'Cria copia do banco SQLite.', 'npm run backup:db'],
  ['Restore manual', 'Pare o bot e confira o backup antes.', 'npm run restore:db'],
  ['Auditar canais', 'Confere IDs conhecidos pelo bot.', '/auditar_canais']
];

const openQuestions = [
  'Funcionalidades antigas removidas: dashboard, leiloes, enquetes, FAQ, OCR e jogo de frutas.',
  'Confirmar se existem variaveis secretas alem de .env.example.',
  'Confirmar se o bot tem permissao administrativa completa no Discord.',
  'Definir politica oficial de backup e restore em producao.',
  'Mapear todos os arquivos que contem dados reais da guild.'
];

let currentStep = 0;
let currentCommandTab = 'todos';

function init() {
  renderNav();
  renderCards();
  renderFlow();
  renderCommands();
  renderPermissions();
  renderOps();
  renderOpenQuestions();
  bindEvents();
}

function renderNav() {
  const nav = document.querySelector('#nav');
  nav.innerHTML = sections.map((section) => `
    <button class="nav-item" type="button" data-jump="${section.id}">
      <span style="background:${section.color}"></span>
      <strong>${section.label}</strong>
    </button>
  `).join('');
}

function renderCards() {
  document.querySelector('#mapCards').innerHTML = mapCards.map((card) => `
    <article class="card searchable" data-search="${searchText(card.title, card.text, card.tags.join(' '))}">
      <div class="card-top">
        <div class="icon-box">${card.icon}</div>
        <div>
          <h3>${card.title}</h3>
          <small>${card.tags.join(' / ')}</small>
        </div>
      </div>
      <p>${card.text}</p>
      <div class="tag-row">${card.tags.map((tag) => `<span class="tag">${tag}</span>`).join('')}</div>
    </article>
  `).join('');
}

function renderFlow() {
  document.querySelector('#flowSteps').innerHTML = flowSteps.map((step, index) => `
    <button class="step-button ${index === currentStep ? 'active' : ''}" type="button" data-step="${index}">
      <span class="step-count">${index + 1}</span>
      <strong>${step.title}</strong>
    </button>
  `).join('');
  const step = flowSteps[currentStep];
  document.querySelector('#stepDetail').innerHTML = `
    <h3>${step.title}</h3>
    <p>${step.text}</p>
    <ul>${step.checklist.map((item) => `<li>${item}</li>`).join('')}</ul>
  `;
}

function renderCommands() {
  const tabs = ['todos', 'slash', 'painel'];
  document.querySelector('#commandTabs').innerHTML = tabs.map((tab) => `
    <button class="tab-button ${tab === currentCommandTab ? 'active' : ''}" type="button" data-command-tab="${tab}">
      ${tab}
    </button>
  `).join('');
  filterCommands();
}

function filterCommands() {
  const query = normalize(document.querySelector('#commandSearch')?.value || '');
  const role = document.querySelector('#roleFilter')?.value || 'todos';
  const rows = commands.filter(([type, name, desc, roles]) => {
    const matchesTab = currentCommandTab === 'todos' || type === currentCommandTab;
    const matchesRole = role === 'todos' || roles.includes(role);
    const matchesQuery = !query || normalize(`${type} ${name} ${desc} ${roles}`).includes(query);
    return matchesTab && matchesRole && matchesQuery;
  });
  document.querySelector('#commandList').innerHTML = rows.length ? rows.map(([type, name, desc, roles]) => `
    <article class="command-card searchable" data-search="${searchText(type, name, desc, roles)}">
      <div>
        <div class="command-name">${name}</div>
        <div class="command-meta">${type}</div>
      </div>
      <p>${desc}</p>
      <code>${roles}</code>
    </article>
  `).join('') : '<article class="note-panel">Nenhum comando encontrado para este filtro.</article>';
}

function renderPermissions() {
  const role = document.querySelector('#roleFilter')?.value || 'todos';
  const rows = permissions.filter(([, roles]) => role === 'todos' || roles.includes(role));
  document.querySelector('#permissionGrid').innerHTML = rows.map(([action, roles, desc]) => `
    <article class="permission-card searchable" data-search="${searchText(action, roles.join(' '), desc)}">
      <h3>${action}</h3>
      <p>${desc}</p>
      <div class="role-list">${roles.map((item) => `<span class="role-pill role-${item}">${item}</span>`).join('')}</div>
    </article>
  `).join('');
}

function renderOps() {
  document.querySelector('#opsGrid').innerHTML = ops.map(([title, text, command]) => `
    <article class="ops-card searchable" data-search="${searchText(title, text, command)}">
      <h3>${title}</h3>
      <p>${text}</p>
      <code>${command}</code>
    </article>
  `).join('');
}

function renderOpenQuestions() {
  document.querySelector('#openQuestions').innerHTML = openQuestions.map((item) => `<li>${item}</li>`).join('');
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const jump = event.target.closest('[data-jump]');
    if (jump) scrollToSection(jump.dataset.jump);

    const step = event.target.closest('[data-step]');
    if (step) {
      currentStep = Number(step.dataset.step);
      renderFlow();
    }

    const tab = event.target.closest('[data-command-tab]');
    if (tab) {
      currentCommandTab = tab.dataset.commandTab;
      renderCommands();
    }
  });

  document.querySelector('#commandSearch').addEventListener('input', filterCommands);
  document.querySelector('#roleFilter').addEventListener('change', () => {
    filterCommands();
    renderPermissions();
  });
  document.querySelector('#globalSearch').addEventListener('input', applyGlobalSearch);
  document.addEventListener('scroll', markActiveNav, { passive: true });
}

function applyGlobalSearch(event) {
  const query = normalize(event.target.value);
  document.querySelectorAll('.searchable').forEach((node) => {
    node.classList.toggle('hidden', Boolean(query) && !normalize(node.dataset.search).includes(query));
  });
}

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function markActiveNav() {
  const visible = sections
    .map((section) => {
      const rect = document.getElementById(section.id)?.getBoundingClientRect();
      return { id: section.id, top: rect ? Math.abs(rect.top) : 9999 };
    })
    .sort((a, b) => a.top - b.top)[0]?.id;
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.jump === visible);
  });
}

function searchText(...parts) {
  return parts.join(' ');
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

init();
