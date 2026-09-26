const {
  Client,
  GatewayIntentBits,
  Partials
} = require('discord.js');
const env = require('./config/env');
const ids = require('./config/ids');
const commandDefinitions = require('./commands/definitions');
const { migrate } = require('./database/migrate');
const { backupDatabase } = require('./database/backup');
const registration = require('./modules/registration/registration.service');
const voice = require('./modules/voice/voice.service');
const events = require('./modules/events/events.service');
const guildVerification = require('./modules/albion/guildVerification.service');
const dailyPveRanking = require('./modules/albion/dailyPveRanking.service');
const killFeed = require('./modules/albion/killFeed.service');
const guildKillboard = require('./modules/albion/guildKillboard.service');
const balanceBackup = require('./modules/csv/balanceBackup.service');
const operations = require('./modules/operations/operations.service');
const mandatoryRules = require('./modules/operations/mandatoryRules.service');
const { startResourceMonitor } = require('./modules/operations/resourceMonitor');
const campaigns = require('./modules/campaigns/campaigns.service');
const guildReverification = require('./modules/members/guildReverification.service');
const activityRoles = require('./modules/members/activityRoles.service');
const memberOnboarding = require('./modules/tutorials/memberOnboarding.service');
const springHideout = require('./modules/community/springHideout.service');
const giveaways = require('./modules/giveaways/giveaways.service');
const massRaffle = require('./modules/giveaways/massRaffle.service');
const constantPlayersRaffle = require('./modules/giveaways/constantPlayersRaffle.service');
const seasonAnnouncement = require('./modules/albion/seasonAnnouncement.service');
const missions = require('./modules/missions/missions.service');
const wtb = require('./modules/marketplace/wtb.service');
const contentPreview = require('./modules/events/contentPreview.service');
const { startWebServer } = require('./web/server');
const { handleInteraction } = require('./interactions/router');
const { isExpiredOrDuplicateInteraction } = require('./utils/interactions');
const { runTasks, scheduleTaskGroups } = require('./runtime/taskScheduler');

function backgroundTask(run, errorMessage) {
  return { run, errorMessage };
}

migrate();
backupDatabase('startup');
startResourceMonitor();

