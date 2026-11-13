const ids = require('../config/ids');
const { getDatabase } = require('../database/connection');

const TIME_ZONE = 'America/Sao_Paulo';
const ALLOWED_PERIODS = new Set([7, 30, 90]);
const MIN_SESSION_SECONDS = 60;
const MAX_SESSION_SECONDS = 12 * 60 * 60;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const formatterCache = new Map();

function formatter(timeZone = TIME_ZONE) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      hourCycle: 'h23'
    }));
  }
  return formatterCache.get(timeZone);
}

function localParts(value, timeZone = TIME_ZONE) {
  const parts = formatter(timeZone).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(fields.weekday);
  return {
    year: Number(fields.year),
    month: Number(fields.month),
    day: Number(fields.day),
    hour: Number(fields.hour),
    weekday
  };
}

function dateKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function shiftDateKey(value, days) {
  const [year, month, day] = value.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function zonedDateTimeToUtc(value, hour = 0, timeZone = TIME_ZONE) {
  const [year, month, day] = value.split('-').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour);
  let guess = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = localParts(guess, timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour);
    guess += desired - represented;
  }
  return guess;
}

function collectionValues(collection) {
  if (!collection) return [];
  if (typeof collection.values === 'function') return [...collection.values()];
  return Array.isArray(collection) ? collection : [];
}

function loadHistoricalSessions(db, startMs, endMs) {
  return db.prepare(`
    SELECT
      sessions.discord_id,
      COALESCE(links.primary_discord_id, sessions.discord_id) AS player_id,
      COALESCE(
        NULLIF(primary_user.albion_name, ''), NULLIF(primary_user.discord_name, ''),
        NULLIF(source_user.albion_name, ''), NULLIF(source_user.discord_name, ''),
        NULLIF(sessions.discord_name, ''), sessions.discord_id
      ) AS player_name,
      sessions.joined_at,
      sessions.left_at
    FROM voice_sessions sessions
    LEFT JOIN linked_discord_accounts links ON links.linked_discord_id = sessions.discord_id
    LEFT JOIN users primary_user ON primary_user.discord_id = COALESCE(links.primary_discord_id, sessions.discord_id)
    LEFT JOIN users source_user ON source_user.discord_id = sessions.discord_id
    WHERE datetime(sessions.joined_at) < datetime(@end)
      AND datetime(COALESCE(sessions.left_at, @end)) > datetime(@start)
    ORDER BY sessions.joined_at
  `).all({ start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() });
}

function sanitizeSessions(rows, startMs, endMs) {
  const valid = [];
  let ignoredAnomalous = 0;
  let ignoredShort = 0;

  for (const row of rows) {
    const rawStart = Date.parse(row.joined_at);
    const rawEnd = row.left_at ? Date.parse(row.left_at) : endMs;
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) {
      ignoredAnomalous += 1;
      continue;
    }
    const rawSeconds = Math.floor((rawEnd - rawStart) / 1000);
    if (rawSeconds > MAX_SESSION_SECONDS) {
      ignoredAnomalous += 1;
      continue;
    }
    if (rawSeconds < MIN_SESSION_SECONDS) {
      ignoredShort += 1;
      continue;
    }
    const start = Math.max(startMs, rawStart);
    const end = Math.min(endMs, rawEnd);
    if (end <= start) continue;
    valid.push({
      playerId: String(row.player_id),
      name: row.player_name || row.player_id,
      start,
      end,
      sessions: 1
    });
  }

  return { valid, ignoredAnomalous, ignoredShort };
}

function mergePlayerIntervals(sessions) {
  const grouped = new Map();
  for (const session of sessions) {
    if (!grouped.has(session.playerId)) grouped.set(session.playerId, []);
    grouped.get(session.playerId).push(session);
  }

  const merged = [];
  for (const rows of grouped.values()) {
    rows.sort((left, right) => left.start - right.start);
    let current = null;
    for (const row of rows) {
      if (current && row.start <= current.end) {
        current.end = Math.max(current.end, row.end);
        current.sessions += row.sessions;
        continue;
      }
      if (current) merged.push(current);
      current = { ...row };
    }
    if (current) merged.push(current);
  }
  return merged;
}

function increment(map, key, amount) {
  map.set(key, (map.get(key) || 0) + amount);
}

