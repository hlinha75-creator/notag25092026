const { AttachmentBuilder } = require('discord.js');
const { toCsv } = require('../../utils/csv');

async function buildDailyReport({ currentAttachment, previousAttachment, voiceAttachment, dateText }) {
  const currentText = await downloadText(currentAttachment);
  const previousText = previousAttachment ? await downloadText(previousAttachment) : '';
  const voiceText = voiceAttachment ? await downloadText(voiceAttachment) : '';

  const currentMembers = parseMemberExport(currentText);
  const previousMembers = previousText ? parseMemberExport(previousText) : [];
  const voiceRows = voiceText ? parseFlexibleTable(voiceText).map(normalizeVoiceRow) : [];
  const reportDate = normalizeReportDate(dateText);
  const comparison = compareMembers({ currentMembers, previousMembers, voiceRows, reportDate });

  return {
    content: formatDiscordSummary(comparison, { hasPrevious: Boolean(previousAttachment), hasVoice: Boolean(voiceAttachment), reportDate }),
    files: [comparisonAttachment(comparison.rows, reportDate)]
  };
}

async function downloadText(attachment) {
  if (!attachment?.url) throw new Error('Anexo ausente.');
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`Nao consegui baixar o anexo ${attachment.name || attachment.url}.`);
  return response.text();
}

function parseMemberExport(text) {
  return parseFlexibleTable(text)
    .map((row) => {
      const characterName = firstValue(row, ['Character Name', 'character_name', 'albion_name', 'Albion', 'Nome', 'nome']);
      const lastSeen = firstValue(row, ['Last Seen', 'last_seen', 'ultimo_login', 'Visto por ultimo']);
      const roles = splitRoles(firstValue(row, ['Roles', 'roles', 'Cargos', 'cargos']));
      return {
        characterName,
        key: normalizeName(characterName),
        lastSeen,
        roles,
        lastSeenDate: parseAlbionDate(lastSeen),
        isOnline: normalizeName(lastSeen) === 'online'
      };
    })
    .filter((row) => row.key);
}

function parseFlexibleTable(text) {
  const delimiter = guessDelimiter(text);
  const rows = parseDelimited(text, delimiter);
  const headers = rows.shift() || [];
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [cleanCell(header), cleanCell(cells[index] || '')])));
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(current);
      if (row.some((cell) => cleanCell(cell))) rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  row.push(current);
  if (row.some((cell) => cleanCell(cell))) rows.push(row);
  return rows;
}

function guessDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find(Boolean) || '';
  const candidates = ['\t', ';', ','];
  return candidates
    .map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

function normalizeVoiceRow(row) {
  const albionName = firstValue(row, ['albion_name', 'Character Name', 'character_name', 'Albion', 'Nome']);
  const discordName = firstValue(row, ['discord_name', 'Discord']);
  const discordId = firstValue(row, ['discord_id', 'user_id']);
  return {
    key: normalizeName(albionName || discordName || discordId),
    albionName,
    discordName,
    discordId,
    voiceSessions: number(firstValue(row, ['voice_sessions', 'sessions', 'sessoes'])),
    voiceSeconds: number(firstValue(row, ['voice_seconds', 'seconds', 'segundos'])),
    voiceMinutes: number(firstValue(row, ['voice_minutes', 'duration_minutes'])),
    topChannels: firstValue(row, ['top_channels', 'channel_name', 'Canal']),
    favoriteHours: firstValue(row, ['favorite_hours', 'joined_hour', 'Hora'])
  };
}

function compareMembers({ currentMembers, previousMembers, voiceRows, reportDate }) {
  const current = mapByKey(currentMembers);
  const previous = mapByKey(previousMembers);
  const voice = mapByKey(voiceRows);
  const keys = new Set([...current.keys(), ...previous.keys()]);

  const rows = [...keys].map((key) => {
    const now = current.get(key);
    const before = previous.get(key);
    const voiceInfo = voice.get(key);
    const inactiveDays = now ? daysSince(now.lastSeenDate, reportDate) : null;
    return {
      character_name: now?.characterName || before?.characterName || voiceInfo?.albionName || '',
      status: now && before ? 'permaneceu' : now ? 'novo' : 'saiu',
      last_seen: now?.lastSeen || '',
      inactive_days: inactiveDays == null ? '' : inactiveDays,
      roles_current: now?.roles.join('|') || '',
      roles_previous: before?.roles.join('|') || '',
      role_changes: roleChanges(before?.roles || [], now?.roles || []),
      voice_sessions: voiceInfo?.voiceSessions || 0,
      voice_seconds: voiceInfo?.voiceSeconds || Math.round((voiceInfo?.voiceMinutes || 0) * 60),
      voice_minutes: voiceInfo?.voiceMinutes || Math.round(((voiceInfo?.voiceSeconds || 0) / 60) * 100) / 100,
      top_channels: voiceInfo?.topChannels || '',
      favorite_hours: voiceInfo?.favoriteHours || ''
    };
  });

  return {
    rows,
    currentMembers,
    previousMembers,
    voiceRows
  };
}

