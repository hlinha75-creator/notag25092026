const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase, transaction } = require('../../database/connection');
const audit = require('../audit/audit.repository');
const memberList = require('./memberList.service');

const CAMPAIGN_HOURS = 24;
const ANNOUNCEMENT_BATCH_SIZE = 35;
let processing = false;

function db() {
  return getDatabase();
}

function sqliteDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function unixTimestamp(date) {
  return Math.floor(date.getTime() / 1000);
}

function chunks(rows, size) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

function campaignButtons(campaignId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`guild_cleanup:appeal:${campaignId}`)
      .setLabel('Estou na lista, mas estou na guild. Por que?')
      .setStyle(ButtonStyle.Primary)
  )];
}

function activeCampaign(guildId) {
  return db().prepare(`
    SELECT * FROM guild_removal_campaigns
    WHERE guild_id = ? AND status IN ('publishing', 'scheduled', 'running')
    ORDER BY id DESC LIMIT 1
  `).get(String(guildId));
}

function campaignById(campaignId) {
  return db().prepare('SELECT * FROM guild_removal_campaigns WHERE id = ?').get(Number(campaignId));
}

function candidateForAppeal(campaignId, discordId) {
  return db().prepare(`
    SELECT candidate.*, campaign.status AS campaign_status, campaign.execute_at
    FROM guild_removal_candidates candidate
    JOIN guild_removal_campaigns campaign ON campaign.id = candidate.campaign_id
    WHERE candidate.campaign_id = ? AND candidate.discord_id = ?
  `).get(Number(campaignId), String(discordId));
}

function announcementText({ campaignId, snapshotId, executeAt, rows, batchIndex, batchCount }) {
  const deadline = unixTimestamp(executeAt);
  const heading = batchIndex === 0
    ? [
      '**Aviso de regularizacao da guild**',
      '',
      `A lista oficial #${snapshotId} indica que as pessoas abaixo possuem o cargo Membro no Discord, mas nao estao na guild no jogo.`,
      `Se a situacao continuar, elas serao removidas do servidor em <t:${deadline}:F> (<t:${deadline}:R>).`,
      '',
      'Se voce ainda esta na guild, use o botao abaixo e informe seu nick correto para a staff revisar antes do prazo.',
      ''
    ]
    : [
      `**Aviso de regularizacao da guild — continuacao ${batchIndex + 1}/${batchCount}**`,
      `Prazo: <t:${deadline}:F> (<t:${deadline}:R>).`,
      ''
    ];
  return [
    ...heading,
    ...rows.map((row, index) => `${batchIndex * ANNOUNCEMENT_BATCH_SIZE + index + 1}. <@${row.discordId}> — ${row.albionName}`),
    '',
    `Campanha #${campaignId}`
  ].join('\n');
}