function analyseIntervals(intervals, startMs, endMs, timeZone = TIME_ZONE) {
  const today = dateKey(localParts(endMs, timeZone));
  const firstDate = dateKey(localParts(startMs, timeZone));
  const dates = [];
  for (let key = firstDate; key <= today; key = shiftDateKey(key, 1)) dates.push(key);

  const observedSlots = new Map();
  for (const key of dates) {
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    for (let hour = 0; hour < 24; hour += 1) {
      const slotStart = zonedDateTimeToUtc(key, hour, timeZone);
      const slotEnd = hour === 23
        ? zonedDateTimeToUtc(shiftDateKey(key, 1), 0, timeZone)
        : zonedDateTimeToUtc(key, hour + 1, timeZone);
      const observedSeconds = Math.max(0, (Math.min(endMs, slotEnd) - Math.max(startMs, slotStart)) / 1000);
      if (observedSeconds <= 0) continue;
      const slotKey = `${weekday}:${hour}`;
      if (!observedSlots.has(slotKey)) observedSlots.set(slotKey, { seconds: 0, days: 0 });
      observedSlots.get(slotKey).seconds += observedSeconds;
      observedSlots.get(slotKey).days += 1;
    }
  }

  const heat = new Map();
  const daily = new Map(dates.map((key) => {
    const observedHourSeconds = new Map();
    for (let hour = 0; hour < 24; hour += 1) {
      const slotStart = zonedDateTimeToUtc(key, hour, timeZone);
      const slotEnd = hour === 23
        ? zonedDateTimeToUtc(shiftDateKey(key, 1), 0, timeZone)
        : zonedDateTimeToUtc(key, hour + 1, timeZone);
      observedHourSeconds.set(hour, Math.max(0, (Math.min(endMs, slotEnd) - Math.max(startMs, slotStart)) / 1000));
    }
    return [key, {
      date: key,
      uniquePlayers: new Set(),
      totalVoiceSeconds: 0,
      hourSeconds: new Map(),
      hourPlayers: new Map(),
      observedHourSeconds,
      events: []
    }];
  }));
  const players = new Map();

  for (const interval of intervals) {
    if (!players.has(interval.playerId)) {
      players.set(interval.playerId, {
        id: interval.playerId,
        name: interval.name,
        totalVoiceSeconds: 0,
        sessions: 0,
        activeDates: new Set(),
        weekdaySeconds: new Map(),
        hourSeconds: new Map(),
        lastSeen: null
      });
    }
    const player = players.get(interval.playerId);
    player.sessions += interval.sessions;
    player.lastSeen = new Date(Math.max(player.lastSeen ? Date.parse(player.lastSeen) : 0, interval.end)).toISOString();

    for (let dayCursor = interval.start; dayCursor < interval.end;) {
      const parts = localParts(dayCursor + Math.min(1000, Math.max(0, interval.end - dayCursor - 1)), timeZone);
      const dayKey = dateKey(parts);
      const segmentEnd = Math.min(interval.end, zonedDateTimeToUtc(shiftDateKey(dayKey, 1), 0, timeZone));
      const day = daily.get(dayKey);
      if (day) {
        day.events.push({ time: dayCursor, delta: 1 });
        day.events.push({ time: segmentEnd, delta: -1 });
      }
      dayCursor = segmentEnd;
    }

    for (let cursor = interval.start; cursor < interval.end;) {
      const nextHour = Math.min(interval.end, (Math.floor(cursor / HOUR_MS) + 1) * HOUR_MS);
      const seconds = Math.max(0, Math.round((nextHour - cursor) / 1000));
      const parts = localParts(cursor + Math.min(1000, Math.max(0, nextHour - cursor - 1)), timeZone);
      const dayKey = dateKey(parts);
      const cellKey = `${parts.weekday}:${parts.hour}`;

      if (!heat.has(cellKey)) heat.set(cellKey, { seconds: 0, players: new Set() });
      heat.get(cellKey).seconds += seconds;
      heat.get(cellKey).players.add(interval.playerId);

      const day = daily.get(dayKey);
      if (day) {
        day.totalVoiceSeconds += seconds;
        day.uniquePlayers.add(interval.playerId);
        increment(day.hourSeconds, parts.hour, seconds);
        if (!day.hourPlayers.has(parts.hour)) day.hourPlayers.set(parts.hour, new Set());
        day.hourPlayers.get(parts.hour).add(interval.playerId);
      }

      player.totalVoiceSeconds += seconds;
      player.activeDates.add(dayKey);
      increment(player.weekdaySeconds, parts.weekday, seconds);
      increment(player.hourSeconds, parts.hour, seconds);
      cursor = nextHour;
    }
  }

  const heatmap = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const cell = heat.get(`${weekday}:${hour}`) || { seconds: 0, players: new Set() };
      const observed = observedSlots.get(`${weekday}:${hour}`) || { seconds: 0, days: 0 };
      heatmap.push({
        weekday,
        weekdayLabel: WEEKDAYS[weekday],
        hour,
        sampleDays: observed.days,
        observedSeconds: observed.seconds,
        averageConcurrent: Number((observed.seconds > 0 ? cell.seconds / observed.seconds : 0).toFixed(1)),
        totalVoiceSeconds: cell.seconds,
        uniquePlayers: cell.players.size
      });
    }
  }

  const candidates = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 23; hour += 1) {
      const first = heatmap.find((cell) => cell.weekday === weekday && cell.hour === hour);
      const second = heatmap.find((cell) => cell.weekday === weekday && cell.hour === hour + 1);
      const denominator = first.observedSeconds + second.observedSeconds;
      candidates.push({
        weekday,
        weekdayLabel: WEEKDAYS[weekday],
        startHour: hour,
        endHour: hour + 2,
        sampleDays: Math.min(first.sampleDays, second.sampleDays),
        averageConcurrent: Number((denominator > 0 ? (first.totalVoiceSeconds + second.totalVoiceSeconds) / denominator : 0).toFixed(1))
      });
    }
  }
  candidates.sort((left, right) => right.averageConcurrent - left.averageConcurrent || left.weekday - right.weekday || left.startHour - right.startHour);
  const bestWindows = [];
  for (const candidate of candidates) {
    if (candidate.averageConcurrent <= 0) break;
    const overlaps = bestWindows.some((selected) => selected.weekday === candidate.weekday && Math.abs(selected.startHour - candidate.startHour) < 2);
    if (!overlaps) bestWindows.push(candidate);
    if (bestWindows.length === 5) break;
  }

  const playerRows = [...players.values()].map((player) => ({
    id: player.id,
    name: player.name,
    totalVoiceSeconds: player.totalVoiceSeconds,
    sessions: player.sessions,
    activeDays: player.activeDates.size,
    lastSeen: player.lastSeen,
    typicalDays: [...player.weekdaySeconds.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([weekday, seconds]) => ({ weekday, label: WEEKDAYS[weekday], seconds })),
    peakHours: [...player.hourSeconds.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 2)
      .map(([hour, seconds]) => ({ hour, seconds }))
  })).sort((left, right) => right.totalVoiceSeconds - left.totalVoiceSeconds || left.name.localeCompare(right.name, 'pt-BR'));

  const rawCalendar = [...daily.values()].map((row) => {
    const weekday = new Date(`${row.date}T12:00:00Z`).getUTCDay();
    let concurrent = 0;
    let peakConcurrent = 0;
    for (const event of [...row.events].sort((left, right) => left.time - right.time || left.delta - right.delta)) {
      concurrent += event.delta;
      peakConcurrent = Math.max(peakConcurrent, concurrent);
    }
    const hourly = Array.from({ length: 24 }, (_, hour) => {
      const observedSeconds = row.observedHourSeconds.get(hour) || 0;
      const totalVoiceSeconds = row.hourSeconds.get(hour) || 0;
      return {
        hour,
        observedSeconds,
        totalVoiceSeconds,
        averageConcurrent: Number((observedSeconds > 0 ? totalVoiceSeconds / observedSeconds : 0).toFixed(1)),
        uniquePlayers: row.hourPlayers.get(hour)?.size || 0
      };
    });
    const windows = [];
    for (let hour = 0; hour < 23; hour += 1) {
      const first = hourly[hour];
      const second = hourly[hour + 1];
      const observedSeconds = first.observedSeconds + second.observedSeconds;
      if (observedSeconds <= 0) continue;
      windows.push({
        startHour: hour,
        endHour: hour + 2,
        averageConcurrent: Number(((first.totalVoiceSeconds + second.totalVoiceSeconds) / observedSeconds).toFixed(1))
      });
    }
    windows.sort((left, right) => right.averageConcurrent - left.averageConcurrent || left.startHour - right.startHour);
    return {
      date: row.date,
      day: Number(row.date.slice(-2)),
      weekday,
      weekdayLabel: WEEKDAYS[weekday],
      uniquePlayers: row.uniquePlayers.size,
      totalVoiceSeconds: row.totalVoiceSeconds,
      peakConcurrent,
      bestWindow: windows[0] || null,
      hourly,
      players: [...row.uniquePlayers]
        .map((playerId) => players.get(playerId)?.name || playerId)
        .sort((left, right) => left.localeCompare(right, 'pt-BR')),
      isInProgress: row.date === today
    };
  }).sort((left, right) => left.date.localeCompare(right.date));

  const completedDays = rawCalendar.filter((row) => !row.isInProgress);
  const periodPeakAverage = completedDays.length
    ? completedDays.reduce((sum, row) => sum + row.peakConcurrent, 0) / completedDays.length
    : 0;
  const calendar = rawCalendar.map((row) => {
    const weekdayPeers = completedDays.filter((peer) => peer.date !== row.date && peer.weekday === row.weekday);
    const baselineRows = weekdayPeers.length ? weekdayPeers : completedDays.filter((peer) => peer.date !== row.date);
    const baselinePeak = baselineRows.length
      ? baselineRows.reduce((sum, peer) => sum + peer.peakConcurrent, 0) / baselineRows.length
      : periodPeakAverage;
    const comparisonPercent = baselinePeak > 0
      ? Math.round(((row.peakConcurrent - baselinePeak) / baselinePeak) * 100)
      : null;
    let intensity = 'normal';
    if (row.isInProgress) intensity = 'in_progress';
    else if (comparisonPercent != null && comparisonPercent >= 30) intensity = 'peak';
    else if (comparisonPercent != null && comparisonPercent >= 10) intensity = 'strong';
    else if (comparisonPercent != null && comparisonPercent < -15) intensity = 'weak';
    return { ...row, baselinePeak: Number(baselinePeak.toFixed(1)), comparisonPercent, intensity };
  });

  const strongestDay = [...completedDays].sort((left, right) => right.peakConcurrent - left.peakConcurrent || right.uniquePlayers - left.uniquePlayers)[0] || null;
  const bestWeekend = [...completedDays].filter((row) => row.weekday === 0 || row.weekday === 6)
    .sort((left, right) => right.peakConcurrent - left.peakConcurrent || right.uniquePlayers - left.uniquePlayers)[0] || null;
  const recent = completedDays.slice(-7);
  const previous = completedDays.slice(-14, -7);
  const averagePeak = (rows) => rows.length ? rows.reduce((sum, row) => sum + row.peakConcurrent, 0) / rows.length : 0;
  const previousAverage = averagePeak(previous);
  const calendarSummary = {
    strongestDay: strongestDay ? {
      date: strongestDay.date,
      weekdayLabel: strongestDay.weekdayLabel,
      peakConcurrent: strongestDay.peakConcurrent,
      bestWindow: strongestDay.bestWindow
    } : null,
    averageDailyPeak: Number(averagePeak(completedDays).toFixed(1)),
    averageDailyUniquePlayers: Number((completedDays.length
      ? completedDays.reduce((sum, row) => sum + row.uniquePlayers, 0) / completedDays.length
      : 0).toFixed(1)),
    weekOverWeekPercent: previousAverage > 0
      ? Math.round(((averagePeak(recent) - previousAverage) / previousAverage) * 100)
      : null,
    bestWeekend: bestWeekend ? {
      date: bestWeekend.date,
      weekdayLabel: bestWeekend.weekdayLabel,
      peakConcurrent: bestWeekend.peakConcurrent,
      bestWindow: bestWeekend.bestWindow
    } : null
  };

  return { heatmap, bestWindows, players: playerRows, calendar, calendarSummary };
}

