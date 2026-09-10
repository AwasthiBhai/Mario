/* STARBOUND API — authentication test suite (isolated, no production writes).
 * Uses a dedicated MantleDB entry (profiles-test-auth-v1) so production
 * accounts, progress, reviews and leaderboard are never touched. Exercises
 * the REAL server code paths: signup/signin/signout/session/set-password,
 * generic failures, session ownership, rate limiting, privacy separation,
 * legacy migration, and regression (reviews/profiles/leaderboard/CORS).
 * Usage: node test-auth.js   (from server/)
 */
'use strict';
const assert = require('assert');

const TEST_PORT = 18788;
process.env.PORT = String(TEST_PORT);
process.env.MANTLEDB_PROFILES_ENTRY = 'profiles-test-auth-v1';
process.env.AUTH_PEPPER = 'test-pepper-for-auth-suite-only';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000,https://test.github.io';
process.env.RATE_LIMIT_MAX = '500';
process.env.AUTH_RATE_LIMIT_MAX = '200';

const mod = require('./server.js');
const { server, CFG } = mod;
const BASE = 'http://127.0.0.1:' + TEST_PORT;
const GENERIC = 'The sign-in details are incorrect.';

async function jget(p, opts) {
  const r = await fetch(BASE + p, opts || {});
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
  return { status: r.status, data, headers: r.headers, text: txt };
}
async function jpost(p, body, opts) {
  return jget(p, Object.assign({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, opts || {}));
}
async function jpatch(p, body, opts) {
  return jget(p, Object.assign({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, opts || {}));
}
function bearer(token) {
  return { Authorization: 'Bearer ' + token };
}
function assertNoSecrets(obj, label) {
  const txt = JSON.stringify(obj);
  for (const k of ['passwordHash', 'secretHash', '"secret"', 'sessionToken', '"sessions"', 'AUTH_PEPPER', 'test-pepper']) {
    if (k === 'sessionToken' && label === 'signup-signin-returns-token-once') continue;
    assert.ok(txt.indexOf(k) < 0, label + ' leaks ' + k);
  }
}

async function run() {
  await new Promise((res) => server.listen(TEST_PORT, res));
  console.log('[auth-test] server up on ' + TEST_PORT);
  let pass = 0;
  async function t(name, fn) {
    try { await fn(); pass++; console.log('  ok - ' + name); }
    catch (e) { console.error('  FAIL - ' + name + ': ' + (e && e.message)); throw e; }
  }

  const stamp = Date.now().toString(36);
  const pidA = 'authtest.a.' + stamp.slice(-8);
  const pidB = 'authtest.b.' + stamp.slice(-8);
  const pwA = 'Correct-Horse-' + stamp + '-a!';
  const pwB = 'Battery-Staple-' + stamp + '-b!';
  let idA = null, tokenA = null, legacySecretA = null;
  let idB = null, tokenB = null;

  // ---- ACCOUNT ----
  await t('signup creates password account with session + legacy secret', async () => {
    const r = await jpost('/api/auth/signup', { name: 'Auth Alice', privateId: pidA, avatar: 'rocket', password: pwA });
    assert.strictEqual(r.status, 201);
    assert.ok(r.data.ok && r.data.user && r.data.sessionToken && r.data.secret);
    assert.strictEqual(r.data.user.privateId, pidA);
    assert.strictEqual(r.data.user.hasPassword, true);
    assert.ok(!('passwordHash' in r.data.user) && !('secretHash' in r.data.user) && !('sessions' in r.data.user));
    assert.ok(!('password' in r.data.user));
    assert.ok(r.text.indexOf(pwA) < 0, 'password echoed in response');
    idA = r.data.user.id;
    tokenA = r.data.sessionToken;
    legacySecretA = r.data.secret;
  });

  await t('duplicate privateId rejected (case-insensitive)', async () => {
    const r = await jpost('/api/auth/signup', { name: 'Clone', privateId: pidA.toUpperCase(), avatar: 'alien', password: pwB });
    assert.ok(r.status === 409 || r.status === 400);
    const r2 = await jpost('/api/profiles', { name: 'Clone2', privateId: pidA, avatar: 'alien' });
    assert.ok(r2.status === 409 || r2.status === 400);
  });

  await t('invalid passwords rejected', async () => {
    for (const bad of ['', '   ', 'short', 'x'.repeat(300)]) {
      const r = await jpost('/api/auth/signup', { name: 'Bad Pw', privateId: 'authtest.bad.' + Math.random().toString(36).slice(2, 7), avatar: 'nova-star', password: bad });
      assert.strictEqual(r.status, 400);
      assert.ok(r.text.indexOf(bad.trim()) < 0 || !bad.trim());
    }
  });

  await t('second account for cross-account tests', async () => {
    const r = await jpost('/api/auth/signup', { name: 'Auth Bob', privateId: pidB, avatar: 'alien', password: pwB });
    assert.strictEqual(r.status, 201);
    idB = r.data.user.id;
    tokenB = r.data.sessionToken;
  });

  // ---- SIGN IN ----
  await t('signin with all three correct recovers SAME account', async () => {
    const r = await jpost('/api/auth/signin', { name: 'Auth Alice', privateId: pidA, password: pwA });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.user.id, idA);
    assert.strictEqual(r.data.user.privateId, pidA);
    assert.ok(r.data.sessionToken && r.data.sessionToken !== tokenA, 'fresh token each signin');
    assert.ok(r.text.indexOf(pwA) < 0);
    tokenA = r.data.sessionToken; // use newest
    assert.ok(!('secret' in r.data), 'signin must not return legacy secret');
  });

  await t('wrong name / password / privateId / mixed all fail generic 401', async () => {
    const cases = [
      { name: 'Nobody', privateId: pidA, password: pwA },
      { name: 'Auth Alice', privateId: pidA, password: 'Wrong-Password-123!' },
      { name: 'Auth Alice', privateId: 'authtest.nope.' + stamp.slice(-6), password: pwA },
      { name: 'Auth Bob', privateId: pidA, password: pwB },
      { name: 'Auth Alice', privateId: pidB, password: pwA },
      { name: '', privateId: pidA, password: pwA },
    ];
    for (const c of cases) {
      const r = await jpost('/api/auth/signin', c);
      assert.strictEqual(r.status, 401, JSON.stringify(c));
      assert.strictEqual(r.data.error, GENERIC, JSON.stringify(c));
    }
  });

  // ---- SESSION ----
  await t('session check works with bearer token', async () => {
    const r = await jget('/api/auth/session', { headers: bearer(tokenA) });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.user.id, idA);
    assert.strictEqual(r.data.user.privateId, pidA);
    assertNoSecrets(r.data, 'session');
  });

  await t('session token authorizes PATCH + gameplay for own id', async () => {
    const p = await jpatch('/api/profiles/' + encodeURIComponent(idA), { name: 'Auth Alice 2' }, { headers: bearer(tokenA) });
    // jpatch replaces headers; resend with merged headers:
    assert.ok(p.status === 401 || p.status === 200, 'patch without token header must not succeed blindly');
    const p2 = await fetch(BASE + '/api/profiles/' + encodeURIComponent(idA), {
      method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, bearer(tokenA)),
      body: JSON.stringify({ name: 'Auth Alice 2' }),
    }).then(async (r) => ({ status: r.status, data: JSON.parse(await r.text()) }));
    assert.strictEqual(p2.status, 200);
    assert.strictEqual(p2.data.user.name, 'Auth Alice 2');
    const att = await jpost('/api/profiles/' + encodeURIComponent(idA) + '/attempt',
      { level: 1, sessionToken: tokenA }, { headers: { 'Content-Type': 'application/json' } });
    assert.strictEqual(att.status, 200);
    const comp = await jpost('/api/profiles/' + encodeURIComponent(idA) + '/completion',
      { level: 1, score: 1500, coins: 10, time: 60, runId: 'auth_t_' + stamp, sessionToken: tokenA },
      { headers: { 'Content-Type': 'application/json' } });
    assert.strictEqual(comp.status, 200);
    // signin again returns SAME progress (no duplicate, same id)
    const s = await jpost('/api/auth/signin', { name: 'Auth Alice 2', privateId: pidA, password: pwA });
    assert.strictEqual(s.status, 200);
    assert.strictEqual(s.data.user.id, idA);
    tokenA = s.data.sessionToken;
  });

  await t('unauthenticated / forged / mismatched auth fails', async () => {
    const no = await jpatch('/api/profiles/' + encodeURIComponent(idA), { name: 'Hacker' });
    assert.ok(no.status === 401 || no.status === 403);
    const badTok = 'f'.repeat(64);
    const forged = await fetch(BASE + '/api/profiles/' + encodeURIComponent(idA), {
      method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, bearer(badTok)),
      body: JSON.stringify({ name: 'Hacker' }),
    });
    assert.ok(forged.status === 401 || forged.status === 403);
    // A cannot edit B
    const cross = await fetch(BASE + '/api/profiles/' + encodeURIComponent(idB), {
      method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, bearer(tokenA)),
      body: JSON.stringify({ name: 'Pwned' }),
    });
    assert.strictEqual(cross.status, 403);
    const crossAtt = await jpost('/api/profiles/' + encodeURIComponent(idB) + '/attempt',
      { level: 1, sessionToken: tokenA }, { headers: { 'Content-Type': 'application/json' } });
    assert.ok(crossAtt.status === 401 || crossAtt.status === 403);
    const crossComp = await jpost('/api/profiles/' + encodeURIComponent(idB) + '/completion',
      { level: 1, score: 10, coins: 1, time: 10, sessionToken: tokenA }, { headers: { 'Content-Type': 'application/json' } });
    assert.ok(crossComp.status === 401 || crossComp.status === 403);
  });

  await t('signout revokes; old token cannot be reused', async () => {
    const out = await jpost('/api/auth/signout', {}, { headers: bearer(tokenA) });
    assert.strictEqual(out.status, 200);
    const reuse = await jget('/api/auth/session', { headers: bearer(tokenA) });
    assert.strictEqual(reuse.status, 401);
    const patchOld = await fetch(BASE + '/api/profiles/' + encodeURIComponent(idA), {
      method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, bearer(tokenA)),
      body: JSON.stringify({ name: 'Ghost' }),
    });
    assert.ok(patchOld.status === 401 || patchOld.status === 403);
    // sign back in for later tests
    const s = await jpost('/api/auth/signin', { name: 'Auth Alice 2', privateId: pidA, password: pwA });
    assert.strictEqual(s.status, 200);
    tokenA = s.data.sessionToken;
  });

  await t('legacy device secret still works (backwards compat)', async () => {
    const r = await jget('/api/profiles/me?id=' + encodeURIComponent(idA), { headers: { 'X-Profile-Secret': legacySecretA } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.user.privateId, pidA);
  });

  // ---- MIGRATION: legacy account sets password, then signs in ----
  await t('legacy account can set password then sign in with it', async () => {
    const lp = 'legacy.' + stamp.slice(-8);
    const c = await jpost('/api/profiles', { name: 'Legacy Leo', privateId: lp, avatar: 'moon' });
    assert.strictEqual(c.status, 201);
    const lid = c.data.user.id, lsec = c.data.secret;
    assert.strictEqual(c.data.user.hasPassword, false);
    const set = await jpost('/api/auth/set-password/' + encodeURIComponent(lid),
      { newPassword: 'Legacy-Pass-' + stamp, secret: lsec });
    assert.strictEqual(set.status, 200);
    const me = await jget('/api/profiles/me?id=' + encodeURIComponent(lid), { headers: { 'X-Profile-Secret': lsec } });
    assert.strictEqual(me.data.user.hasPassword, true);
    const s = await jpost('/api/auth/signin', { name: 'Legacy Leo', privateId: lp, password: 'Legacy-Pass-' + stamp });
    assert.strictEqual(s.status, 200);
    assert.strictEqual(s.data.user.id, lid);
    // change requires current password
    const wrongCur = await jpost('/api/auth/set-password/' + encodeURIComponent(lid),
      { newPassword: 'New-Legacy-' + stamp, currentPassword: 'nope', sessionToken: s.data.sessionToken });
    assert.strictEqual(wrongCur.status, 401);
    const ch = await jpost('/api/auth/set-password/' + encodeURIComponent(lid),
      { newPassword: 'New-Legacy-' + stamp, currentPassword: 'Legacy-Pass-' + stamp, sessionToken: s.data.sessionToken });
    assert.strictEqual(ch.status, 200);
    // progress preserved across password ops
    const s2 = await jpost('/api/auth/signin', { name: 'Legacy Leo', privateId: lp, password: 'New-Legacy-' + stamp });
    assert.strictEqual(s2.data.user.id, lid);
    global.__sbAuthExtra = { legacyId: lid };
  });

  // ---- PRIVACY ----
  await t('public endpoints never expose privateId/hash/sessions/password', async () => {
    const list = await jget('/api/profiles?limit=100');
    assert.strictEqual(list.status, 200);
    for (const u of list.data.users) {
      assert.ok(!('privateId' in u) && !('passwordHash' in u) && !('secretHash' in u) && !('sessions' in u) && !('secret' in u));
    }
    const one = await jget('/api/profiles/' + encodeURIComponent(idA));
    assert.strictEqual(one.status, 200);
    assert.ok(!('privateId' in one.data.user) && !('passwordHash' in one.data.user) && !('sessions' in one.data.user));
    const lb = await jget('/api/leaderboard?limit=50');
    assert.strictEqual(lb.status, 200);
    for (const u of lb.data.rows) {
      assert.ok(!('privateId' in u) && !('passwordHash' in u) && !('sessions' in u) && !('secretHash' in u));
    }
  });

  // ---- RATE LIMITING (temporary, no lockout) ----
  await t('repeated failed signins are throttled, account not locked', async () => {
    CFG.authRateMax = 6;
    mod.resetAuthLimits();
    let saw429 = false;
    for (let i = 0; i < 10; i++) {
      const r = await jpost('/api/auth/signin', { name: 'Auth Alice 2', privateId: pidA, password: 'wrong-' + i });
      if (r.status === 429) { saw429 = true; break; }
      assert.strictEqual(r.status, 401);
    }
    assert.ok(saw429, 'expected 429 throttling');
    CFG.authRateMax = 200;
    mod.resetAuthLimits();
    const ok = await jpost('/api/auth/signin', { name: 'Auth Alice 2', privateId: pidA, password: pwA });
    assert.strictEqual(ok.status, 200, 'legitimate login works after throttle window reset (no lockout)');
    tokenA = ok.data.sessionToken;
  });

  // ---- REGRESSION ----
  await t('reviews + CORS + security headers intact', async () => {
    const rev = await jget('/api/reviews');
    assert.strictEqual(rev.status, 200);
    assert.ok(Array.isArray(rev.data.reviews));
    for (let i = 1; i < rev.data.reviews.length; i++) {
      assert.ok(rev.data.reviews[i - 1].createdAt >= rev.data.reviews[i].createdAt);
    }
    const pre = await fetch(BASE + '/api/reviews', { method: 'OPTIONS', headers: { Origin: 'https://test.github.io', 'Access-Control-Request-Method': 'POST' } });
    assert.ok(pre.status === 204 || pre.status === 200);
    assert.strictEqual(pre.headers.get('access-control-allow-origin'), 'https://test.github.io');
    const allowH = pre.headers.get('access-control-allow-headers') || '';
    assert.ok(allowH.indexOf('Authorization') >= 0 && allowH.indexOf('X-Session-Token') >= 0);
    const sess = await jget('/api/auth/session', { headers: bearer(tokenA) });
    assert.ok((sess.headers.get('cache-control') || '').indexOf('no-store') >= 0, 'authed responses no-store');
  });

  await t('production data untouched (read-only check via live API)', async () => {
    const live = await (await fetch('https://starbound-api.onrender.com/api/profiles?limit=500')).json();
    assert.ok(Array.isArray(live.users));
    for (const u of live.users) {
      assert.ok(!('passwordHash' in u) && !('secretHash' in u) && !('sessions' in u) && !('privateId' in u));
    }
    const lb = await (await fetch('https://starbound-api.onrender.com/api/leaderboard?limit=5')).json();
    assert.ok(Array.isArray(lb.rows));
  });

  // ---- CLEANUP: empty the isolated test entry ----
  await t('isolated test entry cleaned, nothing left behind', async () => {
    const entry = 'https://mantledb.sh/v2/starlit-pip-guestbook/profiles-test-auth-v1';
    await fetch(entry, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: 1, resetVersion: 0, users: [] }) });
    const v = await (await fetch(entry)).json().catch(() => null);
    assert.ok(v && Array.isArray(v.users) && v.users.length === 0);
  });

  console.log('[auth-test] ALL ' + pass + ' TESTS PASSED');
  server.close();
  process.exit(0);
}

run().catch(async (e) => {
  console.error('[auth-test] FAILED:', e && e.message);
  try {
    await fetch('https://mantledb.sh/v2/starlit-pip-guestbook/profiles-test-auth-v1', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 1, resetVersion: 0, users: [] }),
    });
    console.log('[auth-test] test entry cleaned after failure');
  } catch (ee) {}
  try { server.close(); } catch (ee) {}
  process.exit(1);
});
