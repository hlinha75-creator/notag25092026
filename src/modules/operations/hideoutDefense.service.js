const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase, transaction } = require('../../database/connection');
const finance = require('../finance/finance.service');
const accountLinks = require('../accounts/accountLinks.service');

const ANNOUNCEMENT_KEY = 'hideout-defense:sunstrand-shoal:2026-07-22';
const ACK_BUTTON_ID = 'ho_defense:ack:2026-07-22';
const PARTICIPATE_BUTTON_ID = 'ho_defense:participate:2026-07-22';
const START_BUTTON_ID = 'ho_defense:start:2026-07-22';
const DEFENSE_ROLE_NAME = 'Defesa';
const DEFENSE_VOICE_NAME = '🛡️・defesa';
const REMINDER_AT = new Date('2026-07-22T21:30:00.000Z');
const ADMIN_PROMPT_AT = new Date('2026-07-22T21:35:00.000Z');
const PREPARATION_AT = new Date('2026-07-22T21:45:00.000Z');
const DEFENSE_START_AT = new Date('2026-07-22T22:00:00.000Z');
const DEFENSE_END_AT = new Date('2026-07-22T22:15:00.000Z');
const REWARDS_AT = new Date('2026-07-22T23:15:00.000Z');
const REWARD_AMOUNT = 100000;

function ensureState() {
  const db = getDatabase();
  db.prepare(`
    INSERT OR IGNORE INTO hideout_defense_state (announcement_key)
    VALUES (?)
  `).run(ANNOUNCEMENT_KEY);
  return db.prepare(`
    SELECT * FROM hideout_defense_state WHERE announcement_key = ?
  `).get(ANNOUNCEMENT_KEY);
}

function updateState(fields) {
  const allowed = new Set([
    'role_id',
    'voice_channel_id',
    'reminder_sent_at',
    'admin_prompt_sent_at',
    'started_at',
    'cleaned_at',
    'rewards_processed_at',
    'congratulations_sent_at'
  ]);
  const entries = Object.entries(fields).filter(([key]) => allowed.has(key));
  if (!entries.length) return ensureState();
  ensureState();
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
  getDatabase().prepare(`
    UPDATE hideout_defense_state
    SET ${assignments}, updated_at = CURRENT_TIMESTAMP
    WHERE announcement_key = ?
  `).run(...entries.map(([, value]) => value), ANNOUNCEMENT_KEY);
  return ensureState();
}

function registeredUserIds() {
  return getDatabase().prepare(`
    SELECT user_id
    FROM announcement_acknowledgements
    WHERE announcement_key = ?
    UNION
    SELECT user_id
    FROM announcement_participations
    WHERE announcement_key = ?
    ORDER BY user_id
  `).all(ANNOUNCEMENT_KEY, ANNOUNCEMENT_KEY).map((row) => row.user_id);
}

