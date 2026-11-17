const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const model = require('../src/web/public/assets/plano-negocios-model');
const html = fs.readFileSync(path.join(__dirname, '../src/web/public/plano-negocios.html'), 'utf8');

test('pagamento fictício parte de R$ 100 com comissão de 10%', () => {
  const result = model.simulatePayment({ sale: 100, commissionPercent: 10, percentFee: 0, fixedFee: 0, feePayer: 'vendedor' });
  assert.equal(result.buyerPays, 100);
  assert.equal(result.commission, 10);
  assert.equal(result.sellerGross, 90);
  assert.equal(result.processorFee, 0);
  assert.equal(result.sellerNet, 90);
  assert.equal(result.notagNetBeforeTax, 10);
  assert.equal(result.fictional, true);
});

test('taxa do processador muda conforme quem paga', () => {
  const seller = model.simulatePayment({ sale: '100', commissionPercent: '10', percentFee: '4', fixedFee: '1', feePayer: 'vendedor' });
  assert.equal(seller.processorFee, 5);
  assert.equal(seller.buyerPays, 100);
  assert.equal(seller.sellerNet, 85);
  assert.equal(seller.notagNetBeforeTax, 10);

  const buyer = model.simulatePayment({ sale: 100, commissionPercent: 10, percentFee: 4, fixedFee: 1, feePayer: 'comprador' });
  assert.equal(buyer.buyerPays, 105);
  assert.equal(buyer.sellerNet, 90);

  const split = model.simulatePayment({ sale: 100, commissionPercent: 10, percentFee: 4, fixedFee: 1, feePayer: 'dividida' });
  assert.equal(split.buyerPays, 102.5);
  assert.equal(split.sellerNet, 87.5);
  assert.equal(split.buyerFee + split.sellerFee, 5);
});

test('entradas inválidas do pagamento não geram negativo', () => {
  const result = model.simulatePayment({ sale: -20, commissionPercent: 140, percentFee: -1, fixedFee: -3, feePayer: 'outro' });
  assert.equal(result.sale, 0);
  assert.equal(result.commissionPercent, 100);
  assert.equal(result.processorFee, 0);
  assert.equal(result.feePayer, 'vendedor');
});

test('cenários de custo são estimativas editáveis e somam o que prometem', () => {
  const mvp = model.summarizeCosts(model.COST_SCENARIOS.mvp);
  assert.equal(mvp.monthly, 145);
  assert.equal(mvp.annual, 1740);
  assert.equal(mvp.perUser, 1.81);
  assert.equal(mvp.breaksEven, false);

  const initial = model.summarizeCosts(model.COST_SCENARIOS.inicial);
  assert.equal(initial.monthly, 893);
  assert.equal(initial.operatingResult, -493);

  const growth = model.summarizeCosts(model.COST_SCENARIOS.expansao);
  assert.equal(growth.monthly, 4467);
  assert.equal(growth.breaksEven, true);
  assert.equal(growth.monthsToRecoverSetup, 1.6);
});

test('receita hipotética separa assinatura, churn e comissão', () => {
  const result = model.simulateRevenue({ free: 40, pro: 8, business: 2, churnPercent: 5, operatingCost: 893, marketplace: 150 });
  assert.equal(result.subscription, 259);
  assert.equal(result.mrr, 409);
  assert.equal(result.annualized, 4908);
  assert.equal(result.result, -484);
  assert.equal(result.mrrAfterChurn, 396.05);
  assert.equal(result.free, 40);
  assert.ok(result.proEquivalents > 0);
});

test('funil de marketing usa só as hipóteses informadas', () => {
  const result = model.simulateMarketing({ budget: 300, cpc: 0.8, signupRate: 25, activationRate: 40, retentionRate: 50, paidRate: 8 });
  assert.equal(result.clicks, 375);
  assert.equal(result.signups, 93.75);
  assert.equal(result.activations, 37.5);
  assert.equal(result.retained, 18.75);
  assert.equal(result.paying, 1.5);
  assert.equal(result.costPerPaying, 200);
  const empty = model.simulateMarketing({ budget: 0, cpc: 0, signupRate: 100, activationRate: 100, retentionRate: 100, paidRate: 100 });
  assert.equal(empty.paying, 0);
  assert.equal(empty.costPerPaying, null);
});

