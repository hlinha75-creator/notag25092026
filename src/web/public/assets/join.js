const form = document.querySelector('#join-form');
const loading = document.querySelector('#join-loading');
const errorBox = document.querySelector('#join-error');
const success = document.querySelector('#join-success');
const submit = document.querySelector('#join-submit');
let csrf = '';

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

async function fetchJson(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir esta etapa.');
  return data;
}

async function loadSession() {
  try {
    const { user, csrf: token } = await fetchJson('/api/join-session', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    csrf = token;
    document.querySelector('#join-name').textContent = user.name;
    const avatar = document.querySelector('#join-avatar');
    if (user.avatarUrl) avatar.src = user.avatarUrl;
    else avatar.hidden = true;
    document.querySelector('#join-user').hidden = false;
    loading.hidden = true;
    form.hidden = false;
    document.querySelector('#albion-name').focus();
  } catch (error) {
    loading.hidden = true;
    showError(error.message);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  submit.disabled = true;
  submit.textContent = 'Validando personagem…';
  try {
    const body = new URLSearchParams({
      albionName: document.querySelector('#albion-name').value.trim(),
      csrf
    });
    const result = await fetchJson('/api/join/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    form.hidden = true;
    document.querySelector('#join-user').hidden = true;
    const successTitle = document.querySelector('#join-success-title');
    const successMessage = document.querySelector('#join-success-message');
    if (result.needsStaff) {
      successTitle.textContent = 'A staff vai ajudar você';
      successMessage.textContent = result.message || 'A staff foi avisada. Entre na recepção para receber ajuda.';
    } else {
      successTitle.textContent = 'Entrada concluída';
      successMessage.textContent = result.alreadyMember
        ? `${result.albionName}, seu cadastro de membro já estava ativo.`
        : `${result.albionName}, seu apelido e cargo Convidado foram atualizados.`;
    }
    const voiceLink = document.querySelector('#voice-link');
    voiceLink.href = result.voiceUrl;
    success.hidden = false;
    window.setTimeout(() => window.location.assign(result.voiceUrl), 2200);
  } catch (error) {
    showError(error.message);
    submit.disabled = false;
    submit.textContent = 'Validar e entrar';
  }
});

loadSession();
