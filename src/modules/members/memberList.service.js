const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const { htmlReportAttachment } = require('../../utils/htmlReport');
const accountLinks = require('../accounts/accountLinks.service');
const memberSnapshots = require('./memberSnapshot.service');

const protectedRoleKeys = ['staff', 'adm', 'caller', 'recruiter', 'treasurer'];

const roleFilters = {
  members: { label: 'Membros', role: 'member' },
  members_60_days: { label: 'Membros no servidor há 60+ dias', role: 'member', minimumServerAgeDays: 60 },
  members_75_days: { label: 'Membros no servidor há 75+ dias', role: 'member', minimumServerAgeDays: 75 },
  guests: { label: 'Convidados', role: 'guest' },
  pending: { label: 'Pendentes', status: 'pending' },
  no_tag: { label: 'Sem tag', role: 'noTag' },
  staff: { label: 'Equipe', staff: true }
};

async function panelPayload(guild) {
  const rows = await collectMembers(guild);
  return {
    embeds: [overviewEmbed(rows)],
    components: panelComponents()
  };
}

async function refreshPanel(interaction) {
  const payload = await panelPayload(interaction.guild);
  await interaction.message.edit(payload);
}

async function csvAttachment(guild) {
  const rows = await collectMembers(guild);
  const exportRows = rows.map((row) => ({
    discord_id: row.discordId,
    discord_tag: row.discordTag,
    display_name: row.displayName,
    albion_name: row.albionName,
    registration_status: row.registrationStatus,
    guild_status: row.guildStatus,
    roles: row.roleNames.join('|'),
    joined_at: row.joinedAt,
    discord_server_age_days: ageDays(row.joinedAt),
    discord_created_at: row.createdAt,
    discord_account_age_days: ageDays(row.createdAt)
  }));
  return htmlReportAttachment({
    title: 'Lista de membros Discord x Albion',
    fileName: `lista-membros-${dateKey()}.html`,
    csvName: `lista-membros-${dateKey()}.csv`,
    rows: exportRows,
    columns: [
      'discord_id',
      'discord_tag',
      'display_name',
      'albion_name',
      'registration_status',
      'guild_status',
      'roles',
      'joined_at',
      'discord_server_age_days',
      'discord_created_at',
      'discord_account_age_days'
    ],
    summary: [
      ['Total', exportRows.length],
      ['Membros', rows.filter((row) => row.guildStatus === 'membro').length],
      ['Convidados', rows.filter((row) => row.guildStatus === 'convidado').length],
      ['Pendentes', rows.filter((row) => row.guildStatus === 'pendente').length]
    ]
  });
}

async function filteredEmbed(guild, filterKey) {
  const rows = await collectMembers(guild);
  const filter = roleFilters[filterKey] || roleFilters.members;
  const filtered = filterRows(rows, filterKey);
  const lines = filtered
    .slice(0, 35)
    .map((row, index) => {
      const age = filter.minimumServerAgeDays ? ` — ${ageDays(row.joinedAt)} dias no servidor` : '';
      return `${index + 1}. <@${row.discordId}> - ${row.albionName || row.displayName}${age}`;
    })
    .join('\n') || 'Nenhum membro encontrado nesse filtro.';
  const hidden = filtered.length > 35 ? `\n... e mais ${filtered.length - 35}. Use Exportar HTML para lista completa.` : '';

  return new EmbedBuilder()
    .setTitle(`Lista de membros - ${filter.label}`)
    .setDescription(`${lines}${hidden}`)
    .addFields({ name: 'Total', value: String(filtered.length), inline: true })
    .setColor(0x3182ce)
    .setTimestamp(new Date());
}

