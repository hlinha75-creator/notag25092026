(function () {
  if (typeof document === 'undefined') return;
  const model = globalThis.NotagPlanoModel;
  if (!model) return;

  const sections = [
    ['visao', 'Visão geral'],
    ['concorrentes', 'Concorrentes'],
    ['ecossistema', 'Ecossistema'],
    ['pessoa', 'Uma pessoa com IA'],
    ['arquitetura', 'Arquitetura'],
    ['marketplace', 'Marketplace'],
    ['verificacao', 'Verificação'],
    ['pagamentos', 'Pagamentos'],
    ['tributos', 'Tributos'],
    ['custos', 'Custos'],
    ['planos', 'Planos'],
    ['marketing', 'Marketing'],
    ['roadmap', '90 dias'],
    ['riscos', 'Riscos'],
    ['painel', 'Painel']
  ];

  const hourLabels = {
    desenvolvimento: 'Desenvolvimento',
    testes: 'Testes',
    marketing: 'Marketing',
    atendimento: 'Atendimento',
    administracao: 'Administração',
    planejamento: 'Planejamento'
  };
  const hourColors = ['#8ea2ff', '#e7c98a', '#8fd0c4', '#f0a3c2', '#d7d2c4', '#9ddec0'];

  const dashboard = {
    7: { players: 128, servers: 1, published: 9, completed: 7, signups: 86, active: 54, paying: 0, revenue: 0, costs: 420, support: 3, incidents: 1 },
    30: { players: 310, servers: 1, published: 36, completed: 29, signups: 240, active: 120, paying: 0, revenue: 0, costs: 1680, support: 11, incidents: 2 },
    90: { players: 640, servers: 2, published: 110, completed: 84, signups: 720, active: 210, paying: 6, revenue: 189.4, costs: 5200, support: 18, incidents: 4 }
  };

  const refundSteps = [
    'Valor combinado ainda com o comprador. Nada foi capturado.',
    'Pagamento autorizado no exemplo. A retenção, se existir, depende do contrato do provedor. Split não é garantia automática.',
    'Reembolso parcial fictício de 40% do valor da venda voltando ao comprador. A taxa do processador pode não voltar.',
    'Reembolso total fictício do valor da venda. Comissão da NOTAG neste exemplo também volta. Confirme a regra real no contrato.'
  ];

  function init() {
    const progress = document.querySelector('[data-progress-label]');
    const main = document.querySelector('.plan-main');
    if (!main) return;
    document.documentElement.style.setProperty('--progress', '0');
    bindFilters();
    bindHours();
    bindPayment();
    bindCosts();
    bindRevenue();
    bindMarketing();
    bindRoadmap();
    bindDashboard();
    bindRefund();
    bindSlots();
    bindServiceJumps();
    bindKyc();
    document.querySelectorAll('form').forEach((form) => form.addEventListener('submit', (event) => event.preventDefault()));
    window.addEventListener('scroll', () => updateProgress(progress), { passive: true });
    updateProgress(progress);
  }

  function updateProgress(progress) {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
    document.documentElement.style.setProperty('--progress', String(ratio));
    const line = window.scrollY + Math.min(160, window.innerHeight * 0.28);
    let index = 0;
    sections.forEach(([id], item) => {
      const node = document.getElementById(id);
      if (node && node.offsetTop <= line) index = item;
    });
    document.querySelectorAll('.plan-nav a[href^="#"]').forEach((link) => {
      link.setAttribute('aria-current', link.getAttribute('href') === `#${sections[index][0]}` ? 'true' : 'false');
    });
    if (progress) progress.textContent = `Seção ${index + 1} de ${sections.length}: ${sections[index][1]}`;
  }

  function bindFilters() {
    const rows = [...document.querySelectorAll('#comparison-table tbody tr')];
    document.querySelectorAll('[data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        const filter = button.getAttribute('data-filter');
        document.querySelectorAll('[data-filter]').forEach((item) => item.setAttribute('aria-pressed', item === button ? 'true' : 'false'));
        rows.forEach((row) => {
          const areas = (row.getAttribute('data-areas') || '').split(/\s+/);
          row.hidden = filter !== 'todos' && !areas.includes(filter);
        });
        const status = document.querySelector('[data-filter-status]');
        if (status) status.textContent = filter === 'todos' ? 'Mostrando todas as capacidades.' : `Filtro ativo: ${button.textContent.trim()}. O que não está na fonte fica como desconhecido.`;
      });
    });
  }

  function bindHours() {
    const inputs = [...document.querySelectorAll('[data-hour]')];
    if (!inputs.length) return;
    let state = { ...model.DEFAULT_HOURS };
    const render = () => {
      inputs.forEach((input) => {
        const key = input.getAttribute('data-hour');
        input.value = String(state[key]);
        const out = document.querySelector(`[data-hour-out="${key}"]`);
        if (out) out.textContent = `${model.formatCount(state[key])} h`;
      });
      const total = model.HOUR_KEYS.reduce((sum, key) => sum + state[key], 0);
      const totalNode = document.querySelector('[data-hour-total]');
      if (totalNode) totalNode.textContent = `${model.formatCount(total)} h de ${model.WEEKLY_HOURS} h`;
      drawHours(state);
    };
    inputs.forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.getAttribute('data-hour');
        state = model.rebalanceHours(state, key, input.value).hours;
        render();
      });
    });
    document.querySelectorAll('[data-hour-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        const preset = button.getAttribute('data-hour-preset');
        state = preset === 'equilibrio'
          ? { desenvolvimento: 6, testes: 6, marketing: 6, atendimento: 6, administracao: 6, planejamento: 6 }
          : { ...model.DEFAULT_HOURS };
        render();
      });
    });
    render();
  }

  function drawHours(state) {
    const svg = document.querySelector('[data-hour-donut]');
    const legend = document.querySelector('[data-hour-legend]');
    const bars = document.querySelector('[data-hour-bars]');
    if (!svg || !legend || !bars) return;
    const total = model.HOUR_KEYS.reduce((sum, key) => sum + state[key], 0) || 1;
    const radius = 16;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    svg.replaceChildren();
    const hole = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hole.setAttribute('cx', '21');
    hole.setAttribute('cy', '21');
    hole.setAttribute('r', '10');
    hole.setAttribute('fill', '#10131a');
    legend.replaceChildren();
    bars.replaceChildren();
    model.HOUR_KEYS.forEach((key, index) => {
      const value = state[key];
      const length = (value / total) * circumference;
      const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      arc.setAttribute('cx', '21');
      arc.setAttribute('cy', '21');
      arc.setAttribute('r', String(radius));
      arc.setAttribute('fill', 'none');
      arc.setAttribute('stroke', hourColors[index]);
      arc.setAttribute('stroke-width', '6');
      arc.setAttribute('stroke-dasharray', `${length} ${circumference - length}`);
      arc.setAttribute('stroke-dashoffset', String(-offset));
      arc.setAttribute('transform', 'rotate(-90 21 21)');
      svg.appendChild(arc);
      offset += length;
      const item = document.createElement('li');
      const swatch = document.createElement('i');
      swatch.className = `swatch-${index}`;
      item.append(swatch, document.createTextNode(`${hourLabels[key]}: ${model.formatCount(value)} h`));
      legend.appendChild(item);
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML = `<span>${hourLabels[key]}</span><span class="track"><i></i></span><b>${model.formatCount(value)} h</b>`;
      row.querySelector('i').style.setProperty('--share', String((value / model.WEEKLY_HOURS) * 100));
      bars.appendChild(row);
    });
    svg.appendChild(hole);
  }

  function field(id) {
    return document.getElementById(id);
  }

  function bindPayment() {
    const ids = ['pay-sale', 'pay-commission', 'pay-percent', 'pay-fixed', 'pay-payer'];
    if (!field('pay-sale')) return;
    const render = () => {
      const result = model.simulatePayment({
        sale: field('pay-sale').value,
        commissionPercent: field('pay-commission').value,
        percentFee: field('pay-percent').value,
        fixedFee: field('pay-fixed').value,
        feePayer: field('pay-payer').value
      });
      setText('pay-buyer', model.formatBrl(result.buyerPays));
      setText('pay-commission-out', model.formatBrl(result.commission));
      setText('pay-gross', model.formatBrl(result.sellerGross));
      setText('pay-fee', model.formatBrl(result.processorFee));
      setText('pay-seller', model.formatBrl(result.sellerNet));
      setText('pay-notag', model.formatBrl(result.notagNetBeforeTax));
      const note = document.querySelector('[data-pay-note]');
      if (note) {
        const who = { comprador: 'o comprador paga a taxa por fora do preço', vendedor: 'a taxa sai do bruto do vendedor', dividida: 'comprador e vendedor dividem a taxa' };
        note.textContent = `Simulação fictícia. Sobre ${model.formatBrl(result.sale)}, ${who[result.feePayer]}. O líquido da NOTAG mostrado é só a comissão, antes de imposto, e não absorve a taxa do processador.`;
      }
      document.querySelector('[data-refund]')?.setAttribute('data-sale', String(result.sale));
      document.querySelector('[data-refund]')?.setAttribute('data-commission', String(result.commission));
      document.querySelector('[data-refund]')?.setAttribute('data-fee', String(result.processorFee));
    };
    ids.forEach((id) => field(id).addEventListener('input', render));
    render();
  }

  function bindRefund() {
    const box = document.querySelector('[data-refund]');
    if (!box) return;
    let timer = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const paint = (step) => {
      const sale = Number(box.getAttribute('data-sale') || 100);
      const commission = Number(box.getAttribute('data-commission') || 10);
      const fee = Number(box.getAttribute('data-fee') || 0);
      let back = 0;
      if (step === 2) back = sale * 0.4;
      if (step === 3) back = sale;
      const keptSale = Math.max(0, sale - back);
      const keptCommission = step === 3 ? 0 : commission * (keptSale / (sale || 1));
      setText('refund-copy', refundSteps[step]);
      setText('refund-back', model.formatBrl(back));
      setText('refund-seller', model.formatBrl(Math.max(0, keptSale - keptCommission - (step === 0 ? 0 : fee))));
      setText('refund-notag', model.formatBrl(keptCommission));
      box.classList.toggle('is-playing', !reduced);
      box.setAttribute('data-step', String(step));
    };
    document.querySelectorAll('[data-refund-to]').forEach((button) => {
      button.addEventListener('click', () => {
        window.clearInterval(timer);
        const target = Number(button.getAttribute('data-refund-to'));
        if (reduced || button.hasAttribute('data-refund-jump')) {
          paint(target);
          return;
        }
        let step = 0;
        paint(0);
        timer = window.setInterval(() => {
          step += 1;
          paint(step);
          if (step >= target) window.clearInterval(timer);
        }, 700);
      });
    });
    paint(0);
  }

  function bindCosts() {
    if (!field('cost-setup')) return;
    const scenarios = {};
    for (const [key, value] of Object.entries(model.COST_SCENARIOS)) {
      scenarios[key] = {
        setup: value.setup,
        users: value.users,
        servers: value.servers,
        revenue: value.revenue,
        categories: { ...value.categories }
      };
    }
    let active = 'mvp';
    const read = () => {
      const current = scenarios[active];
      current.setup = model.parseNumber(field('cost-setup').value);
      current.users = model.parseNumber(field('cost-users').value);
      current.servers = model.parseNumber(field('cost-servers').value);
      current.revenue = model.parseNumber(field('cost-revenue').value);
      model.COST_KEYS.forEach((key) => {
        current.categories[key] = model.parseNumber(field(`cost-${key}`).value);
      });
    };
    const write = () => {
      const current = scenarios[active];
      field('cost-setup').value = String(current.setup);
      field('cost-users').value = String(current.users);
      field('cost-servers').value = String(current.servers);
      field('cost-revenue').value = String(current.revenue);
      model.COST_KEYS.forEach((key) => {
        field(`cost-${key}`).value = String(current.categories[key]);
      });
      const summary = model.summarizeCosts(current);
      setText('cost-month', model.formatBrl(summary.monthly));
      setText('cost-year', model.formatBrl(summary.annual));
      setText('cost-setup-out', model.formatBrl(summary.setup));
      setText('cost-user', summary.perUser == null ? 'Informe usuários' : model.formatBrl(summary.perUser));
      setText('cost-server', summary.perServer == null ? 'Informe servidores' : model.formatBrl(summary.perServer));
      setText('cost-result', model.formatBrl(summary.operatingResult));
      const even = document.querySelector('[data-cost-even]');
      if (even) {
        even.textContent = summary.breaksEven
          ? `A receita fictícia cobre o gasto mensal. O setup de ${model.formatBrl(summary.setup)} levaria cerca de ${model.formatCount(summary.monthsToRecoverSetup)} meses dessa sobra. Estimativa, não cotação.`
          : 'A receita fictícia ainda não cobre o gasto mensal. Não há equilíbrio neste cenário. Aumente a receita hipotética ou reduza um custo.';
      }
    };
    document.querySelectorAll('[data-scenario]').forEach((button) => {
      button.addEventListener('click', () => {
        read();
        active = button.getAttribute('data-scenario');
        document.querySelectorAll('[data-scenario]').forEach((item) => item.setAttribute('aria-pressed', item === button ? 'true' : 'false'));
        write();
      });
    });
    document.querySelector('#cost-form').addEventListener('input', () => { read(); write(); });
    write();
  }

  function bindRevenue() {
    if (!field('rev-free')) return;
    const render = () => {
      const result = model.simulateRevenue({
        free: field('rev-free').value,
        pro: field('rev-pro').value,
        business: field('rev-business').value,
        churnPercent: field('rev-churn').value,
        operatingCost: field('rev-cost').value,
        marketplace: field('rev-market').value
      });
      setText('rev-mrr', model.formatBrl(result.mrr));
      setText('rev-year', model.formatBrl(result.annualized));
      setText('rev-cost-out', model.formatBrl(result.operatingCost));
      setText('rev-result', model.formatBrl(result.result));
      setText('rev-after', model.formatBrl(result.mrrAfterChurn));
      setText('rev-break', `${model.formatCount(result.proEquivalents)} clientes Pro`);
      const note = document.querySelector('[data-rev-note]');
      if (note) note.textContent = `MRR fictício junta assinaturas e a comissão de marketplace digitada. O churn de ${model.formatCount(result.churnPercent)}% só reduz as assinaturas no mês seguinte; a comissão digitada permanece. Free não gera mensalidade. Não é previsão.`;
      drawRevenue(result);
    };
    ['rev-free', 'rev-pro', 'rev-business', 'rev-churn', 'rev-cost', 'rev-market'].forEach((id) => field(id).addEventListener('input', render));
    render();
  }

  function drawRevenue(result) {
    const host = document.querySelector('[data-rev-bars]');
    if (!host) return;
    const rows = [
      ['Assinaturas', result.subscription],
      ['Comissão digitada', result.marketplace],
      ['Custo operacional', result.operatingCost]
    ];
    const max = Math.max(...rows.map((row) => row[1]), 1);
    host.replaceChildren();
    rows.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML = `<span>${label}</span><span class="track"><i></i></span><b>${model.formatBrl(value)}</b>`;
      row.querySelector('i').style.setProperty('--share', String((value / max) * 100));
      host.appendChild(row);
    });
  }

  function bindMarketing() {
    if (!field('mkt-budget')) return;
    const render = () => {
      const result = model.simulateMarketing({
        budget: field('mkt-budget').value,
        cpc: field('mkt-cpc').value,
        signupRate: field('mkt-signup').value,
        activationRate: field('mkt-activation').value,
        retentionRate: field('mkt-retention').value,
        paidRate: field('mkt-paid').value
      });
      const stages = [
        ['Vídeo', null, 'A audiência orgânica não sai do orçamento.'],
        ['Clique', result.clicks],
        ['Site', result.clicks],
        ['Discord', result.signups],
        ['Participação', result.activations],
        ['Retenção', result.retained],
        ['Cliente pagante', result.paying]
      ];
      const host = document.querySelector('[data-funnel]');
      const max = Math.max(result.clicks, 1);
      if (host) {
        host.replaceChildren();
        stages.forEach(([label, value, hint]) => {
          const row = document.createElement('div');
          row.className = 'bar-row';
          const shown = value == null ? '—' : model.formatCount(value);
          row.innerHTML = `<span>${label}</span><span class="track"><i></i></span><b>${shown}</b>`;
          row.querySelector('i').style.setProperty('--share', value == null ? '0' : String(Math.max(4, (value / max) * 100)));
          if (hint) row.title = hint;
          host.appendChild(row);
        });
      }
      const note = document.querySelector('[data-mkt-note]');
      if (note) {
        note.textContent = result.costPerPaying == null
          ? 'Com estas hipóteses nenhum cliente pagante aparece. Isso também é um resultado possível. Não é previsão de campanha.'
          : `Custo hipotético por cliente pagante: ${model.formatBrl(result.costPerPaying)}. Cliques = orçamento ÷ CPC. As taxas são hipóteses suas, não histórico da NOTAG.`;
      }
    };
    ['mkt-budget', 'mkt-cpc', 'mkt-signup', 'mkt-activation', 'mkt-retention', 'mkt-paid'].forEach((id) => field(id).addEventListener('input', render));
    render();
  }

  function bindRoadmap() {
    const items = [...document.querySelectorAll('[data-task]')];
    if (!items.length) return;
    const storageKey = 'notag-plano-roadmap';
    let done = new Set();
    try {
      done = new Set(JSON.parse(sessionStorage.getItem(storageKey) || '[]'));
    } catch { done = new Set(); }
    const tasks = items.map((item) => ({
      id: item.getAttribute('data-task'),
      hours: model.parseNumber(item.getAttribute('data-hours')),
      deps: (item.getAttribute('data-deps') || '').split(/\s+/).filter(Boolean)
    }));
    const render = () => {
      items.forEach((item) => {
        const id = item.getAttribute('data-task');
        const button = item.querySelector('.check');
        const on = done.has(id);
        item.classList.toggle('is-done', on);
        if (button) {
          button.setAttribute('aria-pressed', on ? 'true' : 'false');
          button.textContent = on ? 'Concluída' : 'Marcar';
        }
        const task = tasks.find((entry) => entry.id === id);
        const warning = item.querySelector('[data-dep-warning]');
        if (warning && task) {
          const open = task.deps.filter((dep) => !done.has(dep));
          warning.hidden = open.length === 0;
          warning.textContent = open.length ? 'Dependência ainda aberta nesta lista.' : '';
        }
      });
      const summary = model.summarizeTasks(tasks, [...done]);
      setText('road-done', `${summary.doneCount} de ${summary.totalCount}`);
      setText('road-hours', `${model.formatCount(summary.completed)} h de ${model.formatCount(summary.estimated)} h`);
      setText('road-capacity', `${model.formatCount(summary.capacity)} h`);
      setText('road-buffer', `${model.formatCount(summary.buffer)} h`);
      try { sessionStorage.setItem(storageKey, JSON.stringify([...done])); } catch { /* navegador sem sessão */ }
    };
    items.forEach((item) => {
      item.querySelector('.check')?.addEventListener('click', () => {
        const id = item.getAttribute('data-task');
        if (done.has(id)) done.delete(id);
        else done.add(id);
        render();
      });
    });
    document.querySelector('[data-road-reset]')?.addEventListener('click', () => { done = new Set(); render(); });
    document.querySelectorAll('[data-phase-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        const phase = button.getAttribute('data-phase-filter');
        document.querySelectorAll('[data-phase-filter]').forEach((item) => item.setAttribute('aria-pressed', item === button ? 'true' : 'false'));
        document.querySelectorAll('[data-phase]').forEach((block) => {
          block.hidden = phase !== 'todas' && block.getAttribute('data-phase') !== phase;
        });
      });
    });
    render();
  }

  function bindDashboard() {
    const render = (period) => {
      const data = dashboard[period];
      if (!data) return;
      const map = {
        players: data.players, servers: data.servers, published: data.published, completed: data.completed,
        signups: data.signups, active: data.active, paying: data.paying, support: data.support, incidents: data.incidents
      };
      Object.entries(map).forEach(([key, value]) => setText(`dash-${key}`, model.formatCount(value)));
      setText('dash-revenue', model.formatBrl(data.revenue));
      setText('dash-costs', model.formatBrl(data.costs));
      setText('dash-result', model.formatBrl(data.revenue - data.costs));
      const host = document.querySelector('[data-dash-bars]');
      if (host) {
        const rows = [['Inscrições', data.signups], ['Ativos', data.active], ['Eventos feitos', data.completed], ['Pagantes', data.paying]];
        const max = Math.max(...rows.map((row) => row[1]), 1);
        host.replaceChildren();
        rows.forEach(([label, value]) => {
          const row = document.createElement('div');
          row.className = 'bar-row';
          row.innerHTML = `<span>${label}</span><span class="track"><i></i></span><b>${model.formatCount(value)}</b>`;
          row.querySelector('i').style.setProperty('--share', String((value / max) * 100));
          host.appendChild(row);
        });
      }
      const copy = document.querySelector('[data-dash-copy]');
      if (copy) copy.textContent = period === '7'
        ? 'Janela de 7 dias. A operação real de hoje é uma guilda. Estes números não foram lidos do banco.'
        : period === '30'
          ? 'Janela de 30 dias, ainda sem cliente pagante neste exemplo. Receita zero e custo estimado deixam o resultado negativo de propósito.'
          : 'Janela de 90 dias com uma segunda comunidade hipotética e seis clientes pagantes. É ilustração, não meta prometida.';
    };
    document.querySelectorAll('[data-period]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-period]').forEach((item) => item.setAttribute('aria-pressed', item === button ? 'true' : 'false'));
        render(button.getAttribute('data-period'));
      });
    });
    render('30');
  }

  function bindSlots() {
    document.querySelectorAll('.slot').forEach((button) => {
      button.addEventListener('click', () => {
        const on = button.getAttribute('aria-pressed') === 'true';
        button.setAttribute('aria-pressed', on ? 'false' : 'true');
        button.textContent = on ? button.getAttribute('data-label') : 'Vaga reservada na simulação';
      });
    });
  }

  function bindKyc() {
    const result = document.getElementById('kyc-result');
    document.getElementById('kyc-yes')?.addEventListener('click', () => {
      if (result) result.textContent = 'Aprovação simulada. Nenhuma pessoa foi cadastrada e nenhum documento foi pedido.';
    });
    document.getElementById('kyc-no')?.addEventListener('click', () => {
      if (result) result.textContent = 'Rejeição simulada. O motivo, num sistema real, precisaria ser claro e revisável por uma pessoa.';
    });
  }

  function bindServiceJumps() {
    document.querySelectorAll('[data-open-service]').forEach((link) => {
      link.addEventListener('click', () => {
        const target = document.getElementById(link.getAttribute('data-open-service'));
        if (target) target.open = true;
      });
    });
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
