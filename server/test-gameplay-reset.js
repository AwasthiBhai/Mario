/* STARBOUND — gameplay-reset tests (offline, headless, zero production I/O).
 * Stubs window/localStorage/fetch, loads the REAL js/save.js + js/profiles.js
 * and verifies: legacy one-time migration, server-driven resetVersion sync,
 * world-wipe clearing (gameplay only, prefs preserved), level gating, guest
 * write discipline, outbox account-tagging (no cross-account uploads), and
 * validateSession dead/alive/network semantics.
 * Usage: node test-gameplay-reset.js   (from server/)
 */
'use strict';
const assert = require('assert');

// ---- minimal browser stubs ----
const store = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.window = global;
global.SP_ApiConfig = { getBase: () => 'http://127.0.0.1:9' };
let fetchCalls = 0;
let fetchImpl = () => Promise.reject(new Error('offline'));
global.fetch = (u, o) => { fetchCalls++; return fetchImpl(u, o); };
function okJson(obj) {
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(obj)) });
}
function errJson(status, obj) {
  return Promise.resolve({ ok: false, status, text: () => Promise.resolve(JSON.stringify(obj)) });
}

require('../js/save.js');
require('../js/profiles.js');
const Save = global.SP_Save;
const P = global.SP_Profiles;

const SAVE_KEY = 'starlitPipSaveV1';
const OUTBOX_KEY = 'starboundProfileOutboxV1';
const CACHE_KEY = 'starboundProfilesCacheV1';
const SESSION_KEY = 'starboundProfileSessionV1';
const AUTH_KEY = 'starboundAuthSessionV1';
const THEME_KEY = 'starboundThemeV1';

function clearStore() { for (const k of Object.keys(store)) delete store[k]; }
function seedSave(o) { store[SAVE_KEY] = JSON.stringify(o); }
function readSave() { return JSON.parse(store[SAVE_KEY]); }
function oldProgressSave(marker) {
  const s = {
    version: 1, introSeen: true, maxUnlocked: 7,
    levels: { 1: { done: true, bestScore: 500, bestTime: 60, coins: 10, totalCoins: 10, relic: true } },
    totalCoins: 10, totalRelics: 1, totalScore: 500,
    settings: { master: 11, music: 22, sfx: 33, muted: true, touch: true, touchOff: false, reducedMotion: true, shake: false, keys: { jump: 'KeyJ' } },
  };
  if (marker !== undefined) s.gameDataResetVersion = marker;
  return s;
}

let pass = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok - ' + name); }
  catch (e) { console.error('  FAIL - ' + name + ': ' + (e && e.message)); process.exitCode = 1; throw e; }
}