const createDefenseRewards = transaction(() => {
  const db = getDatabase();
  const canonicalUserIds = [...new Set(registeredUserIds().map((userId) => accountLinks.resolvePrimaryUserId(userId)))];
  const existing = new Set(db.prepare(`
    SELECT user_id FROM hideout_defense_rewards WHERE announcement_key = ?
  `).all(ANNOUNCEMENT_KEY).map((row) => row.user_id));
  const pending = canonicalUserIds.filter((userId) => userId && !existing.has(userId));
  if (!pending.length) return [];

  const transactions = finance.applyManyTransactions(pending.map((userId) => ({
    type: 'hideout_defense_reward',
    userId,
    amount: REWARD_AMOUNT,
    reason: 'Parabéns pela cooperação na defesa da HO em Sunstrand Shoal',
    referenceType: 'hideout_defense',
    referenceId: ANNOUNCEMENT_KEY,
    createdBy: 'bot:hideout-defense'
  })));
  const insert = db.prepare(`
    INSERT INTO hideout_defense_rewards
      (announcement_key, user_id, amount, before_balance, after_balance)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const item of transactions) {
    insert.run(ANNOUNCEMENT_KEY, item.userId, item.amount, item.beforeBalance, item.afterBalance);
  }
  return transactions;
});

function listVoiceAttendees() {
  const state = ensureState();
  if (!state.voice_channel_id) return [];
  return getDatabase().prepare(`
    SELECT DISTINCT discord_id
    FROM voice_sessions
    WHERE channel_id = ?
      AND joined_at <= ?
    ORDER BY discord_id
  `).all(state.voice_channel_id, DEFENSE_END_AT.toISOString()).map((row) => row.discord_id);
}

function listAcknowledgements() {
  return getDatabase().prepare(`
    SELECT user_id, acknowledged_at
    FROM announcement_acknowledgements
    WHERE announcement_key = ?
      AND NOT EXISTS (
        SELECT 1
        FROM announcement_participations
        WHERE announcement_participations.announcement_key = announcement_acknowledgements.announcement_key
          AND announcement_participations.user_id = announcement_acknowledgements.user_id
      )
    ORDER BY acknowledged_at, user_id
  `).all(ANNOUNCEMENT_KEY);
}

function listParticipations() {
  return getDatabase().prepare(`
    SELECT user_id, participating_at
    FROM announcement_participations
    WHERE announcement_key = ?
    ORDER BY participating_at, user_id
  `).all(ANNOUNCEMENT_KEY);
}

const toggleAcknowledgement = transaction((userId) => {
  const db = getDatabase();
  const isParticipating = db.prepare(`
    SELECT 1
    FROM announcement_participations
    WHERE announcement_key = ? AND user_id = ?
  `).get(ANNOUNCEMENT_KEY, userId);
  if (isParticipating) {
    return {
      added: false,
      alreadyParticipating: true,
      acknowledgements: listAcknowledgements()
    };
  }

  const existing = db.prepare(`
    SELECT 1
    FROM announcement_acknowledgements
    WHERE announcement_key = ? AND user_id = ?
  `).get(ANNOUNCEMENT_KEY, userId);

  if (existing) {
    db.prepare(`
      DELETE FROM announcement_acknowledgements
      WHERE announcement_key = ? AND user_id = ?
    `).run(ANNOUNCEMENT_KEY, userId);
    return { added: false, acknowledgements: listAcknowledgements() };
  }

  db.prepare(`
    INSERT INTO announcement_acknowledgements (announcement_key, user_id)
    VALUES (?, ?)
  `).run(ANNOUNCEMENT_KEY, userId);
  return { added: true, acknowledgements: listAcknowledgements() };
});

const toggleParticipation = transaction((userId) => {
  const db = getDatabase();
  const existing = db.prepare(`
    SELECT 1
    FROM announcement_participations
    WHERE announcement_key = ? AND user_id = ?
  `).get(ANNOUNCEMENT_KEY, userId);

  if (existing) {
    db.prepare(`
      DELETE FROM announcement_participations
      WHERE announcement_key = ? AND user_id = ?
    `).run(ANNOUNCEMENT_KEY, userId);
    return { added: false, participations: listParticipations() };
  }

  db.prepare(`
    INSERT INTO announcement_participations (announcement_key, user_id)
    VALUES (?, ?)
  `).run(ANNOUNCEMENT_KEY, userId);
  db.prepare(`
    DELETE FROM announcement_acknowledgements
    WHERE announcement_key = ? AND user_id = ?
  `).run(ANNOUNCEMENT_KEY, userId);
  return { added: true, participations: listParticipations() };
});

function memberListFields(rows, labels) {
  if (!rows.length) {
    return [{ name: `${labels.title} (0)`, value: labels.empty }];
  }

  const chunks = [];
  let current = '';
  for (const row of rows) {
    const mention = `<@${row.user_id}>`;
    const candidate = current ? `${current}\n${mention}` : mention;
    if (candidate.length > 1000) {
      chunks.push(current);
      current = mention;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks.map((value, index) => ({
    name: index === 0 ? `${labels.title} (${rows.length})` : `${labels.title} (continuação)`,
    value
  }));
}

function announcementPayload(options = {}) {
  const acknowledgements = options.acknowledgements || listAcknowledgements();
  const participations = options.participations || listParticipations();
  const ended = options.ended ?? Date.now() >= DEFENSE_END_AT.getTime();
  const embed = new EmbedBuilder()
    .setColor(0xd97706)
    .setTitle('🛡️ DEFESA DA HO — SUNSTRAND SHOAL')
    .setDescription([
      'Hoje, **21/07**, concluímos a primeira fase da instalação da nossa HO em **Sunstrand Shoal**. Agora precisamos da força de todos para protegê-la durante a segunda fase!',
      '',
      'A presença de cada membro é fundamental. Venha fazer parte desta nova etapa e deixar seu nome marcado na história da nossa guilda!'
    ].join('\n'))
    .addFields(
      {
        name: '📅 Cronograma — 22/07 (UTC)',
        value: [
          '**21:45:** início da preparação',
          '**22:00:** todos já devem estar no mapa',
          '**22:00–22:15:** defesa da HO (15 minutos)'
        ].join('\n')
      },
      {
        name: '📍 Encontro e destino',
        value: '**Encontro:** Bridgewatch Portal / Smuggler Vulcano\n**Destino:** Sunstrand Shoal'
      },
      {
        name: '⚔️ Equipamento e composição',
        value: '**Build:** T8 equivalente\n**Estilo de luta:** Brawl'
      },
      {
        name: '💠 Por que essa HO é importante?',
        value: [
          'Ela nos ajudará a pontuar na temporada com **Orbs (Anomalias de Poder)** e permitirá organizar melhor a divisão dos loots dos **World Bosses**, realizados nos finais de semana entre **00:00 e 02:00 UTC**.'
        ].join('\n')
      },
      ...memberListFields(acknowledgements, {
        title: 'Membros cientes',
        empty: '*Nenhum membro confirmou a leitura ainda.*'
      }),
      ...memberListFields(participations, {
        title: 'Vão lutar',
        empty: '*Nenhum membro confirmou que vai lutar ainda.*'
      })
    )
    .setFooter({ text: 'Use “Eu li” para confirmar a leitura e “Vou lutar” para confirmar presença na defesa. Quem vai lutar aparece somente nessa lista.' });

  return {
    content: `<@&${ids.roles.member}>`,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ACK_BUTTON_ID)
          .setLabel('Eu li')
          .setEmoji('✅')
          .setDisabled(ended)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(PARTICIPATE_BUTTON_ID)
          .setLabel('Vou lutar')
          .setEmoji('⚔️')
          .setDisabled(ended)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(START_BUTTON_ID)
          .setLabel(ended ? 'Defesa encerrada' : 'Iniciar defesa')
          .setEmoji('🛡️')
          .setDisabled(ended)
          .setStyle(ButtonStyle.Danger)
      )
    ],
    allowedMentions: options.pingMembers
      ? { parse: [], roles: [ids.roles.member] }
      : { parse: [] }
  };
}

async function fetchGuild(client) {
  return client.guilds.cache?.get(ids.guildId)
    || client.guilds.fetch(ids.guildId).catch(() => null);
}

async function fetchStoredRole(guild) {
  const roleId = ensureState().role_id;
  if (!roleId) return null;
  return guild.roles.cache?.get(roleId)
    || guild.roles.fetch(roleId).catch(() => null);
}

async function ensureDefenseRole(guild, now = new Date()) {
  if (now >= DEFENSE_END_AT) return null;
  const state = ensureState();
  if (state.cleaned_at) return null;
  const existing = await fetchStoredRole(guild);
  if (existing) return existing;
  const role = await guild.roles.create({
    name: DEFENSE_ROLE_NAME,
    mentionable: true,
    reason: 'Tag temporaria da defesa da HO em Sunstrand Shoal'
  });
  updateState({ role_id: role.id });
  return role;
}

async function syncMemberDefenseRole(guild, userId, options = {}) {
  const now = options.now || new Date();
  const shouldHaveRole = now < DEFENSE_END_AT && registeredUserIds().includes(String(userId));
  const role = shouldHaveRole
    ? await ensureDefenseRole(guild, now)
    : await fetchStoredRole(guild);
  if (!role) return { changed: false, hasRole: false, role: null };

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { changed: false, hasRole: false, role };
  const currentlyHasRole = member.roles.cache?.has(role.id);
  if (shouldHaveRole && !currentlyHasRole) {
    await member.roles.add(role, 'Inscrito na defesa da HO');
    return { changed: true, hasRole: true, role };
  }
  if (!shouldHaveRole && currentlyHasRole) {
    await member.roles.remove(role, 'Saiu das listas da defesa da HO');
    return { changed: true, hasRole: false, role };
  }
  return { changed: false, hasRole: Boolean(currentlyHasRole), role };
}

async function syncAllDefenseRoles(guild, options = {}) {
  const now = options.now || new Date();
  const registered = new Set(registeredUserIds());
  const role = registered.size
    ? await ensureDefenseRole(guild, now)
    : await fetchStoredRole(guild);
  if (!role) return { role: null, added: 0, removed: 0 };

  let added = 0;
  let removed = 0;
  for (const userId of registered) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && !member.roles.cache?.has(role.id)) {
      await member.roles.add(role, 'Inscrito na defesa da HO').then(() => { added += 1; }).catch(() => {});
    }
  }
  for (const member of role.members?.values?.() || []) {
    if (!registered.has(member.id)) {
      await member.roles.remove(role, 'Nao esta mais inscrito na defesa da HO').then(() => { removed += 1; }).catch(() => {});
    }
  }
  return { role, added, removed };
}

async function fetchAnnouncementChannel(client) {
  const channel = await client.channels.fetch(ids.channels.campaignAnnouncements).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}

async function sendRegisteredNotice(channel, userIds, text) {
  const chunks = [];
  for (let index = 0; index < userIds.length; index += 50) chunks.push(userIds.slice(index, index + 50));
  if (!chunks.length) chunks.push([]);
  const messages = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const users = chunks[index];
    const mentions = users.map((userId) => `<@${userId}>`).join(' ');
    const content = [index === 0 ? text : '**Continuação dos inscritos:**', mentions].filter(Boolean).join('\n\n');
    messages.push(await channel.send({
      content,
      allowedMentions: { parse: [], users }
    }));
  }
  return messages;
}

async function sendThirtyMinuteReminder(client, now = REMINDER_AT) {
  const channel = await fetchAnnouncementChannel(client);
  if (!channel) throw new Error('Canal de avisos da defesa nao encontrado.');
  const users = registeredUserIds();
  const minutesUntilDefense = Math.max(0, Math.ceil((DEFENSE_START_AT.getTime() - now.getTime()) / 60000));
  const movementWarning = now < ADMIN_PROMPT_AT
    ? 'Em **5 minutos**, a ADM poderá iniciar a organização e mover os inscritos que já estiverem conectados em uma sala de voz.'
    : 'A ADM já pode iniciar a organização e mover os inscritos que estiverem conectados em uma sala de voz.';
  await sendRegisteredNotice(channel, users, [
    `## 🛡️ DEFESA DA HO EM ${minutesUntilDefense} MINUTOS`,
    movementWarning,
    '',
    '**21:45 UTC:** preparação no Bridgewatch Portal / Smuggler Vulcano',
    '**22:00 UTC:** todos em Sunstrand Shoal',
    '**22:00–22:15 UTC:** defesa da HO',
    '**Build:** T8 equivalente — Brawl',
    '',
    'Entre em uma call antes da movimentação e deixe sua build pronta.'
  ].join('\n'));
  updateState({ reminder_sent_at: now.toISOString() });
  return { notified: users.length };
}

function startPromptComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(START_BUTTON_ID)
        .setLabel('Iniciar defesa')
        .setEmoji('🛡️')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

async function sendAdminStartPrompt(client) {
  const channel = await fetchAnnouncementChannel(client);
  if (!channel) throw new Error('Canal de avisos da defesa nao encontrado.');
  const message = await channel.send({
    content: [
      `<@&${ids.roles.adm}> **hora de organizar a defesa.**`,
      'Aperte **Iniciar defesa** para criar a sala temporária e puxar todos os inscritos que já estiverem conectados em voz.',
      'A preparação começa às **21:45 UTC** e todos devem estar no mapa às **22:00 UTC**.'
    ].join('\n'),
    components: startPromptComponents(),
    allowedMentions: { parse: [], roles: [ids.roles.adm] }
  });
  updateState({ admin_prompt_sent_at: new Date().toISOString() });
  return message;
}

async function ensureDefenseVoice(guild) {
  const state = ensureState();
  if (state.voice_channel_id) {
    const existing = guild.channels.cache?.get(state.voice_channel_id)
      || await guild.channels.fetch(state.voice_channel_id).catch(() => null);
    if (existing) return existing;
  }
  const waiting = guild.channels.cache?.get(ids.channels.waitingVoice)
    || await guild.channels.fetch(ids.channels.waitingVoice).catch(() => null);
  const voice = await guild.channels.create({
    name: DEFENSE_VOICE_NAME,
    type: ChannelType.GuildVoice,
    parent: waiting?.parentId || undefined,
    reason: 'Sala temporaria da defesa da HO em Sunstrand Shoal'
  });
  updateState({ voice_channel_id: voice.id });
  return voice;
}

