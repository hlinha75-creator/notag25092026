const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { Client, GatewayIntentBits } = require('discord.js');

require('dotenv').config();

const ids = require('../src/config/ids');

const DAY_MS = 24 * 60 * 60 * 1000;
const outputPath = path.resolve(process.argv[2] || 'data/reports/membros-discord-guild-75-dias-artifact.json');
const databasePath = path.resolve(process.env.DATABASE_PATH || 'data/notag.sqlite');

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function ageDays(date, now = Date.now()) {
  const started = date instanceof Date ? date.getTime() : Date.parse(date);
  return Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / DAY_MS)) : 0;
}

function isoOrBlank(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
}

function memberNames(member) {
  return [...new Set([
    member.displayName,
    member.nickname,
    member.user.globalName,
    member.user.username
  ].filter(Boolean))];
}

function statusSort(status) {
  return { 'Nos dois': 1, 'Só Discord 75+': 2, 'Só guilda': 3 }[status] || 9;
}

function sourceQuery(snapshotId) {
  return [
    'Discord: guild.members.fetch(); manter usuários não-bot com o cargo Membro;',
    'calcular floor((data_de_geracao - joinedAt) / 86400000) e filtrar idade >= 75;',
    `Albion: SELECT member_key, character_name, last_seen, roles_json FROM member_snapshot_rows WHERE snapshot_id = ${snapshotId};`,
    'Vínculo: users.discord_id -> users.albion_name; na ausência, igualdade exata após normalização do nome Discord e do personagem Albion;',
    'Saída: união dos membros Discord elegíveis com todos os personagens do snapshot Albion.'
  ].join('\n');
}

