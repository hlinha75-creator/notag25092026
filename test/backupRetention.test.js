const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notag-backup-retention-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempRoot, 'notag.sqlite');

const { pruneBackups } = require('../src/database/backup');

test('retenção mantém sete dias e arquiva cópias antigas sem tocar em arquivos não gerenciados', (t) => {
  const backupDir = path.join(tempRoot, 'backups');
  const archiveDir = path.join(tempRoot, 'archive');
  const now = new Date('2026-07-28T12:00:00.000Z');
  fs.mkdirSync(backupDir, { recursive: true });

  for (let daysAgo = 0; daysAgo < 40; daysAgo += 1) {
    for (let copy = 0; copy < 2; copy += 1) {
      const modifiedAt = new Date(now.getTime() - (daysAgo * 24 * 60 * 60 * 1000) - (copy * 60 * 60 * 1000));
      const stamp = modifiedAt.toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(backupDir, `notag-${stamp}-test_${copy}.sqlite`);
      fs.writeFileSync(filePath, 'backup');
      fs.utimesSync(filePath, modifiedAt, modifiedAt);
    }
  }

  const unmanaged = path.join(backupDir, 'backup-importante.sqlite');
  fs.writeFileSync(unmanaged, 'preservar');
  const result = pruneBackups(backupDir, { recentDays: 7, maxCount: 30, archiveDir, now });
  const managedRemaining = fs.readdirSync(backupDir).filter((name) => name.startsWith('notag-'));

  assert.equal(result.total, 80);
  assert.equal(result.kept, 14);
  assert.equal(result.removed.length, 0);
  assert.equal(result.archived.length, 66);
  assert.equal(managedRemaining.length, 14);
  assert.equal(fs.readdirSync(archiveDir).length, 66);
  assert.equal(fs.existsSync(unmanaged), true);

  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
});