async function startDefense({ client, guild, actorId, now = new Date() }) {
  if (now < ADMIN_PROMPT_AT) throw new Error('O botão Iniciar defesa ficará disponível às 21:35 UTC.');
  if (now >= DEFENSE_END_AT) throw new Error('A janela da defesa terminou às 22:15 UTC.');
  await syncAllDefenseRoles(guild, { now });
  const voice = await ensureDefenseVoice(guild);
  const moved = [];
  const notConnected = [];
  const failed = [];

  for (const userId of registeredUserIds()) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member?.voice?.channelId) {
      notConnected.push(userId);
      continue;
    }
    if (member.voice.channelId === voice.id) {
      moved.push(userId);
      continue;
    }
    await member.voice.setChannel(voice, `Defesa da HO iniciada por ${actorId}`)
      .then(() => moved.push(userId))
      .catch(() => failed.push(userId));
  }

  const state = ensureState();
  if (!state.started_at) updateState({ started_at: now.toISOString() });
  const channel = await fetchAnnouncementChannel(client);
  if (channel) {
    const missingMentions = [...notConnected, ...failed].map((userId) => `<@${userId}>`).join(' ');
    await channel.send({
      content: [
        `## 🛡️ DEFESA INICIADA — <#${voice.id}>`,
        `Movidos para a sala: **${moved.length}**`,
        `Fora da call ou não movidos: **${notConnected.length + failed.length}**`,
        '',
        '**Preparação agora:** build T8 equivalente, composição Brawl e saída pelo Bridgewatch Portal / Smuggler Vulcano.',
        '**21:45 UTC:** preparação | **22:00 UTC:** no mapa | **22:15 UTC:** fim da defesa',
        missingMentions ? `\nEntrem em uma sala de voz para a organização: ${missingMentions}` : null
      ].filter(Boolean).join('\n'),
      allowedMentions: { parse: [], users: [...notConnected, ...failed] }
    });
  }
  return { voice, moved, notConnected, failed };
}

