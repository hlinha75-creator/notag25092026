const crypto = require('node:crypto');

const SESSION_COOKIE = 'notag_session';
const OAUTH_STATE_COOKIE = 'notag_oauth_state';
const JOIN_SESSION_COOKIE = 'notag_join_session';
const JOIN_OAUTH_STATE_COOKIE = 'notag_join_oauth_state';
const PORTAL_SESSION_COOKIE = 'notag_portal_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const JOIN_SESSION_MAX_AGE_SECONDS = 30 * 60;
const PORTAL_MEMBER_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const PORTAL_PRIVILEGED_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSignedValue(payload, secret) {
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

function readSignedValue(token, secret) {
  if (!token || !secret) return null;
  const [encoded, signature, extra] = String(token).split('.');
  if (!encoded || !signature || extra || !timingSafeEqual(signature, sign(encoded, secret))) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function createSession(user, secret, now = Date.now()) {
  return createSignedValue({
    purpose: 'staff',
    id: user.id,
    username: user.username,
    globalName: user.global_name || user.globalName || user.username,
    avatar: user.avatar || null,
    roles: user.roles || [],
    csrf: user.csrf || crypto.randomBytes(24).toString('base64url'),
    exp: now + SESSION_MAX_AGE_SECONDS * 1000
  }, secret);
}

function readSession(token, secret, now = Date.now()) {
  const session = readSignedValue(token, secret);
  if (session?.purpose !== 'staff' || !session.id || !session.exp || session.exp <= now) return null;
  return session;
}

function createJoinSession(user, secret, now = Date.now()) {
  return createSignedValue({
    purpose: 'join',
    id: user.id,
    username: user.username,
    globalName: user.global_name || user.username,
    avatar: user.avatar || null,
    csrf: user.csrf || crypto.randomBytes(24).toString('base64url'),
    exp: now + JOIN_SESSION_MAX_AGE_SECONDS * 1000
  }, secret);
}

function readJoinSession(token, secret, now = Date.now()) {
  const session = readSignedValue(token, secret);
  if (session?.purpose !== 'join' || !session.id || !session.csrf || !session.exp || session.exp <= now) return null;
  return session;
}

function createPortalSession(user, secret, options = {}, now = Date.now()) {
  const privileged = Boolean(options.privileged);
  const maxAgeSeconds = privileged ? PORTAL_PRIVILEGED_MAX_AGE_SECONDS : PORTAL_MEMBER_MAX_AGE_SECONDS;
  return createSignedValue({
    purpose: 'portal',
    id: user.id,
    username: user.username,
    globalName: user.global_name || user.globalName || user.username,
    avatar: user.avatar || null,
    roles: options.roles || user.roles || [],
    accessLevel: options.accessLevel || 'guest',
    privileged,
    csrf: user.csrf || crypto.randomBytes(24).toString('base64url'),
    exp: now + maxAgeSeconds * 1000
  }, secret);
}

function readPortalSession(token, secret, now = Date.now()) {
  const session = readSignedValue(token, secret);
  if (session?.purpose !== 'portal' || !session.id || !session.csrf || !session.exp || session.exp <= now) return null;
  return session;
}

function createOAuthState(secret, now = Date.now()) {
  return createSignedValue({ nonce: crypto.randomBytes(24).toString('base64url'), exp: now + OAUTH_STATE_MAX_AGE_SECONDS * 1000 }, secret);
}

function validateOAuthState(token, secret, now = Date.now()) {
  const state = readSignedValue(token, secret);
  return Boolean(state?.nonce && state.exp > now);
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return [part.trim(), ''];
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { return [key, decodeURIComponent(value)]; } catch { return [key, value]; }
  }).filter(([key]) => key));
}

function cookie(name, value, { maxAge, secure = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join('; ');
}

function clearCookie(name, secure = true) {
  return cookie(name, '', { maxAge: 0, secure });
}

module.exports = {
  JOIN_OAUTH_STATE_COOKIE,
  JOIN_SESSION_COOKIE,
  JOIN_SESSION_MAX_AGE_SECONDS,
  PORTAL_MEMBER_MAX_AGE_SECONDS,
  PORTAL_PRIVILEGED_MAX_AGE_SECONDS,
  PORTAL_SESSION_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SECONDS,
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
};
