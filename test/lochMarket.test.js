const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notag-loch-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempRoot, 'loch-test.sqlite');

const { getDatabase } = require('../src/database/connection');
const { migrate } = require('../src/database/migrate');
const lochMarket = require('../src/modules/community/lochMarket.service');

migrate();

test.after(() => {
  getDatabase().close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('registra cada reação apenas uma vez por membro', () => {
  const first = lochMarket.registerFeedback('member-1', 'liked');
  const duplicate = lochMarket.registerFeedback('member-1', 'liked');
  const read = lochMarket.registerFeedback('member-1', 'read');

  assert.equal(first.added, true);
  assert.equal(duplicate.added, false);
  assert.equal(read.added, true);
  assert.deepEqual(read.counts, { liked: 1, read: 1 });
});

test('guarda sugestão e registra a resposta da staff', () => {
  const id = lochMarket.createSuggestion({ authorId: 'member-2', suggestion: 'Minha opinião' });
  lochMarket.attachStaffMessage(id, 'staff-channel', 'staff-message');
  const answered = lochMarket.markAnswered({ id, staffId: 'staff-1', answer: 'Resposta enviada' });

  assert.equal(answered.author_id, 'member-2');
  assert.equal(answered.staff_message_id, 'staff-message');
  assert.equal(answered.status, 'answered');
  assert.equal(answered.answered_by, 'staff-1');
  assert.equal(answered.answer, 'Resposta enviada');
});