const recovered = voice.markRunningEventsForReview();
if (recovered > 0) {
  console.log(`${recovered} evento(s) em andamento marcados como precisam de revisao apos reinicio.`);
}
const closedVoiceSessions = voice.closeOpenVoiceSessionsOnStartup();
if (closedVoiceSessions > 0) {
  console.log(`${closedVoiceSessions} sessao(oes) de voz fechada(s) apos reinicio do bot.`);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

client.once('clientReady', () => {
  console.log(`Notag bot online como ${client.user.tag}`);
  client.application.commands.set(commandDefinitions, ids.guildId)
    .then(() => console.log(`Comandos slash sincronizados na guild ${ids.guildId}.`))
    .catch((error) => console.error('Falha ao sincronizar comandos slash:', error));
  const resumedVoiceSessions = voice.resumeCurrentVoiceSessions(client);
  if (resumedVoiceSessions > 0) {
    console.log(`${resumedVoiceSessions} sessao(oes) de voz retomada(s) apos reinicio do bot.`);
  }
  for (const guild of client.guilds.cache.values()) {
    const botVoice = guild.members.me?.voice;
    if (botVoice?.channelId) {
      botVoice.disconnect('O bot nao deve permanecer em canais de voz').catch((error) => {
        console.error(`Falha ao retirar o bot da call no servidor ${guild.id}:`, error);
      });
    }
  }
  events.cleanupExpiredReviewChannels(client).catch((error) => console.error('Falha ao limpar canais de revisao:', error));
  events.cleanupInactiveEventVoiceChannels(client)
    .then((result) => {
      if (result.deleted > 0 || result.failed > 0) {
        console.log(`[EVENTOS] Salas de voz antigas: ${result.deleted} excluida(s), ${result.occupied} ocupada(s), ${result.failed} falha(s).`);
      }
    })
    .catch((error) => console.error('Falha ao limpar salas de voz antigas:', error));
  events.recoverRunningEventsOnStartup(client)
    .then(async (result) => {
      if (result.checked > 0) {
        console.log(`[EVENTOS] Em andamento recuperados: ${result.restored}/${result.checked}; ${result.sessions} sessao(oes) retomada(s); ${result.failed} falha(s).`);
      }
      const eventIds = await events.repairMisroutedEventPublications(client);
      if (eventIds.length > 0) console.log(`[EVENTOS] Publicacoes movidas para ping-content: ${eventIds.length}.`);
    })
    .catch((error) => console.error('Falha ao recuperar eventos em andamento:', error));
  events.recoverInterruptedEventReviews(client)
    .then((result) => {
      if (result.checked > 0) {
        console.log(`[EVENTOS] Revisoes verificadas no inicio: ${result.recovered}/${result.checked}; ${result.failed} falha(s).`);
      }
      return events.reconcileEventWorkflowMessages(client);
    })
    .then((result) => {
      if (result.checked > 0) {
        console.log(`[EVENTOS] Mensagens sincronizadas no inicio: ${result.review} revisao, ${result.finance} financeiro, ${result.failed} falha(s).`);
      }
    })
    .catch((error) => console.error('Falha ao reconciliar mensagens de eventos:', error));
  void runTasks([
    backgroundTask(() => balanceBackup.postDailyBackupIfNeeded(client), 'Falha ao postar backup diario de saldos:'),
    backgroundTask(() => campaigns.refreshActiveCampaignProgress(client), 'Falha ao atualizar progresso da campanha:'),
    backgroundTask(() => campaigns.processExpiredEventPayouts(client), 'Falha ao processar escolhas vencidas da campanha:'),
    backgroundTask(() => guildVerification.processIdentificationNoticeQueue(client), 'Falha ao processar avisos de regularizacao:'),
    backgroundTask(() => guildReverification.postReminderIfNeeded(client), 'Falha ao processar verificacao da guilda:'),
    backgroundTask(() => activityRoles.reconcileActivityRoles(client), 'Falha ao sincronizar cargos NOVO e CORE:'),
    backgroundTask(() => killFeed.pollKillFeed(client), 'Falha ao consultar killfeed:'),
    backgroundTask(() => missions.processDueReminders(client), 'Falha ao processar lembretes de missoes:'),
    backgroundTask(() => contentPreview.disableOpenPreviews(client), 'Falha ao remover previa de conteudos desativada:'),
    backgroundTask(() => mandatoryRules.enforceIfVoiceQuiet(client), 'Falha ao aplicar confirmação das novas regras:'),
    backgroundTask(() => mandatoryRules.updateAnnouncementMessage(client), 'Falha ao atualizar o aviso das novas regras:')
  ]);

  scheduleTaskGroups([
    {
      intervalMs: 60000,
      tasks: [
        backgroundTask(() => events.refreshRunningEventMessages(client), 'Falha ao atualizar eventos em andamento:'),
        backgroundTask(() => events.cleanupInactiveEventVoiceChannels(client), 'Falha ao limpar salas de voz antigas:'),
        backgroundTask(() => mandatoryRules.enforceIfVoiceQuiet(client), 'Falha ao aplicar confirmação das novas regras:')
      ]
    },
    { intervalMs: 30000, tasks: [backgroundTask(() => events.checkEventStartWarnings(client), 'Falha ao verificar avisos de eventos:')] },
    { intervalMs: 30000, tasks: [backgroundTask(() => giveaways.processDueGiveaways(client), 'Falha ao processar sorteios:')] },
    { intervalMs: 60000, tasks: [backgroundTask(() => massRaffle.processNotifications(client), 'Falha ao processar avisos do sorteio em massa:')] },
    { intervalMs: 10000, tasks: [backgroundTask(() => constantPlayersRaffle.process(client), 'Falha ao processar o sorteio de jogadores constantes:')] },
    { intervalMs: 60000, tasks: [backgroundTask(() => missions.processDueReminders(client), 'Falha ao processar lembretes de missoes:')] },
    { intervalMs: 30000, tasks: [backgroundTask(() => killFeed.pollKillFeed(client), 'Falha ao consultar killfeed:')] },
    { intervalMs: 10 * 60 * 1000, tasks: [backgroundTask(() => campaigns.processExpiredEventPayouts(client), 'Falha ao processar escolhas vencidas da campanha:')] },
    { intervalMs: 10 * 60 * 1000, tasks: [backgroundTask(() => campaigns.refreshActiveCampaignProgress(client), 'Falha ao atualizar progresso da campanha:')] },
    { intervalMs: 10 * 60 * 1000, tasks: [backgroundTask(() => guildVerification.processIdentificationNoticeQueue(client), 'Falha ao processar avisos de regularizacao:')] },
    { intervalMs: 60 * 60 * 1000, tasks: [backgroundTask(() => events.cleanupExpiredReviewChannels(client), 'Falha ao limpar canais de revisao:')] },
    {
      intervalMs: 60 * 60 * 1000,
      tasks: [
        backgroundTask(() => balanceBackup.postDailyBackupIfNeeded(client), 'Falha ao postar backup diario de saldos:'),
        backgroundTask(() => operations.postDailyAdminReportIfNeeded(client), 'Falha ao enviar relatorio diario ADM:'),
        backgroundTask(() => dailyPveRanking.postDailyPveRankingIfNeeded(client), 'Falha ao publicar Top 5 PvE:'),
        backgroundTask(() => dailyPveRanking.postWeeklyRankingIfNeeded(client), 'Falha ao publicar ranking semanal de fama:')
      ]
    },
    {
      intervalMs: 60 * 60 * 1000,
      tasks: [
        backgroundTask(() => guildReverification.postReminderIfNeeded(client), 'Falha ao processar verificacao da guilda:'),
        backgroundTask(() => activityRoles.reconcileActivityRoles(client), 'Falha ao sincronizar cargos NOVO e CORE:')
      ]
    }
  ]);
});

client.on('error', (error) => {
  if (isExpiredOrDuplicateInteraction(error)) return;
  console.error('Erro no client Discord:', error);
});

const webServer = startWebServer(client);

client.on('guildMemberAdd', registration.handleGuildMemberAdd);
client.on('guildMemberAdd', (member) => {
  activityRoles.handleGuildMemberAdd(member).catch((error) => console.error('Falha ao aplicar cargo NOVO:', error));
  memberOnboarding.sendWelcomeGuide(member).catch((error) => console.error('Falha ao enviar guia inicial:', error));
});
client.on('guildMemberRemove', registration.handleGuildMemberRemove);
client.on('guildMemberUpdate', (oldMember, newMember) => {
  mandatoryRules.handleMemberUpdate(oldMember, newMember).catch((error) => console.error('Falha ao proteger o cargo Membro pelas regras:', error));
});
client.on('voiceStateUpdate', voice.handleVoiceStateUpdate);
client.on('voiceStateUpdate', (_oldState, newState) => {
  mandatoryRules.enforceIfVoiceQuiet(newState.client).catch((error) => console.error('Falha ao verificar calls para as novas regras:', error));
});
client.on('voiceStateUpdate', (_oldState, newState) => {
  if (newState.id !== client.user.id || !newState.channelId) return;
  newState.disconnect('O bot nao deve permanecer em canais de voz').catch((error) => {
    console.error(`Falha ao retirar o bot da call no servidor ${newState.guild.id}:`, error);
  });
});
client.on('interactionCreate', handleInteraction);
client.on('messageCreate', (message) => {
  guildVerification.handleDirectNickReply(message).catch((error) => console.error('Falha ao tratar resposta de nick por DM:', error));
  missions.handleMissionMessage(message).catch((error) => console.error('Falha ao transformar mensagem em missao:', error));
  wtb.handleOrderMessage(message).catch((error) => console.error('Falha ao transformar mensagem em anuncio do marketplace:', error));
  mandatoryRules.handleStaffMessage(message).catch((error) => console.error('Falha ao publicar aviso obrigatório:', error));
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('exit', (code) => {
  console.log(`[PROCESSO] Encerrando com codigo ${code}.`);
});

let shuttingDown = false;
function handleShutdownSignal(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.warn(`[PROCESSO] Sinal ${signal} recebido; encerrando conexao com o Discord.`);
  const forceExit = setTimeout(() => process.exit(0), 1500);
  webServer.close();
  Promise.resolve(client.destroy())
    .catch((error) => console.error('[PROCESSO] Falha no encerramento do client Discord:', error))
    .finally(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
}

process.once('SIGTERM', () => handleShutdownSignal('SIGTERM'));
process.once('SIGINT', () => handleShutdownSignal('SIGINT'));

client.login(env.requireEnv('DISCORD_TOKEN')).catch((error) => {
  console.error('Falha ao conectar o bot ao Discord:', error);
  webServer.close();
  process.exit(1);
});
