const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const audit = require('../audit/audit.repository');
const { toCsv } = require('../../utils/csv');

const previews = new Map();
const defaultDaysMin = 30;
const defaultMinutesMin = 15;
const protectedRoles = ['adm', 'staff', 'treasurer', 'caller', 'recruiter'];

async function createPreview({ guild, actorId, daysMin = defaultDaysMin, minutesMin = defaultMinutesMin, expiresInMs = 15 * 60 * 1000, shared = false }) {
  const safeDays = Math.max(0, Number(daysMin || defaultDaysMin));
  const safeMinutes = Math.max(1, Number(minutesMin || defaultMinutesMin));
  const rows = await analyzeGuild(guild, { daysMin: safeDays, minutesMin: safeMinutes });
  const candidates = rows.filter((row) => row.status === 'candidate');
  const preview = {
    id: previewId(),
    actorId,
    guildId: guild.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    shared,
    params: { daysMin: safeDays, minutesMin: safeMinutes },
    rows,
    candidates,
    summary: summarize(rows)
  };
  previews.set(preview.id, preview);
  return preview;
}

async function applyPreview({ guild, previewId, actorId }) {
  const preview = takePreview(previewId, actorId);
  const results = [];

  for (const row of preview.candidates) {
    const member = await guild.members.fetch(row.discord_id).catch(() => null);
    if (!member) {
      results.push({ ...row, result: 'membro_nao_encontrado' });
      continue;
    }
    if (isProtected(member) || !member.roles.cache.has(ids.roles.member)) {
      results.push({ ...row, result: 'ignorado_permissao_ou_cargo_mudou' });
      continue;
    }

    try {
      if (ids.roles.guest && !member.roles.cache.has(ids.roles.guest)) {
        await member.roles.add(ids.roles.guest, downgradeReason(preview));
      }
      await member.roles.remove(ids.roles.member, downgradeReason(preview));
      audit.createAuditLog({
        type: 'member_inactive_event_downgrade',
        actorId,
        targetId: row.discord_id,
        beforeValue: 'member',
        afterValue: 'guest',
        reason: downgradeReason(preview),
        metadata: {
          daysMin: preview.params.daysMin,
          minutesMin: preview.params.minutesMin,
          eventMinutes: row.event_minutes,
          eventCount: row.event_count,
          lastEventAt: row.last_event_at
        }
      });
      await notifyMemberRoleChange(member, { fromRole: 'Membro', toRole: 'Convidado' }).catch(() => {});
      results.push({ ...row, result: 'rebaixado_para_convidado' });
    } catch (error) {
      results.push({ ...row, result: `erro: ${String(error.message || error).slice(0, 120)}` });
    }
  }

  return {
    ...preview,
    results,
    applied: results.filter((row) => row.result === 'rebaixado_para_convidado').length,
    failed: results.filter((row) => row.result.startsWith('erro:')).length
  };
}

function cancelPreview(previewId, actorId) {
  const preview = takePreview(previewId, actorId);
  return preview;
}

