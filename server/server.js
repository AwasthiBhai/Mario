/* STARBOUND — secure backend API (Node, zero dependencies).
 *
 * Architecture:
 *   PLAYER -> GitHub Pages frontend -> THIS API -> MantleDB -> database
 * The browser NEVER talks to MantleDB directly and NEVER receives private
 * credentials. All MantleDB configuration lives here as environment
 * variables on the backend host.
 *
 * Run locally (Windows, no admin):
 *   cd server
 *   npm install   (no-op: zero deps, verifies Node works)
 *   npm run dev   (or: node server.js)
 *
 * Env (see .env.example for NAMES; values live ONLY on the host):
 *   PORT, MANTLEDB_BASE_URL, MANTLEDB_NAMESPACE,
 *   MANTLEDB_REVIEWS_ENTRY, MANTLEDB_PROFILES_ENTRY, MANTLEDB_API_KEY,
 *   ALLOWED_ORIGINS, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, MAX_BODY_BYTES,
 *   AUTH_PEPPER, AUTH_SESSION_TTL_MS,
 *   AUTH_RATE_LIMIT_WINDOW_MS, AUTH_RATE_LIMIT_MAX
 *
 * Auth model (passwords + sessions):
 *   - Passwords are verified ONLY here, never in the browser. Verifier is
 *     Node built-in crypto.scrypt (memory-hard KDF, zero dependencies) over
 *     (AUTH_PEPPER + '\\0' + password) with a unique 16-byte salt per
 *     password. The raw MantleDB document is publicly readable by design
 *     (unclaimed namespace), so the pepper — a high-entropy server-side
 *     secret that never leaves this host — is what makes offline guessing
 *     infeasible even if someone fetches the raw document directly.
 *     Argon2id would need a native dependency; scrypt is the strongest
 *     password KDF available in this zero-dependency Node runtime.
 *   - Sessions are opaque 256-bit random tokens. Only SHA-256(token) is
 *     stored (per user, bounded, with expiry); the raw token is returned
 *     once over HTTPS and never again. The server resolves identity FROM
 *     the token and never trusts a client-supplied id alone.
 *   - Legacy device secrets (secretHash) keep working so existing accounts
 *     and devices never break; new password sessions are accepted alongside
 *     them on every owner endpoint.
 */
'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* ---------------- env ---------------- */
function loadDotEnv() {
  try {
    const p = path.join(__dirname, '.env');
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.indexOf('=') < 0) continue;
      const k = t.slice(0, t.indexOf('=')).trim();
      let v = t.slice(t.indexOf('=') + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch (e) { /* missing .env is fine */ }
}
loadDotEnv();

const CFG = {
  port: parseInt(process.env.PORT, 10) || 8787,
  mantleBase: (process.env.MANTLEDB_BASE_URL || 'https://mantledb.sh/v2').replace(/\/$/, ''),
  mantleNs: process.env.MANTLEDB_NAMESPACE || 'starlit-pip-guestbook',
  reviewsEntry: process.env.MANTLEDB_REVIEWS_ENTRY || 'reviews',
  profilesEntry: process.env.MANTLEDB_PROFILES_ENTRY || 'profiles-v1',
  apiKey: process.env.MANTLEDB_API_KEY || '',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  rateWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
  rateMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 120,
  maxBody: parseInt(process.env.MAX_BODY_BYTES, 10) || 65536,
  fetchTimeoutMs: 12000,
  // Auth-only secrets/config. AUTH_PEPPER is a high-entropy random string
  // set on the backend host (see .env.example for the NAME only). It is
  // mixed into every password hash and never stored in the database,
  // never sent to browsers, never logged.
  authPepper: process.env.AUTH_PEPPER || '',
  sessionTtlMs: parseInt(process.env.AUTH_SESSION_TTL_MS, 10) || 60 * 24 * 60 * 60 * 1000,
  authRateWindowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10) || 10 * 60 * 1000,
  authRateMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 30,
};

function mantleHeaders(json) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  // Optional credential for a CLAIMED namespace. Never sent to browsers.
  if (CFG.apiKey) h['Authorization'] = 'Bearer ' + CFG.apiKey;
  return h;
}
function reviewsUrl() {
  return CFG.mantleBase + '/' + encodeURIComponent(CFG.mantleNs) + '/' + encodeURIComponent(CFG.reviewsEntry);
}
function profilesUrl() {
  return CFG.mantleBase + '/' + encodeURIComponent(CFG.mantleNs) + '/' + encodeURIComponent(CFG.profilesEntry);
}

/* ---------------- limits (mirror frontend, authoritative here) ---------------- */
const MAX_NAME_REVIEW = 40, MAX_TEXT = 600, MAX_SHARED = 120;
const MAX_USERS = 300;
const MAX_NAME = 24, MAX_PID = 20, MIN_PID = 3, MAX_LEVEL = 50;
const MAX_SCORE = 100000, MAX_COINS_RUN = 500, MAX_TIME_S = 3600;
const MAX_RUNS = 40;
const PID_RE = /^[a-z0-9._-]+$/i;
const PRESET_AVATARS = new Set([
  'nova-star', 'astronaut', 'ringed-planet', 'rocket', 'alien', 'robot',
  'comet', 'moon', 'sun', 'ufo', 'satellite', 'lantern-fox', 'crystal-gem',
  'black-hole', 'telescope', 'constellation', 'meteor', 'galaxy',
  'star-badge', 'nebula',
]);
const CUSTOM_AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const RESET_VERSION = 1;

/* ---------------- small utils ---------------- */
function sendJson(res, status, obj, corsHeaders, extraHeaders) {
  const body = JSON.stringify(obj);
  const h = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  }, corsHeaders || {}, extraHeaders || {});
  res.writeHead(status, h);
  res.end(body);
}

/* Authenticated responses must never be cached anywhere (no session data,
 * owner records or tokens in shared caches). */
function noStoreHeaders() {
  return { 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' };
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim().slice(0, 64);
  return (req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : 'unknown').slice(0, 64);
}

function isOriginAllowed(origin) {
  if (!origin) return true; // curl / same-origin navigations / health checks
  const o = String(origin).trim();
  if (!o) return true;
  // Dev loopbacks are always allowed so `npm run dev` works out of the box.
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(o)) return true;
  if (!CFG.allowedOrigins.length) {
    // Sensible default when ALLOWED_ORIGINS is unset: any https GitHub Pages
    // origin plus http(s) localhost. Everything else gets no ACAO header
    // (browser blocks the read) but still receives a safe JSON error.
    if (/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(o)) return true;
    return false;
  }
  for (const pat of CFG.allowedOrigins) {
    if (pat === '*') return true;
    if (pat === o) return true;
    // Support "*.example.com" style entries.
    if (pat.startsWith('*.')) {
      const suffix = pat.slice(1);
      try {
        const host = new URL(o).hostname.toLowerCase();
        if (host.endsWith(suffix.toLowerCase())) return true;
      } catch (e) { /* ignore */ }
    }
  }
  return false;
}

function corsFor(req) {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };
  }
  return { 'Vary': 'Origin' };
}