test('distribuidor de horas não passa de 36', () => {
  const next = model.rebalanceHours(model.DEFAULT_HOURS, 'desenvolvimento', 30);
  assert.equal(next.total, 36);
  assert.equal(next.hours.desenvolvimento, 30);
  assert.equal(next.remaining, 0);
  const lower = model.rebalanceHours(model.DEFAULT_HOURS, 'marketing', 1);
  assert.equal(lower.hours.marketing, 1);
  assert.equal(lower.total, 32);
  assert.equal(lower.remaining, 4);
});

test('a página traz as 15 seções e não embute segredo nem script inline', () => {
  for (const id of ['visao', 'concorrentes', 'ecossistema', 'pessoa', 'arquitetura', 'marketplace', 'verificacao', 'pagamentos', 'tributos', 'custos', 'planos', 'marketing', 'roadmap', 'riscos', 'painel']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /NOTAG Corporation/);
  assert.match(html, /Um ecossistema gamer desenvolvido por uma pessoa com inteligência artificial\./);
  assert.match(html, /Precisa de Tank, Healer ou DPS para jogar hoje\?/);
  assert.match(html, /data-notag-site-nav/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /style=/);
  assert.doesNotMatch(html, /DISCORD_TOKEN|CLIENT_SECRET|DASHBOARD_SESSION_SECRET/);
  const hours = [...html.matchAll(/data-hours="([\d.]+)"/g)].map((match) => Number(match[1]));
  assert.equal(hours.length, 20);
  assert.equal(hours.reduce((sum, value) => sum + value, 0), 242);
  const summary = model.summarizeTasks(hours.map((value, index) => ({ id: String(index), hours: value })), []);
  assert.equal(summary.capacity, 462.9);
  assert.equal(summary.buffer, 220.9);
});

test('a rota /plano-negocios responde e a home continua a mesma', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notag-plano-'));
  const script = `
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ${JSON.stringify(path.join(tempRoot, 'plano.sqlite'))};
    process.env.DASHBOARD_SESSION_SECRET = 'segredo-isolado-do-plano-de-negocios';
    process.env.DISCORD_TOKEN = 'token-isolado';
    process.env.CLIENT_ID = '1465328470312747181';
    process.env.DISCORD_CLIENT_SECRET = 'segredo-oauth-isolado';
    process.env.DASHBOARD_BASE_URL = 'http://127.0.0.1:8080';
    const http = require('node:http');
    const { createRequestHandler } = require('./src/web/server');
    const server = http.createServer(createRequestHandler({ isReady() { return false; } }));
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      const page = await fetch('http://127.0.0.1:' + port + '/plano-negocios');
      const text = await page.text();
      const home = await fetch('http://127.0.0.1:' + port + '/');
      const homeText = await home.text();
      const style = await fetch('http://127.0.0.1:' + port + '/assets/plano-negocios.css');
      const scriptFile = await fetch('http://127.0.0.1:' + port + '/assets/plano-negocios.js');
      const modelFile = await fetch('http://127.0.0.1:' + port + '/assets/plano-negocios-model.js');
      const failures = [];
      if (page.status !== 200) failures.push('status ' + page.status);
      if (!text.includes('NOTAG Corporation')) failures.push('titulo');
      if (!text.includes('plano-negocios.js')) failures.push('script');
      if (text.includes('data-notag-back')) failures.push('nav injetada');
      if (!String(page.headers.get('content-security-policy') || '').includes("script-src 'self'")) failures.push('csp');
      if (home.status !== 200 || !homeText.includes('PvE, Farm de World Boss')) failures.push('home');
      if (style.status !== 200 || !String(style.headers.get('content-type')).includes('text/css')) failures.push('css');
      if (scriptFile.status !== 200 || modelFile.status !== 200) failures.push('js');
      server.close();
      if (failures.length) {
        console.error(failures.join(', '));
        process.exit(2);
      }
      process.exit(0);
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', cwd: path.join(__dirname, '..') });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
