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
const protectedRoles = ['adm', 'staff', 'treasurer', 'caller', 'recruiter'];

async function createPreview({ guild, actorId, daysMin = defaultDaysMin, expiresInMs = 15 * 60 * 1000, shared = false }) {
  const safeDays = Math.max(1, Number(daysMin || defaultDaysMin));
  const rows = await analyzeGuild(guild, { daysMin: safeDays });
  const candidates = rows.filter((row) => row.status === 'candidate');
  const preview = {
    id: previewId(),
    actorId,
    guildId: guild.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    shared,
    params: { daysMin: safeDays },
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
    if (isProtected(member) || !member.roles.cache.has(ids.roles.guest) || member.roles.cache.has(ids.roles.member)) {
      results.push({ ...row, result: 'ignorado_permissao_ou_cargo_mudou' });
      continue;
    }

    try {
      if (ids.roles.noTag && !member.roles.cache.has(ids.roles.noTag)) {
        await member.roles.add(ids.roles.noTag, downgradeReason(preview));
      }
      await member.roles.remove(ids.roles.guest, downgradeReason(preview));
      audit.createAuditLog({
        type: 'guest_inactive_voice_downgrade',
        actorId,
        targetId: row.discord_id,
        beforeValue: 'guest',
        afterValue: 'no_tag',
        reason: downgradeReason(preview),
        metadata: {
          daysMin: preview.params.daysMin,
          lastVoiceAt: row.last_voice_at,
          voiceSessions: row.voice_sessions,
          voiceMinutes: row.voice_minutes
        }
      });
      await notifyMemberRoleChange(member, { fromRole: 'Convidado', toRole: 'Sem Tag' }).catch(() => {});
      results.push({ ...row, result: 'convidado_para_sem_tag' });
    } catch (error) {
      results.push({ ...row, result: `erro: ${String(error.message || error).slice(0, 120)}` });
    }
  }

  return {
    ...preview,
    results,
    applied: results.filter((row) => row.result === 'convidado_para_sem_tag').length,
    failed: results.filter((row) => row.result.startsWith('erro:')).length
  };
}

function cancelPreview(previewId, actorId) {
  return takePreview(previewId, actorId);
}