/* Sliding-window rate limiter (in-memory, per process — adequate for a
 * small game API; a multi-instance deploy would move this to shared store). */
const rateBuckets = new Map();
function rateLimited(ip, bucket) {
  const now = Date.now();
  const key = ip + '|' + bucket;
  let b = rateBuckets.get(key);
  if (!b || now >= b.reset) {
    b = { count: 0, reset: now + CFG.rateWindowMs };
    rateBuckets.set(key, b);
  }
  b.count += 1;
  // Periodic cleanup so the map cannot grow without bound.
  if (rateBuckets.size > 5000 && Math.random() < 0.01) {
    for (const [k, v] of rateBuckets) if (now >= v.reset) rateBuckets.delete(k);
  }
  return b.count > CFG.rateMax;
}
function bucketFor(method, pathname) {
  if (method === 'GET') return 'read';
  if (pathname === '/api/reviews') return 'reviews-write';
  if (pathname.indexOf('/api/profiles') === 0) return 'profiles-write';
  return 'write';
}

/* Stricter, separate limiter for authentication endpoints (signin / signup /
 * set-password). Temporary throttling only: sliding window per IP, never a
 * permanent account lockout (lockouts would let attackers deny service to
 * legitimate players). Generic 429 when exceeded — remaining attempts are
 * never revealed. */
