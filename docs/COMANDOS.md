# Comandos E Paineis

## Como Registrar Comandos

Sempre que adicionar, remover ou mudar comando slash, rode:

```bash
npm run deploy:commands
```

Se comandos antigos ficarem presos no Discord, use com cuidado:

```bash
npm run clear:commands
npm run deploy:commands
```

## Comandos Slash

### `/setup`

Posta ou atualiza os paineis fixos do bot.

Permissao no Discord: `ManageGuild`.

Permissao interna: `approvePayment`, ou seja, staff, ADM ou tesouraria.

Use quando:

- canais de painel foram apagados;
- botoes ficaram antigos;
- painel ADM precisa ser recriado;
- setup inicial em ambiente novo.

### `/saldo`

Consulta saldo.

Uso normal:

```text
/saldo
```

Staff/tesouraria pode consultar outro membro:

```text
/saldo membro:@usuario
```

Membro comum so consulta o proprio saldo.

### `/registro`

Abre formulario de registro de nick Albion.

Mesmo fluxo do botao **Registrar Nick**.

### `/objetivo`

Avisa objetivo temporario no chat Notag.

Permissao interna: `createObjective`.

Exemplo:

```text
/objetivo alerta:"orb roxa, ho loch, 5min"
```

Pode receber imagem opcional.

### `/exportar`

Exporta dados em CSV.

Permissao interna: `importCsv`, usado tambem para exportacao administrativa.

Tipos disponiveis:

- `balances`: saldos.
- `transactions`: financeiro.
- `audit`: auditoria.
- `voice_daily`: voz diaria.
- `voice`: voz bruta.
- `members_discord`: membros Discord.
- `albion_pve`: rank PvE Albion.
- `albion_logs`: logs Albion.

Opcao `data`:

- para voz: `AAAA-MM-DD`;
- para Albion: `2026-W25`.

### `/list`

Gera lista HTML filtravel de saldos com Discord e Albion.

Permissao interna: `importCsv`.

### `/importar`

Importa CSV de saldos com previa e confirmacao.

Permissao interna: `importCsv`.

Fluxo seguro:

1. Rodar comando com CSV anexado.
2. Bot mostra previa.
3. Conferir encontrados, ausentes, total antes e total depois.
4. Confirmar ou cancelar.

### `/sincronizar_albion`

Sincroniza dados manuais do Albion.

Permissoes internas:

- `tipo:membros`: `approveRegistration`.
- `tipo:fama_total`: `importCsv`.

Uso:

```text
/sincronizar_albion arquivo:<csv-ou-tsv> tipo:membros
/sincronizar_albion arquivo:<csv-ou-tsv> tipo:fama_total
/sincronizar_albion arquivo:<csv-ou-tsv> tipo:fama_pve
```

`tipo:membros` atualiza Discord x Albion, nicks no banco e registros pendentes.

Ao confirmar `tipo:membros`, o bot tambem concilia cargos: remove Membro/Convidado de quem nao tem vinculo valido ou nao entrou em call nos ultimos 7 dias, envia DM pedindo novo registro e concede Membro a quem tem vinculo, esta na lista atual da guild e entrou em call recentemente. Staff e dono do servidor sao protegidos.

Os avisos publicos de regularizacao saem em lotes de 5 membros a cada 10 minutos no canal de inatividade. Cada lote abre um topico, arquivado automaticamente depois de 3 dias.

`tipo:fama_total` atualiza os dados manuais usados no perfil do membro. Aceita colunas como:

```text
Character Name,Total Fame,PvE,PvP,Coleta,Craft
```

`tipo:fama_pve` aceita o ranking `Rank, Player, Guild Role, Amount` e atualiza somente a fama PvE, preservando PvP, Coleta e Craft.

O bot mostra previa antes de aplicar.

### `/inativos`

Gera previa de inatividade.

Permissao interna: `approveRegistration`.

Tipos:

- `eventos`: Membro -> Convidado.
- `convidados`: Convidado -> Sem Tag.

Opcoes:

- `dias_minimos`: janela de dias. Padrao atual: 30.
- `tempo_minimo`: minutos minimos em eventos para nao rebaixar. Usado no tipo `eventos`.

### `/albion importar_rank`

Importa Rank PvE semanal do Albion.