function formatDiscordSummary(comparison, { hasPrevious, hasVoice, reportDate }) {
  const rows = comparison.rows;
  const currentRows = rows.filter((row) => row.status !== 'saiu');
  const newRows = rows.filter((row) => row.status === 'novo');
  const removedRows = rows.filter((row) => row.status === 'saiu');
  const online = comparison.currentMembers.filter((member) => member.isOnline).length;
  const inactive7 = currentRows.filter((row) => Number(row.inactive_days) >= 7).length;
  const inactive14 = currentRows.filter((row) => Number(row.inactive_days) >= 14).length;
  const voiceActive = rows.filter((row) => Number(row.voice_seconds) > 0).length;
  const topVoice = [...rows]
    .filter((row) => Number(row.voice_seconds) > 0)
    .sort((a, b) => Number(b.voice_seconds) - Number(a.voice_seconds))
    .slice(0, 5);

  const lines = [
    `Relatorio diario Notag - ${reportDate}`,
    '',
    `Membros no arquivo atual: ${currentRows.length}`,
    `Online no Albion: ${online}`,
    hasPrevious ? `Novos desde o anterior: ${newRows.length}` : 'Arquivo anterior: nao enviado',
    hasPrevious ? `Sairam desde o anterior: ${removedRows.length}` : null,
    `Inativos 7+ dias: ${inactive7}`,
    `Inativos 14+ dias: ${inactive14}`,
    hasVoice ? `Com call no CSV de voz: ${voiceActive}` : 'CSV de voz: nao enviado',
    '',
    'Top call:',
    ...topVoice.map((row, index) => `${index + 1}. ${row.character_name} - ${formatMinutes(row.voice_minutes)}`),
    topVoice.length ? null : 'Sem dados de voz para listar.',
    '',
    'Arquivos:',
    '- CSV detalhado anexado nesta resposta.'
  ].filter(Boolean);

  return lines.join('\n').slice(0, 1900);
}

function comparisonAttachment(rows, reportDate) {
  const columns = [
    'character_name',
    'status',
    'last_seen',
    'inactive_days',
    'roles_current',
    'roles_previous',
    'role_changes',
    'voice_sessions',
    'voice_seconds',
    'voice_minutes',
    'top_channels',
    'favorite_hours'
  ];
  const csv = toCsv(rows, columns);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: `relatorio-diario-${reportDate}.csv` });
}

function mapByKey(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row.key) map.set(row.key, row);
  }
  return map;
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim()) return String(row[key]).trim();
  }
  return '';
}

function cleanCell(value) {
  return String(value || '').trim().replace(/^"|"$/g, '');
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function splitRoles(value) {
  return String(value || '').split(/[;|,]/).map((role) => role.trim()).filter(Boolean);
}

function roleChanges(beforeRoles, currentRoles) {
  const before = new Set(beforeRoles);
  const current = new Set(currentRoles);
  const added = [...current].filter((role) => !before.has(role));
  const removed = [...before].filter((role) => !current.has(role));
  return [
    ...added.map((role) => `+${role}`),
    ...removed.map((role) => `-${role}`)
  ].join('|');
}

function parseAlbionDate(value) {
  const text = String(value || '').trim();
  if (!text || normalizeName(text) === 'online') return null;
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
  if (!match) return null;
  const [, month, day, year, hour = '00', minute = '00', second = '00'] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`);
}

function normalizeReportDate(dateText) {
  const normalized = String(dateText || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : formatDate(new Date());
}

function daysSince(date, reportDate) {
  if (!date) return 0;
  const report = new Date(`${reportDate}T12:00:00-03:00`);
  return Math.max(0, Math.floor((report.getTime() - date.getTime()) / 86400000));
}

function formatDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function number(value) {
  const parsed = Number(String(value || '').replace(/[^\d,.-]/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMinutes(minutes) {
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h${String(Math.round(minutes % 60)).padStart(2, '0')}`;
  return `${Math.round(minutes)}min`;
}

module.exports = {
  buildDailyReport,
  parseMemberExport
};