const authRateBuckets = new Map();
function authRateLimited(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown').slice(0, 64);
  let b = authRateBuckets.get(key);
  if (!b || now >= b.reset) {
    b = { count: 0, reset: now + CFG.authRateWindowMs };
    authRateBuckets.set(key, b);
  }
  b.count += 1;
  if (authRateBuckets.size > 5000 && Math.random() < 0.01) {
    for (const [k, v] of authRateBuckets) if (now >= v.reset) authRateBuckets.delete(k);
  }
  return b.count > CFG.authRateMax;
}
function resetAuthLimits() {
  authRateBuckets.clear();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    let tooBig = false;
    req.on('data', (c) => {
      bytes += c.length;
      if (bytes > CFG.maxBody) { tooBig = true; }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) {
        const e = new Error('Request body too large.');
        e.status = 413;
        reject(e);
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) { resolve({}); return; }
      try {
        const v = JSON.parse(raw);
        resolve(v && typeof v === 'object' ? v : {});
      } catch (e) {
        const err = new Error('Malformed JSON.');
        err.status = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function mantleGet(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => { try { ctl.abort(); } catch (e) { } }, CFG.fetchTimeoutMs);
  try {
    const r = await fetch(url, { method: 'GET', headers: mantleHeaders(false), signal: ctl.signal });
    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
    if (!r.ok) {
      const e = new Error('Database unavailable. Please try again.');
      // Preserve 404 (entry does not exist yet → treated as an empty doc
      // by the handlers below); map size errors to 413, rest to 502.
      e.status = r.status === 413 ? 413 : (r.status === 404 ? 404 : 502);
      throw e;
    }
    return data;
  } catch (e) {
    if (e && (e.status === 413 || e.status === 502 || e.status === 404)) throw e;
    const err = new Error('Database unavailable. Please try again.');
    err.status = 502;
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function mantlePost(url, doc) {
  const ctl = new AbortController();
  const t = setTimeout(() => { try { ctl.abort(); } catch (e) { } }, CFG.fetchTimeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST', headers: mantleHeaders(true),
      body: JSON.stringify(doc), signal: ctl.signal,
    });
    const txt = await r.text();
    let ack = null;
    try { ack = txt ? JSON.parse(txt) : null; } catch (e) { ack = null; }
    if (!r.ok || !ack || ack.success !== true) {
      const e = new Error('Database unavailable. Please try again.');
      e.status = (!r.ok && r.status === 413) ? 413 : 502;
      throw e;
    }
    return true;
  } catch (e) {
    if (e && (e.status === 413 || e.status === 502)) throw e;
    const err = new Error('Database unavailable. Please try again.');
    err.status = 502;
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/* Serialize read-modify-write cycles per entry so concurrent writers cannot
 * silently lose each other's updates. */
let reviewsChain = Promise.resolve();
let profilesChain = Promise.resolve();
function withReviewsLock(fn) {
  const p = reviewsChain.then(fn, fn);
  reviewsChain = p.catch(() => { });
  return p;
}
function withProfilesLock(fn) {
  const p = profilesChain.then(fn, fn);
  profilesChain = p.catch(() => { });
  return p;
}

/* A 404 from MantleDB means the entry was never created (first run) —
 * treat it as an empty doc instead of an error. */
async function getReviewsDoc() {
  try {
    return await mantleGet(reviewsUrl());
  } catch (e) {
    if (e && e.status === 404) return { reviews: [] };
    throw e;
  }
}
async function getProfilesDoc() {
  try {
    const raw = await mantleGet(profilesUrl());
    return sanitizeDoc(raw);
  } catch (e) {
    if (e && e.status === 404) return { v: 1, resetVersion: 0, users: [] };
    throw e;
  }
}

/* ---------------- sanitizers / validation (authoritative) ---------------- */
function cleanName(name, max) {
  return String(name == null ? '' : name).replace(/[\u0000-\u001F\u007F]/g, '').trim().replace(/\s+/g, ' ').slice(0, max);
}
function num(v, lo, hi, fb) {
  v = Number(v);
  if (!isFinite(v)) return fb;
  v = Math.floor(v);
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
function sha256hex(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}
function secretsMatch(secret, secretHash) {
  try {
    if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/i.test(secret)) return false;
    if (typeof secretHash !== 'string' || !/^[0-9a-f]{64}$/i.test(secretHash)) return false;
    const a = Buffer.from(sha256hex(secret.toLowerCase()), 'hex');
    const b = Buffer.from(secretHash.toLowerCase(), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}
function randHex(nBytes) {
  return crypto.randomBytes(nBytes).toString('hex');
}
function uid(prefix) {
  return (prefix || 'r_') + Date.now().toString(36) + '_' + randHex(9);
}

/* ---------------- passwords (scrypt + server pepper, zero dependencies) -- */
const PW_MIN_LEN = 8, PW_MAX_LEN = 256;
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_LEN = 64;
const MAX_SESSIONS_PER_USER = 10;
const SESSION_TOKEN_RE = /^[0-9a-f]{64}$/i;
const SIGNIN_GENERIC_ERROR = 'The sign-in details are incorrect.';

function validatePasswordInput(pw) {
  if (typeof pw !== 'string') return { ok: false, error: 'Please choose a password.' };
  if (!pw || !pw.trim()) return { ok: false, error: 'Please choose a password.' };
  if (pw.length < PW_MIN_LEN) {
    return { ok: false, error: 'Password must be at least ' + PW_MIN_LEN + ' characters.' };
  }
  if (pw.length > PW_MAX_LEN) {
    return { ok: false, error: 'Password must be ' + PW_MAX_LEN + ' characters or fewer.' };
  }
  return { ok: true, value: pw };
}

function scryptAsync(password, salt, N, r, p, len) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, len, { N, r, p }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/* Stored format (versioned, params embedded for future upgrades):
 *   scrypt$N=16384,r=8,p=1,len=64$<saltHex16B>$<hashHex64B>
 * The pepper is mixed into the KDF input and lives ONLY as AUTH_PEPPER on
 * the backend host — never in the DB, never in code, never logged. */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const input = String(CFG.authPepper || '') + '\0' + String(password);
  const derived = await scryptAsync(input, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_LEN);
  return 'scrypt$N=' + SCRYPT_N + ',r=' + SCRYPT_R + ',p=' + SCRYPT_P + ',len=' + SCRYPT_LEN +
    '$' + salt.toString('hex') + '$' + derived.toString('hex');
}

function parsePasswordHash(stored) {
  if (typeof stored !== 'string') return null;
  const m = stored.match(/^scrypt\$N=(\d+),r=(\d+),p=(\d+),len=(\d+)\$([0-9a-f]+)\$([0-9a-f]+)$/i);
  if (!m) return null;
  const N = parseInt(m[1], 10), r = parseInt(m[2], 10), p = parseInt(m[3], 10), len = parseInt(m[4], 10);
  if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P || len !== SCRYPT_LEN) return null;
  if (m[5].length !== 32 || m[6].length !== SCRYPT_LEN * 2) return null;
  return { salt: Buffer.from(m[5], 'hex'), hash: Buffer.from(m[6], 'hex') };
}

async function verifyPassword(password, stored) {
  try {
    const parts = parsePasswordHash(stored);
    if (!parts) return false;
    const input = String(CFG.authPepper || '') + '\0' + String(password);
    const derived = await scryptAsync(input, parts.salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_LEN);
    return derived.length === parts.hash.length && crypto.timingSafeEqual(derived, parts.hash);
  } catch (e) { return false; }
}

/* Dummy verification of equal cost, run when the account does not exist (or
 * the display name does not match) so failures take the same time and do
 * not reveal whether the private ID exists. */
const DUMMY_SALT = Buffer.alloc(16, 0x5a);
async function dummyPasswordVerify() {
  try {
    await scryptAsync('dummy\0invalid', DUMMY_SALT, SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_LEN);
  } catch (e) { /* timing only */ }
  return false;
}

/* ---------------- sessions (opaque random tokens, hashed at rest) -------- */
function extractSessionToken(req, body) {
  const h = (req && req.headers) || {};
  let t = '';
  const auth = h.authorization || h.Authorization;
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+([A-Za-z0-9+/=_-]+)\s*$/);
    if (m) t = m[1];
  }
  if (!t && typeof h['x-session-token'] === 'string') t = h['x-session-token'];
  if (!t && body && typeof body.sessionToken === 'string') t = body.sessionToken;
  t = String(t || '').trim();
  if (!SESSION_TOKEN_RE.test(t)) return '';
  return t.toLowerCase();
}

function pruneSessions(user, now) {
  now = now || Date.now();
  if (!Array.isArray(user.sessions)) user.sessions = [];
  user.sessions = user.sessions.filter(s =>
    s && typeof s.th === 'string' && /^[0-9a-f]{64}$/i.test(s.th) &&
    typeof s.expiresAt === 'number' && s.expiresAt > now);
  if (user.sessions.length > MAX_SESSIONS_PER_USER) {
    user.sessions.sort((a, b) => a.createdAt - b.createdAt);
    user.sessions = user.sessions.slice(-MAX_SESSIONS_PER_USER);
  }
  return user.sessions;
}

function mintSession(user) {
  const token = randHex(32);
  const now = Date.now();
  pruneSessions(user, now);
  user.sessions.push({ th: sha256hex(token.toLowerCase()), createdAt: now, expiresAt: now + CFG.sessionTtlMs });
  pruneSessions(user, now);
  user.updatedAt = now;
  user.seenAt = now;
  return { token: token.toLowerCase(), expiresAt: now + CFG.sessionTtlMs };
}

function findSessionUser(doc, token) {
  if (!token || !SESSION_TOKEN_RE.test(token)) return null;
  const th = sha256hex(String(token).toLowerCase());
  const now = Date.now();
  let thBuf = null;
  try { thBuf = Buffer.from(th, 'hex'); } catch (e) { return null; }
  for (const u of (doc ? doc.users : [])) {
    if (!Array.isArray(u.sessions)) continue;
    for (const s of u.sessions) {
      if (!s || typeof s.th !== 'string') continue;
      if (typeof s.expiresAt === 'number' && s.expiresAt <= now) continue;
      let cand = null;
      try { cand = Buffer.from(String(s.th).toLowerCase(), 'hex'); } catch (e) { continue; }
      if (cand.length !== thBuf.length) continue;
      let match = false;
      try { match = crypto.timingSafeEqual(cand, thBuf); } catch (e) { match = false; }
      if (match) return { user: u, session: s };
    }
  }
  return null;
}

function revokeSession(user, token) {
  if (!Array.isArray(user.sessions)) return false;
  const th = sha256hex(String(token).toLowerCase());
  const before = user.sessions.length;
  user.sessions = user.sessions.filter(s => !s || String(s.th || '').toLowerCase() !== th);
  return user.sessions.length !== before;
}

/* Resolve the OWNER for a private mutation on path id `id`.
 * The server determines identity FROM the session token when one is
 * presented (a forged id can never authenticate as someone else); the
 * legacy device secret path keeps working for existing devices.
 * Throws {status} on failure; returns {user, via}. */
function resolveOwner(doc, id, req, body) {
  const token = extractSessionToken(req, body);
  if (token) {
    const hit = findSessionUser(doc, token);
    if (!hit) {
      const e = new Error('Not signed in. Please sign in again.');
      e.status = 401;
      throw e;
    }
    if (hit.user.id !== id) {
      const e = new Error('This device is not signed in as that player.');
      e.status = 403;
      throw e;
    }
    return { user: hit.user, via: 'session' };
  }
  const secret = String((body || {}).secret || (req && req.headers && req.headers['x-profile-secret']) || '');
  if (!secret) {
    const e = new Error('Missing profile credentials.');
    e.status = 401;
    throw e;
  }
  const u = doc.users.find(x => x.id === id);
  if (!u) { const e = new Error('Account not found on the server.'); e.status = 404; throw e; }
  if (!secretsMatch(secret, u.secretHash)) {
    const e = new Error('This device is not signed in as that player.');
    e.status = 403;
    throw e;
  }
  return { user: u, via: 'legacy' };
}

/* ---- reviews ---- */
function sanitizeReview(r) {
  if (!r || typeof r !== 'object') return null;
  const name = cleanName(r.name, MAX_NAME_REVIEW);
  const text = cleanName(r.text, MAX_TEXT);
  const rating = num(r.rating, 1, 5, 0);
  let createdAt = 0;
  if (typeof r.createdAt === 'number' && r.createdAt > 0) createdAt = Math.floor(r.createdAt);
  else if (typeof r.created_at === 'string' && r.created_at) {
    const t = Date.parse(r.created_at);
    if (!isNaN(t)) createdAt = t;
  }
  if (!createdAt) createdAt = Date.now();
  if (!name || !text || !(rating >= 1 && rating <= 5)) return null;
  const id = typeof r.id === 'string' && r.id.length <= 80 ? r.id : uid('r_');
  return { id: String(id), name, rating, text, createdAt };
}
function sanitizeReviewList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(sanitizeReview).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_SHARED);
}
function validateReviewInput(body) {
  const name = cleanName(body.name, MAX_NAME_REVIEW + 10);
  const text = cleanName(body.text, MAX_TEXT + 1000);
  const rating = parseInt(body.rating, 10);
  if (!name) return { ok: false, error: 'Please enter a display name.' };
  if (name.length > MAX_NAME_REVIEW) return { ok: false, error: 'Name must be ' + MAX_NAME_REVIEW + ' characters or fewer.' };
  if (!(rating >= 1 && rating <= 5)) return { ok: false, error: 'Please choose a star rating (1–5).' };
  if (!text) return { ok: false, error: 'Please write a review.' };
  if (text.length > MAX_TEXT) return { ok: false, error: 'Review must be ' + MAX_TEXT + ' characters or fewer.' };
  return { ok: true, value: { name: name.slice(0, MAX_NAME_REVIEW), rating, text: text.slice(0, MAX_TEXT) } };
}

