const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notag-registration-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempRoot, 'registration.sqlite');

const { getDatabase } = require('../src/database/connection');
const { migrate } = require('../src/database/migrate');
const registration = require('../src/modules/registration/registration.repository');

migrate();

test('novo envio atualiza o pedido pendente em vez de criar duplicata', () => {
  registration.upsertUser({
    discordId: 'member-1',
    discordName: 'Membro de teste',
    registrationStatus: 'pending'
  });
  const first = registration.createRegistration({ discordId: 'member-1', albionName: 'NomeAntigo' });
  const second = registration.createRegistration({ discordId: 'member-1', albionName: 'NomeCorreto' });

  assert.equal(second.lastInsertRowid, first.lastInsertRowid);
  assert.equal(second.reused, true);
  assert.deepEqual(
    getDatabase().prepare("SELECT albion_name FROM registrations WHERE discord_id = ? AND status = 'pending'").all('member-1'),
    [{ albion_name: 'NomeCorreto' }]
  );
});

test.after(() => {
  getDatabase().close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
