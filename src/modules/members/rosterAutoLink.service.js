const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const audit = require('../audit/audit.repository');
const { safeSend } = require('../../utils/discord');

const FUZZY_THRESHOLD = 0.84;
const FUZZY_MARGIN = 0.08;

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '');
}

function nameAliases(member) {
  const values = [member?.displayName, member?.nickname, member?.user?.globalName, member?.user?.username]
    .filter(Boolean);
  const aliases = new Map();
  for (const value of values) {
    const text = String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US');
    const pieces = [text, ...text.split(/[^a-z0-9]+/g)].filter((piece) => piece.length >= 3);
    for (const piece of pieces) {
      const key = normalizeName(piece);
      if (key && !aliases.has(key)) aliases.set(key, String(value));
    }
  }
  return aliases;
}

function levenshtein(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function similarity(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return 0;
  return 1 - (levenshtein(a, b) / Math.max(a.length, b.length));
}

function collectionValues(value) {
  if (!value) return [];
  if (typeof value.values === 'function') return [...value.values()];
  return Object.values(value);
}

async function guildMembers(client) {
  if (!client) return [];
  const guild = client.guilds.cache?.get(ids.guildId) || await client.guilds.fetch(ids.guildId).catch(() => null);
  if (!guild) return [];
  const fetched = typeof guild.members?.fetch === 'function'
    ? await guild.members.fetch().catch(() => null)
    : null;
  const members = collectionValues(fetched || guild.members?.cache);
  return members.filter((member) => member?.id && !member.user?.bot);
}

function databaseLinks() {
  return getDatabase().prepare(`
    SELECT discord_id, discord_name, albion_name, registration_status
    FROM users
  `).all();
}

function memberLabel(member) {
  return member?.displayName || member?.user?.globalName || member?.user?.username || member?.id;
}

function buildMatchPlan(rows, members, links = databaseLinks()) {
  const rosterKeys = new Set(rows.map((row) => normalizeName(row.characterName || row.character_name)).filter(Boolean));
  const linkedAlbion = new Map(
    links.filter((row) => row.albion_name).map((row) => [normalizeName(row.albion_name), row])
  );
  const linksByDiscord = new Map(links.map((row) => [String(row.discord_id), row]));
  const candidates = members.map((member) => ({
    member,
    aliases: nameAliases(member),
    existing: linksByDiscord.get(String(member.id)) || null
  }));
  const automatic = [];
  const confirmation = [];
  const pending = [];
  const claimed = new Set();

  for (const row of rows) {
    const characterName = row.characterName || row.character_name;
    const key = normalizeName(characterName);
    if (linkedAlbion.has(key)) continue;

    const eligible = candidates.filter((candidate) => {
      if (claimed.has(String(candidate.member.id))) return false;
      const currentName = normalizeName(candidate.existing?.albion_name);
      return !currentName || currentName === key;
    });
    const exact = eligible.filter((candidate) => candidate.aliases.has(key));
    const safeExact = exact.filter((candidate) => (
      [...candidate.aliases.keys()].filter((alias) => rosterKeys.has(alias)).length === 1
    ));
    if (exact.length === 1 && safeExact.length === 1) {
      const candidate = exact[0];
      claimed.add(String(candidate.member.id));
      automatic.push({
        characterName,
        discordId: String(candidate.member.id),
        discordName: memberLabel(candidate.member),
        matchedName: candidate.aliases.get(key),
        score: 1
      });
      continue;
    }

    const fuzzyEligible = eligible.filter((candidate) => {
      const aliasKeys = [...candidate.aliases.keys()];
      const representsOtherRosterCharacter = aliasKeys.some((alias) => alias !== key && rosterKeys.has(alias));
      const representsOtherLinkedCharacter = aliasKeys.some((alias) => {
        const linked = linkedAlbion.get(alias);
        return alias !== key && linked && String(linked.discord_id) !== String(candidate.member.id);
      });
      return !representsOtherRosterCharacter && !representsOtherLinkedCharacter;
    });
    const scored = fuzzyEligible
      .map((candidate) => {
        let score = 0;
        let matchedName = memberLabel(candidate.member);
        for (const [alias, source] of candidate.aliases) {
          const current = similarity(key, alias);
          if (current > score) {
            score = current;
            matchedName = source;
          }
        }
        return { candidate, score, matchedName };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    const runnerUp = scored[1];
    if (best && key.length >= 4 && best.score >= FUZZY_THRESHOLD && (!runnerUp || best.score - runnerUp.score >= FUZZY_MARGIN)) {
      claimed.add(String(best.candidate.member.id));
      confirmation.push({
        characterName,
        discordId: String(best.candidate.member.id),
        discordName: memberLabel(best.candidate.member),
        matchedName: best.matchedName,
        score: Number(best.score.toFixed(3))
      });
      continue;
    }

    pending.push({
      characterName,
      reason: exact.length > 1 ? 'Mais de uma conta Discord com o mesmo nome' : 'Nenhuma correspondência segura'
    });
  }

  return { automatic, confirmation, pending };
}

async function previewRosterMatches(client, rows) {
  const members = await guildMembers(client);
  return buildMatchPlan(rows, members);
}

function createProposal({ snapshotId, match, actorId }) {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO guild_roster_link_proposals
      (snapshot_id, discord_id, albion_name, matched_name, match_score, status, created_by, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(snapshot_id, discord_id, albion_name) DO UPDATE SET
      matched_name = excluded.matched_name,
      match_score = excluded.match_score,
      status = CASE WHEN guild_roster_link_proposals.status = 'confirmed' THEN 'confirmed' ELSE 'pending' END,
      created_by = excluded.created_by,
      updated_at = CURRENT_TIMESTAMP
  `).run(snapshotId, match.discordId, match.characterName, match.matchedName, match.score, actorId || null);
  return db.prepare(`
    SELECT * FROM guild_roster_link_proposals
    WHERE snapshot_id = ? AND discord_id = ? AND albion_name = ?
  `).get(snapshotId, match.discordId, match.characterName);
}

function proposalButtons(proposalId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`roster_link:confirm:${proposalId}`).setLabel('Sim, é meu personagem').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`roster_link:reject:${proposalId}`).setLabel('Não é meu').setStyle(ButtonStyle.Secondary)
  )];
}

async function sendProposal(member, proposal) {
  if (!member?.send || proposal.status === 'confirmed') return false;
  const message = await member.send({
    content: [
      `A lista atual da guilda encontrou uma possível correspondência entre sua conta Discord e **${proposal.albion_name}** no Albion.`,
      'Esse personagem é seu? Ao confirmar, o bot atualizará seu apelido, retirará Convidado/Sem Tag e adicionará o cargo Membro.',
      'Se não for seu, clique em **Não é meu**. Nenhuma alteração será feita sem sua confirmação.'
    ].join('\n'),
    components: proposalButtons(proposal.id)
  }).catch(() => null);
  if (!message?.id) return false;
  getDatabase().prepare(`
    UPDATE guild_roster_link_proposals SET message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(message.id, proposal.id);
  return true;
}

async function applyRosterAutomation(client, { snapshotId, rows, actorId, approveRosterMember }) {
  const members = await guildMembers(client);
  const membersById = new Map(members.map((member) => [String(member.id), member]));
  const plan = buildMatchPlan(rows, members);
  const applied = [];
  const failed = [];
  const questions = [];

  for (const match of plan.automatic) {
    try {
      await approveRosterMember(client, {
        actorId: actorId || 'roster-import',
        discordId: match.discordId,
        albionName: match.characterName,
        matchType: 'automatic'
      });
      applied.push(match);
    } catch (error) {
      failed.push({ ...match, reason: error.message });
    }
  }

  for (const match of plan.confirmation) {
    const proposal = createProposal({ snapshotId, match, actorId });
    const delivered = await sendProposal(membersById.get(match.discordId), proposal);
    questions.push({ ...match, proposalId: proposal.id, delivered });
  }

  const summary = { applied, questions, pending: [...plan.pending, ...failed] };
  audit.createAuditLog({
    type: 'roster_member_matching_processed',
    actorId,
    targetId: String(snapshotId),
    afterValue: applied.length,
    reason: 'Importação da lista atual da guilda',
    metadata: {
      automatic: applied.length,
      confirmation: questions.length,
      delivered: questions.filter((item) => item.delivered).length,
      pending: summary.pending.length
    }
  });

  await safeSend(client, ids.channels.memberRequests, {
    content: [
      `Lista da guilda #${snapshotId} processada por <@${actorId}>.`,
      `Automáticos: **${applied.length}** | Confirmações: **${questions.length}** | Pendentes: **${summary.pending.length}**`,
      questions.some((item) => !item.delivered)
        ? `${questions.filter((item) => !item.delivered).length} confirmação(ões) não puderam ser entregues por DM e ficaram para a staff.`
        : null
    ].filter(Boolean).join('\n'),
    allowedMentions: { parse: [], users: actorId ? [actorId] : [], roles: [] }
  });
  return summary;
}

function getProposal(id) {
  return getDatabase().prepare('SELECT * FROM guild_roster_link_proposals WHERE id = ?').get(Number(id));
}

function latestSnapshotId() {
  return getDatabase().prepare('SELECT id FROM member_snapshots ORDER BY id DESC LIMIT 1').get()?.id || null;
}

function resolveProposal(id, status) {
  getDatabase().prepare(`
    UPDATE guild_roster_link_proposals
    SET status = ?, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, Number(id));
}

async function handleProposalButton(interaction, approveRosterMember) {
  const [, action, id] = interaction.customId.split(':');
  const proposal = getProposal(id);
  if (!proposal || proposal.status !== 'pending') {
    return interaction.update({ content: 'Essa confirmação já foi resolvida ou expirou.', components: [] });
  }
  if (String(proposal.discord_id) !== String(interaction.user.id)) {
    return interaction.reply({ content: 'Essa confirmação pertence a outra conta Discord.', flags: MessageFlags.Ephemeral });
  }
  if (Number(proposal.snapshot_id) !== Number(latestSnapshotId())) {
    resolveProposal(id, 'expired');
    return interaction.update({ content: 'Essa lista já foi substituída por uma importação mais recente. Peça uma nova análise à staff.', components: [] });
  }
  const stillListed = getDatabase().prepare(`
    SELECT 1 FROM member_snapshot_rows
    WHERE snapshot_id = ? AND lower(character_name) = lower(?)
  `).get(proposal.snapshot_id, proposal.albion_name);
  if (!stillListed) {
    resolveProposal(id, 'expired');
    return interaction.update({ content: 'O personagem não está mais na lista atual da guilda. Nenhuma alteração foi feita.', components: [] });
  }
  if (action === 'reject') {
    resolveProposal(id, 'rejected');
    audit.createAuditLog({
      type: 'roster_member_match_rejected', actorId: interaction.user.id, targetId: interaction.user.id,
      reason: proposal.albion_name, metadata: { proposalId: proposal.id, snapshotId: proposal.snapshot_id }
    });
    return interaction.update({ content: `Entendido. **${proposal.albion_name}** não foi vinculado à sua conta. A staff poderá revisar o caso.`, components: [] });
  }
  if (action !== 'confirm') return interaction.reply({ content: 'Ação inválida.', flags: MessageFlags.Ephemeral });

  try {
    await approveRosterMember(interaction.client, {
      actorId: interaction.user.id,
      discordId: interaction.user.id,
      albionName: proposal.albion_name,
      matchType: 'confirmation'
    });
    resolveProposal(id, 'confirmed');
    await safeSend(interaction.client, ids.channels.memberRequests, {
      content: `<@${interaction.user.id}> confirmou que **${proposal.albion_name}** é seu personagem. Vínculo concluído e cargo Membro aplicado.`,
      allowedMentions: { parse: [], users: [interaction.user.id], roles: [] }
    });
    return interaction.update({
      content: `Confirmado: **${proposal.albion_name}** foi vinculado à sua conta. Seu apelido e o cargo Membro foram atualizados.`,
      components: []
    });
  } catch (error) {
    resolveProposal(id, 'conflict');
    return interaction.update({ content: `Não foi possível concluir o vínculo: ${error.message} A staff foi avisada para revisar.`, components: [] });
  }
}

module.exports = {
  FUZZY_MARGIN,
  FUZZY_THRESHOLD,
  applyRosterAutomation,
  buildMatchPlan,
  handleProposalButton,
  nameAliases,
  normalizeName,
  previewRosterMatches,
  similarity
};