/* ---- profiles ---- */
function isCustomAvatar(a) {
  if (!a || typeof a !== 'object' || typeof a.custom !== 'string') return false;
  if (a.custom.length > 9200) return false;
  return CUSTOM_AVATAR_RE.test(a.custom);
}
function sanitizeAvatar(a, fb) {
  if (typeof a === 'string' && PRESET_AVATARS.has(a)) return a;
  if (isCustomAvatar(a)) return { custom: a.custom };
  return fb;
}
function validateAvatarInput(a) {
  if (typeof a === 'string' && PRESET_AVATARS.has(a)) return { ok: true, value: a };
  if (isCustomAvatar(a)) return { ok: true, value: { custom: a.custom } };
  return { ok: false, error: 'Please choose a profile icon.' };
}
function validateNameInput(name) {
  const v = cleanName(name, MAX_NAME + 10);
  if (!v) return { ok: false, error: 'Please enter a display name.' };
  if (v.length > MAX_NAME) return { ok: false, error: 'Display name must be ' + MAX_NAME + ' characters or fewer.' };
  return { ok: true, value: v };
}
function validatePrivateIdInput(pid) {
  const v = String(pid == null ? '' : pid).trim();
  if (!v) return { ok: false, error: 'Please choose a private player ID.' };
  if (v.length < MIN_PID || v.length > MAX_PID) {
    return { ok: false, error: 'Player ID must be ' + MIN_PID + '–' + MAX_PID + ' characters.' };
  }
  if (!PID_RE.test(v)) {
    return { ok: false, error: 'Player ID may only use letters, numbers, dot, underscore or hyphen (no spaces).' };
  }
  return { ok: true, value: v };
}
function sanitizeLevelRow(r) {
  if (!r || typeof r !== 'object') return null;
  const s = num(r.s, 0, MAX_SCORE, 0);
  const c = num(r.c, 0, MAX_COINS_RUN, 0);
  const a = num(r.a, 0, 1000000, 0);
  let t = Number(r.t);
  t = (isFinite(t) && t > 0 && t <= MAX_TIME_S) ? Math.round(t * 10) / 10 : 0;
  if (!s && !c && !a && !t) return null;
  return { s, c, a, t };
}
function sanitizeUser(u) {
  if (!u || typeof u !== 'object') return null;
  const id = String(u.id || '');
  if (!/^p_[a-z0-9_]+$/i.test(id) || id.length > 64) return null;
  const name = cleanName(u.name, MAX_NAME);
  const pid = String(u.privateId == null ? '' : u.privateId).trim().slice(0, MAX_PID);
  if (!name || !PID_RE.test(pid)) return null;
  const levels = {};
  if (u.levels && typeof u.levels === 'object') {
    for (const k of Object.keys(u.levels)) {
      const n = parseInt(k, 10);
      if (!(n >= 1 && n <= MAX_LEVEL)) continue;
      const row = sanitizeLevelRow(u.levels[k]);
      if (row) levels[String(n)] = row;
    }
  }
  const runs = Array.isArray(u.runs)
    ? u.runs.filter(r => typeof r === 'string' && r.length <= 64).slice(-MAX_RUNS)
    : [];
  // Password verifier (scrypt+pepper, see hashPassword). Preserved verbatim
  // when well-formed; NEVER returned by publicUser/ownerUser (only a
  // hasPassword boolean is ever exposed to the owner).
  let passwordHash = '';
  if (typeof u.passwordHash === 'string' && u.passwordHash.length <= 500) {
    if (parsePasswordHash(u.passwordHash)) passwordHash = u.passwordHash;
  }
  // Active session token hashes (SHA-256 of the opaque token, never the
  // token itself). Bounded + expiry-pruned; stripped from all responses.
  let sessions = [];
  if (Array.isArray(u.sessions)) {
    const now = Date.now();
    for (const s of u.sessions) {
      if (sessions.length >= MAX_SESSIONS_PER_USER) break;
      if (!s || typeof s.th !== 'string' || !/^[0-9a-f]{64}$/i.test(s.th)) continue;
      const createdAt = num(s.createdAt, 1, 9e15, 0);
      const expiresAt = num(s.expiresAt, 1, 9e15, 0);
      if (!createdAt || !expiresAt || expiresAt <= now) continue;
      sessions.push({ th: String(s.th).toLowerCase(), createdAt, expiresAt });
    }
  }
  return {
    id,
    privateId: pid,
    name,
    avatar: sanitizeAvatar(u.avatar, 'nova-star'),
    secretHash: /^[0-9a-f]{64}$/i.test(String(u.secretHash || '')) ? String(u.secretHash).toLowerCase() : '',
    passwordHash,
    sessions,
    createdAt: num(u.createdAt, 1, 9e15, Date.now()),
    updatedAt: num(u.updatedAt, 1, 9e15, Date.now()),
    seenAt: num(u.seenAt, 0, 9e15, 0),
    totalCoins: num(u.totalCoins, 0, 50000000, 0),
    levels,
    runs,
  };
}
function sanitizeDoc(doc) {
  if (!doc || typeof doc !== 'object') return { v: 1, resetVersion: 0, users: [] };
  const arr = Array.isArray(doc.users) ? doc.users : [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (out.length >= MAX_USERS) break;
    const u = sanitizeUser(item);
    if (!u || seen.has(u.id)) continue;
    seen.add(u.id);
    out.push(u);
  }
  let rv = Math.floor(Number(doc.resetVersion));
  if (!isFinite(rv) || rv < 0 || rv > 99) rv = 0;
  return { v: 1, resetVersion: rv, users: out };
}
/* PUBLIC shape ONLY: strips privateId, secretHash, passwordHash, sessions
 * and runIds. */
