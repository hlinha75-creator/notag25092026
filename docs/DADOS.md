# Dados

## Banco Principal

O banco principal e SQLite.

Caminho padrao:

```text
data/notag.sqlite
```

Configurado por:

```env
DATABASE_PATH=./data/notag.sqlite
```

Este banco contem dados reais da guild e nao deve ser commitado.

## Arquivos Sensíveis

Nao versionar:

- `.env`
- `data/notag.sqlite`
- backups do banco com dados reais
- exports CSV com dados financeiros ou membros reais
- qualquer arquivo contendo token, webhook ou credenciais

Arquivos com cuidado:

- `resources/season32/*.csv`: informado como dados reais.
- `data/reports/*.html`: pode conter dados reais.
- exports gerados por `/exportar`.

## Backups

Backups ficam em:

```text
data/backups/
```

O bot cria backup:

- no startup;
- antes de migrations pendentes;
- manualmente com `npm run backup:db`.

Tambem existe backup/export de saldos via bot, usado no painel de arquivos e rotinas automaticas.

## Restore

Comando:

```bash
npm run restore:db
```

Antes de restaurar:

1. Pare o bot se estiver em producao.
2. Confirme qual backup sera restaurado.
3. Guarde uma copia do banco atual.
4. Depois de restaurar, inicie o bot e veja logs de migration.

## Tabelas Principais

As tabelas sao criadas em `src/database/migrate.js`.

Principais grupos:

### Membros E Registro

- `users`
- `registrations`
- `guild_verifications`
- `guild_verification_pending_replies`
- `member_snapshots`
- `member_snapshot_rows`

Uso:

- vincular Discord a nick Albion;
- revisar registro;
- comparar membros Discord x Albion;
- gerar relatorios/listas.

### Eventos

- `events`
- `event_participants`
- `event_voice_sessions`
- `event_reviews`
- `event_templates`

Uso:

- criar eventos;
- guardar participantes;
- calcular tempo de voz;
- salvar revisao de loot;
- controlar status de pagamento.

### Saldos E Financeiro

- `balances`
- `balance_transactions`
- `withdraw_requests`
- `payment_requests`

Uso:

- saldo atual por membro;
- historico financeiro;
- saque;
- pedido de pagamento.

### Voz

- `voice_sessions`

Uso:

- historico bruto de voz;
- relatorios diarios;
- inatividade;
- performance/atividade.

### Recursos Removidos

Tabelas antigas de enquetes, leiloes, frutas e OCR podem existir em bancos ja migrados, mas o runtime atual nao usa esses recursos.

### Albion

- `albion_imports`
- `albion_pve_rankings`
- `albion_guild_logs`
- `albion_stats_ocr_submissions` legado, sem uso pelo bot atual

Uso:

- rank PvE semanal;
- logs gerais da guild;
- suporte a recrutamento/performance.

### Raid Avalon E Carreira

- `raid_avalon_registrations`
- `raid_avalon_state`
- `raid_avalon_events`
- `raid_avalon_event_participants`
- `raid_avalon_weapon_career`
- `career_point_transactions`

Uso:

- Raid Avalon Full;
- arma escolhida;
- IP;
- tags por arma;
- pontuacao por classe/arma.

### Campanha

- `campaigns`
- `campaign_event_payouts`
- `campaign_contributions`

Uso:

- campanha 900m;
- doacao de saldo;
- escolha entre doar pagamento de evento ou receber saldo.

### Operacao E Auditoria

- `audit_logs`
- `setup_messages`
- `csv_imports`
- `balance_csv_backups`
- `server_usage_events`
- `operation_reminders`
- `persistent_bot_messages`

Uso:

- auditoria;
- paineis fixos;
- imports;
- tracking de uso;
- lembretes;
- mensagens persistentes.

## CSVs

O bot trabalha com CSV/TSV em varios fluxos:

- importar saldos;
- exportar saldos;
- exportar transacoes;
- exportar auditoria;
- exportar voz;
- importar lista oficial Albion;
- importar rank PvE;
- importar logs Albion;
- gerar lista Discord x Albion.

Regra segura:

Sempre usar fluxos com previa e confirmacao quando forem alterar banco ou cargos.

## Dados Reais Em `resources/`

Arquivos atuais:

```text
resources/season32/pontos_normais.csv
resources/season32/pontos_temporada.csv
```

Foram informados como dados reais.

Cuidados:

- nao publicar sem revisar;
- nao apagar sem backup;
- se forem temporarios, documentar quando podem ser removidos.

## Relatorios HTML

Existe:

```text
data/reports/saldos-guild-discord-2026-06-23.html
```

Pode conter dados reais de saldos/membros. Tratar como sensivel.

## Checklist Antes De Compartilhar Arquivos

- Tem token, webhook ou senha?
- Tem saldo de membro?
- Tem lista de membros da guild?
- Tem nick Albion associado a Discord?
- Tem historico financeiro?
- Tem dados de performance/atividade?

Se sim, nao compartilhar publicamente.
