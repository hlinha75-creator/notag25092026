const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function parseGuildTsv(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  return lines.slice(1).map((line) => {
    const fields = line.split('\t').map((value) => value.replace(/^"|"$/g, '').replace(/""/g, '"'));
    return { player: fields[0] || '', lastSeen: fields[1] || '', roles: fields[2] || '' };
  }).filter((row) => row.player);
}

function parseDiscordTsv(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const [id = '', username = '', globalName = '', nickname = '', displayName = ''] = line.split('\t');
    return { id, username, globalName, nickname, displayName };
  }).filter((row) => row.id);
}

function memberNames(member) {
  return [...new Set([member.nickname, member.displayName, member.globalName, member.username].filter(Boolean))];
}

function levenshtein(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }
  return previous[right.length];
}

function similarity(leftValue, rightValue) {
  const left = normalize(leftValue);
  const right = normalize(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const distanceScore = 1 - levenshtein(left, right) / Math.max(left.length, right.length);
  const containmentScore = left.includes(right) || right.includes(left)
    ? Math.min(0.95, Math.min(left.length, right.length) / Math.max(left.length, right.length) + 0.08)
    : 0;
  return Math.max(distanceScore, containmentScore);
}

function loadDatabaseLinks(dbPath) {
  if (!fs.existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(`
      SELECT discord_id, discord_name, albion_name, registration_status
      FROM users
      WHERE albion_name IS NOT NULL AND trim(albion_name) <> ''
    `).all();
  } finally {
    db.close();
  }
}

function chooseMatch(player, members, membersById, linksByAlbion) {
  const playerKey = normalize(player);
  const exact = members.filter((member) => memberNames(member).some((name) => normalize(name) === playerKey));
  if (exact.length === 1) {
    return { status: 'confirmed', method: 'Nome exato no Discord', confidence: 1, member: exact[0] };
  }
  if (exact.length > 1) {
    return { status: 'ambiguous', method: 'Mais de uma conta com nome exato', confidence: 1, member: null, candidates: exact };
  }

  const linked = (linksByAlbion.get(playerKey) || [])
    .map((row) => ({ row, member: membersById.get(String(row.discord_id)) }))
    .filter((item) => item.member);
  if (linked.length === 1) {
    return { status: 'confirmed', method: 'Vínculo confirmado pelo bot', confidence: 1, member: linked[0].member };
  }
  if (linked.length > 1) {
    return { status: 'ambiguous', method: 'Mais de um vínculo ativo no bot', confidence: 1, member: null, candidates: linked.map((item) => item.member) };
  }

  const ranked = members.map((member) => ({
    member,
    score: Math.max(...memberNames(member).map((name) => similarity(player, name)))
  })).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const second = ranked[1];
  const margin = top ? top.score - (second?.score || 0) : 0;
  if (top && top.score >= 0.82 && margin >= 0.08) {
    return {
      status: 'probable',
      method: 'Nome semelhante — revisar',
      confidence: top.score,
      member: top.member
    };
  }

  return {
    status: 'missing',
    method: 'Não encontrado com segurança',
    confidence: top?.score || 0,
    member: null,
    suggestion: top && top.score >= 0.62 ? top.member : null
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatRoles(value) {
  const roles = String(value || '').split(';').filter(Boolean);
  return roles.length ? roles.map((role) => `<span class="role">${escapeHtml(role)}</span>`).join(' ') : '<span class="muted">—</span>';
}

function buildHtml(rows, generatedAt) {
  const counts = rows.reduce((result, row) => {
    result[row.status] += 1;
    return result;
  }, { confirmed: 0, probable: 0, ambiguous: 0, missing: 0 });

  const tableRows = rows.map((row, index) => {
    const member = row.member;
    const display = member ? (member.nickname || member.displayName || member.globalName || member.username) : '—';
    const suggestion = row.candidates?.length
      ? row.candidates.map((candidate) => `${candidate.nickname || candidate.displayName || candidate.globalName || candidate.username} (@${candidate.username})`).join(' | ')
      : !member && row.suggestion
        ? `${row.suggestion.nickname || row.suggestion.displayName || row.suggestion.globalName || row.suggestion.username} (@${row.suggestion.username})`
        : '—';
    const label = row.status === 'confirmed' ? 'Confirmado' : row.status === 'probable' ? 'Provável' : row.status === 'ambiguous' ? 'Ambíguo' : 'Não encontrado';
    return `
      <tr data-status="${row.status}" data-search="${escapeHtml([row.player, display, member?.username, member?.id, suggestion].filter(Boolean).join(' ').toLowerCase())}">
        <td class="index">${index + 1}</td>
        <td><strong>${escapeHtml(row.player)}</strong><div class="sub">${escapeHtml(row.lastSeen)}</div></td>
        <td class="roles">${formatRoles(row.roles)}</td>
        <td>${escapeHtml(display)}${member ? `<div class="sub">@${escapeHtml(member.username)}</div>` : ''}</td>
        <td class="mono">${member ? escapeHtml(member.id) : '—'}</td>
        <td><span class="badge ${row.status}">${label}</span><div class="sub">${escapeHtml(row.method)}</div></td>
        <td>${row.status === 'probable' ? `${Math.round(row.confidence * 100)}%` : row.status === 'confirmed' ? '100%' : '—'}</td>
        <td>${escapeHtml(suggestion)}</td>
      </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Jogadores da guilda no Discord</title>
  <style>
    :root { --bg:#0b1020; --panel:#121a2d; --panel2:#182239; --text:#eef2ff; --muted:#94a3b8; --line:#293651; --accent:#7c9cff; --ok:#2dd4bf; --warn:#fbbf24; --amb:#c084fc; --bad:#fb7185; }
    * { box-sizing:border-box; } body { margin:0; color:var(--text); background:linear-gradient(145deg,#070b15,#10182a 60%,#0b1020); font:14px/1.45 Inter,"Segoe UI",sans-serif; }
    .wrap { width:min(1500px,calc(100% - 28px)); margin:28px auto 50px; }
    header { display:flex; align-items:flex-end; justify-content:space-between; gap:18px; flex-wrap:wrap; margin-bottom:18px; }
    h1 { margin:0; font-size:clamp(26px,4vw,42px); letter-spacing:-.03em; } .lead,.sub,.muted { color:var(--muted); }
    .lead { margin:7px 0 0; } .cards { display:grid; grid-template-columns:repeat(4,minmax(145px,1fr)); gap:12px; margin:18px 0; }
    .card,.toolbar,.table-wrap { background:rgba(18,26,45,.94); border:1px solid var(--line); border-radius:16px; box-shadow:0 16px 40px rgba(0,0,0,.22); }
    .card { padding:15px 17px; } .card span { display:block; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.09em; } .card strong { display:block; font-size:27px; margin-top:3px; }
    .toolbar { display:flex; gap:10px; padding:12px; margin-bottom:14px; flex-wrap:wrap; }
    input,select { min-height:42px; color:var(--text); background:#0d1527; border:1px solid var(--line); border-radius:10px; padding:9px 12px; font:inherit; }
    input { flex:1; min-width:240px; } .table-wrap { overflow:auto; } table { width:100%; border-collapse:collapse; min-width:1180px; }
    th,td { padding:12px 13px; text-align:left; border-bottom:1px solid var(--line); vertical-align:top; } th { position:sticky; top:0; z-index:1; background:var(--panel2); color:#cbd5e1; font-size:11px; text-transform:uppercase; letter-spacing:.07em; }
    tbody tr:hover { background:#172137; } .index { color:var(--muted); width:48px; } .mono { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; }
    .role { display:inline-block; margin:0 3px 4px 0; padding:3px 7px; border-radius:999px; color:#c7d2fe; background:#253154; font-size:11px; }
    .badge { display:inline-block; padding:5px 9px; border-radius:999px; font-weight:800; font-size:11px; } .confirmed { color:#072e2b; background:var(--ok); } .probable { color:#402b02; background:var(--warn); } .ambiguous { color:#2e1065; background:var(--amb); } .missing { color:#3f0712; background:var(--bad); }
    .sub { font-size:12px; margin-top:3px; } .note { max-width:880px; color:var(--muted); margin:14px 2px; } .hidden { display:none; }
    @media (max-width:760px) { .cards { grid-template-columns:repeat(2,1fr); } .wrap { width:min(100% - 16px,1500px); margin-top:16px; } }
  </style>
</head>
<body>
  <main class="wrap">
    <header><div><h1>Jogadores da guilda no Discord</h1><p class="lead">Cruzamento da lista da guilda com os membros atuais do servidor xNOTAGx.</p></div><div class="sub">Gerado em ${escapeHtml(generatedAt)}</div></header>
    <section class="cards">
      <div class="card"><span>Jogadores na lista</span><strong>${rows.length}</strong></div>
      <div class="card"><span>Confirmados</span><strong>${counts.confirmed}</strong></div>
      <div class="card"><span>Prováveis</span><strong>${counts.probable}</strong></div>
      <div class="card"><span>Ambíguos</span><strong>${counts.ambiguous}</strong></div>
      <div class="card"><span>Não encontrados</span><strong>${counts.missing}</strong></div>
    </section>
    <p class="note">“Confirmado” significa nome exato no Discord ou vínculo de personagem registrado no banco do bot com um membro que continua no servidor. Correspondências aproximadas ficam separadas para revisão e não são tratadas como certeza.</p>
    <section class="toolbar"><input id="search" placeholder="Buscar jogador, apelido, usuário ou ID…"><select id="status"><option value="all">Todos os status</option><option value="confirmed">Confirmados</option><option value="probable">Prováveis</option><option value="ambiguous">Ambíguos</option><option value="missing">Não encontrados</option></select><span id="visible" class="sub"></span></section>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Jogador / última vez</th><th>Cargos na guilda</th><th>Discord</th><th>ID do Discord</th><th>Status</th><th>Confiança</th><th>Possível sugestão</th></tr></thead><tbody>${tableRows}</tbody></table></div>
  </main>
  <script>
    const search = document.getElementById('search'); const status = document.getElementById('status'); const visible = document.getElementById('visible'); const rows = [...document.querySelectorAll('tbody tr')];
    function filter() { const query = search.value.trim().toLowerCase(); let count = 0; rows.forEach(row => { const show = (!query || row.dataset.search.includes(query)) && (status.value === 'all' || row.dataset.status === status.value); row.classList.toggle('hidden', !show); if (show) count += 1; }); visible.textContent = count + ' resultado(s)'; }
    search.addEventListener('input', filter); status.addEventListener('change', filter); filter();
  </script>
</body>
</html>`;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const inputPath = path.resolve(process.argv[2]);
  const outputPath = path.resolve(process.argv[3] || 'reports/jogadores-guild-discord.html');
  const guildRows = parseGuildTsv(inputPath);
  const members = parseDiscordTsv(await readStdin());
  const membersById = new Map(members.map((member) => [member.id, member]));
  const linksByAlbion = new Map();
  for (const link of loadDatabaseLinks(path.resolve('data/notag.sqlite'))) {
    const key = normalize(link.albion_name);
    if (!linksByAlbion.has(key)) linksByAlbion.set(key, []);
    linksByAlbion.get(key).push(link);
  }
  const results = guildRows.map((row) => ({ ...row, ...chooseMatch(row.player, members, membersById, linksByAlbion) }));
  const generatedAt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buildHtml(results, generatedAt), 'utf8');
  const counts = results.reduce((acc, row) => { acc[row.status] += 1; return acc; }, { confirmed: 0, probable: 0, ambiguous: 0, missing: 0 });
  console.log(JSON.stringify({ outputPath, guildPlayers: guildRows.length, discordMembers: members.length, ...counts }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