function loadIdentities(db) {
  const users = new Map(db.prepare('SELECT discord_id, discord_name, albion_name FROM users').all().map((row) => [String(row.discord_id), row]));
  const links = new Map(db.prepare('SELECT linked_discord_id, primary_discord_id, label FROM linked_discord_accounts').all().map((row) => [String(row.linked_discord_id), row]));
  return { users, links };
}

function identityFor(discordId, fallbackName, identities) {
  const link = identities.links.get(String(discordId));
  const id = String(link?.primary_discord_id || discordId);
  const primary = identities.users.get(id);
  const source = identities.users.get(String(discordId));
  return {
    id,
    name: primary?.albion_name || primary?.discord_name || source?.albion_name || source?.discord_name || link?.label || fallbackName || id
  };
}

async function activeVoicePlayers(client, db, nowMs) {
  let guild = client?.guilds?.cache?.get(ids.guildId) || null;
  if (!guild && typeof client?.guilds?.fetch === 'function') guild = await client.guilds.fetch(ids.guildId).catch(() => null);
  if (!guild) return [];

  const states = collectionValues(guild.voiceStates?.cache);
  const identities = loadIdentities(db);
  const openSessions = new Map(db.prepare('SELECT discord_id, joined_at FROM voice_sessions WHERE left_at IS NULL').all().map((row) => [String(row.discord_id), row]));
  const active = new Map();

  for (const state of states) {
    if (!state?.channelId || state.member?.user?.bot) continue;
    const discordId = String(state.id || state.member?.id || '');
    if (!discordId) continue;
    const identity = identityFor(discordId, state.member?.displayName || state.member?.user?.globalName || state.member?.user?.username, identities);
    const open = openSessions.get(discordId);
    const joinedMs = open ? Date.parse(open.joined_at) : NaN;
    const reliableJoin = Number.isFinite(joinedMs) && nowMs >= joinedMs && (nowMs - joinedMs) / 1000 <= MAX_SESSION_SECONDS;
    active.set(identity.id, {
      id: identity.id,
      discordId,
      name: identity.name,
      channelId: String(state.channelId),
      channelName: state.channel?.name || guild.channels?.cache?.get?.(state.channelId)?.name || 'Canal de voz',
      joinedAt: reliableJoin ? new Date(joinedMs).toISOString() : null,
      seconds: reliableJoin ? Math.floor((nowMs - joinedMs) / 1000) : null
    });
  }
  return [...active.values()].sort((left, right) => (right.seconds || 0) - (left.seconds || 0) || left.name.localeCompare(right.name, 'pt-BR'));
}