function classifyGuildAbsence(memberRows, rosterRows) {
  const rosterNames = new Set(rosterRows
    .map((row) => normalizeName(row.member_key || row.characterName || row.character_name))
    .filter(Boolean));
  const discordMembers = memberRows.filter((row) => row.roleIds?.has(ids.roles.member));
  const absent = discordMembers.filter((row) => row.albionName && !rosterNames.has(normalizeName(row.albionName)));
  return {
    discordMembers,
    absent,
    eligible: absent.filter((row) => !row.removalBlockedReason),
    protected: absent.filter((row) => row.removalBlockedReason),
    unverified: discordMembers.filter((row) => !row.albionName)
  };
}

async function guildAbsenceComparison(guild) {
  const snapshot = memberSnapshots.latestSnapshotDetails();
  if (!snapshot) {
    throw new Error('Ainda nao existe uma lista oficial da guild importada. Importe a lista antes de comparar.');
  }
  return {
    snapshot,
    comparison: classifyGuildAbsence(await collectMembers(guild), snapshot.rows)
  };
}

async function guildAbsencePayload(guild) {
  const { snapshot, comparison } = await guildAbsenceComparison(guild);
  const visibleAbsent = comparison.absent.slice(0, 30).map((row, index) => (
    `${index + 1}. **${row.albionName}** — ${row.displayName} (<@${row.discordId}>)`
  ));
  const visibleUnverified = comparison.unverified.slice(0, 10).map((row) => (
    `• ${row.displayName} (<@${row.discordId}>)`
  ));
  const description = [
    `Comparacao entre quem possui o cargo **Membro** no Discord e a lista oficial #${snapshot.id}.`,
    '',
    '**No Discord, mas fora da guild:**',
    ...(visibleAbsent.length ? visibleAbsent : ['Nenhum encontrado.']),
    ...(comparison.absent.length > visibleAbsent.length
      ? [`... e mais **${comparison.absent.length - visibleAbsent.length}** no arquivo completo.`]
      : []),
    comparison.protected.length
      ? `\n**${comparison.protected.length}** pessoa(s) desta lista estao protegidas por cargo, propriedade do servidor ou hierarquia do bot e nao entrarao na campanha.`
      : null,
    '',
    '**Sem nome Albion cadastrado (nao foi possivel verificar):**',
    ...(visibleUnverified.length ? visibleUnverified : ['Nenhum.']),
    ...(comparison.unverified.length > visibleUnverified.length
      ? [`... e mais **${comparison.unverified.length - visibleUnverified.length}** no arquivo completo.`]
      : [])
  ].filter((line) => line !== null).join('\n');

  const reportRows = [
    ...comparison.absent.map((row) => reportRow(row, 'Fora da lista atual da guild')),
    ...comparison.unverified.map((row) => reportRow(row, 'Sem nome Albion cadastrado'))
  ];
  const attachment = htmlReportAttachment({
    title: 'Membros do Discord ausentes da guild',
    subtitle: `Comparação com a lista oficial #${snapshot.id}, importada em ${snapshot.created_at}.`,
    fileName: `discord-fora-guild-${dateKey()}.html`,
    csvName: `discord-fora-guild-${dateKey()}.csv`,
    rows: reportRows,
    columns: [
      { key: 'situacao', label: 'Situação' },
      { key: 'albion_name', label: 'Nome Albion' },
      { key: 'discord_name', label: 'Nome Discord' },
      { key: 'discord_id', label: 'ID Discord' },
      { key: 'joined_at', label: 'Entrou no servidor' },
      { key: 'discord_server_age_days', label: 'Dias no servidor', align: 'right' }
    ],
    summary: [
      ['Cargo Membro no Discord', comparison.discordMembers.length],
      ['Fora da guild', comparison.absent.length],
      ['Sem cadastro Albion', comparison.unverified.length],
      ['Lista oficial', `#${snapshot.id}`]
    ]
  });

  return {
    embeds: [new EmbedBuilder()
      .setTitle('Discord x lista atual da guild')
      .setDescription(description)
      .addFields(
        { name: 'Cargo Membro', value: String(comparison.discordMembers.length), inline: true },
        { name: 'Fora da guild', value: String(comparison.absent.length), inline: true },
        { name: 'Removiveis', value: String(comparison.eligible.length), inline: true },
        { name: 'Sem cadastro', value: String(comparison.unverified.length), inline: true }
      )
      .setColor(comparison.absent.length ? 0xd97706 : 0x16a34a)
      .setTimestamp(new Date())],
    files: [attachment],
    components: comparison.eligible.length
      ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`guild_cleanup:start:${snapshot.id}`)
          .setLabel('Publicar aviso de 24 horas')
          .setStyle(ButtonStyle.Danger)
      )]
      : [],
    allowedMentions: { parse: [] }
  };
}

