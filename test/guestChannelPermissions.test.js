const assert = require('node:assert/strict');
const test = require('node:test');
const { PermissionsBitField } = require('discord.js');

const guestChannels = require('../src/modules/setup/guestChannelPermissions');

const access = {
  readOnly: ['read'],
  writable: ['write'],
  voice: ['voice']
};

test('classifica somente os canais liberados e oculta os demais', () => {
  assert.equal(guestChannels.accessModeForChannel('read', access), 'readOnly');
  assert.equal(guestChannels.accessModeForChannel('write', access), 'writable');
  assert.equal(guestChannels.accessModeForChannel('voice', access), 'voice');
  assert.equal(guestChannels.accessModeForChannel('other', access), 'hidden');
});

test('permite escrita apenas nos canais gravaveis', () => {
  assert.deepEqual(guestChannels.permissionsForChannel('read', access), {
    ViewChannel: true,
    SendMessages: false,
    SendMessagesInThreads: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    AddReactions: false,
    Connect: false,
    Speak: false,
    Stream: false
  });
  assert.equal(guestChannels.permissionsForChannel('write', access).SendMessages, true);
  assert.equal(guestChannels.permissionsForChannel('other', access).ViewChannel, false);
});

test('permite entrar e falar apenas na voz liberada', () => {
  const permissions = guestChannels.permissionsForChannel('voice', access);
  assert.equal(permissions.ViewChannel, true);
  assert.equal(permissions.Connect, true);
  assert.equal(permissions.Speak, true);
  assert.equal(permissions.Stream, false);
  assert.equal(permissions.SendMessages, false);
});

test('reconhece overwrite ja sincronizado', () => {
  const overwrite = {
    allow: new PermissionsBitField(['ViewChannel']),
    deny: new PermissionsBitField(['SendMessages'])
  };
  assert.equal(guestChannels.overwriteMatches(overwrite, {
    ViewChannel: true,
    SendMessages: false
  }), true);
  assert.equal(guestChannels.overwriteMatches(overwrite, {
    ViewChannel: true,
    SendMessages: true
  }), false);
});

test('valida canais ausentes e IDs repetidos antes da aplicacao', () => {
  const channels = [{ id: 'read' }, { id: 'write' }, { id: 'voice' }];
  assert.doesNotThrow(() => guestChannels.validateAccessChannels(channels, access));
  assert.throws(
    () => guestChannels.validateAccessChannels(channels, { ...access, voice: ['missing'] }),
    /nao encontrados: missing/
  );
  assert.throws(
    () => guestChannels.validateAccessChannels(channels, { ...access, voice: ['read'] }),
    /repetidos.*read/
  );
});
