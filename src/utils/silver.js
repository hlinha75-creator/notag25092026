function parseSilver(input) {
  if (input == null) return 0;
  const raw = String(input).trim().toLowerCase().replace(/\s+/g, '').replace(',', '.');
  if (!raw) return 0;

  const match = raw.match(/^(-?\d+(?:\.\d+)?)(k|m)?$/);
  if (!match) {
    throw new Error(`Valor de prata invalido: ${input}`);
  }

  const value = Number(match[1]);
  const suffix = match[2];
  const multiplier = suffix === 'm' ? 1000000 : suffix === 'k' ? 1000 : 1;
  return Math.round(value * multiplier);
}

function formatSilver(amount) {
  const value = Number(amount || 0);
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (abs >= 1000000) {
    return `${sign}${trimNumber(abs / 1000000)}m`;
  }
  if (abs >= 1000) {
    return `${sign}${trimNumber(abs / 1000)}k`;
  }
  return `${value}`;
}

function trimNumber(value) {
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

module.exports = {
  formatSilver,
  parseSilver
};
