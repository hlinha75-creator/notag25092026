const { getDatabase, transaction } = require('../../database/connection');

function nextEventCode() {
  const row = getDatabase().prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get('events');
  const next = (row?.seq || 0) + 1;
  return `EVT-${String(next).padStart(6, '0')}`;
}

function createEvent(data) {
  const eventCode = nextEventCode();
  const payload = { audience: 'public', contentType: 'other', ...data, eventCode };
  const result = getDatabase()
    .prepare(`
      INSERT INTO events
        (event_code, creator_id, title, description, location, scheduled_time, tank_slots, healer_slots, support_slots, dps_slots, audience, content_type)
      VALUES
        (@eventCode, @creatorId, @title, @description, @location, @scheduledTime, @tankSlots, @healerSlots, @supportSlots, @dpsSlots, @audience, @contentType)
    `)
    .run(payload);
  return getEvent(result.lastInsertRowid);
}

function getEvent(id) {
  return getDatabase().prepare('SELECT * FROM events WHERE id = ?').get(id);
}

function getEventByCode(eventCode) {
  return getDatabase().prepare('SELECT * FROM events WHERE event_code = ?').get(eventCode);
}

function getEventByVoiceChannel(voiceChannelId) {
  return getDatabase().prepare('SELECT * FROM events WHERE voice_channel_id = ? AND status = ?').get(voiceChannelId, 'running');
}

function getLastCommonEventConfiguration(creatorId) {
  return getDatabase().prepare(`
    SELECT e.*
    FROM events e
    WHERE e.creator_id = ?
      AND e.message_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM custom_events ce WHERE ce.event_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM raid_avalon_events rae WHERE rae.event_id = e.id)
      AND NOT EXISTS (SELECT 1 FROM world_boss_events wbe WHERE wbe.event_id = e.id)
    ORDER BY e.id DESC
    LIMIT 1
  `).get(creatorId);
}

function getLastCustomEventConfiguration(creatorId) {
  const event = getDatabase().prepare(`
    SELECT e.*, ce.event_day, ce.time_range, ce.loot_rules, ce.consumables, ce.mount_requirement, ce.dps_policy
    FROM events e
    JOIN custom_events ce ON ce.event_id = e.id
    WHERE e.creator_id = ?
      AND e.message_id IS NOT NULL
    ORDER BY e.id DESC
    LIMIT 1
  `).get(creatorId);
  if (!event) return null;
  return { ...event, slots: listCustomEventSlots(event.id), dpsPool: listCustomEventDpsWeapons(event.id) };
}

function listRecentEventConfigurations(creatorId, kind, limit = 5, contentType = null) {
  const safeLimit = Math.max(1, Math.min(5, Number(limit) || 5));
  const queryLimit = contentType ? 50 : safeLimit;
  const queries = {
    common: `
      SELECT e.* FROM events e
      WHERE e.creator_id = ? AND e.message_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM custom_events ce WHERE ce.event_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM raid_avalon_events rae WHERE rae.event_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM world_boss_events wbe WHERE wbe.event_id = e.id)
      ORDER BY e.id DESC LIMIT ?`,
    custom: `
      SELECT e.*, ce.event_day, ce.time_range, ce.loot_rules, ce.consumables, ce.mount_requirement, ce.dps_policy
      FROM events e JOIN custom_events ce ON ce.event_id = e.id
      WHERE e.creator_id = ? AND e.message_id IS NOT NULL
      ORDER BY e.id DESC LIMIT ?`,
    raid: `
      SELECT e.*, rae.dungeon_tier, rae.build_tier
      FROM events e JOIN raid_avalon_events rae ON rae.event_id = e.id
      WHERE e.creator_id = ? AND e.message_id IS NOT NULL
      ORDER BY e.id DESC LIMIT ?`,
    world: `
      SELECT e.*, wbe.massing
      FROM events e JOIN world_boss_events wbe ON wbe.event_id = e.id
      WHERE e.creator_id = ? AND e.message_id IS NOT NULL
      ORDER BY e.id DESC LIMIT ?`
  };
  if (!queries[kind]) return [];
  const events = getDatabase().prepare(queries[kind]).all(creatorId, queryLimit).map((event) => (
    kind === 'custom' ? {
      ...event,
      slots: listCustomEventSlots(event.id),
      dpsPool: listCustomEventDpsWeapons(event.id)
    } : event
  ));
  return events
    .filter((event) => !contentType || event.content_type === contentType)
    .slice(0, safeLimit);
}

function getEventConfiguration(creatorId, kind, eventId) {
  const event = getEvent(Number(eventId));
  if (!event || String(event.creator_id) !== String(creatorId) || !event.message_id) return null;
  const custom = getCustomEventMeta(event.id);
  const raid = getRaidAvalonEventMeta(event.id);
  const world = getWorldBossEventMeta(event.id);
  const visualBuilds = getVisualEventBuildMeta(event.id);
  if (kind === 'common' && !custom && !raid && !world) {
    return visualBuilds ? { ...event, ...visualBuilds, slots: listCustomEventSlots(event.id) } : event;
  }
  if (kind === 'custom' && custom) return {
    ...event,
    ...custom,
    slots: listCustomEventSlots(event.id),
    dpsPool: listCustomEventDpsWeapons(event.id)
  };
  if (kind === 'raid' && raid) return { ...event, ...raid, ...(visualBuilds || {}), slots: visualBuilds ? listCustomEventSlots(event.id) : [] };
  if (kind === 'world' && world) return { ...event, ...world, ...(visualBuilds || {}), slots: visualBuilds ? listCustomEventSlots(event.id) : [] };
  return null;
}

