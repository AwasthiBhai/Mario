/* STARBOUND — review UX tests (headless, zero production I/O).
 * Fake-DOM harness loads the REAL js/reviews.js + js/profiles.js + js/ui.js
 * (+ the real js/profiles-ui.js for the Create-Account routing contract) and
 * verifies the guest-friendly review flow: form always usable, guest submit
 * opens the account popup (nothing sent), Create Account routes to the
 * existing flow, signed-in submit works normally.
 * Usage: node test-review-ux.js   (from server/)
 */
'use strict';
const assert = require('assert');

// ---------- fake DOM ----------
function mkEl(tag, id) {
  const el = {
    tag: tag || 'div', id: id || '', children: [], attrs: {}, listeners: {},
    disabled: false, value: '', textContent: '', className: '', innerHTML: '',
    parentNode: null, removed: false, _cls: new Set(), _submitBtn: null,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c) { c.parentNode = this; this.children.unshift(c); return c; },
    remove() { this.removed = true; },
    focus() {},
    querySelector(sel) {
      if (sel === 'button[type="submit"]') return this._submitBtn;
      if (sel === '.av-custom-preview') return null;
      return null;
    },
    querySelectorAll() { return []; },
    fire(type, ev) {
      const e = ev || { preventDefault() {}, target: this };
      (this.listeners[type] || []).slice().forEach((f) => f.call(this, e));
    },
  };
  el.classList = {
    add(...c) { c.forEach((x) => el._cls.add(x)); },
    remove(...c) { c.forEach((x) => el._cls.delete(x)); },
    toggle(c, f) { if (f === undefined) f = !el._cls.has(c); if (f) el._cls.add(c); else el._cls.delete(c); },
    contains(c) { return el._cls.has(c); },
  };
  return el;
}
const nodes = {};
function nid(id) { if (!nodes[id]) nodes[id] = mkEl('div', id); return nodes[id]; }
const starBtns = [];
for (let i = 1; i <= 5; i++) { const b = mkEl('button'); b.setAttribute('data-v', String(i)); starBtns.push(b); }
const store = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.window = global;
global.SP_ApiConfig = { getBase: () => 'http://127.0.0.1:9' };
global.SP_Audio = { sfx() {}, init() {}, resume() {}, setVolumes() {} };
global.SP_Avatars = {
  PRESETS: [{ id: 'nova-star', name: 'Nova' }, { id: 'rocket', name: 'Rocket' }],
  defaultId: () => 'nova-star',
  isPreset: (id) => id === 'nova-star' || id === 'rocket',
  element: () => mkEl('span'),
  processCustomFile: () => Promise.resolve({ ok: false, error: 'nope' }),
};
let fetchCalls = 0;
let fetchImpl = () => Promise.reject(new Error('no backend in ux test'));
global.fetch = (u, o) => { fetchCalls++; return fetchImpl(u, o); };
function okJson(obj) {
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(obj)) });
}
global.document = {
  querySelector(sel) { return nodes[sel] || null; },
  querySelectorAll(sel) { if (sel === '#starPick button') return starBtns; return []; },
  createElement(t) { return mkEl(t); },
  getElementById(id) {
    if (id === 'canvasWrap') return null;
    return nodes['#' + id] || null;
  },
  addEventListener() {},
  body: mkEl('body'),
  fullscreenElement: undefined,
};
// Pre-register review + modal nodes.
['#revForm', '#revName', '#revText', '#revErrors', '#revOk', '#revSummary',
 '#revList', '#revStatus', '#revRetry', '#confirmModal', '#confirmTitle',
 '#confirmMsg', '#confirmOk', '#confirmCancel', '#profileRoot'].forEach(nid);
nid('#revForm')._submitBtn = mkEl('button');

require('../js/reviews.js');
require('../js/profiles.js');
require('../js/ui.js');
require('../js/profiles-ui.js');
const UI = global.SP_UI;
const RealProfileUI = global.SP_ProfileUI;

