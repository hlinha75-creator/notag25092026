const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const { getDatabase } = require('../../database/connection');
const { formatSilver } = require('../../utils/silver');
const { safeSend } = require('../../utils/discord');
const seasonPoints = require('../albion/seasonPoints.service');


function panelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Painel do Membro')
        .setDescription('Consultas rapidas, atendimento com staff, sugestoes e historico pessoal.')
        .setColor(0x38a169)
    ],
    components: panelComponents()
  };
}

function panelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('member_panel:points_season').setLabel('Pontos temporada').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('member_panel:history').setLabel('Meu historico').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('member_panel:ask_staff').setLabel('Perguntar staff').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('member_panel:report').setLabel('Denuncia anonima').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('member_panel:suggestion').setLabel('Sugestao').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('member_panel:chat_bot').setLabel('Conversar com bot').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('member_panel:channels').setLabel('Ver/Ocultar').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function pointsEmbed(userId, kind) {
  const user = getUser(userId);
  const lookupName = user?.albion_name || '';
  const title = kind === 'season' ? 'Pontos de temporada' : 'Pontos de influencia';

  if (!lookupName) {
    return baseEmbed(title)
      .setDescription('Voce ainda nao tem nick Albion registrado no bot. Use o painel de registro primeiro.');
  }

  if (kind === 'season') {
    const ranking = seasonPoints.calculateSeasonRanking();
    const player = seasonPoints.findSeasonPlayer(lookupName);
    if (!player) {
      return baseEmbed(title)
        .setDescription(`Nao encontrei **${lookupName}** no snapshot Ouro da Temporada ${ranking.season}.`);
    }
    return baseEmbed(`${title} - Temporada ${ranking.season}`)
      .setDescription([
        `Estimativa Black para **${player.name}** no snapshot **${ranking.snapshotLabel}**.`,
        'Formula: pontos da categoria x contribuicao do jogador / total da categoria.'
      ].join('\n'))
      .addFields(
        { name: 'Rank estimado', value: `#${player.rank}`, inline: true },
        { name: 'Total estimado', value: numberText(player.totalPoints), inline: true },
        { name: 'Coleta', value: ranking.capturedAt.split('-').reverse().join('/'), inline: true },
        {
          name: 'Destaques',
          value: player.categories.slice(0, 5)
            .map((category) => `${category.label}: ${numberText(category.points)} pts`)
            .join('\n') || 'Sem detalhes.',
          inline: false
        },
        {
          name: 'Observacao',
          value: 'Totais abreviados em k/m geram pequena margem de arredondamento. O trecho 40-50 do Guild Challenge ainda nao estava nas capturas.',
          inline: false
        }
      );
  }

  return baseEmbed(title)
    .setDescription('A consulta histórica de influência da Temporada 32 foi arquivada. Use **Pontos temporada** para o ciclo atual.');
}

function historyEmbed(userId) {
  const stats = memberStats(userId);
  return baseEmbed('Meu historico')
    .addFields(
      { name: 'Eventos participados', value: String(stats.events), inline: true },
      { name: 'Tempo em eventos', value: formatDuration(stats.eventSeconds), inline: true },
      { name: 'Tempo em voz', value: formatDuration(stats.voiceSeconds), inline: true },
      { name: 'Saldo acumulado', value: formatSilver(stats.earnedSilver), inline: true },
      { name: 'Saldo atual', value: formatSilver(stats.currentBalance), inline: true }
    );
}

function channelsEmbed() {
  return baseEmbed('Canais importantes')
    .setDescription('Por enquanto eu nao vou alterar permissoes automaticamente. Use os atalhos abaixo para navegar pelos canais principais.')
    .addFields({
      name: 'Atalhos',
      value: ids.importantChannels.map((channelId) => `<#${channelId}>`).join('\n'),
      inline: false
    });
}

async function sendMemberQuestion({ client, user, text }) {
  return safeSend(client, ids.channels.memberRequests, {
    content: `Pergunta de <@${user.id}>`,
    embeds: [requestEmbed('Pergunta para staff', text, user)],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`member_panel_staff:answer:${user.id}`).setLabel('Responder membro').setStyle(ButtonStyle.Primary)
      )
    ]
  });
}

