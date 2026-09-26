require('dotenv').config();

const { backupDatabase } = require('../src/database/backup');
const { getDatabase, transaction } = require('../src/database/connection');
const { migrate } = require('../src/database/migrate');
const { formatSilver } = require('../src/utils/silver');

const APPLY_TOKEN = 'APLICAR';
const SNAPSHOT_TOTAL = 298430000;
const SNAPSHOT_CONTRIBUTORS = 20;

// Copiado da ultima lista visivel da meta @900m. O Discord cortou os ultimos nomes.
const visibleSnapshot = [
  { discordName: '!Tmaiusculo.', albionName: 'Tmaiusculo', amount: 225810000, entries: 8 },
  { discordName: 'SerpentVeil', albionName: 'SerpentVeil', amount: 17000000, entries: 1 },
  { discordName: 'TK', albionName: 'TKZX', amount: 10610000, entries: 3 },
  { discordName: '.Dsn', albionName: 'dsn', amount: 7560000, entries: 2 },
  { discordName: 'ToastT', albionName: 'ToastT', amount: 6000000, entries: 1 },
  { discordName: 'habibino', albionName: 'habibino', amount: 6000000, entries: 1 },
  { discordName: '.XlShanksXl', albionName: 'XlShanksXl', amount: 4170000, entries: 4 },
  { discordName: 'garotadeprograma', albionName: 'garotadeprograma', amount: 2900000, entries: 1 },
  { discordName: 'Natsury', albionName: 'Natsury', amount: 2780000, entries: 3 },
  { discordName: 'Soldier027', albionName: 'Soldier027', amount: 2350000, entries: 1 },
  { discordName: 'Superpk', albionName: 'Superpk', amount: 2320000, entries: 1 },
  { discordName: 'MatMac', albionName: 'MatMac', amount: 2170000, entries: 3 },
  { discordName: 'Nery', albionName: 'Nery', amount: 2010000, entries: 2 },
  { discordName: '.Hi6or', albionName: 'Hi6or', amount: 1790000, entries: 3 },
  { discordName: 'KuNaKiNa', albionName: 'KuNaKiNa', amount: 1400000, entries: 2 },

  // A lista de contribuidores foi cortada, mas estas entradas aparecem em "Ultimas entradas".
  { discordName: '!Sabedoria7', albionName: 'Sabedoria7', amount: 401710, entries: 1 },
  { discordName: '.MineMim', albionName: 'MineMim', amount: 655260, entries: 1 },
  { discordName: '.goncalves23', albionName: 'goncalves23', amount: 425950, entries: 1 }
];

function getCampaign(db) {
  return db.prepare("SELECT * FROM campaigns WHERE code = '900m' AND status = 'open' ORDER BY id ASC LIMIT 1").get();
}

function getCurrentTotals(db, campaignId) {
  return db.prepare(`
    SELECT
      COUNT(*) AS entries,
      COUNT(DISTINCT user_id) AS contributors,
      COALESCE(SUM(amount), 0) AS raised
    FROM campaign_contributions
    WHERE campaign_id = ?
      AND status = 'approved'
  `).get(campaignId);
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function findUser(db, item) {
  const albionKey = normalizeName(item.albionName);
  const discordKey = normalizeName(item.discordName);
  const users = db.prepare('SELECT * FROM users').all();
  return users.find((user) => (
    normalizeName(user.albion_name) === albionKey
    || normalizeName(user.discord_name) === discordKey
  ));
}

function printPreview({ rows, missingRows, visibleTotal, current, apply }) {
  console.log('Restauracao da meta @900m');
  console.log(`Modo: ${apply ? 'APLICAR' : 'PREVIA'}`);
  console.log(`Total antigo da lista: ${formatSilver(SNAPSHOT_TOTAL)} (${SNAPSHOT_CONTRIBUTORS} contribuidores)`);
  console.log(`Total visivel neste script: ${formatSilver(visibleTotal)} (${visibleSnapshot.length} nomes colados)`);
  console.log(`Encontrados no banco: ${rows.length}. Nao encontrados: ${missingRows.length}.`);
  console.log(`Falta na lista colada/cortada: ${formatSilver(SNAPSHOT_TOTAL - visibleTotal)} (${SNAPSHOT_CONTRIBUTORS - visibleSnapshot.length} contribuidores)`);
  console.log('');
  console.log(`Banco atual: ${formatSilver(Number(current.raised || 0))}, ${current.contributors} contribuidores, ${current.entries} entradas.`);
  if (Number(current.raised || 0) > 0) {
    console.log('O banco atual ja tem contribuicoes. O script nao vai inserir nada para evitar duplicar a meta.');
  }
  console.log('');

  if (missingRows.length > 0) {
    console.log('Nomes nao encontrados no banco pelo albion_name/discord_name:');
    for (const item of missingRows) console.log(`- ${item.albionName}`);
    console.log('');
  }

  console.log('Linhas que seriam inseridas se o banco estivesse zerado:');
  for (const item of rows) {
    console.log(`- ${item.albionName}: ${formatSilver(item.amount)} (${item.entries} entrada(s)) -> ${item.user.discord_id}`);
  }
  console.log('');

  if (!apply) {
    console.log(`Para aplicar: node scripts/restoreCampaign900mSnapshot.js ${APPLY_TOKEN}`);
  }
}

function main() {
  migrate();
  const apply = process.argv[2] === APPLY_TOKEN;
  const db = getDatabase();
  const campaign = getCampaign(db);
  if (!campaign) throw new Error('Meta @900m aberta nao encontrada.');

  const current = getCurrentTotals(db, campaign.id);
  const visibleTotal = visibleSnapshot.reduce((sum, row) => sum + row.amount, 0);
  const rows = [];
  const missingRows = [];

  for (const item of visibleSnapshot) {
    const user = findUser(db, item);
    if (!user) {
      missingRows.push(item);
    } else {
      rows.push({ ...item, user });
    }
  }

  printPreview({ rows, missingRows, visibleTotal, current, apply });

  if (!apply) return;
  if (Number(current.raised || 0) > 0) {
    console.log('Nada aplicado. Banco preservado.');
    return;
  }
  if (missingRows.length > 0) {
    console.log('Nada aplicado. Existem nomes nao encontrados. Corrija o cadastro ou complete manualmente antes de aplicar.');
    return;
  }

  const restore = transaction(() => {
    backupDatabase('before_campaign_900m_restore_snapshot');
    const insert = db.prepare(`
      INSERT INTO campaign_contributions
        (campaign_id, user_id, amount, source_type, source_id, status, created_by, approved_by, note)
      VALUES
        (@campaignId, @userId, @amount, 'manual_restore', 'snapshot_2026_06_27', 'approved', 'system', 'system', @note)
    `);

    for (const item of rows) {
      insert.run({
        campaignId: campaign.id,
        userId: item.user.discord_id,
        amount: item.amount,
        note: `Restauracao parcial da meta @900m: ${item.entries} entrada(s) antigas para ${item.albionName}`
      });
    }
  });

  restore();
  const after = getCurrentTotals(db, campaign.id);
  console.log('');
  console.log(`Aplicado. Novo total no banco: ${formatSilver(Number(after.raised || 0))}, ${after.contributors} contribuidores.`);
  console.log(`Ainda falta conferir/lancar: ${formatSilver(SNAPSHOT_TOTAL - visibleTotal)}.`);
}

main();
