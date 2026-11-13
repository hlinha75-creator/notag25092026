# Visao Geral

## O Que E

O Notag Bot e o bot Discord oficial da guild Notag no Albion Online.

Ele foi criado para reduzir trabalho manual da staff e deixar a rotina da guild mais organizada: eventos, vagas, salas de voz, loot split, saldos, pagamentos, recrutamento, gestao de membros, relatorios e acompanhamento de performance dos jogadores ativos.

## Para Quem E Esta Documentacao

Esta documentacao foi escrita para:

- Lucas, para conseguir retomar o projeto sem precisar redescobrir tudo pelo codigo.
- Staff da Notag, para entender como usar os paineis e comandos principais.
- ADM, caller, recrutador e tesouraria, cada um dentro das permissoes que o bot ja reconhece.

O foco nao e ser uma documentacao tecnica pesada. O foco e deixar o projeto redondo, consultavel e facil de operar.

## Escopo Do Bot

O bot e feito somente para a guild Notag. Ele usa IDs fixos de cargos, canais e categorias em `src/config/ids.js`.

Por isso, ele nao e um bot generico para qualquer servidor sem ajustes. Para usar em outra guild seria necessario trocar IDs, revisar permissoes, canais, paineis, mensagens e fluxos.

## Principais Funcionalidades

- Criar eventos normais com vagas de Tank, Healer, Suporte e DPS.
- Criar Raid Avalon Full com composicao fixa e selecao por arma.
- Gerenciar entrada, saida, espectador e pausa de participacao.
- Iniciar evento criando sala de voz.
- Finalizar evento e abrir revisao de loot.
- Calcular loot split com loot total, reparo, sacos de prata e taxa.
- Enviar evento para financeiro.
- Aprovar pagamento e depositar saldo nos participantes.
- Consultar saldo e solicitar saque.
- Criar pedido de pagamento para servicos ou pendencias.
- Importar/exportar saldos e logs financeiros.
- Registrar nick Albion de membros.
- Sincronizar Discord x Albion com CSV/TSV oficial.
- Gerar listas de membros, convidados, pendentes e sem tag.
- Verificar inatividade por eventos e por convidados.
- Importar rank PvE e logs semanais do Albion.
- Criar objetivos temporarios no chat.
- Gerar relatorio diario de membros Albion e voz Discord.
- Manter painel ADM com pendencias e rotinas.
- Gerar HTMLs auxiliares sob demanda.

## Fluxo Mais Importante

O fluxo mais importante do projeto e:

1. Staff/caller cria um evento pelo painel.
2. Membros entram nas vagas.
3. Staff/caller inicia o evento.
4. O bot cria sala de voz e acompanha participacao.
5. Staff/caller finaliza o evento.
6. O bot pede dados do loot e cria canal de revisao.
7. Staff ajusta participantes e tempos se precisar.
8. Staff envia para financeiro.
9. Tesouraria/staff aprova.
10. O bot deposita saldo para os participantes.
11. O membro pode consultar saldo ou solicitar saque.

## Pontos A Confirmar

Alguns detalhes nao estavam 100% lembrados no momento desta documentacao:

- Funcionalidades antigas removidas: dashboard, leiloes, enquetes, FAQ, OCR e jogo de frutas.
- Se existem variaveis secretas alem de `.env.example`.
- Se o bot tem permissao administrativa completa no Discord.
- Se existe rotina oficial de backup alem dos backups automaticos e manuais.
- Quais dados podem ou nao ser versionados alem de `.env`, banco SQLite e backups.

Enquanto isso nao for confirmado, trate tudo que envolve banco, CSV real, token e IDs da guild como sensivel.