function publicUser(u) {
  u = sanitizeUser(u);
  if (!u) return null;
  let lv = 0, score = 0;
  for (const k of Object.keys(u.levels)) { lv++; score += u.levels[k].s; }
  return {
    id: u.id, name: u.name, avatar: u.avatar,
    createdAt: u.createdAt, updatedAt: u.updatedAt,
    totalCoins: u.totalCoins, levelsCompleted: lv, totalScore: score,
    levels: u.levels,
  };
}
/* Owner shape: everything the owner's own devices need, NEVER secretHash,
 * passwordHash or sessions — only a hasPassword flag so the UI knows
 * whether to offer "set password" or "change password". */
function ownerUser(u) {
  u = sanitizeUser(u);
  if (!u) return null;
  return {
    id: u.id, privateId: u.privateId, name: u.name, avatar: u.avatar,
    createdAt: u.createdAt, updatedAt: u.updatedAt, seenAt: u.seenAt,
    totalCoins: u.totalCoins, levels: u.levels,
    hasPassword: !!u.passwordHash,
  };
}
function compareRanked(a, b) {
  if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
  if (b.levelsCompleted !== a.levelsCompleted) return b.levelsCompleted - a.levelsCompleted;
  if (b.totalCoins !== a.totalCoins) return b.totalCoins - a.totalCoins;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
}
function rankedPublics(doc, limit) {
  limit = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
  const rows = [];
  for (const u of (doc ? doc.users : [])) {
    const p = publicUser(u);
    if (!p || !Object.keys(p.levels).length) continue;
    rows.push(p);
  }
  rows.sort(compareRanked);
  return rows.slice(0, limit).map((r, i) => Object.assign({ rank: i + 1 }, r));
}
function applyCompletion(user, level, data) {
  level = Math.min(MAX_LEVEL, Math.max(1, parseInt(level, 10) || 0));
  if (!level) return { user, improved: false };
  const score = num(data.score, 0, MAX_SCORE, 0);
  const coins = num(data.coins, 0, MAX_COINS_RUN, 0);
  let t = Number(data.time);
  t = (isFinite(t) && t > 0 && t <= MAX_TIME_S) ? Math.round(t * 10) / 10 : 0;
  const runId = typeof data.runId === 'string' ? data.runId.slice(0, 64) : '';
  const row = user.levels[String(level)] || { s: 0, c: 0, a: 0, t: 0 };
  let improved = false;
  if (score > row.s) { row.s = score; improved = true; }
  if (coins > row.c) { row.c = coins; improved = true; }
  if (row.a < 1) row.a = 1;
  if (t > 0 && (row.t <= 0 || t < row.t)) { row.t = t; improved = true; }
  user.levels[String(level)] = row;
  if (runId && user.runs.indexOf(runId) === -1) {
    user.runs.push(runId);
    if (user.runs.length > MAX_RUNS) user.runs = user.runs.slice(-MAX_RUNS);
    user.totalCoins = Math.min(50000000, user.totalCoins + coins);
    improved = true;
  }
  user.updatedAt = Date.now();
  user.seenAt = Date.now();
  return { user, improved };
}
function applyAttempt(user, level) {
  level = Math.min(MAX_LEVEL, Math.max(1, parseInt(level, 10) || 0));
  if (!level) return user;
  const row = user.levels[String(level)] || { s: 0, c: 0, a: 0, t: 0 };
  row.a = Math.min(1000000, row.a + 1);
  user.levels[String(level)] = row;
  user.seenAt = Date.now();
  return user;
}

/* ---------------- route handlers ---------------- */
async function handleHealth(req, res, cors) {
  sendJson(res, 200, { ok: true, service: 'starbound-api', time: Date.now() }, cors);
}

async function handleReviewsGet(req, res, cors) {
  const doc = await getReviewsDoc();
  const list = sanitizeReviewList(doc && doc.reviews);
  sendJson(res, 200, { reviews: list }, cors);
}

async function handleReviewsPost(req, res, cors, body) {
  if (body && typeof body === 'object' && ('reviews' in body) && !('name' in body)) {
    sendJson(res, 400, { error: 'Invalid review. Send {name, rating, text}.' }, cors);
    return;
  }
  const v = validateReviewInput(body || {});
  if (!v.ok) { sendJson(res, 400, { error: v.error }, cors); return; }
  const review = {
    id: (typeof (body || {}).id === 'string' && body.id.length <= 80) ? String(body.id) : uid('r_'),
    name: v.value.name, rating: v.value.rating, text: v.value.text, createdAt: Date.now(),
  };
  const saved = await withReviewsLock(async () => {
    const doc = await getReviewsDoc();
    const current = sanitizeReviewList(doc && doc.reviews);
    if (current.some(r => r.id === review.id)) return review;
    const next = [review].concat(current).slice(0, MAX_SHARED);
    await mantlePost(reviewsUrl(), { reviews: next });
    return review;
  });
  sendJson(res, 200, { ok: true, review: saved }, cors);
}

async function handleLeaderboard(req, res, cors, query) {
  const doc = await getProfilesDoc();
  const rows = rankedPublics(doc, query.get('limit'));
  sendJson(res, 200, { rows }, cors);
}

async function handleProfilesList(req, res, cors, query) {
  const doc = await getProfilesDoc();
  // ALL public accounts (played or not) — the client filters/ranks.
  // Private fields are never included here.
  const limit = Math.min(500, Math.max(1, parseInt(query.get('limit'), 10) || 500));
  const users = [];
  for (const u of doc.users) {
    if (users.length >= limit) break;
    const p = publicUser(u);
    if (p) users.push(p);
  }
  sendJson(res, 200, { users }, cors);
}

async function handleProfileGet(req, res, cors, id) {
  const doc = await getProfilesDoc();
  const found = doc.users.find(u => u.id === id);
  if (!found) { sendJson(res, 404, { error: 'Profile not found.' }, cors); return; }
  sendJson(res, 200, { user: publicUser(found) }, cors);
}

async function handleProfileMe(req, res, cors, query, body) {
  const id = String(query.get('id') || (body && body.id) || '');
  // New session tokens: headers/body only, never URLs. Legacy device
  // secrets keep the old query fallback for backwards compatibility.
  const token = extractSessionToken(req, body);
  const secret = String(req.headers['x-profile-secret'] || (body && body.secret) || query.get('secret') || '');
  if (!id || (!token && !secret)) { sendJson(res, 401, { error: 'Missing profile credentials.' }, cors, noStoreHeaders()); return; }
  const doc = await getProfilesDoc();
  if (token) {
    const hit = findSessionUser(doc, token);
    if (!hit || hit.user.id !== id) {
      sendJson(res, hit ? 403 : 401, { error: hit ? 'This device is not signed in as that player.' : 'Not signed in. Please sign in again.' }, cors, noStoreHeaders());
      return;
    }
    sendJson(res, 200, { user: ownerUser(hit.user) }, cors, noStoreHeaders());
    return;
  }
  const found = doc.users.find(u => u.id === id);
  if (!found || !secretsMatch(secret, found.secretHash)) {
    sendJson(res, found ? 403 : 404, { error: found ? 'This device is not signed in as that player.' : 'Profile not found.' }, cors, noStoreHeaders());
    return;
  }
  sendJson(res, 200, { user: ownerUser(found) }, cors, noStoreHeaders());
}