function saveEventConfiguration({ creatorId, eventId, kind, contentType, name }) {
  const configuration = getEventConfiguration(creatorId, kind, eventId);
  if (!configuration) throw new Error('O evento não está disponível para salvar como configuração.');
  const cleanName = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!cleanName) throw new Error('Informe um nome para a configuração.');
  const payload = JSON.stringify(configuration);
  getDatabase().prepare(`
    INSERT INTO event_templates
      (creator_id, name, title, location, requirements, composition,
       tank_slots, healer_slots, support_slots, dps_slots,
       kind, content_type, source_event_id, config_json)
    VALUES
      (@creatorId, @name, @title, @location, @requirements, @composition,
       @tankSlots, @healerSlots, @supportSlots, @dpsSlots,
       @kind, @contentType, @sourceEventId, @configJson)
    ON CONFLICT(creator_id, name) DO UPDATE SET
      title = excluded.title,
      location = excluded.location,
      requirements = excluded.requirements,
      composition = excluded.composition,
      tank_slots = excluded.tank_slots,
      healer_slots = excluded.healer_slots,
      support_slots = excluded.support_slots,
      dps_slots = excluded.dps_slots,
      kind = excluded.kind,
      content_type = excluded.content_type,
      source_event_id = excluded.source_event_id,
      config_json = excluded.config_json,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    creatorId: String(creatorId),
    name: cleanName,
    title: configuration.title || cleanName,
    location: configuration.location || null,
    requirements: configuration.description || null,
    composition: [configuration.tank_slots, configuration.healer_slots, configuration.support_slots, configuration.dps_slots].join(','),
    tankSlots: Number(configuration.tank_slots || 0),
    healerSlots: Number(configuration.healer_slots || 0),
    supportSlots: Number(configuration.support_slots || 0),
    dpsSlots: Number(configuration.dps_slots || 0),
    kind,
    contentType,
    sourceEventId: Number(eventId),
    configJson: payload
  });
  return getDatabase().prepare('SELECT * FROM event_templates WHERE creator_id = ? AND name = ?').get(String(creatorId), cleanName);
}

function listSavedEventConfigurations(creatorId, kind, contentType, limit = 25) {
  return getDatabase().prepare(`
    SELECT * FROM event_templates
    WHERE creator_id = ? AND kind = ? AND content_type = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(String(creatorId), kind, contentType, Math.max(1, Math.min(25, Number(limit) || 25)));
}

