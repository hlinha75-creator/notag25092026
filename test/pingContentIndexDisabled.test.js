const test = require('node:test');
const assert = require('node:assert/strict');

const { syncPingContentIndex } = require('../src/modules/events/events.service');

test('ping content index auto-sync is disabled', async () => {
  const channel = {
    id: '123',
    send: () => {
      throw new Error('nao deve enviar mensagem quando auto-sync esta desativado');
    },
    messages: { fetch: () => null },
    pin: () => null,
    pinned: false
  };

  const result = await syncPingContentIndex({ channels: { fetch: async () => channel } }, channel);
  assert.equal(result, null);
});
