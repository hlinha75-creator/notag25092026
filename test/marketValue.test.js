const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateCombatValues, estimateVictimLoss, victimItems } = require('../src/modules/albion/marketValue.service');

test('soma equipamento e inventário da vítima usando quantidade e qualidade', async () => {
  const event = {
    Victim: {
      Equipment: { MainHand: { Type: 'TEST_SWORD', Quality: 2, Count: 1 } },
      Inventory: [{ Type: 'TEST_ORE', Quality: 1, Count: 10 }, null]
    }
  };
  const rows = [
    { item_id: 'TEST_SWORD', quality: 2, sell_price_min: 5000, buy_price_max: 4000 },
    { item_id: 'TEST_ORE', quality: 1, sell_price_min: 100, buy_price_max: 80 }
  ];
  const result = await estimateVictimLoss(event, {
    fetchImpl: async () => ({ ok: true, json: async () => rows })
  });
  assert.equal(victimItems(event).length, 2);
  assert.deepEqual(result, { total: 6000, priced: 2, items: 2 });
});

test('consulta em lote e calcula os valores de quem matou e de quem morreu', async () => {
  const event = {
    Killer: { Equipment: { MainHand: { Type: 'KILLER_SWORD', Quality: 1 } } },
    Victim: { Equipment: { MainHand: { Type: 'VICTIM_AXE', Quality: 1 } } }
  };
  let requests = 0;
  const result = await estimateCombatValues(event, {
    fetchImpl: async () => {
      requests += 1;
      return { ok: true, json: async () => [
        { item_id: 'KILLER_SWORD', quality: 1, sell_price_min: 20000 },
        { item_id: 'VICTIM_AXE', quality: 1, sell_price_min: 10000 }
      ] };
    }
  });
  assert.equal(requests, 1);
  assert.equal(result.killer.total, 20000);
  assert.equal(result.victim.total, 10000);
});
