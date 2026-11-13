# MEMORY.md - NOTAG Bot

Este arquivo guarda as decisoes permanentes do projeto. Antes de alterar o bot, leia este arquivo junto com o codigo atual.

## Objetivo

Bot Discord da guild NOTAG para Albion Online.

O bot existe para organizar eventos, controlar participacao em voz, calcular loot split, manter saldos de prata, registrar membros, lidar com saques/depositos e reduzir trabalho manual da staff.

Prioridade do projeto:
- simples de manter;
- seguro para saldos;
- facil para membros usarem por botoes;
- comandos slash apenas para setup e manutencao;
- se ficar complexo demais, preferir refazer simples em vez de evoluir sem controle.

## Recursos Removidos

Para simplificar o bot, nao manter nem recriar sem decisao explicita:
- dashboard web/local antigo;
- anuncio e agendamento unico da defesa da HO em Sunstrand Shoal de 22/07/2026;
- leiloes;
- enquetes manuais;
- enquete diaria Black For-Fun;
- jogo de frutas/estrelinhas/sorteio;
- OCR de prints;
- FAQ/conversa automatica por palavras-chave.

Tabelas antigas desses recursos podem existir em bancos ja migrados, mas o runtime do bot nao deve expor comandos, botoes, handlers ou modulos para eles.

## Stack

- Node.js
- discord.js
- SQLite via `better-sqlite3`
- Replit para desenvolvimento/testes
- Discloud para rodar em producao
- Git/GitHub para versionamento

## Arquivos Sensiveis

Nunca colocar no Git:
- `.env`
- token do Discord;
- banco SQLite real;
- backups reais do banco;
- `node_modules`.

Banco principal:
- `data/notag.sqlite`

Historico financeiro importante:
- tabela `balances`: saldo atual;
- tabela `balance_transactions`: ledger/historico;
- tabela `audit_logs`: auditoria geral.

## IDs Principais

Servidor:
- guildId: `1480232409105699030`

Bot:
- clientId: `1465328470312747181`

## Cargos

- ADM: `1481251362447823010`
- Staff: `1481251363013791754`
- Tesoureiro: `1481251364523741376`
- Caller: `1481251363705851954`
- Recrutador: `1481251365064806451`
- Membro: `1481251365131911314`
- Convidado: `1481251365857525782`
- Sem tag: `1495210632839172107`

O dono e o owner do servidor Discord.

## Contas Vinculadas

Alguns membros podem ter mais de uma conta Discord representando o mesmo jogador Albion.

Tmaiusculo:
- conta principal: `1276439186513203234`;
- conta vinculada/secundaria: `1436716667894759475`;
- label publico: `Tmaiusculo`.

Regras:
- saldo, saque, pedido de pagamento, transacoes financeiras e contribuicoes de campanha usam sempre a conta principal;
- perfil do membro e rank geral somam voz, eventos e carreira PvE das contas vinculadas;
- a conta secundaria nao deve aparecer como saldo separado em exportacoes/listas financeiras;
- staff pode vincular outros jogadores com `/mesclar_contas principal secundaria nome`, sempre com previa e confirmacao;
- ao mesclar, o nick Albion fica somente na conta principal para nao violar a unicidade de `users.albion_name`.
- ao migrar banco antigo, saldo e historico financeiro da secundaria devem ser absorvidos pela principal;
- presenca em voz e participacao de evento podem continuar registradas no Discord ID real que entrou na call.

## Canais

- Criar evento: `1481397653316178022`
- ping-main: `1481397657065754797`
- Deposito rapido: `1481251393967886518`
- Financeiro: `1481318081145077812`
- DPS meter: `1482081003143958568`
- Consultar saldo: `1481284047526166731`
- Logs banco: `1481251396413296773`
- Saldos guilda: `1481251411726438435`
- Painel ADM: `1486152824067719258`
- Arquivar/CSV: `1499357332231163924`
- Registrar nick: `1492707388552253525`
- Solicitacoes de registro: `1482334949540626462`
- Lista de membros: `1482334951637516289`
- Painel do membro / assistente geral: `1515255057971548261`
- Pendencias membros / atendimento staff: `1516030220073963520`
- Voz aguardando evento: `1492707400485179664`