async function startCampaign({ guild, actorId, expectedSnapshotId = null }) {
  const existing = activeCampaign(guild.id);
  if (existing) {
    throw new Error(`Ja existe uma campanha ativa (#${existing.id}) com remocao prevista para ${existing.execute_at} UTC.`);
  }

  const { snapshot, comparison } = await memberList.guildAbsenceComparison(guild);
  if (expectedSnapshotId && Number(expectedSnapshotId) !== Number(snapshot.id)) {
    throw new Error('A lista oficial mudou desde a previa. Rode /ausentes_guild novamente antes de publicar.');
  }
  if (!comparison.eligible.length) {
    throw new Error('Nao ha membros removiveis fora da guild. Pessoas sem cadastro e cargos protegidos nao entram na campanha.');
  }

  const channel = await guild.client.channels.fetch(ids.channels.inactivityNotice).catch(() => null);
  if (!channel?.isTextBased()) throw new Error('O canal de avisos de regularizacao nao foi encontrado.');

  const executeAt = new Date(Date.now() + CAMPAIGN_HOURS * 60 * 60 * 1000);
  const create = transaction(() => {
    const concurrent = activeCampaign(guild.id);
    if (concurrent) throw new Error(`Ja existe uma campanha ativa (#${concurrent.id}).`);
    const campaign = db().prepare(`
      INSERT INTO guild_removal_campaigns (
        guild_id, snapshot_id, channel_id, created_by, status, execute_at
      ) VALUES (?, ?, ?, ?, 'publishing', ?)
    `).run(guild.id, snapshot.id, channel.id, actorId, sqliteDateTime(executeAt));
    const campaignId = Number(campaign.lastInsertRowid);
    const insertCandidate = db().prepare(`
      INSERT INTO guild_removal_candidates (
        campaign_id, discord_id, discord_name, albion_name
      ) VALUES (?, ?, ?, ?)
    `);
    for (const row of comparison.eligible) {
      insertCandidate.run(campaignId, row.discordId, row.displayName || row.discordTag || '', row.albionName);
    }
    return campaignId;
  });
  const campaignId = create();
  const messages = [];

  try {
    const batches = chunks(comparison.eligible, ANNOUNCEMENT_BATCH_SIZE);
    for (const [batchIndex, rows] of batches.entries()) {
      const message = await channel.send({
        content: announcementText({
          campaignId,
          snapshotId: snapshot.id,
          executeAt,
          rows,
          batchIndex,
          batchCount: batches.length
        }),
        components: campaignButtons(campaignId),
        allowedMentions: { users: rows.map((row) => row.discordId) }
      });
      messages.push(message);
    }
    db().prepare(`
      UPDATE guild_removal_campaigns
      SET status = 'scheduled', message_ids_json = ?
      WHERE id = ?
    `).run(JSON.stringify(messages.map((message) => message.id)), campaignId);
  } catch (error) {
    db().prepare(`
      UPDATE guild_removal_campaigns SET status = 'failed', last_error = ? WHERE id = ?
    `).run(String(error.message || error).slice(0, 1000), campaignId);
    for (const message of messages) {
      await message.edit({ components: [] }).catch(() => {});
    }
    throw error;
  }

  audit.createAuditLog({
    type: 'guild_removal_campaign_started',
    actorId,
    targetId: String(campaignId),
    afterValue: sqliteDateTime(executeAt),
    reason: 'Aviso de remocao em 24 horas publicado',
    metadata: { snapshotId: snapshot.id, candidates: comparison.eligible.length, channelId: channel.id }
  });

  return {
    id: campaignId,
    snapshotId: snapshot.id,
    candidates: comparison.eligible.length,
    protected: comparison.protected.length,
    unverified: comparison.unverified.length,
    executeAt,
    channelId: channel.id,
    messages: messages.length
  };
}

async function submitAppeal({ client, campaignId, discordId, albionName, reason }) {
  const candidate = candidateForAppeal(campaignId, discordId);
  if (!candidate) throw new Error('Seu usuario nao faz parte desta campanha.');
  if (candidate.campaign_status !== 'scheduled') throw new Error('Esta campanha nao aceita mais revisoes.');
  if (candidate.status === 'appealed') return { candidate, alreadySubmitted: true };
  if (candidate.status !== 'scheduled') throw new Error('Sua situacao nesta campanha ja foi processada.');

  const cleanAlbionName = String(albionName || '').trim().slice(0, 64);
  const cleanReason = String(reason || '').trim().slice(0, 1000);
  if (!cleanAlbionName) throw new Error('Informe seu nick atual no Albion.');
  if (!cleanReason) throw new Error('Explique brevemente por que voce acredita estar na guild.');

  const updated = db().prepare(`
    UPDATE guild_removal_candidates
    SET status = 'appealed', appeal_albion_name = ?, appeal_reason = ?, appealed_at = CURRENT_TIMESTAMP
    WHERE campaign_id = ? AND discord_id = ? AND status = 'scheduled'
  `).run(cleanAlbionName, cleanReason, Number(campaignId), String(discordId));
  if (!updated.changes) return { candidate: candidateForAppeal(campaignId, discordId), alreadySubmitted: true };

  audit.createAuditLog({
    type: 'guild_removal_appeal_submitted',
    actorId: discordId,
    targetId: String(campaignId),
    reason: cleanReason,
    metadata: { previousAlbionName: candidate.albion_name, informedAlbionName: cleanAlbionName }
  });

  const staffChannel = await client.channels.fetch(ids.channels.staff).catch(() => null);
  if (staffChannel?.isTextBased()) {
    await staffChannel.send({
      content: [
        `**Contestacao da campanha #${campaignId}**`,
        `Membro: <@${discordId}> (${discordId})`,
        `Nick registrado: **${candidate.albion_name}**`,
        `Nick informado: **${cleanAlbionName}**`,
        `Explicacao: ${cleanReason}`,
        '',
        'A pessoa foi protegida da remocao automatica desta campanha. A staff deve conferir o cadastro e a lista oficial.'
      ].join('\n'),
      allowedMentions: { parse: [] }
    }).catch(() => {});
  }

  return { candidate: candidateForAppeal(campaignId, discordId), alreadySubmitted: false };
}

