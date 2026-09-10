/* STARBOUND — Global Profiles + Leaderboard: secure-backend client.
   ---------------------------------------------------------------------------
   ARCHITECTURE: Frontend → {API_BASE}/api/profiles…|/api/auth/… → backend → MantleDB.
   The browser NEVER contacts the database directly and holds no private
   credentials — only the public backend URL (js/api-config.js) plus the
   owner's own credentials (this device only):
     - legacy 256-bit edit secret (pre-password devices), and/or
     - password-session token minted by POST /api/auth/signup|signin.
   Passwords are sent ONLY over HTTPS to the Render API and verified ONLY
   there (scrypt+pepper); this file never hashes, verifies, or stores
   passwords — it only collects them from form fields and POSTs them.

   Every method that touches the network NEVER throws: results resolve to
   {ok:true,...} / {ok:false,error} so gameplay can never break when the
   backend is unreachable. localStorage holds ONLY the owner's session, a
   read cache, and an offline outbox — never the source of truth.

   PRIVACY CONTRACT: public endpoints return ONLY public fields
   (id, name, avatar, totals, per-level bests). privateId / secretHash /
   runIds are stripped SERVER-side — this client never sees another
   player's private data at all (there is nothing left to filter here).

   IDENTITY: the 256-bit edit secret lives ONLY in the owner's localStorage
   session and is sent back ONLY to authenticate that owner's own writes.
   The backend verifies sha256(secret) === stored secretHash (timing-safe)
   before ANY mutation and never returns the hash to any browser.

   MERGE RULES (server-side recordCompletion): score/coins max-wins,
   attempts += Δ, best-time min-wins, lifetime coins += run Δ once per runId.
   A worse score or slower time NEVER overwrites a better record.

   RANKING (deterministic, public info only):
     1. totalScore (Σ of per-level highest scores) — descending
     2. levelsCompleted — descending
     3. totalCoins (lifetime) — descending
     4. createdAt — ascending (earlier achievement wins ties)
     5. public id — ascending (final deterministic tiebreak) */
