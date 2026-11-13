const messages = {
  required: 'Entre com o Discord para acessar a área da staff.',
  unavailable: 'O login da staff ainda está sendo configurado.',
  invalid: 'A tentativa de login expirou. Tente novamente.',
  cancelled: 'O login foi cancelado.',
  forbidden: 'Sua conta não possui o cargo ADM ou Staff.',
  error: 'Não foi possível concluir o login. Tente novamente.'
};

const joinMessages = {
  required: 'Entre com o Discord para iniciar seu cadastro.',
  unavailable: 'A entrada automática ainda está sendo configurada.',
  invalid: 'A autorização expirou. Tente entrar novamente.',
  cancelled: 'A entrada pelo Discord foi cancelada.',
  error: 'Não foi possível concluir sua entrada. Tente novamente ou procure a staff.'
};

const query = new URLSearchParams(window.location.search);
const authStatus = query.get('auth') || (query.has('login') ? 'required' : null);
const joinStatus = query.get('join');
const portalMessages = {
  required: 'Entre com o Discord para acessar seu portal.',
  forbidden: 'Você precisa estar no Discord da Notag para acessar o portal.'
};
const portalStatus = query.get('portal');
const toast = document.querySelector('#auth-message');
const message = portalStatus ? portalMessages[portalStatus] : (joinStatus ? joinMessages[joinStatus] : messages[authStatus]);
if (message) {
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 7000);
}

const rankingGrid = document.querySelector('#public-ranking-grid');
const rankingStatus = document.querySelector('#public-rankings-status');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function compactNumber(value) {
  const number = Number(value || 0);
  const compact = (divisor, suffix) => `${(number / divisor).toFixed(1).replace(/\.0$/, '')}${suffix}`;
  if (number >= 1_000_000_000) return compact(1_000_000_000, 'b');
  if (number >= 1_000_000) return compact(1_000_000, 'm');
  if (number >= 1_000) return compact(1_000, 'k');
  return new Intl.NumberFormat('pt-BR').format(number);
}

function parseUtcDate(value) {
  if (!value) return null;
  const normalized = /Z$|[+-]\d\d:\d\d$/.test(value)
    ? value
    : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatUpdatedAt(value) {
  const date = parseUtcDate(value);
  if (!date) return 'Aguardando importação';
  return `Atualizado ${new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
  }).format(date).replace('.', '')} UTC`;
}

function rankingCard(category) {
  const rows = Array.isArray(category.rows) ? category.rows : [];
  const content = rows.length
    ? `<ol class="public-ranking-list">${rows.map((row) => `
        <li>
          <span class="public-ranking-position">#${Number(row.rank)}</span>
          <strong title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</strong>
          <b>+${compactNumber(row.amount)}</b>
        </li>`).join('')}
      </ol>`
    : `<p class="public-ranking-empty">${category.comparisonAvailable
      ? 'Nenhum ganho positivo nesta atualização.'
      : 'São necessárias duas importações desta categoria para calcular a evolução.'}</p>`;

  return `<article class="public-ranking-card">
    <header>
      <h3>${escapeHtml(category.label)}</h3>
      <span>${escapeHtml(formatUpdatedAt(category.updatedAt))}</span>
    </header>
    ${content}
  </article>`;
}

async function loadPublicRankings() {
  if (!rankingGrid || !rankingStatus) return;
  try {
    const response = await fetch('/api/public/rankings', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('ranking unavailable');
    const payload = await response.json();
    const categories = Array.isArray(payload.categories) ? payload.categories : [];
    rankingGrid.innerHTML = categories.map(rankingCard).join('');
    rankingGrid.setAttribute('aria-busy', 'false');
    rankingStatus.textContent = categories.some((category) => category.comparisonAvailable)
      ? 'Diferença entre as duas últimas importações'
      : 'Aguardando duas importações por categoria';
  } catch {
    rankingGrid.setAttribute('aria-busy', 'false');
    rankingGrid.innerHTML = '<p class="public-ranking-error">Não foi possível carregar as classificações agora.</p>';
    rankingStatus.textContent = 'Classificações temporariamente indisponíveis';
  }
}

loadPublicRankings();
window.setInterval(loadPublicRankings, 5 * 60 * 1000);
