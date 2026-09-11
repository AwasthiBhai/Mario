/* PLAYNOVA — RIFTSTRIKE API tests (isolated; no production data).
 * Spins the API with an in-memory MantleDB stub via技巧: we test the pure
 * validators/merge by importing server module pieces through child process
 * HTTP calls against a local server with stubbed fetch.
 * Simpler + honest: start server on an ephemeral port with MANTLEDB pointed
 * at a local stub HTTP server that mimics MantleDB GET/POST semantics. */
'use strict';
const http = require('http');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')); }
}

// ---- stub MantleDB: single profiles doc in memory ----
let profilesDoc = { v: 1, resetVersion: 1, users: [] };
const reviewsDoc = { reviews: [] };
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const url = req.url || '';
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && url.endsWith('/reviews')) return res.end(JSON.stringify(reviewsDoc));
    if (req.method === 'GET' && url.endsWith('/profiles-v1')) return res.end(JSON.stringify(profilesDoc));
    if (req.method === 'POST' && url.endsWith('/profiles-v1')) {
      try { profilesDoc = JSON.parse(body); } catch (e) { res.statusCode = 400; return res.end('{}'); }
      return res.end(JSON.stringify({ success: true }));
    }
    if (req.method === 'POST' && url.endsWith('/reviews')) return res.end(JSON.stringify({ success: true }));
    res.statusCode = 404; res.end('{}');
  });
});

function api(port, method, path, body, headers) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ port, method, path, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, (res) => {
      let t = '';
      res.on('data', c => { t += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) {} resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', (e) => resolve({ status: 0, body: null, err: String(e) }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  await new Promise(r => stub.listen(0, r));
  const stubPort = stub.address().port;
  process.env.PORT = '0';
  process.env.MANTLEDB_BASE_URL = 'http://localhost:' + stubPort;
  process.env.MANTLEDB_NAMESPACE = 'test-ns';
  process.env.MANTLEDB_REVIEWS_ENTRY = 'reviews';
  process.env.MANTLEDB_PROFILES_ENTRY = 'profiles-v1';
  process.env.AUTH_PEPPER = 'test-pepper-do-not-use-in-prod-0123456789';
  process.env.ALLOWED_ORIGINS = '*';
  delete require.cache[require.resolve('./server.js')];
  const { server } = require('./server.js');
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  // create account
  const su = await api(port, 'POST', '/api/auth/signup', { name: 'RiftTester', privateId: 'rifttest1', avatar: 'nova-star', password: 'testpass123' });
  ok(su.status === 201 && su.body && su.body.sessionToken, 'signup for fighting tests', JSON.stringify(su.body).slice(0, 160));
  const token = su.body && su.body.sessionToken;
  const id = su.body && su.body.user && su.body.user.id;
  const H = { Authorization: 'Bearer ' + token };

  // valid fighting write
  const f1 = await api(port, 'POST', '/api/profiles/' + id + '/fighting',
    { level: 3, world: 0, score: 1200, coins: 40, time: 95.5, kills: 25, bosses: ['cinder_maw'], weapons: ['emberbrand', 'tidecleaver'], skins: ['ember_apprentice'], equippedWeapon: 'tidecleaver', equippedSkin: 'ember_apprentice', upgrades: { vitality: 1 } }, H);
  ok(f1.status === 200 && f1.body && f1.body.ok && f1.body.fight && f1.body.fight.score === 1200, 'valid fighting write accepted');

  // worse score does not overwrite (max-wins)
  const f2 = await api(port, 'POST', '/api/profiles/' + id + '/fighting',
    { level: 3, score: 100, coins: 5, time: 300 }, H);
  ok(f2.status === 200 && f2.body.fight.score === 1200, 'worse fighting score does not overwrite');

  // negative coins rejected
  const bad1 = await api(port, 'POST', '/api/profiles/' + id + '/fighting', { level: 2, score: 10, coins: -5, time: 60 }, H);
  ok(bad1.status === 400, 'negative fighting coins rejected');

  // impossible level rejected
  const bad2 = await api(port, 'POST', '/api/profiles/' + id + '/fighting', { level: 99, score: 10, coins: 1, time: 60 }, H);
  ok(bad2.status === 400, 'impossible fighting level rejected');

  // absurd score rejected
  const bad3 = await api(port, 'POST', '/api/profiles/' + id + '/fighting', { level: 2, score: 999999999, coins: 1, time: 60 }, H);
  ok(bad3.status === 400, 'absurd fighting score rejected');

  // absurd time rejected
  const bad4 = await api(port, 'POST', '/api/profiles/' + id + '/fighting', { level: 2, score: 10, coins: 1, time: 99999999 }, H);
  ok(bad4.status === 400, 'absurd fighting time rejected');

  // invalid weapon id rejected
  const bad5 = await api(port, 'POST', '/api/profiles/' + id + '/fighting', { level: 2, score: 10, coins: 1, time: 60, weapons: ['doombringer'] }, H);
  ok(bad5.status === 400, 'invalid weapon id rejected');

  // invalid skin id rejected
  const bad6 = await api(port, 'POST', '/api/profiles/' + id + '/fighting', { level: 2, score: 10, coins: 1, time: 60, skins: ['mario'] }, H);
  ok(bad6.status === 400, 'invalid skin id rejected');

  // forged profile id rejected (token belongs to another id)
  const bad7 = await api(port, 'POST', '/api/profiles/p_forged_123/fighting', { level: 2, score: 10, coins: 1, time: 60 }, H);
  ok(bad7.status === 403 || bad7.status === 404 || bad7.status === 400, 'forged profile id rejected');

  // guest (no token) rejected
  const bad8 = await api(port, 'POST', '/api/profiles/' + id + '/fighting', { level: 2, score: 10, coins: 1, time: 60 });
  ok(bad8.status === 401, 'guest fighting write rejected (401)');

  // owner record exposes fight, public record exposes summary only
  const me = await api(port, 'GET', '/api/auth/session', null, H);
  ok(me.status === 200 && me.body && me.body.user && me.body.user.fight && !('secretHash' in me.body.user) && !('passwordHash' in me.body.user) && !('sessions' in me.body.user), 'owner fight record without secrets');
  const pub = await api(port, 'GET', '/api/profiles/' + id);
  ok(pub.status === 200 && pub.body && pub.body.user && pub.body.user.fight && !('privateId' in pub.body.user), 'public fight summary without privateId');

  // platformer completion still works (regression)
  const pc = await api(port, 'POST', '/api/profiles/' + id + '/completion', { level: 1, score: 500, coins: 10, time: 60, runId: 'r1' }, H);
  ok(pc.status === 200 && pc.body && pc.body.ok, 'platformer completion regression ok');

  server.close(); stub.close();
  console.log('[test-fighting] ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
