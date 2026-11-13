const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const ids = require('../config/ids');
const env = require('../config/env');
const fame = require('../modules/albion/fame.service');
const operationalData = require('../modules/albion/operationalData.service');
const { baseEmbed, safeSend } = require('../utils/discord');
const { getDashboardData, publicFameRankings } = require('./dashboard.repository');
const { getPortalData } = require('./portal.repository');
const { changePortalParticipation } = require('./portal-events.service');
const { cancelPortalWithdraw, editPortalWithdraw, requestPortalWithdraw } = require('./portal-finance.service');
const { manageStaffEvent } = require('./staff-events.service');
const { createStaffVisualEvent, deletePublishedConfiguration, pingContentBootstrap, savePublishedConfiguration } = require('./pingcontent.service');
const { manageStaffWithdraw } = require('./staff-finance.service');
const { getRegistrationQueue, manageStaffRegistration } = require('./staff-registration.service');
const { getMemberRosterData, manageMemberRoster } = require('./staff-member-roster.service');
const { getCommandIntelligenceData, getMemberIntelligenceData } = require('./command-intelligence.service');
const { getPrimeTimeData } = require('./primetime.service');
const { getRegearData, setRegearStatus } = require('./regear.service');
const massRaffle = require('../modules/giveaways/massRaffle.service');
const constantPlayersRaffle = require('../modules/giveaways/constantPlayersRaffle.service');
const { getDatabase } = require('../database/connection');
const { completeOnboarding, ensureGuestMember, handleOnboardingIssue, onboardingConfigured } = require('./onboarding');
const { notFoundPage, renderBattleReportPage } = require('./battle-report.service');
const { getGuildRankings, PERIODS } = require('../modules/albion/guildKillboard.service');
const {
  JOIN_OAUTH_STATE_COOKIE,
  JOIN_SESSION_COOKIE,
  JOIN_SESSION_MAX_AGE_SECONDS,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SECONDS,
  PORTAL_MEMBER_MAX_AGE_SECONDS,
  PORTAL_PRIVILEGED_MAX_AGE_SECONDS,
  PORTAL_SESSION_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  clearCookie,
  cookie,
  createJoinSession,
  createOAuthState,
  createPortalSession,
  createSession,
  parseCookies,
  readJoinSession,
  readPortalSession,
  readSession,
  validateOAuthState
} = require('./auth');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORTAL_RETURN_COOKIE = 'notag_portal_return';
const STAFF_RETURN_COOKIE = 'notag_staff_return';
const ALLOWED_STAFF_ROLES = new Set([ids.roles.adm, ids.roles.staff].filter(Boolean));
const PINGCONTENT_ROLES = new Set([ids.roles.adm, ids.roles.staff, ids.roles.caller].filter(Boolean));
const REGISTRATION_REVIEW_ROLES = new Set([
  ids.roles.adm,
  ids.roles.staff,
  ids.roles.recruiter,
  ids.roles.caller
].filter(Boolean));
const PRIVILEGED_PORTAL_ROLES = new Set([
  ids.roles.adm,
  ids.roles.staff,
  ids.roles.treasurer,
  ids.roles.caller,
  ids.roles.recruiter
].filter(Boolean));
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