async function cleanupDefense(client, now = new Date()) {
  const state = ensureState();
  if (state.cleaned_at) return { cleaned: false };
  const guild = await fetchGuild(client);
  if (!guild) throw new Error('Servidor da guilda nao encontrado para limpar a defesa.');

  const voice = state.voice_channel_id
    ? guild.channels.cache?.get(state.voice_channel_id) || await guild.channels.fetch(state.voice_channel_id).catch(() => null)
    : null;
  if (voice) await voice.delete('Fim da defesa da HO');
  const role = await fetchStoredRole(guild);
  if (role) await role.delete('Fim da defesa da HO');
  updateState({ cleaned_at: now.toISOString() });

  const reminder = getDatabase().prepare(`
    SELECT message_id, channel_id FROM operation_reminders WHERE reminder_key = ?
  `).get(ANNOUNCEMENT_KEY);
  if (reminder?.message_id && reminder?.channel_id) {
    const channel = await client.channels.fetch(reminder.channel_id).catch(() => null);
    const message = channel?.isTextBased()
      ? await channel.messages.fetch(reminder.message_id).catch(() => null)
      : null;
    await message?.edit(announcementPayload({ ended: true })).catch(() => {});
  }
  return { cleaned: true };
}

async function notifyRewardedMembers(client) {
  const db = getDatabase();
  const pending = db.prepare(`
    SELECT user_id, amount, before_balance, after_balance
    FROM hideout_defense_rewards
    WHERE announcement_key = ? AND notification_sent_at IS NULL
    ORDER BY user_id
  `).all(ANNOUNCEMENT_KEY);
  for (const row of pending) {
    await finance.notifyBalanceTransactions({
      client,
      transactions: [{
        type: 'hideout_defense_reward',
        userId: row.user_id,
        amount: row.amount,
        reason: 'Parabéns pela cooperação na defesa da HO em Sunstrand Shoal',
        beforeBalance: row.before_balance,
        afterBalance: row.after_balance
      }]
    });
    db.prepare(`
      UPDATE hideout_defense_rewards
      SET notification_sent_at = CURRENT_TIMESTAMP
      WHERE announcement_key = ? AND user_id = ?
    `).run(ANNOUNCEMENT_KEY, row.user_id);
  }
  return pending.length;
}

