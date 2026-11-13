const test = require('node:test');
const assert = require('node:assert/strict');

const campaigns = require('../src/modules/campaigns/campaigns.service');
const repo = require('../src/modules/campaigns/campaigns.repository');
const audit = require('../src/modules/audit/audit.repository');

test('event payout donation prompts are disabled for loot splits', () => {
  const originalGetActiveCampaign = repo.getActiveCampaign;
  const originalCreateEventPayoutDecision = repo.createEventPayoutDecision;
  const originalCreateAuditLog = audit.createAuditLog;

  try {
    repo.getActiveCampaign = () => ({ id: 1, code: 'META-TEST', role_name: '900m' });
    repo.createEventPayoutDecision = () => {
      throw new Error('doacao de loot split nao deve criar escolha');
    };
    audit.createAuditLog = () => {};

    const result = campaigns.createEventPayoutChoices({
      event: { id: 42, event_code: 'EVT-000042' },
      participants: [{ discord_id: '123', payout_amount: 5000, is_spectator: false }],
      actorId: 'staff-1'
    });

    assert.equal(result, null);
  } finally {
    repo.getActiveCampaign = originalGetActiveCampaign;
    repo.createEventPayoutDecision = originalCreateEventPayoutDecision;
    audit.createAuditLog = originalCreateAuditLog;
  }
});