function securityHeaders(isProduction) {
  const headers = {
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://cdn.discordapp.com https://render.albiononline.com data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://discord.com",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  };
  if (isProduction) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

function withUniversalNavigation(body, contentType = '') {
  if (!String(contentType).startsWith('text/html') || !body || !String(body).includes('</body>')) return body;
  const html = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  if (html.includes('data-notag-site-nav')) return body;
  return html
    .replace('</head>', '<link rel="stylesheet" href="/assets/site-nav.css?v=20260831-1"></head>')
    .replace('</body>', '<nav class="notag-site-nav" data-notag-site-nav aria-label="Navegação rápida"><button type="button" data-notag-back aria-label="Voltar para a página anterior">← Voltar</button><a href="/" aria-label="Ir para a página inicial">⌂ Início</a></nav><script src="/assets/site-nav.js?v=20260831-1" defer></script></body>');
}

function send(res, status, body, headers = {}, isProduction = false) {
  body = withUniversalNavigation(body, headers['Content-Type']);
  res.writeHead(status, { ...securityHeaders(isProduction), ...headers });
  res.end(body);
}

function redirect(res, location, headers = {}, isProduction = false) {
  send(res, 302, '', { Location: location, ...headers }, isProduction);
}

function json(res, status, value, isProduction, headers = {}) {
  send(res, status, JSON.stringify(value), {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  }, isProduction);
}

function serveFile(res, filename, isProduction, cache = 'public, max-age=3600', headers = {}) {
  const fullPath = path.join(PUBLIC_DIR, filename);
  if (!fullPath.startsWith(PUBLIC_DIR) || !fs.existsSync(fullPath)) {
    send(res, 404, 'Não encontrado.', { 'Content-Type': 'text/plain; charset=utf-8' }, isProduction);
    return;
  }
  const ext = path.extname(fullPath).toLowerCase();
  send(res, 200, fs.readFileSync(fullPath), {
    'Cache-Control': cache,
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    ...headers
  }, isProduction);
}

function avatarUrl(user) {
  if (!user.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=96`;
}

function runtimeHealth(client) {
  const discordReady = Boolean(client?.isReady?.());
  let databaseReady = false;
  try {
    databaseReady = getDatabase().prepare('SELECT 1 AS ok').get()?.ok === 1;
  } catch {
    databaseReady = false;
  }
  return {
    ok: discordReady && databaseReady,
    discord: discordReady ? 'ready' : 'not_ready',
    database: databaseReady ? 'ready' : 'not_ready'
  };
}

async function exchangeDiscordCode(code, redirectUri, fetchImpl = fetch) {
  const body = new URLSearchParams({
    client_id: env.discordClientId,
    client_secret: env.discordClientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });
  const tokenResponse = await fetchImpl('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!tokenResponse.ok) throw new Error(`Discord recusou o código OAuth (${tokenResponse.status}).`);
  const token = await tokenResponse.json();
  const userResponse = await fetchImpl('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  if (!userResponse.ok) throw new Error(`Discord não retornou o usuário (${userResponse.status}).`);
  return { token, user: await userResponse.json() };
}

function readFormBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > limit) {
        tooLarge = true;
        reject(new Error('Formulário muito grande.'));
      }
    });
    req.on('end', () => { if (!tooLarge) resolve(new URLSearchParams(body)); });
    req.on('error', reject);
  });
}

async function authorizeStaff(client, discordUser) {
  const guild = await client.guilds.fetch(ids.guildId);
  const member = await guild.members.fetch(discordUser.id);
  const roles = [...member.roles.cache.keys()];
  const allowed = member.id === guild.ownerId || roles.some((roleId) => REGISTRATION_REVIEW_ROLES.has(roleId));
  const full = member.id === guild.ownerId || roles.some((roleId) => ALLOWED_STAFF_ROLES.has(roleId));
  return { allowed, full, canReviewRegistrations: allowed, roles };
}

async function dashboardAccess(client, session) {
  if (!session || !client?.guilds) return { allowed: false, full: false, canReviewRegistrations: false, roles: [] };
  const guild = client.guilds.cache?.get(ids.guildId) || await client.guilds.fetch(ids.guildId);
  const member = guild.members.cache?.get(session.id) || await guild.members.fetch(session.id).catch(() => null);
  if (!member) return { allowed: false, full: false, canReviewRegistrations: false, roles: [] };
  const roles = [...member.roles.cache.keys()];
  const full = member.id === guild.ownerId || roles.some((roleId) => ALLOWED_STAFF_ROLES.has(roleId));
  const canReviewRegistrations = full || roles.some((roleId) => REGISTRATION_REVIEW_ROLES.has(roleId));
  return { allowed: canReviewRegistrations, full, canReviewRegistrations, roles };
}

async function sessionStillAuthorized(client, session) {
  return (await dashboardAccess(client, session)).full;
}

async function sessionCanAccessPingContent(client, session) {
  if (!session || !client?.guilds) return false;
  const guild = client.guilds.cache?.get(ids.guildId) || await client.guilds.fetch(ids.guildId);
  const member = guild.members.cache?.get(session.id) || await guild.members.fetch(session.id).catch(() => null);
  if (!member) return false;
  return member.id === guild.ownerId || [...member.roles.cache.keys()].some((roleId) => PINGCONTENT_ROLES.has(roleId));
}

async function commandAccess(client, session) {
  if (!session) return false;
  return env.commandAllowedUserIds.includes(String(session.id));
}

async function sessionCanAccessDashboard(client, session) {
  return (await dashboardAccess(client, session)).allowed;
}

async function portalAccess(client, discordId) {
  if (!discordId || !client?.guilds) return null;
  const guild = client.guilds.cache?.get(ids.guildId) || await client.guilds.fetch(ids.guildId);
  const member = guild.members.cache?.get(discordId) || await guild.members.fetch(discordId).catch(() => null);
  if (!member) return null;
  const roles = [...member.roles.cache.keys()];
  const staffAllowed = member.id === guild.ownerId || roles.some((roleId) => REGISTRATION_REVIEW_ROLES.has(roleId));
  const full = member.id === guild.ownerId || roles.some((roleId) => ALLOWED_STAFF_ROLES.has(roleId));
  const privileged = member.id === guild.ownerId || roles.some((roleId) => PRIVILEGED_PORTAL_ROLES.has(roleId));
  const accessLevel = member.roles.cache.has(ids.roles.member) || privileged ? 'member' : 'guest';
  return { accessLevel, privileged, roles, staffAllowed, full };
}

async function staffDashboardPayload(client, access) {
  const registrations = await getRegistrationQueue(client);
  const memberRoster = getMemberRosterData();
  if (access.full) return { ...getDashboardData(), registrations, memberRoster };
  return {
    generatedAt: new Date().toISOString(),
    freshness: registrations.map((row) => row.updated_at).filter(Boolean).sort().at(-1) || null,
    registrations,
    memberRoster,
    operations: { registrationsPending: registrations.filter((row) => ['pending', 'link_review', 'overdue', 'unregistered'].includes(row.queue_status)).length }
  };
}

function configuredForOAuth() {
  return Boolean(env.discordClientId && env.discordClientSecret && env.dashboardSessionSecret && env.dashboardBaseUrl);
}

function staffReturnDestination(value) {
  if (value === 'sorteio') return '/sorteio';
  if (value === 'pingcontent') return '/pingcontent';
  return '/dashboard';
}

async function notifyFameImport(client, session, result) {
  const summary = result.summary;
  const embed = baseEmbed(`Ranking de ${result.categoryLabel} atualizado`)
    .setColor(0x5865f2)
    .setDescription([
      `**${summary.players}** jogadores processados`,
      `**${summary.withPoints}** com pontuação`,
      `**${summary.unmatched}** aguardando vínculo`,
      `**${summary.missing}** ausentes nesta importação`,
      `**${summary.reductions}** reduções confirmadas`,
      '',
      `Importado por <@${session.id}>`
    ].join('\n'));
  return safeSend(client, ids.channels.notifications, {
    embeds: [embed],
    allowedMentions: { parse: [], users: [session.id], roles: [] }
  });
}

function createRequestHandler(client, options = {}) {
  const isProduction = env.nodeEnv === 'production';
  const secureCookie = isProduction || env.dashboardBaseUrl.startsWith('https://');
  const fetchImpl = options.fetchImpl || fetch;

  return async function handleRequest(req, res) {
    const url = new URL(req.url, env.dashboardBaseUrl);
    const cookies = parseCookies(req.headers.cookie);
    const session = readSession(cookies[SESSION_COOKIE], env.dashboardSessionSecret);
    const joinSession = readJoinSession(cookies[JOIN_SESSION_COOKIE], env.dashboardSessionSecret);
    const portalSession = readPortalSession(cookies[PORTAL_SESSION_COOKIE], env.dashboardSessionSecret);

    try {
      if (req.method === 'POST' && url.pathname === '/api/join/complete') {
        if (!joinSession) return json(res, 401, { error: 'Sua sessão de entrada expirou. Comece novamente.' }, isProduction);
        const expectedOrigin = new URL(env.dashboardBaseUrl).origin;
        if (req.headers.origin !== expectedOrigin) return json(res, 403, { error: 'Origem inválida.' }, isProduction);
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
          return json(res, 415, { error: 'Formato de formulário inválido.' }, isProduction);
        }
        const form = await readFormBody(req);
        if (form.get('csrf') !== joinSession.csrf) return json(res, 403, { error: 'Validação de segurança inválida.' }, isProduction);
        try {
          const result = await completeOnboarding(client, joinSession, form.get('albionName'), { fetchImpl });
          return json(res, 200, result, isProduction);
        } catch (error) {
          console.error('[ONBOARDING] Falha ao concluir cadastro:', error);
          const fallback = await handleOnboardingIssue(client, joinSession, form.get('albionName'), error);
          return json(res, 202, fallback, isProduction);
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/portal/events/participation') {
        if (!portalSession) return json(res, 401, { error: 'Entre com o Discord para acessar seu portal.' }, isProduction);
        const access = await portalAccess(client, portalSession.id);
        if (!access) return json(res, 403, { error: 'Você precisa estar no Discord da Notag.' }, isProduction);
        const expectedOrigin = new URL(env.dashboardBaseUrl).origin;
        if (req.headers.origin !== expectedOrigin) return json(res, 403, { error: 'Origem inválida.' }, isProduction);
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
          return json(res, 415, { error: 'Formato de formulário inválido.' }, isProduction);
        }
        const form = await readFormBody(req);
        if (!portalSession.csrf || form.get('csrf') !== portalSession.csrf) {
          return json(res, 403, { error: 'Sua sessão precisa ser renovada. Saia e entre novamente.' }, isProduction);
        }
        try {
          const result = await changePortalParticipation(client, {
            discordId: portalSession.id,
            accessLevel: access.accessLevel,
            privileged: access.privileged,
            eventId: form.get('eventId'),
            action: form.get('action'),
            role: form.get('role'),
            slotIndex: form.get('slotIndex'),
            weaponKey: form.get('weaponKey')
          });
          const renewedPortal = createPortalSession(portalSession, env.dashboardSessionSecret, access);
          const renewedMaxAge = access.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
          return json(res, 200, {
            result,
            portal: getPortalData(portalSession.id, access.accessLevel, access.privileged)
          }, isProduction, {
            'Set-Cookie': cookie(PORTAL_SESSION_COOKIE, renewedPortal, { maxAge: renewedMaxAge, secure: secureCookie })
          });
        } catch (error) {
          return json(res, Number(error.statusCode || 400), { error: error.message || 'Não foi possível atualizar sua participação.' }, isProduction);
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/portal/withdrawals') {
        if (!portalSession) return json(res, 401, { error: 'Entre com o Discord para acessar seu portal.' }, isProduction);
        const access = await portalAccess(client, portalSession.id);
        if (!access) return json(res, 403, { error: 'Você precisa estar no Discord da Notag.' }, isProduction);
        const expectedOrigin = new URL(env.dashboardBaseUrl).origin;
        if (req.headers.origin !== expectedOrigin) return json(res, 403, { error: 'Origem inválida.' }, isProduction);
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
          return json(res, 415, { error: 'Formato de formulário inválido.' }, isProduction);
        }
        const form = await readFormBody(req);
        if (!portalSession.csrf || form.get('csrf') !== portalSession.csrf) {
          return json(res, 403, { error: 'Sua sessão precisa ser renovada. Saia e entre novamente.' }, isProduction);
        }
        try {
          const result = await requestPortalWithdraw(client, {
            discordId: portalSession.id,
            rawAmount: form.get('amount'),
            note: form.get('note')
          });
          const renewedPortal = createPortalSession(portalSession, env.dashboardSessionSecret, access);
          const renewedMaxAge = access.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
          return json(res, 200, {
            result,
            portal: getPortalData(portalSession.id, access.accessLevel, access.privileged)
          }, isProduction, {
            'Set-Cookie': cookie(PORTAL_SESSION_COOKIE, renewedPortal, { maxAge: renewedMaxAge, secure: secureCookie })
          });
        } catch (error) {
          return json(res, Number(error.statusCode || 400), { error: error.message || 'Não foi possível solicitar o saque.' }, isProduction);
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/portal/withdrawals/manage') {
        if (!portalSession) return json(res, 401, { error: 'Entre com o Discord para acessar seu portal.' }, isProduction);
        const access = await portalAccess(client, portalSession.id);
        if (!access) return json(res, 403, { error: 'Você precisa estar no Discord da Notag.' }, isProduction);
        const expectedOrigin = new URL(env.dashboardBaseUrl).origin;
        if (req.headers.origin !== expectedOrigin) return json(res, 403, { error: 'Origem inválida.' }, isProduction);
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
          return json(res, 415, { error: 'Formato de formulário inválido.' }, isProduction);
        }
        const form = await readFormBody(req);
        if (!portalSession.csrf || form.get('csrf') !== portalSession.csrf) {
          return json(res, 403, { error: 'Sua sessão precisa ser renovada. Atualize a página e tente novamente.' }, isProduction);
        }
        try {
          const action = form.get('action');
          const input = {
            discordId: portalSession.id,
            requestId: form.get('requestId'),
            rawAmount: form.get('amount'),
            note: form.get('note')
          };
          let result;
          if (action === 'edit') result = await editPortalWithdraw(client, input);
          else if (action === 'cancel') result = await cancelPortalWithdraw(client, input);
          else {
            const error = new Error('Ação de saque inválida.');
            error.statusCode = 400;
            throw error;
          }
          const renewedPortal = createPortalSession(portalSession, env.dashboardSessionSecret, access);
          const renewedMaxAge = access.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
          return json(res, 200, {
            result,
            portal: getPortalData(portalSession.id, access.accessLevel, access.privileged)
          }, isProduction, {
            'Set-Cookie': cookie(PORTAL_SESSION_COOKIE, renewedPortal, { maxAge: renewedMaxAge, secure: secureCookie })
          });
        } catch (error) {
          return json(res, Number(error.statusCode || 400), { error: error.message || 'Não foi possível alterar o saque.' }, isProduction);
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/staff/withdrawals') {
        if (!session) return json(res, 401, { error: 'Sessão da staff necessária.' }, isProduction);
        if (!await sessionStillAuthorized(client, session)) return json(res, 403, { error: 'Acesso de staff necessário.' }, isProduction);
        const expectedOrigin = new URL(env.dashboardBaseUrl).origin;
        if (req.headers.origin !== expectedOrigin) return json(res, 403, { error: 'Origem inválida.' }, isProduction);
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
          return json(res, 415, { error: 'Formato de formulário inválido.' }, isProduction);
        }
        const form = await readFormBody(req);
        if (!session.csrf || form.get('csrf') !== session.csrf) {
          return json(res, 403, { error: 'Sua sessão precisa ser renovada. Atualize a página e tente novamente.' }, isProduction);
        }
        try {
          const result = await manageStaffWithdraw(client, {
            actorId: session.id,
            requestId: form.get('requestId'),
            action: form.get('action')
          });
          const renewedSession = createSession(session, env.dashboardSessionSecret);
          return json(res, 200, { result, dashboard: getDashboardData() }, isProduction, {
            'Set-Cookie': cookie(SESSION_COOKIE, renewedSession, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
          });
        } catch (error) {
          return json(res, Number(error.statusCode || 400), { error: error.message || 'Não foi possível atualizar o saque.' }, isProduction);
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/staff/events') {
        if (!session) return json(res, 401, { error: 'Sessao da staff necessaria.' }, isProduction);
        if (!await sessionStillAuthorized(client, session)) return json(res, 403, { error: 'Acesso de staff necessario.' }, isProduction);
        const expectedOrigin = new URL(env.dashboardBaseUrl).origin;
        if (req.headers.origin !== expectedOrigin) return json(res, 403, { error: 'Origem invalida.' }, isProduction);
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
          return json(res, 415, { error: 'Formato de formulario invalido.' }, isProduction);
        }
        const form = await readFormBody(req, 16 * 1024);
        if (!session.csrf || form.get('csrf') !== session.csrf) {
          return json(res, 403, { error: 'Sua sessao precisa ser renovada. Atualize a pagina e tente novamente.' }, isProduction);
        }
        try {
          const result = await manageStaffEvent(client, {
            actorId: session.id,
            action: form.get('action'),
            eventId: form.get('eventId'),
            contentType: form.get('contentType'),
            title: form.get('title'),
            description: form.get('description'),
            location: form.get('location'),
            scheduledTime: form.get('scheduledTime'),
            audience: form.get('audience'),
            tankSlots: form.get('tankSlots'),
            healerSlots: form.get('healerSlots'),
            supportSlots: form.get('supportSlots'),
            dpsSlots: form.get('dpsSlots'),
            lootTotal: form.get('lootTotal'),
            repair: form.get('repair'),
            silverBags: form.get('silverBags'),
            taxPercent: form.get('taxPercent'),
            evidenceNotes: form.get('evidenceNotes'),
            reason: form.get('reason')
          });
          const renewedSession = createSession(session, env.dashboardSessionSecret);
          return json(res, 200, { result, dashboard: getDashboardData() }, isProduction, {
            'Set-Cookie': cookie(SESSION_COOKIE, renewedSession, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
          });
        } catch (error) {
          return json(res, Number(error.statusCode || 400), { error: error.message || 'Nao foi possivel atualizar o evento.' }, isProduction);
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/staff/registrations') {
        if (!session) return json(res, 401, { error: 'Sessão da staff necessária.' }, isProduction);
        const access = await dashboardAccess(client, session);
        if (!access.canReviewRegistrations) return json(res, 403, { error: 'Acesso de cadastro necessário.' }, isProduction);
        const expectedOrigin = new URL(env.dashboardBaseUrl).origin;
        if (req.headers.origin !== expectedOrigin) return json(res, 403, { error: 'Origem inválida.' }, isProduction);
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
          return json(res, 415, { error: 'Formato de formulário inválido.' }, isProduction);
        }
        const form = await readFormBody(req, 16 * 1024);
        if (!session.csrf || form.get('csrf') !== session.csrf) {
          return json(res, 403, { error: 'Sua sessão precisa ser renovada. Atualize a página e tente novamente.' }, isProduction);
        }
        try {
          const result = await manageStaffRegistration(client, {
            actorId: session.id,
            action: form.get('action'),
            discordId: form.get('discordId'),
            albionName: form.get('albionName'),
            reason: form.get('reason'),
            note: form.get('note')
          }, { fetchImpl });
          const renewedSession = createSession(session, env.dashboardSessionSecret);
          return json(res, 200, {
            result,
            dashboard: form.get('action') === 'preview' ? null : await staffDashboardPayload(client, access)
          }, isProduction, {
            'Set-Cookie': cookie(SESSION_COOKIE, renewedSession, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
          });
        } catch (error) {
          return json(res, Number(error.statusCode || 400), { error: error.message || 'Não foi possível atualizar o cadastro.' }, isProduction);
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/staff/member-roster') {
        if (!session) return json(res, 401, { error: 'Sessão da staff necessária.' }, isProduction);
        const access = await dashboardAccess(client, session);
        if (!access.canReviewRegistrations) return json(res, 403, { error: 'Acesso de cadastro necessário.' }, isProduction);
        const expectedOrigin = new URL(env.dashboardBaseUrl).origin;
        if (req.headers.origin !== expectedOrigin) return json(res, 403, { error: 'Origem inválida.' }, isProduction);
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
          return json(res, 415, { error: 'Formato de formulário inválido.' }, isProduction);
        }
        const form = await readFormBody(req, 640 * 1024);
        if (!session.csrf || form.get('csrf') !== session.csrf) {
          return json(res, 403, { error: 'Sua sessão precisa ser renovada. Atualize a página e tente novamente.' }, isProduction);
        }
        try {
          const result = await manageMemberRoster({
            actorId: session.id,
            action: form.get('action'),
            sourceName: form.get('sourceName'),
            rosterText: form.get('rosterText')
          }, { client });
          const renewedSession = createSession(session, env.dashboardSessionSecret);
          return json(res, 200, {
            result,
            dashboard: form.get('action') === 'preview' ? null : await staffDashboardPayload(client, access)
          }, isProduction, {
            'Set-Cookie': cookie(SESSION_COOKIE, renewedSession, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
          });
        } catch (error) {
          return json(res, Number(error.statusCode || 400), { error: error.message || 'Não foi possível atualizar a lista de membros.' }, isProduction);
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/sorteio240926/confirm') {
        const identity = portalSession || session;
        if (!identity) return json(res, 401, { error: 'Entre com o Discord para confirmar seu prêmio.' }, isProduction);
        const access = await portalAccess(client, identity.id);
        if (!access) return json(res, 403, { error: 'Entre no servidor da NoTag com sua conta vencedora.' }, isProduction);
        const expectedOrigin = new URL(env.dashboardBaseUrl).origin;
        if (req.headers.origin !== expectedOrigin) return json(res, 403, { error: 'Origem inválida.' }, isProduction);
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
          return json(res, 415, { error: 'Formato de formulário inválido.' }, isProduction);
        }
        const form = await readFormBody(req);
        if (!identity.csrf || form.get('csrf') !== identity.csrf) return json(res, 403, { error: 'Sua sessão precisa ser renovada.' }, isProduction);
        try {
          const state = constantPlayersRaffle.confirmPrize({ discordId: identity.id, slotNumber: form.get('slot') });
          return json(res, 200, { state }, isProduction);
        } catch (error) {
          return json(res, Number(error.statusCode || 400), { error: error.message || 'Não foi possível confirmar o prêmio.' }, isProduction);
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/staff/albion-data') {
        if (!session) return json(res, 401, { error: 'Sessão da staff necessária.' }, isProduction);
        const access = await dashboardAccess(client, session);
        if (!access.full) return json(res, 403, { error: 'Acesso completo da staff necessário.' }, isProduction);
        const expectedOrigin = new URL(env.dashboardBaseUrl).origin;
        if (req.headers.origin !== expectedOrigin) return json(res, 403, { error: 'Origem inválida.' }, isProduction);
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
          return json(res, 415, { error: 'Formato de formulário inválido.' }, isProduction);
        }
        const form = await readFormBody(req, 640 * 1024);
        if (!session.csrf || form.get('csrf') !== session.csrf) {
          return json(res, 403, { error: 'Sua sessão precisa ser renovada. Atualize a página e tente novamente.' }, isProduction);
        }
        try {
          if (form.get('action') === 'preview') {
            const preview = operationalData.previewOperationalData(form.get('text'), {
              kind: form.get('kind'), sourceName: form.get('sourceName'), actorId: session.id
            });
            const previewId = operationalData.savePreview(preview);
            return json(res, 200, {
              previewId, kind: preview.kind, kindLabel: preview.kindLabel,
              previousImport: preview.previousImport, summary: preview.summary,
              errors: preview.errors.slice(0, 30), rows: preview.rows.slice(0, 250)
            }, isProduction);
          }
          if (form.get('action') === 'confirm') {
            const result = operationalData.confirmPreview(form.get('previewId'), session.id);
            return json(res, 200, { result, dashboard: await staffDashboardPayload(client, access) }, isProduction);
          }
          return json(res, 400, { error: 'Ação de importação inválida.' }, isProduction);
        } catch (error) {
          return json(res, Number(error.statusCode || 400), { error: error.message || 'Não foi possível importar os dados.' }, isProduction);
        }
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/fame/')) {
        if (!session) return json(res, 401, { error: 'Sessão da staff necessária.' }, isProduction);
        if (!await sessionStillAuthorized(client, session)) return json(res, 403, { error: 'Acesso de staff necessário.' }, isProduction);
        const expectedOrigin = new URL(env.dashboardBaseUrl).origin;
        if (req.headers.origin !== expectedOrigin) return json(res, 403, { error: 'Origem inválida.' }, isProduction);
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
          return json(res, 415, { error: 'Formato de formulário inválido.' }, isProduction);
        }
        const form = await readFormBody(req, 512 * 1024);
        if (!session.csrf || form.get('csrf') !== session.csrf) {
          return json(res, 403, { error: 'Sua sessão precisa ser renovada. Saia e entre novamente.' }, isProduction);
        }

        if (url.pathname === '/api/fame/import/preview') {
          try {
            const preview = fame.previewCategoryFame(form.get('text'), {
              category: form.get('category'),
              sourceName: form.get('sourceName'),
              actorId: session.id
            });
            const previewId = fame.savePreview(preview);
            return json(res, 200, {
              previewId,
              category: preview.category,
              categoryLabel: preview.categoryLabel,
              summary: preview.summary,
              errors: preview.errors.slice(0, 30),
              missing: preview.missing.slice(0, 30),
              rows: preview.rows.slice(0, 250)
            }, isProduction);
          } catch (error) {
            return json(res, 400, { error: error.message || 'Não foi possível analisar a tabela.' }, isProduction);
          }
        }

        if (url.pathname === '/api/fame/import/confirm') {
          try {
            const preview = fame.getPreview(form.get('previewId'));
            if (preview.actorId !== session.id) return json(res, 403, { error: 'Esta prévia pertence a outra sessão.' }, isProduction);
            const result = fame.applyCategoryPreview(preview, { confirmReductions: form.get('confirmReductions') === 'true' });
            fame.cancelPreview(form.get('previewId'));
            await notifyFameImport(client, session, result);
            return json(res, 200, result, isProduction);
          } catch (error) {
            return json(res, 400, { error: error.message || 'Não foi possível confirmar a importação.' }, isProduction);
          }
        }

        if (url.pathname === '/api/fame/import/undo') {
          try {
            const result = fame.undoLatestCategoryImport(form.get('category'), session.id);
            return json(res, 200, result, isProduction);
          } catch (error) {
            return json(res, 400, { error: error.message || 'Não foi possível desfazer a importação.' }, isProduction);
          }
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/staff/sorteio') {
        if (!session) return json(res, 401, { error: 'Sessão da staff necessária.' }, isProduction);
        if (!await sessionStillAuthorized(client, session)) return json(res, 403, { error: 'Acesso de staff necessário.' }, isProduction);
        const expectedOrigin = new URL(env.dashboardBaseUrl).origin;
        if (req.headers.origin !== expectedOrigin) return json(res, 403, { error: 'Origem inválida.' }, isProduction);
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
          return json(res, 415, { error: 'Formato de formulário inválido.' }, isProduction);
        }
        const form = await readFormBody(req);
        if (!session.csrf || form.get('csrf') !== session.csrf) {
          return json(res, 403, { error: 'Sua sessão precisa ser renovada. Atualize a página e tente novamente.' }, isProduction);
        }
        try {
          const action = form.get('action');
          let result;
          if (action === 'start') result = massRaffle.startOfficial({ actorId: session.id });
          else if (action === 'draw') result = massRaffle.drawOfficial({ actorId: session.id, prizeId: form.get('prizeId') });
          else throw Object.assign(new Error('Ação de sorteio inválida.'), { statusCode: 400 });
          const renewedSession = createSession(session, env.dashboardSessionSecret);
          const payload = action === 'start' ? { state: result } : result;
          return json(res, 200, payload, isProduction, {
            'Set-Cookie': cookie(SESSION_COOKIE, renewedSession, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
          });
        } catch (error) {
          return json(res, Number(error.statusCode || 400), { error: error.message || 'Não foi possível atualizar o sorteio.' }, isProduction);
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/staff/pingcontent') {
        if (!session) return json(res, 401, { error: 'Sessão da staff necessária.' }, isProduction);
        if (!await sessionCanAccessPingContent(client, session)) return json(res, 403, { error: 'Acesso de Caller, Staff ou ADM necessário.' }, isProduction);
        const expectedOrigin = new URL(env.dashboardBaseUrl).origin;
        if (req.headers.origin !== expectedOrigin) return json(res, 403, { error: 'Origem inválida.' }, isProduction);
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
          return json(res, 415, { error: 'Formato de formulário inválido.' }, isProduction);
        }
        const form = await readFormBody(req, 64 * 1024);
        if (!session.csrf || form.get('csrf') !== session.csrf) {
          return json(res, 403, { error: 'Sua sessão precisa ser renovada. Atualize a página e tente novamente.' }, isProduction);
        }
        try {
          if (form.get('action') === 'save_config') {
            return json(res, 200, { result: savePublishedConfiguration(session.id, form.get('eventId'), form.get('name')) }, isProduction);
          }
          if (form.get('action') === 'delete_config') {
            return json(res, 200, { result: deletePublishedConfiguration(session.id, form.get('templateId')) }, isProduction);
          }
          const result = await createStaffVisualEvent(client, {
            actorId: session.id,
            contentType: form.get('contentType'),
            title: form.get('title'),
            description: form.get('description'),
            scheduledTime: form.get('scheduledTime'),
            location: form.get('location'),
            audience: form.get('audience'),
            tier: form.get('tier'),
            enchantment: form.get('enchantment'),
            quality: form.get('quality'),
            itemPower: form.get('itemPower'),
            lootRules: form.get('lootRules'),
            consumables: form.get('consumables'),
            mount: form.get('mount'),
            slots: form.get('slots'),
            dpsPool: form.get('dpsPool'),
            dpsPolicy: form.get('dpsPolicy')
          });
          const renewedSession = createSession(session, env.dashboardSessionSecret);
          return json(res, 200, { result }, isProduction, {
            'Set-Cookie': cookie(SESSION_COOKIE, renewedSession, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
          });
        } catch (error) {
          return json(res, Number(error.statusCode || 400), { error: error.message || 'Não foi possível criar o evento.' }, isProduction);
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/regear/status') {
        if (!portalSession) return json(res, 401, { error: 'Entre com o Discord para gerenciar o regear.' }, isProduction);
        const access = await portalAccess(client, portalSession.id);
        if (!access?.full) return json(res, 403, { error: 'Acesso de Staff ou ADM necessário.' }, isProduction);
        const expectedOrigin = new URL(env.dashboardBaseUrl).origin;
        if (req.headers.origin !== expectedOrigin) return json(res, 403, { error: 'Origem inválida.' }, isProduction);
        if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
          return json(res, 415, { error: 'Formato de formulário inválido.' }, isProduction);
        }
        const form = await readFormBody(req);
        if (!portalSession.csrf || form.get('csrf') !== portalSession.csrf) {
          return json(res, 403, { error: 'Sua sessão precisa ser renovada. Atualize a página e tente novamente.' }, isProduction);
        }
        try {
          const result = setRegearStatus(options.db || getDatabase(), {
            eventId: form.get('eventId'),
            status: form.get('status'),
            actorId: portalSession.id
          });
          const payload = await getRegearData(client, portalSession.id, {
            staff: true,
            canManage: true,
            db: options.db || getDatabase()
          });
          const renewedPortal = createPortalSession(portalSession, env.dashboardSessionSecret, access);
          const renewedMaxAge = access.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
          return json(res, 200, { result, regear: { ...payload, csrf: portalSession.csrf } }, isProduction, {
            'Set-Cookie': cookie(PORTAL_SESSION_COOKIE, renewedPortal, { maxAge: renewedMaxAge, secure: secureCookie })
          });
        } catch (error) {
          return json(res, Number(error.statusCode || 400), { error: error.message || 'Não foi possível atualizar o regear.' }, isProduction);
        }
      }
      if (req.method !== 'GET') {
        send(res, 405, 'Método não permitido.', { Allow: 'GET', 'Content-Type': 'text/plain; charset=utf-8' }, isProduction);
        return;
      }
      if (url.pathname === '/') return serveFile(res, 'index.html', isProduction, 'public, max-age=300');
      if (url.pathname === '/cartilha') return serveFile(res, 'cartilha.html', isProduction, 'public, max-age=300');
      if (url.pathname === '/rotina') return serveFile(res, 'rotina.html', isProduction, 'public, max-age=300');
      if (url.pathname === '/minigame') return serveFile(res, 'minigame.html', isProduction, 'public, max-age=300');
      if (url.pathname === '/killboardguilds') return serveFile(res, 'killboardguilds.html', isProduction, 'public, max-age=300');
      if (url.pathname === '/SilverFarmBR') {
        return serveFile(res, 'silverfarmbr.html', isProduction, 'public, max-age=300', {
          'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://discord.com"
        });
      }
      if (url.pathname === '/sorteio' || url.pathname === '/sorteio-loot') {
        return serveFile(res, 'sorteio-loot.html', isProduction, 'public, max-age=300', {
          'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        });
      }
      if (url.pathname === '/sorteio240926') {
        return serveFile(res, 'sorteio240926.html', isProduction, 'public, max-age=300', {
          'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        });
      }
      const raffleImage = url.pathname.match(/^\/sorteio-imagem-([123])\.png$/);
      if (raffleImage) {
        return serveFile(res, `assets/sorteio-imagem-${raffleImage[1]}.png`, isProduction, 'public, max-age=86400');
      }
      const battleRoute = url.pathname.match(/^\/batalhas\/(\d+)$/);
      if (battleRoute) {
        const page = renderBattleReportPage(battleRoute[1], options.db);
        return send(res, page ? 200 : 404, page || notFoundPage(), {
          'Cache-Control': page ? 'public, max-age=300' : 'private, no-store',
          'Content-Type': 'text/html; charset=utf-8'
        }, isProduction);
      }
      if (url.pathname === '/api/public/rankings') {
        return json(res, 200, publicFameRankings(5), isProduction);
      }
      if (url.pathname === '/api/public/killboardguilds') {
        const period = url.searchParams.get('period') || '24h';
        if (!PERIODS[period]) return json(res, 400, { error: 'Período inválido.' }, isProduction);
        return json(res, 200, getGuildRankings(period, { db: options.db }), isProduction, {
          'Cache-Control': 'public, max-age=60'
        });
      }
      if (url.pathname === '/api/sorteio') {
        const staff = Boolean(session && await sessionStillAuthorized(client, session));
        const verificationId = portalSession?.id || session?.id || null;
        return json(res, 200, {
          state: massRaffle.getOfficialState(),
          staff,
          csrf: staff ? session.csrf : null,
          verification: verificationId ? massRaffle.getParticipantVerification(verificationId) : null
        }, isProduction);
      }
      if (url.pathname === '/api/public/sorteio240926') {
        const identity = portalSession || session;
        return json(res, 200, {
          state: constantPlayersRaffle.getState(identity?.id || null),
          viewer: { authenticated: Boolean(identity), csrf: identity?.csrf || null }
        }, isProduction, { 'Cache-Control': 'no-store' });
      }
      if (url.pathname === '/sorteio/verificar') {
        if (portalSession) return redirect(res, '/sorteio?verificar=1', {}, isProduction);
        if (session) {
          const access = await portalAccess(client, session.id);
          if (access) {
            const portalToken = createPortalSession(session, env.dashboardSessionSecret, access);
            const portalMaxAge = access.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
            return redirect(res, '/sorteio?verificar=1', {
              'Set-Cookie': cookie(PORTAL_SESSION_COOKIE, portalToken, { maxAge: portalMaxAge, secure: secureCookie })
            }, isProduction);
          }
        }
        return redirect(res, '/join/discord', {
          'Set-Cookie': cookie(PORTAL_RETURN_COOKIE, 'sorteio', { maxAge: OAUTH_STATE_MAX_AGE_SECONDS, secure: secureCookie })
        }, isProduction);
      }
      if (url.pathname === '/join') {
        if (!joinSession) return redirect(res, '/?join=required', {}, isProduction);
        return serveFile(res, 'join.html', isProduction, 'private, no-store');
      }
      if (url.pathname === '/dashboard') {
        if (!session && portalSession && await sessionCanAccessDashboard(client, portalSession)) {
          const access = await portalAccess(client, portalSession.id);
          const sessionToken = createSession({ ...portalSession, roles: access?.roles || portalSession.roles }, env.dashboardSessionSecret);
          return redirect(res, '/dashboard', {
            'Set-Cookie': cookie(SESSION_COOKIE, sessionToken, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
          }, isProduction);
        }
        if (!session) return redirect(res, '/?login=required', {}, isProduction);
        if (!await sessionCanAccessDashboard(client, session)) {
          return redirect(res, '/?auth=forbidden', { 'Set-Cookie': clearCookie(SESSION_COOKIE, secureCookie) }, isProduction);
        }
        return serveFile(res, 'dashboard.html', isProduction, 'private, no-store');
      }
      if (url.pathname === '/regear') {
        if (!portalSession && session) {
          const access = await portalAccess(client, session.id);
          if (access) {
            const portalToken = createPortalSession(session, env.dashboardSessionSecret, access);
            const portalMaxAge = access.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
            return redirect(res, '/regear', {
              'Set-Cookie': cookie(PORTAL_SESSION_COOKIE, portalToken, { maxAge: portalMaxAge, secure: secureCookie })
            }, isProduction);
          }
        }
        if (!portalSession) return redirect(res, '/join/discord', {}, isProduction);
        const access = await portalAccess(client, portalSession.id);
        if (!access || (access.accessLevel !== 'member' && !access.staffAllowed)) {
          return redirect(res, '/?portal=forbidden', {}, isProduction);
        }
        return serveFile(res, 'regear.html', isProduction, 'private, no-store');
      }
      if (url.pathname === '/pingcontent') {
        if (!session && portalSession && await sessionCanAccessPingContent(client, portalSession)) {
          const access = await portalAccess(client, portalSession.id);
          const sessionToken = createSession({ ...portalSession, roles: access?.roles || portalSession.roles }, env.dashboardSessionSecret);
          return redirect(res, '/pingcontent', {
            'Set-Cookie': cookie(SESSION_COOKIE, sessionToken, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
          }, isProduction);
        }
        if (!session) return redirect(res, '/auth/discord?return=pingcontent', {}, isProduction);
        if (!await sessionCanAccessPingContent(client, session)) {
          return redirect(res, '/?auth=forbidden', { 'Set-Cookie': clearCookie(SESSION_COOKIE, secureCookie) }, isProduction);
        }
        return serveFile(res, 'pingcontent.html', isProduction, 'private, no-store');
      }
      if (url.pathname.toLowerCase() === '/primetimeanalyzer') {
        return redirect(res, '/primetime', {}, isProduction);
      }
      if (url.pathname === '/primetime') {
        if (!session && portalSession && await sessionCanAccessDashboard(client, portalSession)) {
          const access = await portalAccess(client, portalSession.id);
          const sessionToken = createSession({ ...portalSession, roles: access?.roles || portalSession.roles }, env.dashboardSessionSecret);
          return redirect(res, '/primetime', {
            'Set-Cookie': cookie(SESSION_COOKIE, sessionToken, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
          }, isProduction);
        }
        if (!session) return redirect(res, '/?login=required', {}, isProduction);
        if (!await sessionStillAuthorized(client, session)) {
          return redirect(res, '/?auth=forbidden', { 'Set-Cookie': clearCookie(SESSION_COOKIE, secureCookie) }, isProduction);
        }
        return serveFile(res, 'primetime.html', isProduction, 'private, no-store');
      }
      if (url.pathname === '/comando') {
        if (!session) return redirect(res, '/?login=required', {}, isProduction);
        if (!await commandAccess(client, session)) {
          return redirect(res, '/?auth=forbidden', {}, isProduction);
        }
        return serveFile(res, 'command.html', isProduction, 'private, no-store');
      }
      if (url.pathname === '/intelligence' || url.pathname === '/notagintelligence') {
        if (session && await commandAccess(client, session)) return redirect(res, '/intelligence/staff', {}, isProduction);
        if (portalSession && await commandAccess(client, portalSession)) {
          const sessionToken = createSession(portalSession, env.dashboardSessionSecret);
          return redirect(res, '/intelligence/staff', {
            'Set-Cookie': cookie(SESSION_COOKIE, sessionToken, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
          }, isProduction);
        }
        if (portalSession && await portalAccess(client, portalSession.id)) return redirect(res, '/intelligence/membro', {}, isProduction);
        if (session) {
          const access = await portalAccess(client, session.id);
          if (access) {
            const portalToken = createPortalSession(session, env.dashboardSessionSecret, access);
            const portalMaxAge = access.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
            return redirect(res, '/intelligence/membro', {
              'Set-Cookie': cookie(PORTAL_SESSION_COOKIE, portalToken, { maxAge: portalMaxAge, secure: secureCookie })
            }, isProduction);
          }
        }
        return redirect(res, '/join/discord', {}, isProduction);
      }
      if (url.pathname === '/intelligence/staff') {
        if (!session && portalSession && await commandAccess(client, portalSession)) {
          const sessionToken = createSession(portalSession, env.dashboardSessionSecret);
          return redirect(res, '/intelligence/staff', {
            'Set-Cookie': cookie(SESSION_COOKIE, sessionToken, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
          }, isProduction);
        }
        if (!session) return redirect(res, '/?login=required', {}, isProduction);
        if (!await commandAccess(client, session)) return redirect(res, '/?auth=forbidden', {}, isProduction);
        return serveFile(res, 'command.html', isProduction, 'private, no-store');
      }
      if (url.pathname === '/intelligence/membro' || url.pathname === '/intelligence/member') {
        if (!portalSession && session) {
          const access = await portalAccess(client, session.id);
          if (access) {
            const portalToken = createPortalSession(session, env.dashboardSessionSecret, access);
            const portalMaxAge = access.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
            return redirect(res, '/intelligence/membro', {
              'Set-Cookie': cookie(PORTAL_SESSION_COOKIE, portalToken, { maxAge: portalMaxAge, secure: secureCookie })
            }, isProduction);
          }
        }
        if (!portalSession) return redirect(res, '/join/discord', {}, isProduction);
        const access = await portalAccess(client, portalSession.id);
        if (!access || access.accessLevel !== 'member') return redirect(res, '/?portal=forbidden', {}, isProduction);
        return serveFile(res, 'intelligence-member.html', isProduction, 'private, no-store');
      }
      if (url.pathname === '/portal/temporada') {
        if (!portalSession && session) {
          const access = await portalAccess(client, session.id);
          if (access) {
            const portalToken = createPortalSession(session, env.dashboardSessionSecret, access);
            const portalMaxAge = access.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
            return redirect(res, '/portal#temporada', {
              'Set-Cookie': [
                cookie(PORTAL_SESSION_COOKIE, portalToken, { maxAge: portalMaxAge, secure: secureCookie }),
                clearCookie(PORTAL_RETURN_COOKIE, secureCookie)
              ]
            }, isProduction);
          }
        }
        if (portalSession && await portalAccess(client, portalSession.id)) {
          return redirect(res, '/portal#temporada', { 'Set-Cookie': clearCookie(PORTAL_RETURN_COOKIE, secureCookie) }, isProduction);
        }
        return redirect(res, '/join/discord', {
          'Set-Cookie': cookie(PORTAL_RETURN_COOKIE, 'temporada', { maxAge: OAUTH_STATE_MAX_AGE_SECONDS, secure: secureCookie })
        }, isProduction);
      }
      if (url.pathname === '/portal') {
        if (!portalSession && session) {
          const access = await portalAccess(client, session.id);
          if (access) {
            const portalToken = createPortalSession(session, env.dashboardSessionSecret, access);
            const portalMaxAge = access.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
            return redirect(res, '/portal', {
              'Set-Cookie': cookie(PORTAL_SESSION_COOKIE, portalToken, { maxAge: portalMaxAge, secure: secureCookie })
            }, isProduction);
          }
        }
        if (!portalSession) return redirect(res, '/?portal=required', {}, isProduction);
        const access = await portalAccess(client, portalSession.id);
        if (!access) {
          return redirect(res, '/?portal=forbidden', { 'Set-Cookie': clearCookie(PORTAL_SESSION_COOKIE, secureCookie) }, isProduction);
        }
        return serveFile(res, 'member.html', isProduction, 'private, no-store');
      }
      if (url.pathname === '/auth/discord') {
        const requestedReturn = ['sorteio', 'pingcontent'].includes(url.searchParams.get('return'))
          ? url.searchParams.get('return')
          : cookies[STAFF_RETURN_COOKIE];
        const staffDestination = staffReturnDestination(requestedReturn);
        if (session && await sessionCanAccessDashboard(client, session)) return redirect(res, staffDestination, { 'Set-Cookie': clearCookie(STAFF_RETURN_COOKIE, secureCookie) }, isProduction);
        if (portalSession && await sessionCanAccessDashboard(client, portalSession)) {
          const access = await portalAccess(client, portalSession.id);
          const sessionToken = createSession({ ...portalSession, roles: access?.roles || portalSession.roles }, env.dashboardSessionSecret);
          return redirect(res, staffDestination, {
            'Set-Cookie': [
              cookie(SESSION_COOKIE, sessionToken, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie }),
              clearCookie(STAFF_RETURN_COOKIE, secureCookie)
            ]
          }, isProduction);
        }
        if (!configuredForOAuth()) return redirect(res, '/?auth=unavailable', {}, isProduction);
        const state = createOAuthState(env.dashboardSessionSecret);
        const redirectUri = `${env.dashboardBaseUrl}/auth/discord/callback`;
        const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
        authorizeUrl.search = new URLSearchParams({
          client_id: env.discordClientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'identify',
          state
        });
        const returnCookie = ['sorteio', 'pingcontent'].includes(url.searchParams.get('return'))
          ? cookie(STAFF_RETURN_COOKIE, url.searchParams.get('return'), { maxAge: OAUTH_STATE_MAX_AGE_SECONDS, secure: secureCookie })
          : clearCookie(STAFF_RETURN_COOKIE, secureCookie);
        return redirect(res, authorizeUrl.toString(), {
          'Set-Cookie': [
            cookie(OAUTH_STATE_COOKIE, state, { maxAge: OAUTH_STATE_MAX_AGE_SECONDS, secure: secureCookie }),
            returnCookie
          ]
        }, isProduction);
      }
      if (url.pathname === '/auth/discord/callback') {
        const returnedState = url.searchParams.get('state');
        const storedState = cookies[OAUTH_STATE_COOKIE];
        if (!returnedState || returnedState !== storedState || !validateOAuthState(storedState, env.dashboardSessionSecret)) {
          return redirect(res, '/?auth=invalid', { 'Set-Cookie': clearCookie(OAUTH_STATE_COOKIE, secureCookie) }, isProduction);
        }
        const code = url.searchParams.get('code');
        if (!code) return redirect(res, '/?auth=cancelled', { 'Set-Cookie': clearCookie(OAUTH_STATE_COOKIE, secureCookie) }, isProduction);
        const { user: discordUser } = await exchangeDiscordCode(code, `${env.dashboardBaseUrl}/auth/discord/callback`, fetchImpl);
        const access = await authorizeStaff(client, discordUser);
        if (!access.allowed) return redirect(res, '/?auth=forbidden', { 'Set-Cookie': clearCookie(OAUTH_STATE_COOKIE, secureCookie) }, isProduction);
        const sessionToken = createSession({ ...discordUser, roles: access.roles }, env.dashboardSessionSecret);
        const portalAccessResult = await portalAccess(client, discordUser.id);
        const portalToken = createPortalSession(discordUser, env.dashboardSessionSecret, portalAccessResult || { accessLevel: 'member', privileged: true, roles: access.roles });
        const portalMaxAge = portalAccessResult?.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
        const staffDestination = staffReturnDestination(cookies[STAFF_RETURN_COOKIE]);
        return redirect(res, staffDestination, {
          'Set-Cookie': [
            cookie(SESSION_COOKIE, sessionToken, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie }),
            cookie(PORTAL_SESSION_COOKIE, portalToken, { maxAge: portalMaxAge, secure: secureCookie }),
            clearCookie(OAUTH_STATE_COOKIE, secureCookie),
            clearCookie(STAFF_RETURN_COOKIE, secureCookie)
          ]
        }, isProduction);
      }
      if (url.pathname === '/join/discord') {
        const requestedPortalReturn = url.searchParams.get('return') === 'constant-raffle'
          ? 'constant-raffle'
          : cookies[PORTAL_RETURN_COOKIE];
        const portalDestination = requestedPortalReturn === 'constant-raffle'
          ? '/sorteio240926?confirm=1'
          : requestedPortalReturn === 'temporada'
          ? '/portal#temporada'
          : requestedPortalReturn === 'sorteio'
            ? '/sorteio?verificar=1'
            : '/portal';
        if (portalSession && await portalAccess(client, portalSession.id)) {
          return redirect(res, portalDestination, { 'Set-Cookie': clearCookie(PORTAL_RETURN_COOKIE, secureCookie) }, isProduction);
        }
        if (session) {
          const access = await portalAccess(client, session.id);
          if (access) {
            const portalToken = createPortalSession(session, env.dashboardSessionSecret, access);
            const portalMaxAge = access.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
            return redirect(res, portalDestination, {
              'Set-Cookie': [
                cookie(PORTAL_SESSION_COOKIE, portalToken, { maxAge: portalMaxAge, secure: secureCookie }),
                clearCookie(PORTAL_RETURN_COOKIE, secureCookie)
              ]
            }, isProduction);
          }
        }
        if (!configuredForOAuth() || !onboardingConfigured()) return redirect(res, '/?join=unavailable', {}, isProduction);
        const state = createOAuthState(env.dashboardSessionSecret);
        const redirectUri = `${env.dashboardBaseUrl}/join/discord/callback`;
        const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
        authorizeUrl.search = new URLSearchParams({
          client_id: env.discordClientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'identify guilds.join',
          state
        });
        return redirect(res, authorizeUrl.toString(), {
          'Set-Cookie': [
            cookie(JOIN_OAUTH_STATE_COOKIE, state, { maxAge: OAUTH_STATE_MAX_AGE_SECONDS, secure: secureCookie }),
            ...(requestedPortalReturn === 'constant-raffle'
              ? [cookie(PORTAL_RETURN_COOKIE, requestedPortalReturn, { maxAge: OAUTH_STATE_MAX_AGE_SECONDS, secure: secureCookie })]
              : [])
          ]
        }, isProduction);
      }
      if (url.pathname === '/join/discord/callback') {
        const returnedState = url.searchParams.get('state');
        const storedState = cookies[JOIN_OAUTH_STATE_COOKIE];
        if (!returnedState || returnedState !== storedState || !validateOAuthState(storedState, env.dashboardSessionSecret)) {
          return redirect(res, '/?join=invalid', { 'Set-Cookie': clearCookie(JOIN_OAUTH_STATE_COOKIE, secureCookie) }, isProduction);
        }
        const code = url.searchParams.get('code');
        if (!code) return redirect(res, '/?join=cancelled', { 'Set-Cookie': clearCookie(JOIN_OAUTH_STATE_COOKIE, secureCookie) }, isProduction);
        const { token, user: discordUser } = await exchangeDiscordCode(code, `${env.dashboardBaseUrl}/join/discord/callback`, fetchImpl);
        await ensureGuestMember(client, discordUser, token.access_token);
        const access = await portalAccess(client, discordUser.id);
        const joinToken = createJoinSession(discordUser, env.dashboardSessionSecret);
        const portalToken = createPortalSession(discordUser, env.dashboardSessionSecret, access || {});
        const portalMaxAge = access?.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
        const staffToken = access?.staffAllowed
          ? createSession({ ...discordUser, roles: access.roles }, env.dashboardSessionSecret)
          : null;
        const existingProfile = getPortalData(discordUser.id, access?.accessLevel || 'guest', access?.privileged || false).profile;
        const portalReturn = cookies[PORTAL_RETURN_COOKIE] === 'temporada'
          ? '/portal#temporada'
          : cookies[PORTAL_RETURN_COOKIE] === 'sorteio'
            ? '/sorteio?verificar=1'
            : cookies[PORTAL_RETURN_COOKIE] === 'constant-raffle'
              ? '/sorteio240926?confirm=1'
            : '/portal';
        const destination = portalReturn === '/sorteio240926?confirm=1' || access?.accessLevel === 'member' || existingProfile.albionName
          ? portalReturn
          : '/join';
        return redirect(res, destination, {
          'Set-Cookie': [
            cookie(JOIN_SESSION_COOKIE, joinToken, { maxAge: JOIN_SESSION_MAX_AGE_SECONDS, secure: secureCookie }),
            cookie(PORTAL_SESSION_COOKIE, portalToken, { maxAge: portalMaxAge, secure: secureCookie }),
            ...(staffToken ? [cookie(SESSION_COOKIE, staffToken, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })] : []),
            clearCookie(JOIN_OAUTH_STATE_COOKIE, secureCookie),
            clearCookie(PORTAL_RETURN_COOKIE, secureCookie)
          ]
        }, isProduction);
      }
      if (url.pathname === '/auth/logout') {
        return redirect(res, '/', { 'Set-Cookie': [
          clearCookie(SESSION_COOKIE, secureCookie),
          clearCookie(PORTAL_SESSION_COOKIE, secureCookie),
          clearCookie(JOIN_SESSION_COOKIE, secureCookie)
        ] }, isProduction);
      }
      if (url.pathname === '/api/join-session') {
        if (!joinSession) return json(res, 401, { error: 'Sessão de entrada necessária.' }, isProduction);
        return json(res, 200, { user: {
          id: joinSession.id,
          name: joinSession.globalName || joinSession.username,
          username: joinSession.username,
          avatarUrl: avatarUrl(joinSession)
        }, csrf: joinSession.csrf }, isProduction);
      }
      if (url.pathname === '/api/session') {
        if (!session) return json(res, 401, { error: 'Sessão necessária.' }, isProduction);
        const access = await dashboardAccess(client, session);
        if (!access.allowed) return json(res, 403, { error: 'Acesso de staff necessário.' }, isProduction);
        const renewedSession = createSession(session, env.dashboardSessionSecret);
        return json(res, 200, { user: {
          id: session.id,
          name: session.globalName || session.username,
          username: session.username,
          avatarUrl: avatarUrl(session)
        }, csrf: session.csrf || null, permissions: {
          full: access.full,
          registrations: access.canReviewRegistrations,
          intelligence: await commandAccess(client, session)
        } }, isProduction, {
          'Set-Cookie': cookie(SESSION_COOKIE, renewedSession, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
        });
      }
      if (url.pathname === '/api/portal/session') {
        if (!portalSession) return json(res, 401, { error: 'Entre com o Discord para acessar seu portal.' }, isProduction);
        const access = await portalAccess(client, portalSession.id);
        if (!access) return json(res, 403, { error: 'Você precisa estar no Discord da Notag.' }, isProduction);
        const renewedPortal = createPortalSession(portalSession, env.dashboardSessionSecret, access);
        const renewedMaxAge = access.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
        return json(res, 200, { user: {
          id: portalSession.id,
          name: portalSession.globalName || portalSession.username,
          username: portalSession.username,
          avatarUrl: avatarUrl(portalSession),
          accessLevel: access.accessLevel,
          privileged: access.privileged,
          canAccessStaff: access.staffAllowed,
          canAccessIntelligence: await commandAccess(client, portalSession)
        }, csrf: portalSession.csrf }, isProduction, {
          'Set-Cookie': cookie(PORTAL_SESSION_COOKIE, renewedPortal, { maxAge: renewedMaxAge, secure: secureCookie })
        });
      }
      if (url.pathname === '/api/portal') {
        if (!portalSession) return json(res, 401, { error: 'Entre com o Discord para acessar seu portal.' }, isProduction);
        const access = await portalAccess(client, portalSession.id);
        if (!access) return json(res, 403, { error: 'Você precisa estar no Discord da Notag.' }, isProduction);
        const renewedPortal = createPortalSession(portalSession, env.dashboardSessionSecret, access);
        const renewedMaxAge = access.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
        return json(res, 200, getPortalData(portalSession.id, access.accessLevel, access.privileged), isProduction, {
          'Set-Cookie': cookie(PORTAL_SESSION_COOKIE, renewedPortal, { maxAge: renewedMaxAge, secure: secureCookie })
        });
      }
      if (url.pathname === '/api/dashboard') {
        if (!session) return json(res, 401, { error: 'Sessão necessária.' }, isProduction);
        const access = await dashboardAccess(client, session);
        if (!access.allowed) return json(res, 403, { error: 'Acesso de staff necessário.' }, isProduction);
        const renewedSession = createSession(session, env.dashboardSessionSecret);
        return json(res, 200, await staffDashboardPayload(client, access), isProduction, {
          'Set-Cookie': cookie(SESSION_COOKIE, renewedSession, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
        });
      }
      if (url.pathname === '/api/regear') {
        if (!portalSession) return json(res, 401, { error: 'Entre com o Discord para acessar o regear.' }, isProduction);
        const access = await portalAccess(client, portalSession.id);
        if (!access || (access.accessLevel !== 'member' && !access.staffAllowed)) {
          return json(res, 403, { error: 'Acesso de membro necessário.' }, isProduction);
        }
        const payload = await getRegearData(client, portalSession.id, {
          staff: access.staffAllowed,
          canManage: access.full,
          db: options.db || getDatabase()
        });
        const renewedPortal = createPortalSession(portalSession, env.dashboardSessionSecret, access);
        const renewedMaxAge = access.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
        return json(res, 200, { ...payload, csrf: portalSession.csrf }, isProduction, {
          'Set-Cookie': cookie(PORTAL_SESSION_COOKIE, renewedPortal, { maxAge: renewedMaxAge, secure: secureCookie })
        });
      }
      if (url.pathname === '/api/staff/pingcontent') {
        if (!session) return json(res, 401, { error: 'Sessão da staff necessária.' }, isProduction);
        if (!await sessionCanAccessPingContent(client, session)) return json(res, 403, { error: 'Acesso de Caller, Staff ou ADM necessário.' }, isProduction);
        return json(res, 200, {
          user: {
            id: session.id,
            name: session.globalName || session.username,
            username: session.username,
            avatarUrl: avatarUrl(session)
          },
          csrf: session.csrf,
          ...pingContentBootstrap(session.id)
        }, isProduction);
      }
      if (url.pathname === '/api/primetime') {
        if (!session) return json(res, 401, { error: 'Sessão necessária.' }, isProduction);
        if (!await sessionStillAuthorized(client, session)) return json(res, 403, { error: 'Acesso de staff necessário.' }, isProduction);
        const renewedSession = createSession(session, env.dashboardSessionSecret);
        return json(res, 200, await getPrimeTimeData(client, { days: url.searchParams.get('days') }), isProduction, {
          'Set-Cookie': cookie(SESSION_COOKIE, renewedSession, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
        });
      }
      if (url.pathname === '/api/comando') {
        if (!session) return json(res, 401, { error: 'Sessão necessária.' }, isProduction);
        if (!await commandAccess(client, session)) return json(res, 403, { error: 'Acesso ao NOTAG Intelligence não autorizado.' }, isProduction);
        const renewedSession = createSession(session, env.dashboardSessionSecret);
        return json(res, 200, await getCommandIntelligenceData(client), isProduction, {
          'Set-Cookie': cookie(SESSION_COOKIE, renewedSession, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
        });
      }
      if (url.pathname === '/api/intelligence/staff') {
        if (!session) return json(res, 401, { error: 'Sessão necessária.' }, isProduction);
        if (!await commandAccess(client, session)) return json(res, 403, { error: 'Acesso ao NOTAG Intelligence Staff não autorizado.' }, isProduction);
        const renewedSession = createSession(session, env.dashboardSessionSecret);
        return json(res, 200, await getCommandIntelligenceData(client), isProduction, {
          'Set-Cookie': cookie(SESSION_COOKIE, renewedSession, { maxAge: SESSION_MAX_AGE_SECONDS, secure: secureCookie })
        });
      }
      if (url.pathname === '/api/intelligence/membro' || url.pathname === '/api/intelligence/member') {
        if (!portalSession) return json(res, 401, { error: 'Entre com o Discord para acessar seu Intelligence.' }, isProduction);
        const access = await portalAccess(client, portalSession.id);
        if (!access || access.accessLevel !== 'member') return json(res, 403, { error: 'Acesso de membro necessário.' }, isProduction);
        const payload = await getMemberIntelligenceData(client, portalSession.id);
        if (!payload) return json(res, 404, { error: 'Não encontramos um perfil vinculado à sua conta.' }, isProduction);
        const renewedPortal = createPortalSession(portalSession, env.dashboardSessionSecret, access);
        const renewedMaxAge = access.privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
        return json(res, 200, payload, isProduction, {
          'Set-Cookie': cookie(PORTAL_SESSION_COOKIE, renewedPortal, { maxAge: renewedMaxAge, secure: secureCookie })
        });
      }
      if (url.pathname === '/health') {
        const health = runtimeHealth(client);
        return json(res, health.ok ? 200 : 503, {
          status: health.ok ? 'ok' : 'degraded',
          service: 'notag',
          discord: health.discord,
          database: health.database
        }, isProduction);
      }
      if (url.pathname.startsWith('/assets/')) return serveFile(res, url.pathname.slice(1), isProduction);
      return send(res, 404, 'Não encontrado.', { 'Content-Type': 'text/plain; charset=utf-8' }, isProduction);
    } catch (error) {
      console.error('[DASHBOARD] Falha ao processar requisição:', error);
      if (url.pathname.startsWith('/api/')) return json(res, 500, { error: 'Não foi possível carregar os dados.' }, isProduction);
      if (url.pathname.startsWith('/join/')) return redirect(res, '/?join=error', {}, isProduction);
      return redirect(res, '/?auth=error', {}, isProduction);
    }
  };
}

function startWebServer(client) {
  const server = http.createServer(createRequestHandler(client));
  server.listen(env.dashboardPort, env.dashboardHost, () => {
    console.log(`[DASHBOARD] Online em ${env.dashboardBaseUrl} (${env.dashboardHost}:${env.dashboardPort}).`);
  });
  return server;
}

module.exports = { createRequestHandler, runtimeHealth, startWebServer };
