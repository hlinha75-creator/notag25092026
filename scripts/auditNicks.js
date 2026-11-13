require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits } = require('discord.js');
const ids = require('../src/config/ids');

const DEFAULT_LIST_PATH = 'C:\\Users\\Lucas\\Desktop\\lista att nick.txt';
const DEFAULT_THRESHOLD = 0.72;
const APPLY_THRESHOLD = 0.84;

function parseArgs(argv) {
  const args = {
    list: DEFAULT_LIST_PATH,
    threshold: DEFAULT_THRESHOLD,
    apply: false,
    postMissing: false,
    notifyChannel: null
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--apply') args.apply = true;
    else if (arg === '--post-missing') args.postMissing = true;
    else if (arg.startsWith('--list=')) args.list = arg.slice('--list='.length);
    else if (arg.startsWith('--threshold=')) args.threshold = Number(arg.slice('--threshold='.length));
    else if (arg.startsWith('--notify-channel=')) args.notifyChannel = arg.slice('--notify-channel='.length);
    else if (arg === '--help') args.help = true;
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }

  if (!Number.isFinite(args.threshold) || args.threshold < 0 || args.threshold > 1) {
    throw new Error('Use --threshold com valor entre 0 e 1. Ex: --threshold=0.72');
  }

  return args;
}

function printHelp() {
  console.log([
    'Uso:',
    '  npm run audit:nicks',
    '  npm run audit:nicks -- --list="C:\\Users\\Lucas\\Desktop\\lista att nick.txt"',
    '  npm run audit:nicks -- --apply',
    '  npm run audit:nicks -- --post-missing --notify-channel=ID_DO_CANAL',
    '',
    'Por seguranca, sem --apply o script so gera relatorios.',
    'Com --apply, renomeia apenas sugestoes unicas com score alto.'
  ].join('\n'));
}

function readNickList(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const seen = new Set();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .filter((line) => {
      const key = normalize(line);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function displayNameFor(member) {
  return member.nickname || member.displayName || member.user.globalName || member.user.username;
}

function candidateNames(member) {
  return [
    member.nickname,
    member.displayName,
    member.user.globalName,
    member.user.username,
    member.user.tag
  ].filter(Boolean);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length];
}

function similarity(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(0.97, Math.min(left.length, right.length) / Math.max(left.length, right.length) + 0.12);
  }

  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}

function bestMatches(member, guildNicks) {
  const names = candidateNames(member);
  const ranked = guildNicks
    .map((nick) => ({
      nick,
      score: Math.max(...names.map((name) => similarity(name, nick)))
    }))
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, 3);
}

function csvValue(value) {
  const text = String(value ?? '');
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(filePath, rows, headers) {
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(','))
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function chunkLines(lines, maxLength = 1800) {
  const chunks = [];
  let current = [];
  let currentLength = 0;

  for (const line of lines) {
    const nextLength = currentLength + line.length + 1;
    if (current.length && nextLength > maxLength) {
      chunks.push(current.join('\n'));
      current = [];
      currentLength = 0;
    }
    current.push(line);
    currentLength += line.length + 1;
  }

  if (current.length) chunks.push(current.join('\n'));
  return chunks;
}

async function postMissingMembers(guild, channelId, missing) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error(`Canal de aviso invalido ou nao textual: ${channelId}`);

  const lines = missing.map((item) => `<@${item.discord_id}>`);
  const intro = [
    'Pessoal, precisamos corrigir o nick de voces no Discord.',
    'Usem o botao de registro ou /registro novamente e informem o nick exato do Albion.',
    ''
  ];

  for (const chunk of chunkLines([...intro, ...lines])) {
    await channel.send(chunk);
  }
}

