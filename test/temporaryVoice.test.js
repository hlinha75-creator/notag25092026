const assert = require('node:assert/strict');
const test = require('node:test');
const { ChannelType } = require('discord.js');

const temporaryVoice = require('../src/modules/voice/temporaryVoice.service');

test('reconhece as grafias historicas e o sinal de mais largo do gatilho', () => {
  assert.equal(temporaryVoice.isTriggerName('+ Criar Sala'), true);
  assert.equal(temporaryVoice.isTriggerName('+Criar Sala'), true);
  assert.equal(temporaryVoice.isTriggerName('＋ Criar Sala'), true);
  assert.equal(temporaryVoice.isTriggerName('Sala comum'), false);
});

test('mantem um gatilho e remove duplicados vazios', async () => {
  const channels = new Map();
  const deleted = [];
  const makeTrigger = (id, name) => ({
    id,
    name,
    type: ChannelType.GuildVoice,
    parentId: 'category',
    members: new Map(),
    async setName(nextName) { this.name = nextName; },
    async delete() { deleted.push(this.id); channels.delete(this.id); }
  });
  channels.set('100', makeTrigger('100', '+Criar Sala'));
  channels.set('200', makeTrigger('200', '＋ Criar Sala'));
  channels.set('waiting', {
    id: 'waiting', type: ChannelType.GuildVoice, parentId: 'category', name: 'Aguardando Evento'
  });

  const guild = {
    id: 'guild-test',
    channels: {
      cache: channels,
      async fetch(id) { return id ? channels.get(id) || null : channels; },
      async create() { throw new Error('nao deveria criar outro gatilho'); }
    }
  };

  const trigger = await temporaryVoice.ensureTriggerChannel(guild);
  assert.equal(trigger.id, '100');
  assert.equal(trigger.name, '+ Criar Sala');
  assert.deepEqual(deleted, ['200']);
});
