const { AttachmentBuilder } = require('discord.js');
const { toCsv } = require('./csv');

function htmlReportAttachment({ title, fileName, csvName, rows = [], columns = [], summary = [], subtitle = '' }) {
  const normalizedColumns = normalizeColumns(columns, rows);
  const csv = toCsv(rows, normalizedColumns.map((column) => column.key));
  const html = renderHtmlReport({
    title,
    subtitle,
    summary,
    rows,
    columns: normalizedColumns,
    csv,
    csvName: csvName || fileName.replace(/\.html?$/i, '.csv')
  });
  return new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: fileName });
}

function normalizeColumns(columns, rows) {
  const source = columns.length ? columns : Object.keys(rows[0] || {});
  return source.map((column) => {
    if (typeof column === 'string') return { key: column, label: column };
    return {
      key: column.key,
      label: column.label || column.key,
      align: column.align || '',
      format: column.format
    };
  }).filter((column) => column.key);
}

function renderHtmlReport({ title, subtitle, summary, rows, columns, csv, csvName }) {
  const generatedAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const safeRows = JSON.stringify(rows).replace(/</g, '\\u003c');
  const safeColumns = JSON.stringify(columns.map(({ key, label, align }) => ({ key, label, align }))).replace(/</g, '\\u003c');
  const formattedRows = rows.map((row) => Object.fromEntries(columns.map((column) => [
    column.key,
    formatCell(row[column.key], row, column)
  ])));
  const safeFormattedRows = JSON.stringify(formattedRows).replace(/</g, '\\u003c');
  const summaryCards = summary.map((item) => {
    const label = Array.isArray(item) ? item[0] : item.label;
    const value = Array.isArray(item) ? item[1] : item.value;
    return `<div class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }).join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --bg: #f6f7f9; --panel: #fff; --text: #111827; --muted: #667085; --line: #d0d5dd; --accent: #2563eb; --accent2: #0f766e; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(1220px, calc(100% - 28px)); margin: 22px auto 40px; }
    header { display: flex; justify-content: space-between; gap: 18px; align-items: flex-end; margin-bottom: 16px; }
    h1 { margin: 0 0 5px; font-size: 28px; line-height: 1.1; }
    p { margin: 0; color: var(--muted); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    button { border: 0; border-radius: 7px; padding: 10px 12px; background: var(--accent); color: #fff; font-weight: 800; cursor: pointer; }
    button.secondary { background: #475467; }
    .toolbar, .cards, .table-wrap { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
    .toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) 180px; gap: 10px; padding: 12px; margin-bottom: 12px; }
    input, select { width: 100%; min-height: 38px; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; font: inherit; background: #fff; color: var(--text); }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1px; overflow: hidden; margin-bottom: 12px; }
    .card { padding: 13px; background: #fff; }
    .card span { display: block; color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .card strong { display: block; margin-top: 5px; font-size: 20px; }
    .table-wrap { overflow: auto; }
    table { width: 100%; min-width: 820px; border-collapse: collapse; background: #fff; }
    th, td { padding: 9px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { position: sticky; top: 0; background: #f8fafc; color: var(--muted); font-size: 12px; text-transform: uppercase; z-index: 1; }
    td.num, th.num { text-align: right; }
    tr:hover td { background: #f9fafb; }
    code { color: var(--accent); }
    .empty { padding: 28px; text-align: center; color: var(--muted); }
    .foot { margin-top: 12px; color: var(--muted); font-size: 12px; }
    @media (max-width: 760px) {
      main { width: min(100% - 16px, 1220px); margin-top: 12px; }
      header { display: block; }
      .actions { justify-content: flex-start; margin-top: 12px; }
      .toolbar { grid-template-columns: 1fr; }
      table { font-size: 12px; min-width: 720px; }
      th, td { padding: 7px 8px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(subtitle || `Gerado em ${generatedAt}`)}</p>
      </div>
      <div class="actions">
        <button onclick="downloadCsv()">Baixar CSV</button>
        <button class="secondary" onclick="copyCsv()">Copiar CSV</button>
      </div>
    </header>
    <section class="toolbar">
      <input id="search" type="search" placeholder="Buscar na tabela">
      <select id="sort"><option value="">Ordem original</option>${columns.map((column) => `<option value="${escapeHtml(column.key)}">${escapeHtml(column.label)}</option>`).join('')}</select>
    </section>
    ${summaryCards ? `<section class="cards">${summaryCards}</section>` : ''}
    <section class="table-wrap">
      <table>
        <thead><tr>${columns.map((column) => `<th class="${column.align === 'right' ? 'num' : ''}">${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </section>
    <div class="foot"><span id="count"></span> | CSV embutido no arquivo HTML.</div>
  </main>
  <script>
    const rawRows = ${safeRows};
    const formattedRows = ${safeFormattedRows};
    const columns = ${safeColumns};
    const csvData = ${JSON.stringify(csv)};
    const csvName = ${JSON.stringify(csvName)};
    const search = document.querySelector('#search');
    const sort = document.querySelector('#sort');
    const rowsEl = document.querySelector('#rows');
    const countEl = document.querySelector('#count');
    search.addEventListener('input', render);
    sort.addEventListener('change', render);

    function normalize(value) {
      return String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
    }

    function visibleIndexes() {
      const q = normalize(search.value);
      const indexes = rawRows.map((_, index) => index).filter((index) => !q || normalize(Object.values(rawRows[index]).join(' ') + ' ' + Object.values(formattedRows[index]).join(' ')).includes(q));
      const sortKey = sort.value;
      if (sortKey) {
        indexes.sort((a, b) => String(rawRows[a][sortKey] ?? '').localeCompare(String(rawRows[b][sortKey] ?? ''), 'pt-BR', { numeric: true, sensitivity: 'base' }));
      }
      return indexes;
    }

    function render() {
      const indexes = visibleIndexes();
      countEl.textContent = indexes.length + ' linha(s)';
      rowsEl.innerHTML = indexes.length ? indexes.map(rowHtml).join('') : '<tr><td class="empty" colspan="' + columns.length + '">Nenhuma linha encontrada.</td></tr>';
    }

    function rowHtml(index) {
      const row = formattedRows[index];
      return '<tr>' + columns.map((column) => '<td class="' + (column.align === 'right' ? 'num' : '') + '">' + escapeHtml(row[column.key] ?? '') + '</td>').join('') + '</tr>';
    }

    function downloadCsv() {
      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = csvName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    async function copyCsv() {
      try {
        await navigator.clipboard.writeText(csvData);
        alert('CSV copiado.');
      } catch (error) {
        downloadCsv();
        alert('Seu navegador bloqueou copiar. Baixei o CSV no lugar.');
      }
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    render();
  </script>
</body>
</html>`;
}

function formatCell(value, row, column) {
  if (typeof column.format === 'function') return column.format(value, row);
  return value == null ? '' : value;
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
  htmlReportAttachment,
  renderHtmlReport
};