Categorias:
- Eventos pendentes/ativos: `1481251398246203402`
- Eventos encerrados: `1511385037864570970`

## Permissoes

Criar evento:
- caller;
- staff;
- adm;
- recrutador;
- owner.

Aprovar pagamento:
- staff;
- adm;
- tesoureiro;
- owner.

Importar/exportar CSV:
- staff;
- adm;
- tesoureiro;
- owner.

Retirar saldo manualmente:
- staff;
- adm;
- tesoureiro;
- owner.

Aprovar registro:
- staff;
- adm;
- recrutador;
- owner.

Assumir/gerenciar evento:
- staff;
- caller;
- tesoureiro;
- recrutador;
- adm;
- owner.

Iniciar/finalizar evento:
- criador do evento diretamente;
- staff/adm/owner apenas com confirmacao quando nao for o criador.

## Registro

Quando alguem entra no Discord:
- recebe cargo Sem tag.

Quando preenche registro com nick do Albion:
- recebe Convidado;
- vai para pendencia no canal de solicitacoes de registro.

Staff/ADM/Recrutador podem resolver registro:
- manter Convidado;
- aprovar como Membro.

Quando vira Membro:
- remover Convidado.

Verificacao em massa de pedidos pendentes:
- comando `/sincronizar_albion arquivo:<csv/tsv>`;
- botao de ajuda no Painel ADM: `Verificar pedidos pendentes`;
- permitido para Staff, ADM, Recrutador e owner;
- arquivo pode ser CSV ou TSV;
- aceitar coluna `Character Name`, `Name`, `Nick`, `Player`, `Jogador`, `albion_name` ou primeira coluna quando for lista simples;
- comparar ignorando maiusculas/minusculas e espacos no comeco/fim;
- mostrar previa antes de aplicar;
- encontrados na lista oficial da guild viram Membro;
- remover Convidado quando virar Membro;
- nao encontrados continuam Convidado/pendente;
- gerar CSV de resultado e auditoria.

Lista de membros:
- canal `1482334951637516289`;
- painel fixo criado/atualizado pelo `/setup`;
- mostra resumo de total, membros, convidados, pendentes, sem tag, equipe, registrados e novos 7 dias;
- botoes para atualizar, exportar CSV e ver filtros curtos;
- detalhes e CSV sao respostas efemeras para equipe autorizada.

Painel do membro:
- canal `1515255057971548261`;
- painel fixo criado pelo `/setup`;
- botoes para consultar pontos de influencia e temporada;
- pontos sao lidos dos CSVs em `resources/season32`;
- link de grafico: `https://notag.xyz/S32/pizza.html`;
- builds PvE temporariamente apontam para `https://notag.xyz/builds/pve/Raid/`;
- pergunta para staff, denuncia anonima e sugestao vao para `1516030220073963520`;
- staff pode responder pergunta pelo botao e o bot envia DM ao membro;
- historico mostra eventos participados, horas em evento/voz, saldo acumulado positivo e saldo atual;
- Ver/Ocultar por enquanto mostra atalhos importantes sem alterar permissoes automaticamente.

Privacidade de mensagens por cargo:
- mensagem normal em canal de texto e visivel para todos que podem ver o canal;
- para so uma tag enxergar, usar canal/categoria com permissao desse cargo, thread privada ou resposta efemera de botao/comando;
- mencionar cargo nao esconde a mensagem dos outros.

## Eventos

Painel de criar evento fica no canal Criar evento.

O modal de criar evento pode ser enviado vazio. Padroes:
- Titulo: `FastContent`
- Descricao: `Pergunte na Call`
- Local: `Pergunte na Call`
- Horario Albion/server: 10 minutos a frente do relogio do Albion
- Vagas: `1,1,1,17`

