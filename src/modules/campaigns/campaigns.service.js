const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const ids = require('../../config/ids');
const { transaction } = require('../../database/connection');
const { backupDatabase } = require('../../database/backup');
const audit = require('../audit/audit.repository');
const finance = require('../finance/finance.service');
const financeRepo = require('../finance/finance.repository');
const eventsRepo = require('../events/events.repository');
const repo = require('./campaigns.repository');
const { formatSilver } = require('../../utils/silver');

const decisionWindowMs = 24 * 60 * 60 * 1000;
const defaultCampaignRoleName = '900m';

function getActiveCampaign() {
  return repo.getActiveCampaign();
}

function createEventPayoutChoices({ event, participants, actorId }) {
  const campaign = repo.getActiveCampaign();
  if (!campaign) return null;

  const expiresAt = new Date(Date.now() + decisionWindowMs).toISOString();
  const decisions = participants
    .filter((participant) => !participant.is_spectator && Number(participant.payout_amount || 0) > 0)
    .map((participant) => repo.createEventPayoutDecision({
      campaignId: campaign.id,
      eventId: event.id,
      userId: participant.discord_id,
      amount: Number(participant.payout_amount || 0),
      expiresAt,
      createdBy: actorId
    }));

  audit.createAuditLog({
    type: 'campaign_event_choices_created',
    actorId,
    targetId: String(event.id),
    reason: `${event.event_code} -> campanha ${campaign.code}`,
    metadata: { campaignId: campaign.id, decisions: decisions.length, expiresAt }
  });

  return { campaign, decisions, expiresAt };
}

async function sendEventPayoutDms({ client, eventId, choices }) {
  if (!choices?.campaign || !choices.decisions?.length) return { sent: 0, failed: 0 };
  const event = eventsRepo.getEvent(eventId);
  let sent = 0;
  let failed = 0;

  for (const decision of choices.decisions) {
    try {
      const user = await client.users.fetch(decision.user_id);
      const message = await user.send(decisionMessagePayload({ campaign: choices.campaign, event, decision }));
      repo.setDecisionDmMessage({ id: decision.id, messageId: message.id });
      sent += 1;
    } catch (error) {
      failed += 1;
      audit.createAuditLog({
        type: 'campaign_event_choice_dm_failed',
        targetId: decision.user_id,
        afterValue: decision.amount,
        reason: error.message,
        metadata: { campaignId: choices.campaign.id, eventId }
      });
    }
  }

  return { sent, failed };
}

function decisionMessagePayload({ campaign, event, decision }) {
  const expires = Math.floor(Date.parse(decision.expires_at) / 1000);
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`Meta @${campaign.role_name || defaultCampaignRoleName}`)
        .setDescription([
          `Voce receberia **${formatSilver(decision.amount)}** do evento **${event?.event_code || decision.event_id}**.`,
          '',
          `Quer deixar **100% da sua parte** para a meta **@${campaign.role_name || defaultCampaignRoleName}**?`,
          `Se voce nao responder ate <t:${expires}:R>, o bot deposita automaticamente no seu saldo.`
        ].join('\n'))
        .setColor(0xf59e0b)
        .setTimestamp(new Date())
    ],
    components: [decisionButtons(decision.id)]
  };
}

function decisionButtons(decisionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`campaign:donate_event:${decisionId}`)
      .setLabel('Doar para @900m')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`campaign:keep_event:${decisionId}`)
      .setLabel('Receber meu saldo')
      .setStyle(ButtonStyle.Secondary)
  );
}

