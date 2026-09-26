const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notag-fame-category-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempRoot, 'fame-category.sqlite');

const { getDatabase } = require('../src/database/connection');
const { migrate } = require('../src/database/migrate');
const {
  applyCategoryPreview,
  previewCategoryFame,
  undoLatestCategoryImport
} = require('../src/modules/albion/fame.service');
const { getDashboardData } = require('../src/web/dashboard.repository');

migrate();

function table(rows) {
  return [
    '"Rank"\t"Player"\t"Guild Role"\t"Amount"',
    ...rows.map((row, index) => `"${index + 1}"\t"${row.name}"\t"${row.role || ''}"\t"${row.amount}"`)
  ].join('\n');
}

test('importação separada preserva categorias e jogadores ausentes', () => {
  const db = getDatabase();
  db.prepare(`INSERT INTO users (discord_id, discord_name, albion_name, registration_status) VALUES (?, ?, ?, ?)`)
    .run('discord-tmaiusculo', 'tmaiusculo', 'Tmaiusculo', 'member');
  db.prepare(`
    INSERT INTO albion_fame_totals (albion_key, albion_name, pve_fame, crafting_fame)
    VALUES ('tmaiusculo', 'Tmaiusculo', 1254347449, 0)
  `).run();

  const first = previewCategoryFame(table([
    { name: 'avven1996', role: 'ENERGIAS GUILDA', amount: 382677301 },
    { name: 'Cominhos', role: 'fundador', amount: 218170588 },
    { name: 'Tmaiusculo', role: 'fundador', amount: 116411678 }
  ]), { category: 'crafting', sourceName: 'craft.tsv', actorId: 'staff-1' });

  assert.equal(first.summary.players, 3);
  assert.equal(first.summary.linked, 1);
  assert.equal(first.summary.unmatched, 2);
  assert.equal(first.summary.reductions, 0);
  const applied = applyCategoryPreview(first);
  assert.equal(applied.category, 'crafting');

  const current = db.prepare('SELECT * FROM albion_fame_totals WHERE albion_key = ?').get('tmaiusculo');
  assert.equal(current.pve_fame, 1254347449);
  assert.equal(current.crafting_fame, 116411678);

  const second = previewCategoryFame(table([
    { name: 'avven1996', amount: 390000000 },
    { name: 'Tmaiusculo', amount: 110000000 }
  ]), { category: 'crafting', sourceName: 'craft-2.tsv', actorId: 'staff-2' });

  assert.equal(second.summary.missing, 1);
  assert.equal(second.missing[0].albionName, 'Cominhos');
  assert.equal(second.summary.reductions, 1);
  assert.throws(() => applyCategoryPreview(second), /Confirme as reduções/);
  applyCategoryPreview(second, { confirmReductions: true });
  assert.equal(db.prepare('SELECT crafting_fame FROM albion_fame_totals WHERE albion_key = ?').get('cominhos').crafting_fame, 218170588);
  assert.equal(db.prepare('SELECT crafting_fame FROM albion_fame_totals WHERE albion_key = ?').get('tmaiusculo').crafting_fame, 110000000);

  const undone = undoLatestCategoryImport('crafting', 'staff-2');
  assert.equal(undone.restoredRows, 2);
  assert.equal(db.prepare('SELECT crafting_fame FROM albion_fame_totals WHERE albion_key = ?').get('tmaiusculo').crafting_fame, 116411678);
  assert.equal(db.prepare('SELECT crafting_fame FROM albion_fame_totals WHERE albion_key = ?').get('avven1996').crafting_fame, 382677301);

});

test('prévia identifica jogadores duplicados e valores inválidos', () => {
  const preview = previewCategoryFame(table([
    { name: 'Duplicado', amount: 100 },
    { name: 'Duplicado', amount: 200 },
    { name: 'ValorRuim', amount: 'abc' }
  ]), { category: 'pvp', actorId: 'staff-1' });

  assert.equal(preview.summary.players, 1);
  assert.equal(preview.summary.errors, 2);
  assert.match(preview.errors[0].message, /mais de uma vez/);
  assert.match(preview.errors[1].message, /valor inválido/);
});

test('dashboard classifica vinculados e não vinculados sem duplicar personagem', () => {
  const db = getDatabase();
  const insertUser = db.prepare('INSERT INTO users (discord_id, discord_name, albion_name, registration_status) VALUES (?, ?, ?, ?)');
  insertUser.run('ranking-alpha-member', 'Alpha membro', 'RankingAlpha', 'member');
  db.prepare(`
    INSERT INTO albion_fame_totals
      (albion_key, albion_name, pve_fame, pvp_fame, gathering_fame, crafting_fame)
    VALUES
      ('rankingalpha', 'RankingAlpha', 500, 500, 500, 500),
      ('rankingbeta', 'RankingBeta', 400, 400, 400, 400),
      ('rankinggamma', 'RankingGamma', 0, 0, 0, 0)
  `).run();

  const rows = getDashboardData().rankings.fame.rows;
  const alphaRows = rows.filter((row) => row.albion_name === 'RankingAlpha');
  const alpha = alphaRows[0];
  const beta = rows.find((row) => row.albion_name === 'RankingBeta');
  const gamma = rows.find((row) => row.albion_name === 'RankingGamma');

  assert.equal(alphaRows.length, 1);
  assert.equal(alpha.discord_id, 'ranking-alpha-member');
  assert.equal(alpha.linked, true);
  assert.equal(beta.linked, false);
  assert.ok(alpha.pve_fame_rank < beta.pve_fame_rank);
  assert.ok(alpha.overall_rank < beta.overall_rank);
  assert.equal(gamma.pve_fame_rank, null);
  assert.equal(gamma.overall_rank, null);
});

after(() => {
  getDatabase().close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
