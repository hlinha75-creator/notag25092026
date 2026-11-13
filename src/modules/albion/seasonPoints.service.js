const fs = require('fs');
const path = require('path');

const snapshotPath = path.resolve(__dirname, '..', '..', '..', 'data', 'season33', 'snapshot-final.json');

const categoryLabels = {
  'Guild Challenge': 'Guild Challenge',
  'PvE (Outlands and Roads)': 'PvE Black',
  'Keeper Uprising': 'Keeper Uprising',
  'Gathering (Outlands and Roads)': 'Coleta Black',
  'Hideout Power Cores': 'Power Cores',
  'Outlands Treasures': 'Tesouros Black',
  Smugglers: 'Contrabandistas',
  Hellgates: 'Hellgates',
  'The Depths': 'Profundezas',
  'Corrupted Dungeons': 'Corrompidas',
  'Castles & Castle Outposts': 'Castelos e Outposts'
};

let cached;

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR');
}

function loadSnapshot() {
  if (!cached) cached = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  return cached;
}

function calculateSeasonRanking() {
  const snapshot = loadSnapshot();
  const players = new Map();
  const categories = snapshot.categories.map((category) => {
    let visibleAmount = 0;
    let allocatedPoints = 0;
    for (const row of category.rows) {
      const amount = Math.max(0, Number(row.amount || 0));
      if (amount <= 0) continue;
      const points = Number(category.seasonPoints || 0) * amount / Number(category.totalAmount || 1);
      const key = normalize(row.player);
      if (!players.has(key)) players.set(key, { name: row.player, totalPoints: 0, categories: [] });
      const player = players.get(key);
      player.totalPoints += points;
      player.categories.push({
        name: category.name,
        label: categoryLabels[category.name] || category.name,
        amount,
        points
      });
      visibleAmount += amount;
      allocatedPoints += points;
    }
    return {
      name: category.name,
      label: categoryLabels[category.name] || category.name,
      seasonPoints: Number(category.seasonPoints || 0),
      totalAmount: Number(category.totalAmount || 0),
      visibleAmount,
      allocatedPoints,
      approximate: category.name !== 'Guild Challenge'
    };
  });

  const rows = [...players.values()]
    .map((player) => {
      player.categories.sort((a, b) => b.points - a.points || b.amount - a.amount);
      return {
        ...player,
        totalPoints: Number(player.totalPoints.toFixed(6)),
        mainCategory: player.categories[0] || null
      };
    })
    .sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name, 'pt-BR'));

  rows.forEach((row, index) => { row.rank = index + 1; });
  return {
    season: snapshot.season,
    guild: snapshot.guild,
    snapshotLabel: snapshot.snapshotLabel,
    capturedAt: snapshot.capturedAt,
    officialGuildPoints: Number(snapshot.officialGuildPoints || 0),
    formula: snapshot.formula,
    missingRanks: snapshot.missingRanks || {},
    distributedEstimate: Number(rows.reduce((sum, row) => sum + row.totalPoints, 0).toFixed(6)),
    categories,
    rows
  };
}

function findSeasonPlayer(name) {
  const key = normalize(name);
  return calculateSeasonRanking().rows.find((row) => normalize(row.name) === key) || null;
}

function topSeasonPlayers(limit = 10) {
  const safeLimit = Math.max(1, Math.min(25, Number(limit) || 10));
  return calculateSeasonRanking().rows.slice(0, safeLimit);
}

function resetSnapshotCache() {
  cached = null;
}

module.exports = {
  calculateSeasonRanking,
  categoryLabels,
  findSeasonPlayer,
  resetSnapshotCache,
  topSeasonPlayers
};
