const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

function panelPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('Tutorial da staff')
        .setDescription('Baixe o guia HTML para aprender os fluxos principais do NOTAG Bot.')
        .setColor(0x4f46e5)
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('tutorial:staff_html')
          .setLabel('Baixar tutorial HTML')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('academy:staff:overview')
          .setLabel('Acompanhar academia')
          .setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

function htmlAttachment() {
  return new AttachmentBuilder(Buffer.from(renderHtml(), 'utf8'), {
    name: `tutorial-notag-staff-${dateKey()}.html`
  });
}

function dateKey() {
  return new Date().toISOString().slice(0, 10);
}

function renderHtml() {
  const generatedAt = new Date().toISOString();
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tutorial NOTAG Bot - Staff</title>
  <style>
    :root { --bg:#f4f6f8; --panel:#fff; --ink:#182230; --muted:#667085; --line:#d9dee7; --blue:#2563eb; --green:#15803d; --red:#b42318; --amber:#b54708; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font-family:Inter, ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif; line-height:1.5; }
    main { width:min(1120px, calc(100% - 28px)); margin:0 auto; padding:28px 0 44px; }
    header { display:grid; gap:8px; margin-bottom:18px; }
    h1 { margin:0; font-size:34px; line-height:1.08; }
    h2 { margin:0 0 10px; font-size:20px; }
    h3 { margin:16px 0 8px; font-size:16px; }
    p { margin:0 0 10px; color:var(--muted); }
    .grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px; }
    section, .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; box-shadow:0 10px 30px rgba(15,23,42,.06); }
    section.wide { grid-column:1 / -1; }
    ul, ol { margin:8px 0 0 20px; padding:0; }
    li { margin:6px 0; }
    code { background:#eef2f6; border:1px solid var(--line); border-radius:5px; padding:1px 5px; font-family:"Cascadia Mono", Consolas, monospace; }
    .pill { display:inline-block; border-radius:999px; padding:3px 8px; margin:2px 5px 2px 0; font-size:12px; font-weight:800; background:#eef2f6; color:#344054; }
    .ok { color:var(--green); } .warn { color:var(--amber); } .bad { color:var(--red); } .info { color:var(--blue); }
    table { width:100%; border-collapse:collapse; margin-top:8px; }
    th, td { border-bottom:1px solid var(--line); padding:9px 8px; text-align:left; vertical-align:top; }
    th { font-size:12px; text-transform:uppercase; color:var(--muted); background:#f8fafc; }
    .flow { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:8px; margin-top:8px; }
    .step { border:1px solid var(--line); border-radius:8px; padding:10px; background:#fbfcfe; }
    .step strong { display:block; margin-bottom:4px; }
    @media (max-width:860px) { .grid, .flow { grid-template-columns:1fr; } h1 { font-size:28px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <span class="pill">NOTAG Bot</span>
      <h1>Tutorial da staff</h1>
      <p>Guia operacional para ADM, staff, caller, recrutador e tesouraria. Gerado em ${escapeHtml(generatedAt)}.</p>
    </header>

    <section class="wide">
      <h2>Regra de ouro</h2>
      <p>Qualquer acao que mexe com saldo, cargo ou evento real deve ter previa quando existir, backup recente e teste fake quando for novidade.</p>
      <div class="flow">
        <div class="step"><strong>1. Conferir</strong>Leia a previa e o CSV anexo.</div>
        <div class="step"><strong>2. Confirmar</strong>So confirme se os nomes, valores e cargos fazem sentido.</div>
        <div class="step"><strong>3. Registrar</strong>O bot gera logs/auditoria para saldos, cargos e eventos.</div>
        <div class="step"><strong>4. Corrigir</strong>Se algo parece errado, pare e chame ADM antes de aplicar.</div>
      </div>
    </section>

    <div class="grid">
      <section>
        <h2>Painel ADM</h2>
        <p>O painel principal mostra a fila de pendencias e botoes resumidos.</p>
        <ul>
          <li><code>Retirar saldo</code>: abre busca de membro para ajuste manual de saldo.</li>
          <li><code>Financeiro</code>: saldo, logs financeiros e importacao CSV.</li>
          <li><code>Albion</code>: sincronizacao, rank PvE e logs semanais.</li>
          <li><code>Eventos</code>: carreira, recalculo e inativos por evento.</li>
          <li><code>Membros</code>: Discord x Albion e convidados inativos.</li>
          <li><code>Arquivos</code>: exportacoes para conferencia e backup.</li>
          <li><code>Tutorial</code>: baixa este guia atualizado.</li>
        </ul>
      </section>

      <section>
        <h2>Eventos</h2>
        <ol>
          <li>Caller/staff cria evento no painel de criar evento.</li>
          <li>Membros entram por vaga, assistem ou entram direto na call como espectador.</li>
          <li>Ao iniciar, o bot cria sala de voz e conta tempo de participantes.</li>
          <li>Ao finalizar, o criador informa loot, reparo, sacos e taxa.</li>
          <li>O evento vai para revisao. Ajuste participacao se precisar.</li>
          <li>Depois envie para financeiro. Staff aprova ou devolve para editar.</li>
        </ol>
      </section>

      <section>
        <h2>Financeiro</h2>
        <ul>
          <li>Saldos sao numeros inteiros de prata no banco SQLite.</li>
          <li>O bot usa ledger: entradas e saidas ficam no historico.</li>
          <li>Saques so descontam saldo quando aprovados/pagos pela staff.</li>
          <li>Depositos, saques e pagamentos geram log e DM para o membro.</li>
          <li>Importacao CSV de saldos exige previa e confirmacao.</li>
        </ul>
      </section>

      <section>
        <h2>Registro e Albion</h2>
        <ul>
          <li><code>/sincronizar_albion arquivo</code> atualiza vinculo Discord x Albion.</li>
          <li>Ele tambem resolve registros pendentes encontrados na lista da guild.</li>
          <li>Nomes ambiguos ou conflitantes sao ignorados para evitar erro.</li>
          <li>Rank PvE semanal e logs detalhados foram pausados para manter o bot simples. OCR de imagem foi removido.</li>
        </ul>
      </section>

      <section>
        <h2>Inativos</h2>
        <ul>
          <li><code>/inativos tipo:eventos</code>: previa de Membro para Convidado.</li>
          <li><code>/inativos tipo:convidados</code>: previa de Convidado para Sem Tag.</li>
          <li>Nunca aplique sem ler o CSV de previa.</li>
          <li>ADM, staff, tesoureiro, caller, recrutador e dono nao devem ser alterados.</li>
          <li>O aviso publico deve ser respeitoso: nao e punicao.</li>
        </ul>
      </section>

      <section>
        <h2>Meta 900m</h2>
        <ul>
          <li>Quando um evento finalizado gera loot split, membros podem doar a parte para a meta.</li>
          <li>O painel mostra total, falta e quantidade de contribuidores.</li>
          <li>Detalhes ficam no botao <code>Ver lista</code>, somente para quem clicou.</li>
          <li>Doacao de saldo atual tambem passa por confirmacao.</li>
        </ul>
      </section>

      <section>
        <h2>Rotina semanal</h2>
        <ol>
          <li>Enviar lista atual da guild pelo <code>/sincronizar_albion</code>.</li>
          <li>Conferir eventos em revisao e pagamentos pendentes.</li>
          <li>Conferir saques, pedidos de pagamento e ajustes manuais.</li>
          <li>Conferir backups de saldos no canal de arquivos.</li>
          <li>Olhar fila do Painel ADM.</li>
          <li>Conferir logs do Discloud se houve reinicio ou erro.</li>
        </ol>
      </section>

      <section class="wide">
        <h2>Comandos principais</h2>
        <table>
          <thead><tr><th>Comando</th><th>Uso</th><th>Cuidado</th></tr></thead>
          <tbody>
            <tr><td><code>/setup</code></td><td>Atualiza paineis fixos.</td><td>Use depois de deploy quando botoes/paineis mudarem.</td></tr>
            <tr><td><code>/sincronizar_albion</code></td><td>Atualiza Discord x Albion.</td><td>Leia a previa antes de confirmar.</td></tr>
            <tr><td><code>/exportar</code></td><td>Gera HTML/CSV de saldos, financeiro, voz, auditoria e membros.</td><td>Guarde arquivos importantes fora do Discord tambem.</td></tr>
            <tr><td><code>/importar</code></td><td>Importa CSV de saldos.</td><td>Confirme total antes/depois.</td></tr>
            <tr><td><code>/inativos</code></td><td>Gera previa de inatividade.</td><td>Nao aplicar sem revisar.</td></tr>
          </tbody>
        </table>
      </section>
    </div>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

module.exports = {
  htmlAttachment,
  panelPayload
};
