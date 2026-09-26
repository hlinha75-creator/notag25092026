const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const audit = require('../audit/audit.repository');

const newcomerRoleName = 'NOVO';
const coreRoleName = 'CORE';
const newcomerDays = 30;
const coreWindowDays = 7;
const coreMinimumSeconds = 3.5 * 60 * 60;
const coreMinimumEvents = 2;

function coreActivityByMember(now = new Date()) {
  const cutoffIso = new Date(now.getTime() - coreWindowDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = getDatabase().prepare(`
    SELECT
      ep.discord_id,
      COUNT(DISTINCT ep.event_id) AS event_count,
      SUM(COALESCE(ep.manual_seconds, ep.calculated_seconds, 0)) AS total_seconds
    FROM event_participants ep
    JOIN events e ON e.id = ep.event_id
    WHERE e.status = 'approved'
      AND ep.is_spectator = 0
      AND COALESCE(ep.manual_seconds, ep.calculated_seconds, 0) > 0
      AND COALESCE(e.ended_at, e.updated_at, e.created_at) >= @cutoffIso
    GROUP BY ep.discord_id
  `).all({ cutoffIso });

  return new Map(rows.map((row) => [String(row.discord_id), {
    eventCount: Number(row.event_count || 0),
    totalSeconds: Number(row.total_seconds || 0)
  }]));
}

function qualifiesForCore(activity) {
  return Number(activity?.totalSeconds || 0) >= coreMinimumSeconds
    && Number(activity?.eventCount || 0) >= coreMinimumEvents;
}

function qualifiesForNewcomer(member, now = new Date()) {
  const joinedTimestamp = Number(member?.joinedTimestamp ?? member?.joinedAt?.getTime?.());
  if (!Number.isFinite(joinedTimestamp)) return null;
  const cutoff = now.getTime() - newcomerDays * 24 * 60 * 60 * 1000;
  return joinedTimestamp > cutoff;
}

async function resolveRole(guild, { id, name, create }) {
  let role = id ? await guild.roles.fetch(id).catch(() => null) : null;
  if (!role) {
    const roles = guild.roles.cache?.values ? [...guild.roles.cache.values()] : [];
    role = roles.find((item) => String(item.name || '').toLocaleUpperCase('pt-BR') === name) || null;
  }
  if (!role && create) {
    role = await guild.roles.create({
      name,
      mentionable: false,
      reason: `Cargo automatico ${name} criado pelo Notag Bot`
    });
  }
  return role;
}

async function changeRole(member, role, shouldHave, reason) {
  const hasRole = member.roles.cache.has(role.id);
  if (hasRole === shouldHave) return 'unchanged';
  if (shouldHave) await member.roles.add(role, reason);
  else await member.roles.remove(role, reason);
  return shouldHave ? 'added' : 'removed';
}

function emptySummary() {
  return {
    analyzed: 0,
    newcomerAdded: 0,
    newcomerRemoved: 0,
    coreAdded: 0,
    coreRemoved: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };
}

async function reconcileGuildActivityRoles(guild, { now = new Date() } = {}) {
  const summary = emptySummary();
  const [newcomerRole, coreRole, members] = await Promise.all([
    resolveRole(guild, { id: ids.roles.newcomer, name: newcomerRoleName, create: true }),
    resolveRole(guild, { id: ids.roles.core, name: coreRoleName, create: false }),
    guild.members.fetch()
  ]);
  if (!coreRole) throw new Error(`Cargo ${coreRoleName} nao encontrado no servidor.`);

  const activityByMember = coreActivityByMember(now);
  for (const member of members.values()) {
    if (member.user?.bot) {
      summary.skipped += 1;
      continue;
    }
    summary.analyzed += 1;
    try {
      const newcomerQualified = qualifiesForNewcomer(member, now);
      if (newcomerQualified !== null) {
        const newcomerChange = await changeRole(
          member,
          newcomerRole,
          newcomerQualified,
          newcomerQualified ? 'Entrou no servidor ha menos de 30 dias' : 'Completou 30 dias no servidor'
        );
        if (newcomerChange === 'added') summary.newcomerAdded += 1;
        else if (newcomerChange === 'removed') summary.newcomerRemoved += 1;
        else summary.unchanged += 1;
      } else {
        summary.skipped += 1;
      }

      const activity = activityByMember.get(member.id) || { eventCount: 0, totalSeconds: 0 };
      const coreQualified = qualifiesForCore(activity);
      const coreChange = await changeRole(
        member,
        coreRole,
        coreQualified,
        coreQualified
          ? '3h30 ou mais em pelo menos 2 eventos finalizados nos ultimos 7 dias'
          : 'Abaixo do criterio CORE nos ultimos 7 dias'
      );
      if (coreChange === 'added') summary.coreAdded += 1;
      else if (coreChange === 'removed') summary.coreRemoved += 1;
      else summary.unchanged += 1;

    } catch (error) {
      summary.failed += 1;
      if (summary.errors.length < 25) {
        summary.errors.push({ memberId: member.id, message: String(error?.message || error).slice(0, 180) });
      }
    }
  }

  if (summary.newcomerAdded || summary.newcomerRemoved || summary.coreAdded || summary.coreRemoved || summary.failed) {
    audit.createAuditLog({
      type: 'automatic_activity_roles_reconciled',
      actorId: guild.client?.user?.id,
      targetId: guild.id,
      reason: 'Sincronizacao automatica dos cargos NOVO e CORE',
      metadata: summary
    });
  }
  return summary;
}

async function reconcileActivityRoles(client, options = {}) {
  const guild = await client.guilds.fetch(ids.guildId).catch(() => null);
  if (!guild) throw new Error('Servidor principal nao encontrado para sincronizar NOVO e CORE.');
  return reconcileGuildActivityRoles(guild, options);
}

async function handleGuildMemberAdd(member) {
  if (member.user?.bot) return;
  const newcomerRole = await resolveRole(member.guild, {
    id: ids.roles.newcomer,
    name: newcomerRoleName,
    create: true
  });
  await changeRole(member, newcomerRole, true, 'Novo membro: menos de 30 dias no servidor');
}

module.exports = {
  coreMinimumEvents,
  coreMinimumSeconds,
  coreWindowDays,
  newcomerDays,
  coreActivityByMember,
  handleGuildMemberAdd,
  qualifiesForCore,
  qualifiesForNewcomer,
  reconcileActivityRoles,
  reconcileGuildActivityRoles
};
