(() => {
  const storageKey = 'notag-rotina-checklist-v1';
  const checks = [...document.querySelectorAll('[data-task]')];
  const progressText = document.querySelector('#progress-text');
  const progressBar = document.querySelector('#progress-bar');
  const toast = document.querySelector('#toast');
  const todoStorageKey = 'notag-rotina-todos-v1';

  const showToast = (message) => {
    toast.textContent = message;
    toast.classList.add('visible');
    window.setTimeout(() => toast.classList.remove('visible'), 1800);
  };

  const readSaved = () => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); }
    catch { return {}; }
  };

  const updateProgress = () => {
    const completed = checks.filter((check) => check.checked).length;
    progressText.textContent = `${completed} de ${checks.length}`;
    progressBar.style.width = `${(completed / checks.length) * 100}%`;
  };

  const save = () => {
    const state = Object.fromEntries(checks.map((check) => [check.dataset.task, check.checked]));
    localStorage.setItem(storageKey, JSON.stringify(state));
    updateProgress();
  };

  const saved = readSaved();
  checks.forEach((check) => {
    check.checked = Boolean(saved[check.dataset.task]);
    check.addEventListener('change', save);
  });
  updateProgress();

  document.querySelector('#reset-checklist').addEventListener('click', () => {
    checks.forEach((check) => { check.checked = false; });
    save();
  });

  document.querySelector('#today').textContent = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'short'
  }).format(new Date());

  const initialTasks = [
    { id: 'seed-caxa', title: 'Falar com Caxa sobre compradores de loot do WB', type: 'lembrete', status: 'todo' },
    { id: 'seed-tabs', title: 'Oferecer as tabs completas antes de vender item por item', type: 'rotina', status: 'doing' },
    { id: 'seed-hlinha', title: 'Usar a conta Hlinha somente para vendas em Caerleon', type: 'lembrete', status: 'todo' },
    { id: 'seed-separar', title: 'Separar tiers baixos, encantamento e itens para Royal', type: 'rotina', status: 'todo' }
  ];

  const readTasks = () => {
    try {
      const savedTasks = JSON.parse(localStorage.getItem(todoStorageKey));
      return Array.isArray(savedTasks) ? savedTasks : initialTasks;
    } catch {
      return initialTasks;
    }
  };

  let tasks = readTasks();
  const statuses = ['todo', 'doing', 'done'];
  const statusLabels = { todo: 'A fazer', doing: 'Fazendo', done: 'Feito' };
  const typeLabels = { tarefa: 'Tarefa', rotina: 'Rotina', lembrete: 'Lembrete' };

  const saveTasks = () => localStorage.setItem(todoStorageKey, JSON.stringify(tasks));

  const renderFocusList = (type, selector) => {
    const list = document.querySelector(selector);
    const matches = tasks.filter((task) => task.type === type && task.status !== 'done');
    list.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement('p');
      empty.className = 'focus-empty';
      empty.textContent = type === 'rotina' ? 'Nenhuma rotina pendente.' : 'Nenhum lembrete pendente.';
      list.append(empty);
      return;
    }
    matches.forEach((task) => {
      const row = document.createElement('div');
      row.className = 'focus-row';
      row.textContent = task.title;
      list.append(row);
    });
  };

  const moveTask = (id, direction) => {
    tasks = tasks.map((task) => {
      if (task.id !== id) return task;
      const current = statuses.indexOf(task.status);
      const next = Math.max(0, Math.min(statuses.length - 1, current + direction));
      return { ...task, status: statuses[next] };
    });
    saveTasks();
    renderTasks();
  };

  const createTaskCard = (task) => {
    const card = document.createElement('article');
    card.className = `task-card${task.status === 'done' ? ' is-done' : ''}`;

    const meta = document.createElement('div');
    meta.className = 'task-meta';
    const type = document.createElement('span');
    type.className = `task-type ${task.type}`;
    type.textContent = typeLabels[task.type] || 'Tarefa';
    const remove = document.createElement('button');
    remove.className = 'task-delete';
    remove.type = 'button';
    remove.setAttribute('aria-label', `Excluir ${task.title}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      tasks = tasks.filter((item) => item.id !== task.id);
      saveTasks();
      renderTasks();
      showToast('Item excluído');
    });
    meta.append(type, remove);

    const title = document.createElement('p');
    title.className = 'task-title';
    title.textContent = task.title;

    const actions = document.createElement('div');
    actions.className = 'task-actions';
    const current = statuses.indexOf(task.status);
    if (current > 0) {
      const previous = document.createElement('button');
      previous.type = 'button';
      previous.textContent = `← ${statusLabels[statuses[current - 1]]}`;
      previous.addEventListener('click', () => moveTask(task.id, -1));
      actions.append(previous);
    }
    if (current < statuses.length - 1) {
      const next = document.createElement('button');
      next.className = 'next';
      next.type = 'button';
      next.textContent = `${statusLabels[statuses[current + 1]]} →`;
      next.addEventListener('click', () => moveTask(task.id, 1));
      actions.append(next);
    }

    card.append(meta, title, actions);
    return card;
  };

  function renderTasks() {
    statuses.forEach((status) => {
      const list = document.querySelector(`[data-list="${status}"]`);
      const matches = tasks.filter((task) => task.status === status);
      list.replaceChildren();
      document.querySelector(`[data-count="${status}"]`).textContent = matches.length;
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'task-empty';
        empty.textContent = status === 'done' ? 'Conclua uma tarefa para ela aparecer aqui.' : 'Nenhum item nesta etapa.';
        list.append(empty);
      } else {
        matches.forEach((task) => list.append(createTaskCard(task)));
      }
    });
    renderFocusList('rotina', '#routine-list');
    renderFocusList('lembrete', '#reminder-list');
  }

  document.querySelector('#todo-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') || '').trim();
    if (!title) return;
    tasks.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      type: String(form.get('type') || 'tarefa'),
      status: 'todo'
    });
    saveTasks();
    renderTasks();
    event.currentTarget.reset();
    document.querySelector('#todo-title').focus();
    showToast('Item adicionado em A fazer');
  });

  renderTasks();

  const summary = [
    'ROTINA DE LOOT · NOTAG',
    '',
    '• Vender a tab inteira para membro ou comprador de loot do WB; evitar item por item.',
    '• Aba 04: ficam 4.0 e 4.1; runas e almas vão para encantar; 4.2 e 4.3 vão para Royal.',
    '• Aba 05: fica 5.0; runas T5 vão para encantar; 5.2 e 5.3 vão para Royal.',
    '• Falar com Caxa sobre compradores recorrentes de loot do WB.',
    '• Usar a conta Hlinha somente para vendas em Caerleon.'
  ].join('\n');

  document.querySelector('#copy-summary').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(summary);
      showToast('Resumo copiado');
    } catch {
      showToast('Não foi possível copiar');
    }
  });
})();
