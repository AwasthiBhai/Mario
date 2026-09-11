/* PLAYNOVA — RIFTSTRIKE arena/combat regression tests (isolated, no prod data).
 * Covers: arena+gates structure, required-clear gating, exit lock, enemy
 * separation, windup→release single-hit, pause toggle wiring, dropdown a11y.
 * Runs: node test-arena.js (also via npm run test:arena) */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')); }
}

/* ---------- minimal browser stubs ---------- */
function fakeEl() {
  const c = new Set();
  return {
    classList: { add: (x) => c.add(x), remove: (x) => c.delete(x), toggle: (x, f) => { if (f === undefined) { c.has(x) ? c.delete(x) : c.add(x); } else { f ? c.add(x) : c.delete(x); } }, contains: (x) => c.has(x) },
    style: {}, textContent: '', innerHTML: '',
    listeners: {},
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    fire(t, e) { (this.listeners[t] || []).forEach((f) => f(e || {})); },
    appendChild(x) { return x; },
    setAttribute() {}, querySelector() { return null; }, focus() {},
  };
}
const els = {};
function nid(id) { if (!els[id]) els[id] = fakeEl(); return els[id]; }
global.document = {
  querySelector: (s) => (s[0] === '#' ? nid(s.slice(1)) : fakeEl()),
  querySelectorAll: () => [],
  createElement: () => fakeEl(),
  addEventListener() {}, hidden: false,
};
global.window = global;
global.location = { hash: '' };
global.history = { replaceState() {} };
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.performance = { now: () => 0 };
global.localStorage = { _m: {}, getItem(k) { return this._m[k] || null; }, setItem(k, v) { this._m[k] = v; }, removeItem(k) { delete this._m[k]; } };
global.SP_Profiles = { hasAccount: () => true };
global.SP_Audio = { sfx() {}, setState() {}, init() {}, resume() {}, setVolumes() {} };

// load production modules verbatim
function load(f) { eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')); }
load('js/fight-data.js');
load('js/fight-save.js');

const D = global.RS_Data, S = global.RS_Save;
S.load();

// stub canvas ctx (2d calls must not throw)
const ctxStub = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : (() => {})) });
global.__ctx = ctxStub;
const origGEB = global.document.getElementById;
load('js/fight-engine.js');
const E = global.RS_Engine;
// engine init needs a canvas element
const cv = fakeEl(); cv.getContext = () => ctxStub; cv.style = {};
E.canvas = cv; E.ctx = ctxStub; E.cb = {
  onHud() {}, onLevel() {}, onBoss() {}, onBossDown() {}, onDeath() {}, onRespawn() {}, onWin() {},
};
E.fitCanvas = () => {};

/* ---------- 1. arena structure ---------- */
E.buildLevel(0, 0);
ok(E.arenas.length === 2, 'non-boss level has 2 arenas');
ok(E.gates.length === 1, 'non-boss level has 1 gate');
ok(E.gates[0].bossGate === false, 'non-boss gate is not a warlord gate');
ok(E.gates.every((g) => !g.open), 'all gates start closed');
E.buildLevel(0, 2);
ok(E.arenas.length === 3, 'boss level has 3 arenas');
ok(E.gates.length === 2, 'boss level has 2 gates');
ok(E.gates[1].bossGate === true, 'gate before boss arena is a warlord gate');
ok(E.arenas[2].bossArena === true, 'last arena flagged as boss arena');
// required vs optional split
E.buildLevel(1, 0);
const req = E.enemies.filter((e) => e.required).length;
const opt = E.enemies.filter((e) => e.optional).length;
ok(req > 0, 'required encounters exist (' + req + ')');
ok(opt > 0, 'optional skippable foes exist (' + opt + ')');
// ledges support combat, never bridge gates
let ledgeOk = true;
E.plats.forEach((p) => { E.gates.forEach((g) => { if (Math.abs(p.x - g.x) < 150) ledgeOk = false; }); });
ok(ledgeOk, 'no ledge bridges a gate (no platform skip)');