async function sendAnonymousReport({ client, text }) {
  return safeSend(client, ids.channels.memberRequests, {
    embeds: [requestEmbed('Denuncia anonima', text, null).setColor(0xe53e3e)]
  });
}

async function sendSuggestion({ client, user, text, anonymous }) {
  return safeSend(client, ids.channels.memberRequests, {
    content: anonymous ? 'Sugestao anonima' : `Sugestao de <@${user.id}>`,
    embeds: [requestEmbed(anonymous ? 'Sugestao anonima' : 'Sugestao', text, anonymous ? null : user)]
  });
}

async function handleBotConversation({ client, user, text }) {
  const answer = keywordAnswer(text);
  if (answer) return { answered: true, answer };

  await safeSend(client, ids.channels.memberRequests, {
    content: `Pergunta nao respondida pelo bot: <@${user.id}>`,
    embeds: [requestEmbed('Atualizar FAQ do bot', text, user)]
  });
  return {
    answered: false,
    answer: 'Ainda nao sei responder isso. Enviei sua pergunta para a staff atualizar minhas respostas.'
  };
}

async function answerMember({ client, staffUser, targetUserId, answer }) {
  const user = await client.users.fetch(targetUserId).catch(() => null);
  if (!user) throw new Error('Nao consegui encontrar o membro para responder.');
  await user.send(`Resposta da staff NOTAG:\n${answer}`);
  return safeSend(client, ids.channels.memberRequests, {
    content: `Resposta enviada para <@${targetUserId}> por <@${staffUser.id}>.`
  });
}

function memberStats(userId) {
  const db = getDatabase();
  const eventRows = db.prepare(`
    SELECT event_id, COALESCE(manual_seconds, calculated_seconds, 0) AS seconds
    FROM event_participants
    WHERE discord_id = ? AND COALESCE(is_spectator, 0) = 0
  `).all(userId);
  const voice = db.prepare('SELECT COALESCE(SUM(seconds), 0) AS seconds FROM voice_sessions WHERE discord_id = ?').get(userId);
  const earned = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM balance_transactions WHERE user_id = ? AND amount > 0').get(userId);
  const balance = db.prepare('SELECT COALESCE(balance, 0) AS balance FROM balances WHERE discord_id = ?').get(userId);
  return {
    events: new Set(eventRows.map((row) => row.event_id)).size,
    eventSeconds: eventRows.reduce((sum, row) => sum + Number(row.seconds || 0), 0),
    voiceSeconds: Number(voice?.seconds || 0),
    earnedSilver: Number(earned?.total || 0),
    currentBalance: Number(balance?.balance || 0)
  };
}

function getUser(userId) {
  return getDatabase().prepare('SELECT * FROM users WHERE discord_id = ?').get(userId);
}

function keywordAnswer(text) {
  const value = normalize(text);
  if (value.includes('saldo')) return 'Use o painel de saldo ou clique em Meu historico para ver saldo atual e acumulado.';
  if (value.includes('registro') || value.includes('nick')) return 'Use o canal de registro para informar seu nick do Albion.';
  if (value.includes('evento')) return 'Os eventos ficam no canal ping-main. Clique em participar, assistir ou aguarde o caller iniciar.';
  if (value.includes('ponto')) return 'Use o botão Pontos temporada para consultar o ciclo atual.';
  return null;
}

function requestEmbed(title, text, user) {
  const embed = baseEmbed(title)
    .setDescription(String(text || '').slice(0, 3900));
  if (user) embed.addFields({ name: 'Autor', value: `<@${user.id}>`, inline: true });
  return embed;
}

function baseEmbed(title) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0x38a169)
    .setTimestamp(new Date());
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}h${String(minutes).padStart(2, '0')}m`;
}

function numberText(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

module.exports = {
  answerMember,
  channelsEmbed,
  handleBotConversation,
  historyEmbed,
  panelPayload,
  pointsEmbed,
  sendAnonymousReport,
  sendMemberQuestion,
  sendSuggestion
};