Permissao interna: `importCsv`.

Uso:

```text
/albion importar_rank arquivo:<arquivo> semana:2026-W25
```

Se nao informar semana, o bot usa a semana atual calculada internamente.

### `/albion importar_logs`

Importa logs gerais semanais da guild Albion.

Permissao interna: `importCsv`.

Uso:

```text
/albion importar_logs arquivo:<arquivo> semana:2026-W25
```

### `/albion resumo`

Mostra resumo semanal dos dados importados do Albion.

Uso:

```text
/albion resumo semana:2026-W25
```

### `/relatorio_diario`

Gera relatorio diario comparando membros Albion e voz Discord.

Permissao interna: `importCsv`.

Anexos:

- `atual`: arquivo atual de membros do Albion.
- `anterior`: arquivo anterior para comparar.
- `voz`: CSV diario de voz gerado pelo bot.
- `data`: data do relatorio em `AAAA-MM-DD`.

### `/renomear_canais`

Mostra ou aplica padronizacao de nomes dos canais do bot.

Permissao no Discord: `ManageGuild`.

Permissao interna: `approvePayment`.

Opcoes:

- `aplicar:false`: mostra previa.
- `aplicar:true`: renomeia de verdade.

### `/auditar_canais`

Lista todos os canais/categorias do servidor e marca os conhecidos pelo bot.

Permissao no Discord: `ManageGuild`.

Permissao interna: `approvePayment`.

## Paineis Fixos

Os paineis sao criados pelo `/setup`.

### Painel Criar Evento

Botoes:

- **Criar Evento**
- **Raid Full**

Canal configurado: `ids.channels.createEvent`.

### Painel Registro

Botao:

- **Registrar Nick**

Canal configurado: `ids.channels.register`.

### Painel Saldo

Botoes:

- **Consultar**
- **Sacar**
- **Pedir pagamento**

Canal configurado: `ids.channels.consultBalance`.

### Painel ADM

Botoes principais:

- **Retirar saldo**
- **Financeiro**
- **Albion**
- **Eventos**
- **Membros**
- **Arquivos**
- **Tutorial**
- **Atualizar fila**

Mostra fila de pendencias:

- eventos abertos, rodando, em revisao e pendentes de financeiro;
- saques solicitados e aprovados;
- pedidos de pagamento;
- backups com erro;
- registros pendentes;
- DMs pendentes de verificacao.

### Painel Deposito

Botoes:

- **Criar deposito**
- **Deposito por lista**

Canal configurado: `ids.channels.deposit`.

### Painel Lista De Membros

Botoes:

- **Atualizar**
- **Exportar CSV**
- **Membros**
- **Convidados**
- **Pendentes**
- **Sem tag**
- **Equipe**

### Painel Do Membro

Botoes:

- **Pontos influencia**
- **Pontos temporada**
- **Builds PvE**
- **Meu historico**
- **Perguntar staff**
- **Denuncia anonima**
- **Sugestao**
- **Conversar com bot**
- **Ver/Ocultar**

### Painel Arquivo

Botoes:

- **Exportar saldos**
- **Logs financeiros**
- **Auditoria**
- **Discord x Albion**
- **Importar CSV**

### Painel Tutorial Staff

Botao:

- **Baixar tutorial HTML**

## Permissoes Internas

As permissoes ficam em `src/config/permissions.js`.

| Acao | Cargos |
| --- | --- |
| `createEvent` | caller, staff, adm, recruiter |
| `createAuction` | member, caller, staff, adm, recruiter, treasurer |
| `createObjective` | member, caller, staff, adm, recruiter, treasurer |
| `createPoll` | member, caller, staff, adm, recruiter, treasurer |
| `approvePayment` | staff, adm, treasurer |
| `importCsv` | staff, adm, treasurer |
| `withdrawBalance` | staff, adm, treasurer |
| `approveRegistration` | staff, adm, recruiter |
| `assumeEvent` | staff, caller, treasurer, recruiter, adm |
### `/mesclar_contas`

Use `/mesclar_contas principal secundaria nome` quando duas contas Discord representam o mesmo jogador. Somente a staff autorizada pode confirmar a operacao. O bot mostra uma previa antes de somar saldo e historico financeiro na conta principal; voz, eventos e carreira passam a aparecer juntos no perfil.