async function collectMembers(guild) {
  const users = userMap();
  const pendingIds = new Set(pendingRegistrations().map((row) => row.discord_id));
  const members = await fetchGuildMembersWithRetry(guild);
  return [...members.values()]
    .filter((member) => !member.user.bot)
    .map((member) => {
      const directUser = users.get(member.id);
      const primaryId = accountLinks.resolvePrimaryUserId(member.id);
      const user = directUser?.albion_name ? directUser : (users.get(primaryId) || directUser);
      const roleNames = importantRoles(member);
      const protectedRole = protectedRoleKeys.find((roleKey) => {
        const roleId = ids.roles[roleKey];
        return roleId && member.roles.cache.has(roleId);
      });
      const removalBlockedReason = member.guild.ownerId === member.id
        ? 'dono do servidor'
        : protectedRole
          ? `cargo ${protectedRole}`
          : !member.kickable
            ? 'hierarquia do bot'
            : null;
      return {
        discordId: member.id,
        discordTag: member.user.tag || member.user.username,
        displayName: member.displayName || member.user.username,
        albionName: user?.albion_name || '',
        registrationStatus: user?.registration_status || 'unregistered',
        guildStatus: statusFor(member, user, pendingIds),
        joinedAt: member.joinedAt?.toISOString() || '',
        createdAt: member.user.createdAt?.toISOString() || '',
        roleNames,
        roleIds: new Set(member.roles.cache.keys()),
        removalBlockedReason
      };
    })
    .sort((a, b) => displaySort(a).localeCompare(displaySort(b), 'pt-BR', { sensitivity: 'base' }));
}

async function fetchGuildMembersWithRetry(guild) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await guild.members.fetch();
    } catch (error) {
      const retryAfter = retryAfterMs(error);
      if (!retryAfter || attempt === 3) {
        throw new Error('Discord limitou a exportacao da lista de membros. Tente novamente em alguns segundos.');
      }
      await sleep(retryAfter + 1000);
    }
  }
  throw new Error('Discord limitou a exportacao da lista de membros. Tente novamente em alguns segundos.');
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

function overviewEmbed(rows) {
  const total = rows.length;
  const members = countRole(rows, 'member');
  const guests = countRole(rows, 'guest');
  const noTag = countRole(rows, 'noTag');
  const staff = filterRows(rows, 'staff').length;
  const pending = rows.filter((row) => row.guildStatus === 'pendente').length;
  const registered = rows.filter((row) => row.albionName).length;
  const newSevenDays = rows.filter((row) => row.joinedAt && Date.now() - Date.parse(row.joinedAt) <= 7 * 24 * 60 * 60 * 1000);
  const members60Days = filterRows(rows, 'members_60_days').length;
  const members75Days = filterRows(rows, 'members_75_days').length;

  return new EmbedBuilder()
    .setTitle('Lista de Membros NOTAG')
    .setDescription('Painel de acompanhamento da comunidade. Use os botoes para atualizar, filtrar ou exportar a lista completa.')
    .addFields(
      { name: 'Total', value: String(total), inline: true },
      { name: 'Membros', value: String(members), inline: true },
      { name: 'Convidados', value: String(guests), inline: true },
      { name: 'Pendentes', value: String(pending), inline: true },
      { name: 'Sem tag', value: String(noTag), inline: true },
      { name: 'Equipe', value: String(staff), inline: true },
      { name: 'Registrados', value: String(registered), inline: true },
      { name: 'Membros · servidor 60+ dias', value: String(members60Days), inline: true },
      { name: 'Membros · servidor 75+ dias', value: String(members75Days), inline: true },
      { name: 'Novos 7 dias', value: `${newSevenDays.length}${newSevenDays.length ? `\n${mentions(newSevenDays.slice(0, 8))}` : ''}`, inline: false }
    )
    .setColor(0x805ad5)
    .setFooter({ text: `Atualizado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` });
}

function panelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('member_list:refresh').setLabel('Atualizar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('member_list:csv').setLabel('Exportar HTML').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('member_list:view:members').setLabel('Membros').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('member_list:view:guests').setLabel('Convidados').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('member_list:view:pending').setLabel('Pendentes').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('member_list:view:no_tag').setLabel('Sem tag').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('member_list:view:staff').setLabel('Equipe').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('member_list:view:members_60_days').setLabel('Membros 60+ dias').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('member_list:view:members_75_days').setLabel('Membros 75+ dias').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('member_list:outside_guild').setLabel('Fora da guild').setStyle(ButtonStyle.Danger)
    )
  ];
}

function filterRows(rows, filterKey) {
  if (filterKey === 'pending') return rows.filter((row) => row.guildStatus === 'pendente');
  if (filterKey === 'staff') {
    return rows.filter((row) => ['adm', 'staff', 'treasurer', 'caller', 'recruiter'].some((role) => row.roleIds.has(ids.roles[role])));
  }
  const filter = roleFilters[filterKey];
  if (!filter?.role) return rows;
  return rows.filter((row) => {
    if (!row.roleIds.has(ids.roles[filter.role])) return false;
    if (!filter.minimumServerAgeDays) return true;
    return ageDays(row.joinedAt) >= filter.minimumServerAgeDays;
  });
}

function ageDays(startedAt, now = Date.now()) {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((now - started) / (24 * 60 * 60 * 1000)));
}

function statusFor(member, user, pendingIds) {
  if (pendingIds.has(member.id) || user?.registration_status === 'pending') return 'pendente';
  if (member.roles.cache.has(ids.roles.member)) return 'membro';
  if (member.roles.cache.has(ids.roles.guest)) return 'convidado';
  if (member.roles.cache.has(ids.roles.noTag)) return 'sem_tag';
  return user?.registration_status || 'sem_status';
}

function importantRoles(member) {
  return Object.entries(ids.roles)
    .filter(([, roleId]) => member.roles.cache.has(roleId))
    .map(([roleName]) => roleName);
}

function countRole(rows, roleName) {
  return rows.filter((row) => row.roleIds.has(ids.roles[roleName])).length;
}

function userMap() {
  const rows = getDatabase().prepare('SELECT * FROM users').all();
  return new Map(rows.map((row) => [row.discord_id, row]));
}

function pendingRegistrations() {
  return getDatabase().prepare("SELECT discord_id FROM registrations WHERE status = 'pending'").all();
}

function mentions(rows) {
  return rows.map((row) => `<@${row.discordId}>`).join(', ');
}

function displaySort(row) {
  return row.albionName || row.displayName || row.discordTag || row.discordId;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function reportRow(row, situation) {
  return {
    situacao: situation,
    albion_name: row.albionName || '',
    discord_name: row.displayName || row.discordTag || '',
    discord_id: row.discordId,
    joined_at: row.joinedAt,
    discord_server_age_days: ageDays(row.joinedAt)
  };
}

function dateKey() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = {
  classifyGuildAbsence,
  csvAttachment,
  filteredEmbed,
  guildAbsenceComparison,
  guildAbsencePayload,
  panelComponents,
  panelPayload,
  refreshPanel
};