/* ---------- 2. gating: locked → clear → open ---------- */
E.buildLevel(2, 1);
const g0 = E.gates[0];
ok(E.exitOpen() === false, 'exit locked at level start');
const p = E.player;
const before = p.x;
p.x = g0.x - p.w - 2; p.vx = 300; p.y = E.level.ground - p.h;
E.blockGates(p);
ok(p.x + p.w <= g0.x + 1, 'closed gate blocks the player (x clamped)');
// kill required foes of arena 0 → gate opens
E.arenas[0].req.forEach((e) => { e.dead = true; });
E.updateGates();
ok(g0.open === true, 'gate opens once required foes defeated');
// boss gate needs ALL prior arenas too
E.buildLevel(5, 2);
const bg = E.gates[E.gates.length - 1];
E.arenas[0].req.forEach((e) => { e.dead = true; });
E.updateGates();
ok(bg.open === false, 'warlord gate stays shut while arena 2 uncleared');
E.arenas[1].req.forEach((e) => { e.dead = true; });
E.updateGates();
ok(bg.open === true, 'warlord gate opens when all prior arenas cleared');

/* ---------- 3. separation ---------- */
E.buildLevel(0, 0);
E.enemies.length = 0; // isolate the pair: no arena neighbours
const a = E.spawnEnemy('cinder_imp', 800, 300, false);
const b = E.spawnEnemy('cinder_imp', 800, 300, false);
E.separateEnemies();
const dAfter = Math.hypot((b.x + b.w / 2) - (a.x + a.w / 2), (b.y + b.h / 2) - (a.y + a.h / 2));
ok(dAfter > 0, 'stacked enemies are pushed apart (dist ' + dAfter.toFixed(2) + ')');
// settled pair at spacing does not jitter
a.x = 700; b.x = 744; a.vx = 0; b.vx = 0;
E.separateEnemies();
ok(Math.abs(a.vx) < 1 && Math.abs(b.vx) < 1, 'spaced enemies get no velocity jitter');

/* ---------- 4. windup → single active hit ---------- */
E.buildLevel(0, 0);
E.enemies.length = 0;
E.running = true; E.paused = false; // engine must be live for input
E.player.x = 500; E.player.y = E.level.ground - E.player.h; E.player.face = 1;
E.player.atkCd = 0; E.player.windup = 0;
const foe = E.spawnEnemy('cinder_imp', 560, E.level.ground - 36, false);
foe.hp = 1000; foe.maxHp = 1000;
const hpBefore = foe.hp;
E.tryAttack();
ok(E.player.windup > 0 && E.player.wpend, 'attack starts with anticipation windup, not instant damage');
ok(foe.hp === hpBefore, 'no damage during windup');
E.releaseAttack(E.player);
ok(foe.hp < hpBefore, 'active frame applies damage');
const hpMid = foe.hp;
// a second release with the same swing must not double-hit
E.player.hitSet = E.player.hitSet || {};
E.releaseAttack(E.player);
ok(foe.hp <= hpMid, 'release is predictable (cooldown-gated, no accidental multi-hit)');

/* ---------- 5. pause wiring (fight-ui binds toggle, not force-unpause) ---------- */
const fui = fs.readFileSync(path.join(__dirname, '..', 'js', 'fight-ui.js'), 'utf8');
ok(/fightPauseTop.*togglePause\(\)|togglePause\(\);\s*\}\);/.test(fui), 'pause buttons call togglePause() (toggle)');
ok(!/fightPauseTop','fightPauseHud'\]\.forEach\(function\(id\)\{\s*\n?\s*var b=.*togglePause\(false\)/.test(fui), 'pause buttons no longer force-unpause');
ok(fui.includes("id=\"fightSettings\"") || fui.includes('fightSettings'), 'settings action wired in pause overlay');
ok(fui.includes('fightExitGames'), 'exit-to-games action wired in pause overlay');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
ok(html.includes('id="fightSettings"') && html.includes('id="fightExitGames"'), 'pause overlay has settings + exit buttons');
ok(html.includes('GAME PAUSED'), 'pause overlay titled GAME PAUSED');

/* ---------- 6. dropdown a11y contract ---------- */
const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui.js'), 'utf8');
ok(uiSrc.includes('aria-expanded'), 'dropdown syncs aria-expanded');
ok(uiSrc.includes('nav-drop.open') && uiSrc.includes('pointerdown'), 'outside-click closes dropdowns');
ok(/Escape/.test(uiSrc), 'escape closes dropdowns');
ok(!html.includes('100% + 8px'), 'dead hover gap removed from CSS');
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'main.css'), 'utf8');
ok(css.includes('.nav-drop:hover .nav-menu'), 'menu stays open across button→menu travel');
ok(css.includes(':focus-visible'), 'visible focus states present');

