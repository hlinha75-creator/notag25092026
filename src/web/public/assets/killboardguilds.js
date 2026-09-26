const periodButtons = [...document.querySelectorAll('[data-period]')];
const rankings = document.querySelector('#rankings');
const number = new Intl.NumberFormat('pt-BR');
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

function rankingRow(row, index) {
  const item = document.createElement('li');
  const content = row.statsUrl ? document.createElement('a') : document.createElement('div');
  const position = document.createElement('span');
  const guild = document.createElement('strong');
  const count = document.createElement('span');
  const external = document.createElement('span');
  content.className = `guild-row-link${row.statsUrl ? '' : ' guild-row-link-disabled'}`;
  position.className = 'guild-row-position';
  guild.className = 'guild-row-name';
  count.className = 'guild-row-count';
  external.className = 'guild-row-external';
  position.textContent = String(index + 1).padStart(2, '0');
  guild.textContent = row.guild;
  count.textContent = `${number.format(row.deaths)} morte${row.deaths === 1 ? '' : 's'}`;
  external.textContent = row.statsUrl ? '↗' : '';
  if (row.statsUrl) {
    content.href = row.statsUrl;
    content.target = '_blank';
    content.rel = 'noopener noreferrer';
    content.title = `Abrir estatísticas de ${row.guild} no AlbionBB`;
    content.setAttribute('aria-label', `${row.guild}: ${count.textContent}. Abrir estatísticas no AlbionBB`);
  }
  content.append(position, guild, count, external);
  item.append(content);
  return item;
}

function renderList(target, rows) {
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.className = 'guild-empty';
    empty.textContent = 'Nenhum confronto com guilda identificada neste período.';
    target.replaceChildren(empty);
    return;
  }
  target.replaceChildren(...rows.map(rankingRow));
}

async function load(period) {
  rankings.setAttribute('aria-busy', 'true');
  periodButtons.forEach((button) => button.classList.toggle('active', button.dataset.period === period));
  try {
    const response = await fetch(`/api/public/killboardguilds?period=${encodeURIComponent(period)}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Não foi possível carregar o ranking.');
    const data = await response.json();
    renderList(document.querySelector('#death-ranking'), data.deaths);
    renderList(document.querySelector('#kill-ranking'), data.kills);
    document.querySelector('#death-total').textContent = number.format(data.totals.deaths);
    document.querySelector('#kill-total').textContent = number.format(data.totals.kills);
    document.querySelector('#ranking-note').textContent = `Janela de ${data.periodLabel} • atualizado em ${date.format(new Date(data.generatedAt))} • jogadores sem guilda não entram no ranking.`;
  } catch (error) {
    document.querySelector('#ranking-note').textContent = error.message;
  } finally {
    rankings.setAttribute('aria-busy', 'false');
  }
}

periodButtons.forEach((button) => button.addEventListener('click', () => load(button.dataset.period)));
load('24h');
