const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  classifyEvent,
  configuredApiBase,
  eventPayload,
  fetchRecentEvents,
  findVengeanceMatches,
  participantLines,
  processVengeance,
  recordVengeanceDeath
} = require('../src/modules/albion/killFeed.service');

test('killfeed usa Europa mesmo quando restou a configuração antiga de Americas', () => {
  const previousUrl = process.env.ALBION_API_BASE_URL;
  const previousBase = process.env.ALBION_API_BASE;
  process.env.ALBION_API_BASE_URL = 'https://gameinfo.albiononline.com/api/gameinfo';
  delete process.env.ALBION_API_BASE;
  assert.equal(configuredApiBase(), 'https://gameinfo-ams.albiononline.com/api/gameinfo');
  if (previousUrl == null) delete process.env.ALBION_API_BASE_URL;
  else process.env.ALBION_API_BASE_URL = previousUrl;
  if (previousBase == null) delete process.env.ALBION_API_BASE;
  else process.env.ALBION_API_BASE = previousBase;
});

test('killfeed separa kills, deaths e eventos externos da NoTag', () => {
  assert.equal(classifyEvent({ Killer: { GuildName: 'NoTag' }, Victim: { GuildName: 'Outra' } }), 'kill');
  assert.equal(classifyEvent({ Killer: { GuildName: 'Outra' }, Victim: { GuildName: 'NOTAG' } }), 'death');
  assert.equal(classifyEvent({ Killer: { GuildName: 'Outra' }, Victim: { GuildName: 'Terceira' } }), null);
});

test('monta resumo, participantes, preço, armas remotas e link europeu', async () => {
  const event = {
    EventId: 399468006,
    Killer: { Id: 'k', Name: 'Killer', GuildName: 'Outra', AllianceName: 'ALLY-A', Equipment: { MainHand: { Type: 'T6_MAIN_SWORD', Quality: 2, Count: 1 } } },
    Victim: { Id: 'v', Name: 'Victim', GuildName: 'NoTag', AllianceName: 'ALLY-B', Equipment: { MainHand: { Type: 'T5_MAIN_AXE', Quality: 1, Count: 1 } }, Inventory: [{ Type: 'T7_ORE', Quality: 1, Count: 12 }] },
    Participants: [
      { Id: 'k', Name: 'Killer', GuildName: 'Outra', AllianceName: 'ALLY-A', DamageDone: 1234 },
      { Id: 'a', Name: 'Assist', GuildName: 'Ajuda', AllianceName: 'ALLY-C', DamageDone: 500 }
    ]
  };
  const payload = await eventPayload(event, 'death', 'https://gameinfo-ams.albiononline.com/api/gameinfo', {
    fetchImpl: async () => ({ ok: true, json: async () => [
      { item_id: 'T6_MAIN_SWORD', quality: 2, sell_price_min: 50000, buy_price_max: 45000 },
      { item_id: 'T5_MAIN_AXE', quality: 1, sell_price_min: 10000, buy_price_max: 9000 },
      { item_id: 'T7_ORE', quality: 1, sell_price_min: 1000, buy_price_max: 800 }
    ] })
  });
  assert.equal(payload.embeds.length, 4);
  assert.match(payload.embeds[0].data.description, /Killer.*matou.*Victim/);
  assert.match(payload.embeds[0].data.fields[3].value, /50\.000 prata/);
  assert.match(payload.embeds[0].data.fields[4].value, /22\.000 prata/);
  assert.equal(payload.embeds[0].data.footer.text, 'Evento #399468006 • Albion Europa');
  assert.match(payload.embeds[1].data.description, /Killer.*Outra.*ALLY-A/);
  assert.match(payload.embeds[1].data.description, /Assist.*Ajuda.*ALLY-C/);
  assert.match(payload.embeds[2].data.thumbnail.url, /T6_MAIN_SWORD\.png\?quality=2/);
  assert.match(payload.embeds[3].data.thumbnail.url, /T5_MAIN_AXE\.png\?quality=1/);
  assert.equal(payload.files, undefined);
  assert.equal(payload.components[0].components[0].data.url, 'https://killboard-1.com/eu/event/399468006');
  assert.equal(participantLines(event).length, 2);
});

test('consulta eventos com paginação e para ao encontrar o último evento salvo', async () => {
  const calls = [];
  const first = Array.from({ length: 51 }, (_, index) => ({ EventId: 200 - index }));
  const second = [{ EventId: 149 }, { EventId: 148 }];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => (calls.length === 1 ? first : second) };
  };
  const rows = await fetchRecentEvents({ fetchImpl, apiBase: 'https://example.test/api', lastId: 149 });
  assert.equal(rows.length, 53);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /offset=51/);
});

test('repete consulta quando a API Albion responde erro temporário', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts < 3) return { ok: false, status: 504 };
    return { ok: true, json: async () => [{ EventId: 300 }] };
  };
  const rows = await fetchRecentEvents({
    fetchImpl,
    apiBase: 'https://example.test/api',
    retries: 3,
    waitImpl: async () => {}
  });
  assert.equal(attempts, 3);
  assert.equal(rows[0].EventId, 300);
});