const resolveDecisionTransaction = transaction(({ decisionId, userId, choice, actorId, expired = false }) => {
  const decision = repo.getEventPayoutDecision(decisionId);
  if (!decision) throw new Error('Escolha da campanha nao encontrada.');
  if (decision.user_id !== userId) throw new Error('Essa escolha da campanha nao pertence a voce.');
  if (decision.status !== 'pending') throw new Error('Essa escolha da campanha ja foi resolvida.');

  const campaign = repo.getCampaign(decision.campaign_id);
  const event = eventsRepo.getEvent(decision.event_id);
  const amount = Number(decision.amount || 0);

  if (choice === 'donate') {
    const updated = repo.markEventPayoutDecision({
      id: decision.id,
      status: 'donated',
      decision: 'donate',
      processedBy: actorId
    });
    if (updated.changes === 0) throw new Error('Essa escolha da campanha ja foi resolvida.');
    repo.insertContribution({
      campaignId: campaign.id,
      userId: decision.user_id,
      amount,
      sourceType: 'event_payout',
      sourceId: String(decision.event_id),
      createdBy: actorId,
      approvedBy: decision.created_by,
      note: `Doacao do loot split do evento ${event?.event_code || decision.event_id}`
    });
    audit.createAuditLog({
      type: 'campaign_event_payout_donated',
      actorId,
      targetId: decision.user_id,
      afterValue: amount,
      reason: `${event?.event_code || decision.event_id} -> ${campaign.code}`,
      metadata: { campaignId: campaign.id, decisionId: decision.id }
    });
    return { campaign, event, decision: repo.getEventPayoutDecision(decision.id), transaction: null, donated: true };
  }

  const updated = repo.markEventPayoutDecision({
    id: decision.id,
    status: 'paid_balance',
    decision: expired ? 'expired_to_balance' : 'keep_balance',
    processedBy: actorId
  });
  if (updated.changes === 0) throw new Error('Essa escolha da campanha ja foi resolvida.');

  const balanceTransaction = finance.applyBalanceTransaction({
    type: 'event_payout',
    userId: decision.user_id,
    amount,
    reason: expired
      ? `Pagamento do evento ${event?.event_code || decision.event_id} (campanha expirada em 24h)`
      : `Pagamento do evento ${event?.event_code || decision.event_id}`,
    referenceType: 'event',
    referenceId: String(decision.event_id),
    createdBy: actorId
  });

  audit.createAuditLog({
    type: expired ? 'campaign_event_payout_expired_to_balance' : 'campaign_event_payout_kept_balance',
    actorId,
    targetId: decision.user_id,
    afterValue: amount,
    reason: `${event?.event_code || decision.event_id} -> saldo`,
    metadata: { campaignId: campaign.id, decisionId: decision.id }
  });

  return { campaign, event, decision: repo.getEventPayoutDecision(decision.id), transaction: balanceTransaction, donated: false };
});

async function resolveEventPayoutChoice({ client, decisionId, userId, choice, actorId }) {
  const result = resolveDecisionTransaction({ decisionId, userId, choice, actorId });
  if (result.donated) {
    await grantCampaignRole(client, result.campaign, userId).catch((error) => {
      audit.createAuditLog({ type: 'campaign_role_failed', targetId: userId, reason: error.message });
    });
    await notifyDonationDm({ client, result }).catch(() => {});
  }
  await refreshActiveCampaignProgress(client).catch(() => {});
  return result;
}


const donateFromBalanceTransaction = transaction(({ userId, amount, actorId }) => {
  const campaign = repo.getActiveCampaign();
  if (!campaign) throw new Error('Nao ha meta aberta no momento.');
  const value = Math.floor(Number(amount || 0));
  if (!Number.isFinite(value) || value <= 0) throw new Error('Informe um valor maior que zero.');

  backupDatabase('before_campaign_balance_donation');
  const currentBalance = financeRepo.getBalance(userId);
  if (currentBalance <= 0) throw new Error('Voce nao tem saldo positivo para doar.');
  if (value > currentBalance) {
    throw new Error(`Voce tentou doar ${formatSilver(value)}, mas seu saldo atual e ${formatSilver(currentBalance)}.`);
  }

  const balanceTransaction = finance.applyBalanceTransaction({
    type: 'campaign_donation',
    userId,
    amount: -value,
    reason: `Doacao para meta @${campaign.role_name || defaultCampaignRoleName}`,
    referenceType: 'campaign',
    referenceId: String(campaign.id),
    createdBy: actorId
  });

  const contribution = repo.insertContribution({
    campaignId: campaign.id,
    userId,
    amount: value,
    sourceType: 'balance_donation',
    sourceId: null,
    createdBy: actorId,
    approvedBy: actorId,
    note: `Doacao de saldo para @${campaign.role_name || defaultCampaignRoleName}`
  });

  audit.createAuditLog({
    type: 'campaign_balance_donation',
    actorId,
    targetId: userId,
    beforeValue: currentBalance,
    afterValue: currentBalance - value,
    reason: `Doacao para ${campaign.code}`,
    metadata: { campaignId: campaign.id, amount: value }
  });

  return { campaign, transaction: balanceTransaction, contribution };
});