async function postAttendanceCongratulations(client) {
  const attendees = listVoiceAttendees();
  const channel = await client.channels.fetch(ids.channels.notagChat).catch(() => null);
  if (!channel?.isTextBased()) throw new Error('Chat NoTag nao encontrado para publicar os parabens da defesa.');
  await sendRegisteredNotice(channel, attendees, [
    '## 🏆 PARABÉNS PELA DEFESA DA HO!',
    attendees.length
      ? `Os **${attendees.length} membros** abaixo compareceram à sala de defesa e fizeram parte deste momento importante para a guilda:`
      : 'A defesa foi encerrada, mas não foi possível identificar presença na sala de voz.',
    '',
    'Obrigado pela cooperação, organização e por ajudarem a escrever mais um capítulo da história da NoTag! ⚔️🛡️'
  ].join('\n'));
  return attendees;
}

async function processPostEventRewards(client, now = new Date()) {
  if (now < REWARDS_AT) return { processed: false, reason: 'too_early' };
  let state = ensureState();
  let transactions = [];
  let notified = 0;
  if (!state.rewards_processed_at) {
    transactions = createDefenseRewards();
    notified = await notifyRewardedMembers(client);
    updateState({ rewards_processed_at: now.toISOString() });
  }

  state = ensureState();
  let attendees = [];
  if (!state.congratulations_sent_at) {
    attendees = await postAttendanceCongratulations(client);
    updateState({ congratulations_sent_at: now.toISOString() });
  }
  const totalRewards = getDatabase().prepare(`
    SELECT COUNT(*) AS total FROM hideout_defense_rewards WHERE announcement_key = ?
  `).get(ANNOUNCEMENT_KEY).total;
  return {
    processed: true,
    newRewards: transactions.length,
    totalRewards: Number(totalRewards || 0),
    notified,
    attendees
  };
}

