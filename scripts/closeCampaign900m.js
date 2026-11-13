require('dotenv').config();

const { REST, Routes } = require('discord.js');
const { backupDatabase } = require('../src/database/backup');
const { getDatabase, transaction } = require('../src/database/connection');
const audit = require('../src/modules/audit/audit.repository');
const finance = require('../src/modules/finance/finance.service');
const { formatSilver } = require('../src/utils/silver');

const APPLY_FLAG = '--apply';
const CAMPAIGN_CODE = '900m';

function campaignSnapshot(db) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE code = ? ORDER BY id DESC LIMIT 1').get(CAMPAIGN_CODE);
  if (!campaign) throw new Error('Campanha 900m nao encontrada.');

  const totals = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS raised, COUNT(DISTINCT user_id) AS contributors
    FROM campaign_contributions
    WHERE campaign_id = ? AND status = 'approved'
  `).get(campaign.id);
  const pending = db.prepare(`
    SELECT cep.*, e.event_code
    FROM campaign_event_payouts cep
    JOIN events e ON e.id = cep.event_id
    WHERE cep.campaign_id = ? AND cep.status = 'pending'
    ORDER BY cep.id
  `).all(campaign.id);

  return {
    campaign,
    raised: Number(totals?.raised || 0),
    contributors: Number(totals?.contributors || 0),
    pending,
    pendingAmount: pending.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  };
}

const closeCampaign = transaction((actorId) => {
  const db = getDatabase();
  const before = campaignSnapshot(db);
  if (before.campaign.status !== 'open') {
    return { alreadyClosed: true, ...before, transactions: [] };
  }

  const transactions = [];
  for (const decision of before.pending) {
    const duplicate = db.prepare(`
      SELECT id FROM balance_transactions
      WHERE user_id = ? AND type = 'event_payout'
        AND reference_type = 'event' AND reference_id = ?
      LIMIT 1
    `).get(decision.user_id, String(decision.event_id));
    if (duplicate) {
      throw new Error(`Pagamento ja existente para ${decision.user_id} no evento ${decision.event_code}.`);
    }

    const updated = db.prepare(`
      UPDATE campaign_event_payouts
      SET status = 'paid_balance', decision = 'campaign_closed_to_balance',
          processed_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).run(actorId, decision.id);
    if (updated.changes !== 1) throw new Error(`Escolha ${decision.id} mudou durante o fechamento.`);

    transactions.push(finance.applyBalanceTransaction({
      type: 'event_payout',
      userId: decision.user_id,
      amount: Number(decision.amount || 0),
      reason: `Pagamento do evento ${decision.event_code} (encerramento da campanha @900m)`,
      referenceType: 'event',
      referenceId: String(decision.event_id),
      createdBy: actorId
    }));
  }

  const closed = db.prepare(`
    UPDATE campaigns
    SET status = 'closed', closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'open'
  `).run(before.campaign.id);
  if (closed.changes !== 1) throw new Error('A campanha mudou durante o fechamento.');

  audit.createAuditLog({
    type: 'campaign_closed',
    actorId,
    targetId: String(before.campaign.id),
    beforeValue: 'open',
    afterValue: 'closed',
    reason: 'Encerramento administrativo da campanha @900m',
    metadata: {
      raised: before.raised,
      contributors: before.contributors,
      pendingPaid: before.pending.length,
      pendingAmount: before.pendingAmount
    }
  });

  return { alreadyClosed: false, ...campaignSnapshot(db), transactions };
});

function finalMessage(result) {
  const campaign = result.campaign;
  const percent = campaign.goal_amount > 0 ? (result.raised / Number(campaign.goal_amount)) * 100 : 0;
  return {
    content: null,
    embeds: [{
      title: 'Campanha @900m encerrada',
      description: [
        `A campanha **${campaign.title}** foi finalizada.`,
        '',
        `**Arrecadado:** ${formatSilver(result.raised)} / ${formatSilver(campaign.goal_amount)} (${percent.toFixed(1)}%)`,
        `**Contribuidores:** ${result.contributors}`,
        `**Escolhas pendentes pagas ao saldo:** ${result.transactions.length} (${formatSilver(result.transactions.reduce((sum, row) => sum + row.amount, 0))})`,
        '',
        'Obrigado a todos que participaram e contribuíram com a guilda.'
      ].join('\n'),
      color: 0xf0b232,
      timestamp: new Date().toISOString()
    }],
    components: []
  };
}

async function updateDiscord(result) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) return { messageUpdated: false, dmsSent: 0, dmsFailed: result.transactions.length };
  const rest = new REST({ version: '10' }).setToken(token);
  let messageUpdated = false;
  if (result.campaign.progress_channel_id && result.campaign.progress_message_id) {
    await rest.patch(
      Routes.channelMessage(result.campaign.progress_channel_id, result.campaign.progress_message_id),
      { body: finalMessage(result) }
    );
    messageUpdated = true;
  }

  let dmsSent = 0;
  let dmsFailed = 0;
  for (const item of result.transactions) {
    try {
      const dm = await rest.post(Routes.userChannels(), { body: { recipient_id: item.userId } });
      await rest.post(Routes.channelMessages(dm.id), {
        body: {
          content: [
            `A campanha **@900m** foi encerrada. Sua escolha pendente foi convertida automaticamente em saldo.`,
            `Entrou **${formatSilver(item.amount)}** referente ao evento **${item.referenceId}**.`,
            `Saldo anterior: ${formatSilver(item.beforeBalance)}. Saldo atual: ${formatSilver(item.afterBalance)}.`
          ].join('\n')
        }
      });
      dmsSent += 1;
    } catch {
      dmsFailed += 1;
    }
  }
  return { messageUpdated, dmsSent, dmsFailed };
}

async function main() {
  const db = getDatabase();
  const before = campaignSnapshot(db);
  if (!process.argv.includes(APPLY_FLAG)) {
    console.log(JSON.stringify({ mode: 'dry-run', ...before, pending: before.pending.length }, null, 2));
    return;
  }

  const backupPath = backupDatabase('before_campaign_900m_close');
  const result = closeCampaign('system:campaign-close');
  const discord = await updateDiscord(result);
  console.log(JSON.stringify({
    mode: 'applied',
    campaignId: result.campaign.id,
    status: result.campaign.status,
    raised: result.raised,
    contributors: result.contributors,
    pendingPaid: result.transactions.length,
    pendingAmount: result.transactions.reduce((sum, row) => sum + row.amount, 0),
    backupPath,
    discord
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