function previewPayload(preview) {
  const rows = preview.candidates.slice(0, 12).map((row, index) => (
    `${index + 1}. <@${row.discord_id}> - ${row.albion_name || row.discord_name} - ${row.event_minutes}min`
  ));
  const hidden = preview.candidates.length - rows.length;
  if (hidden > 0) rows.push(`... e mais ${hidden}`);

  const embed = new EmbedBuilder()
    .setTitle('Previa - inativos de eventos')
    .setDescription([
      'Membros que nao tiveram participacao minima recente em eventos/calls de grupo do bot.',
      '',
      `Criterio: entrou ha pelo menos ${preview.params.daysMin} dia(s) e tem menos de ${preview.params.minutesMin} minuto(s) em eventos/calls nos ultimos ${preview.params.daysMin} dia(s).`,
      'Acao ao confirmar: remover Membro e adicionar Convidado.'
    ].join('\n'))
    .addFields(
      { name: 'Analisados', value: String(preview.summary.analyzed), inline: true },
      { name: 'Candidatos', value: String(preview.summary.candidates), inline: true },
      { name: 'Ativos', value: String(preview.summary.active), inline: true },
      { name: 'Ignorados', value: `Staff: ${preview.summary.protected}\nNovos: ${preview.summary.newMembers}\nSem data: ${preview.summary.unknownJoinDate}`, inline: true },
      { name: 'Lista', value: rows.join('\n') || 'Nenhum candidato encontrado.', inline: false }
    )
    .setColor(preview.candidates.length ? 0xd69e2e : 0x38a169)
    .setFooter({ text: `Previa ${preview.id} expira em ${expiryLabel(preview)}.` })
    .setTimestamp(new Date());

  const components = preview.candidates.length
    ? [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`inactive_events:confirm:${preview.id}`).setLabel('Confirmar rebaixamento').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`inactive_events:cancel:${preview.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
      )
    ]
    : [];

  return {
    embeds: [embed],
    components,
    files: [previewAttachment(preview)]
  };
}

function applyPayload(result) {
  const embed = new EmbedBuilder()
    .setTitle('Inativos de eventos aplicados')
    .setDescription([
      `Rebaixados para Convidado: ${result.applied}`,
      `Erros: ${result.failed}`,
      `Candidatos na previa: ${result.candidates.length}`
    ].join('\n'))
    .setColor(result.failed ? 0xd69e2e : 0x38a169)
    .setTimestamp(new Date());
  return {
    embeds: [embed],
    files: [applyAttachment(result)]
  };
}

async function postArchiveLog(client, result) {
  const channel = await client.channels.fetch(ids.channels.archive).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send({
      content: `Verificacao de inativos aplicada por <@${result.actorId}>. Rebaixados: ${result.applied}.`,
      ...applyPayload(result),
      allowedMentions: { users: [result.actorId] }
    }).catch(() => {});
  }
  await postPublicNotice(client, result, { fromRole: 'Membro', toRole: 'Convidado' }).catch(() => {});
}

async function postPublicNotice(client, result, { fromRole, toRole }) {
  const changed = result.results.filter((row) => row.result === 'rebaixado_para_convidado');
  if (!changed.length) return;
  const channel = await client.channels.fetch(ids.channels.inactivityNotice).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send(publicNoticePayload(changed.length, { fromRole, toRole }));
}

function publicNoticePayload(total, { fromRole, toRole }) {
  return {
    content: [
      'ℹ️ **ATUALIZAÇÃO DE CARGOS**',
      '',
      `**${total} ${total === 1 ? 'conta teve' : 'contas tiveram'}** o cargo ajustado de **${fromRole}** para **${toRole}**, conforme as regras de participação da comunidade.`,
      '',
      'Essa atualização não é punição. Os detalhes são enviados por mensagem privada quando o Discord permite o contato.',
      `Para recuperar o cargo, acesse <#${ids.channels.register}>, atualize seu registro e volte a participar de eventos ou calls da guilda.`,
      '',
      'Se você acredita que houve algum engano, procure a staff.'
    ].join('\n'),
    allowedMentions: { parse: [] }
  };
}

async function notifyMemberRoleChange(member, { fromRole, toRole }) {
  await member.send([
    `Olá! Seu cargo na NOTAG foi ajustado de **${fromRole}** para **${toRole}** porque não encontramos a participação mínima recente em eventos ou calls da guilda.`,
    '',
    'Isso não é banimento nem punição.',
    '',
    `Para recuperar o cargo, acesse <#${ids.channels.register}>, atualize seu registro e participe de um evento ou call da guilda.`,
    'Se os dados parecerem incorretos, procure a staff para uma revisão.'
  ].join('\n'));
}