let scheduleRunning = false;
async function processSchedule(client, now = new Date()) {
  if (scheduleRunning) return { skipped: true };
  scheduleRunning = true;
  try {
    const state = ensureState();
    if (now >= DEFENSE_END_AT) {
      const cleanup = await cleanupDefense(client, now);
      const rewards = now >= REWARDS_AT
        ? await processPostEventRewards(client, now)
        : { processed: false, reason: 'too_early' };
      return { cleanup, rewards };
    }
    const guild = await fetchGuild(client);
    if (!guild) throw new Error('Servidor da guilda nao encontrado para preparar a defesa.');
    await syncAllDefenseRoles(guild, { now });
    const actions = [];
    if (now >= REMINDER_AT && now < DEFENSE_START_AT && !state.reminder_sent_at) {
      actions.push(await sendThirtyMinuteReminder(client, now));
    }
    const currentState = ensureState();
    if (now >= ADMIN_PROMPT_AT && !currentState.admin_prompt_sent_at) {
      actions.push(await sendAdminStartPrompt(client));
    }
    return { actions };
  } finally {
    scheduleRunning = false;
  }
}

async function postAnnouncementIfNeeded(client, now = new Date()) {
  if (now >= DEFENSE_END_AT) {
    return { message: null, created: false, expired: true };
  }
  const db = getDatabase();
  const existing = db.prepare(`
    SELECT message_id, channel_id
    FROM operation_reminders
    WHERE reminder_key = ?
  `).get(ANNOUNCEMENT_KEY);

  if (existing?.message_id && existing?.channel_id) {
    const existingChannel = await client.channels.fetch(existing.channel_id).catch(() => null);
    const existingMessage = existingChannel?.isTextBased()
      ? await existingChannel.messages.fetch(existing.message_id).catch(() => null)
      : null;
    if (existingMessage) {
      await existingMessage.edit(announcementPayload());
      return { message: existingMessage, created: false };
    }
  }

  const channel = await client.channels.fetch(ids.channels.campaignAnnouncements).catch(() => null);
  if (!channel?.isTextBased()) {
    throw new Error(`Canal de avisos ${ids.channels.campaignAnnouncements} nao encontrado ou nao e um canal de texto.`);
  }

  const message = await channel.send(announcementPayload({ pingMembers: true }));
  db.prepare(`
    INSERT INTO operation_reminders (reminder_key, type, message_id, channel_id)
    VALUES (?, 'hideout_defense', ?, ?)
    ON CONFLICT(reminder_key) DO UPDATE SET
      message_id = excluded.message_id,
      channel_id = excluded.channel_id,
      sent_at = CURRENT_TIMESTAMP
  `).run(ANNOUNCEMENT_KEY, message.id, channel.id);
  return { message, created: true };
}

module.exports = {
  ANNOUNCEMENT_KEY,
  ACK_BUTTON_ID,
  BUTTON_ID: ACK_BUTTON_ID,
  DEFENSE_END_AT,
  PARTICIPATE_BUTTON_ID,
  REWARD_AMOUNT,
  REWARDS_AT,
  START_BUTTON_ID,
  announcementPayload,
  cleanupDefense,
  ensureDefenseRole,
  ensureState,
  listAcknowledgements,
  listParticipations,
  listVoiceAttendees,
  processPostEventRewards,
  postAnnouncementIfNeeded,
  processSchedule,
  registeredUserIds,
  sendAdminStartPrompt,
  sendThirtyMinuteReminder,
  startDefense,
  syncAllDefenseRoles,
  syncMemberDefenseRole,
  toggleAcknowledgement,
  toggleParticipation
};
