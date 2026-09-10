/* STARBOUND API — local test suite (isolated entries, zero production writes).
 * Runs the server on a test port and exercises: boot, env fail-safes,
 * reviews CRUD + validation + write-auth, profiles privacy/ownership/stats
 * validation, leaderboard, rate/body/malformed guards, and failure handling.
 * All reads/writes go to dedicated test entries (never production), and the
 * suite removes its temp ids afterwards.
 * Usage: npm test   (from server/)
 */
'use strict';
const assert = require('assert');

const TEST_PORT = 18787;
process.env.PORT = String(TEST_PORT);
// Isolated entries: this suite never touches production data.
process.env.MANTLEDB_PROFILES_ENTRY = 'profiles-test-legacy-v1';
process.env.MANTLEDB_REVIEWS_ENTRY = 'reviews-test-legacy-v1';
process.env.AUTH_PEPPER = 'test-pepper-legacy-suite';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000,https://test.github.io';
process.env.RATE_LIMIT_MAX = '200';

const TEST_PROFILES_ENTRY = 'https://mantledb.sh/v2/starlit-pip-guestbook/profiles-test-legacy-v1';
const TEST_REVIEWS_ENTRY = 'https://mantledb.sh/v2/starlit-pip-guestbook/reviews-test-legacy-v1';

const { server } = require('./server.js');
const BASE = 'http://127.0.0.1:' + TEST_PORT;