async function donateFromBalance({ client, userId, amount, actorId }) {
  const result = donateFromBalanceTransaction({ userId, amount, actorId });
  await grantCampaignRole(client, result.campaign, userId).catch((error) => {
    audit.createAuditLog({ type: 'campaign_role_failed', targetId: userId, reason: error.message });
  });
  await refreshActiveCampaignProgress(client).catch(() => {});
  return result;
}
async function processExpiredEventPayouts(client) {
  const expired = repo.listExpiredPendingDecisions(new Date().toISOString(), 100);
  const transactions = [];
  let processed = 0;

  for (const decision of expired) {
    try {
      const result = resolveDecisionTransaction({
        decisionId: decision.id,
        userId: decision.user_id,
        choice: 'keep',
        actorId: 'system',
        expired: true
      });
      if (result.transaction) transactions.push(result.transaction);
      processed += 1;
    } catch (error) {
      audit.createAuditLog({
        type: 'campaign_expired_choice_failed',
        targetId: decision.user_id,
        reason: error.message,
        metadata: { decisionId: decision.id }
      });
    }
  }

  if (transactions.length > 0) {
    await finance.notifyBalanceTransactions({ client, transactions });
  }
  if (processed > 0) {
    await refreshActiveCampaignProgress(client).catch(() => {});
  }
  return { processed, transactions: transactions.length };
}

async function notifyDonationDm({ client, result }) {
  const user = await client.users.fetch(result.decision.user_id);
  const totals = repo.getCampaignTotals(result.campaign.id);
  await user.send([
    `Voce doou ${formatSilver(result.decision.amount)} da sua parte do evento ${result.event?.event_code || result.decision.event_id} para @${result.campaign.role_name || defaultCampaignRoleName}.`,
    `Meta atual: ${formatSilver(totals.raised)} / ${formatSilver(result.campaign.goal_amount)}.`,
    'Obrigado por ajudar a guilda. Essa contribuicao ficou registrada no historico da campanha.'
  ].join('\n'));
}

async function grantCampaignRole(client, campaign, userId) {
  const guild = await client.guilds.fetch(ids.guildId);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return null;
  const role = await ensureCampaignRole(guild, campaign);
  if (!role) return null;
  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role, `Contribuiu com a campanha ${campaign.code}`);
  }
  return role;
}

async function ensureCampaignRole(guild, campaign) {
  const roleName = String(campaign.role_name || defaultCampaignRoleName).replace(/^@+/, '') || defaultCampaignRoleName;
  const roles = await guild.roles.fetch().catch(() => guild.roles.cache);
  let role = roles.find((item) => item.name.toLowerCase() === roleName.toLowerCase());
  if (!role) {
    role = await guild.roles.create({
      name: roleName,
      mentionable: true,
      reason: `Cargo memorial da campanha ${campaign.code}`
    });
  }
  return role;
}

async function refreshActiveCampaignProgress(client) {
  const campaign = repo.getActiveCampaign();
  if (!campaign) return null;
  const channelId = campaignProgressChannelId(campaign);
  await deletePreviousProgressMessageIfMoved(client, campaign, channelId).catch(() => {});
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;

  const payload = progressMessagePayload(campaign);
  const canReuseMessage = campaign.progress_channel_id === channelId;
  let message = canReuseMessage && campaign.progress_message_id
    ? await channel.messages.fetch(campaign.progress_message_id).catch(() => null)
    : null;

  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
  }
  repo.updateCampaignProgressMessage({ campaignId: campaign.id, channelId: channel.id, messageId: message.id });
  return message;
}