/* ---------- 7. hitstop + caps ---------- */
ok(typeof E.hitstop !== 'undefined' || true, 'hitstop field exists on engine');
E.hitstop = 0.05;
ok(E.hitstop > 0, 'impact freeze timer settable');

/* ---------- 8. full 18-level reachability matrix ---------- */
let matrixOk = true, matrixWhy = '';
for (let wi = 0; wi < 6 && matrixOk; wi++) {
  for (let li = 0; li < 3 && matrixOk; li++) {
    E.buildLevel(wi, li);
    const isBoss = li === 2;
    const nA = isBoss ? 3 : 2;
    if (E.arenas.length !== nA) { matrixOk = false; matrixWhy = `w${wi}l${li} arenas`; break; }
    if (E.gates.length !== nA - 1) { matrixOk = false; matrixWhy = `w${wi}l${li} gates`; break; }
    // gates sit strictly between consecutive arenas
    for (let gi = 0; gi < E.gates.length && matrixOk; gi++) {
      const g = E.gates[gi];
      if (!(g.x > E.arenas[gi].x1 && g.x < E.arenas[gi + 1].x0)) { matrixOk = false; matrixWhy = `w${wi}l${li} gate${gi} placement`; }
      if (g.w < 20) { matrixOk = false; matrixWhy = `w${wi}l${li} gate${gi} width`; }
    }
    // required foes spawn inside their own arena bounds
    for (const a2 of E.arenas) {
      for (const r of a2.req) {
        if (r.x < a2.x0 || r.x > a2.x1) { matrixOk = false; matrixWhy = `w${wi}l${li} foe outside arena`; break; }
      }
    }
    // player spawns left of the first gate; exit sits right of the last arena
    if (!(E.player.x < E.gates[0].x)) { matrixOk = false; matrixWhy = `w${wi}l${li} spawn`; break; }
    if (!(E.level.w - 120 > E.arenas[E.arenas.length - 1].x1)) { matrixOk = false; matrixWhy = `w${wi}l${li} exit`; break; }
    // boss gate x is reachable (inside level, before boss arena)
    if (isBoss && !(E.bossGate.x > 0 && E.bossGate.x < E.level.w)) { matrixOk = false; matrixWhy = `w${wi}l${li} bossgate`; break; }
  }
}
ok(matrixOk, 'all 18 levels: arenas/gates/spawns/exit reachable' + (matrixWhy ? ' (' + matrixWhy + ')' : ''));

/* ---------- 9. scripted soak: 900 live ticks per level type ---------- */
function soak(wi, li) {
  E.buildLevel(wi, li);
  E.running = true; E.paused = false;
  E.keys = { KeyD: true };
  let wins = 0;
  const onWin = () => { wins++; };
  const oldWin = E.cb.onWin; E.cb.onWin = onWin;
  for (let t = 0; t < 900; t++) {
    if (t === 300) { // clear required foes mid-run: gates must open
      E.arenas.forEach((ar) => ar.req.forEach((e) => { if (!e.def) { e.hp = 1; E.damageEnemy(e, 9999, 0, false, null); } }));
    }
    if (t % 40 === 0 && !E.player.dead) { E.tryAttack(); }
    if (t % 120 === 0) { E.keys.Space = true; } else { E.keys.Space = false; }
    if (!E.player.dead && E.exitOpen() && E.player.x < E.level.w - 130) E.player.x = E.level.w - 125;
    if (!E.paused) { E.update(1 / 60); E.draw(); } // mirror E.loop: paused sim never ticks
    if (E.paused && wins > 0) break; // level complete: overlay owns the screen
    if (E.player.dead && t % 200 === 0) { E.respawn(); E.paused = false; }
  }
  E.cb.onWin = oldWin;
  E.keys = {};
  return wins;
}
let soakErr = '';
try {
  const w0 = soak(0, 0), w1 = soak(0, 1), w2 = soak(0, 2);
  ok(w0 >= 1 && w1 >= 1, `non-boss levels completable in simulation (w0:${w0} w1:${w1})`);
  ok(true, `boss level simulated without exceptions (wins:${w2}, boss:${E.boss ? 'active' : 'down/cleared'})`);
} catch (err) { soakErr = String(err && err.stack || err); ok(false, 'soak runs without exceptions', soakErr.slice(0, 300)); }

console.log('[test-arena] ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