async function jget(p, opts) {
  const r = await fetch(BASE + p, opts || {});
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
  return { status: r.status, data, headers: r.headers };
}
async function jpost(p, body, opts) {
  return jget(p, Object.assign({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, opts || {}));
}
async function jpatch(p, body, opts) {
  return jget(p, Object.assign({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, opts || {}));
}

async function run() {
  await new Promise((res) => server.listen(TEST_PORT, res));
  console.log('[test] server up on ' + TEST_PORT);
  let pass = 0;
  async function t(name, fn) {
    try { await fn(); pass++; console.log('  ok - ' + name); }
    catch (e) { console.error('  FAIL - ' + name + ': ' + (e && e.message)); throw e; }
  }

  // 1. health
  await t('GET /api/health', async () => {
    const r = await jget('/api/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.ok, true);
  });
  // 2. account first (review writes require an account holder)
  const stamp = Date.now().toString(36);
  const testPid = 'apitest.' + stamp.slice(-8);
  let myId = null, mySecret = null;
  await t('POST /api/profiles creates account, returns secret once', async () => {
    const r = await jpost('/api/profiles', { name: 'Api Bot', privateId: testPid, avatar: 'nova-star' });
    assert.strictEqual(r.status, 201);
    assert.ok(r.data.ok && r.data.user && r.data.secret);
    assert.ok(!('secretHash' in r.data.user) && !('secret' in r.data.user));
    assert.strictEqual(r.data.user.privateId, testPid);
    myId = r.data.user.id;
    mySecret = r.data.secret;
    global.__sbTestIds = Object.assign(global.__sbTestIds || {}, { userId: myId });
  });
  const revCreds = () => ({ accountId: myId, secret: mySecret });
  // 3. reviews read (public)
  let beforeCount = 0;
  let createdReviewId = null;
  await t('GET /api/reviews returns newest-first public list', async () => {
    const r = await jget('/api/reviews');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.data.reviews));
    beforeCount = r.data.reviews.length;
    for (const rv of r.data.reviews) {
      assert.ok(rv.name && rv.text && rv.rating >= 1 && rv.rating <= 5);
      assert.ok(!('secret' in rv) && !('secretHash' in rv) && !('privateId' in rv));
    }
    for (let i = 1; i < r.data.reviews.length; i++) {
      assert.ok(r.data.reviews[i - 1].createdAt >= r.data.reviews[i].createdAt);
    }
  });
  // 4. reviews validation (authenticated shape still validated)
  await t('POST /api/reviews rejects bad input', async () => {
    const bad = await jpost('/api/reviews', Object.assign({ name: '', rating: 9, text: '' }, revCreds()));
    assert.strictEqual(bad.status, 400);
    const long = await jpost('/api/reviews', Object.assign({ name: 'x'.repeat(100), rating: 5, text: 'hi' }, revCreds()));
    assert.strictEqual(long.status, 400);
  });
  // 5. guests cannot submit reviews (READ public, WRITE account-only)
  await t('Guest POST /api/reviews rejected (401)', async () => {
    const anon = await jpost('/api/reviews', { name: 'Ghost', rating: 5, text: 'i should not appear' });
    assert.strictEqual(anon.status, 401);
    const forged = await fetch(BASE + '/api/reviews', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + '0'.repeat(64) },
      body: JSON.stringify({ name: 'Ghost', rating: 5, text: 'forged token' }) });
    assert.strictEqual(forged.status, 401);
    const wrongSecret = await jpost('/api/reviews', { name: 'Ghost', rating: 5, text: 'x', accountId: myId, secret: '0'.repeat(64) });
    assert.ok(wrongSecret.status === 401 || wrongSecret.status === 403);
  });
  // 6. reviews write + preserved history
  await t('POST /api/reviews persists without deleting history', async () => {
    const r = await jpost('/api/reviews', Object.assign({ name: 'ApiTest', rating: 5, text: 'backend migration test review' }, revCreds()));
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.ok && r.data.review && r.data.review.id);
    createdReviewId = r.data.review.id;
    global.__sbTestIds = Object.assign(global.__sbTestIds || {}, { reviewId: createdReviewId });
    const after = await jget('/api/reviews');
    assert.ok(after.data.reviews.length >= beforeCount);
    assert.ok(after.data.reviews.some((x) => x.id === createdReviewId));
  });
  // 5. no delete endpoint
  await t('No public review-delete endpoint', async () => {
    const r = await jget('/api/reviews', { method: 'DELETE' });
    assert.strictEqual(r.status, 404);
  });
  // 6. leaderboard
  await t('GET /api/leaderboard hides private fields', async () => {
    const r = await jget('/api/leaderboard');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.data.rows));
    for (const u of r.data.rows) {
      assert.ok(u.id && u.name);
      assert.ok(!('privateId' in u) && !('secretHash' in u) && !('runs' in u) && !('secret' in u));
    }
  });
  // 7. profiles list
  await t('GET /api/profiles hides private fields', async () => {
    const r = await jget('/api/profiles');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.data.users));
    assert.ok(typeof r.data.resetVersion === 'number', 'world resetVersion exposed');
    for (const u of r.data.users) {
      assert.ok(!('privateId' in u) && !('secretHash' in u));
    }
  });
  // 8. duplicate privateId rejected (account created in step 2)
  await t('Duplicate privateId rejected', async () => {
    const r = await jpost('/api/profiles', { name: 'Clone', privateId: testPid, avatar: 'alien' });
    assert.ok(r.status === 409 || r.status === 400);
  });
  // 10. owner read
  await t('GET /api/profiles/me returns owner record without secretHash', async () => {
    const r = await jget('/api/profiles/me?id=' + encodeURIComponent(myId), { headers: { 'X-Profile-Secret': mySecret } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.user.privateId, testPid);
    assert.ok(!('secretHash' in r.data.user));
  });
  // 11. public read hides private
  await t('GET /api/profiles/:id is public-only', async () => {
    const r = await jget('/api/profiles/' + encodeURIComponent(myId));
    assert.strictEqual(r.status, 200);
    assert.ok(!('privateId' in r.data.user) && !('secretHash' in r.data.user));
  });
  // 12. unauthorized edit fails
  await t('PATCH without/wrong secret fails', async () => {
    const no = await jpatch('/api/profiles/' + encodeURIComponent(myId), { name: 'Hacker' });
    assert.ok(no.status === 401 || no.status === 403);
    const wrong = await jpatch('/api/profiles/' + encodeURIComponent(myId), { name: 'Hacker', secret: '0'.repeat(64) });
    assert.strictEqual(wrong.status, 403);
  });
  // 13. authorized edit works
  await t('PATCH with secret updates name', async () => {
    const r = await jpatch('/api/profiles/' + encodeURIComponent(myId), { name: 'Api Bot 2', secret: mySecret });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.user.name, 'Api Bot 2');
  });
  // 14. attempts recorded
  await t('POST attempt works, bad level rejected', async () => {
    const bad = await jpost('/api/profiles/' + encodeURIComponent(myId) + '/attempt', { level: 99, secret: mySecret });
    assert.strictEqual(bad.status, 400);
    const ok = await jpost('/api/profiles/' + encodeURIComponent(myId) + '/attempt', { level: 1, secret: mySecret });
    assert.strictEqual(ok.status, 200);
  });
  // 15. completions recorded + invalid rejected
  await t('POST completion validates stats', async () => {
    const neg = await jpost('/api/profiles/' + encodeURIComponent(myId) + '/completion', { level: 1, score: -5, coins: 0, time: 10, secret: mySecret });
    assert.strictEqual(neg.status, 400);
    const big = await jpost('/api/profiles/' + encodeURIComponent(myId) + '/completion', { level: 1, score: 99999999, coins: 0, time: 10, secret: mySecret });
    assert.strictEqual(big.status, 400);
    const badTime = await jpost('/api/profiles/' + encodeURIComponent(myId) + '/completion', { level: 1, score: 100, coins: 5, time: 99999, secret: mySecret });
    assert.strictEqual(badTime.status, 400);
    const badLevel = await jpost('/api/profiles/' + encodeURIComponent(myId) + '/completion', { level: 0, score: 100, coins: 5, time: 10, secret: mySecret });
    assert.strictEqual(badLevel.status, 400);
    const ok = await jpost('/api/profiles/' + encodeURIComponent(myId) + '/completion', { level: 1, score: 1234, coins: 12, time: 65.5, runId: 't_' + Date.now().toString(36), secret: mySecret });
    assert.strictEqual(ok.status, 200);
  });
  // 16. oversized rejected
  await t('Oversized body rejected (413)', async () => {
    const r = await jpost('/api/reviews', Object.assign({ name: 'x', rating: 5, text: 'y'.repeat(70000) }, revCreds()));
    assert.ok(r.status === 400 || r.status === 413);
  });
  // 17. malformed JSON rejected
  await t('Malformed JSON rejected (400)', async () => {
    const r = await fetch(BASE + '/api/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    assert.strictEqual(r.status, 400);
  });
  // 18. unknown route 404 without secrets
  await t('Unknown route 404, no stack/secrets', async () => {
    const r = await jget('/api/nope');
    assert.strictEqual(r.status, 404);
    const txt = JSON.stringify(r.data);
    assert.ok(txt.indexOf('secretHash') < 0 && txt.indexOf('stack') < 0 && txt.indexOf('MANTLE') < 0);
  });
  // 19. CORS preflight
  await t('CORS preflight responds', async () => {
    const r = await fetch(BASE + '/api/reviews', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'POST' } });
    assert.ok(r.status === 204 || r.status === 200);
  });
  // 20. invalid avatar rejected
  await t('Invalid avatar rejected', async () => {
    const r = await jpost('/api/profiles', { name: 'Bad Av', privateId: 'badav.' + stamp.slice(-6), avatar: 'not-a-preset' });
    assert.strictEqual(r.status, 400);
  });

  // 21. self-cleanup: remove THIS run's temp review + account from the
  // ISOLATED test entries (production is never touched by this suite).
  await t('Test data cleaned up, test entries consistent', async () => {
    const live1 = await (await fetch(TEST_REVIEWS_ENTRY)).json();
    const keptReviews = (live1.reviews || []).filter((r) => r.id !== createdReviewId);
    if (keptReviews.length !== (live1.reviews || []).length) {
      await fetch(TEST_REVIEWS_ENTRY, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviews: keptReviews }),
      });
    }
    const live2 = await (await fetch(TEST_PROFILES_ENTRY)).json();
    const keptUsers = (live2.users || []).filter((u) => u.id !== myId);
    if (keptUsers.length !== (live2.users || []).length) {
      await fetch(TEST_PROFILES_ENTRY, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ v: 1, resetVersion: live2.resetVersion || 0, users: keptUsers }),
      });
    }
    const v1 = await (await fetch(TEST_REVIEWS_ENTRY)).json();
    const v2 = await (await fetch(TEST_PROFILES_ENTRY)).json();
    assert.ok(!(v1.reviews || []).some((r) => r.id === createdReviewId), 'test review removed');
    assert.ok(!(v2.users || []).some((u) => u.id === myId), 'test account removed');
    assert.ok((v1.reviews || []).length >= 0, 'test reviews entry consistent');
  });

  console.log('[test] ALL ' + pass + ' TESTS PASSED');
  server.close();
  process.exit(0);
}

