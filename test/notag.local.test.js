const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notag-bot-test-'));
const tempDbPath = path.join(tempRoot, 'notag-test.sqlite');
const realDbPath = path.resolve(__dirname, '..', 'data', 'notag.sqlite');

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = tempDbPath;
assert.notEqual(path.resolve(process.env.DATABASE_PATH), realDbPath, 'testes locais nao podem usar o banco real');

const { getDatabase } = require('../src/database/connection');
const { migrate } = require('../src/database/migrate');
const events = require('../src/modules/events/events.service');
const eventsRepo = require('../src/modules/events/events.repository');
const customEventWizard = require('../src/modules/events/customEventWizard.service');
const finance = require('../src/modules/finance/finance.service');
const financeRepo = require('../src/modules/finance/finance.repository');
const deposit = require('../src/modules/deposit/deposit.service');
const voice = require('../src/modules/voice/voice.service');
const voiceRepo = require('../src/modules/voice/voice.repository');
const dailyPveRanking = require('../src/modules/albion/dailyPveRanking.service');
const accountLinks = require('../src/modules/accounts/accountLinks.service');
const guildReverification = require('../src/modules/members/guildReverification.service');
const hideoutDefense = require('../src/modules/operations/hideoutDefense.service');
const giveawaysRepo = require('../src/modules/giveaways/giveaways.repository');
const giveaways = require('../src/modules/giveaways/giveaways.service');
const { parseLocalDateTime } = require('../src/utils/timezone');

migrate();

test('aviso da defesa da HO controla leitura e participação separadamente', () => {
  let result = hideoutDefense.toggleAcknowledgement('member-1');
  assert.equal(result.added, true);
  assert.deepEqual(result.acknowledgements.map((row) => row.user_id), ['member-1']);

  result = hideoutDefense.toggleAcknowledgement('member-2');
  assert.equal(result.added, true);
  let participation = hideoutDefense.toggleParticipation('member-2');
  assert.equal(participation.added, true);

  const payload = hideoutDefense.announcementPayload({
    participations: participation.participations
  });
  assert.equal(payload.content, '<@&1481251365131911314>');
  assert.equal(payload.components[0].components[0].data.label, 'Eu li');
  assert.equal(payload.components[0].components[1].data.label, 'Vou lutar');
  const fields = payload.embeds[0].data.fields;
  const awareMembers = fields.find((field) => field.name.startsWith('Membros cientes')).value;
  assert.match(awareMembers, /<@member-1>/);
  assert.doesNotMatch(awareMembers, /<@member-2>/);
  assert.match(fields.find((field) => field.name.startsWith('Vão lutar')).value, /<@member-2>/);

  result = hideoutDefense.toggleAcknowledgement('member-2');
  assert.equal(result.alreadyParticipating, true);
  assert.deepEqual(result.acknowledgements.map((row) => row.user_id), ['member-1']);

  result = hideoutDefense.toggleAcknowledgement('member-1');
  assert.equal(result.added, false);
  assert.deepEqual(result.acknowledgements, []);

  participation = hideoutDefense.toggleParticipation('member-2');
  assert.equal(participation.added, false);
  assert.deepEqual(participation.participations, []);
});

test('defesa da HO encerrada nao volta a publicar o anuncio', async () => {
  const harness = createDiscordHarness();
  const result = await hideoutDefense.postAnnouncementIfNeeded(
    harness.client,
    new Date('2026-07-24T22:19:54.373Z')
  );
  assert.deepEqual(result, { message: null, created: false, expired: true });
  assert.equal(harness.sentMessages.length, 0);
});

