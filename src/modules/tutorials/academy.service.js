const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const { getDatabase } = require('../../database/connection');
const { can } = require('../../config/permissions');
const env = require('../../config/env');

const color = 0x7ee787;

const tracks = {
  newcomer: {
    label: 'Novato',
    active: true,
    summary: 'Entrar nos conteúdos sem medo, lendo e perguntando antes.',
    lessons: [
      'Você não precisa de spec alta nem gastar sua prata para começar.',
      'Leia o ping e as instruções completas antes de entrar.',
      'Chegue antes, avise que é novo e tire as dúvidas antes da saída.',
      'A NOTAG é for fun: gostamos da bagunça de 4.2, com organização.'
    ],
    questions: [
      {
        prompt: 'Você quer participar, mas ainda não tem spec alta. O que deve fazer?',
        options: ['Comprar uma build cara antes de falar com alguém', 'Ler o ping, chegar antes e pedir orientação', 'Esperar vários meses até ter spec'],
        correct: 1,
        explanation: 'Spec alta não é requisito para começar. Leia o conteúdo e peça ajuda antes da saída.'
      },
      {
        prompt: 'Qual é o melhor momento para tirar dúvidas sobre build e caminho?',
        options: ['Alguns minutos antes, na sala indicada', 'No meio de uma chamada urgente do caller', 'Depois que o conteúdo terminar'],
        correct: 0,
        explanation: 'Chegar antes protege o tempo do grupo e permite que alguém ajude com calma.'
      },
      {
        prompt: 'O que “for fun, com organização” significa?',
        options: ['Ninguém precisa seguir instrução alguma', 'Só jogadores competitivos podem participar', 'A prioridade é diversão, mas o conteúdo precisa de leitura e comunicação'],
        correct: 2,
        explanation: 'A organização existe para a diversão funcionar para todo o grupo.'
      }
    ]
  },
  member: {
    label: 'Membro',
    active: true,
    prerequisites: ['newcomer'],
    summary: 'Acolher quem está começando e proteger a comunicação do grupo.',
    lessons: [
      'Dê atenção aos novatos e compartilhe o que já aprendeu.',
      'Durante o conteúdo, o caller tem autoridade operacional sobre o grupo.',
      'Não dispute voz com chamadas importantes; espere o espaço certo para conversar.',
      'Corrija com respeito e leve dúvidas mais longas para uma sala tranquila.'
    ],
    questions: [
      {
        prompt: 'Um novato faz uma pergunta básica antes da saída. Como agir?',
        options: ['Ignorar para ele aprender sozinho', 'Responder com paciência ou chamar alguém que saiba', 'Mandar pesquisar depois do evento'],
        correct: 1,
        explanation: 'Membros experientes ajudam a nivelar o grupo dando atenção sem humilhar.'
      },
      {
        prompt: 'O caller está passando uma instrução e você discorda. O que fazer?',
        options: ['Falar por cima para corrigir imediatamente', 'Seguir a chamada e conversar no momento apropriado, salvo risco urgente', 'Sair do conteúdo sem avisar'],
        correct: 1,
        explanation: 'A voz limpa é essencial. Riscos urgentes podem ser avisados; discussões ficam para o momento adequado.'
      },
      {
        prompt: 'O que um membro representa para quem acabou de entrar?',
        options: ['Um exemplo de convivência e apoio', 'Uma autoridade sem obrigação', 'Alguém que só cuida da própria função'],
        correct: 0,
        explanation: 'A cultura da guilda é transmitida principalmente pelo comportamento dos membros.'
      }
    ]
  },
  recruiter: {
    label: 'Recrutador',
    active: true,
    prerequisites: ['newcomer', 'member'],
    summary: 'Receber pessoas com calma, atenção individual e informação correta.',
    lessons: [
      'Quando houver dúvida, leve a pessoa para uma sala com menos gente.',
      'Faça perguntas para entender a dúvida antes de responder.',
      'Explique com cuidado e confirme se a pessoa realmente entendeu.',
      'Não prometa benefícios, cargos ou exceções que não estejam definidos.'
    ],
    questions: [
      {
        prompt: 'Uma pessoa está perdida em uma call cheia. Qual é a primeira ação?',
        options: ['Falar mais alto na mesma sala', 'Arrastar ou convidar para uma sala mais tranquila', 'Mandar uma lista de links e encerrar'],
        correct: 1,
        explanation: 'Menos ruído permite dar atenção e identificar a dúvida real.'
      },
      {
        prompt: 'Você não sabe responder uma regra específica. O que faz?',
        options: ['Inventa uma resposta provável', 'Confirma com a staff e retorna com a informação correta', 'Diz que a dúvida não importa'],
        correct: 1,
        explanation: 'É melhor confirmar do que criar uma expectativa errada.'
      },
      {
        prompt: 'Quando o atendimento está completo?',
        options: ['Quando você terminou de falar', 'Quando enviou o primeiro link', 'Quando a pessoa consegue explicar o próximo passo'],
        correct: 2,
        explanation: 'Confirmar entendimento evita que a dúvida apenas seja empurrada para outra pessoa.'
      }
    ]
  },
  caller: {
    label: 'Caller',
    active: true,
    prerequisites: ['newcomer', 'member', 'recruiter'],
    summary: 'Conduzir conteúdos com clareza, conhecimento e carisma — sem autoritarismo.',
    lessons: [
      'Conheça as funções anteriores e as armas básicas de PvE antes de liderar.',
      'O cargo dá responsabilidade operacional, não poder para ser ditador.',
      'Ganhe confiança explicando decisões, ouvindo o grupo e tratando todos com respeito.',
      'Use a staff como apoio e crie conteúdos com frequência para desenvolver a guilda.'
    ],
    questions: [
      {
        prompt: 'O que o cargo de Caller concede?',
        options: ['Poder permanente sobre os membros', 'Responsabilidade para organizar e conduzir o conteúdo', 'Permissão para ignorar a staff'],
        correct: 1,
        explanation: 'A autoridade do caller é operacional e existe para o conteúdo funcionar.'
      },
      {
        prompt: 'Um conteúdo deu errado. Qual é a melhor reação?',
        options: ['Culpar publicamente um membro', 'Revisar a decisão, explicar e pedir apoio quando necessário', 'Nunca mais criar eventos'],
        correct: 1,
        explanation: 'Responsabilidade e aprendizado constante constroem carisma e confiança.'
      },
      {
        prompt: 'Como um caller fortalece a guilda?',
        options: ['Criando bons conteúdos, desenvolvendo pessoas e pedindo apoio', 'Centralizando todos os eventos apenas nele', 'Usando o cargo para encerrar dúvidas'],
        correct: 0,
        explanation: 'Mais conteúdos bem conduzidos criam experiência e novos líderes.'
      }
    ]
  },
  treasurer: {
    label: 'Tesoureiro',
    active: false,
    summary: 'Trilha aguardando definição das regras financeiras oficiais.',
    lessons: [],
    questions: []
  },
  staff: {
    label: 'Staff',
    active: true,
    prerequisites: ['newcomer', 'member'],
    summary: 'Prevenir pequenos problemas, decidir com autonomia e assumir os efeitos das decisões.',
    lessons: [
      'Resolva cedo pequenas situações que possam crescer, sempre com educação.',
      'A staff tem liberdade para decidir sem pedir permissão para cada rotina.',
      'Quem toma uma decisão acompanha e resolve seus possíveis efeitos colaterais.',
      'A rotina pode exigir menos execução direta, mas exige atenção contínua ao crescimento da guilda.'
    ],
    questions: [
      {
        prompt: 'Você percebe um comportamento pequeno que pode virar conflito. O que faz?',
        options: ['Espera piorar para ter certeza', 'Conversa cedo, em particular e com educação', 'Expõe a pessoa no chat geral'],
        correct: 1,
        explanation: 'Intervenções pequenas, privadas e respeitosas evitam problemas maiores.'
      },
      {
        prompt: 'Você tomou uma decisão permitida e surgiu um efeito colateral. Quem acompanha?',
        options: ['Quem tomou a decisão, com apoio da equipe quando necessário', 'Somente o dono da guilda', 'Ninguém, porque havia liberdade para decidir'],
        correct: 0,
        explanation: 'Autonomia e responsabilidade caminham juntas.'
      },
      {
        prompt: 'Qual é o risco de uma staff que “trabalha menos” sem acompanhar a guilda?',
        options: ['Nenhum, porque o cargo já garante supervisão', 'O crescimento ficar sem orientação e pequenos problemas acumularem', 'Apenas ter menos mensagens no Discord'],
        correct: 1,
        explanation: 'Staff precisa de atenção constante, mesmo quando há poucas tarefas manuais.'
      }
    ]
  }
};