async function getPrimeTimeData(client, options = {}) {
  const requestedDays = Number(options.days || 30);
  const days = ALLOWED_PERIODS.has(requestedDays) ? requestedDays : 30;
  const timeZone = options.timeZone || TIME_ZONE;
  const nowMs = options.now instanceof Date ? options.now.getTime() : Number(options.now || Date.now());
  const endMs = nowMs;
  const today = dateKey(localParts(nowMs, timeZone));
  const firstDate = shiftDateKey(today, -(days - 1));
  const startMs = zonedDateTimeToUtc(firstDate, 0, timeZone);
  const db = options.db || getDatabase();

  const rows = loadHistoricalSessions(db, startMs, endMs);
  const sanitized = sanitizeSessions(rows, startMs, endMs);
  const intervals = mergePlayerIntervals(sanitized.valid);
  const analysis = analyseIntervals(intervals, startMs, endMs, timeZone);
  const activeNow = await activeVoicePlayers(client, db, nowMs);
  const activeById = new Map(activeNow.map((player) => [player.id, player]));
  for (const player of analysis.players) player.activeNow = activeById.get(player.id) || null;

  const peak = analysis.bestWindows[0] || null;
  return {
    generatedAt: new Date(nowMs).toISOString(),
    period: {
      days,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      timeZone,
      validSessions: sanitized.valid.length,
      ignoredAnomalous: sanitized.ignoredAnomalous,
      ignoredShort: sanitized.ignoredShort
    },
    summary: {
      activeNow: activeNow.length,
      uniquePlayers: analysis.players.length,
      totalVoiceSeconds: analysis.players.reduce((sum, player) => sum + player.totalVoiceSeconds, 0),
      peakAverage: peak?.averageConcurrent || 0,
      peakLabel: peak ? `${peak.weekdayLabel}, ${String(peak.startHour).padStart(2, '0')}h–${String(peak.endHour).padStart(2, '0')}h` : null
    },
    activeNow,
    ...analysis
  };
}

module.exports = {
  ALLOWED_PERIODS,
  MAX_SESSION_SECONDS,
  TIME_ZONE,
  WEEKDAYS,
  analyseIntervals,
  getPrimeTimeData,
  localParts,
  mergePlayerIntervals,
  sanitizeSessions,
  shiftDateKey,
  zonedDateTimeToUtc
};
