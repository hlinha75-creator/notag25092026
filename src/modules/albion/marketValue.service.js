const MARKET_API = 'https://europe.albion-online-data.com/api/v2/stats/prices';
const CACHE_MS = 10 * 60 * 1000;
const priceCache = new Map();

function victimItems(event) {
  return playerItems(event?.Victim);
}

function equipmentItems(player) {
  return Object.values(player?.Equipment || {}).filter((item) => item?.Type);
}

function playerItems(player) {
  return [
    ...equipmentItems(player),
    ...(player?.Inventory || [])
  ].filter((item) => item?.Type);
}

function priceKey(item) {
  return `${item.Type}:${Number(item.Quality || 1)}`;
}

async function fetchPrices(items, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const missing = [...new Map(items.map((item) => [priceKey(item), item])).values()]
    .filter((item) => !priceCache.has(priceKey(item)) || Date.now() - priceCache.get(priceKey(item)).cachedAt > CACHE_MS);
  if (!missing.length) return;
  const ids = [...new Set(missing.map((item) => item.Type))];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
  try {
    const response = await fetchImpl(`${MARKET_API}/${ids.map(encodeURIComponent).join(',')}.json`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'User-Agent': 'Notag-Discord-Killfeed/1.0' }
    });
    if (!response.ok) throw new Error(`API de mercado respondeu ${response.status}.`);
    const rows = await response.json();
    for (const item of missing) {
      const candidates = rows.filter((row) => row.item_id === item.Type && Number(row.quality) === Number(item.Quality || 1));
      const sellPrices = candidates.map((row) => Number(row.sell_price_min || 0)).filter((value) => value > 0);
      const buyPrices = candidates.map((row) => Number(row.buy_price_max || 0)).filter((value) => value > 0);
      const unitPrice = sellPrices.length ? Math.min(...sellPrices) : (buyPrices.length ? Math.max(...buyPrices) : 0);
      priceCache.set(priceKey(item), { unitPrice, cachedAt: Date.now() });
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function estimateVictimLoss(event, options = {}) {
  const items = victimItems(event);
  if (!items.length) return { total: 0, priced: 0, items: 0 };
  await fetchPrices(items, options);
  return estimateItems(items);
}

async function estimateVictimBuild(event, options = {}) {
  const items = equipmentItems(event?.Victim);
  if (!items.length) return { total: 0, priced: 0, items: 0 };
  await fetchPrices(items, options);
  return estimateItems(items);
}

async function estimateCombatValues(event, options = {}) {
  const killerItems = playerItems(event?.Killer);
  const victimEquipment = playerItems(event?.Victim);
  const allItems = [...killerItems, ...victimEquipment];
  if (allItems.length) await fetchPrices(allItems, options);
  return {
    killer: estimateItems(killerItems),
    victim: estimateItems(victimEquipment)
  };
}

function estimateItems(items) {
  let total = 0;
  let priced = 0;
  for (const item of items) {
    const unitPrice = Number(priceCache.get(priceKey(item))?.unitPrice || 0);
    if (unitPrice > 0) priced += 1;
    total += unitPrice * Math.max(1, Number(item.Count || 1));
  }
  return { total: Math.round(total), priced, items: items.length };
}

module.exports = {
  equipmentItems,
  estimateCombatValues,
  estimateVictimBuild,
  estimateVictimLoss,
  playerItems,
  victimItems
};
