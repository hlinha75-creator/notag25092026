function parseLocalDateTime(input, timeZone) {
  const raw = String(input || '').trim();
  let match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})$/);
  let parts;
  if (match) {
    parts = { year: +match[3], month: +match[2], day: +match[1], hour: +match[4], minute: +match[5] };
  } else {
    match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
    if (!match) throw new Error('Use data e hora no formato DD/MM/AAAA HH:mm.');
    parts = { year: +match[1], month: +match[2], day: +match[3], hour: +match[4], minute: +match[5] };
  }

  const { year, month, day, hour, minute } = parts;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new Error('Data ou hora invalida.');
  }

  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wallClockUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const displayed = localParts(new Date(instant), timeZone);
    const displayedUtc = Date.UTC(displayed.year, displayed.month - 1, displayed.day, displayed.hour, displayed.minute);
    instant += wallClockUtc - displayedUtc;
  }

  const date = new Date(instant);
  const verified = localParts(date, timeZone);
  if (['year', 'month', 'day', 'hour', 'minute'].some((key) => verified[key] !== parts[key])) {
    throw new Error(`Essa data/hora nao existe no fuso ${timeZone}.`);
  }
  return date;
}

function localParts(date, timeZone) {
  const values = {};
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return values;
}

function discordTimestamp(value, style = 'F') {
  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:${style}>`;
}

module.exports = { discordTimestamp, parseLocalDateTime };
