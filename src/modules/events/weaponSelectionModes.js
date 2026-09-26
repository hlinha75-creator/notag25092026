const modes = Object.freeze({
  predefined: {
    key: 'predefined',
    label: 'Armas predefinidas pelo caller',
    description: 'O caller escolhe a arma de cada vaga antes de publicar.'
  },
  role_free: {
    key: 'role_free',
    label: 'Livre por função, sem informar arma',
    description: 'O membro escolhe somente a função; não precisa declarar arma.'
  },
  sheet_limited: {
    key: 'sheet_limited',
    label: 'Escolha respeitando a planilha',
    description: 'O membro declara a arma e o bot aplica mínimos, máximos e proibições.'
  },
  weapon_declared: {
    key: 'weapon_declared',
    label: 'Escolha sem limite, informando arma',
    description: 'O membro declara a arma, mas repetições não são limitadas.'
  }
});

function normalize(value) {
  const legacy = String(value || '') === 'free' ? 'sheet_limited' : String(value || 'predefined');
  if (!modes[legacy]) throw new Error('Escolha um modo válido para as armas.');
  return legacy;
}

function options() {
  return Object.values(modes).map(({ key, label, description }) => ({ label, value: key, description }));
}

function requiresWeapon(value) {
  return ['sheet_limited', 'weapon_declared'].includes(normalize(value));
}

function respectsSheet(value) {
  return normalize(value) === 'sheet_limited';
}

module.exports = { modes, normalize, options, requiresWeapon, respectsSheet };