function previewPayload(preview) {
  const rows = preview.candidates.slice(0, 12).map((row, index) => {
    const last = row.last_voice_at ? daysSinceText(row.last_voice_at) : 'nunca entrou em call';
    return `${index + 1}. <@${row.discord_id}> - ${row.albion_name || row.discord_name} - ${last}`;
  });
  const hidden = preview.candidates.length - rows.length;
  if (hidden > 0) rows.push(`... e mais ${hidden}`);

  const embed = new EmbedBuilder()
    .setTitle('Previa - convidados sem call')
    .setDescription([
      'Convidados que nao entraram em nenhuma call de voz recentemente.',
      '',
      `Criterio: cargo Convidado, entrou no Discord ha pelo menos ${preview.params.daysMin} dia(s), e sem call registrada nos ultimos ${preview.params.daysMin} dia(s).`,
      'Acao ao confirmar: remover Convidado e adicionar Sem Tag.'
    ].join('\n'))
    .addFields(
      { name: 'Analisados', value: String(preview.summary.analyzed), inline: true },
      { name: 'Candidatos', value: String(preview.summary.candidates), inline: true },
      { name: 'Ativos', value: String(preview.summary.active), inline: true },
      { name: 'Ignorados', value: `Staff: ${preview.summary.protected}\nNovos: ${preview.summary.newGuests}\nCom Membro: ${preview.summary.hasMember}`, inline: true },
      { name: 'Lista', value: rows.join('\n') || 'Nenhum candidato encontrado.', inline: false }
    )
    .setColor(preview.candidates.length ? 0xd69e2e : 0x38a169)
    .setFooter({ text: `Previa ${preview.id} expira em ${expiryLabel(preview)}.` })
    .setTimestamp(new Date());

  const components = preview.candidates.length
    ? [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`inactive_guests:confirm:${preview.id}`).setLabel('Confirmar Sem Tag').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`inactive_guests:cancel:${preview.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
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
    .setTitle('Convidados inativos aplicados')
    .setDescription([
      `Movidos para Sem Tag: ${result.applied}`,
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
      content: `Verificacao de convidados inativos aplicada por <@${result.actorId}>. Movidos para Sem Tag: ${result.applied}.`,
      ...applyPayload(result),
      allowedMentions: { users: [result.actorId] }
    }).catch(() => {});
  }
  await postPublicNotice(client, result, { fromRole: 'Convidado', toRole: 'Sem Tag' }).catch(() => {});
  await postMemberExitLog(client, result).catch(() => {});
}

async function postMemberExitLog(client, result) {
  const changed = result.results.filter((row) => row.result === 'convidado_para_sem_tag');
  if (!changed.length) return;
  const channel = await client.channels.fetch(ids.channels.memberExit).catch(() => null);
  if (!channel?.isTextBased()) return;

  const lines = changed.slice(0, 25).map((row, index) => (
    `${index + 1}. <@${row.discord_id}> - ${row.albion_name || row.discord_name || row.discord_id} - ${row.reason}`
  ));
  const hidden = changed.length - lines.length;
  if (hidden > 0) lines.push(`... e mais ${hidden}`);

  await channel.send({
    content: `<@&${ids.roles.noTag}> atualizado por inatividade de convidados.`,
    embeds: [
      new EmbedBuilder()
        .setTitle('Movidos para Sem Tag por inatividade')
        .setDescription([
          `Total movido para <@&${ids.roles.noTag}>: ${changed.length}`,
          `Acao aplicada por: <@${result.actorId}>`,
          '',
          lines.join('\n')
        ].join('\n'))
        .setColor(0xd69e2e)
        .setTimestamp(new Date())
    ],
    files: [applyAttachment(result)],
    allowedMentions: { roles: [], users: [result.actorId, ...changed.map((row) => row.discord_id)] }
  });
}

async function postPublicNotice(client, result, { fromRole, toRole }) {
  const changed = result.results.filter((row) => row.result === 'convidado_para_sem_tag');
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
    `Olá! Seu cargo na NOTAG foi ajustado de **${fromRole}** para **${toRole}** porque não encontramos atividade recente em calls da guilda.`,
    '',
    'Isso não é banimento nem punição.',
    '',
    `Para recuperar o cargo, acesse <#${ids.channels.register}>, atualize seu registro e participe de um evento ou call da guilda.`,
    'Se os dados parecerem incorretos, procure a staff para uma revisão.'
  ].join('\n'));
}

async function analyzeGuild(guild, { daysMin }) {
  const members = await fetchGuildMembersWithRetry(guild);
  const users = userMap();
  const voice = voiceMap();
  const guestSince = guestSinceMap();
  const cutoff = Date.now() - daysMin * 24 * 60 * 60 * 1000;
  const rows = [];

  for (const member of members.filter((item) => !item.user.bot).values()) {
    if (!member.roles.cache.has(ids.roles.guest)) continue;
    const joinedAt = member.joinedAt?.toISOString() || '';
    const stats = voice.get(member.id) || {};
    const lastVoiceAt = stats.lastVoiceAt || '';
    const guestSinceAt = guestSince.get(member.id) || joinedAt;
    const base = {
      discord_id: member.id,
      discord_name: member.displayName || member.user.username,
      discord_tag: member.user.tag || member.user.username,
      albion_name: users.get(member.id)?.albion_name || '',
      joined_at: joinedAt,
      voice_sessions: Number(stats.sessions || 0),
      voice_minutes: Math.floor(Number(stats.seconds || 0) / 60),
      last_voice_at: lastVoiceAt,
      guest_since: guestSinceAt,
      action: 'nenhuma'
    };

    if (isProtected(member)) {
      rows.push({ ...base, status: 'protected', reason: 'cargo protegido/staff' });
      continue;
    }
    if (member.roles.cache.has(ids.roles.member)) {
      rows.push({ ...base, status: 'has_member', reason: 'tambem tem cargo Membro' });
      continue;
    }
    if (!member.joinedTimestamp) {
      rows.push({ ...base, status: 'unknown_join_date', reason: 'sem data de entrada no Discord' });
      continue;
    }
    const guestSinceTime = Date.parse(guestSinceAt);
    if (Number.isFinite(guestSinceTime) && guestSinceTime > cutoff) {
      rows.push({ ...base, status: 'new_guest', reason: `virou Convidado ha menos de ${daysMin} dia(s)` });
      continue;
    }
    if (lastVoiceAt && Date.parse(lastVoiceAt) > cutoff) {
      rows.push({ ...base, status: 'active', reason: 'tem call recente' });
      continue;
    }

    rows.push({
      ...base,
      status: 'candidate',
      action: 'remover_convidado_adicionar_sem_tag',
      reason: lastVoiceAt ? `ultima call ha mais de ${daysMin} dia(s)` : 'sem call registrada'
    });
  }

  return rows.sort((a, b) => statusWeight(a.status) - statusWeight(b.status) || a.discord_name.localeCompare(b.discord_name, 'pt-BR'));
}