function track(key) {
  return tracks[key] || null;
}

function siteUrl(key = 'newcomer') {
  return `${env.dashboardBaseUrl}/cartilha#${key}`;
}

function getProgress(discordId, trackKey, db = getDatabase()) {
  return db.prepare('SELECT * FROM academy_progress WHERE discord_id = ? AND track_key = ?').get(discordId, trackKey) || null;
}

function completedTrackKeys(discordId, db = getDatabase()) {
  return new Set(db.prepare("SELECT track_key FROM academy_progress WHERE discord_id = ? AND status = 'completed'").all(discordId).map((row) => row.track_key));
}

function missingPrerequisites(discordId, trackKey, db = getDatabase()) {
  const item = track(trackKey);
  if (!item) return [];
  const completed = completedTrackKeys(discordId, db);
  return (item.prerequisites || []).filter((key) => !completed.has(key));
}

function ensureProgress(discordId, trackKey, { restart = false, db = getDatabase() } = {}) {
  const existing = getProgress(discordId, trackKey, db);
  if (existing && !restart) return existing;
  db.prepare(`
    INSERT INTO academy_progress (discord_id, track_key, status, question_index, correct_answers, attempts, started_at, completed_at, updated_at)
    VALUES (?, ?, 'in_progress', 0, 0, 0, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP)
    ON CONFLICT(discord_id, track_key) DO UPDATE SET
      status = 'in_progress', question_index = 0, correct_answers = 0, attempts = 0,
      started_at = CURRENT_TIMESTAMP, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
  `).run(discordId, trackKey);
  return getProgress(discordId, trackKey, db);
}