async function main() {
  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN não configurado.');

  const db = new Database(databasePath, { readonly: true });
  const latestSnapshot = db.prepare(`
    SELECT id, source_name, member_count, online_count, created_at
    FROM member_snapshots
    ORDER BY id DESC
    LIMIT 1
  `).get();
  if (!latestSnapshot) throw new Error('Nenhum snapshot de membros Albion encontrado.');

  const rosterRows = db.prepare(`
    SELECT member_key, character_name, last_seen, roles_json, is_online, last_seen_iso
    FROM member_snapshot_rows
    WHERE snapshot_id = ?
    ORDER BY character_name COLLATE NOCASE
  `).all(latestSnapshot.id);
  const users = db.prepare(`
    SELECT discord_id, discord_name, albion_name, registration_status
    FROM users
    WHERE albion_name IS NOT NULL AND trim(albion_name) <> ''
  `).all();
  db.close();

  const rosterByKey = new Map(rosterRows.map((row) => [row.member_key || normalizeName(row.character_name), row]));
  const userByDiscord = new Map(users.map((row) => [String(row.discord_id), row]));

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  try {
    await client.login(process.env.DISCORD_TOKEN);
    const guild = await client.guilds.fetch(ids.guildId);
    const members = await guild.members.fetch();
    const generatedAt = new Date();
    const eligibleDiscord = [...members.values()]
      .filter((member) => !member.user.bot)
      .filter((member) => member.roles.cache.has(ids.roles.member))
      .filter((member) => ageDays(member.joinedAt, generatedAt.getTime()) >= 75);

    const matchedRosterKeys = new Set();
    const relationRows = [];

    for (const member of eligibleDiscord) {
      const linkedUser = userByDiscord.get(member.id);
      const linkedKey = normalizeName(linkedUser?.albion_name);
      let roster = linkedKey ? rosterByKey.get(linkedKey) : null;
      let matchMethod = roster ? 'Cadastro' : '';

      if (!roster) {
        const exactMatches = memberNames(member)
          .map(normalizeName)
          .filter(Boolean)
          .map((key) => rosterByKey.get(key))
          .filter(Boolean);
        const uniqueMatches = [...new Map(exactMatches.map((row) => [row.member_key, row])).values()];
        if (uniqueMatches.length === 1) {
          roster = uniqueMatches[0];
          matchMethod = 'Nome exato';
        }
      }

      if (roster) matchedRosterKeys.add(roster.member_key);
      const discordName = member.displayName || member.user.globalName || member.user.username;
      const situation = roster ? 'Nos dois' : 'Só Discord 75+';
      relationRows.push({
        nome: roster?.character_name || linkedUser?.albion_name || discordName,
        discord: discordName,
        personagem_albion: roster?.character_name || linkedUser?.albion_name || '',
        situacao: situation,
        no_discord_75: 'Sim',
        na_guild_albion: roster ? 'Sim' : 'Não',
        dias_no_discord: ageDays(member.joinedAt, generatedAt.getTime()),
        entrou_no_discord: isoOrBlank(member.joinedAt),
        ultimo_acesso_albion: roster?.last_seen || '',
        cargos_guilda: roster ? JSON.parse(roster.roles_json || '[]').join(', ') : '',
        vinculo: matchMethod || 'Não vinculado',
        ordem: statusSort(situation)
      });
    }

    for (const roster of rosterRows) {
      if (matchedRosterKeys.has(roster.member_key)) continue;
      relationRows.push({
        nome: roster.character_name,
        discord: '',
        personagem_albion: roster.character_name,
        situacao: 'Só guilda',
        no_discord_75: 'Não',
        na_guild_albion: 'Sim',
        dias_no_discord: null,
        entrou_no_discord: '',
        ultimo_acesso_albion: roster.last_seen || '',
        cargos_guilda: JSON.parse(roster.roles_json || '[]').join(', '),
        vinculo: 'Não vinculado',
        ordem: statusSort('Só guilda')
      });
    }

    relationRows.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));

    const both = relationRows.filter((row) => row.situacao === 'Nos dois').length;
    const discordOnly = relationRows.filter((row) => row.situacao === 'Só Discord 75+').length;
    const guildOnly = relationRows.filter((row) => row.situacao === 'Só guilda').length;
    const summary = [{
      discord_75: eligibleDiscord.length,
      guild_albion: rosterRows.length,
      nos_dois: both,
      so_discord: discordOnly,
      so_guilda: guildOnly
    }];

    const generatedIso = generatedAt.toISOString();
    const sourceId = 'discord_albion_relation';
    const artifact = {
      surface: 'dashboard',
      manifest: {
        version: 1,
        surface: 'dashboard',
        title: 'Membros Discord 75+ dias × Guilda Albion',
        description: 'Relação entre membros com cargo Membro há pelo menos 75 dias no Discord e o snapshot disponível da guilda Albion.',
        generatedAt: generatedIso,
        filters: [
          { id: 'situacao', label: 'Situação', dataset: 'membros', field: 'situacao', includeAll: true, targets: [{ dataset: 'membros', field: 'situacao' }] },
          { id: 'discord_75', label: 'Discord 75+ dias', dataset: 'membros', field: 'no_discord_75', includeAll: true, targets: [{ dataset: 'membros', field: 'no_discord_75' }] },
          { id: 'guild_albion', label: 'Guilda Albion', dataset: 'membros', field: 'na_guild_albion', includeAll: true, targets: [{ dataset: 'membros', field: 'na_guild_albion' }] },
          { id: 'vinculo', label: 'Tipo de vínculo', dataset: 'membros', field: 'vinculo', includeAll: true, targets: [{ dataset: 'membros', field: 'vinculo' }] }
        ],
        cards: [
          { id: 'discord_card', description: 'Usuários não-bot com cargo Membro e 75 dias ou mais no servidor Discord.', dataset: 'resumo', sourceId, metrics: [{ label: 'Discord 75+ dias', field: 'discord_75', format: 'number' }] },
          { id: 'guild_card', description: `Personagens no snapshot Albion #${latestSnapshot.id}.`, dataset: 'resumo', sourceId, metrics: [{ label: 'Guilda Albion', field: 'guild_albion', format: 'number' }] },
          { id: 'both_card', description: 'Membros Discord 75+ associados a um personagem presente na guilda Albion.', dataset: 'resumo', sourceId, metrics: [{ label: 'Nos dois', field: 'nos_dois', format: 'number' }] },
          { id: 'discord_only_card', description: 'Membros Discord 75+ sem correspondência confirmada no snapshot Albion.', dataset: 'resumo', sourceId, metrics: [{ label: 'Só Discord', field: 'so_discord', format: 'number' }] },
          { id: 'guild_only_card', description: 'Personagens no snapshot Albion sem correspondência entre os membros Discord 75+.', dataset: 'resumo', sourceId, metrics: [{ label: 'Só guilda', field: 'so_guilda', format: 'number' }] }
        ],
        charts: [],
        tables: [
          {
            id: 'member_table',
            title: 'Relação nominal',
            subtitle: 'Use os filtros para isolar correspondências e pendências. A coluna “Vínculo” informa como a associação foi feita.',
            dataset: 'membros',
            sourceId,
            defaultSort: { field: 'nome', direction: 'asc' },
            density: 'compact',
            columns: [
              { field: 'nome', label: 'Nome', type: 'text' },
              { field: 'discord', label: 'Discord', type: 'text' },
              { field: 'personagem_albion', label: 'Personagem Albion', type: 'text' },
              { field: 'situacao', label: 'Situação', type: 'text' },
              { field: 'dias_no_discord', label: 'Dias no Discord', format: 'number' },
              { field: 'entrou_no_discord', label: 'Entrada no Discord', type: 'date' },
              { field: 'ultimo_acesso_albion', label: 'Último acesso Albion', type: 'text' },
              { field: 'cargos_guilda', label: 'Cargos na guilda', type: 'text' },
              { field: 'vinculo', label: 'Vínculo', type: 'text' }
            ]
          }
        ],
        sources: [{ id: sourceId, label: 'Discord ao vivo + snapshot local da guilda Albion', path: 'scripts/generateMember75DayReport.js' }],
        blocks: [
          { id: 'metrics', type: 'metric-strip', cardIds: ['discord_card', 'guild_card', 'both_card', 'discord_only_card', 'guild_only_card'] },
          {
            id: 'caveat',
            type: 'markdown',
            body: `**Atualização das fontes:** Discord consultado ao vivo em ${generatedIso}. Guilda Albion baseada no snapshot #${latestSnapshot.id}, “${latestSnapshot.source_name || 'sem nome'}”, criado em ${latestSnapshot.created_at}. Associações por nome exato devem ser revisadas pela staff antes de qualquer ação.`
          },
          { id: 'member_table_block', type: 'table', tableId: 'member_table' }
        ]
      },
      snapshot: {
        version: 1,
        generatedAt: generatedIso,
        status: 'ready',
        datasets: { resumo: summary, membros: relationRows }
      },
      sources: [
        {
          id: sourceId,
          label: 'Discord ao vivo + SQLite local',
          path: 'scripts/generateMember75DayReport.js',
          query: {
            engine: 'discord.js + better-sqlite3',
            language: 'javascript + sql',
            sql: `SELECT r.member_key, r.character_name, r.last_seen, r.roles_json, r.is_online, r.last_seen_iso,
                         u.discord_id, u.discord_name, u.albion_name, u.registration_status
                  FROM member_snapshot_rows AS r
                  LEFT JOIN users AS u
                    ON lower(trim(u.albion_name)) = lower(trim(r.character_name))
                  WHERE r.snapshot_id = ${latestSnapshot.id}
                  ORDER BY r.character_name COLLATE NOCASE`,
            query: sourceQuery(latestSnapshot.id),
            description: 'Cruza membros Discord com 75+ dias e cargo Membro contra o snapshot mais recente da guilda Albion.',
            executed_at: generatedIso,
            tables_used: ['Discord Guild Members API', 'member_snapshots', 'member_snapshot_rows', 'users'],
            filters: ['Discord: usuários não-bot', `Discord: cargo Membro ${ids.roles.member}`, 'Discord: idade no servidor >= 75 dias', `Albion: snapshot_id = ${latestSnapshot.id}`],
            metric_definitions: [
              'Discord 75+ dias = floor((data de geração - joinedAt) / 1 dia) >= 75 e cargo Membro.',
              'Nos dois = membro Discord elegível associado a personagem presente no snapshot Albion por cadastro ou nome normalizado exato.'
            ]
          }
        }
      ]
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      outputPath,
      generatedAt: generatedIso,
      discord75: eligibleDiscord.length,
      guildAlbion: rosterRows.length,
      both,
      discordOnly,
      guildOnly,
      totalRows: relationRows.length,
      snapshot: latestSnapshot
    }, null, 2));
  } finally {
    client.destroy();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