Formato de vagas:
- Tank, Healer, Sup, DPS
- exemplo: `3,3,2,12`

Eventos suportam multiplos eventos simultaneos.

Evento criado aparece no canal ping-main.

Evento aberto deve mostrar:
- titulo;
- descricao;
- local;
- horario Albion/server;
- vagas por funcao;
- quem ocupou cada vaga.

Evento em andamento deve ficar compacto, mas mostrar:
- tempo em andamento;
- vagas resumidas;
- participantes e funcao de cada um;
- sala de voz;
- criador.

Botoes em andamento:
- Quero participar;
- Assistir;
- Pausar participacao;
- Finalizar;
- Cancelar.

`Quero participar`:
- entra na primeira funcao com vaga livre;
- se ja participava, usa a funcao existente;
- se o usuario estiver em voz, o bot tenta mover para a sala do evento.
- se o evento estiver lotado, nao criar reserva; apenas sugerir Assistir.

`Assistir`:
- coloca como espectador;
- move para a sala se o usuario estiver em voz;
- nao conta tempo.

`Pausar participacao`:
- fecha a sessao de voz aberta;
- para o tempo;
- move para aguardando evento se estiver na sala do evento.

Se o player sair da sala de voz:
- participacao pausa automaticamente;
- se voltar, soma os periodos corretamente.

Tempo contado:
- somente depois que o evento inicia;
- espectador nunca conta;
- quem entra depois conta a partir da entrada;
- quem sai antes recebe proporcional;
- sessoes sobrepostas devem ser mescladas/clippadas para evitar tempo maior que a duracao do evento.

Ao iniciar:
- criar sala temporaria em Eventos ativos;
- mover participantes que ja estao em voz;
- apagar a mensagem de aviso de 1 minuto, se existir;
- apagar cargo temporario de aviso, se existir.

Ao finalizar:
- fechar sessoes de voz;
- mover todos para Aguardando evento;
- apagar sala temporaria;
- apagar mensagem/cargo temporario de aviso;
- apagar o embed do evento no canal ping-main;
- abrir revisao de loot no financeiro.

Ao cancelar:
- apagar sala temporaria;
- apagar mensagem/cargo temporario de aviso;
- apagar o embed do evento no canal ping-main;
- registrar motivo.

Staff/ADM/owner podem cancelar evento de outro criador com confirmacao, igual iniciar/finalizar.

## Tutoriais

FAQ/conversa automatica foi removido para simplificar o bot.

Tutoriais:
- permitido para Staff, ADM, Caller, Recrutador e owner.

Tutoriais atuais:
- Eventos;
- Financeiro;
- Deposito;
- Registro;
- CSV e backups;
- Treinamento.

## Aviso de 1 Minuto

Todos os eventos usam o horario do Albion/server como referencia. O bot compara esse horario como UTC, nao como hora local do Brasil.

Quando faltar 1 minuto para o evento:
- criar cargo temporario;
- dar cargo aos inscritos;
- nao incluir espectadores no aviso;
- mencionar no canal ping-main;
- avisar que o evento nao inicia automaticamente;
- guardar `warning_message_id` para apagar depois.

Quando o evento iniciar/cancelar/finalizar:
- apagar a mensagem do aviso;
- apagar o cargo temporario.

## Revisao de Participacao

Depois de finalizar, o criador preenche:
- loot total;
- reparo;
- sacos de prata;
- taxa %.
- campo unico opcional com link/imagem/observacoes de DPS meter, fama total e loot logger.

Discord modal nao aceita upload de arquivo. CSV do loot logger e prints podem ser anexados depois no canal temporario de revisao.

Calculo:
- loot liquido = loot total + sacos de prata - reparo - taxa%.

Antes de enviar para pagamento:
- criador/gestor autorizado pode editar participante;
- adicionar participante;
- remover participante;
- alterar funcao;
- alterar tempo manual;
- recalcular split.