function listAllSavedEventConfigurations(creatorId, limit = 100) {
  return getDatabase().prepare(`
    SELECT * FROM event_templates
    WHERE creator_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(String(creatorId), Math.max(1, Math.min(100, Number(limit) || 100)));
}

function getSavedEventConfiguration(creatorId, templateId) {
  const row = getDatabase().prepare('SELECT * FROM event_templates WHERE id = ? AND creator_id = ?').get(Number(templateId), String(creatorId));
  if (!row) return null;
  try {
    return { ...JSON.parse(row.config_json || '{}'), template_id: row.id, template_name: row.name };
  } catch {
    return null;
  }
}

function deleteSavedEventConfiguration(creatorId, templateId) {
  return getDatabase().prepare('DELETE FROM event_templates WHERE id = ? AND creator_id = ?').run(Number(templateId), String(creatorId)).changes > 0;
}

function listActiveEvents() {
  return getDatabase().prepare("SELECT * FROM events WHERE status = 'running'").all();
}

function listInactiveEventsWithVoiceChannels(limit = 500) {
  return getDatabase()
    .prepare(`
      SELECT *
      FROM events
      WHERE voice_channel_id IS NOT NULL
        AND status <> 'running'
      ORDER BY id DESC
      LIMIT ?
    `)
    .all(Math.max(1, Math.min(Number(limit) || 500, 2000)));
}

function listInteractiveEvents() {
  return getDatabase()
    .prepare("SELECT * FROM events WHERE status IN ('created', 'running')")
    .all();
}

function listApprovedEventsForCareer() {
  return getDatabase()
    .prepare(`
      SELECT e.*
      FROM events e
      WHERE e.status = 'approved'
      ORDER BY e.id ASC
    `)
    .all();
}

function listPendingWarningEvents() {
  return getDatabase()
    .prepare("SELECT * FROM events WHERE status = 'created' AND COALESCE(warning_sent, 0) = 0 AND scheduled_time IS NOT NULL")
    .all();
}

function listPendingReminderEvents() {
  return getDatabase()
    .prepare(`
      SELECT *
      FROM events
      WHERE status IN ('created', 'running')
        AND scheduled_time IS NOT NULL
    `)
    .all();
}

function hasReminderDispatch({ eventId, phase, channelId }) {
  return Boolean(getDatabase().prepare(`
    SELECT 1 FROM event_reminder_dispatches
    WHERE event_id = ? AND phase = ? AND channel_id = ?
  `).get(eventId, String(phase), String(channelId)));
}

function markReminderDispatch({ eventId, phase, channelId, messageId }) {
  return getDatabase().prepare(`
    INSERT OR IGNORE INTO event_reminder_dispatches
      (event_id, phase, channel_id, message_id)
    VALUES (?, ?, ?, ?)
  `).run(eventId, String(phase), String(channelId), messageId || null);
}

function clearEventReminderDispatches(eventId) {
  return transaction(() => {
    const db = getDatabase();
    db.prepare('DELETE FROM event_reminder_dispatches WHERE event_id = ?').run(eventId);
    db.prepare('DELETE FROM event_notification_dm_dispatches WHERE event_id = ?').run(eventId);
  })();
}

function listEventsWithTempRoles() {
  return getDatabase()
    .prepare('SELECT * FROM events WHERE warning_role_id IS NOT NULL')
    .all();
}

function updateEvent(id, patch) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return getEvent(id);
  const setSql = entries.map(([key]) => `${key} = @${key}`).join(', ');
  getDatabase()
    .prepare(`UPDATE events SET ${setSql}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
    .run({ id, ...Object.fromEntries(entries) });
  return getEvent(id);
}

function upsertParticipant({
  eventId,
  discordId,
  role,
  isSpectator = 0,
  isPaused = 0,
  customSlotIndex = null,
  customWeaponKey = null,
  joinedAt = new Date().toISOString()
}) {
  return getDatabase()
    .prepare(`
      INSERT INTO event_participants
        (event_id, discord_id, role, is_spectator, is_paused, custom_slot_index, custom_weapon_key, joined_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id, discord_id) DO UPDATE SET
        role = excluded.role,
        is_spectator = excluded.is_spectator,
        is_paused = excluded.is_paused,
        custom_slot_index = excluded.custom_slot_index,
        custom_weapon_key = excluded.custom_weapon_key,
        joined_at = CASE
          WHEN event_participants.is_spectator = 1 AND excluded.is_spectator = 0 THEN excluded.joined_at
          ELSE event_participants.joined_at
        END
    `)
    .run(eventId, discordId, role, isSpectator ? 1 : 0, isPaused ? 1 : 0, customSlotIndex, customWeaponKey, joinedAt);
}

function removeParticipant({ eventId, discordId }) {
  return getDatabase().prepare('DELETE FROM event_participants WHERE event_id = ? AND discord_id = ?').run(eventId, discordId);
}

function listParticipants(eventId) {
  return getDatabase().prepare('SELECT * FROM event_participants WHERE event_id = ? ORDER BY is_spectator, role, joined_at').all(eventId);
}

function getParticipant({ eventId, discordId }) {
  return getDatabase().prepare('SELECT * FROM event_participants WHERE event_id = ? AND discord_id = ?').get(eventId, discordId);
}

function startVoiceSession({ eventId, discordId, joinedAt }) {
  const open = getOpenVoiceSession({ eventId, discordId });
  if (open) return { changes: 0, lastInsertRowid: open.id };
  return getDatabase()
    .prepare('INSERT INTO event_voice_sessions (event_id, discord_id, joined_at) VALUES (?, ?, ?)')
    .run(eventId, discordId, joinedAt);
}

function closeOpenVoiceSession({ eventId, discordId, leftAt, seconds }) {
  return getDatabase()
    .prepare(`
      UPDATE event_voice_sessions
      SET left_at = ?, seconds = ?
      WHERE event_id = ? AND discord_id = ? AND left_at IS NULL
    `)
    .run(leftAt, seconds, eventId, discordId);
}

function getOpenVoiceSession({ eventId, discordId }) {
  return getDatabase()
    .prepare('SELECT * FROM event_voice_sessions WHERE event_id = ? AND discord_id = ? AND left_at IS NULL ORDER BY id DESC LIMIT 1')
    .get(eventId, discordId);
}

function refreshParticipantSeconds(eventId) {
  const db = getDatabase();
  const event = getEvent(eventId);
  if (!event?.started_at) return;

  const eventStart = parseTimestamp(event.started_at);
  const eventEnd = parseTimestamp(event.ended_at || new Date().toISOString());
  const participants = listParticipants(eventId).filter((participant) => !participant.is_spectator);
  const eventSessions = db
    .prepare('SELECT * FROM event_voice_sessions WHERE event_id = ? ORDER BY discord_id, joined_at')
    .all(eventId);
  const generalVoiceSessions = event.voice_channel_id
    ? db
      .prepare(`
        SELECT discord_id, joined_at, left_at
        FROM voice_sessions
        WHERE channel_id = ?
        ORDER BY discord_id, joined_at
      `)
      .all(event.voice_channel_id)
    : [];
  const sessions = [...eventSessions, ...generalVoiceSessions];

  for (const participant of participants) {
    const participantJoinedAt = parseTimestamp(participant.joined_at);
    const participantStart = Number.isFinite(participantJoinedAt)
      ? Math.max(eventStart, participantJoinedAt)
      : eventStart;
    const intervals = sessions
      .filter((session) => session.discord_id === participant.discord_id)
      .map((session) => {
        const start = Math.max(participantStart, parseTimestamp(session.joined_at));
        const end = Math.min(eventEnd, parseTimestamp(session.left_at || new Date().toISOString()));
        return { start, end };
      })
      .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
      .sort((a, b) => a.start - b.start);

    let total = 0;
    let current = null;
    for (const interval of intervals) {
      if (!current) {
        current = { ...interval };
      } else if (interval.start <= current.end) {
        current.end = Math.max(current.end, interval.end);
      } else {
        total += current.end - current.start;
        current = { ...interval };
      }
    }
    if (current) total += current.end - current.start;

    db.prepare('UPDATE event_participants SET calculated_seconds = ? WHERE event_id = ? AND discord_id = ?')
      .run(Math.floor(total / 1000), eventId, participant.discord_id);
  }
}

function parseTimestamp(value) {
  if (!value) return Number.NaN;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return Date.parse(`${text.replace(' ', 'T')}Z`);
  }
  return Date.parse(text);
}