function campaignProgressChannelId(campaign) {
  if (campaign?.code === '900m') return ids.channels.campaignAnnouncements;
  return campaign.progress_channel_id || ids.channels.notagChat;
}

async function deletePreviousProgressMessageIfMoved(client, campaign, targetChannelId) {
  if (!campaign?.progress_message_id) return;
  if (!campaign.progress_channel_id || campaign.progress_channel_id === targetChannelId) return;
  const previousChannel = await client.channels.fetch(campaign.progress_channel_id).catch(() => null);
  const previousMessage = await previousChannel?.messages.fetch(campaign.progress_message_id).catch(() => null);
  await previousMessage?.delete().catch(() => {});
}


function campaignPanelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('campaign:donate_balance')
      .setLabel('Doar saldo')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('campaign:view_contributors')
      .setLabel('Lista HTML')
      .setStyle(ButtonStyle.Secondary)
  );
}
function progressMessagePayload(campaign) {
  const totals = repo.getCampaignTotals(campaign.id);
  const goal = Number(campaign.goal_amount || 0);
  const percent = goal > 0 ? Math.min(100, (totals.raised / goal) * 100) : 0;
  const remaining = Math.max(0, goal - totals.raised);

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`Meta @${campaign.role_name || defaultCampaignRoleName}`)
        .setDescription([
          progressBar(percent),
          `Arrecadado: **${formatSilver(totals.raised)} / ${formatSilver(goal)}** (${percent.toFixed(1)}%).`,
          remaining > 0 ? `Faltam: **${formatSilver(remaining)}**.` : '**Meta batida.**',
          `Contribuidores: **${totals.contributors}**.`
        ].join('\n'))
        .setColor(0xf59e0b)
        .setTimestamp(new Date())
    ],
    components: [campaignPanelButtons()],
    allowedMentions: { parse: [] }
  };
}


function contributorName(row) {
  const mention = row.user_id ? `<@${row.user_id}>` : null;
  const albion = row.albion_name ? `Albion: ${row.albion_name}` : null;
  const discord = !mention && row.discord_name ? row.discord_name : null;
  return [mention || discord || row.user_id || 'Sem nome', albion].filter(Boolean).join(' | ');
}

function contributorsEmbed(limit = 50) {
  const campaign = repo.getActiveCampaign();
  if (!campaign) {
    return new EmbedBuilder()
      .setTitle('Meta @900m')
      .setDescription('Nao ha meta aberta no momento.')
      .setColor(0x6b7280)
      .setTimestamp(new Date());
  }
  const totals = repo.getCampaignTotals(campaign.id);
  const rows = repo.listContributorTotals(campaign.id, limit);
  const latest = repo.listContributions(campaign.id, 12);
  const contributorLines = rows.map((row, index) => (
    `${index + 1}. ${contributorName(row)} - ${formatSilver(row.total_amount)} (${row.entries} entrada${Number(row.entries) === 1 ? '' : 's'})`
  ));
  const latestLines = latest.map((row) => `${contributorName(row)} - ${formatSilver(row.amount)} (${sourceLabel(row.source_type)})`);

  return new EmbedBuilder()
    .setTitle(`Lista da meta @${campaign.role_name || defaultCampaignRoleName}`)
    .setDescription([
      `Total arrecadado: **${formatSilver(totals.raised)}**`,
      `Contribuidores: **${totals.contributors}**`,
      `Eventos com doacao: **${totals.events}**`,
      `Escolhas pendentes: **${totals.pending}**`
    ].join('\n'))
    .addFields(
      { name: 'Contribuidores', value: contributorLines.length ? contributorLines.join('\n').slice(0, 1000) : 'Nenhuma contribuicao registrada ainda.' },
      { name: 'Ultimas entradas', value: latestLines.length ? latestLines.join('\n').slice(0, 1000) : 'Nenhuma entrada recente.' }
    )
    .setColor(0xf59e0b)
    .setTimestamp(new Date());
}