Ao finalizar evento:
- mover membros da sala de voz para Aguardando Evento;
- apagar sala temporaria de voz;
- criar canal temporario de revisao na categoria Eventos pendentes/ativos;
- nome do canal: criador + horario;
- canal visivel para criador, participantes e staff/ADM/tesoureiro;
- criador revisa/edita e clica Enviar Financeiro;
- postar resumo no canal DPS meter mencionando participantes depois da revisao final do criador;
- bot move canal para Eventos encerrados;
- bot posta pedido de aprovacao no Financeiro;
- staff aprova pagamento;
- apos aprovacao, registro fica no Financeiro e o canal temporario de revisao some depois de 14h.

Editar/adicionar/remover participantes deve usar User Select Menu do Discord sempre que possivel.

Todo ajuste manual precisa logar:
- quem fez;
- antes/depois;
- motivo;
- evento.

## Financeiro e Saldos

Saldos sao prata do Albion.

Formato de exibicao:
- `1000` = `1k`
- `1000000` = `1m`
- `1250000` = `1.25m`

No banco, sempre salvar valores como inteiros. Nunca salvar `1m`, `1.5m`, texto ou decimal.

Toda alteracao de saldo precisa:
- alterar `balances`;
- criar linha em `balance_transactions`;
- criar auditoria quando aplicavel;
- enviar DM ao membro com:
  - entrou ou saiu;
  - valor;
  - motivo;
  - saldo atual.

Operacoes criticas devem usar transacao SQLite.

Antes de alteracoes financeiras importantes:
- criar backup do banco.

Ao aprovar evento:
- se qualquer deposito falhar, nao depositar para ninguem.

## Saques

Membro solicita saque pelo painel Consultar saldo.

Valor de saque:
- aceitar somente numero inteiro;
- sem ponto;
- sem virgula;
- sem letra;
- sem simbolo;
- exemplo valido: `1000000`.

Se digitar `1m`, `500k`, `1.000.000`, `1,000,000` ou `10;000`:
- bloquear;
- avisar para inserir somente numeros inteiros.

Antes de enviar para staff:
- mostrar confirmacao ao membro;
- mostrar valor digitado;
- mostrar valor entendido formatado;
- mostrar saldo atual;
- botoes Confirmar saque / Cancelar.

Staff no financeiro pode:
- aprovar saque;
- pagar saque;
- recusar saque.

Saldo so sai quando staff clica em Pagar saque.

Recusar saque:
- nao altera saldo;
- remove botoes;
- registra auditoria.

## Deposito Rapido

Canal de deposito rapido:
- `1481251393967886518`

Staff/ADM/Tesoureiro podem criar deposito para varios membros.

Fluxo:
- modal com loot total, reparo, sacos de prata e taxa;
- calcular liquido;
- User Select Menu para selecionar participantes;
- dividir igualmente entre selecionados;
- sempre dividir igual para todos;
- nao usar peso/tempo no deposito rapido;
- confirmar deposito;
- aplicar saldo;
- enviar DM para cada membro.

Se tentar confirmar sem participantes:
- bloquear e avisar.

## Painel ADM

Retirar saldo:
- usar User Select Menu para escolher membro;
- abrir modal com ID preenchido;
- pedir valor;
- pedir motivo;
- se ficar negativo, exigir `CONFIRMAR`.

Saldo negativo:
- permitido;
- exige confirmacao obrigatoria;
- exige motivo;
- precisa logar.

Saque maior que o saldo atual:
- permitido;
- nao bloquear automaticamente;
- bot deve avisar a staff que o saque deixara saldo negativo;
- a decisao de aprovar/pagar/recusar continua com a staff.

O Painel ADM tambem deve mostrar o painel Arquivar:
- exportar saldos;
- lista HTML de saldos;
- exportar logs financeiros;
- exportar auditoria;
- importar CSV;
- Discord x Albion HTML.

