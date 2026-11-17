const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guild-removal-campaign-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempRoot, 'notag.sqlite');

const ids = require('../src/config/ids');
const { migrate } = require('../src/database/migrate');
const { getDatabase } = require('../src/database/connection');
const campaignService = require('../src/modules/members/guildRemovalCampaign.service');

migrate();

function discordMember(id, albionName) {
  const member = {
    id,
    displayName: albionName,
    nickname: albionName,
    kickable: true,
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
    user: {
      bot: false,
      tag: `${id}#0001`,
      username: id,
      createdAt: new Date('2025-01-01T00:00:00.000Z')
    },
    roles: { cache: new Map([[ids.roles.member, { id: ids.roles.member }]]) },
    kicked: false,
    async kick() {
      this.kicked = true;
    }
  };
  return member;
}

test('campanha avisa, preserva contestacao e remove apenas ausente sem revisao apos 24 horas', async () => {
  const database = getDatabase();
  database.prepare(`
    INSERT INTO member_snapshots (created_by, source_name, member_count, online_count)
    VALUES ('test', 'roster-vazio.csv', 0, 0)
  `).run();
  const insertUser = database.prepare(`
    INSERT INTO users (discord_id, discord_name, albion_name, registration_status)
    VALUES (?, ?, ?, 'member')
  `);
  insertUser.run('user-1', 'User 1', 'AlbionUm');
  insertUser.run('user-2', 'User 2', 'AlbionDois');

  const first = discordMember('user-1', 'AlbionUm');
  const second = discordMember('user-2', 'AlbionDois');
  const members = new Map([[first.id, first], [second.id, second]]);
  const sentMessages = new Map();
  let messageSequence = 0;
  const makeChannel = (id) => ({
    id,
    isTextBased: () => true,
    messages: {
      fetch: async (messageId) => sentMessages.get(messageId) || null
    },
    send: async (payload) => {
      const message = {
        id: `message-${++messageSequence}`,
        payload,
        async edit(update) {
          this.payload = { ...this.payload, ...update };
          return this;
        }
      };
      sentMessages.set(message.id, message);
      return message;
    }
  });
  const announcementChannel = makeChannel(ids.channels.inactivityNotice);
  const staffChannel = makeChannel(ids.channels.staff);
  const client = {
    channels: {
      fetch: async (channelId) => channelId === ids.channels.inactivityNotice ? announcementChannel : staffChannel
    },
    guilds: { fetch: async () => guild }
  };
  const guild = {
    id: ids.guildId,
    ownerId: 'owner-id',
    client,
    members: {
      cache: members,
      fetch: async (memberId) => memberId ? (members.get(String(memberId)) || null) : members
    }
  };
  first.guild = guild;
  second.guild = guild;

  const started = await campaignService.startCampaign({
    guild,
    actorId: 'staff-user',
    expectedSnapshotId: 1
  });
  assert.equal(started.candidates, 2);
  assert.match([...sentMessages.values()][0].payload.content, /serao removidas/);
  assert.deepEqual([...sentMessages.values()][0].payload.allowedMentions.users.toSorted(), ['user-1', 'user-2']);

  const appeal = await campaignService.submitAppeal({
    client,
    campaignId: started.id,
    discordId: 'user-1',
    albionName: 'AlbionUm',
    reason: 'Continuo na guild e apareco com este personagem.'
  });
  assert.equal(appeal.alreadySubmitted, false);

  database.prepare("UPDATE guild_removal_campaigns SET execute_at = datetime('now', '-1 minute') WHERE id = ?").run(started.id);
  const processed = await campaignService.processDueCampaigns(client);
  assert.equal(processed.processed, 1);
  assert.equal(first.kicked, false);
  assert.equal(second.kicked, true);

  const statuses = database.prepare(`
    SELECT discord_id, status FROM guild_removal_candidates WHERE campaign_id = ? ORDER BY discord_id
  `).all(started.id);
  assert.deepEqual(statuses, [
    { discord_id: 'user-1', status: 'appealed' },
    { discord_id: 'user-2', status: 'removed' }
  ]);
  assert.equal(campaignService.campaignById(started.id).status, 'completed');

  database.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