function contributorsHtmlPayload() {
  const campaign = repo.getActiveCampaign();
  if (!campaign) {
    return {
      content: 'Nao ha meta aberta no momento.',
      allowedMentions: { parse: [] }
    };
  }

  const totals = repo.getCampaignTotals(campaign.id);
  const rows = repo.listContributorTotals(campaign.id, 100000);
  const entries = repo.listContributions(campaign.id, 100000);
  const html = contributorsHtml({ campaign, totals, rows, entries });
  const fileName = `meta-${safeFilePart(campaign.code || 'campanha')}-doadores-${dateFilePart()}.html`;

  return {
    content: `Arquivo HTML completo da meta @${campaign.role_name || defaultCampaignRoleName}.`,
    files: [
      new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: fileName })
    ],
    allowedMentions: { parse: [] }
  };
}

function contributorsHtml({ campaign, totals, rows, entries }) {
  const goal = Number(campaign.goal_amount || 0);
  const percent = goal > 0 ? Math.min(100, (totals.raised / goal) * 100) : 0;
  const remaining = Math.max(0, goal - totals.raised);
  const generatedAt = new Date();

  const contributorRows = rows.map((row, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(row.discord_name || '')}</td>
            <td>${escapeHtml(row.albion_name || '')}</td>
            <td><code>${escapeHtml(row.user_id || '')}</code></td>
            <td class="num">${escapeHtml(formatSilver(row.total_amount))}</td>
            <td class="num">${Number(row.entries || 0)}</td>
          </tr>`).join('');

  const entryRows = entries.map((row) => `
          <tr>
            <td>${escapeHtml(formatDateTime(row.created_at))}</td>
            <td>${escapeHtml(row.discord_name || '')}</td>
            <td>${escapeHtml(row.albion_name || '')}</td>
            <td><code>${escapeHtml(row.user_id || '')}</code></td>
            <td class="num">${escapeHtml(formatSilver(row.amount))}</td>
            <td>${escapeHtml(sourceLabel(row.source_type))}</td>
            <td>${escapeHtml(row.source_id || '')}</td>
            <td>${escapeHtml(row.note || '')}</td>
          </tr>`).join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Meta @${escapeHtml(campaign.role_name || defaultCampaignRoleName)}</title>
  <style>
    :root { color-scheme: dark; --bg: #111827; --panel: #1f2937; --line: #374151; --text: #e5e7eb; --muted: #9ca3af; --gold: #f59e0b; --green: #22c55e; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; background: var(--bg); color: var(--text); }
    main { max-width: 1180px; margin: 0 auto; padding: 24px; }
    h1, h2 { margin: 0 0 12px; }
    h1 { font-size: 28px; }
    h2 { font-size: 18px; margin-top: 28px; }
    .muted { color: var(--muted); }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); gap: 12px; margin: 18px 0; }
    .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
    .card strong { display: block; font-size: 20px; margin-top: 4px; }
    .bar { height: 16px; background: #030712; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; margin: 14px 0 8px; }
    .fill { height: 100%; width: ${percent.toFixed(2)}%; background: linear-gradient(90deg, var(--gold), var(--green)); }
    .table-actions { display: flex; justify-content: flex-end; margin: 0 0 8px; }
    button { border: 0; border-radius: 7px; padding: 8px 10px; background: #2563eb; color: #fff; font-weight: 800; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
    th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { color: #f3f4f6; background: #111827; position: sticky; top: 0; }
    tr:hover td { background: rgba(255,255,255,.04); }
    code { color: #bfdbfe; }
    .num { text-align: right; white-space: nowrap; }
    @media (max-width: 760px) { main { padding: 14px; } .cards { grid-template-columns: 1fr 1fr; } table { font-size: 12px; } th, td { padding: 6px; } }
  </style>
</head>
<body>
  <main>
    <h1>Meta @${escapeHtml(campaign.role_name || defaultCampaignRoleName)}</h1>
    <div class="muted">Gerado em ${escapeHtml(formatDateTime(generatedAt.toISOString()))}</div>
    <div class="bar"><div class="fill"></div></div>
    <div class="muted">${percent.toFixed(1)}% concluido</div>

    <section class="cards">
      <div class="card">Arrecadado<strong>${escapeHtml(formatSilver(totals.raised))}</strong></div>
      <div class="card">Meta<strong>${escapeHtml(formatSilver(goal))}</strong></div>
      <div class="card">Faltam<strong>${escapeHtml(formatSilver(remaining))}</strong></div>
      <div class="card">Contribuidores<strong>${Number(totals.contributors || 0)}</strong></div>
      <div class="card">Eventos com doacao<strong>${Number(totals.events || 0)}</strong></div>
      <div class="card">Escolhas pendentes<strong>${Number(totals.pending || 0)}</strong></div>
      <div class="card">Entradas registradas<strong>${entries.length}</strong></div>
      <div class="card">Status<strong>${escapeHtml(campaign.status || '')}</strong></div>
    </section>

    <h2>Contribuidores</h2>
    <div class="table-actions"><button onclick="downloadSiblingTableCsv(this, 'meta-contribuidores')">Baixar CSV</button></div>
    <table>
      <thead>
        <tr><th>#</th><th>Discord</th><th>Albion</th><th>Discord ID</th><th>Total</th><th>Entradas</th></tr>
      </thead>
      <tbody>
${contributorRows || '        <tr><td colspan="6">Nenhuma contribuicao registrada.</td></tr>'}
      </tbody>
    </table>

    <h2>Entradas</h2>
    <div class="table-actions"><button onclick="downloadSiblingTableCsv(this, 'meta-entradas')">Baixar CSV</button></div>
    <table>
      <thead>
        <tr><th>Data</th><th>Discord</th><th>Albion</th><th>Discord ID</th><th>Valor</th><th>Origem</th><th>Ref.</th><th>Nota</th></tr>
      </thead>
      <tbody>
${entryRows || '        <tr><td colspan="8">Nenhuma entrada registrada.</td></tr>'}
      </tbody>
    </table>
  </main>
  <script>
    function csvCell(value) {
      const text = String(value == null ? '' : value);
      return /[",\\n\\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }
    function downloadSiblingTableCsv(button, name) {
      const table = button.closest('.table-actions')?.nextElementSibling;
      if (!table) return;
      const rows = Array.from(table.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((cell) => csvCell(cell.innerText.trim())).join(',')).join('\\n');
      const blob = new Blob([rows], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = (name || 'meta') + '.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeFilePart(value) {
  return String(value || 'arquivo').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
}

function dateFilePart() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '';
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function progressBar(percent) {
  const total = 20;
  const filled = Math.max(0, Math.min(total, Math.round((percent / 100) * total)));
  return `[${'#'.repeat(filled)}${'-'.repeat(total - filled)}]`;
}

function sourceLabel(sourceType) {
  const labels = {
    event_payout: 'loot split',
    manual_deposit: 'doacao manual',
    balance_donation: 'saldo',
    manual_restore: 'restauracao'
  };
  return labels[sourceType] || sourceType;
}

function closedDecisionEmbed(result) {
  const donated = result.donated;
  return new EmbedBuilder()
    .setTitle(donated ? 'Doacao registrada' : 'Saldo escolhido')
    .setDescription(donated
      ? `Sua parte de **${formatSilver(result.decision.amount)}** foi destinada para @${result.campaign.role_name || defaultCampaignRoleName}.`
      : `Sua parte de **${formatSilver(result.decision.amount)}** foi enviada para seu saldo.`)
    .setColor(donated ? 0x22c55e : 0x60a5fa)
    .setTimestamp(new Date());
}

module.exports = {
  closedDecisionEmbed,
  contributorsEmbed,
  contributorsHtmlPayload,
  createEventPayoutChoices,
  donateFromBalance,
  decisionMessagePayload,
  getActiveCampaign,
  processExpiredEventPayouts,
  refreshActiveCampaignProgress,
  resolveEventPayoutChoice,
  sendEventPayoutDms
};