function answer(discordId, trackKey, questionIndex, selectedOption, db = getDatabase()) {
  const item = track(trackKey);
  if (!item?.active) throw new Error('Esta cartilha ainda não está disponível.');
  const progress = ensureProgress(discordId, trackKey, { db });
  if (progress.status === 'completed') return { completed: true, alreadyCompleted: true, progress };
  if (Number(progress.question_index) !== Number(questionIndex)) throw new Error('Esta pergunta não está mais ativa. Abra novamente sua trilha.');
  const question = item.questions[questionIndex];
  if (!question || !question.options[selectedOption]) throw new Error('Resposta inválida.');
  const correct = Number(selectedOption) === Number(question.correct);
  db.prepare(`
    INSERT INTO academy_answers (discord_id, track_key, question_index, selected_option, correct)
    VALUES (?, ?, ?, ?, ?)
  `).run(discordId, trackKey, questionIndex, selectedOption, correct ? 1 : 0);
  if (!correct) {
    db.prepare('UPDATE academy_progress SET attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ? AND track_key = ?').run(discordId, trackKey);
    return { correct: false, completed: false, question, progress: getProgress(discordId, trackKey, db) };
  }
  const nextIndex = questionIndex + 1;
  const completed = nextIndex >= item.questions.length;
  db.prepare(`
    UPDATE academy_progress
    SET status = ?, question_index = ?, correct_answers = correct_answers + 1,
        attempts = attempts + 1, completed_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE discord_id = ? AND track_key = ?
  `).run(completed ? 'completed' : 'in_progress', nextIndex, completed ? new Date().toISOString() : null, discordId, trackKey);
  return { correct: true, completed, question, progress: getProgress(discordId, trackKey, db) };
}

