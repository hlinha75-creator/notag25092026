# Manutencao

## Antes De Mexer

1. Veja `git status`.
2. Leia o arquivo que sera alterado.
3. Confira se existe mudanca nao sua.
4. Faça backup do banco se for mexer em migrations ou financeiro.
5. Teste localmente quando possivel.

Comando:

```bash
git status --short
```

## Adicionar Comando Slash

1. Edite `src/commands/definitions.js`.
2. Adicione o comando com `SlashCommandBuilder`.
3. Edite `src/commands/handlers.js`.
4. Trate `interaction.commandName`.
5. Use `can(interaction.member, 'permissao')` se for comando sensivel.
6. Rode:

```bash
npm run deploy:commands
```

Exemplo simples:

```js
if (interaction.commandName === 'meu_comando') {
  return interaction.reply({ content: 'Ok.', flags: MessageFlags.Ephemeral });
}
```

## Adicionar Botao

1. Crie o botao onde o painel/mensagem e montado.
2. Use `customId` com prefixo claro.
3. Trate em `src/interactions/buttons.js`.

Exemplo de `customId`:

```text
finance:minha_acao:123
```

No handler:

```js
const [scope, action, id] = interaction.customId.split(':');

if (scope === 'finance' && action === 'minha_acao') {
  // logica
}
```

## Adicionar Modal

1. Botao chama `showModal`.
2. Modal recebe `customId`.
3. `src/interactions/modals.js` trata o submit.

Campos comuns:

- `TextInputStyle.Short`
- `TextInputStyle.Paragraph`

Use modal para:

- valores financeiros;
- observacoes;
- formulario de evento;
- formulario de registro;
- ajustes manuais.

## Adicionar Select/Menu

1. Crie select com `StringSelectMenuBuilder`, `UserSelectMenuBuilder` ou `ChannelSelectMenuBuilder`.
2. Trate em `src/interactions/selects.js`.

Use select para:

- escolher membro;
- escolher canal;
- escolher funcao/vaga;
- escolher item de lista.

## Adicionar Modulo Novo

Padrao recomendado:

```text
src/modules/minha-area/minhaArea.service.js
src/modules/minha-area/minhaArea.repository.js
```

Use `repository` para banco e `service` para regra.

Se nao precisar de banco, pode ter so `service.js`.

## Adicionar Tabela No Banco

1. Edite `src/database/migrate.js`.
2. Adicione nova migration no fim da lista.
3. Use nova versao incremental.
4. Nunca altere migration antiga que ja rodou em producao.
5. Teste com copia do banco.

Exemplo:

```js
{
  version: 27,
  name: 'minha_nova_tabela',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS minha_tabela (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
}
```

## Adicionar Permissao

Edite:

```text
src/config/permissions.js
```

Exemplo:

```js
const groups = {
  minhaAcao: ['staff', 'adm']
};
```

Depois use:

```js
if (!can(interaction.member, 'minhaAcao')) {
  return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
}
```

## Adicionar Canal Ou Cargo

Edite:

```text
src/config/ids.js
```

Cuidados:

- confirme ID correto no Discord;
- mantenha nome legivel;
- rode `/setup` se painel depender do canal;
- rode `/auditar_canais` para conferir.

## Fluxos Que Exigem Mais Cuidado

### Financeiro

Arquivos principais:

- `src/modules/finance/finance.service.js`
- `src/modules/finance/finance.repository.js`
- `src/interactions/buttons.js`
- `src/interactions/modals.js`

Risco:

- saldo duplicado;
- saldo negativo indevido;
- transacao sem log;
- pagamento sem aprovacao.

Sempre verificar `balance_transactions`.

### Eventos E Loot Split

Arquivos principais:

- `src/modules/events/events.service.js`
- `src/modules/events/events.repository.js`
- `src/modules/events/lootCalculator.js`
- `src/modules/voice/voice.service.js`

Risco:

- tempo contado errado;
- participante fora do split;
- pagamento duplicado;
- evento preso em status incorreto.

### Registro E Cargos

Arquivos principais:

- `src/modules/registration/registration.service.js`
- `src/modules/albion/guildVerification.service.js`
- `src/modules/members/inactiveEvents.service.js`
- `src/modules/members/inactiveGuests.service.js`

Risco:

- cargo errado em membro;
- convidado promovido indevidamente;
- membro removido por inatividade sem revisar previa.

### Migrations

Arquivo:

```text
src/database/migrate.js
```

Risco:

- alterar banco real sem backup;
- migration quebrar startup;
- dados antigos ficarem incompatíveis.

## Testes Manuais Recomendados

Depois de alterar comandos/interacoes:

1. `npm start`
2. Ver se bot fica online.
3. Rodar comando alterado.
4. Clicar botoes relacionados.
5. Conferir se resposta e ephemeral quando apropriado.
6. Conferir logs do terminal.
7. Conferir banco se mexeu em dados.

## Quando Atualizar Esta Documentacao

Atualize `docs/` quando:

- criar comando novo;
- mudar fluxo da staff;
- mudar permissao;
- mudar canal/cargo;
- adicionar tabela;
- mudar rotina de deploy;
- adicionar dado sensivel novo;
- remover funcionalidade antiga.

## Lista De Pendencias De Documentacao

- Confirmar quais funcionalidades antigas devem aparecer para staff.
- Confirmar politica oficial de backup.
- Dashboard antigo removido; nao recriar sem decisao explicita.
- Confirmar permissoes reais do bot no Discord.
- Confirmar todos os arquivos que devem ser tratados como dados reais.