async function handleProfileCreate(req, res, cors, body) {
  const vn = validateNameInput((body || {}).name);
  if (!vn.ok) { sendJson(res, 400, { error: vn.error }, cors); return; }
  const vp = validatePrivateIdInput((body || {}).privateId);
  if (!vp.ok) { sendJson(res, 400, { error: vp.error }, cors); return; }
  const va = validateAvatarInput((body || {}).avatar);
  if (!va.ok) { sendJson(res, 400, { error: va.error }, cors); return; }
  const secret = randHex(32);
  const rec = {
    id: 'p_' + Date.now().toString(36) + '_' + randHex(6),
    privateId: vp.value, name: vn.value, avatar: va.value,
    secretHash: sha256hex(secret),
    createdAt: Date.now(), updatedAt: Date.now(), seenAt: Date.now(),
    totalCoins: 0, levels: {}, runs: [],
  };
  try {
    const created = await withProfilesLock(async () => {
      const doc = await getProfilesDoc();
      if (doc.users.length >= MAX_USERS) {
        const e = new Error('Profile storage is full right now. Please try again later.');
        e.status = 413;
        throw e;
      }
      for (const u of doc.users) {
        if (u.privateId.toLowerCase() === vp.value.toLowerCase()) {
          const e = new Error('That player ID is already taken. Please choose another.');
          e.status = 409;
          throw e;
        }
      }
      doc.users.push(sanitizeUser(rec));
      if (doc.resetVersion < RESET_VERSION && doc.resetVersion !== 0) { /* keep server marker */ }
      await mantlePost(profilesUrl(), doc);
      return rec;
    });
    sendJson(res, 201, { ok: true, user: ownerUser(created), secret }, cors);
  } catch (e) {
    if (e && (e.status === 409 || e.status === 413)) {
      sendJson(res, e.status, { error: e.message }, cors);
      return;
    }
    throw e;
  }
}

async function handleProfilePatch(req, res, cors, id, body) {
  const hasSessionToken = !!extractSessionToken(req, body);
  const hasLegacySecret = !!String((body || {}).secret || req.headers['x-profile-secret'] || '');
  if (!hasSessionToken && !hasLegacySecret) { sendJson(res, 401, { error: 'Missing profile credentials.' }, cors, noStoreHeaders()); return; }
  const patch = {};
  if ((body || {}).name !== undefined) {
    const vn = validateNameInput(body.name);
    if (!vn.ok) { sendJson(res, 400, { error: vn.error }, cors); return; }
    patch.name = vn.value;
  }
  if ((body || {}).avatar !== undefined) {
    const va = validateAvatarInput(body.avatar);
    if (!va.ok) { sendJson(res, 400, { error: va.error }, cors); return; }
    patch.avatar = va.value;
  }
  let wantPid = false, pidVal = '';
  if ((body || {}).privateId !== undefined) {
    const vp = validatePrivateIdInput(body.privateId);
    if (!vp.ok) { sendJson(res, 400, { error: vp.error }, cors); return; }
    wantPid = true; pidVal = vp.value;
  }
  try {
    const updated = await withProfilesLock(async () => {
      const doc = await getProfilesDoc();
      const { user: u } = resolveOwner(doc, id, req, body);
      if (wantPid) {
        for (const o of doc.users) {
          if (o.id !== u.id && o.privateId.toLowerCase() === pidVal.toLowerCase()) {
            const e = new Error('That player ID is already taken. Please choose another.');
            e.status = 409;
            throw e;
          }
        }
        u.privateId = pidVal;
      }
      if (patch.name !== undefined) u.name = patch.name;
      if (patch.avatar !== undefined) u.avatar = patch.avatar;
      u.updatedAt = Date.now();
      u.seenAt = Date.now();
      await mantlePost(profilesUrl(), doc);
      return sanitizeUser(u);
    });
    sendJson(res, 200, { ok: true, user: ownerUser(updated) }, cors);
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403 || e.status === 404 || e.status === 409)) {
      sendJson(res, e.status, { error: e.message }, cors);
      return;
    }
    throw e;
  }
}

function validateGameplay(body, kind) {
  const rawLevel = parseInt((body || {}).level, 10);
  if (!isFinite(rawLevel) || rawLevel < 1 || rawLevel > MAX_LEVEL) {
    return { ok: false, error: 'Invalid level number.' };
  }
  const level = rawLevel;
  if (kind === 'completion') {
    const score = Number((body || {}).score);
    const coins = Number((body || {}).coins);
    const time = Number((body || {}).time);
    if (!isFinite(score) || score < 0 || score > MAX_SCORE) return { ok: false, error: 'Invalid score.' };
    if (!isFinite(coins) || coins < 0 || coins > MAX_COINS_RUN) return { ok: false, error: 'Invalid coins.' };
    if (!isFinite(time) || time <= 0 || time > MAX_TIME_S) return { ok: false, error: 'Invalid completion time.' };
    const runId = (body || {}).runId;
    if (runId !== undefined && (typeof runId !== 'string' || !runId || runId.length > 64)) {
      return { ok: false, error: 'Invalid run id.' };
    }
  }
  return { ok: true, level };
}

async function handleAttempt(req, res, cors, id, body) {
  const hasSessionToken = !!extractSessionToken(req, body);
  const hasLegacySecret = !!String((body || {}).secret || req.headers['x-profile-secret'] || '');
  if (!hasSessionToken && !hasLegacySecret) { sendJson(res, 401, { error: 'Missing profile credentials.' }, cors); return; }
  const lvl = parseInt((body || {}).level, 10);
  const v = validateGameplay({ level: isNaN(lvl) ? (body || {}).level : lvl }, 'attempt');
  if (!v.ok) { sendJson(res, 400, { error: v.error }, cors); return; }
  try {
    await withProfilesLock(async () => {
      const doc = await getProfilesDoc();
      const { user: u } = resolveOwner(doc, id, req, body);
      applyAttempt(u, v.level);
      await mantlePost(profilesUrl(), doc);
    });
    sendJson(res, 200, { ok: true }, cors);
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403 || e.status === 404)) {
      sendJson(res, e.status, { error: e.message }, cors);
      return;
    }
    throw e;
  }
}

async function handleCompletion(req, res, cors, id, body) {
  const hasSessionToken = !!extractSessionToken(req, body);
  const hasLegacySecret = !!String((body || {}).secret || req.headers['x-profile-secret'] || '');
  if (!hasSessionToken && !hasLegacySecret) { sendJson(res, 401, { error: 'Missing profile credentials.' }, cors); return; }
  const v = validateGameplay(body || {}, 'completion');
  if (!v.ok) { sendJson(res, 400, { error: v.error }, cors); return; }
  try {
    const improved = await withProfilesLock(async () => {
      const doc = await getProfilesDoc();
      const { user: u } = resolveOwner(doc, id, req, body);
      const r = applyCompletion(u, v.level, {
        score: (body || {}).score, coins: (body || {}).coins,
        time: (body || {}).time, runId: (body || {}).runId,
      });
      await mantlePost(profilesUrl(), doc);
      return r.improved;
    });
    sendJson(res, 200, { ok: true, improved: !!improved }, cors);
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403 || e.status === 404)) {
      sendJson(res, e.status, { error: e.message }, cors);
      return;
    }
    throw e;
  }
}

