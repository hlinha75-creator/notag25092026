const assert = require('node:assert/strict');
const test = require('node:test');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

const temporaryVoice = require('../src/modules/voice/temporaryVoice.service');

test('reconhece as grafias historicas e simbolos alternativos do gatilho', () => {
  assert.equal(temporaryVoice.isTriggerName('+ Criar Sala'), true);
  assert.equal(temporaryVoice.isTriggerName('+Criar Sala'), true);
  assert.equal(temporaryVoice.isTriggerName('＋ Criar Sala'), true);
  assert.equal(temporaryVoice.isTriggerName('✚ Criar Sala'), true);
  assert.equal(temporaryVoice.isTriggerName('➕ Criar Sala'), true);
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
  channels.set('200', makeTrigger('200', '✚ Criar Sala'));
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

test('aplica o padrão de visitante entrar sem falar', () => {
  assert.deepEqual(temporaryVoice.guestAccessPermissions(), {
    ViewChannel: true,
    Connect: true,
    Speak: false,
    Stream: false
  });
  assert.deepEqual(temporaryVoice.guestAccessPermissions('view'), {
    ViewChannel: true,
    Connect: false,
    Speak: false,
    Stream: false
  });
  assert.deepEqual(temporaryVoice.guestAccessPermissions('hidden'), {
    ViewChannel: false,
    Connect: false,
    Speak: false,
    Stream: false
  });
});

test('preserva acesso do criador e dos cargos de membro na sala', () => {
  const guild = { roles: { everyone: { id: 'guild-id' } } };
  const member = { id: 'owner-id' };
  const overwrites = temporaryVoice.roomPermissionOverwrites(guild, member);
  const everyone = overwrites.find((entry) => entry.id === 'guild-id');
  const owner = overwrites.find((entry) => entry.id === 'owner-id');
  const guest = overwrites.find((entry) => entry.id === '1481251365857525782');

  assert.ok(everyone.allow.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(everyone.allow.includes(PermissionFlagsBits.Connect));
  assert.ok(everyone.deny.includes(PermissionFlagsBits.Speak));
  assert.ok(guest.deny.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(guest.deny.includes(PermissionFlagsBits.Connect));
  assert.ok(owner.allow.includes(PermissionFlagsBits.Connect));
  assert.ok(owner.allow.includes(PermissionFlagsBits.Speak));
  assert.ok(overwrites.some((entry) => (
    entry.id !== 'guild-id'
      && entry.id !== 'owner-id'
      && entry.allow?.includes(PermissionFlagsBits.Speak)
  )));
});