function voiceMap() {
  const rows = getDatabase().prepare(`
    SELECT
      discord_id,
      COUNT(*) AS sessions,
      SUM(CASE
        WHEN left_at IS NULL THEN CAST((julianday('now') - julianday(joined_at)) * 86400 AS INTEGER)
        ELSE seconds
      END) AS seconds,
      MAX(COALESCE(left_at, joined_at)) AS last_voice_at
    FROM voice_sessions
    GROUP BY discord_id
  `).all();

  return new Map(rows.map((row) => [row.discord_id, {
    sessions: row.sessions,
    seconds: row.seconds,
    lastVoiceAt: row.last_voice_at
  }]));
}

function guestSinceMap() {
  const rows = getDatabase().prepare(`
    SELECT target_id AS discord_id, MAX(created_at) AS guest_since
    FROM audit_logs
    WHERE target_id IS NOT NULL
      AND type IN ('member_inactive_event_downgrade', 'registration_kept_guest', 'registration_created')
    GROUP BY target_id
  `).all();
  return new Map(rows.map((row) => [row.discord_id, row.guest_since]));
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
    newGuests: rows.filter((row) => row.status === 'new_guest').length,
    hasMember: rows.filter((row) => row.status === 'has_member').length,
    unknownJoinDate: rows.filter((row) => row.status === 'unknown_join_date').length
  };
}

function previewAttachment(preview) {
  return rowsAttachment(preview.rows, `previa-inativos-convidados-${dateKey()}.csv`);
}

function applyAttachment(result) {
  return rowsAttachment(result.results, `resultado-inativos-convidados-${dateKey()}.csv`, true);
}

function rowsAttachment(rows, name, includeResult = false) {
  const columns = [
    'discord_id',
    'discord_name',
    'discord_tag',
    'albion_name',
    'joined_at',
    'voice_sessions',
    'voice_minutes',
    'last_voice_at',
    'guest_since',
    'status',
    'action',
    'reason'
  ];
  if (includeResult) columns.push('result');
  return new AttachmentBuilder(Buffer.from(toCsv(rows, columns), 'utf8'), { name });
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
  return `Convidado inativo em voz: sem call recente em ${preview.params.daysMin}+ dias`;
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

function daysSinceText(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'sem data';
  const days = Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000));
  return `ultima call ha ${days} dia(s)`;
}

function statusWeight(status) {
  return {
    candidate: 0,
    active: 1,
    new_guest: 2,
    has_member: 3,
    protected: 4,
    unknown_join_date: 5
  }[status] ?? 9;
}

module.exports = {
  applyPayload,
  applyPreview,
  cancelPreview,
  createPreview,
  defaultDaysMin,
  postArchiveLog,
  publicNoticePayload,
  previewPayload
};