/* ---------------- authentication (password + sessions) -------------- */
/* Sign-up: display name + private ID + avatar + password. Private ID
 * uniqueness is case-insensitive. Returns the owner record plus BOTH a
 * legacy device secret (backwards compatible with existing clients) and a
 * fresh session token. The password hash itself is never returned. */
async function handleAuthSignup(req, res, cors, body) {
  if (authRateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests. Please wait a moment and try again.' }, cors, noStoreHeaders());
    return;
  }
  const vn = validateNameInput((body || {}).name);
  if (!vn.ok) { sendJson(res, 400, { error: vn.error }, cors, noStoreHeaders()); return; }
  const vp = validatePrivateIdInput((body || {}).privateId);
  if (!vp.ok) { sendJson(res, 400, { error: vp.error }, cors, noStoreHeaders()); return; }
  const va = validateAvatarInput((body || {}).avatar);
  if (!va.ok) { sendJson(res, 400, { error: va.error }, cors, noStoreHeaders()); return; }
  const vpw = validatePasswordInput((body || {}).password);
  if (!vpw.ok) { sendJson(res, 400, { error: vpw.error }, cors, noStoreHeaders()); return; }
  let pwHash = '';
  try {
    pwHash = await hashPassword(vpw.value);
  } catch (e) {
    sendJson(res, 500, { error: 'Something went wrong. Please try again.' }, cors, noStoreHeaders());
    return;
  }
  const secret = randHex(32);
  const rec = {
    id: 'p_' + Date.now().toString(36) + '_' + randHex(6),
    privateId: vp.value, name: vn.value, avatar: va.value,
    secretHash: sha256hex(secret),
    passwordHash: pwHash,
    sessions: [],
    createdAt: Date.now(), updatedAt: Date.now(), seenAt: Date.now(),
    totalCoins: 0, levels: {}, runs: [],
  };
  try {
    const created = await withProfilesLock(async () => {
      const doc = await getProfilesDoc();
      if (doc.users.length >= MAX_USERS) {
        const e = new Error('Profile storage is full right now. Please try again later.');
        e.status = 413;
        throw e;
      }
      for (const u of doc.users) {
        if (u.privateId.toLowerCase() === vp.value.toLowerCase()) {
          const e = new Error('That player ID is already taken. Please choose another.');
          e.status = 409;
          throw e;
        }
      }
      const clean = sanitizeUser(rec);
      if (!clean) { const e = new Error('Invalid account data.'); e.status = 400; throw e; }
      doc.users.push(clean);
      const stored = doc.users.find(x => x.id === clean.id);
      const sess = mintSession(stored);
      await mantlePost(profilesUrl(), doc);
      return { rec: stored, sessionToken: sess.token, expiresAt: sess.expiresAt };
    });
    sendJson(res, 201, {
      ok: true, user: ownerUser(created.rec),
      secret, sessionToken: created.sessionToken, expiresAt: created.expiresAt,
    }, cors, noStoreHeaders());
  } catch (e) {
    if (e && (e.status === 409 || e.status === 413 || e.status === 400)) {
      sendJson(res, e.status, { error: e.message }, cors, noStoreHeaders());
      return;
    }
    throw e;
  }
}

/* Sign-in: display name + private ID + password must ALL match the SAME
 * account. Every failure returns the SAME generic 401 so callers learn
 * nothing about which field was wrong or whether the account exists. */
async function handleAuthSignin(req, res, cors, body) {
  if (authRateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests. Please wait a moment and try again.' }, cors, noStoreHeaders());
    return;
  }
  const name = cleanName((body || {}).name, MAX_NAME + 10);
  const pid = String((body || {}).privateId == null ? '' : (body || {}).privateId).trim();
  const pw = (body || {}).password;
  if (!name || !pid || typeof pw !== 'string' || !pw) {
    await dummyPasswordVerify();
    sendJson(res, 401, { error: SIGNIN_GENERIC_ERROR }, cors, noStoreHeaders());
    return;
  }
  try {
    const minted = await withProfilesLock(async () => {
      const doc = await getProfilesDoc();
      const found = doc.users.find(u => u.privateId.toLowerCase() === pid.toLowerCase());
      if (!found) { await dummyPasswordVerify(); return null; }
      if (String(found.name || '').trim().toLowerCase() !== String(name).trim().toLowerCase()) {
        await dummyPasswordVerify();
        return null;
      }
      if (!found.passwordHash) { await dummyPasswordVerify(); return null; }
      const ok = await verifyPassword(pw, found.passwordHash);
      if (!ok) return null;
      const sess = mintSession(found);
      await mantlePost(profilesUrl(), doc);
      return { user: sanitizeUser(found), sessionToken: sess.token, expiresAt: sess.expiresAt };
    });
    if (!minted) {
      sendJson(res, 401, { error: SIGNIN_GENERIC_ERROR }, cors, noStoreHeaders());
      return;
    }
    sendJson(res, 200, {
      ok: true, user: ownerUser(minted.user),
      sessionToken: minted.sessionToken, expiresAt: minted.expiresAt,
    }, cors, noStoreHeaders());
  } catch (e) {
    throw e;
  }
}

/* Sign-out: revokes the presenting session token server-side. Idempotent
 * per token: unknown/expired tokens get 401 (nothing to revoke). */
async function handleAuthSignout(req, res, cors, body) {
  const token = extractSessionToken(req, body);
  if (!token) { sendJson(res, 401, { error: 'Not signed in. Please sign in again.' }, cors, noStoreHeaders()); return; }
  try {
    const revoked = await withProfilesLock(async () => {
      const doc = await getProfilesDoc();
      const hit = findSessionUser(doc, token);
      if (!hit) return false;
      revokeSession(hit.user, token);
      hit.user.seenAt = Date.now();
      await mantlePost(profilesUrl(), doc);
      return true;
    });
    if (!revoked) {
      sendJson(res, 401, { error: 'Not signed in. Please sign in again.' }, cors, noStoreHeaders());
      return;
    }
    sendJson(res, 200, { ok: true }, cors, noStoreHeaders());
  } catch (e) {
    throw e;
  }
}

/* Session check: validates the presenting token and returns the owner
 * record. Tokens travel in headers/body only, never URLs. */
async function handleAuthSession(req, res, cors, body) {
  const token = extractSessionToken(req, body);
  if (!token) { sendJson(res, 401, { error: 'Not signed in. Please sign in again.' }, cors, noStoreHeaders()); return; }
  const doc = await getProfilesDoc();
  const hit = findSessionUser(doc, token);
  if (!hit) {
    sendJson(res, 401, { error: 'Not signed in. Please sign in again.' }, cors, noStoreHeaders());
    return;
  }
  sendJson(res, 200, { ok: true, user: ownerUser(hit.user) }, cors, noStoreHeaders());
}