test('defesa da HO cria tag, lembra inscritos, avisa ADM e move conectados', async () => {
  hideoutDefense.toggleAcknowledgement('aware');
  hideoutDefense.toggleParticipation('fighter');
  const harness = createDiscordHarness();
  const aware = harness.addMember('aware', { inVoice: true });
  const fighter = harness.addMember('fighter', { inVoice: false });

  await hideoutDefense.processSchedule(harness.client, new Date('2026-07-22T21:30:00.000Z'));
  let state = hideoutDefense.ensureState();
  assert.ok(state.role_id);
  assert.ok(state.reminder_sent_at);
  assert.equal(aware.roles.cache.has(state.role_id), true);
  assert.equal(fighter.roles.cache.has(state.role_id), true);
  assert.ok(harness.sentMessages.some(({ payload }) => String(payload.content).includes('DEFESA DA HO EM 30 MINUTOS')));

  await hideoutDefense.processSchedule(harness.client, new Date('2026-07-22T21:35:00.000Z'));
  state = hideoutDefense.ensureState();
  assert.ok(state.admin_prompt_sent_at);
  assert.ok(harness.sentMessages.some(({ payload }) => (
    String(payload.content).includes('hora de organizar a defesa')
      && payload.components?.[0]?.components?.[0]?.data?.custom_id === hideoutDefense.START_BUTTON_ID
  )));

  const started = await hideoutDefense.startDefense({
    client: harness.client,
    guild: harness.guild,
    actorId: 'admin',
    now: new Date('2026-07-22T21:35:00.000Z')
  });
  assert.deepEqual(started.moved, ['aware']);
  assert.deepEqual(started.notConnected, ['fighter']);
  assert.equal(aware.voice.channelId, started.voice.id);
  assert.equal(started.voice.name, '🛡️・defesa');

  getDatabase().prepare(`
    INSERT INTO voice_sessions
      (discord_id, discord_name, channel_id, channel_name, joined_at, left_at, seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'aware', 'User aware', started.voice.id, started.voice.name,
    '2026-07-22T21:35:00.000Z', '2026-07-22T22:10:00.000Z', 2100
  );

  const cleaned = await hideoutDefense.cleanupDefense(harness.client, new Date('2026-07-22T22:15:00.000Z'));
  assert.equal(cleaned.cleaned, true);
  assert.equal(started.voice.deleted, true);
  assert.equal(harness.guild.roles.cache.get(state.role_id).deleted, true);

  const rewardRun = await hideoutDefense.processSchedule(harness.client, new Date('2026-07-22T23:15:00.000Z'));
  assert.equal(rewardRun.rewards.newRewards, 2);
  assert.equal(financeRepo.getBalance('aware'), 100000);
  assert.equal(financeRepo.getBalance('fighter'), 100000);
  assert.equal(harness.sentDms.length, 2);
  assert.ok(harness.sentDms.every(({ payload }) => String(payload).includes('Parabéns pela cooperação')));
  const publicCongratulations = harness.sentMessages.find(({ channelId, payload }) => (
    channelId === '1481363760110243910' && String(payload.content).includes('PARABÉNS PELA DEFESA DA HO')
  ));
  assert.ok(publicCongratulations);
  assert.match(publicCongratulations.payload.content, /<@aware>/);
  assert.doesNotMatch(publicCongratulations.payload.content, /<@fighter>/);

  const repeatedRun = await hideoutDefense.processSchedule(harness.client, new Date('2026-07-22T23:16:00.000Z'));
  assert.equal(repeatedRun.rewards.newRewards, 0);
  assert.equal(financeRepo.getBalance('aware'), 100000);
  assert.equal(financeRepo.getBalance('fighter'), 100000);
  assert.equal(getDatabase().prepare("SELECT COUNT(*) AS total FROM balance_transactions WHERE type = 'hideout_defense_reward'").get().total, 2);
});

test.after(() => {
  getDatabase().close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test.beforeEach(() => {
  resetDatabase();
});

test('datas de sorteio usam o fuso configurado do servidor', () => {
  const date = parseLocalDateTime('21/07/2026 12:30', 'America/Sao_Paulo');
  assert.equal(date.toISOString(), '2026-07-21T15:30:00.000Z');
  assert.throws(() => parseLocalDateTime('31/02/2026 12:30', 'America/Sao_Paulo'), /nao existe|invalida/i);
});

test('sorteio confirma responsaveis, registra participantes, encerra e refaz ganhador', () => {
  const giveaway = giveawaysRepo.createGiveaway({
    guildId: 'guild', creatorId: 'creator', payerId: 'payer', title: 'Premio grande',
    description: 'Descricao', prizeName: '150m silver', estimatedValue: 150_000_000,
    startsAt: '2026-07-21T10:00:00.000Z', endsAt: '2026-07-22T10:00:00.000Z',
    winnerCount: 2, notes: null, requiresStaffApproval: 1
  });
  assert.equal(giveaway.status, 'pending_payer');
  assert.equal(giveaways.STAFF_APPROVAL_THRESHOLD, 100_000_000);

  giveawaysRepo.setPayerApproved(giveaway.id, 'payer');
  giveawaysRepo.setStaffApproved(giveaway.id, 'staff');
  giveawaysRepo.setReadyStatus(giveaway.id, 'open');
  for (const userId of ['one', 'two', 'three', 'four']) {
    giveawaysRepo.toggleParticipant(giveaway.id, userId, '2026-07-21T12:00:00.000Z');
  }
  assert.equal(giveawaysRepo.participantCount(giveaway.id), 4);

  const result = giveawaysRepo.drawWinners(giveaway.id, true);
  assert.equal(result.winners.length, 2);
  assert.equal(new Set(result.winners.map((winner) => winner.user_id)).size, 2);
  const invalid = result.winners[0].user_id;
  const rerolled = giveawaysRepo.rerollWinner(giveaway.id, invalid, 'creator', 'offline');
  assert.ok(rerolled.replacement);
  assert.equal(rerolled.winners.length, 2);
  assert.ok(!rerolled.winners.some((winner) => winner.user_id === invalid));
});

test('mescla contas Discord, soma saldo e elimina conflito de nick Albion', () => {
  const db = getDatabase();
  db.prepare(`INSERT INTO users (discord_id, discord_name, albion_name, registration_status) VALUES (?, ?, ?, ?)`)
    .run('primary', 'Conta Principal', 'Jogador', 'member');
  db.prepare(`INSERT INTO users (discord_id, discord_name, albion_name, registration_status) VALUES (?, ?, ?, ?)`)
    .run('secondary', 'Conta Secundaria', 'jogador', 'guest');
  db.prepare('INSERT INTO balances (discord_id, balance) VALUES (?, ?)').run('primary', 100);
  db.prepare('INSERT INTO balances (discord_id, balance) VALUES (?, ?)').run('secondary', 250);
  db.prepare(`
    INSERT INTO balance_transactions
      (type, user_id, amount, before_balance, after_balance, reason, created_by)
    VALUES ('manual', 'secondary', 250, 0, 250, 'teste', 'staff')
  `).run();

  const result = accountLinks.mergeAccounts({
    primaryId: 'primary',
    secondaryId: 'secondary',
    actorId: 'staff',
    label: 'Jogador'
  });

  assert.equal(result.primaryId, 'primary');
  assert.equal(db.prepare('SELECT balance FROM balances WHERE discord_id = ?').get('primary').balance, 350);
  assert.equal(db.prepare('SELECT 1 FROM balances WHERE discord_id = ?').get('secondary'), undefined);
  assert.equal(db.prepare('SELECT albion_name FROM users WHERE discord_id = ?').get('primary').albion_name, 'Jogador');
  assert.equal(db.prepare('SELECT albion_name FROM users WHERE discord_id = ?').get('secondary').albion_name, null);
  assert.equal(db.prepare('SELECT user_id FROM balance_transactions LIMIT 1').get().user_id, 'primary');
  assert.equal(accountLinks.resolvePrimaryUserId('secondary'), 'primary');
  assert.deepEqual(accountLinks.linkedUserIds('primary').sort(), ['primary', 'secondary']);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE type = 'discord_accounts_merged'").get().total, 1);
});

test('ranking PvE consulta jogadores e ordena os cinco maiores', async () => {
  const players = {
    Ana: { id: '1', fame: 100 },
    Beto: { id: '2', fame: 500 },
    Caio: { id: '3', fame: 300 },
    Duda: { id: '4', fame: 200 },
    Eva: { id: '5', fame: 600 },
    Fabio: { id: '6', fame: 400 }
  };
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/search')) {
      const name = parsed.searchParams.get('q');
      const player = players[name];
      return { ok: true, json: async () => ({ players: player ? [{ Id: player.id, Name: name }] : [] }) };
    }
    const id = parsed.pathname.split('/').pop();
    const [name, player] = Object.entries(players).find(([, value]) => value.id === id);
    return { ok: true, json: async () => ({ Name: name, GuildName: 'NoTag', LifetimeStatistics: { PvE: { Total: player.fame } } }) };
  };

  const ranking = await dailyPveRanking.fetchPveRanking(Object.keys(players), { fetchImpl, apiBase: 'https://example.test/api' });
  assert.deepEqual(ranking.slice(0, 5).map((row) => row.name), ['Eva', 'Beto', 'Fabio', 'Caio', 'Duda']);
});

test('fama Albion extrai PvE, PvP, craft, coleta e calcula total', () => {
  const row = dailyPveRanking.extractFame({
    Name: 'JogadorEU',
    KillFame: 200,
    LifetimeStatistics: {
      PvE: { Total: 1000 },
      Crafting: { Total: 300 },
      Gathering: { All: { Total: 400 } }
    }
  });
  assert.deepEqual(row, {
    name: 'JogadorEU', key: 'jogadoreu', pveFame: 1000, pvpFame: 200,
    craftingFame: 300, gatheringFame: 400, totalFame: 1900
  });
});

test('ranking de fama ignora personagem que esta em outra guilda', async () => {
  const fetchImpl = async (url) => {
    if (new URL(url).pathname.endsWith('/search')) {
      return { ok: true, json: async () => ({ players: [{ Id: 'fora', Name: 'ExMembro' }] }) };
    }
    return {
      ok: true,
      json: async () => ({ Name: 'ExMembro', GuildName: 'OutraGuild', KillFame: 999999999 })
    };
  };
  const ranking = await dailyPveRanking.fetchFameRanking(['ExMembro'], { fetchImpl, apiBase: 'https://example.test/api' });
  assert.deepEqual(ranking, []);
});

test('ranking semanal calcula crescimento entre primeiro e ultimo snapshot', () => {
  const insert = getDatabase().prepare(`INSERT INTO albion_fame_daily_snapshots
    (snapshot_date, albion_key, albion_name, pve_fame, pvp_fame, crafting_fame, gathering_fame, total_fame)
    VALUES (?, 'ana', 'Ana', ?, ?, ?, ?, ?)`);
  insert.run('2026-07-06', 100, 20, 30, 40, 190);
  insert.run('2026-07-12', 160, 35, 50, 70, 315);
  assert.deepEqual(dailyPveRanking.weeklyGrowthRows('2026-07-06', '2026-07-12'), [{
    name: 'Ana', key: 'ana', pveFame: 60, pvpFame: 15,
    craftingFame: 20, gatheringFame: 30, totalFame: 125
  }]);
});

test('ranking diario calcula diferenca e preserva total de carreira', () => {
  getDatabase().prepare(`INSERT INTO albion_fame_daily_snapshots
    (snapshot_date, albion_key, albion_name, pve_fame, pvp_fame, crafting_fame, gathering_fame, total_fame)
    VALUES ('2026-07-12', 'ana', 'Ana', 100, 20, 30, 40, 190)`).run();
  const current = [{
    name: 'Ana', key: 'ana', pveFame: 160, pvpFame: 35,
    craftingFame: 50, gatheringFame: 70, totalFame: 315
  }];
  const result = dailyPveRanking.dailyGrowthRows('2026-07-13', current);
  assert.equal(result.previousDate, '2026-07-12');
  assert.deepEqual(result.rows[0], {
    name: 'Ana', key: 'ana', pveFame: 60, pvpFame: 15,
    craftingFame: 20, gatheringFame: 30, totalFame: 125,
    careerTotals: current[0]
  });
});

test('semana de voz usa segunda a domingo no horario de Sao Paulo', () => {
  assert.deepEqual(
    voice.previousCompletedWeek(new Date('2026-07-11T12:00:00Z')),
    { weekStart: '2026-06-29', weekEnd: '2026-07-05' }
  );
  assert.deepEqual(
    voice.previousCompletedWeek(new Date('2026-07-13T12:00:00Z')),
    { weekStart: '2026-07-06', weekEnd: '2026-07-12' }
  );
});

test('jogador constante precisa de 30 minutos em seis dias e soma contas vinculadas', () => {
  const db = getDatabase();
  db.prepare("INSERT INTO users (discord_id, discord_name) VALUES ('primary', 'Jogador')").run();
  db.prepare("INSERT INTO linked_discord_accounts (linked_discord_id, primary_discord_id, label) VALUES ('secondary', 'primary', 'Jogador')").run();
  const insert = db.prepare(`INSERT INTO voice_sessions
    (discord_id, discord_name, channel_id, joined_at, left_at, seconds)
    VALUES (?, 'Jogador', 'voz', ?, ?, ?)`);

  for (let day = 15; day <= 20; day += 1) {
    const discordId = day === 20 ? 'secondary' : 'primary';
    insert.run(discordId, `2026-06-${day}T15:00:00.000Z`, `2026-06-${day}T15:30:00.000Z`, 1800);
  }
  insert.run('primary', '2026-06-21T15:00:00.000Z', '2026-06-21T15:29:59.000Z', 1799);

  assert.deepEqual(voiceRepo.listWeeklyConsistentPlayers({ weekStart: '2026-06-15', weekEnd: '2026-06-21' }), [
    { discord_id: 'primary', name: 'Jogador', days: 6, seconds: 10800 }
  ]);
});

test('verificacao da guild le roster TSV e exige 30 minutos de voz com alguma presenca de staff', () => {
  assert.deepEqual(guildReverification.parseRoster('"Character Name"\t"Last Seen"\n"Jogador A"\t"Online"\n"Jogador B"\t"ontem"'), [
    { normalizedName: 'jogador a', albionName: 'Jogador A' },
    { normalizedName: 'jogador b', albionName: 'Jogador B' }
  ]);

  const sessions = [
    { discord_id: 'player', primary_discord_id: 'player', channel_id: 'recrutamento', joined_at: '2026-07-17T18:00:00.000Z', left_at: '2026-07-17T18:31:00.000Z' },
    { discord_id: 'staff', primary_discord_id: 'staff', channel_id: 'recrutamento', joined_at: '2026-07-17T18:10:00.000Z', left_at: '2026-07-17T18:11:00.000Z' }
  ];
  const startsAt = '2026-07-17T18:00:00.000Z';
  const endsAt = '2026-07-24T18:00:00.000Z';
  assert.equal(guildReverification.calculateVoiceTime(sessions, startsAt, endsAt).get('player'), 1860);
  assert.equal(guildReverification.calculateStaffOverlap(sessions, ['staff'], startsAt, endsAt).get('player'), 60);
});

test('evento comum reserva a ultima vaga DPS para o Looter', async () => {
  const harness = createDiscordHarness();
  const event = await events.createEventFromFields(harness.interaction('creator-looter'), {
    creatorId: 'creator-looter',
    title: 'Evento com looter',
    description: 'T6 equivalente',
    location: 'Bridgewatch',
    scheduledTime: '18:30',
    tankSlots: 0,
    healerSlots: 0,
    supportSlots: 0,
    dpsSlots: 3,
    postChannelId: 'test-events'
  });

  const description = harness.sentMessages[0].payload.embeds[0].data.description;
  assert.match(description, /DPS 1/);
  assert.match(description, /DPS 2/);
  assert.match(description, /Looter/);
  assert.doesNotMatch(description, /DPS 3/);
  assert.match(description, /Javali Espectral/);
  assert.match(description, /sacos do chao/);
  assert.equal(event.dps_slots, 3);
});

test('evento personalizado cria telas dinamicas e salva detalhes por vaga', async () => {
  const harness = createDiscordHarness();
  const draft = customEventWizard.createDraft({
    creatorId: 'creator-custom',
    title: 'Fame Farm Personalizada',
    timeRange: 'das 18:30 as 20:30',
    day: '20/07',
    description: 'T6 equivalente',
    composition: '1,1,1,17'
  });
  customEventWizard.saveDetails({
    id: draft.id,
    creatorId: 'creator-custom',
    lootRules: 'Full loot split; retiramos regear e dividimos o restante em prata',
    consumables: '4x Giga Pot T7 / 2x Omelete Avaloniano T7',
    mount: '120%+'
  });

  assert.equal(draft.slotDefinitions.length, 20);
  assert.equal(customEventWizard.pageCount(draft), 4);
  assert.equal(draft.slotDefinitions.at(-1).fieldLabel, 'Looter (ultima vaga DPS)');
  for (let page = 0; page < customEventWizard.pageCount(draft); page += 1) {
    const current = customEventWizard.slotPage({ id: draft.id, creatorId: 'creator-custom', page });
    customEventWizard.saveSlotPage({
      id: draft.id,
      creatorId: 'creator-custom',
      page,
      values: current.slots.map((slot) => `${slot.fieldLabel} build`)
    });
  }

  const event = await events.createCustomEventFromDraft(harness.interaction('creator-custom'), draft);
  const message = [...harness.messages.values()][0];
  const description = message.payload.embeds[0].data.description;
  assert.match(description, /20\/07 das 18:30 as 20:30/);
  assert.match(description, /Full loot split/);
  assert.match(description, /Giga Pot T7/);
  assert.match(description, /Montaria:\*\* 120%\+/);
  assert.match(description, /Tank 1 build/);
  assert.match(description, /Looter \(ultima vaga DPS\) build/);
  assert.equal(eventsRepo.getCustomEventMeta(event.id).mount_requirement, '120%+');
  assert.equal(eventsRepo.listCustomEventSlots(event.id).length, 20);

  const dpsOptions = events.customEventSlotOptions(event.id, 'dps', 'custom-dps-7');
  assert.equal(dpsOptions.length, 17);
  assert.equal(dpsOptions.at(-1).label.startsWith('Looter'), true);

  await events.joinCustomEventSlot(harness.interaction('custom-dps-7'), event.id, 'dps', 7);
  await events.joinCustomEventSlot(harness.interaction('custom-looter'), event.id, 'dps', 17);
  const updatedDescription = message.payload.embeds[0].data.description;
  assert.match(updatedDescription, /DPS 7.*<@custom-dps-7>/);
  assert.match(updatedDescription, /Looter.*<@custom-looter>/);
  await assert.rejects(
    events.joinCustomEventSlot(harness.interaction('custom-dps-conflict'), event.id, 'dps', 7),
    /vaga acabou de ser ocupada/
  );
  customEventWizard.removeDraft(draft.id, 'creator-custom');
});

test('fluxo local cobre evento, voz, loot split, aprovacao, ledger, saque e deposito', async () => {
  const harness = createDiscordHarness();
  const creator = '1001';
  const participantA = '2001';
  const participantB = '2002';
  const spectatorOnly = '2003';
  const staff = '9001';

  harness.addMember(participantA, { inVoice: true });
  harness.addMember(participantB, { inVoice: true });
  harness.addMember(spectatorOnly, { inVoice: true });

  const event = await events.createEventFromFields(harness.interaction(creator), {
    creatorId: creator,
    title: 'FastContent Local',
    description: 'Teste automatizado',
    location: 'Bridgewatch',
    scheduledTime: '10:00',
    tankSlots: 1,
    healerSlots: 1,
    supportSlots: 0,
    dpsSlots: 0,
    postChannelId: 'test-events'
  });

  assert.equal(event.event_code, 'EVT-000001');
  assert.equal(event.status, 'created');
  assert.equal(harness.sentMessages.length, 1);
  assert.equal(harness.sentMessages[0].payload.components.length, 2);

  const eventMessage = [...harness.messages.values()][0];
  eventMessage.payload = { embeds: eventMessage.payload.embeds, components: [] };
  await events.refreshRunningEventMessages(harness.client);
  assert.equal(eventMessage.payload.components.length, 2);

  await eventMessage.delete();
  await events.refreshRunningEventMessages(harness.client);
  assert.equal(harness.sentMessages.length, 2);
  assert.notEqual(eventsRepo.getEvent(event.id).message_id, eventMessage.id);

  await events.joinEvent(harness.interaction(participantA), event.id, 'tank');
  await events.spectateEvent(harness.interaction(participantB), event.id);
  await events.spectateEvent(harness.interaction(spectatorOnly), event.id);

  assertParticipant(event.id, participantA, { role: 'tank', isSpectator: 0 });
  assertParticipant(event.id, participantB, { role: 'spectator', isSpectator: 1 });
  assertParticipant(event.id, spectatorOnly, { role: 'spectator', isSpectator: 1 });

  const voice = await events.startEvent(harness.interaction(creator), event.id);
  assert.equal(voice.id, 'event-voice-1');
  assert.equal(eventsRepo.getEvent(event.id).status, 'running');

  const promotedRole = await events.autoJoinRunningEvent(harness.interaction(participantB), event.id);
  assert.equal(promotedRole, 'healer');
  assertParticipant(event.id, participantB, { role: 'healer', isSpectator: 0 });

  seedDeterministicVoiceTime(event.id, eventsRepo.getEvent(event.id), {
    participantA,
    participantB,
    spectatorOnly
  });

  const review = events.saveLootReview({
    eventId: event.id,
    lootTotal: 9000,
    repair: 0,
    silverBags: 0,
    taxPercent: 0,
    evidenceNotes: 'teste local'
  });
  assert.deepEqual(review, { netLoot: 9000 });

  const afterReview = eventsRepo.listParticipants(event.id);
  assert.equal(afterReview.find((item) => item.discord_id === participantA).calculated_seconds, 2700);
  assert.equal(afterReview.find((item) => item.discord_id === participantB).calculated_seconds, 1800);
  assert.equal(afterReview.find((item) => item.discord_id === spectatorOnly).calculated_seconds, 0);
  assert.equal(afterReview.find((item) => item.discord_id === participantA).payout_amount, 5400);
  assert.equal(afterReview.find((item) => item.discord_id === participantB).payout_amount, 3600);

  events.submitEventToFinance({ eventId: event.id, actorId: creator });
  assert.equal(eventsRepo.getEvent(event.id).status, 'pending_payment');

  const approval = events.approveEventPayment({ eventId: event.id, actorId: staff });
  assert.equal(approval.transactions.length, 2);
  assert.equal(eventsRepo.getEvent(event.id).status, 'approved');
  assert.equal(financeRepo.getBalance(participantA), 5400);
  assert.equal(financeRepo.getBalance(participantB), 3600);
  assertLedgerRows([
    { type: 'event_payout', user_id: participantA, amount: 5400, after_balance: 5400 },
    { type: 'event_payout', user_id: participantB, amount: 3600, after_balance: 3600 }
  ]);

  const withdraw = finance.requestWithdraw({ userId: participantA, amount: 1000, note: 'saque local' });
  finance.approveWithdraw({ requestId: withdraw.lastInsertRowid, actorId: staff });
  const paidWithdraw = finance.payWithdraw({ requestId: withdraw.lastInsertRowid, actorId: staff });
  assert.equal(paidWithdraw.amount, -1000);
  assert.equal(financeRepo.getBalance(participantA), 4400);
  assertLedgerRows([
    { type: 'withdraw_paid', user_id: participantA, amount: -1000, before_balance: 5400, after_balance: 4400 }
  ]);

  const draft = deposit.createDraft({
    actorId: staff,
    lootTotal: 3000,
    repair: 0,
    silverBags: 0,
    taxPercent: 0
  });
  deposit.addParticipants({ draftId: draft.id, userIds: [participantA, participantB] });
  const quickDeposit = await deposit.confirmDraft({ draftId: draft.id, actorId: staff, client: harness.client });
  assert.equal(quickDeposit.amount, 1500);
  assert.deepEqual(quickDeposit.participants, [participantA, participantB]);
  assert.equal(financeRepo.getBalance(participantA), 5900);
  assert.equal(financeRepo.getBalance(participantB), 5100);
  assertLedgerRows([
    { type: 'quick_deposit', user_id: participantA, amount: 1500, before_balance: 4400, after_balance: 5900 },
    { type: 'quick_deposit', user_id: participantB, amount: 1500, before_balance: 3600, after_balance: 5100 }
  ]);
});

test('deposito rapido bloqueia confirmacao sem participantes', async () => {
  const harness = createDiscordHarness();
  const draft = deposit.createDraft({
    actorId: '9001',
    lootTotal: 1000,
    repair: 0,
    silverBags: 0,
    taxPercent: 0
  });

  await assert.rejects(
    () => deposit.confirmDraft({ draftId: draft.id, actorId: '9001', client: harness.client }),
    /Selecione pelo menos um participante/
  );
  assert.equal(financeRepo.listTransactions().length, 0);
});

test('world boss cria 16 vagas e permite acumular DPS com Scout Mobile', async () => {
  const harness = createDiscordHarness();
  const creator = 'wb-creator';
  const playerA = 'wb-player-a';
  const playerB = 'wb-player-b';
  const event = await events.createWorldBossFromModal(harness.interaction(creator), {
    eventDate: '20/07/2026'
  });

  assert.equal(harness.sentMessages[0].channelId, '1526954695938019490');
  assert.equal(events.worldBossSlotOptions(event.id, playerA).length, 16);
  assert.match([...harness.messages.values()][0].payload.embeds[0].data.description, /TOTAL: 0\/16/);

  await events.joinWorldBossSlot(harness.interaction(playerA), event.id, 'main_tank');
  assertParticipant(event.id, playerA, { role: 'tank', isSpectator: 0 });
  assert.equal(eventsRepo.listWorldBossAssignments(event.id)[0].slot_key, 'main_tank');
  assert.equal(events.worldBossSlotOptions(event.id, playerB).length, 15);
  await assert.rejects(
    () => events.joinWorldBossSlot(harness.interaction(playerB), event.id, 'main_tank'),
    /ja esta ocupada/
  );

  await events.joinWorldBossSlot(harness.interaction(playerA), event.id, 'badon');
  assert.equal(eventsRepo.listWorldBossAssignments(event.id).length, 1);
  assert.equal(eventsRepo.listWorldBossAssignments(event.id)[0].slot_key, 'badon');
  assertParticipant(event.id, playerA, { role: 'support', isSpectator: 0 });

  await events.leaveWorldBoss(harness.interaction(playerA), event.id);
  assert.equal(eventsRepo.listWorldBossAssignments(event.id).length, 0);
  assert.equal(eventsRepo.getParticipant({ eventId: event.id, discordId: playerA }), undefined);

  await events.joinWorldBossSlot(harness.interaction(playerA), event.id, 'lightcaller');
  await events.joinWorldBossSlot(harness.interaction(playerA), event.id, 'scout_sw_gate');
  assert.equal(eventsRepo.listWorldBossAssignments(event.id).length, 2);
  assertParticipant(event.id, playerA, { role: 'dps', isSpectator: 0 });
  await events.removeWorldBossSlot(harness.interaction(playerA), event.id, 'scout_sw_gate');
  assert.deepEqual(
    eventsRepo.listWorldBossAssignments(event.id).map((assignment) => assignment.slot_key),
    ['lightcaller']
  );
});

function seedDeterministicVoiceTime(eventId, event, ids) {
  const db = getDatabase();
  const startedAt = '2026-07-08T10:00:00.000Z';
  const endedAt = '2026-07-08T11:00:00.000Z';

  eventsRepo.updateEvent(eventId, { started_at: startedAt, ended_at: endedAt });
  db.prepare('UPDATE event_participants SET joined_at = ? WHERE event_id = ? AND discord_id = ?')
    .run(startedAt, eventId, ids.participantA);
  db.prepare('UPDATE event_participants SET joined_at = ? WHERE event_id = ? AND discord_id = ?')
    .run('2026-07-08T10:30:00.000Z', eventId, ids.participantB);
  db.prepare('UPDATE event_participants SET joined_at = ? WHERE event_id = ? AND discord_id = ?')
    .run(startedAt, eventId, ids.spectatorOnly);

  db.prepare('DELETE FROM event_voice_sessions WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM voice_sessions WHERE channel_id = ?').run(event.voice_channel_id);

  eventsRepo.startVoiceSession({
    eventId,
    discordId: ids.participantA,
    joinedAt: '2026-07-08T09:50:00.000Z'
  });
  eventsRepo.closeOpenVoiceSession({
    eventId,
    discordId: ids.participantA,
    leftAt: '2026-07-08T10:20:00.000Z',
    seconds: 1800
  });
  insertGeneralVoiceSession({
    discordId: ids.participantA,
    channelId: event.voice_channel_id,
    joinedAt: '2026-07-08T10:15:00.000Z',
    leftAt: '2026-07-08T10:45:00.000Z'
  });
  insertGeneralVoiceSession({
    discordId: ids.participantB,
    channelId: event.voice_channel_id,
    joinedAt: '2026-07-08T10:00:00.000Z',
    leftAt: '2026-07-08T11:10:00.000Z'
  });
  insertGeneralVoiceSession({
    discordId: ids.spectatorOnly,
    channelId: event.voice_channel_id,
    joinedAt: '2026-07-08T10:00:00.000Z',
    leftAt: '2026-07-08T11:00:00.000Z'
  });
}

function insertGeneralVoiceSession({ discordId, channelId, joinedAt, leftAt }) {
  const seconds = Math.floor((Date.parse(leftAt) - Date.parse(joinedAt)) / 1000);
  getDatabase()
    .prepare(`
      INSERT INTO voice_sessions
        (discord_id, discord_name, channel_id, channel_name, joined_at, left_at, seconds)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(discordId, `User ${discordId}`, channelId, 'Evento local', joinedAt, leftAt, seconds);
}

function assertParticipant(eventId, discordId, expected) {
  const participant = eventsRepo.getParticipant({ eventId, discordId });
  assert.ok(participant, `participante ${discordId} deveria existir`);
  assert.equal(participant.role, expected.role);
  assert.equal(participant.is_spectator, expected.isSpectator);
}

function assertLedgerRows(expectedRows) {
  const transactions = financeRepo.listTransactions(100);
  for (const expected of expectedRows) {
    assert.ok(
      transactions.some((row) => Object.entries(expected).every(([key, value]) => row[key] === value)),
      `ledger deveria conter ${JSON.stringify(expected)}`
    );
  }
}

function resetDatabase() {
  const db = getDatabase();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'")
    .all()
    .map((row) => row.name);

  db.exec('PRAGMA foreign_keys = OFF');
  for (const table of tables) {
    db.prepare(`DELETE FROM "${table}"`).run();
  }
  db.prepare('DELETE FROM sqlite_sequence').run();
  db.exec('PRAGMA foreign_keys = ON');
}

function createDiscordHarness() {
  const messages = new Map();
  const channels = new Map();
  const members = new Map();
  const sentMessages = [];
  const sentDms = [];
  let messageSeq = 0;
  let voiceSeq = 0;

  function createTextChannel(id) {
    const channel = {
      id,
      isTextBased: () => true,
      messages: {
        fetch: async (messageId) => messages.get(messageId) || null
      },
      send: async (payload) => {
        const message = {
          id: `message-${++messageSeq}`,
          channel,
          payload,
          edit: async (nextPayload) => {
            message.payload = nextPayload;
            return message;
          },
          delete: async () => {
            messages.delete(message.id);
          }
        };
        messages.set(message.id, message);
        sentMessages.push({ channelId: id, payload });
        return message;
      }
    };
    channels.set(id, channel);
    return channel;
  }

  createTextChannel('test-events');

  const guild = {
    roles: {
      everyone: { id: 'everyone' },
      cache: new Map(),
      fetch: async (id) => id ? guild.roles.cache.get(id) || null : guild.roles.cache,
      create: async ({ name }) => {
        const role = {
          id: `role-${guild.roles.cache.size + 1}`,
          name,
          members: new Map(),
          deleted: false,
          delete: async () => { role.deleted = true; }
        };
        guild.roles.cache.set(role.id, role);
        return role;
      }
    },
    members: {
      fetch: async (id) => members.get(id) || null
    },
    channels: {
      create: async ({ type }) => {
        const voice = {
          id: `event-voice-${++voiceSeq}`,
          type,
          name: '🛡️・defesa',
          members: new Map(),
          deleted: false,
          delete: async () => { voice.deleted = true; }
        };
        channels.set(voice.id, voice);
        return voice;
      },
      fetch: async (id) => {
        if (!channels.has(id)) createTextChannel(id);
        return channels.get(id);
      }
    }
  };

  const client = {
    channels: {
      fetch: async (id) => {
        if (!channels.has(id)) createTextChannel(id);
        return channels.get(id);
      }
    },
    users: {
      fetch: async (id) => ({
        id,
        send: async (payload) => {
          sentDms.push({ userId: id, payload });
          return { id: `dm-${id}-${++messageSeq}`, payload };
        }
      })
    },
    guilds: {
      fetch: async () => guild
    },
    user: { id: 'bot' }
  };

  function addMember(id, { inVoice = false } = {}) {
    const member = {
      id,
      user: { id, username: `User ${id}`, globalName: `User ${id}` },
      displayName: `User ${id}`,
      roles: {
        cache: new Map(),
        add: async (role) => {
          const roleId = typeof role === 'string' ? role : role.id;
          member.roles.cache.set(roleId, role);
          if (typeof role !== 'string') role.members?.set(member.id, member);
        },
        remove: async (role) => {
          const roleId = typeof role === 'string' ? role : role.id;
          member.roles.cache.delete(roleId);
          if (typeof role !== 'string') role.members?.delete(member.id);
        }
      },
      voice: {
        channel: inVoice ? { id: 'lobby-voice' } : null,
        channelId: inVoice ? 'lobby-voice' : null,
        setChannel: async (channelOrId) => {
          const channelId = typeof channelOrId === 'string' ? channelOrId : channelOrId.id;
          member.voice.channelId = channelId;
          member.voice.channel = channels.get(channelId) || { id: channelId };
          return member;
        }
      }
    };
    members.set(id, member);
    return member;
  }

  function interaction(userId) {
    if (!members.has(userId)) addMember(userId);
    return {
      user: { id: userId },
      client,
      guild
    };
  }

  return {
    addMember,
    client,
    guild,
    interaction,
    messages,
    sentDms,
    sentMessages
  };
}
