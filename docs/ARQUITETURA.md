# Arquitetura

## Resumo

O projeto e um bot Discord em Node.js CommonJS.

Principais tecnologias:

- `discord.js`: conexao com Discord, comandos, botoes, modais e eventos.
- `better-sqlite3`: banco SQLite local.
- `dotenv`: variaveis de ambiente.

## Entrada Principal

Arquivo:

```text
src/index.js
```

Responsabilidades:

- carregar ambiente;
- rodar migrations;
- criar backup de startup;
- inicializar client Discord;
- registrar listeners;
- iniciar rotinas periodicas;
- fazer login com `DISCORD_TOKEN`.

Eventos Discord principais:

- `clientReady`
- `guildMemberAdd`
- `voiceStateUpdate`
- `interactionCreate`
- `messageCreate`

## Estrutura De Pastas

```text
src/
  commands/
  config/
  database/
  interactions/
  modules/
  utils/
data/
resources/
scripts/
docs/
```

## `src/commands`

Define e trata comandos slash.

- `definitions.js`: lista os comandos registrados no Discord.
- `handlers.js`: executa a logica quando comando slash e usado.

Quando mudar comando, rode:

```bash
npm run deploy:commands
```

## `src/interactions`

Roteia botoes, selects e modais.

- `router.js`: decide se interacao e comando, botao, select ou modal.
- `buttons.js`: botoes dos paineis, eventos, financeiro, admin, CSV, registro e outros.
- `modals.js`: formularios de evento, loot, registro, saque, pagamento, deposito etc.
- `selects.js`: menus de selecao, como vagas, deposito e revisao.

Regra pratica:

- comando slash fica em `commands`;
- botao fica em `interactions/buttons.js`;
- formulario fica em `interactions/modals.js`;
- menu de selecao fica em `interactions/selects.js`.

## `src/config`

- `env.js`: leitura de variaveis de ambiente.
- `ids.js`: IDs fixos da guild Notag, cargos, canais e categorias.
- `permissions.js`: grupos de permissao usados pelo bot.

Este projeto depende muito de `ids.js`. Se um canal ou cargo mudar no Discord, atualize esse arquivo.

## `src/database`

- `connection.js`: abre conexao SQLite.
- `migrate.js`: cria/altera tabelas.
- `backup.js`: cria backups do banco.

Migrations rodam automaticamente no startup.

## `src/modules`

Cada modulo concentra uma area de negocio.

| Modulo | Responsabilidade |
| --- | --- |
| `albion` | sincronizacao Albion e imports semanais |
| `audit` | logs de auditoria |
| `campaigns` | campanha 900m e decisoes de doacao |
| `csv` | import/export CSV, HTML de saldos, backup de saldos |
| `deposit` | deposito manual e deposito por lista |
| `events` | eventos, vagas, voz, loot split, financeiro, carreira |
| `finance` | saldos, transacoes, saques, pedidos de pagamento |
| `members` | lista de membros, painel do membro, inatividade |
| `objectives` | objetivos temporarios |
| `operations` | painel ADM, lembretes, fila de pendencias |
| `registration` | registro de nick Albion |
| `reports` | relatorio diario |
| `setup` | paineis fixos e auditoria/renomeacao de canais |
| `tutorials` | tutorial HTML para staff |
| `voice` | sessoes de voz e recuperacao pos-reinicio |

## Padrao Repository/Service

Alguns modulos usam dois arquivos:

- `*.repository.js`: acesso ao banco.
- `*.service.js`: regra de negocio.

Exemplos:

- `events.repository.js` e `events.service.js`
- `finance.repository.js` e `finance.service.js`
- `campaigns.repository.js` e `campaigns.service.js`

Quando adicionar comportamento novo, tente seguir esse padrao.

## Fluxo De Interacao

```text
Discord
  -> src/index.js
  -> interactions/router.js
  -> commands/handlers.js ou interactions/buttons.js/modals.js/selects.js
  -> modules/* service
  -> modules/* repository
  -> database SQLite
```

## Fluxo De Evento

```text
Painel Criar Evento
  -> modal event:create
  -> events.createEventFromModal
  -> events.repository cria evento
  -> mensagem no canal de participacao
  -> membros clicam vagas
  -> caller inicia
  -> sala de voz criada
  -> voice registra tempo
  -> caller finaliza
  -> modal de loot
  -> revisao/split
  -> financeiro aprova
  -> finance deposita saldos
```

## Recursos Removidos

Dashboard, leiloes, enquetes e FAQ foram removidos para manter o bot mais simples.
