# Notag Bot

Bot Discord da guild Notag para Albion Online.

O Notag Bot centraliza a rotina da guild: cria eventos, gerencia vagas, abre sala de voz, acompanha participacao, finaliza eventos com loot split, deposita saldos, paga membros, apoia recrutamento, controla membros ativos/inativos e gera relatorios de desempenho.

Este projeto e feito somente para a guild Notag.

## Documentacao

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

3. Copie `.env.example` para `.env` e preencha pelo menos:

   ```env
   DISCORD_TOKEN=
   CLIENT_ID=
   GUILD_ID=
   DATABASE_PATH=./data/notag.sqlite
   NODE_ENV=development
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
- O acesso e permitido apenas ao dono do servidor e aos cargos `ADM` ou `Staff` configurados em `src/config/ids.js`.
- Todas as telas da primeira versao sao somente leitura.
- Os dados atualizam a cada 30 segundos enquanto a aba esta visivel e tambem podem ser atualizados manualmente.
- Cadastre `https://notag.discloud.app/auth/discord/callback` como Redirect URI no Discord Developer Portal antes da publicacao.
- Na Discloud, o projeto roda como `TYPE=site`, subdominio `notag`, escutando `0.0.0.0:8080`; o bot e o dashboard continuam no mesmo processo e compartilham o SQLite.

## Scripts Uteis

- `npm start`: inicia o bot.
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

Documentacao criada para uso pessoal do Lucas e da staff. Alguns pontos estao marcados como "a confirmar" porque dependem de decisao operacional ou memoria externa ao codigo.