test('registra morte e encontra vingança feita por outro membro em até sete dias', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (discord_id TEXT, albion_name TEXT, registration_status TEXT);
    CREATE TABLE albion_vengeance_deaths (
      original_event_id INTEGER PRIMARY KEY, victim_discord_id TEXT, victim_albion_name TEXT,
      enemy_player_id TEXT, enemy_player_name TEXT, occurred_at TEXT,
      avenged_event_id INTEGER, avenger_discord_id TEXT, avenged_at TEXT
    );
  `);
  db.prepare('INSERT INTO users VALUES (?, ?, ?)').run('discord-victim', 'MembroMorto', 'member');
  db.prepare('INSERT INTO users VALUES (?, ?, ?)').run('discord-avenger', 'Vingador', 'member');
  const now = new Date('2026-07-12T12:00:00Z');
  assert.equal(recordVengeanceDeath(db, {
    EventId: 10,
    TimeStamp: new Date(now.getTime() - 2 * 86400000).toISOString(),
    Killer: { Id: 'enemy-x', Name: 'Inimigo' },
    Victim: { Id: 'member-dead', Name: 'MembroMorto', GuildName: 'NoTag' }
  }), true);
  const match = findVengeanceMatches(db, {
    EventId: 20,
    Killer: { Id: 'avenger', Name: 'Vingador', GuildName: 'NoTag' },
    Victim: { Id: 'enemy-x', Name: 'Inimigo' }
  }, now);
  assert.equal(match.avenger.discord_id, 'discord-avenger');
  assert.deepEqual(match.rows.map((row) => row.original_event_id), [10]);
  db.close();
});

test('não considera auto-vingança nem morte vencida há mais de sete dias', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (discord_id TEXT, albion_name TEXT, registration_status TEXT);
    CREATE TABLE albion_vengeance_deaths (
      original_event_id INTEGER PRIMARY KEY, victim_discord_id TEXT, victim_albion_name TEXT,
      enemy_player_id TEXT, enemy_player_name TEXT, occurred_at TEXT,
      avenged_event_id INTEGER, avenger_discord_id TEXT, avenged_at TEXT
    );
    INSERT INTO users VALUES ('same-user', 'MesmoJogador', 'member');
    INSERT INTO albion_vengeance_deaths VALUES
      (1, 'same-user', 'MesmoJogador', 'enemy', 'Inimigo', '2026-07-11T12:00:00Z', NULL, NULL, NULL),
      (2, 'other-user', 'Outro', 'old-enemy', 'Antigo', '2026-07-01T12:00:00Z', NULL, NULL, NULL);
  `);
  const now = new Date('2026-07-12T12:00:00Z');
  assert.equal(findVengeanceMatches(db, { EventId: 3, Killer: { Name: 'MesmoJogador' }, Victim: { Id: 'enemy' } }, now), null);
  assert.equal(findVengeanceMatches(db, { EventId: 4, Killer: { Name: 'MesmoJogador' }, Victim: { Id: 'old-enemy' } }, now), null);
  db.close();
});

test('parabeniza a vingança no chat-notag sem creditar saldo', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (discord_id TEXT, albion_name TEXT, registration_status TEXT);
    CREATE TABLE albion_vengeance_deaths (
      original_event_id INTEGER PRIMARY KEY, victim_discord_id TEXT, victim_albion_name TEXT,
      enemy_player_id TEXT, enemy_player_name TEXT, occurred_at TEXT,
      avenged_event_id INTEGER, avenger_discord_id TEXT, avenged_at TEXT
    );
    CREATE TABLE albion_vengeance_rewards (
      vengeance_event_id INTEGER PRIMARY KEY, avenger_discord_id TEXT,
      amount INTEGER, original_events_json TEXT, rewarded_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users VALUES ('discord-victim', 'MembroMorto', 'member');
    INSERT INTO users VALUES ('discord-avenger', 'Vingador', 'member');
    INSERT INTO albion_vengeance_deaths VALUES
      (10, 'discord-victim', 'MembroMorto', 'enemy-x', 'Inimigo', '2026-07-10T12:00:00Z', NULL, NULL, NULL);
  `);
  const sent = [];
  let requestedChannelId;
  const channel = {
    isTextBased: () => true,
    send: async (payload) => {
      sent.push(payload);
      return { id: 'message-1' };
    }
  };
  const client = { channels: { fetch: async (channelId) => {
    requestedChannelId = channelId;
    return channel;
  } } };
  const event = {
    EventId: 20,
    Killer: { Id: 'avenger', Name: 'Vingador', GuildName: 'NoTag' },
    Victim: { Id: 'enemy-x', Name: 'Inimigo' }
  };

  const result = await processVengeance(client, null, db, event, new Date('2026-07-12T12:00:00Z'));

  assert.equal(result.recognizedUserId, 'discord-avenger');
  assert.equal(requestedChannelId, '1481363760110243910');
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /<@discord-avenger>/);
  assert.match(sent[0].embeds[0].data.fields[1].value, /Parabéns/);
  assert.equal(db.prepare('SELECT amount FROM albion_vengeance_rewards WHERE vengeance_event_id = 20').get().amount, 0);
  assert.equal(db.prepare('SELECT avenged_event_id FROM albion_vengeance_deaths WHERE original_event_id = 10').get().avenged_event_id, 20);
  assert.equal(await processVengeance(client, null, db, event, new Date('2026-07-12T12:00:00Z')), null);
  assert.equal(sent.length, 1);
  db.close();
});