async function cancelCampaign({ client, campaignId, guildId, actorId }) {
  const campaign = campaignById(campaignId);
  if (!campaign || String(campaign.guild_id) !== String(guildId)) throw new Error('Campanha nao encontrada neste servidor.');
  const cancelled = db().prepare(`
    UPDATE guild_removal_campaigns
    SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('publishing', 'scheduled')
  `).run(Number(campaignId));
  if (!cancelled.changes) throw new Error('Esta campanha ja foi executada ou cancelada.');
  await disableCampaignButtons(client, campaign);
  const channel = await client.channels.fetch(campaign.channel_id).catch(() => null);
  await channel?.send({
    content: `**Campanha de regularizacao #${campaign.id} cancelada pela staff.** Nenhuma remocao automatica sera feita por este aviso.`,
    allowedMentions: { parse: [] }
  }).catch(() => {});
  audit.createAuditLog({
    type: 'guild_removal_campaign_cancelled',
    actorId,
    targetId: String(campaign.id),
    reason: 'Cancelamento manual antes da execucao'
  });
  return campaign;
}

function updateCandidate(campaignId, discordId, status, detail) {
  db().prepare(`
    UPDATE guild_removal_candidates
    SET status = ?, result_detail = ?, processed_at = CURRENT_TIMESTAMP
    WHERE campaign_id = ? AND discord_id = ? AND status = 'scheduled'
  `).run(status, String(detail || '').slice(0, 1000), Number(campaignId), String(discordId));
}

function campaignSummary(campaignId) {
  const rows = db().prepare(`
    SELECT status, COUNT(*) AS total
    FROM guild_removal_candidates
    WHERE campaign_id = ?
    GROUP BY status
  `).all(Number(campaignId));
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.total)]));
}