async function run() {
  console.log('[reset-test] headless gameplay-reset suite');

  await t('1. old marker-less save migrates once, prefs preserved', async () => {
    clearStore();
    seedSave(oldProgressSave(undefined));
    store[THEME_KEY] = 'light';
    Save.load();
    assert.strictEqual(Save.data.maxUnlocked, 1);
    assert.deepStrictEqual(Save.data.levels, {});
    assert.strictEqual(Save.data.totalCoins, 0);
    assert.strictEqual(Save.data.gameDataResetVersion, 1);
    assert.strictEqual(Save.data.settings.master, 11, 'audio pref preserved');
    assert.strictEqual(Save.data.settings.keys.jump, 'KeyJ', 'control pref preserved');
    assert.strictEqual(store[THEME_KEY], 'light', 'theme key untouched');
  });

  await t('2. marker==server version is a no-op (keeps progress)', async () => {
    clearStore();
    store[SESSION_KEY] = JSON.stringify({ id: 'p_keep', secret: 'e'.repeat(64), privateId: 'keep' });
    seedSave(oldProgressSave(1));
    Save.load();
    assert.strictEqual(Save.applyServerReset(1), false);
    assert.strictEqual(Save.data.maxUnlocked, 7, 'legit progress kept');
  });

  await t('3. server-newer resetVersion clears unlocks and stamps marker', async () => {
    clearStore();
    store[SESSION_KEY] = JSON.stringify({ id: 'p_old', secret: 'f'.repeat(64), privateId: 'old' });
    seedSave(oldProgressSave(1));
    store[OUTBOX_KEY] = JSON.stringify([{ op: 'attempt', level: 3 }]);
    store[CACHE_KEY] = JSON.stringify({ at: 1, doc: { users: [] } });
    Save.load();
    assert.strictEqual(Save.data.maxUnlocked, 7, 'precondition: progress loaded');
    assert.strictEqual(Save.applyServerReset(2), true);
    assert.strictEqual(Save.data.maxUnlocked, 1);
    assert.deepStrictEqual(Save.data.levels, {});
    assert.strictEqual(Save.data.totalCoins, 0);
    assert.strictEqual(Save.data.totalRelics, 0);
    assert.strictEqual(Save.data.totalScore, 0);
    assert.strictEqual(Save.data.gameDataResetVersion, 2);
    assert.ok(!(OUTBOX_KEY in store), 'outbox dropped');
    assert.ok(!(CACHE_KEY in store), 'profiles cache dropped');
    assert.strictEqual(Save.applyServerReset(2), false, 'idempotent');
  });

  await t('4/5. level 1 available, higher levels locked after reset', async () => {
    assert.ok(Save.isUnlocked(1), 'level 1 available');
    for (const n of [2, 7, 25, 50]) assert.ok(!Save.isUnlocked(n), 'level ' + n + ' locked');
  });

  await t('6/7/8. theme/audio/controls survive world resets', async () => {
    clearStore();
    seedSave(oldProgressSave(1));
    store[THEME_KEY] = 'dark';
    store[SESSION_KEY] = JSON.stringify({ id: 'p_x', secret: 'a'.repeat(64), privateId: 'x' });
    store[AUTH_KEY] = JSON.stringify({ id: 'p_x', token: 'b'.repeat(64), expiresAt: Date.now() + 99999 });
    Save.load();
    Save.resetAfterWorldWipe();
    const s = Save.data;
    assert.strictEqual(s.settings.master, 11);
    assert.strictEqual(s.settings.muted, true);
    assert.strictEqual(s.settings.touch, true);
    assert.deepStrictEqual(s.settings.keys, { jump: 'KeyJ' });
    assert.strictEqual(store[THEME_KEY], 'dark', 'theme untouched');
    assert.ok(SESSION_KEY in store && AUTH_KEY in store, 'sessions not cleared by gameplay wipe');
    assert.strictEqual(s.maxUnlocked, 1, 'gameplay cleared');
  });

  await t('9/10. wiped world + new account start fresh; post-reset saves kept', async () => {
    clearStore();
    seedSave(oldProgressSave(1));
    Save.load();
    Save.resetAfterWorldWipe();
    assert.strictEqual(Save.data.maxUnlocked, 1);
    assert.deepStrictEqual(readSave().levels, {}, 'persisted copy also fresh');
    // An account created after the reset keeps working on the fresh save.
    assert.strictEqual(Save.applyServerReset(1), false, 'matching version keeps post-reset save');
  });

  await t('11a. guest writes never persist gameplay progress', async () => {
    clearStore();
    delete store[SESSION_KEY]; delete store[AUTH_KEY];
    Save.load();
    Save.data.maxUnlocked = 9;
    Save.data.levels = { 9: { done: true, bestScore: 1, bestTime: 1, coins: 1, totalCoins: 1 } };
    Save.write();
    const persisted = readSave();
    assert.strictEqual(persisted.maxUnlocked, 1, 'guest progress not persisted');
    assert.deepStrictEqual(persisted.levels, {});
  });

  await t('11b. outbox ops are account-tagged; foreign flush drops them', async () => {
    clearStore(); fetchCalls = 0;
    store[SESSION_KEY] = JSON.stringify({ id: 'p_acctaaa', secret: 'a'.repeat(64), privateId: 'aaa' });
    fetchImpl = () => Promise.reject(new Error('offline'));
    const q = await P.recordAttempt(1);
    assert.ok(q.queued, 'offline op queued');
    const box = JSON.parse(store[OUTBOX_KEY]);
    assert.strictEqual(box.length, 1);
    assert.strictEqual(box[0].pid, 'p_acctaaa', 'op tagged with owner');
    // Switch account: flush must NOT upload the stranger op.
    store[SESSION_KEY] = JSON.stringify({ id: 'p_acctbbb', secret: 'b'.repeat(64), privateId: 'bbb' });
    fetchImpl = (u) => { throw new Error('must not be called for foreign ops'); };
    const fl = await P.flushOutbox();
    assert.strictEqual(fl.dropped, 1);
    assert.strictEqual(fl.pending, 0);
    assert.deepStrictEqual(JSON.parse(store[OUTBOX_KEY]), []);
    // Same account flush uploads normally.
    store[SESSION_KEY] = JSON.stringify({ id: 'p_acctaaa', secret: 'a'.repeat(64), privateId: 'aaa' });
    fetchImpl = () => Promise.reject(new Error('offline'));
    await P.recordAttempt(2);
    fetchCalls = 0;
    fetchImpl = () => okJson({});
    const fl2 = await P.flushOutbox();
    assert.strictEqual(fl2.flushed, 1);
    assert.ok(fetchCalls >= 1, 'own op uploaded');
  });

  await t('validateSession: alive/dead/network/no-session semantics', async () => {
    clearStore();
    assert.deepStrictEqual(await P.validateSession(), { ok: false, dead: false }, 'no session');
    store[AUTH_KEY] = JSON.stringify({ id: 'p_v', token: 'c'.repeat(64), expiresAt: Date.now() + 99999 });
    fetchImpl = () => okJson({ ok: true, user: { id: 'p_v' } });
    assert.deepStrictEqual(await P.validateSession(), { ok: true, dead: false }, 'alive');
    fetchImpl = () => errJson(401, { error: 'nope' });
    assert.deepStrictEqual(await P.validateSession(), { ok: false, dead: true }, 'revoked -> dead');
    fetchImpl = () => Promise.reject(new Error('offline'));
    assert.deepStrictEqual(await P.validateSession(), { ok: false, dead: false }, 'blip is not death');
    delete store[AUTH_KEY];
    store[SESSION_KEY] = JSON.stringify({ id: 'p_v', secret: 'd'.repeat(64), privateId: 'v' });
    fetchImpl = () => errJson(404, { error: 'gone' });
    assert.deepStrictEqual(await P.validateSession(), { ok: false, dead: true }, 'legacy 404 -> dead');
  });

  await t('profiles cache preserves server resetVersion', async () => {
    clearStore(); delete store[SESSION_KEY]; delete store[AUTH_KEY];
    fetchImpl = (u) => {
      if (String(u).indexOf('/api/profiles?limit=') >= 0) return okJson({ users: [], resetVersion: 7 });
      return Promise.reject(new Error('unexpected ' + u));
    };
    const res = await P.load();
    assert.ok(res.ok && res.doc);
    assert.strictEqual(res.doc.resetVersion, 7, 'server version visible to client');
    const cached = JSON.parse(store[CACHE_KEY]);
    assert.strictEqual(cached.doc.resetVersion, 7, 'cached version preserved');
  });

  console.log('[reset-test] ALL ' + pass + ' TESTS PASSED');
}

run().catch((e) => {
  console.error('[reset-test] FAILED:', e && e.message);
  process.exit(1);
});
