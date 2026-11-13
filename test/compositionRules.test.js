const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const rules = require('../src/modules/events/compositionRules');

const unauthorizedFetch = async () => ({ ok: false, status: 401, text: async () => '' });

test('snapshot empacotado mantém regras atuais quando a planilha privada responde 401', async () => {
  const snapshot = await rules.loadSnapshot('cta', { fetchImpl: unauthorizedFetch, force: true });
  assert.equal(snapshot.sourceStatus, 'packaged');
  assert.equal(snapshot.sourceColumn, 'CTA');
  assert.equal(rules.ruleFor(snapshot, 'T4_2H_ICECRYSTAL_UNDEAD').key, 'unique');
  assert.equal(rules.ruleFor(snapshot, 'T4_2H_KNUCKLES_SET3').key, 'unique');
  assert.equal(rules.ruleFor(snapshot, 'T4_2H_LONGBOW').key, 'max_one');
  assert.equal(rules.ruleFor(snapshot, 'T4_2H_BOW_AVALON').key, 'repeat');
  assert.ok(snapshot.warnings.some((warning) => /401/.test(warning)));
  assert.ok(snapshot.warnings.some((warning) => /limite personalizado/i.test(warning)));
});

test('Raid Avalon Full usa explicitamente a coluna Raid Full', async () => {
  const snapshot = await rules.loadSnapshot('raid_avalon', { fetchImpl: unauthorizedFetch, force: true });
  assert.equal(snapshot.sourceColumn, 'Raid Full');
  assert.equal(rules.ruleFor(snapshot, 'T4_2H_BOW_KEEPER').key, 'forbidden');
  assert.equal(rules.ruleFor(snapshot, 'T4_2H_HOLYSTAFF_HELL').key, 'repeat');
});

test('Raid Dragão não herda silenciosamente regras de outra raid quando a coluna não existe', async () => {
  const snapshot = await rules.loadSnapshot('raid_dragon', { fetchImpl: unauthorizedFetch, force: true });
  assert.equal(snapshot.sourceColumn, null);
  assert.ok(snapshot.warnings.some((warning) => /coluna.*raid_dragon/i.test(warning)));
  assert.equal(Object.keys(snapshot.weapons).length, 2);
});

test('limite personalizado aceita mínimo e máximo da aba detalhada', () => {
  const parsed = rules.sheetRule('Limite personalizado', { min: 2, max: 4 });
  assert.deepEqual(parsed, { key: 'custom', min: 2, max: 4, role: null });
  assert.equal(rules.sheetRule('Limite personalizado', { min: null, max: null }), null);
  assert.equal(rules.sheetRule('Limite personalizado', { min: 5, max: 2 }), null);
});

test('conta de serviço lê a planilha privada pela API sem torná-la pública', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const previous = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: 'bot-planilha@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    token_uri: 'https://oauth2.googleapis.com/token'
  });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('oauth2.googleapis.com')) {
      return { ok: true, json: async () => ({ access_token: 'token-teste', expires_in: 3600 }) };
    }
    return {
      ok: true,
      json: async () => ({ valueRanges: [
        { values: [['Arma', 'Item ID', 'Regra padrão', 'CTA'], ['Longbow', 'T4_2H_LONGBOW', 'Máximo 1', 'Herdar padrão']] },
        { values: [['Conteúdo', 'Item ID', 'Regra', 'Mínimo personalizado', 'Máximo personalizado']] }
      ] })
    };
  };
  try {
    const data = await rules.loadSheetData({ fetchImpl, force: true });
    assert.equal(data.sourceStatus, 'remote_authenticated');
    assert.equal(calls.length, 2);
    assert.match(calls[1].options.headers.Authorization, /^Bearer /);
  } finally {
    if (previous == null) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = previous;
  }
});