async function disableCampaignButtons(client, campaign) {
  const channel = await client.channels.fetch(campaign.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;
  let messageIds = [];
  try {
    messageIds = JSON.parse(campaign.message_ids_json || '[]');
  } catch {}
  for (const messageId of messageIds) {
    const message = await channel.messages.fetch(messageId).catch(() => null);
    await message?.edit({ components: [] }).catch(() => {});
  }
}

async function completeCampaign(client, campaign) {
  const guild = await client.guilds.fetch(campaign.guild_id);
  const { snapshot, comparison } = await memberList.guildAbsenceComparison(guild);
  const currentlyAbsent = new Map(comparison.absent.map((row) => [String(row.discordId), row]));
  const candidates = db().prepare(`
    SELECT * FROM guild_removal_candidates
    WHERE campaign_id = ? AND status = 'scheduled'
    ORDER BY discord_id
  `).all(campaign.id);

  for (const candidate of candidates) {
    const member = guild.members.cache.get(String(candidate.discord_id))
      || await guild.members.fetch(String(candidate.discord_id)).catch(() => null);
    if (!member) {
      updateCandidate(campaign.id, candidate.discord_id, 'left', 'Ja nao estava no servidor no momento da execucao.');
      continue;
    }

    const current = currentlyAbsent.get(String(candidate.discord_id));
    if (!current) {
      updateCandidate(campaign.id, candidate.discord_id, 'cleared', 'Nao consta mais como ausente na lista oficial mais recente.');
      continue;
    }
    if (current.removalBlockedReason || !member.kickable) {
      updateCandidate(campaign.id, candidate.discord_id, 'protected', current.removalBlockedReason || 'Hierarquia do bot impede a remocao.');
      continue;
    }

    try {
      await member.kick(`Fora da guild no Albion apos aviso de 24 horas — campanha #${campaign.id}`);
      updateCandidate(campaign.id, candidate.discord_id, 'removed', `Removido usando a lista oficial #${snapshot.id}.`);
      audit.createAuditLog({
        type: 'guild_member_removed_after_notice',
        actorId: campaign.created_by,
        targetId: String(candidate.discord_id),
        beforeValue: candidate.albion_name,
        afterValue: 'removed_from_discord',
        reason: `Fora da guild apos aviso de ${CAMPAIGN_HOURS} horas`,
        metadata: { campaignId: campaign.id, originalSnapshotId: campaign.snapshot_id, finalSnapshotId: snapshot.id }
      });
    } catch (error) {
      updateCandidate(campaign.id, candidate.discord_id, 'failed', String(error.message || error));
    }
  }

  const summary = campaignSummary(campaign.id);
  db().prepare(`
    UPDATE guild_removal_campaigns
    SET status = 'completed', completed_at = CURRENT_TIMESTAMP, result_json = ?, last_error = NULL
    WHERE id = ?
  `).run(JSON.stringify({ ...summary, finalSnapshotId: snapshot.id }), campaign.id);
  await disableCampaignButtons(client, campaign);

  const report = [
    `**Campanha de regularizacao #${campaign.id} concluida**`,
    `Lista conferida novamente: **#${snapshot.id}**.`,
    `Removidos: **${summary.removed || 0}**.`,
    `Regularizados antes do prazo: **${summary.cleared || 0}**.`,
    `Contestacoes preservadas: **${summary.appealed || 0}**.`,
    `Protegidos: **${summary.protected || 0}**.`,
    `Ja tinham saido: **${summary.left || 0}**.`,
    `Falhas: **${summary.failed || 0}**.`
  ].join('\n');
  const publicChannel = await client.channels.fetch(campaign.channel_id).catch(() => null);
  await publicChannel?.send({ content: report, allowedMentions: { parse: [] } }).catch(() => {});
  if (ids.channels.staff !== campaign.channel_id) {
    const staffChannel = await client.channels.fetch(ids.channels.staff).catch(() => null);
    await staffChannel?.send({ content: report, allowedMentions: { parse: [] } }).catch(() => {});
  }
  audit.createAuditLog({
    type: 'guild_removal_campaign_completed',
    actorId: campaign.created_by,
    targetId: String(campaign.id),
    reason: 'Campanha executada apos nova verificacao da lista oficial',
    metadata: { ...summary, finalSnapshotId: snapshot.id }
  });
  return summary;
}

async function processDueCampaigns(client) {
  if (processing) return { processed: 0 };
  processing = true;
  let processed = 0;
  try {
    const due = db().prepare(`
      SELECT * FROM guild_removal_campaigns
      WHERE status = 'scheduled' AND execute_at <= CURRENT_TIMESTAMP
      ORDER BY id
      LIMIT 5
    `).all();
    for (const campaign of due) {
      const claimed = db().prepare(`
        UPDATE guild_removal_campaigns
        SET status = 'running', attempts = attempts + 1
        WHERE id = ? AND status = 'scheduled'
      `).run(campaign.id);
      if (!claimed.changes) continue;
      try {
        await completeCampaign(client, { ...campaign, status: 'running' });
        processed += 1;
      } catch (error) {
        const nextStatus = Number(campaign.attempts || 0) + 1 >= 3 ? 'failed' : 'scheduled';
        db().prepare(`
          UPDATE guild_removal_campaigns
          SET status = ?, last_error = ?
          WHERE id = ?
        `).run(nextStatus, String(error.message || error).slice(0, 1000), campaign.id);
        if (nextStatus === 'failed') await disableCampaignButtons(client, campaign);
      }
    }
    return { processed };
  } finally {
    processing = false;
  }
}

module.exports = {
  CAMPAIGN_HOURS,
  activeCampaign,
  cancelCampaign,
  campaignById,
  candidateForAppeal,
  processDueCampaigns,
  startCampaign,
  submitAppeal
};
