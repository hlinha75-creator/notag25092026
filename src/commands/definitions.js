const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Posta ou atualiza os paineis fixos do bot.'),
  new SlashCommandBuilder()
    .setName('notificacoes')
    .setDescription('Escolha quais notificacoes de eventos deseja receber por DM.'),
  new SlashCommandBuilder()
    .setName('cartilha')
    .setDescription('Inicia uma trilha da Academia NOTAG ou mostra seu progresso.')
    .addStringOption((option) => option
      .setName('funcao')
      .setDescription('Trilha que deseja estudar')
      .addChoices(
        { name: 'Meu progresso', value: 'progress' },
        { name: 'Novato', value: 'newcomer' },
        { name: 'Membro', value: 'member' },
        { name: 'Recrutador', value: 'recruiter' },
        { name: 'Caller', value: 'caller' },
        { name: 'Tesoureiro', value: 'treasurer' },
        { name: 'Staff', value: 'staff' }
      )),
  new SlashCommandBuilder()
    .setName('sincronizar_builds')
    .setDescription('Sincroniza os icones de armas do site e as builds do forum no Discord.')
    .addBooleanOption((option) => option
      .setName('atualizar_existentes')
      .setDescription('Recria também emojis existentes para atualizar imagens antigas.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('saldo')
    .setDescription('Consulta saldo.')
    .addUserOption((option) => option.setName('membro').setDescription('Membro para consultar.')),
  new SlashCommandBuilder()
    .setName('saldosgeral')
    .setDescription('Mostra a dívida real da guilda com os membros e permite exportar.'),
  new SlashCommandBuilder()
    .setName('temporada')
    .setDescription('Consulta os pontos Black estimados da temporada.')
    .addSubcommand((subcommand) => subcommand
      .setName('pontos')
      .setDescription('Mostra os pontos de um jogador; sem nome, consulta seu cadastro.')
      .addStringOption((option) => option.setName('jogador').setDescription('Nome exato no Albion.').setMaxLength(32)))
    .addSubcommand((subcommand) => subcommand
      .setName('ranking')
      .setDescription('Mostra os primeiros colocados da temporada.')
      .addIntegerOption((option) => option.setName('limite').setDescription('Quantidade de jogadores.').setMinValue(3).setMaxValue(20)))
    .addSubcommand((subcommand) => subcommand
      .setName('publicar')
      .setDescription('Publica ou atualiza o anúncio Ouro nos canais da guilda.')),
  new SlashCommandBuilder()
    .setName('registro')
    .setDescription('Abre registro de nome em jogo.'),
  new SlashCommandBuilder()
    .setName('escala_callers')
    .setDescription('Publica a escala interativa de horarios e conteudos dos callers.')
    .addStringOption((option) => option
      .setName('data')
      .setDescription('Data exibida no painel. Padrao: hoje (DD/MM/AAAA).')
      .setMaxLength(20)),
  new SlashCommandBuilder()
    .setName('verificar_membros')
    .setDescription('Lista membros pelo tempo desde a entrada no servidor.')
    .addIntegerOption((option) => option
      .setName('dias')
      .setDescription('Tempo minimo no servidor Discord.')
      .setRequired(true)
      .addChoices(
        { name: '60 dias ou mais', value: 60 },
        { name: '75 dias ou mais', value: 75 }
      )),
  new SlashCommandBuilder()
    .setName('mesclar_contas')
    .setDescription('Mescla duas contas Discord do mesmo jogador.')
    .addUserOption((option) => option.setName('principal').setDescription('Conta que permanecera como principal.').setRequired(true))
    .addUserOption((option) => option.setName('secundaria').setDescription('Outra conta do mesmo jogador.').setRequired(true))
    .addStringOption((option) => option.setName('nome').setDescription('Nome publico do jogador (opcional).').setMaxLength(80)),
  new SlashCommandBuilder()
    .setName('publicar_rank')
    .setDescription('Publica manualmente o ranking completo de fama Albion.')
    .addStringOption((option) => option.setName('periodo').setDescription('Ranking a publicar').setRequired(true).addChoices(
      { name: 'Diário', value: 'daily' },
      { name: 'Semanal', value: 'weekly' }
    )),
  new SlashCommandBuilder()
    .setName('exportar')
    .setDescription('Exporta dados em HTML com botao para baixar CSV.')
    .addStringOption((option) => option
      .setName('tipo')
      .setDescription('Tipo de exportacao')
      .setRequired(true)
      .addChoices(
        { name: 'Saldos', value: 'balances' },
        { name: 'Financeiro', value: 'transactions' },
        { name: 'Auditoria', value: 'audit' },
        { name: 'Voz diaria', value: 'voice_daily' },
        { name: 'Voz bruta', value: 'voice' },
        { name: 'Membros Discord', value: 'members_discord' }
      ))
    .addStringOption((option) => option
      .setName('data')
      .setDescription('Data para relatorio de voz no formato AAAA-MM-DD.')),
  new SlashCommandBuilder()
    .setName('importar')
    .setDescription('Importa CSV de saldos. Use o painel/fluxo com confirmacao.')
    .addAttachmentOption((option) => option.setName('arquivo').setDescription('CSV de saldos').setRequired(true)),
  new SlashCommandBuilder()
    .setName('sincronizar_albion')
    .setDescription('Sincroniza dados manuais do Albion.')
    .addAttachmentOption((option) => option
      .setName('arquivo')
      .setDescription('CSV/TSV exportado do Albion.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('tipo')
      .setDescription('Tipo de sincronizacao')
      .addChoices(
        { name: 'Membros da guild', value: 'membros' },
        { name: 'Fama total', value: 'fama_total' },
        { name: 'Fama PvE', value: 'fama_pve' }
      )),
  new SlashCommandBuilder()
    .setName('inativos')
    .setDescription('Gera previa de inatividade para eventos ou convidados.')
    .addStringOption((option) => option
      .setName('tipo')
      .setDescription('Qual verificacao rodar')
      .setRequired(true)
      .addChoices(
        { name: 'Eventos: Membro para Convidado', value: 'eventos' },
        { name: 'Convidados: Convidado para Sem Tag', value: 'convidados' }
      ))
    .addIntegerOption((option) => option
      .setName('dias_minimos')
      .setDescription('Janela de dias. Padrao: 30.')
      .setMinValue(1)
      .setMaxValue(365))
    .addIntegerOption((option) => option
      .setName('tempo_minimo')
      .setDescription('Eventos: minutos minimos na janela para nao rebaixar. Padrao: 15.')
      .setMinValue(1)
      .setMaxValue(1440)),
  new SlashCommandBuilder()
    .setName('give')
    .setDescription('Cria e gerencia sorteios dos membros.')
    .addSubcommand((subcommand) => subcommand
      .setName('criar')
      .setDescription('Cria um sorteio sujeito a confirmacao do pagador.')
      .addStringOption((option) => option.setName('titulo').setDescription('Titulo do sorteio.').setRequired(true).setMaxLength(100))
      .addStringOption((option) => option.setName('descricao').setDescription('Descricao da campanha.').setRequired(true).setMaxLength(1000))
      .addStringOption((option) => option.setName('premio').setDescription('Nome do premio ou valor, por exemplo: Montaria ou 50m.').setRequired(true).setMaxLength(200))
      .addUserOption((option) => option.setName('pagador').setDescription('Quem vai pagar ou entregar o premio.').setRequired(true))
      .addStringOption((option) => option.setName('inicio').setDescription('Inicio: DD/MM/AAAA HH:mm.').setRequired(true).setMaxLength(16))
      .addStringOption((option) => option.setName('fim').setDescription('Fim: DD/MM/AAAA HH:mm.').setRequired(true).setMaxLength(16))
      .addIntegerOption((option) => option.setName('ganhadores').setDescription('Quantidade de ganhadores.').setRequired(true).setMinValue(1).setMaxValue(20))
      .addStringOption((option) => option.setName('valor').setDescription('Valor estimado em silver, por exemplo: 150m.').setMaxLength(30))
      .addStringOption((option) => option.setName('observacoes').setDescription('Observacoes opcionais.').setMaxLength(1000)))
    .addSubcommand((subcommand) => subcommand
      .setName('editar')
      .setDescription('Edita um sorteio criado por voce.')
      .addIntegerOption((option) => option.setName('id').setDescription('Numero do sorteio.').setRequired(true).setMinValue(1))
      .addStringOption((option) => option.setName('titulo').setDescription('Novo titulo.').setMaxLength(100))
      .addStringOption((option) => option.setName('descricao').setDescription('Nova descricao.').setMaxLength(1000))
      .addStringOption((option) => option.setName('premio').setDescription('Novo premio.').setMaxLength(200))
      .addUserOption((option) => option.setName('pagador').setDescription('Novo responsavel pelo premio.'))
      .addStringOption((option) => option.setName('inicio').setDescription('Novo inicio: DD/MM/AAAA HH:mm.').setMaxLength(16))
      .addStringOption((option) => option.setName('fim').setDescription('Novo fim: DD/MM/AAAA HH:mm.').setMaxLength(16))
      .addIntegerOption((option) => option.setName('ganhadores').setDescription('Nova quantidade de ganhadores.').setMinValue(1).setMaxValue(20))
      .addStringOption((option) => option.setName('valor').setDescription('Novo valor em silver; use "nenhum" para remover.').setMaxLength(30))
      .addStringOption((option) => option.setName('observacoes').setDescription('Novas observacoes.').setMaxLength(1000)))
    .addSubcommand((subcommand) => subcommand
      .setName('cancelar')
      .setDescription('Cancela um sorteio criado por voce.')
      .addIntegerOption((option) => option.setName('id').setDescription('Numero do sorteio.').setRequired(true).setMinValue(1))
      .addStringOption((option) => option.setName('motivo').setDescription('Motivo do cancelamento.').setMaxLength(500)))
    .addSubcommand((subcommand) => subcommand
      .setName('encerrar')
      .setDescription('Encerra agora e sorteia os ganhadores.')
      .addIntegerOption((option) => option.setName('id').setDescription('Numero do sorteio.').setRequired(true).setMinValue(1)))
    .addSubcommand((subcommand) => subcommand
      .setName('refazer')
      .setDescription('Invalida um ganhador e sorteia um substituto.')
      .addIntegerOption((option) => option.setName('id').setDescription('Numero do sorteio.').setRequired(true).setMinValue(1))
      .addUserOption((option) => option.setName('ganhador').setDescription('Ganhador que ficou invalido.').setRequired(true))
      .addStringOption((option) => option.setName('motivo').setDescription('Motivo da substituicao.').setMaxLength(500))),
  new SlashCommandBuilder()
    .setName('verificacao_guild')
    .setDescription('Gerencia a confirmacao dos membros da guilda em voz.')
    .addSubcommand((subcommand) => subcommand
      .setName('iniciar')
      .setDescription('Inicia a verificacao usando a lista exportada da guilda.')
      .addAttachmentOption((option) => option.setName('arquivo').setDescription('CSV/TSV com a coluna Character Name.').setRequired(true))
      .addRoleOption((option) => option.setName('cargo_verificado').setDescription('Tag concedida a quem for confirmado.').setRequired(true))
      .addChannelOption((option) => option.setName('sala_recrutamento').setDescription('Sala de voz Recrutamento.').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
      .addChannelOption((option) => option.setName('sala_eventos').setDescription('Sala de voz Aguardando Evento.').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
      .addChannelOption((option) => option.setName('canal_avisos').setDescription('Canal dos lembretes. Padrao: canal de inatividade.').addChannelTypes(ChannelType.GuildText))
      .addStringOption((option) => option.setName('prazo_utc').setDescription('Prazo ISO em UTC. Padrão: sete dias após o início.')))
    .addSubcommand((subcommand) => subcommand
      .setName('confirmar')
      .setDescription('Confirma manualmente um jogador depois de falar com ele.')
      .addUserOption((option) => option.setName('membro').setDescription('Membro confirmado.').setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('atualizar').setDescription('Recalcula os 30 minutos com staff e mostra o status.'))
    .addSubcommand((subcommand) => subcommand.setName('status').setDescription('Mostra e exporta a lista atual.'))
    .addSubcommand((subcommand) => subcommand.setName('finalizar').setDescription('Encerra agora e publica a lista restante.'))
];

module.exports = commands.map((command) => command.toJSON());
