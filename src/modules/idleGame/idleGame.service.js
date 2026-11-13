const { joinVoiceChannel, entersState, VoiceConnectionStatus, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const { execFileSync } = require('child_process');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const env = require('../../config/env');
const eventRepo = require('../events/events.repository');
const repo = require('./idleGame.repository');

const TICK_SECONDS = 10;
const BASE_POINTS_PER_TICK = 1;
let client;
let connection;
let activeChannel;
let tickTimer;
let refreshTimer;
let serviceStarted = false;
const audioPlayer = createAudioPlayer();
let lastBuchaSpeechAt = 0;
const BUCHA_COOLDOWN_MS = 15_000;

function nowIso() { return new Date().toISOString(); }
function displayName(member) { return member?.displayName || member?.user?.globalName || member?.user?.username || member?.id; }
function isHost(userId) { return env.idleHostUserIds.includes(userId); }
function eligibleMembers(channel) { return [...channel.members.values()].filter((m) => !m.user.bot && !isHost(m.id)); }
function runningEventBonus(channelId, userId) {
  const event = eventRepo.getEventByVoiceChannel(channelId);
  const participant = event && eventRepo.getParticipant({ eventId: event.id, discordId: userId });
  return Boolean(participant && !participant.is_spectator && !participant.is_paused);
}

async function postSessionMessage(session, channel) {
  if (!channel?.isTextBased()) return;
  const message = await channel.send({ content: [
    '🧘 **Estacao de Foco iniciada**',
    '',
    'Fique com o microfone mutado para produzir. Ao falar, sua producao entra em resfriamento por pelo menos 1 minuto.',
    `Dashboard e historico: <#${env.idleTopicId}>`
  ].join('\n') }).catch(() => null);
  if (message) repo.setMessageId(session.id, message.id);
}

async function cleanupLiveDashboards(topic) {
  const messages = await topic.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return;
  const stale = messages.filter((message) => {
    if (message.author.id !== client.user.id) return false;
    const isDashboard = message.embeds.some((embed) => String(embed.title || '').includes('Estacao de Foco'));
    const isLegacySummary = /sess[aã]o encerrada/i.test(String(message.content || ''));
    return isDashboard || isLegacySummary;
  });
  for (const message of stale.values()) await message.delete().catch(() => {});
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function discordDashboardEmbed(session, ended = false) {
  const players = repo.listParticipation(session.id);
  const online = players.filter((player) => activeChannel?.members.has(player.discord_id));
  const totalPoints = players.reduce((sum, player) => sum + Number(player.points || 0), 0);
  const totalFocus = players.reduce((sum, player) => sum + Number(player.focus_seconds || 0), 0);
  const crew = online.slice(0, 12).map((player) => {
    const member = activeChannel?.members.get(player.discord_id);
    const muted = member?.voice.selfMute || member?.voice.serverMute;
    const cooldown = Math.max(0, Math.ceil((Date.parse(player.penalty_until || 0) - Date.now()) / 1000));
    const status = cooldown > 0 ? `🟠 resfriando ${cooldown}s` : muted ? '🟢 farm ativo' : '⚪ microfone aberto';
    return `<@${player.discord_id}> — **${Math.floor(player.points)} pts** · ${status}${player.event_bonus ? ' · ✦ 1,5x' : ''}`;
  }).join('\n') || 'Nenhum tripulante farmando agora.';
  const ranking = repo.leaderboard(8).map((player, index) => `${index + 1}. **${player.discord_name || player.discord_id}** — ${Math.floor(player.total_points)} pts`).join('\n') || 'O ranking comeca na primeira sessao.';
  return new EmbedBuilder()
    .setColor(ended ? 0x64748b : 0x66f2ad)
    .setTitle(`${ended ? '🏁' : '🧘'} Estacao de Foco ${ended ? 'encerrada' : 'online'}`)
    .setDescription(`**${session.voice_channel_name || 'Call de voz'}**\nSilencio gera energia. Presenca constroi progresso.`)
    .addFields(
      { name: '👥 Tripulacao', value: String(online.length), inline: true },
      { name: '⏱️ Foco acumulado', value: formatDuration(totalFocus), inline: true },
      { name: '⚡ Energia gerada', value: `${Math.floor(totalPoints)} pontos`, inline: true },
      { name: '📡 Tempo real', value: crew },
      { name: '🏆 Maiores produtores', value: ranking },
      { name: '⚙️ Regras', value: 'Mutado: farm ativo · Falou: resfriamento progressivo · Evento inscrito: 1,5x' }
    )
    .setFooter({ text: ended ? 'Sessao finalizada' : 'Atualizacao automatica a cada 10 segundos' })
    .setTimestamp();
}

async function refreshDiscordDashboard(session = repo.getRunningSession(), ended = false) {
  if (!session || !client) return;
  const topic = await client.channels.fetch(env.idleTopicId).catch(() => null);
  if (!topic?.isTextBased()) return;
  const payload = { embeds: [discordDashboardEmbed(session, ended)] };
  let message = session.topic_message_id ? await topic.messages.fetch(session.topic_message_id).catch(() => null) : null;
  if (message) await message.edit(payload);
  else {
    if (!ended) await cleanupLiveDashboards(topic);
    message = await topic.send(payload);
    repo.setTopicMessageId(session.id, message.id);
  }
}

async function archiveDiscordDashboard(session) {
  if (!client) return;
  const archive = await client.channels.fetch(env.idleArchiveTopicId).catch(() => null);
  if (archive?.isTextBased()) {
    await archive.send({ embeds: [discordDashboardEmbed(session, true)] });
  } else {
    console.error(`Topico de arquivo da estacao indisponivel: ${env.idleArchiveTopicId}`);
  }
  const liveTopic = await client.channels.fetch(env.idleTopicId).catch(() => null);
  const liveMessage = session.topic_message_id && liveTopic?.isTextBased()
    ? await liveTopic.messages.fetch(session.topic_message_id).catch(() => null)
    : null;
  if (liveMessage) await liveMessage.delete().catch(() => {});
}

async function connectTo(channel) {
  if (activeChannel?.id === channel.id && connection) return;
  if (connection) connection.destroy();
  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true
  });
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  connection.receiver.speaking.on('start', handleSpeaking);
  connection.subscribe(audioPlayer);
}

