function embedFieldValue(value, maxLength = 1024) {
  const text = String(value || '-').trim() || '-';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 20)}\n... texto cortado`;
}

function embedLinesFields(name, lines, emptyText, maxLength = 1024) {
  const cleanLines = lines.map((line) => String(line || '').trim()).filter(Boolean);
  if (!cleanLines.length) return [{ name, value: emptyText, inline: false }];

  const fields = [];
  let current = [];
  for (const line of cleanLines) {
    const candidate = [...current, line].join('\n');
    if (candidate.length > maxLength && current.length > 0) {
      fields.push({ name: fieldPageName(name, fields.length), value: current.join('\n'), inline: false });
      current = [line];
    } else if (line.length > maxLength) {
      fields.push({ name: fieldPageName(name, fields.length), value: embedFieldValue(line, maxLength), inline: false });
      current = [];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    fields.push({ name: fieldPageName(name, fields.length), value: current.join('\n'), inline: false });
  }
  return fields.slice(0, 20);
}

function fieldPageName(name, index) {
  return index === 0 ? name : `${name} ${index + 1}`;
}

module.exports = {
  embedFieldValue,
  embedLinesFields
};