## CSV e Backups

Exportar CSV:
- saldos;
- logs financeiros;
- auditoria.

Backup automatico de saldos:
- postar CSV no canal Arquivar/CSV `1499357332231163924`;
- postar depois que um evento e aprovado no financeiro e os saldos sao depositados;
- postar tambem a cada 24 horas;
- usar trava no banco para nao duplicar backup do mesmo evento ou do mesmo ciclo diario;
- CSV deve conter discord_id, discord_name, albion_name, balance e last_updated;
- backup automatico nao altera saldo.

Importar CSV:
- deve mostrar previa antes;
- sobrescrever saldo por `discord_id` e/ou `albion_name`;
- se `albion_name` bater mas `discord_id` for diferente, atualizar para o novo `discord_id`;
- mostrar quantos encontrados;
- quantos nao encontrados;
- total antes;
- total depois;
- exigir confirmacao;
- gerar log/auditoria.

Importacao CSV altera saldo por diferenca:
- cria transacao com diff entre saldo anterior e novo saldo.

## Deploy

Scripts:
- `npm run deploy:commands`: registra slash commands;
- `npm run clear:commands`: limpa comandos antigos, mas so manualmente;
- `npm start`: inicia o bot;
- `npm run backup:db`: backup manual.

`scripts/clearCommands.js` nunca deve rodar automaticamente ao iniciar o bot.

Discloud:
- depois de subir codigo, reiniciar/rebuild conforme necessario;
- banco SQLite real nao deve ir no zip/git.

## Regras de Manutencao

Preferir codigo dividido por modulos:
- events;
- finance;
- registration;
- voice;
- csv;
- audit;
- commands;
- setup.

Nao criar dashboard web agora.

Dashboard/API:
- dashboard web antigo removido;
- nao recriar dashboard web/API agora;
- manter relatorios HTML pontuais gerados sob demanda por comandos/botoes quando forem uteis para operacao.

Interface de eventos:
- evento aberto deve ser compacto e mais horizontal;
- criador aparece no topo da descricao;
- status usa simbolo visual;
- vagas usam cores por funcao: azul Tank, verde Healer, amarelo Suporte, vermelho DPS;
- inscricao em evento aberto usa botoes por funcao em vez de menu select;
- em eventos comuns, a ultima vaga da quantidade informada de DPS aparece como Looter;
- o Looter ocupa uma vaga DPS e deve levar Javali Espectral e recolher os sacos de prata do chao;
- Discord nao tem botao amarelo nativo, entao Suporte usa emoji amarelo em botao cinza;
- ao iniciar evento, a sala de voz usa o titulo do evento como nome.
- o painel de criar evento possui a opcao `Personalizado`;
- evento personalizado usa um assistente em etapas: dados basicos, loot/requisitos e composicao;
- dados basicos do personalizado: titulo, horario inicial/final, dia, descricao e composicao Tank/Healer/Suporte/DPS;
- requisitos do personalizado: regra de loot, consumiveis e montaria;
- as telas de composicao sao geradas conforme o total de vagas, com ate 5 vagas por modal por causa do limite do Discord;
- o assistente personalizado reutiliza uma unica mensagem efemera, substituindo a etapa anterior para nao acumular botoes antigos;
- cada vaga personalizada aceita arma, build ou observacao propria e fica salva no banco;
- exemplo `2,2,2,14`: 20 vagas distribuidas em 4 telas, de Tank 1 ate DPS 14, sendo a ultima DPS o Looter;
- para usar imagens no bot real do Discord em botoes/textos, enviar como emojis personalizados do servidor e cadastrar os IDs no codigo.
- Raid Avalon Full usa botoes por funcao: Tank, Healer, Suporte, DPS;
- ao clicar numa funcao, abre menu com slots especificos livres daquela funcao;
- slots de Raid Avalon: Tank Martelo/Incubus/Quebra Reinos, Healer Hallow/Fallen/Raiz, Suporte SC/Danacao/Enig, DPS Aguia/Uivo Frio/Furabruma/Repetidor 1-8;
- uma vaga de arma nao pode ser ocupada por duas pessoas ao mesmo tempo;
- se o usuario ja tinha uma vaga, escolher outra troca a vaga dele.
- novo anuncio de Raid Avalon deve ser compacto, sem duplicar DG/build/local em campos separados;
- botoes da Raid Avalon ficam em linhas: Tank/Healer/Suporte/DPS, depois Assistir/Scout/Looter/Uper, depois gerenciamento;
- emojis personalizados cadastrados no codigo para Tank, Healer, Support, DPS, Martelo, Incubus, RealBreaker, QuesaSanta, Fallen, Iron, Shadow, Damnation, Enig, LightCaller, Chill, Furabruma e Repetidor;
- IDs corrigidos: QuesaSanta `1481801328161329152`, Fallen `1517097238336110742`, Iron `1517097588518813767`, Furabruma `1517189201232138240`;
- emoji Furabruma cadastrado com ID `1517189201232138240`;
- IDs enviados para Shadow/Damnation/Enig sao iguais aos de QuesaSanta/Fallen/Iron e podem precisar correcao.
- pontos de carreira sao por tempo: a cada 30 minutos conta +1 ponto;
- ao aprovar pagamento, cada participante recebe pontos na classe e na funcao/arma;
- exemplo: 3h de Tank/Martelo = +6 em Classe Tank e +6 em Martelo;
- em eventos comuns sem arma, usar funcao padrao: Tank=Incubus, Healer=Hallow/Queda Santa, Suporte=SC/Chama Sombra, DPS=Furabruma;
- financeiro tem botao `Recusar e devolver`, que volta evento para revisao e reabre/avisa o canal do criador.