function questionPayload(trackKey, progress, feedback = null) {
  const item = track(trackKey);
  const questionIndex = Math.min(Number(progress?.question_index || 0), item.questions.length - 1);
  const question = item.questions[questionIndex];
  const description = [
    `**${question.prompt}**`,
    '',
    ...question.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`),
    feedback ? `\n${feedback}` : null
  ].filter(Boolean).join('\n');
  return {
    embeds: [new EmbedBuilder()
      .setTitle(`${item.label} • pergunta ${questionIndex + 1}/${item.questions.length}`)
      .setDescription(description)
      .setColor(feedback ? 0xf2cc60 : color)
      .setFooter({ text: 'Você pode tentar novamente quando errar.' })],
    components: [new ActionRowBuilder().addComponents(
      ...question.options.map((option, index) => new ButtonBuilder()
        .setCustomId(`academy:answer:${trackKey}:${questionIndex}-${index}`)
        .setLabel(String.fromCharCode(65 + index))
        .setStyle(ButtonStyle.Secondary))
    )]
  };
}

function completionPayload(trackKey, progress) {
  const item = track(trackKey);
  return {
    embeds: [new EmbedBuilder()
      .setTitle(`Trilha ${item.label} concluída`)
      .setDescription([
        'Você demonstrou que entendeu os princípios básicos desta função.',
        '',
        `Acertos: **${progress.correct_answers}/${item.questions.length}**`,
        `Tentativas: **${progress.attempts}**`,
        '',
        'A conclusão fica registrada para acompanhamento da staff.'
      ].join('\n'))
      .setColor(color)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Ler cartilha').setStyle(ButtonStyle.Link).setURL(siteUrl(trackKey)),
      new ButtonBuilder().setCustomId(`academy:restart:${trackKey}`).setLabel('Refazer').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('academy:progress:self').setLabel('Meu progresso').setStyle(ButtonStyle.Primary)
    )]
  };
}

function startPayload(discordId, trackKey, { restart = false, db = getDatabase() } = {}) {
  const item = track(trackKey);
  if (!item) throw new Error('Cartilha desconhecida.');
  if (!item.active) {
    return {
      embeds: [new EmbedBuilder().setTitle(`Cartilha ${item.label}`).setDescription(item.summary).setColor(0x6b7280)],
      components: []
    };
  }
  const missing = missingPrerequisites(discordId, trackKey, db);
  if (missing.length) {
    return {
      embeds: [new EmbedBuilder()
        .setTitle(`Antes da trilha ${item.label}`)
        .setDescription(`Conclua primeiro: ${missing.map((key) => `**${tracks[key].label}**`).join(', ')}.`)
        .setColor(0xf2cc60)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`academy:start:${missing[0]}`).setLabel(`Começar ${tracks[missing[0]].label}`).setStyle(ButtonStyle.Primary)
      )]
    };
  }
  const progress = ensureProgress(discordId, trackKey, { restart, db });
  if (progress.status === 'completed') return completionPayload(trackKey, progress);
  return questionPayload(trackKey, progress);
}

function progressPayload(discordId, db = getDatabase()) {
  const progressRows = db.prepare('SELECT * FROM academy_progress WHERE discord_id = ?').all(discordId);
  const byKey = new Map(progressRows.map((row) => [row.track_key, row]));
  const lines = Object.entries(tracks).map(([key, item]) => {
    const row = byKey.get(key);
    if (!item.active) return `⏳ **${item.label}:** aguardando regras`;
    if (row?.status === 'completed') return `✅ **${item.label}:** concluída`;
    if (row) return `🟡 **${item.label}:** ${Math.min(row.question_index + 1, item.questions.length)}/${item.questions.length}`;
    return `⚪ **${item.label}:** não iniciada`;
  });
  const buttons = Object.entries(tracks).filter(([, item]) => item.active).map(([key, item]) => (
    new ButtonBuilder().setCustomId(`academy:start:${key}`).setLabel(item.label).setStyle(ButtonStyle.Secondary)
  ));
  return {
    embeds: [new EmbedBuilder().setTitle('Meu progresso • Academia NOTAG').setDescription(lines.join('\n')).setColor(color)],
    components: [new ActionRowBuilder().addComponents(...buttons.slice(0, 5))]
  };
}

function staffOverviewPayload(db = getDatabase()) {
  const totals = db.prepare(`
    SELECT track_key,
      COUNT(*) AS started,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
    FROM academy_progress
    GROUP BY track_key
  `).all();
  const totalsByKey = new Map(totals.map((row) => [row.track_key, row]));
  const lines = Object.entries(tracks).map(([key, item]) => {
    const row = totalsByKey.get(key) || { started: 0, completed: 0 };
    return `**${item.label}:** ${row.completed || 0} concluíram • ${row.started || 0} iniciaram`;
  });
  const recent = db.prepare(`
    SELECT discord_id, track_key, completed_at
    FROM academy_progress
    WHERE status = 'completed'
    ORDER BY completed_at DESC
    LIMIT 10
  `).all();
  if (recent.length) {
    lines.push('', '**Conclusões recentes**', ...recent.map((row) => `• <@${row.discord_id}> — ${tracks[row.track_key]?.label || row.track_key}`));
  }
  return {
    embeds: [new EmbedBuilder().setTitle('Academia NOTAG • acompanhamento').setDescription(lines.join('\n')).setColor(0x4f46e5)],
    allowedMentions: { parse: [] }
  };
}

async function handleButton(interaction) {
  const [, action, trackKey, encodedAnswer] = interaction.customId.split(':');
  const discordId = interaction.user.id;
  if (action === 'start') return interaction.reply({ ...startPayload(discordId, trackKey), flags: MessageFlags.Ephemeral });
  if (action === 'restart') return interaction.update(startPayload(discordId, trackKey, { restart: true }));
  if (action === 'progress') return interaction.reply({ ...progressPayload(discordId), flags: MessageFlags.Ephemeral });
  if (action === 'staff') {
    if (!can(interaction.member, 'approveRegistration') && !can(interaction.member, 'approvePayment')) {
      return interaction.reply({ content: 'Sem permissão para acompanhar a academia.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...staffOverviewPayload(), flags: MessageFlags.Ephemeral });
  }
  if (action === 'answer') {
    const [questionIndex, selectedOption] = String(encodedAnswer || '').split('-').map(Number);
    const result = answer(discordId, trackKey, questionIndex, selectedOption);
    if (result.completed) return interaction.update(completionPayload(trackKey, result.progress));
    if (!result.correct) return interaction.update(questionPayload(trackKey, result.progress, `⚠️ ${result.question.explanation}`));
    return interaction.update(questionPayload(trackKey, result.progress, `✅ ${result.question.explanation}`));
  }
  throw new Error('Ação da academia desconhecida.');
}

module.exports = {
  answer,
  completedTrackKeys,
  completionPayload,
  getProgress,
  handleButton,
  missingPrerequisites,
  progressPayload,
  siteUrl,
  staffOverviewPayload,
  startPayload,
  track,
  tracks
};
