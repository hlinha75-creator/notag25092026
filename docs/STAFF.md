# Guia Da Staff

Este guia explica o uso pratico do Notag Bot por ADM, staff, caller, recrutador e tesouraria.

## Cargos E Responsabilidades

O bot trabalha com estes grupos:

- `adm`: acesso amplo a rotinas administrativas.
- `staff`: aprova registros, opera eventos, financeiro e rotinas de membros.
- `treasurer`: foco em saldos, pagamentos, CSVs e financeiro.
- `caller`: cria e gerencia eventos.
- `recruiter`: ajuda em registro, membros e eventos.
- `member`: usa funcoes basicas como saldo, eventos e registro.
- `guest`: acesso inicial apos registro, antes da aprovacao como membro.
- `noTag`: cargo usado quando alguem deixa de ser convidado ativo.

O dono do servidor tambem passa nas checagens de permissao.

## Criar Evento Normal

Use o painel "Criar evento" e clique em **Criar Evento**.

O bot abre um formulario com:

- `Content`: nome do evento. Exemplo: `DG Grupo T8+`.
- `Local`: local de encontro. Exemplo: `Martlock Portal > HO Loch`.
- `Data/Hora`: horario Albion/UTC. Exemplo: `23/06 15:00 utc`.
- `Tier da Build`: requisito. Exemplo: `T8 equivalente + set Skip`.
- `Tank, Healer, Suporte, DPS`: vagas. Exemplo: `1,1,1,3`.

Depois de criado, o evento aparece no canal de participacao com botoes de funcao.

## Criar Raid Avalon Full

Use o painel "Criar evento" e clique em **Raid Full**.

O bot abre um formulario com:

- `Dia e hora Albion`
- `Local`
- `Tier da DG`
- `Tier da build`

A Raid Full cria uma composicao de 20 vagas:

- 3 Tanks
- 3 Healers
- 3 Suportes
- 11 DPS

Os membros escolhem funcao/arma e informam IP.

## Iniciar Evento

No evento aberto, clique em **Iniciar**.

O bot:

- muda o status para em andamento;
- cria sala de voz do evento;
- acompanha entrada e saida dos membros na call;
- atualiza a mensagem do evento.

Se o evento esta proximo do horario, o bot tambem pode criar cargo temporario de aviso e mandar lembrete.

## Durante O Evento

Membros podem:

- entrar na vaga;
- entrar como espectador;
- pausar participacao;
- em evento em andamento, clicar em **Quero participar**.

Staff/caller deve conferir se as pessoas estao na call correta, porque o bot usa voz para calcular participacao.

## Finalizar Evento E Criar Loot Split

Clique em **Finalizar**.

O bot abre o formulario de loot:

- `Loot total`: valor bruto do loot.
- `Reparo`: custo total de reparo.
- `Sacos de prata`: prata em sacos.
- `Taxa %`: taxa da guild.
- `DPS/Fama links ou obs`: observacoes ou links.

Exemplos de valores:

- `10m`
- `500k`
- `12000000`

Depois disso, o bot:

- calcula loot liquido;
- cria canal de revisao;
- gera split por participacao;
- orienta a anexar CSV do loot logger se houver.

## Revisar Participantes Do Split

No canal de revisao, staff/caller pode:

- editar membro;
- adicionar membro;
- remover membro;
- ajustar funcao;
- ajustar minutos;
- colocar motivo do ajuste.

Exemplo de tempo:

- `75` para 75 minutos.
- `1h15m` para 1 hora e 15 minutos.

Depois de revisar, envie ao financeiro.

## Aprovar Pagamento

Quando o evento chega ao financeiro, staff/tesouraria pode aprovar.

Ao aprovar, o bot:

- registra transacoes;
- deposita saldo para os participantes;
- atualiza logs financeiros;
- pode atualizar pontos de carreira por arma/classe.

Regra de carreira atual:

- 30 minutos = 1 ponto na classe.
- 30 minutos = 1 ponto na arma/funcao.

## Consultar Saldo

Membro pode usar:

- botao **Consultar** no painel de saldo;
- comando `/saldo`.

Staff/tesouraria pode consultar saldo de outro membro usando `/saldo membro:<usuario>`.

## Sacar Saldo

Membro clica em **Sacar** no painel de saldo.

O bot pede valor e observacao. Para saque, o valor precisa ser digitado somente com numeros, sem `m`, `k`, ponto ou virgula.

Exemplo correto:

```text
1000000
```

A staff/tesouraria revisa:

- aprovar saque;
- pagar saque;
- recusar saque.

## Pedido De Pagamento

Membro pode clicar em **Pedir pagamento** no painel de saldo.

Use quando alguem fez um servico para a guild, vendeu loot da guild ou ficou com algo pendente enquanto a staff estava offline.

O membro informa:

- valor;
- servico;
- motivo/descricao;
- prova, print ou link, se tiver.

A staff/tesouraria aprova e o bot deposita no saldo.

## Deposito Manual

No painel "Deposito", staff/tesouraria pode usar:

- **Criar deposito**: divide valor entre participantes selecionados.
- **Deposito por lista**: tenta casar nomes de uma lista com membros do Discord.

Use para pagamentos que nao vieram de evento normal.

## Registro E Recrutamento

Membro novo usa:

- botao **Registrar Nick**;
- ou comando `/registro`.

Ele informa o nick Albion. O bot:

- salva registro pendente;
- entrega cargo de convidado;
- envia pedido para canal de revisao.

Staff/recrutador decide:

- **Aprovar Membro**
- **Manter Convidado**

## Sincronizar Discord X Albion

Use:

```text
/sincronizar_albion arquivo:<csv-ou-tsv>
```

O arquivo precisa vir da lista oficial da guild no Albion e ter coluna de nome de personagem.

O bot mostra previa antes de aplicar:

- encontrados;
- ausentes;
- pendencias resolvidas;
- possiveis problemas.

Confirme somente depois de revisar.

## Inativos

Use:

```text
/inativos tipo:eventos
/inativos tipo:convidados
```

Ou use os botoes do painel ADM.

Tipos:

- `eventos`: Membro -> Convidado, baseado em baixa participacao em eventos/call.
- `convidados`: Convidado -> Sem Tag, baseado em inatividade.

O bot sempre gera previa antes de alterar cargos.

## Rotina Semanal Albion

O painel ADM lembra a rotina:

1. Enviar CSV/TSV atual da guild Albion para verificar registros pendentes.
2. Enviar rank PvE e logs gerais do Albion quando tiver arquivo novo.
3. Guardar prints de pontos de temporada quando virar ciclo.
4. Revisar links pendentes de builds PvE.
5. Conferir backup de saldos.
6. Olhar eventos financeiros pendentes, saques e logs do Discloud.

## Regra De Ouro

Quando o bot mostrar previa antes de alterar saldos, cargos ou membros, revise antes de confirmar.

Se tiver duvida, cancele. Cancelar previa nao altera banco nem cargos.