Painel do membro / Builds:
- botao `Builds PvE` mostra catalogo por conteudo;
- Furabruma preenchida com img `https://prnt.sc/ShmbQMoteKMi` e detalhes `https://albionfreemarket.com/builds/details/6a33dba765245f624c119f2e`;
- Repetidor preenchido com img `https://prnt.sc/j8TM6Ug0Qsve` e detalhes `https://albionfreemarket.com/builds/details/6a3418bb65245f624c119f56`;
- demais builds ficam como `img pendente` e `detalhes pendente` para preencher depois.
- botoes de evento sem parametro extra usam sufixo no custom_id (`:main` ou `:raid`) para evitar erro Discord `COMPONENT_CUSTOM_ID_DUPLICATED`.

Tag temporaria de evento:
- todo evento criado ganha cargo temporario mencionavel com nome `DDMMasHHh`;
- exemplo: `1906as07h`;
- cargo e dado aos participantes conforme entram no evento;
- bot menciona o cargo no chat membro 10 minutos antes e novamente no horario;
- cargo deve ser deletado automaticamente apos 24 horas.

Antes de terminar uma alteracao:
- rodar `node --check` nos arquivos JS alterados;
- se mexer em banco, garantir migracao segura;
- nao alterar `.env`;
- nao commitar banco real.

## Backlog Futuro

Itens anotados para implementar depois. Estes requisitos ainda nao representam funcionalidade pronta.

### Dashboard Web - Discloud Platinum

- preparar o bot e a arquitetura para usar um dashboard web hospedado com a versao Platinum da Discloud;
- o dashboard deve facilitar para Staff, Caller e demais cargos autorizados gerenciarem:
  - saldos;
  - membros;
  - eventos;
  - configuracoes e operacao do bot;
- definir permissoes por cargo e manter auditoria nas operacoes sensiveis, especialmente alteracoes de saldo;
- este item e planejamento futuro aprovado e nao deve reativar o dashboard/API antigo sem uma implementacao nova e explicitamente solicitada.

## Duvidas Pendentes Para Confirmar

Nenhuma no momento.