function pcmFromWav(buffer) {
  const marker = buffer.indexOf(Buffer.from('data'));
  if (marker < 0 || marker + 8 > buffer.length) throw new Error('Audio WAV sem bloco de dados.');
  const size = buffer.readUInt32LE(marker + 4);
  return buffer.subarray(marker + 8, Math.min(buffer.length, marker + 8 + size));
}

function createLocalSpeech(text) {
  const packagedAudioPath = path.resolve('resources', 'audio', 'bucha.wav');
  if (fs.existsSync(packagedAudioPath)) return pcmFromWav(fs.readFileSync(packagedAudioPath));
  const cacheDir = path.resolve('data', 'idle-audio');
  const audioPath = path.join(cacheDir, 'bucha-voce.wav');
  if (!fs.existsSync(audioPath)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const safePath = audioPath.replace(/'/g, "''");
    const safeText = text.replace(/'/g, "''");
    const script = [
      "$voice = New-Object -ComObject SAPI.SpVoice",
      "$stream = New-Object -ComObject SAPI.SpFileStream",
      "$format = New-Object -ComObject SAPI.SpAudioFormat",
      '$format.Type = 39',
      `$stream.Format = $format`,
      `$stream.Open('${safePath}', 3, $false)`,
      '$voice.AudioOutputStream = $stream',
      `$voice.Speak('${safeText}') | Out-Null`,
      '$stream.Close()'
    ].join('; ');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  }
  return pcmFromWav(fs.readFileSync(audioPath));
}

async function speak(text) {
  if (!connection || !activeChannel) return false;
  try {
    const me = activeChannel.guild.members.me;
    if (!me || !activeChannel.permissionsFor(me)?.has('Speak')) {
      console.error(`O bot nao tem permissao Falar na call ${activeChannel.name}.`);
      return false;
    }
    const pcm = createLocalSpeech(text);
    if (!connection.rejoin({ selfDeaf: false, selfMute: false })) throw new Error('Nao foi possivel liberar a voz do bot.');
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    audioPlayer.play(createAudioResource(Readable.from(pcm), { inputType: StreamType.Raw }));
    return true;
  } catch (error) {
    console.error('Falha ao falar na estacao de foco:', error);
    return false;
  }
}

audioPlayer.on(AudioPlayerStatus.Idle, () => {
  if (connection) connection.rejoin({ selfDeaf: false, selfMute: true });
});
audioPlayer.on('error', (error) => console.error('Erro no audio da estacao de foco:', error));

function handleMessage(message) {
  if (!activeChannel || message.author?.bot || message.channelId !== activeChannel.id) return false;
  if (!String(message.content || '').toLocaleLowerCase('pt-BR').includes('bucha')) return false;
  const now = Date.now();
  if (now - lastBuchaSpeechAt < BUCHA_COOLDOWN_MS || audioPlayer.state.status !== AudioPlayerStatus.Idle) return false;
  lastBuchaSpeechAt = now;
  speak('Você são tudo bucha.');
  return true;
}

async function startSession(channel) {
  repo.endRunningSessions(nowIso());
  const activeHost = [...channel.members.values()].find((member) => isHost(member.id));
  const session = repo.startSession({ guildId: channel.guild.id, channelId: channel.id, channelName: channel.name, hostId: activeHost?.id || env.idleHostUserIds[0], startedAt: nowIso() });
  activeChannel = channel;
  for (const member of eligibleMembers(channel)) repo.joinPlayer({ sessionId: session.id, discordId: member.id, discordName: displayName(member), joinedAt: nowIso(), eventBonus: runningEventBonus(channel.id, member.id) });
  await connectTo(channel);
  await postSessionMessage(session, channel);
  await refreshDiscordDashboard(session);
}

async function stopSession() {
  const session = repo.getRunningSession();
  if (!session) return;
  repo.endRunningSessions(nowIso());
  await archiveDiscordDashboard(session);
  if (connection) connection.destroy();
  connection = null;
  activeChannel = null;
}

async function syncHost() {
  if (!client) return;
  const guild = client.guilds.cache.get(require('../../config/ids').guildId);
  let channel = env.idleHostUserIds.map((id) => guild?.members.cache.get(id)?.voice?.channel).find(Boolean);
  if (!channel) {
    for (const id of env.idleHostUserIds) {
      const host = await guild?.members.fetch(id).catch(() => null);
      if (host?.voice?.channel) { channel = host.voice.channel; break; }
    }
  }
  if (!channel) return stopSession();
  if (activeChannel?.id !== channel.id || !repo.getRunningSession()) await startSession(channel);
}

function handleSpeaking(userId) {
  const session = repo.getRunningSession();
  if (!session || !activeChannel?.members.has(userId) || isHost(userId)) return;
  const member = activeChannel.members.get(userId);
  if (member?.user.bot) return;
  repo.joinPlayer({ sessionId: session.id, discordId: userId, discordName: displayName(member), joinedAt: nowIso(), eventBonus: runningEventBonus(activeChannel.id, userId) });
  const now = new Date();
  const count = repo.recentSpeechCount(session.id, userId, new Date(now.getTime() - 5 * 60_000).toISOString());
  const penaltySeconds = Math.min(600, 60 + count * 30);
  repo.addSpeech({ sessionId: session.id, discordId: userId, penaltySeconds, penaltyUntil: new Date(now.getTime() + penaltySeconds * 1000).toISOString(), occurredAt: now.toISOString() });
}

function farmTick() {
  const session = repo.getRunningSession();
  if (!session || !activeChannel) return;
  const members = eligibleMembers(activeChannel);
  const multiplier = 1 + Math.min(1, Math.max(0, members.length - 1) * 0.1);
  const now = Date.now();
  for (const member of members) {
    try {
      const eventBonus = runningEventBonus(activeChannel.id, member.id);
      repo.joinPlayer({ sessionId: session.id, discordId: member.id, discordName: displayName(member), joinedAt: nowIso(), eventBonus });
      const player = repo.listParticipation(session.id).find((p) => p.discord_id === member.id);
      const muted = member.voice.selfMute || member.voice.serverMute;
      const penalized = player?.penalty_until && Date.parse(player.penalty_until) > now;
      if (muted && !penalized) repo.addFarm({ sessionId: session.id, discordId: member.id, seconds: TICK_SECONDS, points: BASE_POINTS_PER_TICK * multiplier * (eventBonus ? 1.5 : 1) });
    } catch (error) {
      console.error(`Falha ao farmar para ${member.id}:`, error);
    }
  }
  refreshDiscordDashboard(session).catch((error) => console.error('Falha ao atualizar dashboard Discord:', error));
}

async function handleVoiceStateUpdate(oldState, newState) {
  if (isHost(newState.id) || isHost(oldState.id)) await syncHost();
  const session = repo.getRunningSession();
  if (!session) return;
  const userId = newState.id || oldState.id;
  if (newState.channelId === session.voice_channel_id && !newState.member.user.bot && !isHost(userId)) {
    repo.joinPlayer({ sessionId: session.id, discordId: userId, discordName: displayName(newState.member), joinedAt: nowIso(), eventBonus: runningEventBonus(session.voice_channel_id, userId) });
  } else if (oldState.channelId === session.voice_channel_id && newState.channelId !== session.voice_channel_id) repo.leavePlayer(session.id, userId, nowIso());
}

function getDashboardState() {
  const session = repo.getRunningSession();
  const participants = session ? repo.listParticipation(session.id).map((p) => {
    const member = activeChannel?.members.get(p.discord_id);
    const penaltySeconds = Math.max(0, Math.ceil((Date.parse(p.penalty_until || 0) - Date.now()) / 1000));
    return { ...p, online: Boolean(member), muted: Boolean(member?.voice.selfMute || member?.voice.serverMute), penaltySeconds };
  }) : [];
  return { online: Boolean(session), session, participants, leaderboard: repo.leaderboard(), recentSessions: repo.listRecentSessions(), config: { tickSeconds: TICK_SECONDS, basePoints: BASE_POINTS_PER_TICK, port: env.dashboardPort } };
}

async function start(discordClient) {
  client = discordClient;
  if (serviceStarted) return;
  serviceStarted = true;
  tickTimer = setInterval(() => {
    try { farmTick(); } catch (error) { console.error('Falha no ciclo de farm:', error); }
  }, TICK_SECONDS * 1000);
  refreshTimer = setInterval(() => {
    syncHost().catch((error) => console.error('Falha ao sincronizar anfitriao da estacao:', error));
  }, 30_000);
  try {
    await syncHost();
    farmTick();
  } catch (error) {
    console.error('Primeira conexao da estacao falhou; o bot tentara novamente automaticamente:', error.message);
  }
}

module.exports = { start, stopSession, handleVoiceStateUpdate, handleMessage, getDashboardState, handleSpeaking, farmTick, speak, createLocalSpeech, discordDashboardEmbed, refreshDiscordDashboard, archiveDiscordDashboard, cleanupLiveDashboards };