function setParticipantReview({ eventId, discordId, role, manualSeconds }) {
  return getDatabase()
    .prepare('UPDATE event_participants SET role = ?, manual_seconds = ? WHERE event_id = ? AND discord_id = ?')
    .run(role, manualSeconds, eventId, discordId);
}

function setParticipantPayout({ eventId, discordId, payoutAmount }) {
  return getDatabase()
    .prepare('UPDATE event_participants SET payout_amount = ? WHERE event_id = ? AND discord_id = ?')
    .run(payoutAmount, eventId, discordId);
}

function clearParticipantPayouts(eventId) {
  return getDatabase()
    .prepare('UPDATE event_participants SET payout_amount = 0 WHERE event_id = ?')
    .run(eventId);
}

function upsertReview(data) {
  return getDatabase()
    .prepare(`
      INSERT INTO event_reviews (event_id, loot_total, repair, silver_bags, tax_percent, net_loot, status)
      VALUES (@eventId, @lootTotal, @repair, @silverBags, @taxPercent, @netLoot, @status)
      ON CONFLICT(event_id) DO UPDATE SET
        loot_total = excluded.loot_total,
        repair = excluded.repair,
        silver_bags = excluded.silver_bags,
        tax_percent = excluded.tax_percent,
        net_loot = excluded.net_loot,
        status = excluded.status
    `)
    .run(data);
}

function getReview(eventId) {
  return getDatabase().prepare('SELECT * FROM event_reviews WHERE event_id = ?').get(eventId);
}

function listWorkflowReviews(limit = 200) {
  return getDatabase()
    .prepare(`
      SELECT er.event_id, e.status
      FROM event_reviews er
      JOIN events e ON e.id = er.event_id
      WHERE er.review_message_id IS NOT NULL
         OR er.finance_message_id IS NOT NULL
         OR e.status IN ('review', 'pending_payment')
      ORDER BY er.event_id DESC
      LIMIT ?
    `)
    .all(Math.max(1, Math.min(Number(limit) || 200, 500)));
}

function listReviewEvents(limit = 200) {
  return getDatabase()
    .prepare(`
      SELECT e.*
      FROM events e
      JOIN event_reviews er ON er.event_id = e.id
      WHERE e.status = 'review'
      ORDER BY e.id DESC
      LIMIT ?
    `)
    .all(Math.max(1, Math.min(Number(limit) || 200, 500)));
}

function updateReviewMetadata(eventId, patch) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return getReview(eventId);
  const setSql = entries.map(([key]) => `${key} = @${key}`).join(', ');
  getDatabase()
    .prepare(`UPDATE event_reviews SET ${setSql} WHERE event_id = @eventId`)
    .run({ eventId, ...Object.fromEntries(entries) });
  return getReview(eventId);
}

