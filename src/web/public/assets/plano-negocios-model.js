(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NotagPlanoModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WEEKLY_HOURS = 36;
  const PLAN_DAYS = 90;
  const PRO_PRICE = 19.9;
  const BUSINESS_PRICE = 49.9;
  const HOUR_KEYS = ['desenvolvimento', 'testes', 'marketing', 'atendimento', 'administracao', 'planejamento'];
  const COST_KEYS = ['hospedagem', 'dominio', 'banco', 'ia', 'apis', 'email', 'monitoramento', 'marketing', 'contabilidade', 'atendimento', 'seguranca', 'outras'];

  const DEFAULT_HOURS = {
    desenvolvimento: 16,
    testes: 6,
    marketing: 5,
    atendimento: 3,
    administracao: 3,
    planejamento: 3
  };

  const COST_SCENARIOS = {
    mvp: {
      label: 'MVP econômico',
      setup: 80,
      users: 80,
      servers: 1,
      revenue: 0,
      categories: {
        hospedagem: 25, dominio: 5, banco: 0, ia: 60, apis: 0, email: 0,
        monitoramento: 0, marketing: 40, contabilidade: 0, atendimento: 0, seguranca: 0, outras: 15
      }
    },
    inicial: {
      label: 'Operação inicial',
      setup: 400,
      users: 300,
      servers: 1,
      revenue: 400,
      categories: {
        hospedagem: 50, dominio: 6, banco: 0, ia: 180, apis: 25, email: 12,
        monitoramento: 20, marketing: 250, contabilidade: 280, atendimento: 0, seguranca: 30, outras: 40
      }
    },
    expansao: {
      label: 'Expansão comercial',
      setup: 2500,
      users: 2000,
      servers: 15,
      revenue: 6000,
      categories: {
        hospedagem: 220, dominio: 12, banco: 90, ia: 500, apis: 120, email: 35,
        monitoramento: 70, marketing: 1500, contabilidade: 450, atendimento: 1200, seguranca: 90, outras: 180
      }
    }
  };

  function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.round(number * 100) / 100;
  }

  function formatBrl(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    const number = Number(value);
    const sign = number < 0 ? '-' : '';
    const [ints, frac] = Math.abs(number).toFixed(2).split('.');
    return `${sign}R$ ${ints.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${frac}`;
  }

  function formatCount(value) {
    if (!Number.isFinite(Number(value))) return '—';
    const rounded = Math.round(Number(value) * 10) / 10;
    const [ints, frac] = rounded.toFixed(1).split('.');
    const grouped = ints.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return frac === '0' ? grouped : `${grouped},${frac}`;
  }

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value ?? '').trim().replace(/\s/g, '');
    if (!raw) return 0;
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');
    let normalized = raw;
    if (lastComma >= 0 && lastDot >= 0) {
      normalized = lastComma > lastDot
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw.replace(/,/g, '');
    } else if (lastComma >= 0) {
      normalized = raw.replace(',', '.');
    }
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  }

  function simulatePayment(input = {}) {
    const sale = Math.max(0, parseNumber(input.sale));
    const commissionPercent = Math.min(100, Math.max(0, parseNumber(input.commissionPercent)));
    const percentFee = Math.max(0, parseNumber(input.percentFee));
    const fixedFee = Math.max(0, parseNumber(input.fixedFee));
    const feePayer = ['comprador', 'vendedor', 'dividida'].includes(input.feePayer) ? input.feePayer : 'vendedor';
    const commission = money(sale * commissionPercent / 100);
    const sellerGross = money(sale - commission);
    const processorFee = money(sale * percentFee / 100 + fixedFee);
    let buyerFee = 0;
    let sellerFee = 0;
    if (feePayer === 'comprador') buyerFee = processorFee;
    else if (feePayer === 'dividida') {
      buyerFee = money(processorFee / 2);
      sellerFee = money(processorFee - buyerFee);
    } else sellerFee = processorFee;
    return {
      fictional: true,
      sale: money(sale),
      buyerPays: money(sale + buyerFee),
      commission,
      sellerGross,
      processorFee,
      buyerFee,
      sellerFee,
      sellerNet: money(sellerGross - sellerFee),
      notagNetBeforeTax: commission,
      feePayer,
      commissionPercent,
      percentFee,
      fixedFee
    };
  }

  function summarizeCosts(input = {}) {
    const categories = {};
    for (const key of COST_KEYS) categories[key] = money(Math.max(0, parseNumber(input.categories?.[key])));
    const monthly = money(COST_KEYS.reduce((sum, key) => sum + categories[key], 0));
    const setup = money(Math.max(0, parseNumber(input.setup)));
    const users = Math.max(0, parseNumber(input.users));
    const servers = Math.max(0, parseNumber(input.servers));
    const revenue = money(Math.max(0, parseNumber(input.revenue)));
    const operatingResult = money(revenue - monthly);
    return {
      fictional: true,
      categories,
      monthly,
      annual: money(monthly * 12),
      setup,
      users,
      servers,
      perUser: users > 0 ? money(monthly / users) : null,
      perServer: servers > 0 ? money(monthly / servers) : null,
      revenue,
      operatingResult,
      monthsToRecoverSetup: operatingResult > 0 ? Math.round((setup / operatingResult) * 10) / 10 : null,
      breaksEven: revenue + 0.001 >= monthly
    };
  }

  function simulateRevenue(input = {}) {
    const free = Math.max(0, parseNumber(input.free));
    const pro = Math.max(0, parseNumber(input.pro));
    const business = Math.max(0, parseNumber(input.business));
    const churnPercent = Math.min(100, Math.max(0, parseNumber(input.churnPercent)));
    const operatingCost = money(Math.max(0, parseNumber(input.operatingCost)));
    const marketplace = money(Math.max(0, parseNumber(input.marketplace)));
    const subscription = money(pro * PRO_PRICE + business * BUSINESS_PRICE);
    const mrr = money(subscription + marketplace);
    const keep = 1 - churnPercent / 100;
    const mrrAfterChurn = money(pro * keep * PRO_PRICE + business * keep * BUSINESS_PRICE + marketplace);
    const gap = Math.max(0, operatingCost - marketplace);
    return {
      fictional: true,
      free,
      pro,
      business,
      paying: pro + business,
      subscription,
      marketplace,
      mrr,
      annualized: money(mrr * 12),
      annualizedAfterChurn: money(mrrAfterChurn * 12),
      mrrAfterChurn,
      operatingCost,
      result: money(mrr - operatingCost),
      resultAfterChurn: money(mrrAfterChurn - operatingCost),
      proEquivalents: Math.round((gap / PRO_PRICE) * 10) / 10,
      churnPercent
    };
  }

  function simulateMarketing(input = {}) {
    const budget = Math.max(0, parseNumber(input.budget));
    const cpc = Math.max(0, parseNumber(input.cpc));
    const signup = Math.min(100, Math.max(0, parseNumber(input.signupRate))) / 100;
    const activation = Math.min(100, Math.max(0, parseNumber(input.activationRate))) / 100;
    const retention = Math.min(100, Math.max(0, parseNumber(input.retentionRate))) / 100;
    const paid = Math.min(100, Math.max(0, parseNumber(input.paidRate))) / 100;
    const clicks = cpc > 0 ? budget / cpc : 0;
    const signups = clicks * signup;
    const activations = signups * activation;
    const retained = activations * retention;
    const paying = retained * paid;
    return {
      fictional: true,
      budget: money(budget),
      cpc: money(cpc),
      clicks,
      signups,
      activations,
      retained,
      paying,
      costPerPaying: paying > 0 ? money(budget / paying) : null
    };
  }

  function rebalanceHours(current = {}, key, nextValue) {
    if (!HOUR_KEYS.includes(key)) throw new Error('Categoria de hora desconhecida.');
    const units = {};
    for (const item of HOUR_KEYS) units[item] = Math.max(0, Math.round((parseNumber(current[item]) || 0) * 2));
    units[key] = Math.max(0, Math.min(WEEKLY_HOURS * 2, Math.round(parseNumber(nextValue) * 2)));
    let overflow = HOUR_KEYS.reduce((sum, item) => sum + units[item], 0) - WEEKLY_HOURS * 2;
    if (overflow > 0) {
      const order = HOUR_KEYS
        .filter((item) => item !== key)
        .sort((a, b) => units[b] - units[a] || HOUR_KEYS.indexOf(a) - HOUR_KEYS.indexOf(b));
      for (const item of order) {
        if (overflow <= 0) break;
        const take = Math.min(units[item], overflow);
        units[item] -= take;
        overflow -= take;
      }
    }
    const hours = {};
    for (const item of HOUR_KEYS) hours[item] = units[item] / 2;
    const total = HOUR_KEYS.reduce((sum, item) => sum + hours[item], 0);
    return { hours, total, remaining: WEEKLY_HOURS - total, cap: WEEKLY_HOURS };
  }

  function weeklyCapacity(days = PLAN_DAYS) {
    return Math.round(WEEKLY_HOURS * (days / 7) * 10) / 10;
  }

  function summarizeTasks(tasks, doneIds = []) {
    const done = new Set(doneIds);
    const estimated = tasks.reduce((sum, task) => sum + Number(task.hours || 0), 0);
    const completed = tasks.filter((task) => done.has(task.id)).reduce((sum, task) => sum + Number(task.hours || 0), 0);
    const capacity = weeklyCapacity();
    return {
      estimated,
      completed,
      remaining: estimated - completed,
      capacity,
      buffer: Math.round((capacity - estimated) * 10) / 10,
      doneCount: done.size,
      totalCount: tasks.length
    };
  }

  return {
    WEEKLY_HOURS,
    PLAN_DAYS,
    PRO_PRICE,
    BUSINESS_PRICE,
    HOUR_KEYS,
    COST_KEYS,
    DEFAULT_HOURS,
    COST_SCENARIOS,
    money,
    formatBrl,
    formatCount,
    parseNumber,
    simulatePayment,
    summarizeCosts,
    simulateRevenue,
    simulateMarketing,
    rebalanceHours,
    weeklyCapacity,
    summarizeTasks
  };
});