(function(global){
  'use strict';

  /* ---------------- limits (client pre-checks; backend re-validates) ---- */
  var MAX_USERS = 300;            // doc-size safety for the shared document
  var MAX_NAME = 24;              // display-name length
  var MAX_PID = 20, MIN_PID = 3;  // private-ID length
  var MAX_LEVEL = 50;
  var MAX_SCORE = 100000;         // per-level sanity cap (see engine: typical bests < 20k)
  var MAX_COINS_RUN = 500;        // per-run coin sanity cap (levels hold < ~120 coins)
  var MAX_TIME_S = 3600;          // best-time sanity cap (par limits are ≤ 420s)
  var MAX_RUNS = 40;              // idempotency ring per user
  var MAX_OUTBOX = 50;
  var FETCH_TIMEOUT_MS = 12000;
  var SESSION_KEY = 'starboundProfileSessionV1';
  var AUTH_KEY = 'starboundAuthSessionV1';
  var CACHE_KEY = 'starboundProfilesCacheV1';
  var OUTBOX_KEY = 'starboundProfileOutboxV1';
  var RESET_VERSION = 1;
  var MIN_PASSWORD = 8, MAX_PASSWORD = 256;
  var SIGNIN_GENERIC = 'The sign-in details are incorrect.';

  function apiBase(){
    try{
      if(global.SP_ApiConfig && typeof global.SP_ApiConfig.getBase === 'function'){
        var b = global.SP_ApiConfig.getBase();
        if(typeof b === 'string' && b) return b.replace(/\/$/, '');
      }
    }catch(e){}
    return '';
  }

  /* ---------------- tiny pure-JS SHA-256 (deterministic on every device,
     including file:// where SubtleCrypto may be missing). Kept for the
     ownership test seam; the backend performs authoritative verification. */
  function sha256hex(ascii){
    function rr(v,a){ return (v>>>a)|(v<<(32-a)); }
    var maxWord = Math.pow(2,32), result = '';
    var words = [], bitLen = ascii.length * 8;
    var hash = sha256hex.h = sha256hex.h || [], k = sha256hex.k = sha256hex.k || [];
    var primeCounter = k.length, isComposite = {};
    for(var candidate = 2; primeCounter < 64; candidate++){
      if(!isComposite[candidate]){
        for(var i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(candidate, 1/3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while(ascii.length % 64 - 56) ascii += '\x00';
    for(var i2 = 0; i2 < ascii.length; i2++){
      var j = ascii.charCodeAt(i2);
      if(j >> 8) return sha256hex(unescape(encodeURIComponent(ascii.slice(0, i2))) + '');
      words[i2 >> 2] |= j << ((3 - i2) % 4) * 8;
    }
    words[words.length] = (bitLen / maxWord) | 0;
    words[words.length] = bitLen;
    for(var j2 = 0; j2 < words.length;){
      var w = words.slice(j2, j2 += 16), oldHash = hash;
      hash = hash.slice(0, 8);
      for(var i3 = 0; i3 < 64; i3++){
        var w15 = w[i3 - 15], w2 = w[i3 - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7]
          + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i3]
          + (w[i3] = (i3 < 16) ? w[i3] : (w[i3 - 16]
            + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3))
            + w[i3 - 7]
            + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for(var i4 = 0; i4 < 8; i4++) hash[i4] = (hash[i4] + oldHash[i4]) | 0;
    }
    for(var i5 = 0; i5 < 8; i5++){
      for(var j3 = 3; j3 + 1; j3--){
        var b = (hash[i5] >> (j3 * 8)) & 255;
        result += ((b < 16) ? '0' : '') + b.toString(16);
      }
    }
    return result;
  }

  function randHex(nBytes){
    try{
      if(global.crypto && global.crypto.getRandomValues){
        var b = new Uint8Array(nBytes);
        global.crypto.getRandomValues(b);
        return Array.from(b).map(function(x){ return x.toString(16).padStart(2, '0'); }).join('');
      }
    }catch(e){}
    var s = '';
    while(s.length < nBytes * 2) s += Math.floor(Math.random() * 0xffffffff).toString(16);
    return s.slice(0, nBytes * 2);
  }

  /* ---------------- validation (client pre-checks; backend re-validates) */
  var PID_RE = /^[a-z0-9._-]+$/i;

  function cleanName(name){
    return String(name == null ? '' : name).replace(/[\u0000-\u001F\u007F]/g, '').trim().replace(/\s+/g, ' ');
  }

  function validateName(name){
    name = cleanName(name);
    if(!name) return { ok: false, error: 'Please enter a display name.' };
    if(name.length > MAX_NAME) return { ok: false, error: 'Display name must be ' + MAX_NAME + ' characters or fewer.' };
    return { ok: true, value: name };
  }

  function validatePrivateId(pid){
    pid = String(pid == null ? '' : pid).trim();
    if(!pid) return { ok: false, error: 'Please choose a private player ID.' };
    if(pid.length < MIN_PID || pid.length > MAX_PID)
      return { ok: false, error: 'Player ID must be ' + MIN_PID + '–' + MAX_PID + ' characters.' };
    if(!PID_RE.test(pid))
      return { ok: false, error: 'Player ID may only use letters, numbers, dot, underscore or hyphen (no spaces).' };
    return { ok: true, value: pid };
  }

  function isPresetAvatar(a){
    return typeof a === 'string' && !!(global.SP_Avatars && global.SP_Avatars.isPreset(a));
  }

  function isCustomAvatar(a){
    if(!a || typeof a !== 'object' || typeof a.custom !== 'string') return false;
    var s = a.custom;
    if(s.length > 9200) return false; // constrained: no huge Base64 blobs in the DB
    return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
  }

  function validateAvatar(a){
    if(isPresetAvatar(a)) return { ok: true, value: a };
    if(isCustomAvatar(a)) return { ok: true, value: { custom: a.custom } };
    return { ok: false, error: 'Please choose a profile icon.' };
  }

  /* Passwords are collected here and POSTed to the backend ONLY. They are
   * never hashed, verified, or stored by this file (see header). */
  function validatePassword(pw){
    if(typeof pw !== 'string' || !pw || !pw.trim()) return { ok: false, error: 'Please choose a password.' };
    if(pw.length < MIN_PASSWORD) return { ok: false, error: 'Password must be at least ' + MIN_PASSWORD + ' characters.' };
    if(pw.length > MAX_PASSWORD) return { ok: false, error: 'Password must be ' + MAX_PASSWORD + ' characters or fewer.' };
    return { ok: true, value: pw };
  }

  /* ---------------- sanitizers (cache + test seams) --------------------- */
  function num(v, lo, hi, fb){
    v = Number(v);
    if(!isFinite(v)) return fb;
    v = Math.floor(v);
    if(v < lo) return lo;
    if(v > hi) return hi;
    return v;
  }

  function sanitizeLevelRow(r){
    if(!r || typeof r !== 'object') return null;
    var s = num(r.s, 0, MAX_SCORE, 0);
    var c = num(r.c, 0, MAX_COINS_RUN, 0);
    var a = num(r.a, 0, 1000000, 0);
    var t = Number(r.t);
    t = (isFinite(t) && t > 0 && t <= MAX_TIME_S) ? Math.round(t * 10) / 10 : 0;
    if(!s && !c && !a && !t) return null;
    return { s: s, c: c, a: a, t: t };
  }

  function sanitizeAvatar(a, fb){
    if(typeof a === 'string' && global.SP_Avatars && global.SP_Avatars.isPreset(a)) return a;
    if(isCustomAvatar(a)) return { custom: a.custom };
    return fb;
  }

  function sanitizeLevels(raw){
    var levels = {};
    if(raw && typeof raw === 'object'){
      for(var k in raw){
        var n = parseInt(k, 10);
        if(!(n >= 1 && n <= MAX_LEVEL)) continue;
        var row = sanitizeLevelRow(raw[k]);
        if(row) levels[String(n)] = row;
      }
    }
    return levels;
  }

  function sanitizeUser(u){
    if(!u || typeof u !== 'object') return null;
    var id = String(u.id || '');
    if(!/^p_[a-z0-9_]+$/i.test(id) || id.length > 64) return null;
    var name = cleanName(u.name).slice(0, MAX_NAME);
    var pid = String(u.privateId == null ? '' : u.privateId).trim().slice(0, MAX_PID);
    if(!name || !PID_RE.test(pid)) return null;
    var runs = Array.isArray(u.runs) ? u.runs.filter(function(r){ return typeof r === 'string' && r.length <= 64; }).slice(-MAX_RUNS) : [];
    return {
      id: id,
      privateId: pid,
      name: name,
      avatar: sanitizeAvatar(u.avatar, 'nova-star'),
      secretHash: /^[0-9a-f]{64}$/.test(String(u.secretHash || '')) ? String(u.secretHash) : '',
      createdAt: num(u.createdAt, 1, 9e15, Date.now()),
      updatedAt: num(u.updatedAt, 1, 9e15, Date.now()),
      seenAt: num(u.seenAt, 0, 9e15, 0),
      totalCoins: num(u.totalCoins, 0, 50000000, 0),
      levels: sanitizeLevels(u.levels),
      runs: runs
    };
  }

  function sanitizeDoc(doc){
    if(!doc || typeof doc !== 'object') return { v: 1, resetVersion: 0, users: [] };
    var arr = Array.isArray(doc.users) ? doc.users : [];
    var seen = {}, out = [];
    for(var i = 0; i < arr.length && out.length < MAX_USERS; i++){
      var u = sanitizeUser(arr[i]);
      if(!u || seen[u.id]) continue;
      seen[u.id] = true;
      out.push(u);
    }
    var rv = Math.floor(Number(doc.resetVersion));
    if(!isFinite(rv) || rv < 0 || rv > 99) rv = 0;
    return { v: 1, resetVersion: rv, users: out };
  }

  /* Cached PUBLIC entry (what /api/profiles returns): no private fields by
     construction — there is nothing here to strip. */
  function sanitizePublicCached(u){
    if(!u || typeof u !== 'object') return null;
    var id = String(u.id || '');
    if(!/^p_[a-z0-9_]+$/i.test(id) || id.length > 64) return null;
    var name = cleanName(u.name).slice(0, MAX_NAME);
    if(!name) return null;
    return {
      id: id,
      name: name,
      avatar: sanitizeAvatar(u.avatar, 'nova-star'),
      createdAt: num(u.createdAt, 1, 9e15, Date.now()),
      updatedAt: num(u.updatedAt, 1, 9e15, Date.now()),
      totalCoins: num(u.totalCoins, 0, 50000000, 0),
      levels: sanitizeLevels(u.levels)
    };
  }

  /* Cached OWNER entry (what /api/profiles/me returns): includes the
     owner's privateId, never a secretHash (the backend never sends one). */
  function sanitizeOwnerCached(u){
    var p = sanitizePublicCached(u);
    if(!p) return null;
    var pid = String(u.privateId == null ? '' : u.privateId).trim().slice(0, MAX_PID);
    if(!pid || !PID_RE.test(pid)) return null;
    p.privateId = pid;
    p.seenAt = num(u.seenAt, 0, 9e15, 0);
    p.hasPassword = !!u.hasPassword;
    return p;
  }

  function sanitizeCachedDoc(doc){
    if(!doc || typeof doc !== 'object') return { v: 1, resetVersion: 0, users: [], me: null };
    var arr = Array.isArray(doc.users) ? doc.users : [];
    var seen = {}, out = [];
    for(var i = 0; i < arr.length && out.length < MAX_USERS; i++){
      var u = sanitizePublicCached(arr[i]);
      if(!u || seen[u.id]) continue;
      seen[u.id] = true;
      out.push(u);
    }
    return { v: 1, resetVersion: 0, users: out, me: sanitizeOwnerCached(doc.me) };
  }

  /* PUBLIC projection: strips privateId/seenAt from any owner-shaped record
     (defense in depth — server responses are already public-only). */
  function toPublic(u){
    if(!u || typeof u !== 'object') return null;
    var p = sanitizePublicCached(u);
    if(!p) return null;
    var lv = 0, score = 0;
    for(var k in p.levels){ lv++; score += p.levels[k].s; }
    p.levelsCompleted = lv;
    p.totalScore = score;
    return p;
  }

  /* PUBLIC shape: the ONLY representation of another player the product
     ever uses. Never contains privateId, secretHash or runIds. */
  function publicUser(u){
    if(!u || typeof u !== 'object') return null;
    // Full internal records (tests / legacy) carry private fields — strip.
    if(u.privateId !== undefined || u.secretHash !== undefined || u.runs !== undefined){
      u = sanitizeUser(u);
      if(!u) return null;
      var lv = 0, score = 0;
      for(var k in u.levels){ lv++; score += u.levels[k].s; }
      return {
        id: u.id,
        name: u.name,
        avatar: u.avatar,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
        totalCoins: u.totalCoins,
        levelsCompleted: lv,
        totalScore: score,
        levels: u.levels
      };
    }
    return toPublic(u);
  }

  function totalsOf(u){
    var lv = 0, score = 0, coins = 0, attempts = 0;
    for(var k in (u.levels || {})){ lv++; score += u.levels[k].s || 0; coins += u.levels[k].c || 0; attempts += u.levels[k].a || 0; }
    return { levelsCompleted: lv, totalScore: score, bestCoinsSum: coins, attempts: attempts };
  }

  /* RANKING — deterministic, public info only (see header comment). */
  function rowTotals(p){
    if(p && typeof p.levelsCompleted === 'number' && typeof p.totalScore === 'number'){
      return { levelsCompleted: p.levelsCompleted, totalScore: p.totalScore,
        totalCoins: p.totalCoins || 0, createdAt: p.createdAt || 0, id: p.id };
    }
    var t = totalsOf({ levels: (p && p.levels) || {} });
    return { levelsCompleted: t.levelsCompleted, totalScore: t.totalScore,
      totalCoins: (p && p.totalCoins) || 0, createdAt: (p && p.createdAt) || 0, id: (p && p.id) || '' };
  }
  function compareRanked(a, b){
    var ta = rowTotals(a), tb = rowTotals(b);
    if(tb.totalScore !== ta.totalScore) return tb.totalScore - ta.totalScore;
    if(tb.levelsCompleted !== ta.levelsCompleted) return tb.levelsCompleted - ta.levelsCompleted;
    if(tb.totalCoins !== ta.totalCoins) return tb.totalCoins - ta.totalCoins;
    if(ta.createdAt !== tb.createdAt) return ta.createdAt - tb.createdAt;
    return ta.id < tb.id ? -1 : (ta.id > tb.id ? 1 : 0);
  }

  /* ---------------- network (secure backend API) ------------------------ */
  function fetchJson(pathname, opts){
    opts = opts || {};
    var base = apiBase();
    if(!base) return Promise.reject(Object.assign(new Error('not configured'), { status: 404 }));
    var controller = null, timer = null;
    try{
      if(typeof AbortController !== 'undefined'){
        controller = new AbortController();
        timer = setTimeout(function(){ try{ controller.abort(); }catch(e){} }, FETCH_TIMEOUT_MS);
      }
    }catch(e){ controller = null; }
    var f = global.fetch;
    if(typeof f !== 'function') return Promise.reject(Object.assign(new Error('Network unavailable'), { network: true }));
    var headers = { 'Content-Type': 'application/json' };
    if(opts.secret) headers['X-Profile-Secret'] = opts.secret;
    if(opts.token){
      headers['Authorization'] = 'Bearer ' + opts.token;
      headers['X-Session-Token'] = opts.token;
    }
    var p = f(base + pathname, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      mode: 'cors',
      signal: controller ? controller.signal : undefined
    }).then(function(res){
      if(timer) clearTimeout(timer);
      return res.text().then(function(txt){
        var data = null;
        try{ data = txt ? JSON.parse(txt) : null; }catch(e){ data = null; }
        if(!res.ok){
          var err = new Error('Request failed (' + res.status + ')');
          err.status = res.status; err.data = data;
          var msg = data && data.error ? String(data.error) : '';
          if(msg) err.message = msg;
          throw err;
        }
        return data;
      });
    }, function(netErr){
      if(timer) clearTimeout(timer);
      var err = new Error('Network unavailable');
      err.network = true; err.cause = netErr;
      throw err;
    });
    return p;
  }

  function friendlyError(err, what){
    what = what || 'profiles';
    if(!err) return 'Something went wrong. Please try again.';
    if(err.network) return 'Could not reach the profile server. Check your connection and try again.';
    if(err.status === 429) return 'The profile server is busy. Please wait a moment and try again.';
    if(err.status === 413) return 'Profile storage is full right now. Please try again later.';
    if(err.status === 401 || err.status === 403) return 'Profile sync is temporarily blocked. Please try again later.';
    if(err.status === 404 && what === 'load') return 'Unable to load profiles. Please try again.';
    if(err.status >= 500 && err.status <= 599) return 'The profile server had a hiccup. Please try again.';
    if(err.name === 'AbortError' || (err.cause && err.cause.name === 'AbortError')) return 'The profile server took too long. Please try again.';
    if(err.message && !/^Request failed/.test(err.message)) return err.message;
    return 'Could not ' + (what === 'load' ? 'load profiles' : 'save your profile') + ' right now. Please try again.';
  }

  function retriable(err){
    return !!(err && (err.network || err.status === 429 || (err.status >= 500 && err.status <= 599)));
  }

  /* ---------------- sessions: legacy secret + password sessions --------
     Legacy device secrets keep existing devices working. Password sessions
     (opaque tokens from /api/auth/signup|signin) allow sign-out then
     sign-in on ANY device and recovery of the SAME account + progress.
     Signing out only clears local state (+ revokes the token server-side);
     cloud data is never deleted. */
  function loadSession(){
    try{
      var raw = global.localStorage && global.localStorage.getItem(SESSION_KEY);
      if(!raw) return null;
      var s = JSON.parse(raw);
      if(!s || typeof s.id !== 'string' || typeof s.secret !== 'string') return null;
      if(!/^p_[a-z0-9_]+$/i.test(s.id) || !/^[0-9a-f]{64}$/i.test(s.secret)) return null;
      return { id: s.id, secret: s.secret.toLowerCase(), privateId: String(s.privateId || '') };
    }catch(e){ return null; }
  }
  function saveSession(s){
    try{ if(global.localStorage) global.localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }catch(e){}
  }
  function clearSession(){
    try{ if(global.localStorage) global.localStorage.removeItem(SESSION_KEY); }catch(e){}
  }
  function loadAuth(){
    try{
      var raw = global.localStorage && global.localStorage.getItem(AUTH_KEY);
      if(!raw) return null;
      var s = JSON.parse(raw);
      if(!s || typeof s.id !== 'string' || typeof s.token !== 'string') return null;
      if(!/^p_[a-z0-9_]+$/i.test(s.id) || !/^[0-9a-f]{64}$/i.test(s.token)) return null;
      return { id: s.id, token: s.token.toLowerCase(), expiresAt: Number(s.expiresAt) || 0 };
    }catch(e){ return null; }
  }
  function saveAuth(s){
    try{ if(global.localStorage) global.localStorage.setItem(AUTH_KEY, JSON.stringify(s)); }catch(e){}
  }
  function clearAuth(){
    try{ if(global.localStorage) global.localStorage.removeItem(AUTH_KEY); }catch(e){}
  }
  function authValid(a){
    if(!a) return false;
    if(a.expiresAt && a.expiresAt < Date.now()) return false;
    return true;
  }
  /* Local ownership check (test seam). Authoritative verification happens
     server-side; the client keeps this only for cached-shape tests. */
  function owns(session, user){
    if(!session || !user || !user.secretHash) return false;
    try{ return sha256hex(String(session.secret)) === String(user.secretHash).toLowerCase(); }
    catch(e){ return false; }
  }

  /* ---------------- cache + outbox (offline helpers, never truth) ------- */
  function readCache(){
    try{
      var raw = global.localStorage && global.localStorage.getItem(CACHE_KEY);
      if(!raw) return { at: 0, doc: null };
      var d = JSON.parse(raw);
      var doc = d.doc ? sanitizeCachedDoc(d.doc) : null;
      if(doc && !doc.me && !doc.users.length) doc = null;
      return { at: d.at || 0, doc: doc };
    }catch(e){ return { at: 0, doc: null }; }
  }
  function writeCache(doc){
    try{ if(global.localStorage) global.localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), doc: doc })); }catch(e){}
  }
  function readOutbox(){
    try{
      var raw = global.localStorage && global.localStorage.getItem(OUTBOX_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    }catch(e){ return []; }
  }
  function writeOutbox(arr){
    try{ if(global.localStorage) global.localStorage.setItem(OUTBOX_KEY, JSON.stringify(arr.slice(-MAX_OUTBOX))); }catch(e){}
  }
  function queueOp(op){
    var box = readOutbox();
    op.ts = Date.now(); op.tries = 0;
    box.push(op);
    writeOutbox(box);
  }

  /* ---------------- merge engine (pure, unit-testable mirrors of the
     server-side merge — used by tests; the backend applies them
     authoritatively on every completion/attempt write) ------------------- */
  function applyCompletion(user, level, data){
    level = Math.min(MAX_LEVEL, Math.max(1, parseInt(level, 10) || 0));
    if(!level) return { user: user, improved: false };
    var score = num(data.score, 0, MAX_SCORE, 0);
    var coins = num(data.coins, 0, MAX_COINS_RUN, 0);
    var t = Number(data.time);
    t = (isFinite(t) && t > 0 && t <= MAX_TIME_S) ? Math.round(t * 10) / 10 : 0;
    var runId = typeof data.runId === 'string' ? data.runId.slice(0, 64) : '';
    var row = user.levels[String(level)] || { s: 0, c: 0, a: 0, t: 0 };
    var improved = false;
    if(score > row.s){ row.s = score; improved = true; }       // max-wins
    if(coins > row.c){ row.c = coins; improved = true; }       // max-wins
    if(row.a < 1) row.a = 1;                                    // completion implies an attempt
    if(t > 0 && (row.t <= 0 || t < row.t)){ row.t = t; improved = true; } // min-wins
    user.levels[String(level)] = row;
    if(runId && user.runs.indexOf(runId) === -1){               // idempotent lifetime Δ
      user.runs.push(runId);
      if(user.runs.length > MAX_RUNS) user.runs = user.runs.slice(-MAX_RUNS);
      user.totalCoins = Math.min(50000000, user.totalCoins + coins);
      improved = true;
    }
    user.updatedAt = Date.now();
    user.seenAt = Date.now();
    return { user: user, improved: improved };
  }

  function applyAttempt(user, level){
    level = Math.min(MAX_LEVEL, Math.max(1, parseInt(level, 10) || 0));
    if(!level) return user;
    var row = user.levels[String(level)] || { s: 0, c: 0, a: 0, t: 0 };
    row.a = Math.min(1000000, row.a + 1);
    user.levels[String(level)] = row;
    user.seenAt = Date.now();
    return user;
  }

  function dropStatus(err){
    // 4xx (except 429) will never succeed on retry — drop instead of requeue.
    if(err && typeof err.status === 'number' && err.status >= 400 && err.status < 500 && err.status !== 429) return true;
    return false;
  }

  /* ================= public API ================= */
  var Profiles = {
    MAX_NAME: MAX_NAME, MAX_PID: MAX_PID, MIN_PID: MIN_PID, MAX_USERS: MAX_USERS,
    RESET_VERSION: RESET_VERSION,

    validateName: validateName,
    validatePrivateId: validatePrivateId,
    validateAvatar: validateAvatar,
    validatePassword: validatePassword,
    MIN_PASSWORD: MIN_PASSWORD,
    cleanName: cleanName,
    fmtTime: function(s){
      s = Math.max(0, Math.ceil(Number(s) || 0));
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    },

    /* ---- sessions (legacy device secret and/or password session) ---- */
    session: loadSession,
    authSession: function(){ var a = loadAuth(); return authValid(a) ? a : null; },
    hasAccount: function(){ return !!loadSession() || authValid(loadAuth()); },
    signOutThisDevice: function(){ clearSession(); clearAuth(); },

    /* Sign out: revoke the password session server-side (best-effort —
     * offline still clears local state), then drop all local credentials.
     * Cloud account + progress are never deleted. */
    signOut: function(){
      var a = loadAuth();
      var done = function(){ clearSession(); clearAuth(); return { ok: true }; };
      if(!a || !authValid(a)) return Promise.resolve(done());
      return fetchJson('/api/auth/signout', { method: 'POST', token: a.token, body: {} })
        .then(done, done);
    },

    /* ---- reads (always a genuine backend read; cache only on failure) -- */
    load: function(){
      var session = loadSession();
      var auth = loadAuth();
      if(auth && !authValid(auth)){ clearAuth(); auth = null; }
      var usersP = fetchJson('/api/profiles?limit=500', {});
      var meP;
      if(auth){
        meP = fetchJson('/api/auth/session', { token: auth.token })
          .then(function(r){ return (r && r.user) ? sanitizeOwnerCached(r.user) : null; })
          .catch(function(){ return null; });
      } else if(session){
        meP = fetchJson('/api/profiles/me?id=' + encodeURIComponent(session.id), { secret: session.secret })
          .then(function(r){ return (r && r.user) ? sanitizeOwnerCached(r.user) : null; })
          .catch(function(){ return null; });
      } else {
        meP = Promise.resolve(null);
      }
      return Promise.all([usersP, meP]).then(function(pair){
        var rawUsers = pair[0] && Array.isArray(pair[0].users) ? pair[0].users : [];
        var doc = sanitizeCachedDoc({ users: rawUsers, me: pair[1] });
        writeCache(doc);
        return { ok: true, doc: doc, stale: false, error: '' };
      }).catch(function(err){
        var cached = readCache();
        if(cached.doc){
          return { ok: true, doc: cached.doc, stale: true,
            error: friendlyError(err, 'load') + ' Showing the last saved copy.' };
        }
        return { ok: false, doc: null, stale: false, error: friendlyError(err, 'load') };
      });
    },

    /* Owner's record (includes privateId, never secretHash). The backend
     * verified the session before returning it. */
    me: function(doc){
      if(!doc || !doc.me) return null;
      var a = loadAuth();
      if(a && authValid(a) && doc.me.id === a.id) return doc.me;
      var s = loadSession();
      if(!s || doc.me.id !== s.id) return null;
      return doc.me;
    },

    myPublicId: function(){
      var a = loadAuth();
      if(a && authValid(a)) return a.id;
      var s = loadSession();
      return s ? s.id : null;
    },

    /* Public profile of ANY player (stripped server-side). Never exposes
       private data — public entries contain none by construction. */
    getPublic: function(doc, publicId){
      if(!doc || !publicId) return null;
      var list = Array.isArray(doc.users) ? doc.users : [];
      for(var i = 0; i < list.length; i++){
        if(list[i].id === publicId) return toPublic(list[i]);
      }
      if(doc.me && doc.me.id === publicId) return toPublic(doc.me);
      return null;
    },

    /* Global leaderboard: account holders who have played. Public only. */
    leaderboard: function(doc, limit){
      limit = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
      var rows = [];
      var list = doc ? doc.users : [];
      if(!Array.isArray(list)) list = [];
      for(var i = 0; i < list.length; i++){
        var p = toPublic(list[i]);
        if(!p || !Object.keys(p.levels).length) continue; // created AND played
        rows.push(p);
      }
      rows.sort(compareRanked);
      var out = [];
      for(var r = 0; r < rows.length && r < limit; r++){
        rows[r].rank = r + 1;
        out.push(rows[r]);
      }
      return out;
    },

    rankOf: function(doc, publicId){
      var rows = this.leaderboard(doc, MAX_USERS);
      for(var i = 0; i < rows.length; i++) if(rows[i].id === publicId) return rows[i].rank;
      return 0;
    },

    /* ---- account creation (legacy, no password — kept for backwards
     * compatibility; new accounts should use signUp with a password) ---- */
    createAccount: function(name, privateId, avatar){
      var vn = validateName(name);
      if(!vn.ok) return Promise.resolve({ ok: false, error: vn.error });
      var vp = validatePrivateId(privateId);
      if(!vp.ok) return Promise.resolve({ ok: false, error: vp.error });
      var va = validateAvatar(avatar);
      if(!va.ok) return Promise.resolve({ ok: false, error: va.error });
      return fetchJson('/api/profiles', {
        method: 'POST',
        body: { name: vn.value, privateId: vp.value, avatar: va.value }
      }).then(function(res){
        if(!res || !res.user || !res.secret) throw new Error('Server did not confirm the profile.');
        saveSession({ id: res.user.id, secret: String(res.secret).toLowerCase(), privateId: res.user.privateId });
        return { ok: true, user: sanitizeOwnerCached(res.user) };
      }).catch(function(err){
        var msg = (err && err.message && !/^Request failed/.test(err.message)) ? err.message : friendlyError(err, 'save');
        return { ok: false, error: msg };
      });
    },

    /* ---- password account creation (name + private ID + password) ----
     * The password is POSTed over HTTPS and verified ONLY server-side;
     * only the minted session token is stored locally. */
    signUp: function(name, privateId, avatar, password){
      var vn = validateName(name);
      if(!vn.ok) return Promise.resolve({ ok: false, error: vn.error });
      var vp = validatePrivateId(privateId);
      if(!vp.ok) return Promise.resolve({ ok: false, error: vp.error });
      var va = validateAvatar(avatar);
      if(!va.ok) return Promise.resolve({ ok: false, error: va.error });
      var vpw = validatePassword(password);
      if(!vpw.ok) return Promise.resolve({ ok: false, error: vpw.error });
      return fetchJson('/api/auth/signup', {
        method: 'POST',
        body: { name: vn.value, privateId: vp.value, avatar: va.value, password: vpw.value }
      }).then(function(res){
        if(!res || !res.user || !res.sessionToken) throw new Error('Server did not confirm the profile.');
        if(res.secret) saveSession({ id: res.user.id, secret: String(res.secret).toLowerCase(), privateId: res.user.privateId });
        saveAuth({ id: res.user.id, token: String(res.sessionToken).toLowerCase(), expiresAt: Number(res.expiresAt) || 0 });
        return { ok: true, user: sanitizeOwnerCached(res.user) };
      }).catch(function(err){
        var msg = (err && err.message && !/^Request failed/.test(err.message)) ? err.message : friendlyError(err, 'save');
        return { ok: false, error: msg };
      });
    },

    /* ---- sign in (name + private ID + password must ALL match) ----
     * Generic failures only: the server never reveals which field was
     * wrong, and neither do we. */
    signIn: function(name, privateId, password){
      name = cleanName(name);
      privateId = String(privateId == null ? '' : privateId).trim();
      if(!name || !privateId || typeof password !== 'string' || !password){
        return Promise.resolve({ ok: false, error: SIGNIN_GENERIC });
      }
      return fetchJson('/api/auth/signin', {
        method: 'POST',
        body: { name: name, privateId: privateId, password: password }
      }).then(function(res){
        if(!res || !res.user || !res.sessionToken) throw new Error(SIGNIN_GENERIC);
        saveAuth({ id: res.user.id, token: String(res.sessionToken).toLowerCase(), expiresAt: Number(res.expiresAt) || 0 });
        return { ok: true, user: sanitizeOwnerCached(res.user) };
      }).catch(function(err){
        if(err && (err.status === 401 || err.status === 400)) return { ok: false, error: SIGNIN_GENERIC };
        var msg = (err && err.message && !/^Request failed/.test(err.message)) ? err.message : friendlyError(err, 'save');
        return { ok: false, error: msg };
      });
    },

    /* ---- set/change the account password (owner only) ----
     * Pre-password accounts: pass only the new password (owner auth via
     * current session). Accounts with a password: currentPassword required. */
    setPassword: function(newPassword, currentPassword){
      var vpw = validatePassword(newPassword);
      if(!vpw.ok) return Promise.resolve({ ok: false, error: vpw.error });
      var a = loadAuth();
      if(a && !authValid(a)){ clearAuth(); a = null; }
      var s = loadSession();
      var id = (a && a.id) || (s && s.id);
      if(!id) return Promise.resolve({ ok: false, error: 'No account on this device.' });
      var body = { newPassword: vpw.value };
      if(currentPassword !== undefined) body.currentPassword = currentPassword;
      if(a) body.sessionToken = a.token;
      if(s) body.secret = s.secret;
      var opts = { method: 'POST', body: body };
      if(a) opts.token = a.token;
      if(s) opts.secret = s.secret;
      return fetchJson('/api/auth/set-password/' + encodeURIComponent(id), opts)
        .then(function(){ return { ok: true }; })
        .catch(function(err){
          var msg = (err && err.message && !/^Request failed/.test(err.message)) ? err.message : friendlyError(err, 'save');
          return { ok: false, error: msg };
        });
    },

    /* ---- owner edits (name / avatar / privateId). Ownership verified
       server-side from the session; forged ids fail with 403. --- */
    updateProfile: function(patch){
      var s = loadSession();
      var a = loadAuth();
      if(a && !authValid(a)){ clearAuth(); a = null; }
      if(!s && !a) return Promise.resolve({ ok: false, error: 'No account on this device.' });
      var session = s;
      var body = {};
      var opts = { method: 'PATCH', body: body };
      if(session){ body.secret = session.secret; opts.secret = session.secret; }
      if(a){ body.sessionToken = a.token; opts.token = a.token; }
      if(patch.name !== undefined){
        var vn = validateName(patch.name);
        if(!vn.ok) return Promise.resolve({ ok: false, error: vn.error });
        body.name = vn.value;
      }
      if(patch.avatar !== undefined){
        var va = validateAvatar(patch.avatar);
        if(!va.ok) return Promise.resolve({ ok: false, error: va.error });
        body.avatar = va.value;
      }
      if(patch.privateId !== undefined){
        var vp = validatePrivateId(patch.privateId);
        if(!vp.ok) return Promise.resolve({ ok: false, error: vp.error });
        body.privateId = vp.value;
      }
      var myId = (a && a.id) || (session && session.id);
      return fetchJson('/api/profiles/' + encodeURIComponent(myId), opts).then(function(res){
        if(!res || !res.user) throw new Error('Server did not confirm the profile.');
        var user = sanitizeOwnerCached(res.user);
        if(session) saveSession({ id: session.id, secret: session.secret, privateId: user ? user.privateId : session.privateId });
        return { ok: true, user: user };
      }).catch(function(err){
        var msg = (err && err.message && !/^Request failed/.test(err.message)) ? err.message : friendlyError(err, 'save');
        return { ok: false, error: msg };
      });
    },

    /* ---- gameplay sync (best-effort; game never waits on it) ------------ */
    recordAttempt: function(level){
      var s = loadSession();
      var a = loadAuth();
      if(a && !authValid(a)){ clearAuth(); a = null; }
      if(!s && !a) return Promise.resolve({ ok: false, error: 'no-account' });
      var myId = (a && a.id) || s.id;
      level = parseInt(level, 10);
      if(!(level >= 1 && level <= MAX_LEVEL)) return Promise.resolve({ ok: false, error: 'bad level' });
      var abody = { level: level };
      var aopts = { method: 'POST', body: abody };
      if(s){ abody.secret = s.secret; aopts.secret = s.secret; }
      if(a){ abody.sessionToken = a.token; aopts.token = a.token; }
      return fetchJson('/api/profiles/' + encodeURIComponent(myId) + '/attempt', aopts).then(function(){ return { ok: true }; })
        .catch(function(err){
          if(err && (err.status === 403 || err.status === 404)) return { ok: false, error: 'forbidden' };
          if(err && dropStatus(err)) return { ok: false, error: friendlyError(err, 'save') };
          queueOp({ op: 'attempt', level: level });
          return { ok: false, error: friendlyError(err, 'save'), queued: true };
        });
    },

    recordCompletion: function(level, data){
      var s = loadSession();
      var a = loadAuth();
      if(a && !authValid(a)){ clearAuth(); a = null; }
      if(!s && !a) return Promise.resolve({ ok: false, error: 'no-account' });
      var myId = (a && a.id) || s.id;
      data = data || {};
      level = parseInt(level, 10);
      var score = Number(data.score), coins = Number(data.coins), time = Number(data.time);
      if(!(level >= 1 && level <= MAX_LEVEL)) return Promise.resolve({ ok: false, error: 'bad level' });
      if(!isFinite(score) || score < 0 || score > MAX_SCORE) return Promise.resolve({ ok: false, error: 'bad score' });
      if(!isFinite(coins) || coins < 0 || coins > MAX_COINS_RUN) return Promise.resolve({ ok: false, error: 'bad coins' });
      if(!isFinite(time) || time <= 0 || time > MAX_TIME_S) return Promise.resolve({ ok: false, error: 'bad time' });
      var runId = typeof data.runId === 'string' ? data.runId.slice(0, 64) : '';
      var cbody = { level: level, score: Math.floor(score), coins: Math.floor(coins), time: time, runId: runId };
      var copts = { method: 'POST', body: cbody };
      if(s){ cbody.secret = s.secret; copts.secret = s.secret; }
      if(a){ cbody.sessionToken = a.token; copts.token = a.token; }
      return fetchJson('/api/profiles/' + encodeURIComponent(myId) + '/completion', copts).then(function(res){ return { ok: true, improved: !!(res && res.improved) }; })
        .catch(function(err){
          if(err && (err.status === 403 || err.status === 404)) return { ok: false, error: 'forbidden' };
          if(err && dropStatus(err)) return { ok: false, error: friendlyError(err, 'save') };
          queueOp({ op: 'complete', level: level, data: { score: score, coins: coins, time: time, runId: runId } });
          return { ok: false, error: friendlyError(err, 'save'), queued: true };
        });
    },

    /* Retry queued offline ops, oldest first. Never throws. Permanent
       4xx failures are dropped; network failures stay queued. */
    flushOutbox: function(){
      var s = loadSession();
      var a = loadAuth();
      if(a && !authValid(a)){ clearAuth(); a = null; }
      var box = readOutbox();
      if((!s && !a) || !box.length) return Promise.resolve({ ok: true, flushed: 0 });
      var myId = (a && a.id) || s.id;
      var remaining = [];
      var flushed = 0;
      var chain = Promise.resolve();
      function authedOpts(body){
        var o = { method: 'POST', body: body };
        if(s){ body.secret = s.secret; o.secret = s.secret; }
        if(a){ body.sessionToken = a.token; o.token = a.token; }
        return o;
      }
      box.forEach(function(item){
        chain = chain.then(function(){
          var p;
          if(item.op === 'attempt'){
            p = fetchJson('/api/profiles/' + encodeURIComponent(myId) + '/attempt',
              authedOpts({ level: item.level }));
          } else if(item.op === 'complete'){
            var d = item.data || {};
            p = fetchJson('/api/profiles/' + encodeURIComponent(myId) + '/completion',
              authedOpts({ level: item.level, score: d.score, coins: d.coins, time: d.time, runId: d.runId }));
          } else {
            flushed++; // unknown op: drop
            return null;
          }
          return p.then(function(){ flushed++; }).catch(function(err){
            if(err && dropStatus(err)) flushed++; // permanent: drop
            else remaining.push(item);            // transient: keep for later
          });
        });
      });
      return chain.then(function(){
        writeOutbox(remaining);
        return { ok: true, flushed: flushed, pending: remaining.length };
      });
    },
    outboxCount: function(){ return readOutbox().length; },

    /* ---- test seams (pure logic, no network) ---- */
    _sha256hex: sha256hex,
    _sanitizeUser: sanitizeUser,
    _sanitizeDoc: sanitizeDoc,
    _publicUser: publicUser,
    _totalsOf: totalsOf,
    _applyCompletion: applyCompletion,
    _applyAttempt: applyAttempt,
    _compareRanked: compareRanked,
    _owns: owns
  };

  global.SP_Profiles = Profiles;
})(window);
