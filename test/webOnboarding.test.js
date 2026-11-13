const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notag-onboarding-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempRoot, 'onboarding.sqlite');

const ids = require('../src/config/ids');
const { getDatabase } = require('../src/database/connection');
const { migrate } = require('../src/database/migrate');
const {
  completeOnboarding,
  ensureFallbackGuestAccess,
  ensureGuestMember,
  findAlbionCharacter,
  notifyOnboardingIssue
} = require('../src/web/onboarding');

migrate();

function memberFixture(discordId) {
  const cache = new Map([[ids.roles.noTag, { id: ids.roles.noTag }]]);
  return {
    id: discordId,
    nickname: null,
    roles: {
      cache,
      async add(roleId) { cache.set(roleId, { id: roleId }); },
      async remove(roleId) { cache.delete(roleId); }
    },
    async setNickname(value) { this.nickname = value; }
  };
}

function clientFixture(member) {
  const guild = {
    members: {
      async fetch() { return member; },
      async add() { return member; }
    }
  };
  return { guilds: { async fetch() { return guild; } } };
}

function albionFetch(name = 'HeroNotag') {
  return async () => ({
    ok: true,
    async json() { return { players: [{ Id: 'albion-player-1', Name: name }] }; }
  });
}

test('onboarding valida personagem, atualiza Discord e não duplica pedido', async (t) => {
  const member = memberFixture('discord-new');
  const client = clientFixture(member);
  const session = { id: 'discord-new', username: 'novo.usuario' };

  const first = await completeOnboarding(client, session, 'heronotag', { fetchImpl: albionFetch() });
  const second = await completeOnboarding(client, session, 'HeroNotag', { fetchImpl: albionFetch() });
  const db = getDatabase();
  const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(session.id);
  const registrations = db.prepare('SELECT COUNT(*) AS total FROM registrations WHERE discord_id = ?').get(session.id).total;

  assert.equal(first.albionName, 'HeroNotag');
  assert.equal(second.albionName, 'HeroNotag');
  assert.equal(first.voiceUrl, `https://discord.com/channels/${ids.guildId}/${ids.channels.guestVoice}`);
  assert.equal(member.nickname, 'HeroNotag');
  assert.equal(member.roles.cache.has(ids.roles.guest), true);
  assert.equal(member.roles.cache.has(ids.roles.noTag), false);
  assert.equal(user.registration_status, 'pending');
  assert.equal(registrations, 1);

  t.after(() => {
    getDatabase().close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});

test('entrada OAuth adiciona o cargo convidado a quem já está no servidor', async () => {
  const member = memberFixture('discord-guest');
  const result = await ensureGuestMember(clientFixture(member), { id: member.id }, 'access-token');
  assert.equal(result.id, member.id);
  assert.equal(member.roles.cache.has(ids.roles.guest), true);
});

test('busca rejeita personagem inexistente', async () => {
  await assert.rejects(
    findAlbionCharacter('NaoExiste', { fetchImpl: albionFetch('OutroJogador') }),
    /Personagem não encontrado/
  );
});

test('fallback mantém acesso de convidado e remove cargo sem tag', async () => {
  const member = memberFixture('discord-help');
  await ensureFallbackGuestAccess(clientFixture(member), { id: member.id });
  assert.equal(member.roles.cache.has(ids.roles.guest), true);
  assert.equal(member.roles.cache.has(ids.roles.noTag), false);
});

test('aviso para staff respeita intervalo contra mensagens repetidas', async () => {
  const messages = [];
  const client = {
    channels: {
      async fetch(channelId) {
        assert.equal(channelId, ids.channels.memberRequests);
        return {
          isTextBased: () => true,
          async send(payload) { messages.push(payload); return { id: 'message-1' }; }
        };
      }
    }
  };
  const session = { id: 'discord-notification', username: 'usuario.teste' };
  const first = await notifyOnboardingIssue(client, session, 'HeroNotag', new Error('Personagem já vinculado.'), { now: 1_000_000 });
  const second = await notifyOnboardingIssue(client, session, 'HeroNotag', new Error('Personagem já vinculado.'), { now: 1_000_100 });

  assert.equal(first.notified, true);
  assert.equal(second.cooldown, true);
  assert.equal(messages.length, 1);
  assert.match(messages[0].content, /precisa de ajuda/);
  assert.deepEqual(messages[0].allowedMentions.users, [session.id]);
});