async function analyzeGuild(guild, { daysMin, minutesMin }) {
  const members = await fetchGuildMembersWithRetry(guild);
  const users = userMap();
  const activity = activityMap(daysMin);
  const cutoff = Date.now() - daysMin * 24 * 60 * 60 * 1000;
  const minSeconds = minutesMin * 60;
  const rows = [];

  for (const member of members.filter((item) => !item.user.bot).values()) {
    if (!member.roles.cache.has(ids.roles.member)) continue;
    const joinedAt = member.joinedAt?.toISOString() || '';
    const stats = activity.get(member.id) || {};
    const eventSeconds = Math.max(Number(stats.participantSeconds || 0), Number(stats.voiceSeconds || 0));
    const base = {
      discord_id: member.id,
      discord_name: member.displayName || member.user.username,
      discord_tag: member.user.tag || member.user.username,
      albion_name: users.get(member.id)?.albion_name || '',
      joined_at: joinedAt,
      event_count: Math.max(Number(stats.participantEvents || 0), Number(stats.voiceEvents || 0)),
      event_minutes: Math.floor(eventSeconds / 60),
      last_event_at: stats.lastEventAt || stats.lastVoiceAt || '',
      action: 'nenhuma'
    };

    if (isProtected(member)) {
      rows.push({ ...base, status: 'protected', reason: 'cargo protegido/staff' });
      continue;
    }
    if (!member.joinedTimestamp) {
      rows.push({ ...base, status: 'unknown_join_date', reason: 'sem data de entrada no Discord' });
      continue;
    }
    if (member.joinedTimestamp > cutoff) {
      rows.push({ ...base, status: 'new_member', reason: `entrou ha menos de ${daysMin} dia(s)` });
      continue;
    }
    if (eventSeconds >= minSeconds) {
      rows.push({ ...base, status: 'active', reason: 'tem participacao minima recente em eventos/calls' });
      continue;
    }

    rows.push({
      ...base,
      status: 'candidate',
      action: 'remover_membro_adicionar_convidado',
      reason: `menos de ${minutesMin} minuto(s) em eventos/calls nos ultimos ${daysMin} dia(s)`
    });
  }

  return rows.sort((a, b) => statusWeight(a.status) - statusWeight(b.status) || a.discord_name.localeCompare(b.discord_name, 'pt-BR'));
}

function activityMap(daysMin) {
  const db = getDatabase();
  const map = new Map();
  const cutoffIso = new Date(Date.now() - daysMin * 24 * 60 * 60 * 1000).toISOString();

  const participantRows = db.prepare(`
    SELECT
      ep.discord_id,
      COUNT(DISTINCT ep.event_id) AS participant_events,
      SUM(COALESCE(ep.manual_seconds, ep.calculated_seconds, 0)) AS participant_seconds,
      MAX(COALESCE(e.ended_at, e.started_at, e.created_at)) AS last_event_at
    FROM event_participants ep
    JOIN events e ON e.id = ep.event_id
    WHERE ep.is_spectator = 0
      AND COALESCE(e.ended_at, e.started_at, e.created_at) >= @cutoffIso
    GROUP BY ep.discord_id
  `).all({ cutoffIso });

  for (const row of participantRows) {
    map.set(row.discord_id, {
      participantEvents: row.participant_events,
      participantSeconds: row.participant_seconds,
      lastEventAt: row.last_event_at
    });
  }

  const voiceRows = db.prepare(`
    SELECT
      evs.discord_id,
      COUNT(DISTINCT evs.event_id) AS voice_events,
      SUM(evs.seconds) AS voice_seconds,
      MAX(COALESCE(evs.left_at, evs.joined_at)) AS last_voice_at
    FROM event_voice_sessions evs
    JOIN event_participants ep
      ON ep.event_id = evs.event_id
     AND ep.discord_id = evs.discord_id
     AND ep.is_spectator = 0
    WHERE COALESCE(evs.left_at, evs.joined_at) >= @cutoffIso
    GROUP BY evs.discord_id
  `).all({ cutoffIso });

  for (const row of voiceRows) {
    const item = map.get(row.discord_id) || {};
    map.set(row.discord_id, {
      ...item,
      voiceEvents: row.voice_events,
      voiceSeconds: row.voice_seconds,
      lastVoiceAt: row.last_voice_at
    });
  }

  return map;
}