async function applyRenames(suggestions) {
  const results = [];
  for (const item of suggestions) {
    if (item.score < APPLY_THRESHOLD || item.is_ambiguous) {
      results.push({ ...item, applied_status: 'skipped_low_score_or_ambiguous' });
      continue;
    }

    const nickname = item.suggested_nick.slice(0, 32);
    await item.member
      .setNickname(nickname, 'Atualizacao automatica autorizada por auditoria de nicks')
      .then(() => results.push({ ...item, applied_status: 'renamed' }))
      .catch((error) => results.push({ ...item, applied_status: `failed: ${error.message}` }));
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN ausente. Preencha o .env antes de rodar.');
  if (args.postMissing && !args.notifyChannel) {
    throw new Error('Para postar os nao encontrados, informe --notify-channel=ID_DO_CANAL.');
  }

  const guildNicks = readNickList(args.list);
  if (!guildNicks.length) throw new Error(`Nenhum nick encontrado na lista: ${args.list}`);

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  await client.login(process.env.DISCORD_TOKEN);

  const guild = await client.guilds.fetch(ids.guildId);
  const members = await guild.members.fetch();
  const humans = [...members.values()].filter((member) => !member.user.bot);

  const suggestions = [];
  const missing = [];
  const exact = [];

  for (const member of humans) {
    const matches = bestMatches(member, guildNicks);
    const top = matches[0];
    const second = matches[1];
    const currentName = displayNameFor(member);
    const ambiguous = second && Math.abs(top.score - second.score) < 0.04;
    const base = {
      discord_id: member.id,
      discord_tag: member.user.tag,
      discord_name: currentName,
      suggested_nick: top?.nick || '',
      score: Number((top?.score || 0).toFixed(3)),
      second_suggestion: second?.nick || '',
      second_score: Number((second?.score || 0).toFixed(3)),
      ambiguous: ambiguous ? 'yes' : 'no',
      is_ambiguous: ambiguous,
      member
    };

    if (top?.score === 1) exact.push(base);
    else if (top?.score >= args.threshold) suggestions.push(base);
    else missing.push(base);
  }

  const outputDir = path.join(process.cwd(), 'reports');
  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suggestionsPath = path.join(outputDir, `nick-suggestions-${stamp}.csv`);
  const missingPath = path.join(outputDir, `nick-missing-${stamp}.csv`);
  const exactPath = path.join(outputDir, `nick-exact-${stamp}.csv`);
  const appliedPath = path.join(outputDir, `nick-applied-${stamp}.csv`);

  const headers = [
    'discord_id',
    'discord_tag',
    'discord_name',
    'suggested_nick',
    'score',
    'second_suggestion',
    'second_score',
    'ambiguous'
  ];
  writeCsv(suggestionsPath, suggestions, headers);
  writeCsv(missingPath, missing, headers);
  writeCsv(exactPath, exact, headers);

  let applied = [];
  if (args.apply) {
    applied = await applyRenames(suggestions);
    writeCsv(appliedPath, applied, [...headers, 'applied_status']);
  }

  if (args.postMissing) {
    await postMissingMembers(guild, args.notifyChannel, missing);
  }

  console.log(`Servidor: ${guild.name} (${guild.id})`);
  console.log(`Nicks na lista: ${guildNicks.length}`);
  console.log(`Membros humanos no Discord: ${humans.length}`);
  console.log(`Exatos: ${exact.length}`);
  console.log(`Sugestoes para revisar: ${suggestions.length}`);
  console.log(`Nao encontrados: ${missing.length}`);
  console.log('');
  console.log(`Sugestoes: ${suggestionsPath}`);
  console.log(`Nao encontrados: ${missingPath}`);
  console.log(`Ja corretos/exatos: ${exactPath}`);
  if (args.apply) console.log(`Resultado dos renomes: ${appliedPath}`);
  if (!args.apply) console.log('\nNada foi renomeado. Para aplicar sugestoes fortes e nao ambiguas: npm run audit:nicks -- --apply');
  if (!args.postMissing) {
    console.log('Nada foi postado no chat. Para avisar nao encontrados: npm run audit:nicks -- --post-missing --notify-channel=ID_DO_CANAL');
  }

  await client.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
