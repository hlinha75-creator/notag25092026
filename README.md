# Plataforma NOTAG

Plataforma da guild NOTAG para Albion Online, composta por bot Discord, site publico, portal do membro e dashboard da staff.

A plataforma centraliza a rotina da guild: cria eventos, gerencia vagas, abre sala de voz, acompanha participacao, finaliza eventos com loot split, deposita saldos, paga membros, apoia recrutamento, controla membros ativos/inativos, oferece jogos e sorteios e gera relatorios de desempenho.

Este projeto e feito somente para a guild Notag.

## Documentacao

`MEMORY.md` e este `README.md` sao as fontes principais de verdade. A pasta `docs/` contem guias complementares e nao deve contradizer esses dois arquivos.

A documentacao principal fica em `docs/`:

- [docs/index.html](docs/index.html): versao HTML interativa e didatica para abrir no navegador.
- [docs/VISAO_GERAL.md](docs/VISAO_GERAL.md): resumo do projeto, publico, principais fluxos e responsabilidades.
- [docs/STAFF.md](docs/STAFF.md): guia pratico para staff, ADM, caller, recrutador e tesouraria.
- [docs/COMANDOS.md](docs/COMANDOS.md): comandos slash e paineis do bot.
- [docs/OPERACAO.md](docs/OPERACAO.md): como rodar localmente, publicar comandos, usar backups e operar no dia a dia.
- [docs/ARQUITETURA.md](docs/ARQUITETURA.md): estrutura do codigo e explicacao dos modulos.
- [docs/DADOS.md](docs/DADOS.md): banco SQLite, arquivos reais, CSVs, backups e cuidados.
- [docs/MANUTENCAO.md](docs/MANUTENCAO.md): como adicionar comando, painel, botao, modal e modulo novo.

## Rodando no VS Code

1. Abra esta pasta no VS Code:

   ```text
   C:\Users\Lucas\Documents\bot notag
   ```

2. Instale as dependencias:

   ```bash
   npm install
   ```

3. Copie `.env.example` para `.env`, preencha as variaveis e valide:

   ```bash
   npm run env:check
   ```

   Para ativar o dashboard e o login da staff, preencha tambem:

   ```env
   DISCORD_CLIENT_SECRET=
   DASHBOARD_BASE_URL=http://localhost:8080
   DASHBOARD_SESSION_SECRET=
   DASHBOARD_PORT=8080
   ```

   O `DISCORD_CLIENT_SECRET` vem do Discord Developer Portal. Use uma chave longa e aleatoria em `DASHBOARD_SESSION_SECRET`. Nunca compartilhe esses dois valores nem os adicione ao Git.

4. Registre os comandos slash no Discord:

   ```bash
   npm run deploy:commands
   ```

5. Inicie o bot:

   ```bash
   npm start
   ```

No VS Code tambem existe uma configuracao de debug chamada `Iniciar bot`.

## Dashboard Web

- A pagina publica abre em `/` e nao expoe dados do banco.
- O dashboard da staff abre em `/dashboard` apos o login com Discord.
- A administracao completa e permitida ao dono do servidor e aos cargos `ADM`, `Staff` e `Tesoureiro`.
- `Caller` e `Recrutador` podem revisar cadastros sem receber acesso administrativo completo.
- O dashboard executa operacoes de eventos, saques, registros, membros, importacoes e regear com autenticacao, CSRF e auditoria.
- Os dados atualizam a cada 30 segundos enquanto a aba esta visivel e tambem podem ser atualizados manualmente.
- Cadastre `https://notag.discloud.app/auth/discord/callback` como Redirect URI no Discord Developer Portal antes da publicacao.
- Na Discloud, o projeto roda como `TYPE=site`, subdominio `notag`, escutando `0.0.0.0:8080`; o bot e o dashboard continuam no mesmo processo e compartilham o SQLite.

## Scripts Uteis

- `npm start`: inicia o bot.
- `npm run env:check`: informa quais variaveis obrigatorias ainda faltam, sem mostrar segredos.
- `npm run deploy:commands`: registra os comandos slash.
- `npm run clear:commands`: limpa comandos antigos globais e da guild.
- `npm run audit:channels`: audita canais do servidor.
- `npm run audit:nicks`: audita apelidos.
- `npm run rename:channels`: padroniza nomes de canais.
- `npm run import:members`: importa snapshot de membros.
- `npm run backup:db`: cria backup manual do SQLite.
- `npm run restore:db`: restaura backup manual.
- `npm run restore:campaign900m`: restaura snapshot da campanha 900m.

## Seguranca

- Nunca envie `.env` para o Git.
- Nunca envie `data/notag.sqlite` para o Git.
- O banco real fica em `data/notag.sqlite`.
- Backups ficam em `data/backups/`.
- Os CSVs em `resources/` podem conter dados reais da guild.
- Antes de remover um modulo, confira referencias em `src/index.js`, `src/commands/handlers.js`, `src/interactions/`, `src/modules/` e `src/database/migrate.js`.

## Estado Atual

O dashboard atual e a implementacao nova aprovada depois da remocao do dashboard antigo. Jogos e sorteios atuais sao parte permanente do produto. Modulos historicos desconectados permanecem desativados ate decisao explicita.