function userMap() {
  const rows = getDatabase().prepare('SELECT discord_id, albion_name FROM users').all();
  return new Map(rows.map((row) => [row.discord_id, row]));
}

function summarize(rows) {
  return {
    analyzed: rows.length,
    candidates: rows.filter((row) => row.status === 'candidate').length,
    active: rows.filter((row) => row.status === 'active').length,
    protected: rows.filter((row) => row.status === 'protected').length,
    newMembers: rows.filter((row) => row.status === 'new_member').length,
    unknownJoinDate: rows.filter((row) => row.status === 'unknown_join_date').length
  };
}

function previewAttachment(preview) {
  return rowsAttachment(preview.rows, `previa-inativos-eventos-${dateKey()}.csv`);
}

function applyAttachment(result) {
  return rowsAttachment(result.results, `resultado-inativos-eventos-${dateKey()}.csv`, true);
}

function rowsAttachment(rows, name, includeResult = false) {
  const columns = [
    'discord_id',
    'discord_name',
    'discord_tag',
    'albion_name',
    'joined_at',
    'event_count',
    'event_minutes',
    'last_event_at',
    'status',
    'action',
    'reason'
  ];
  if (includeResult) columns.push('result');
  const csv = toCsv(rows, columns);
  return new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name });
}

function isProtected(member) {
  return protectedRoles.some((roleName) => {
    const roleId = ids.roles[roleName];
    return roleId && member.roles.cache.has(roleId);
  }) || member.guild.ownerId === member.id;
}

function takePreview(id, actorId) {
  const preview = previews.get(id);
  if (!preview) throw new Error('Previa expirada. Gere uma nova verificacao.');
  if (!preview.shared && preview.actorId !== actorId) throw new Error('Essa previa foi criada por outra pessoa.');
  if (Date.parse(preview.expiresAt) < Date.now()) {
    previews.delete(id);
    throw new Error('Previa expirada. Gere uma nova verificacao.');
  }
  previews.delete(id);
  return preview;
}

function downgradeReason(preview) {
  return `Inativo em eventos/calls: menos de ${preview.params.minutesMin}min nos ultimos ${preview.params.daysMin} dias`;
}

function expiryLabel(preview) {
  const date = new Date(preview.expiresAt);
  if (Number.isNaN(date.getTime())) return 'breve';
  return date.toISOString().slice(0, 16).replace('T', ' UTC ');
}

async function fetchGuildMembersWithRetry(guild) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await guild.members.fetch();
    } catch (error) {
      const retryAfter = retryAfterMs(error);
      if (!retryAfter || attempt === 3) {
        throw new Error('Discord limitou a busca da lista de membros. Tente novamente em alguns segundos.');
      }
      await sleep(retryAfter + 1000);
    }
  }
  throw new Error('Discord limitou a busca da lista de membros. Tente novamente em alguns segundos.');
}

function retryAfterMs(error) {
  const direct = Number(error?.data?.retry_after ?? error?.retry_after ?? error?.retryAfter ?? 0);
  if (Number.isFinite(direct) && direct > 0) return Math.ceil(direct * 1000);
  const match = String(error?.message || '').match(/retry after ([\d.]+) seconds/i);
  if (!match) return 0;
  return Math.ceil(Number(match[1]) * 1000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function previewId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function dateKey() {
  return new Date().toISOString().slice(0, 10);
}

function statusWeight(status) {
  return {
    candidate: 0,
    active: 1,
    new_member: 2,
    protected: 3,
    unknown_join_date: 4
  }[status] ?? 9;
}

module.exports = {
  applyPayload,
  applyPreview,
  cancelPreview,
  createPreview,
  defaultDaysMin,
  defaultMinutesMin,
  postArchiveLog,
  publicNoticePayload,
  previewPayload
};