const AUTH_KEY = 'starboundAuthSessionV1';
function clearStore() { for (const k of Object.keys(store)) delete store[k]; }
function seedSignedIn() {
  store[AUTH_KEY] = JSON.stringify({ id: 'p_uxuser', token: 'a'.repeat(64), expiresAt: Date.now() + 999999 });
}
function textsUnder(root, out) {
  out = out || [];
  if (root.textContent) out.push(root.textContent);
  (root.children || []).forEach((c) => textsUnder(c, out));
  return out;
}

let pass = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok - ' + name); }
  catch (e) { console.error('  FAIL - ' + name + ': ' + (e && e.message)); process.exitCode = 1; throw e; }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

async function run() {
  console.log('[ux-test] headless review-UX suite');
  UI._bindConfirm();
  UI.bindReviews();

  await t('1/2. guest form inputs are enabled and accept typing', async () => {
    clearStore();
    UI.reviewRating = 0;
    UI.renderReviews();
    await tick();
    assert.strictEqual(nid('#revName').disabled, false, 'name enabled');
    assert.strictEqual(nid('#revText').disabled, false, 'textarea enabled');
    assert.strictEqual(nid('#revForm')._submitBtn.disabled, false, 'submit enabled');
    nid('#revName').value = 'Guest Writer';
    nid('#revText').value = 'I love this game so much!';
    assert.strictEqual(nid('#revName').value, 'Guest Writer');
    assert.strictEqual(nid('#revText').value, 'I love this game so much!');
  });

  await t('3/4. guest star picker selects 1 and 5 stars like signed-in', async () => {
    starBtns.forEach((b) => assert.strictEqual(b.disabled, false, 'star not disabled'));
    starBtns[0].fire('click');
    assert.strictEqual(UI.reviewRating, 1);
    assert.ok(starBtns[0].classList.contains('lit'));
    assert.ok(!starBtns[1].classList.contains('lit'));
    starBtns[4].fire('click');
    assert.strictEqual(UI.reviewRating, 5);
    assert.ok(starBtns.every((b) => b.classList.contains('lit')), 'all lit at 5');
  });

  await t('5/6/7. guest submit opens Create-Account popup, sends nothing', async () => {
    clearStore();
    fetchCalls = 0;
    nid('#revName').value = 'Guest Writer';
    nid('#revText').value = 'My draft review stays here.';
    starBtns[4].fire('click');
    nid('#revForm').fire('submit');
    await tick();
    assert.strictEqual(nid('#confirmTitle').textContent, 'Create Account to Submit Review');
    assert.strictEqual(nid('#confirmMsg').textContent, 'You need a game account to submit a review.');
    assert.strictEqual(nid('#confirmOk').textContent, 'Create Account');
    assert.strictEqual(fetchCalls, 0, 'guest review NOT sent to backend');
    assert.strictEqual(nid('#revName').value, 'Guest Writer', 'draft name kept');
    assert.strictEqual(nid('#revText').value, 'My draft review stays here.', 'draft text kept');
    assert.strictEqual(UI.reviewRating, 5, 'draft rating kept');
  });

  await t('9a. popup Create Account routes to existing account flow', async () => {
    let routed = null;
    global.SP_ProfileUI = { showCreateAccount() { routed = 'create-tab'; } };
    nid('#confirmOk').fire('click');
    await tick();
    assert.strictEqual(routed, 'create-tab', 'existing Create Account UI targeted');
    global.SP_ProfileUI = RealProfileUI;
  });

  await t('9b. real showCreateAccount opens Profile on the Create tab', async () => {
    clearStore();
    let shown = null;
    const keepUI = global.SP_UI;
    global.SP_UI = { show(v) { shown = v; }, notify() {} };
    RealProfileUI.showCreateAccount();
    assert.strictEqual(shown, 'profile', 'profile view opened');
    // The opened view renders the Create Account form (not Sign In).
    RealProfileUI.renderProfile();
    const texts = textsUnder(nid('#profileRoot'));
    assert.ok(texts.some((x) => x === 'Create your account'), 'create hero shown, got: ' + JSON.stringify(texts.slice(0, 8)));
    const placeholders = [];
    (function walk(n) {
      if (n.placeholder) placeholders.push(n.placeholder);
      (n.children || []).forEach(walk);
    })(nid('#profileRoot'));
    assert.ok(placeholders.some((x) => String(x).indexOf('At least') >= 0), 'password field of create flow present');
    global.SP_UI = keepUI;
    nid('#profileRoot').children = [];
  });

  await t('popup cancel navigates nowhere and sends nothing', async () => {
    clearStore();
    fetchCalls = 0;
    let routed = null;
    global.SP_ProfileUI = { showCreateAccount() { routed = 'create-tab'; } };
    nid('#revForm').fire('submit');
    await tick();
    nid('#confirmCancel').fire('click');
    await tick();
    assert.strictEqual(routed, null, 'no navigation on close');
    assert.strictEqual(fetchCalls, 0, 'nothing sent on close');
    global.SP_ProfileUI = RealProfileUI;
  });

  await t('12. signed-out validation path still intact behind popup', async () => {
    // Guest path never reaches validation (popup first) — but the validator
    // itself is unchanged and still rejects bad input when called.
    const v = global.SP_Reviews.validate('', 0, '');
    assert.ok(!v.ok && v.errors.length >= 2);
  });

  await t('10. signed-in player submits normally (one authed POST)', async () => {
    clearStore();
    seedSignedIn();
    fetchCalls = 0;
    let authed = false;
    fetchImpl = (u, o) => {
      o = o || {};
      if (String(u).indexOf('/api/reviews') >= 0 && (o.method || 'GET') === 'POST') {
        authed = !!(o.headers && o.headers.Authorization === 'Bearer ' + 'a'.repeat(64));
        return okJson({ ok: true, review: { id: 'r_ux1', name: 'Ux User', rating: 5, text: 'Signed-in review', createdAt: Date.now() } });
      }
      return okJson({ reviews: [] });
    };
    nid('#revName').value = 'Ux User';
    nid('#revText').value = 'Signed-in review';
    starBtns[4].fire('click');
    nid('#revForm').fire('submit');
    await tick(); await tick(); await tick();
    assert.ok(authed, 'POST carried the session token');
    assert.ok(fetchCalls >= 1, 'backend was called');
    assert.strictEqual(nid('#revOk').textContent, '★ Review shared with players everywhere! ★');
    assert.strictEqual(nid('#revName').value, '', 'fields cleared after success');
    assert.strictEqual(UI.reviewRating, 0, 'rating reset after success');
  });

  await t('signed-in invalid input shows validation, no POST', async () => {
    fetchCalls = 0;
    nid('#revName').value = '';
    nid('#revText').value = 'x';
    UI.reviewRating = 0;
    nid('#revForm').fire('submit');
    await tick();
    assert.ok(nid('#revErrors').textContent.length > 0, 'validation message shown');
    assert.strictEqual(fetchCalls, 0, 'invalid review not sent');
  });

  await t('13. reviews list loads and renders newest data', async () => {
    clearStore();
    const now = Date.now();
    fetchImpl = () => okJson({ reviews: [
      { id: 'r_n2', name: 'Second', rating: 4, text: 'newer', createdAt: now },
      { id: 'r_n1', name: 'First', rating: 5, text: 'older', createdAt: now - 1000 },
    ] });
    UI.renderReviews();
    await tick(); await tick();
    const cards = nid('#revList').children.filter((c) => c.tag === 'article');
    assert.strictEqual(cards.length, 2, 'both reviews rendered');
    const texts = textsUnder(nid('#revList'));
    assert.ok(texts.indexOf('Second') >= 0 && texts.indexOf('First') >= 0, 'names rendered as text');
  });

  await t('14. form stays usable across sign-in/out (no refresh needed)', async () => {
    clearStore(); // signed out
    UI.renderReviews();
    await tick();
    assert.strictEqual(nid('#revName').disabled, false, 'guest usable');
    seedSignedIn(); // signed in, same open page
    UI.renderReviews();
    await tick();
    assert.strictEqual(nid('#revName').disabled, false, 'signed-in usable');
    assert.strictEqual(nid('#revForm')._submitBtn.disabled, false, 'submit clickable in both states');
  });

  console.log('[ux-test] ALL ' + pass + ' TESTS PASSED');
}

run().catch((e) => {
  console.error('[ux-test] FAILED:', e && e.message);
  process.exit(1);
});
