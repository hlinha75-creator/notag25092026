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

function comparableKeys(value) {
  const key = normalize(value);
  return new Set([key, key.replace(/\d{3,}$/, '')].filter(Boolean));
}

function parseGuildPlayers(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split('\t')[0].replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function parseMembers(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const [id = '', username = '', globalName = '', nickname = '', displayName = '', encodedRoles = ''] = line.split('\t');
    const roles = encodedRoles.split('|').filter(Boolean).map((item) => {
      const separator = item.indexOf('~');
      return { id: item.slice(0, separator), name: decodeURIComponent(item.slice(separator + 1)) };
    });
    return { id, username, globalName, nickname, displayName, roles };
  }).filter((member) => member.id);
}

function names(member) {
  return [...new Set([member.nickname, member.displayName, member.globalName, member.username].filter(Boolean))];
}

function levenshtein(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function similarity(aValue, bValue) {
  const a = normalize(aValue);
  const b = normalize(bValue);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const edit = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const contains = a.includes(b) || b.includes(a) ? Math.min(0.95, Math.min(a.length, b.length) / Math.max(a.length, b.length) + 0.08) : 0;
  return Math.max(edit, contains);
}

function loadLinks() {
  const db = new Database(path.resolve('data/notag.sqlite'), { readonly: true });
  try {
    return db.prepare("SELECT discord_id, albion_name FROM users WHERE albion_name IS NOT NULL AND trim(albion_name) <> ''").all();
  } finally {
    db.close();
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const listPath = path.resolve(process.argv[2]);
  const outputPath = path.resolve(process.argv[3] || 'reports/discord-role-cleanup-plan.json');
  const players = parseGuildPlayers(listPath);
  const members = parseMembers(await readStdin());
  const membersById = new Map(members.map((member) => [member.id, member]));
  const keepIds = new Set();
  const evidence = [];

  const linksByPlayer = new Map();
  for (const link of loadLinks()) {
    const key = normalize(link.albion_name);
    if (!linksByPlayer.has(key)) linksByPlayer.set(key, []);
    linksByPlayer.get(key).push(String(link.discord_id));
  }

  for (const player of players) {
    const playerKey = normalize(player);
    const exact = members.filter((member) => names(member).some((name) => comparableKeys(name).has(playerKey)));
    for (const member of exact) {
      keepIds.add(member.id);
      evidence.push({ player, discordId: member.id, method: 'exact' });
    }
    for (const discordId of linksByPlayer.get(playerKey) || []) {
      if (membersById.has(discordId)) {
        keepIds.add(discordId);
        evidence.push({ player, discordId, method: 'database' });
      }
    }
    if (exact.length || (linksByPlayer.get(playerKey) || []).some((id) => membersById.has(id))) continue;

    const ranked = members.map((member) => ({
      member,
      score: Math.max(...names(member).map((name) => similarity(player, name)))
    })).sort((a, b) => b.score - a.score);
    if (ranked[0]?.score >= 0.82 && ranked[0].score - (ranked[1]?.score || 0) >= 0.08) {
      keepIds.add(ranked[0].member.id);
      evidence.push({ player, discordId: ranked[0].member.id, method: 'strong_fuzzy', score: ranked[0].score });
    }
  }

  const targets = members
    .filter((member) => !keepIds.has(member.id) && member.roles.length)
    .map((member) => ({
      id: member.id,
      username: member.username,
      displayName: member.nickname || member.displayName || member.globalName || member.username,
      roles: member.roles
    }));

  const plan = {
    createdAt: new Date().toISOString(),
    sourceList: listPath,
    guildPlayers: players.length,
    discordHumans: members.length,
    protectedDiscordAccounts: keepIds.size,
    targets: targets.length,
    rolesToRemove: targets.reduce((sum, member) => sum + member.roles.length, 0),
    protectedRoleNames: ['ADM', 'Staff'],
    evidence,
    members: targets
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(plan, null, 2), 'utf8');
  console.log(JSON.stringify({ outputPath, guildPlayers: plan.guildPlayers, discordHumans: plan.discordHumans, protectedDiscordAccounts: plan.protectedDiscordAccounts, targets: plan.targets, rolesToRemove: plan.rolesToRemove }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
