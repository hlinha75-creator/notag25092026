const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const env = require('../../config/env');

const color = 0x16a34a;

function channelMention(channelId) {
  return `<#${channelId}>`;
}

function channelUrl(channelId) {
  return `https://discord.com/channels/${ids.guildId}/${channelId}`;
}

function cartilhaUrl() {
  return `${env.dashboardBaseUrl}/cartilha`;
}

function linkButton(label, channelId) {
  return new ButtonBuilder()
    .setLabel(label)
    .setStyle(ButtonStyle.Link)
    .setURL(channelUrl(channelId));
}

function panelPayload() {
  return {
    embeds: onboardingEmbeds(),
    components: navigationComponents(),
    allowedMentions: { parse: [] }
  };
}

function onboardingEmbeds() {
  return [
    new EmbedBuilder()
      .setTitle('Comece aqui — guia rápido da NOTAG')
      .setDescription([
        'Este guia ensina o básico para participar dos conteúdos e crescer com a guilda.',
        '',
        `**1. Leia** ${channelMention(ids.channels.announcements)} e as regras.`,
        `**2. Acompanhe** ${channelMention(ids.channels.pingContent)} para ver os próximos conteúdos.`,
        `**3. Entre antes** em ${channelMention(ids.channels.waitingVoice)} para se organizar e tirar dúvidas.`,
        '**4. Participe em grupo:** presença, comunicação e constância criam sinergia.'
      ].join('\n'))
      .setColor(color),
    new EmbedBuilder()
      .setTitle('Como entender o ping de conteúdo')
      .setDescription([
        `No ${channelMention(ids.channels.pingContent)}, confira sempre:`,
        '• conteúdo, horário e local de saída;',
        '• build, função, tier e consumíveis pedidos;',
        '• regras de loot, regear e patrocínio;',
        '• botão ou forma indicada para entrar no evento.',
        '',
        `Chegue alguns minutos antes em ${channelMention(ids.channels.waitingVoice)}. Aguarde o caller, tire dúvidas e não saia sozinho antes da orientação.`
      ].join('\n'))
      .setColor(0x2563eb),
    new EmbedBuilder()
      .setTitle('Preparação no Albion')
      .setDescription([
        '• Deixe o portal configurado em **Bridgewatch**.',
        '• Configure a casa no **HO de Lost**.',
        '• Use as builds **4.2 disponíveis na HO** quando o conteúdo permitir.',
        '• Em eventos patrocinados, siga exatamente a build e as orientações publicadas.',
        '• Ao final, entregue os itens no **bootsplit** conforme a instrução do líder.'
      ].join('\n'))
      .setColor(0xf59e0b),
    new EmbedBuilder()
      .setTitle('Saldo, morte e regear')
      .setDescription([
        `Use ${channelMention(ids.channels.consultBalance)} para consultar seu saldo ou solicitar saque.`,
        `Se morrer em conteúdo elegível, encontre sua morte no ${channelMention(ids.channels.deathFeed)} e siga o procedimento informado para pedir **regear**.`,
        '',
        'Não solicite regear sem conferir a morte, o evento e as regras do patrocínio.'
      ].join('\n'))
      .setColor(0xdc2626),
    new EmbedBuilder()
      .setTitle('Onde fazemos conteúdo')
      .setDescription([
        'A prioridade é criar bastante conteúdo pelo bot, especialmente:',
        '• ao redor da **HO**;',
        '• defendendo **World Boss em DK**;',
        '• com saída pelo portal de **Bridgewatch**;',
        '• em atividades organizadas e patrocinadas pela guilda.',
        '',
        'Eventos organizados geram recursos, taxa, domínio e pontos. Isso ajuda a melhorar equipamentos, fortalecer a presença nos mapas e financiar novos conteúdos.'
      ].join('\n'))
      .setColor(0x7c3aed),
    new EmbedBuilder()
      .setTitle('NOVO, membro e CORE crescem juntos')
      .setDescription([
        'O patrocínio da guilda é um estímulo para membros novos e antigos criarem sinergia e funcionarem como equipe.',
        '',
        'O cargo **CORE** representa constância recente: pelo menos **3h30 em dois ou mais eventos finalizados nos últimos 7 dias**. A participação é recalculada automaticamente.',
        '',
        '**A guilda evolui quando cada membro lê, se prepara, entra na call e participa dos eventos.**'
      ].join('\n'))
      .setColor(color)
      .setFooter({ text: 'Use o botão “Meu checklist” antes do primeiro evento.' })
  ];
}

function navigationComponents() {
  return [
    new ActionRowBuilder().addComponents(
      linkButton('Regras', ids.channels.rules),
      linkButton('Avisos', ids.channels.announcements),
      linkButton('Ping Content', ids.channels.pingContent),
      linkButton('Consultar saldo', ids.channels.consultBalance),
      linkButton('Death Feed', ids.channels.deathFeed)
    ),
    new ActionRowBuilder().addComponents(
      linkButton('Registrar nick', ids.channels.register),
      linkButton('Builds World Boss', ids.channels.worldBossBuilds),
      new ButtonBuilder()
        .setLabel('Cartilha do novato')
        .setStyle(ButtonStyle.Link)
        .setURL(cartilhaUrl()),
      new ButtonBuilder()
        .setCustomId('tutorial:member_checklist')
        .setLabel('Meu checklist')
        .setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('academy:start:newcomer')
        .setLabel('Iniciar trilha do Novato')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('academy:progress:self')
        .setLabel('Meu progresso')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function checklistPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Checklist antes do evento')
        .setDescription([
          '☐ Li o ping completo e entendi o conteúdo.',
          '☐ Conferi horário, local, build e consumíveis.',
          '☐ Meu portal está em Bridgewatch e sei chegar ao ponto de saída.',
          '☐ Entrei na sala Aguardando Evento antes do início.',
          '☐ Sei como funcionam loot, bootsplit, patrocínio e regear.',
          '☐ Se ainda tenho dúvida, vou perguntar antes da saída.'
        ].join('\n'))
        .setColor(color)
    ],
    components: [
      new ActionRowBuilder().addComponents(
        linkButton('Abrir Ping Content', ids.channels.pingContent),
        linkButton('Entrar em Aguardando Evento', ids.channels.waitingVoice)
      )
    ],
    allowedMentions: { parse: [] }
  };
}

async function sendWelcomeGuide(member) {
  if (!member || member.user?.bot) return null;
  return member.send({
    embeds: [
      new EmbedBuilder()
        .setTitle('Bem-vindo à NOTAG!')
        .setDescription([
          `Olá, ${member.displayName || member.user?.username || 'membro'}!`,
          '',
          'Comece registrando seu nick e leia a **Cartilha do Novato** pelo botão abaixo.',
          'Depois acompanhe **#avisos** e **#ping-content** para participar dos conteúdos.'
        ].join('\n'))
        .setColor(color)
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Abrir cartilha')
          .setStyle(ButtonStyle.Link)
          .setURL(cartilhaUrl()),
        linkButton('Guia no Discord', ids.channels.memberTutorial),
        linkButton('Registrar nick', ids.channels.register)
      )
    ],
    allowedMentions: { parse: [] }
  }).catch(() => null);
}

module.exports = {
  cartilhaUrl,
  checklistPayload,
  onboardingEmbeds,
  panelPayload,
  sendWelcomeGuide
};