/* Best-effort cleanup of this run's temp ids in the ISOLATED test entries —
 * also runs when the suite FAILS partway, so a red run never leaves debris. */
async function emergencyCleanup(ids) {
  try {
    if (ids.reviewId) {
      const live = await (await fetch(TEST_REVIEWS_ENTRY)).json().catch(() => null);
      if (live && Array.isArray(live.reviews) && live.reviews.some((r) => r.id === ids.reviewId)) {
        await fetch(TEST_REVIEWS_ENTRY, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reviews: live.reviews.filter((r) => r.id !== ids.reviewId) }),
        });
        console.log('[test] emergency cleanup: removed temp review');
      }
    }
  } catch (e) { /* best effort only */ }
  try {
    if (ids.userId) {
      const live = await (await fetch(TEST_PROFILES_ENTRY)).json().catch(() => null);
      if (live && Array.isArray(live.users) && live.users.some((u) => u.id === ids.userId)) {
        await fetch(TEST_PROFILES_ENTRY, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ v: 1, resetVersion: live.resetVersion || 0, users: live.users.filter((u) => u.id !== ids.userId) }),
        });
        console.log('[test] emergency cleanup: removed temp account');
      }
    }
  } catch (e) { /* best effort only */ }
}

run().catch(async (e) => {
  console.error('[test] FAILED:', e && e.message);
  try { await emergencyCleanup(global.__sbTestIds || {}); } catch (ee) {}
  try { server.close(); } catch (ee) {}
  process.exit(1);
});
