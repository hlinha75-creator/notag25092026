const audit = require('../modules/audit/audit.repository');
const snapshots = require('../modules/members/memberSnapshot.service');
const rosterAutoLink = require('../modules/members/rosterAutoLink.service');
const { approveRosterMember } = require('./staff-registration.service');

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function cleanSourceName(value) {
  const sourceName = String(value || 'Lista copiada do Albion').trim().slice(0, 120);
  return sourceName || 'Lista copiada do Albion';
}

function publicRosterData(details) {
  if (!details) return null;
  return {
    id: details.id,
    sourceName: details.source_name,
    memberCount: details.member_count,
    onlineCount: details.online_count,
    createdAt: details.created_at,
    createdBy: details.created_by,
    linkedCount: details.linkedCount,
    unlinkedCount: details.unlinkedCount,
    additions: details.additions,
    removals: details.removals,
    unlinked: details.unlinked.slice(0, 100),
    registeredOutside: details.registeredOutside.slice(0, 100)
  };
}

function getMemberRosterData() {
  return publicRosterData(snapshots.latestSnapshotDetails());
}

function matchPreviewSample(preview, matches) {
  const automatic = new Map(matches.automatic.map((row) => [rosterAutoLink.normalizeName(row.characterName), row]));
  const confirmation = new Map(matches.confirmation.map((row) => [rosterAutoLink.normalizeName(row.characterName), row]));
  return preview.sample.map((row) => {
    if (row.linked) return { ...row, matchType: 'linked' };
    const key = rosterAutoLink.normalizeName(row.characterName);
    if (automatic.has(key)) return { ...row, matchType: 'automatic', match: automatic.get(key) };
    if (confirmation.has(key)) return { ...row, matchType: 'confirmation', match: confirmation.get(key) };
    return { ...row, matchType: 'pending' };
  });
}

async function manageMemberRoster(input, { client = null } = {}) {
  const action = String(input.action || '').trim();
  const rosterText = String(input.rosterText || '');
  if (!rosterText.trim()) fail('Cole a lista de membros ou selecione um arquivo.');
  if (Buffer.byteLength(rosterText, 'utf8') > 512 * 1024) fail('A lista deve ter no máximo 512 KB.', 413);

  const sourceName = cleanSourceName(input.sourceName);
  const preview = snapshots.previewMemberSnapshot(rosterText);
  const parsed = snapshots.parseSnapshotRows(rosterText);
  const matches = client
    ? await rosterAutoLink.previewRosterMatches(client, parsed.rows)
    : { automatic: [], confirmation: [], pending: preview.unlinked.map((row) => ({ characterName: row.albionName })) };
  if (action === 'preview') {
    return {
      message: `${preview.memberCount} membros encontrados. Revise as diferenças antes de confirmar.`,
      preview: {
        ...preview,
        sourceName,
        automaticMatches: matches.automatic,
        confirmationMatches: matches.confirmation,
        pendingMatches: matches.pending,
        automaticCount: matches.automatic.length,
        confirmationCount: matches.confirmation.length,
        pendingMatchCount: matches.pending.length,
        sample: matchPreviewSample(preview, matches)
      }
    };
  }
  if (action !== 'confirm') fail('Ação de lista de membros inválida.');

  const before = snapshots.latestSnapshot();
  const saved = snapshots.importMemberSnapshot(rosterText, {
    sourceName,
    actorId: input.actorId || 'website'
  });
  const automation = client
    ? await rosterAutoLink.applyRosterAutomation(client, {
      snapshotId: saved.id,
      rows: parsed.rows,
      actorId: input.actorId || 'website',
      approveRosterMember
    })
    : { applied: [], questions: [], pending: matches.pending };
  audit.createAuditLog({
    type: 'website_member_roster_imported',
    actorId: input.actorId,
    targetId: String(saved.id),
    beforeValue: before?.id || null,
    afterValue: saved.id,
    reason: sourceName,
    metadata: {
      memberCount: saved.memberCount,
      onlineCount: saved.onlineCount,
      linkedCount: preview.linkedCount,
      unlinkedCount: preview.unlinkedCount,
      additions: preview.additions.length,
      removals: preview.removals.length,
      duplicates: saved.duplicates.length,
      automatic: automation.applied.length,
      confirmation: automation.questions.length,
      pending: automation.pending.length
    }
  });
  return {
    message: `Lista atualizada com ${saved.memberCount} membros. ${automation.applied.length} vínculo(s) automático(s), ${automation.questions.length} confirmação(ões) enviada(s) e ${automation.pending.length} pendente(s) para a staff.`,
    roster: getMemberRosterData(),
    automation
  };
}

module.exports = {
  getMemberRosterData,
  manageMemberRoster,
  publicRosterData
};