/* Set/change password for the OWNER only (migration path for pre-password
 * accounts). Auth: valid session token OR legacy device secret for the
 * same account id. If the account already has a password, the current
 * password must also verify. Never returns hashes or passwords. */
async function handleAuthSetPassword(req, res, cors, id, body) {
  if (authRateLimited(clientIp(req))) {
    sendJson(res, 429, { error: 'Too many requests. Please wait a moment and try again.' }, cors, noStoreHeaders());
    return;
  }
  if (!/^p_[a-z0-9_]+$/i.test(String(id || '')) || String(id).length > 64) {
    sendJson(res, 400, { error: 'Invalid profile id.' }, cors, noStoreHeaders());
    return;
  }
  const vpw = validatePasswordInput((body || {}).newPassword);
  if (!vpw.ok) { sendJson(res, 400, { error: vpw.error }, cors, noStoreHeaders()); return; }
  try {
    await withProfilesLock(async () => {
      const doc = await getProfilesDoc();
      const { user: u } = resolveOwner(doc, id, req, body);
      if (u.passwordHash) {
        const cur = (body || {}).currentPassword;
        if (typeof cur !== 'string' || !cur || !(await verifyPassword(cur, u.passwordHash))) {
          const e = new Error('Current password is incorrect.');
          e.status = 401;
          throw e;
        }
      }
      u.passwordHash = await hashPassword(vpw.value);
      u.updatedAt = Date.now();
      u.seenAt = Date.now();
      await mantlePost(profilesUrl(), doc);
    });
    sendJson(res, 200, { ok: true, hasPassword: true }, cors, noStoreHeaders());
  } catch (e) {
    if (e && (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 404)) {
      sendJson(res, e.status, { error: e.message }, cors, noStoreHeaders());
      return;
    }
    throw e;
  }
}

/* ---------------- server ---------------- */
function route(req, res) {
  const cors = corsFor(req);
  const origin = req.headers.origin;
  if (origin && !isOriginAllowed(origin)) {
    // No ACAO header: browsers block the read. Still answer JSON safely.
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, Object.assign({
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Profile-Secret,Authorization,X-Session-Token',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin',
    }, (origin && isOriginAllowed(origin)) ? { 'Access-Control-Allow-Origin': origin } : {}));
    res.end();
    return;
  }

  let url;
  try {
    url = new URL(req.url || '/', 'http://localhost');
  } catch (e) {
    sendJson(res, 400, { error: 'Bad request.' }, cors);
    return;
  }
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method || 'GET';
  const ip = clientIp(req);

  if (rateLimited(ip, bucketFor(method, pathname))) {
    sendJson(res, 429, { error: 'Too many requests. Please wait a moment and try again.' }, cors);
    return;
  }

  const needsBody = method === 'POST' || method === 'PATCH';
  const bodyP = needsBody ? readBody(req) : Promise.resolve(null);

  bodyP.then(async (body) => {
    try {
      if (method === 'GET' && pathname === '/') {
        sendJson(res, 200, { ok: true, service: 'starbound-api', endpoints: ['/api/health', '/api/reviews', '/api/leaderboard', '/api/profiles', '/api/auth/signup', '/api/auth/signin', '/api/auth/signout', '/api/auth/session'] }, cors);
        return;
      }
      if (method === 'GET' && pathname === '/api/health') return handleHealth(req, res, cors);
      if (method === 'GET' && pathname === '/api/reviews') return handleReviewsGet(req, res, cors);
      if (method === 'POST' && pathname === '/api/reviews') return handleReviewsPost(req, res, cors, body);
      if (method === 'POST' && pathname === '/api/auth/signup') return handleAuthSignup(req, res, cors, body);
      if (method === 'POST' && pathname === '/api/auth/signin') return handleAuthSignin(req, res, cors, body);
      if (method === 'POST' && pathname === '/api/auth/signout') return handleAuthSignout(req, res, cors, body);
      if (method === 'GET' && pathname === '/api/auth/session') return handleAuthSession(req, res, cors, body);
      if (method === 'GET' && pathname === '/api/leaderboard') return handleLeaderboard(req, res, cors, url.searchParams);
      if (method === 'GET' && pathname === '/api/profiles') return handleProfilesList(req, res, cors, url.searchParams);
      if (method === 'GET' && pathname === '/api/profiles/me') return handleProfileMe(req, res, cors, url.searchParams, body);
      if (method === 'POST' && pathname === '/api/profiles') return handleProfileCreate(req, res, cors, body);
      let setM = pathname.match(/^\/api\/auth\/set-password\/([^/]+)$/);
      if (setM && method === 'POST') {
        const setId = decodeURIComponent(setM[1]);
        return handleAuthSetPassword(req, res, cors, setId, body);
      }
      let m = pathname.match(/^\/api\/profiles\/([^/]+)(\/(attempt|completion))?$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (!/^p_[a-z0-9_]+$/i.test(id) || id.length > 64) {
          sendJson(res, 400, { error: 'Invalid profile id.' }, cors);
          return;
        }
        if (method === 'GET' && !m[2]) return handleProfileGet(req, res, cors, id);
        if (method === 'PATCH' && !m[2]) return handleProfilePatch(req, res, cors, id, body);
        if (method === 'POST' && m[3] === 'attempt') return handleAttempt(req, res, cors, id, body);
        if (method === 'POST' && m[3] === 'completion') return handleCompletion(req, res, cors, id, body);
      }
      sendJson(res, 404, { error: 'Not found.' }, cors);
    } catch (e) {
      const status = (e && (e.status === 400 || e.status === 401 || e.status === 403 ||
        e.status === 404 || e.status === 409 || e.status === 413 ||
        e.status === 429 || e.status === 502)) ? e.status : 500;
      // Safe messages only: never stack traces, keys, hashes or internals.
      const msg = status === 500 ? 'Something went wrong. Please try again.'
        : (e && e.message ? String(e.message).slice(0, 200) : 'Request failed.');
      try {
        // eslint-disable-next-line no-console
        console.error('[api]', method, pathname, '->', status);
      } catch (ee) { }
      sendJson(res, status, { error: msg }, cors);
    }
  }).catch((e) => {
    const status = (e && (e.status === 400 || e.status === 413)) ? e.status : 400;
    const msg = (e && e.message) ? String(e.message).slice(0, 200) : 'Bad request.';
    sendJson(res, status, { error: msg }, cors);
  });
}

const server = http.createServer(route);

if (require.main === module) {
  // Fail-safe startup: missing MantleDB config must fail LOUDLY on the
  // backend host (logs) — the game itself stays playable via its offline
  // fallbacks and only sees a friendly "unavailable" JSON, never a secret.
  if (!CFG.mantleNs) {
    // eslint-disable-next-line no-console
    console.error('[api] FATAL: MANTLEDB_NAMESPACE is not set. Refusing to start without a database target.');
    process.exit(1);
  }
  server.listen(CFG.port, () => {
    // eslint-disable-next-line no-console
    console.log('[api] STARBOUND API listening on port ' + CFG.port);
  });
}

module.exports = { server, CFG, resetAuthLimits };