function createRaidAvalonEventMeta({ eventId, dungeonTier, buildTier }) {
  return getDatabase()
    .prepare(`
      INSERT INTO raid_avalon_events (event_id, dungeon_tier, build_tier)
      VALUES (?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        dungeon_tier = excluded.dungeon_tier,
        build_tier = excluded.build_tier,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run(eventId, dungeonTier, buildTier);
}

function getRaidAvalonEventMeta(eventId) {
  return getDatabase().prepare('SELECT * FROM raid_avalon_events WHERE event_id = ?').get(eventId);
}

function createWorldBossEventMeta({ eventId, massing }) {
  return getDatabase()
    .prepare(`
      INSERT INTO world_boss_events (event_id, massing)
      VALUES (?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        massing = excluded.massing,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run(eventId, massing);
}

function getWorldBossEventMeta(eventId) {
  return getDatabase().prepare('SELECT * FROM world_boss_events WHERE event_id = ?').get(eventId);
}

function createVisualEventBuildMeta({ eventId, buildsChannelId, buildsChannelName, slots, compositionMode = 'predefined', rulesSnapshot = null, sheetUrl = null }) {
  return transaction(() => {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO visual_event_builds
        (event_id, builds_channel_id, builds_channel_name, composition_mode, rules_json, sheet_url)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        builds_channel_id = excluded.builds_channel_id,
        builds_channel_name = excluded.builds_channel_name,
        composition_mode = excluded.composition_mode,
        rules_json = excluded.rules_json,
        sheet_url = excluded.sheet_url,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      eventId,
      buildsChannelId,
      buildsChannelName || null,
      compositionMode,
      rulesSnapshot ? JSON.stringify(rulesSnapshot) : null,
      sheetUrl || null
    );
    replaceEventCompositionSlots(db, eventId, slots);
    return getVisualEventBuildMeta(eventId);
  })();
}

function getVisualEventBuildMeta(eventId) {
  return getDatabase().prepare('SELECT * FROM visual_event_builds WHERE event_id = ?').get(eventId);
}

function createGroupDungeonBuildMeta(input) {
  return createVisualEventBuildMeta(input);
}

function getGroupDungeonBuildMeta(eventId) {
  return getVisualEventBuildMeta(eventId);
}

function replaceEventCompositionSlots(db, eventId, slots) {
  db.prepare('DELETE FROM custom_event_slots WHERE event_id = ?').run(eventId);
  const insertSlot = db.prepare(`
    INSERT INTO custom_event_slots
      (event_id, role, slot_index, slot_label, build_key, build_url, emoji_name, emoji_id)
    VALUES
      (@eventId, @role, @slotIndex, @slotLabel, @buildKey, @buildUrl, @emojiName, @emojiId)
  `);
  for (const slot of slots || []) {
    insertSlot.run({
      eventId,
      role: slot.role,
      slotIndex: slot.index,
      slotLabel: slot.value || null,
      buildKey: slot.buildKey || null,
      buildUrl: slot.buildUrl || null,
      emojiName: slot.emojiName || null,
      emojiId: slot.emojiId || null
    });
  }
}

function createCustomEventMeta({ eventId, eventDay, timeRange, lootRules, consumables, mountRequirement, slots, dpsPool, dpsPolicy = 'caller' }) {
  return transaction(() => {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO custom_events
        (event_id, event_day, time_range, loot_rules, consumables, mount_requirement, dps_policy)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        event_day = excluded.event_day,
        time_range = excluded.time_range,
        loot_rules = excluded.loot_rules,
        consumables = excluded.consumables,
        mount_requirement = excluded.mount_requirement,
        dps_policy = excluded.dps_policy,
        updated_at = CURRENT_TIMESTAMP
    `).run(eventId, eventDay, timeRange, lootRules, consumables, mountRequirement, dpsPolicy);

    replaceEventCompositionSlots(db, eventId, slots);
    if (dpsPool !== undefined) {
      db.prepare('DELETE FROM custom_event_dps_weapons WHERE event_id = ?').run(eventId);
      const insertDpsWeapon = db.prepare(`
        INSERT INTO custom_event_dps_weapons
          (event_id, weapon_key, weapon_label, max_quantity, mandatory, build_url, image_url, emoji_name, emoji_id, sort_order)
        VALUES
          (@eventId, @weaponKey, @weaponLabel, @maxQuantity, @mandatory, @buildUrl, @imageUrl, @emojiName, @emojiId, @sortOrder)
      `);
      (dpsPool || []).forEach((weapon, index) => insertDpsWeapon.run({
        eventId,
        weaponKey: weapon.weaponKey,
        weaponLabel: weapon.label,
        maxQuantity: weapon.maxQuantity,
        mandatory: weapon.mandatory ? 1 : 0,
        buildUrl: weapon.buildUrl || null,
        imageUrl: weapon.imageUrl || null,
        emojiName: weapon.emojiName || null,
        emojiId: weapon.emojiId || null,
        sortOrder: index
      }));
    }
    return getCustomEventMeta(eventId);
  })();
}

function getCustomEventMeta(eventId) {
  return getDatabase().prepare('SELECT * FROM custom_events WHERE event_id = ?').get(eventId);
}

function listCustomEventSlots(eventId) {
  return getDatabase()
    .prepare(`
      SELECT *
      FROM custom_event_slots
      WHERE event_id = ?
      ORDER BY
        CASE role WHEN 'tank' THEN 1 WHEN 'healer' THEN 2 WHEN 'support' THEN 3 WHEN 'dps' THEN 4 ELSE 99 END,
        slot_index
    `)
    .all(eventId);
}

function listCustomEventDpsWeapons(eventId) {
  return getDatabase().prepare(`
    SELECT * FROM custom_event_dps_weapons
    WHERE event_id = ?
    ORDER BY mandatory DESC, sort_order, weapon_label
  `).all(eventId);
}

function replaceEventEmojiReferences(replacements) {
  return transaction(() => {
    const db = getDatabase();
    const affected = new Set();
    const slotEvents = db.prepare(`
      SELECT DISTINCT event_id FROM custom_event_slots
      WHERE emoji_name = ? AND emoji_id = ?
    `);
    const weaponEvents = db.prepare(`
      SELECT DISTINCT event_id FROM custom_event_dps_weapons
      WHERE emoji_name = ? AND emoji_id = ?
    `);
    const updateSlots = db.prepare(`
      UPDATE custom_event_slots SET emoji_id = ?
      WHERE emoji_name = ? AND emoji_id = ?
    `);
    const updateWeapons = db.prepare(`
      UPDATE custom_event_dps_weapons SET emoji_id = ?
      WHERE emoji_name = ? AND emoji_id = ?
    `);
    for (const replacement of replacements || []) {
      for (const row of slotEvents.all(replacement.name, replacement.oldId)) affected.add(row.event_id);
      for (const row of weaponEvents.all(replacement.name, replacement.oldId)) affected.add(row.event_id);
      updateSlots.run(replacement.newId, replacement.name, replacement.oldId);
      updateWeapons.run(replacement.newId, replacement.name, replacement.oldId);
    }
    return [...affected];
  })();
}

function assignCustomDpsWeapon({ eventId, discordId, weaponKey }) {
  return transaction(() => {
    const db = getDatabase();
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    const pool = listCustomEventDpsWeapons(eventId);
    const selected = pool.find((weapon) => weapon.weapon_key === weaponKey);
    if (!event || !selected) return { assigned: false, reason: 'invalid' };
    const active = db.prepare(`
      SELECT * FROM event_participants
      WHERE event_id = ? AND role = 'dps' AND is_spectator = 0 AND is_paused = 0
    `).all(eventId);
    const others = active.filter((participant) => participant.discord_id !== discordId);
    if (others.length >= Number(event.dps_slots || 0)) return { assigned: false, reason: 'full' };
    const used = (key) => others.filter((participant) => participant.custom_weapon_key === key).length;
    if (used(weaponKey) >= Number(selected.max_quantity)) return { assigned: false, reason: 'stock' };
    const missingMandatory = pool.filter((weapon) => weapon.mandatory && used(weapon.weapon_key) === 0).length;
    const remainingAfter = Number(event.dps_slots || 0) - others.length - 1;
    if (!selected.mandatory && remainingAfter < missingMandatory) {
      return { assigned: false, reason: 'mandatory' };
    }
    const current = active.find((participant) => participant.discord_id === discordId);
    const occupiedIndexes = new Set(others.map((participant) => Number(participant.custom_slot_index)).filter(Boolean));
    const slotIndex = Number(current?.custom_slot_index) || Array.from(
      { length: Number(event.dps_slots || 0) },
      (_, index) => index + 1
    ).find((index) => !occupiedIndexes.has(index));
    upsertParticipant({
      eventId,
      discordId,
      role: 'dps',
      customSlotIndex: slotIndex,
      customWeaponKey: weaponKey,
      isSpectator: 0
    });
    return { assigned: true, weapon: selected, slotIndex };
  })();
}

function assignVisualCompositionWeapon({ eventId, discordId, role, weaponKey, maxQuantity = null, requiredKeys = [] }) {
  return transaction(() => {
    const db = getDatabase();
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) return { assigned: false, reason: 'invalid' };
    const slots = db.prepare('SELECT * FROM custom_event_slots WHERE event_id = ? AND role = ? ORDER BY slot_index').all(eventId, role);
    const active = db.prepare(`
      SELECT * FROM event_participants
      WHERE event_id = ? AND role = ? AND is_spectator = 0 AND is_paused = 0
    `).all(eventId, role);
    const others = active.filter((participant) => participant.discord_id !== discordId);
    if (others.length >= slots.length) return { assigned: false, reason: 'full' };
    const allOthers = db.prepare(`
      SELECT * FROM event_participants
      WHERE event_id = ? AND is_spectator = 0 AND is_paused = 0 AND discord_id <> ?
    `).all(eventId, discordId);
    if (maxQuantity != null && allOthers.filter((participant) => participant.custom_weapon_key === weaponKey).length >= maxQuantity) {
      return { assigned: false, reason: 'stock' };
    }
    const usedKeys = new Set(others.map((participant) => participant.custom_weapon_key).filter(Boolean));
    const missingRequired = requiredKeys.filter((key) => !usedKeys.has(key));
    const remainingAfter = slots.length - others.length - 1;
    if (!missingRequired.includes(weaponKey) && remainingAfter < missingRequired.length) {
      return { assigned: false, reason: 'mandatory' };
    }
    const current = active.find((participant) => participant.discord_id === discordId);
    const occupied = new Set(others.map((participant) => Number(participant.custom_slot_index)).filter(Boolean));
    const slotIndex = Number(current?.custom_slot_index) || slots.find((slot) => !occupied.has(Number(slot.slot_index)))?.slot_index;
    if (!slotIndex) return { assigned: false, reason: 'full' };
    upsertParticipant({
      eventId,
      discordId,
      role,
      customSlotIndex: Number(slotIndex),
      customWeaponKey: weaponKey,
      isSpectator: 0
    });
    return { assigned: true, slotIndex };
  })();
}

function listWorldBossAssignments(eventId) {
  return getDatabase()
    .prepare('SELECT * FROM world_boss_assignments WHERE event_id = ? ORDER BY slot_key')
    .all(eventId);
}

function assignWorldBossSlot({ eventId, slotKey, discordId, removeSlotKeys = [] }) {
  return transaction(() => {
    const occupied = getDatabase()
      .prepare('SELECT * FROM world_boss_assignments WHERE event_id = ? AND slot_key = ?')
      .get(eventId, slotKey);
    if (occupied && occupied.discord_id !== discordId) return { assigned: false, occupied };
    const remove = getDatabase().prepare(
      'DELETE FROM world_boss_assignments WHERE event_id = ? AND discord_id = ? AND slot_key = ?'
    );
    for (const key of [...new Set(removeSlotKeys)]) remove.run(eventId, discordId, key);
    getDatabase()
      .prepare('INSERT OR REPLACE INTO world_boss_assignments (event_id, slot_key, discord_id) VALUES (?, ?, ?)')
      .run(eventId, slotKey, discordId);
    return { assigned: true };
  })();
}

function removeWorldBossAssignment({ eventId, discordId, slotKey = null }) {
  if (slotKey) {
    return getDatabase()
      .prepare('DELETE FROM world_boss_assignments WHERE event_id = ? AND discord_id = ? AND slot_key = ?')
      .run(eventId, discordId, slotKey);
  }
  return getDatabase()
    .prepare('DELETE FROM world_boss_assignments WHERE event_id = ? AND discord_id = ?')
    .run(eventId, discordId);
}

function upsertRaidAvalonParticipant({ eventId, discordId, weaponKey = null, weaponName = null, itemPower = null, helperRole = null }) {
  return getDatabase()
    .prepare(`
      INSERT INTO raid_avalon_event_participants
        (event_id, discord_id, weapon_key, weapon_name, item_power, helper_role)
      VALUES
        (@eventId, @discordId, @weaponKey, @weaponName, @itemPower, @helperRole)
      ON CONFLICT(event_id, discord_id) DO UPDATE SET
        weapon_key = excluded.weapon_key,
        weapon_name = excluded.weapon_name,
        item_power = excluded.item_power,
        helper_role = excluded.helper_role,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run({ eventId, discordId, weaponKey, weaponName, itemPower, helperRole });
}

function getRaidAvalonParticipant({ eventId, discordId }) {
  return getDatabase()
    .prepare('SELECT * FROM raid_avalon_event_participants WHERE event_id = ? AND discord_id = ?')
    .get(eventId, discordId);
}

function listRaidAvalonParticipants(eventId) {
  return getDatabase()
    .prepare('SELECT * FROM raid_avalon_event_participants WHERE event_id = ? ORDER BY helper_role, weapon_name, discord_id')
    .all(eventId);
}

function getRaidAvalonCareer({ discordId, weaponKey }) {
  return getDatabase()
    .prepare('SELECT * FROM raid_avalon_weapon_career WHERE discord_id = ? AND weapon_key = ?')
    .get(discordId, weaponKey);
}

function upsertRaidAvalonCareer({ discordId, weaponKey, weaponName, roleId, addPoint = false, pointsToAdd = null }) {
  const points = pointsToAdd ?? (addPoint ? 1 : 0);
  return getDatabase()
    .prepare(`
      INSERT INTO raid_avalon_weapon_career
        (discord_id, weapon_key, weapon_name, points, role_id, first_tag_at, last_point_at)
      VALUES
        (@discordId, @weaponKey, @weaponName, @points, @roleId, CURRENT_TIMESTAMP, @lastPointAt)
      ON CONFLICT(discord_id, weapon_key) DO UPDATE SET
        weapon_name = excluded.weapon_name,
        points = raid_avalon_weapon_career.points + @points,
        role_id = COALESCE(excluded.role_id, raid_avalon_weapon_career.role_id),
        last_point_at = COALESCE(excluded.last_point_at, raid_avalon_weapon_career.last_point_at),
        updated_at = CURRENT_TIMESTAMP
    `)
    .run({
      discordId,
      weaponKey,
      weaponName,
      roleId,
      points,
      lastPointAt: points > 0 ? new Date().toISOString() : null
    });
}

const addCareerPointTransaction = transaction((data) => {
  const points = Number(data.points || 0);
  if (points <= 0) return { inserted: false, points: 0 };

  const result = getDatabase()
    .prepare(`
      INSERT OR IGNORE INTO career_point_transactions
        (event_id, discord_id, point_type, role, weapon_key, weapon_name, seconds, points, source, created_by)
      VALUES
        (@eventId, @discordId, @pointType, @role, @weaponKey, @weaponName, @seconds, @points, @source, @createdBy)
    `)
    .run({
      eventId: data.eventId,
      discordId: data.discordId,
      pointType: data.pointType,
      role: data.role || null,
      weaponKey: data.weaponKey,
      weaponName: data.weaponName,
      seconds: data.seconds || 0,
      points,
      source: data.source || 'event_approval',
      createdBy: data.createdBy || null
    });

  if (result.changes === 0) return { inserted: false, points: 0 };

  upsertRaidAvalonCareer({
    discordId: data.discordId,
    weaponKey: data.weaponKey,
    weaponName: data.weaponName,
    roleId: data.roleId || null,
    pointsToAdd: points
  });

  return { inserted: true, points };
});

const clearCareerPointData = transaction(() => {
  getDatabase().prepare('DELETE FROM career_point_transactions').run();
  getDatabase().prepare('DELETE FROM raid_avalon_weapon_career').run();
});

const replaceCareerPointData = transaction((entries) => {
  getDatabase().prepare('DELETE FROM career_point_transactions').run();
  getDatabase().prepare('DELETE FROM raid_avalon_weapon_career').run();
  let inserted = 0;
  let points = 0;
  for (const entry of entries) {
    const result = addCareerPointTransaction(entry);
    if (result.inserted) inserted += 1;
    points += result.points;
  }
  return { inserted, points };
});

function countCareerPointTransactions() {
  return Number(getDatabase().prepare('SELECT COUNT(*) AS total FROM career_point_transactions').get()?.total || 0);
}

function listRaidAvalonCareer(limit = 30) {
  return getDatabase()
    .prepare(`
      SELECT
        discord_id,
        weapon_key,
        CASE weapon_key
          WHEN 'classe_tank' THEN 'Tank'
          WHEN 'classe_healer' THEN 'Healer'
          WHEN 'classe_support' THEN 'Suporte'
          WHEN 'classe_dps' THEN 'DPS'
          WHEN 'classe_caller' THEN 'Caller'
          ELSE weapon_name
        END AS weapon_name,
        points,
        role_id,
        first_tag_at,
        last_point_at,
        updated_at
      FROM raid_avalon_weapon_career
      WHERE points > 0
        AND weapon_key LIKE 'classe_%'
      ORDER BY points DESC, updated_at DESC
      LIMIT ?
    `)
    .all(limit);
}

function listRaidAvalonCareerByWeapon(limit = 20) {
  return getDatabase()
    .prepare(`
      SELECT
        weapon_key,
        CASE weapon_key
          WHEN 'classe_tank' THEN 'Tank'
          WHEN 'classe_healer' THEN 'Healer'
          WHEN 'classe_support' THEN 'Suporte'
          WHEN 'classe_dps' THEN 'DPS'
          WHEN 'classe_caller' THEN 'Caller'
          ELSE weapon_name
        END AS weapon_name,
        COUNT(*) AS members,
        SUM(points) AS points
      FROM raid_avalon_weapon_career
      WHERE points > 0
        AND weapon_key LIKE 'classe_%'
      GROUP BY weapon_key
      ORDER BY
        CASE weapon_key
          WHEN 'classe_tank' THEN 1
          WHEN 'classe_healer' THEN 2
          WHEN 'classe_support' THEN 3
          WHEN 'classe_dps' THEN 4
          WHEN 'classe_caller' THEN 5
          ELSE 99
        END,
        points DESC
      LIMIT ?
    `)
    .all(limit);
}

function getPersistentMessage(key) {
  return getDatabase().prepare('SELECT * FROM persistent_bot_messages WHERE message_key = ?').get(key);
}

function setPersistentMessage({ key, channelId, messageId }) {
  return getDatabase()
    .prepare(`
      INSERT INTO persistent_bot_messages (message_key, channel_id, message_id, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(message_key) DO UPDATE SET
        channel_id = excluded.channel_id,
        message_id = excluded.message_id,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run(key, channelId, messageId);
}

function markReviewApproved({ eventId, approvedBy }) {
  return getDatabase()
    .prepare("UPDATE event_reviews SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE event_id = ?")
    .run(approvedBy, eventId);
}

function listExpiredReviewChannels(nowIso) {
  return getDatabase()
    .prepare(`
      SELECT er.*, e.event_code, e.title
      FROM event_reviews er
      JOIN events e ON e.id = er.event_id
      WHERE er.review_channel_id IS NOT NULL
        AND er.review_channel_delete_after IS NOT NULL
        AND er.review_channel_delete_after <= ?
    `)
    .all(nowIso);
}

module.exports = {
  assignCustomDpsWeapon,
  assignVisualCompositionWeapon,
  assignWorldBossSlot,
  closeOpenVoiceSession,
  addCareerPointTransaction,
  clearCareerPointData,
  countCareerPointTransactions,
  createCustomEventMeta,
  createEvent,
  createGroupDungeonBuildMeta,
  createVisualEventBuildMeta,
  createRaidAvalonEventMeta,
  createWorldBossEventMeta,
  clearParticipantPayouts,
  getEvent,
  getEventByCode,
  getEventByVoiceChannel,
  getLastCommonEventConfiguration,
  getLastCustomEventConfiguration,
  getEventConfiguration,
  getSavedEventConfiguration,
  getCustomEventMeta,
  getGroupDungeonBuildMeta,
  getVisualEventBuildMeta,
  getOpenVoiceSession,
  getParticipant,
  getPersistentMessage,
  getRaidAvalonCareer,
  getRaidAvalonEventMeta,
  getRaidAvalonParticipant,
  getWorldBossEventMeta,
  hasReminderDispatch,
  getReview,
  listActiveEvents,
  listInactiveEventsWithVoiceChannels,
  listRecentEventConfigurations,
  listSavedEventConfigurations,
  listAllSavedEventConfigurations,
  listInteractiveEvents,
  listApprovedEventsForCareer,
  listCustomEventSlots,
  listCustomEventDpsWeapons,
  listEventsWithTempRoles,
  listExpiredReviewChannels,
  listPendingWarningEvents,
  listPendingReminderEvents,
  listParticipants,
  listRaidAvalonCareer,
  listRaidAvalonCareerByWeapon,
  listRaidAvalonParticipants,
  listWorldBossAssignments,
  listWorkflowReviews,
  listReviewEvents,
  markReviewApproved,
  markReminderDispatch,
  refreshParticipantSeconds,
  removeParticipant,
  removeWorldBossAssignment,
  replaceEventEmojiReferences,
  replaceCareerPointData,
  setParticipantPayout,
  setPersistentMessage,
  setParticipantReview,
  startVoiceSession,
  updateEvent,
  saveEventConfiguration,
  deleteSavedEventConfiguration,
  clearEventReminderDispatches,
  upsertRaidAvalonCareer,
  upsertRaidAvalonParticipant,
  upsertParticipant,
  upsertReview,
  updateReviewMetadata
};
