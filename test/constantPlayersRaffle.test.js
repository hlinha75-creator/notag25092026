const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'constant-raffle-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempRoot, 'notag.sqlite');

const { migrate } = require('../src/database/migrate');
const { getDatabase } = require('../src/database/connection');
const raffle = require('../src/modules/giveaways/constantPlayersRaffle.service');

migrate();

function resetState() {
  const db = getDatabase();
  db.prepare('DELETE FROM constant_raffle_results WHERE raffle_key = ?').run(raffle.RAFFLE_KEY);
  db.prepare('DELETE FROM constant_raffle_participants WHERE raffle_key = ?').run(raffle.RAFFLE_KEY);
  db.prepare('INSERT OR REPLACE INTO constant_raffles (raffle_key, scheduled_at, status, unresolved_json) VALUES (?, ?, ?, ?)')
    .run(raffle.RAFFLE_KEY, new Date(Date.now() - 1000).toISOString(), 'scheduled', '[]');

  const participants = raffle.PARTICIPANTS.slice(0, 10).map((name, index) => ({ discordId: `user-${index}`, name }));
  const insert = db.prepare('INSERT INTO constant_raffle_participants (raffle_key, discord_id, display_name) VALUES (?, ?, ?)');
  for (const participant of participants) {
    insert.run(raffle.RAFFLE_KEY, participant.discordId, participant.name);
  }
}

test('drawAll não sorteia novamente quando já houve resultado', () => {
  resetState();

  const now = new Date('2026-09-26T20:00:00.000Z');
  const first = raffle.drawAll({ now });
  const firstResults = getDatabase()
    .prepare('SELECT slot_number, winner_discord_id, winner_name FROM constant_raffle_results WHERE raffle_key = ? ORDER BY slot_number')
    .all(raffle.RAFFLE_KEY);

  const second = raffle.drawAll({ now: new Date(now.getTime() + 5000) });
  const secondResults = getDatabase()
    .prepare('SELECT slot_number, winner_discord_id, winner_name FROM constant_raffle_results WHERE raffle_key = ? ORDER BY slot_number')
    .all(raffle.RAFFLE_KEY);

  assert.equal(first, true);
  assert.equal(second, false);
  assert.deepEqual(firstResults, secondResults);

  getDatabase().close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
