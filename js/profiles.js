/* STARBOUND — Global Profiles + Leaderboard: shared-database client.
   ---------------------------------------------------------------------------
   SINGLE SOURCE OF TRUTH: one shared backend document —
     {BACKEND_BASE}/{BACKEND_NAMESPACE}/{BACKEND_ENTRY}  →  {"v":1,"users":[...]}
   (default: MantleDB namespace "starlit-pip-guestbook" — the SAME database the
   Reviews system uses — entry "profiles-v1", i.e. a new table, not a new DB.
   UNCLAIMED namespace ⇒ keyless, zero secrets. Verified backend behavior:
   keyless POST creates/overwrites with HTTP 200 {"success":true}, keyless GET
   reads, immediate read-after-write consistency, DELETE removes an entry,
   CORS preflight passes for the GitHub Pages origin.)

   Every method that touches the network NEVER throws: results resolve to
   {ok:true,...} / {ok:false,error} so gameplay can never break when the
   backend is unreachable. localStorage holds ONLY the owner's session, a
   read cache, and an offline outbox — never the source of truth.

   STORED USER RECORD:
     { id,            // public id, e.g. "p_m31x_9f3ka2b7qz" (safe for URLs)
       privateId,     // owner-only handle, e.g. "karan853" (unique, a/A same)
       name,          // public display name
       avatar,        // preset id string OR {custom:"data:image/jpeg;base64,..."}
       secretHash,    // SHA-256 hex of the owner's edit secret (never secret)
       createdAt, updatedAt, seenAt,
       totalCoins,    // lifetime coins across completed runs (server-added Δ)
       levels,        // sparse: {"1":{s:best score,c:best coins,a:attempts,t:best secs}}
       runs }         // bounded ring of recent runIds (completion idempotency)

   PRIVACY CONTRACT: product code must ONLY expose other players through
   publicUser(), which strips privateId/secretHash/runs. The raw document is
   never rendered for anyone except the owner viewing their own record.

   IDENTITY: the 256-bit edit secret lives ONLY in the owner's localStorage
   session. All honest clients verify sha256(secret) === secretHash before
   mutating that record, so a player can only edit THEIR OWN profile/stats.
   (Honest limit, same class as Reviews: a keyless store cannot stop forged
   raw HTTP; validation + gating + daily backups are the mitigation.)

   MERGE RULES (recordCompletion): score/coins max-wins, attempts += Δ,
   best-time min-wins, lifetime coins += run Δ once per runId. A worse score
   or slower time NEVER overwrites a better record.

   RANKING (deterministic, public info only):
     1. totalScore (Σ of per-level highest scores) — descending
     2. levelsCompleted — descending
     3. totalCoins (lifetime) — descending
     4. createdAt — ascending (earlier achievement wins ties)
     5. public id — ascending (final deterministic tiebreak) */
(function(global){
  'use strict';

  /* ---------------- limits ---------------- */
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
  var MAX_ATTEMPTS = 3;
  var SESSION_KEY = 'starboundProfileSessionV1';
  var CACHE_KEY = 'starboundProfilesCacheV1';
  var OUTBOX_KEY = 'starboundProfileOutboxV1';

  function cfg(){ return global.SP_ProfilesConfig || {}; }

  /* ---------------- tiny pure-JS SHA-256 (deterministic on every device,
     including file:// where SubtleCrypto may be missing). Returns hex. ---- */
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

  function publicId(){
    return 'p_' + Date.now().toString(36) + '_' + randHex(6);
  }

  /* ---------------- validation (frontend AND backend-gate: every write
     path re-validates, so forged payloads are clamped/rejected) ---------- */
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

  /* ---------------- sanitizers (applied to every doc read AND write) ---- */
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

  function sanitizeUser(u){
    if(!u || typeof u !== 'object') return null;
    var id = String(u.id || '');
    if(!/^p_[a-z0-9_]+$/i.test(id) || id.length > 64) return null;
    var name = cleanName(u.name).slice(0, MAX_NAME);
    var pid = String(u.privateId == null ? '' : u.privateId).trim().slice(0, MAX_PID);
    if(!name || !PID_RE.test(pid)) return null;
    var levels = {};
    if(u.levels && typeof u.levels === 'object'){
      for(var k in u.levels){
        var n = parseInt(k, 10);
        if(!(n >= 1 && n <= MAX_LEVEL)) continue;
        var row = sanitizeLevelRow(u.levels[k]);
        if(row) levels[String(n)] = row;
      }
    }
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
      levels: levels,
      runs: runs
    };
  }

  function sanitizeDoc(doc){
    if(!doc || typeof doc !== 'object') return { v: 1, users: [] };
    var arr = Array.isArray(doc.users) ? doc.users : [];
    var seen = {}, out = [];
    for(var i = 0; i < arr.length && out.length < MAX_USERS; i++){
      var u = sanitizeUser(arr[i]);
      if(!u || seen[u.id]) continue;
      seen[u.id] = true;
      out.push(u);
    }
    return { v: 1, users: out };
  }

  /* PUBLIC shape: the ONLY representation of another player the product
     ever uses. Strips privateId, secretHash and runIds. */
  function publicUser(u){
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

  function totalsOf(u){
    var lv = 0, score = 0, coins = 0, attempts = 0;
    for(var k in (u.levels || {})){ lv++; score += u.levels[k].s || 0; coins += u.levels[k].c || 0; attempts += u.levels[k].a || 0; }
    return { levelsCompleted: lv, totalScore: score, bestCoinsSum: coins, attempts: attempts };
  }

  /* RANKING — deterministic, public info only (see header comment). */
  function compareRanked(a, b){
    if(b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if(b.levelsCompleted !== a.levelsCompleted) return b.levelsCompleted - a.levelsCompleted;
    if(b.totalCoins !== a.totalCoins) return b.totalCoins - a.totalCoins;
    if(a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  }

  /* ---------------- network (mirrors the proven Reviews transport) ------ */
  function fetchJson(url, opts){
    opts = opts || {};
    var controller = null, timer = null;
    try{
      if(typeof AbortController !== 'undefined'){
        controller = new AbortController();
        timer = setTimeout(function(){ try{ controller.abort(); }catch(e){} }, FETCH_TIMEOUT_MS);
      }
    }catch(e){ controller = null; }
    var f = global.fetch;
    if(typeof f !== 'function') return Promise.reject(Object.assign(new Error('Network unavailable'), { network: true }));
    var p = f(url, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body: opts.body,
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
    return 'Could not ' + (what === 'load' ? 'load profiles' : 'save your profile') + ' right now. Please try again.';
  }

  function store(){
    var c = cfg();
    if(!c.BACKEND_BASE || !c.BACKEND_NAMESPACE || !c.BACKEND_ENTRY) return null;
    return { url: String(c.BACKEND_BASE).replace(/\/$/, '') + '/' +
      encodeURIComponent(c.BACKEND_NAMESPACE) + '/' + encodeURIComponent(c.BACKEND_ENTRY) };
  }

  function storeLoad(){
    var s = store();
    if(!s) return Promise.reject(Object.assign(new Error('not configured'), { status: 404 }));
    return fetchJson(s.url, {}).then(function(doc){
      if(doc && doc.error) throw Object.assign(new Error('backend error'), { status: 500 });
      return sanitizeDoc(doc);
    });
  }

  function storeWrite(doc){
    var s = store();
    return fetchJson(s.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc)
    }).then(function(ack){
      if(!ack || ack.success !== true) throw new Error('Server did not confirm the profile.');
      return true;
    });
  }

  function retriable(err){
    return !!(err && (err.network || err.status === 429 || (err.status >= 500 && err.status <= 599)));
  }

  /* read-modify-write with fresh re-reads: max/min merges converge even
     under interleaved writers; idempotent runIds prevent double-counting. */
  function updateDoc(mutator){
    var attempt = 0;
    function once(){
      attempt++;
      return storeLoad().then(function(doc){
        var res = mutator(doc) || {};
        if(res.skip) return { doc: doc, value: res.value };
        return storeWrite(res.doc || doc).then(function(){
          writeCache(res.doc || doc);
          return { doc: res.doc || doc, value: res.value };
        });
      }).catch(function(err){
        if(attempt < MAX_ATTEMPTS && retriable(err))
          return new Promise(function(res){ setTimeout(res, 500 * attempt); }).then(once);
        throw err;
      });
    }
    return once();
  }

  /* ---------------- session (owner identity, this device only) ----------- */
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
      return { at: d.at || 0, doc: d.doc ? sanitizeDoc(d.doc) : null };
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

  /* ---------------- merge engine (pure, unit-testable) ------------------- */
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

  /* ================= public API ================= */
  var Profiles = {
    MAX_NAME: MAX_NAME, MAX_PID: MAX_PID, MIN_PID: MIN_PID, MAX_USERS: MAX_USERS,

    validateName: validateName,
    validatePrivateId: validatePrivateId,
    validateAvatar: validateAvatar,
    cleanName: cleanName,
    fmtTime: function(s){
      s = Math.max(0, Math.ceil(Number(s) || 0));
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    },

    /* ---- session ---- */
    session: loadSession,
    hasAccount: function(){ return !!loadSession(); },
    signOutThisDevice: function(){ clearSession(); },

    /* ---- reads (always a genuine backend read; cache only on failure) -- */
    load: function(){
      return storeLoad().then(function(doc){
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

    /* Owner's full record (includes privateId). Null when no/invalid session. */
    me: function(doc){
      var s = loadSession();
      if(!s || !doc) return null;
      for(var i = 0; i < doc.users.length; i++){
        if(doc.users[i].id === s.id) return owns(s, doc.users[i]) ? doc.users[i] : null;
      }
      return null;
    },

    myPublicId: function(){ var s = loadSession(); return s ? s.id : null; },

    /* Public profile of ANY player (stripped). Never exposes private data. */
    getPublic: function(doc, publicId){
      if(!doc || !publicId) return null;
      for(var i = 0; i < doc.users.length; i++){
        if(doc.users[i].id === publicId){
          var p = publicUser(doc.users[i]);
          if(p && Object.keys(p.levels).length) return p; // played ≥1 level
          return p;
        }
      }
      return null;
    },

    /* Global leaderboard: account holders who have played. Public only. */
    leaderboard: function(doc, limit){
      limit = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
      var rows = [];
      for(var i = 0; i < (doc ? doc.users.length : 0); i++){
        var p = publicUser(doc.users[i]);
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

    /* ---- account creation ---- */
    createAccount: function(name, privateId, avatar){
      var vn = validateName(name);
      if(!vn.ok) return Promise.resolve({ ok: false, error: vn.error });
      var vp = validatePrivateId(privateId);
      if(!vp.ok) return Promise.resolve({ ok: false, error: vp.error });
      var va = validateAvatar(avatar);
      if(!va.ok) return Promise.resolve({ ok: false, error: va.error });
      var secret = randHex(32);
      var rec = {
        id: publicId(),
        privateId: vp.value,
        name: vn.value,
        avatar: va.value,
        secretHash: sha256hex(secret),
        createdAt: Date.now(), updatedAt: Date.now(), seenAt: Date.now(),
        totalCoins: 0, levels: {}, runs: []
      };
      return updateDoc(function(doc){
        if(doc.users.length >= MAX_USERS)
          throw Object.assign(new Error('Profile storage is full right now. Please try again later.'), { status: 413 });
        for(var i = 0; i < doc.users.length; i++){
          if(doc.users[i].privateId.toLowerCase() === vp.value.toLowerCase())
            throw Object.assign(new Error('That player ID is already taken. Please choose another.'), { code: 'DUP_ID' });
        }
        doc.users.push(sanitizeUser(rec));
        return { doc: doc, value: rec };
      }).then(function(r){
        saveSession({ id: r.value.id, secret: secret, privateId: r.value.privateId });
        return { ok: true, user: r.value };
      }).catch(function(err){
        return { ok: false, error: (err && (err.code === 'DUP_ID' || err.status === 413)) ? err.message : friendlyError(err, 'save') };
      });
    },

    /* ---- owner edits (name / avatar / privateId). Ownership verified. --- */
    updateProfile: function(patch){
      var s = loadSession();
      if(!s) return Promise.resolve({ ok: false, error: 'No account on this device.' });
      var session = s;
      var next = {};
      if(patch.name !== undefined){
        var vn = validateName(patch.name);
        if(!vn.ok) return Promise.resolve({ ok: false, error: vn.error });
        next.name = vn.value;
      }
      if(patch.avatar !== undefined){
        var va = validateAvatar(patch.avatar);
        if(!va.ok) return Promise.resolve({ ok: false, error: va.error });
        next.avatar = va.value;
      }
      var wantPid = false, pidVal = '';
      if(patch.privateId !== undefined){
        var vp = validatePrivateId(patch.privateId);
        if(!vp.ok) return Promise.resolve({ ok: false, error: vp.error });
        wantPid = true; pidVal = vp.value;
      }
      return updateDoc(function(doc){
        var u = null;
        for(var i = 0; i < doc.users.length; i++) if(doc.users[i].id === session.id) u = doc.users[i];
        if(!u) throw Object.assign(new Error('Account not found on the server.'), { code: 'NO_USER' });
        if(!owns(session, u)) throw Object.assign(new Error('This device is not signed in as that player.'), { code: 'FORBIDDEN' });
        if(wantPid){
          for(var j = 0; j < doc.users.length; j++){
            if(doc.users[j].id !== u.id && doc.users[j].privateId.toLowerCase() === pidVal.toLowerCase())
              throw Object.assign(new Error('That player ID is already taken. Please choose another.'), { code: 'DUP_ID' });
          }
          u.privateId = pidVal;
        }
        if(next.name !== undefined) u.name = next.name;
        if(next.avatar !== undefined) u.avatar = next.avatar;
        u.updatedAt = Date.now(); u.seenAt = Date.now();
        return { doc: doc, value: sanitizeUser(u) };
      }).then(function(r){
        if(wantPid) saveSession({ id: session.id, secret: session.secret, privateId: r.value.privateId });
        return { ok: true, user: r.value };
      }).catch(function(err){
        var msg = (err && (err.code === 'DUP_ID' || err.code === 'NO_USER' || err.code === 'FORBIDDEN')) ? err.message : friendlyError(err, 'save');
        return { ok: false, error: msg };
      });
    },

    /* ---- gameplay sync (best-effort; game never waits on it) ------------ */
    recordAttempt: function(level){
      var s = loadSession();
      if(!s) return Promise.resolve({ ok: false, error: 'no-account' });
      var session = s;
      level = Math.min(MAX_LEVEL, Math.max(1, parseInt(level, 10) || 0));
      if(!level) return Promise.resolve({ ok: false, error: 'bad level' });
      return updateDoc(function(doc){
        var u = null;
        for(var i = 0; i < doc.users.length; i++) if(doc.users[i].id === session.id) u = doc.users[i];
        if(!u || !owns(session, u)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
        applyAttempt(u, level);
        return { doc: doc, value: true };
      }).then(function(){ return { ok: true }; })
        .catch(function(err){
          if(err && err.code === 'FORBIDDEN') return { ok: false, error: 'forbidden' };
          queueOp({ op: 'attempt', level: level });
          return { ok: false, error: friendlyError(err, 'save'), queued: true };
        });
    },

    recordCompletion: function(level, data){
      var s = loadSession();
      if(!s) return Promise.resolve({ ok: false, error: 'no-account' });
      var session = s;
      data = data || {};
      return updateDoc(function(doc){
        var u = null;
        for(var i = 0; i < doc.users.length; i++) if(doc.users[i].id === session.id) u = doc.users[i];
        if(!u || !owns(session, u)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
        var r = applyCompletion(u, level, data);
        return { doc: doc, value: { improved: r.improved } };
      }).then(function(r){ return { ok: true, improved: !!r.value.improved }; })
        .catch(function(err){
          if(err && err.code === 'FORBIDDEN') return { ok: false, error: 'forbidden' };
          queueOp({ op: 'complete', level: level, data: data });
          return { ok: false, error: friendlyError(err, 'save'), queued: true };
        });
    },

    /* Retry queued offline ops, oldest first. Never throws. */
    flushOutbox: function(){
      var s = loadSession();
      var box = readOutbox();
      if(!s || !box.length) return Promise.resolve({ ok: true, flushed: 0 });
      var session = s, flushed = 0;
      var chain = Promise.resolve();
      box.forEach(function(item){
        chain = chain.then(function(){
          return updateDoc(function(doc){
            var u = null;
            for(var i = 0; i < doc.users.length; i++) if(doc.users[i].id === session.id) u = doc.users[i];
            if(!u || !owns(session, u)) throw Object.assign(new Error('forbidden'), { code: 'FORBIDDEN' });
            if(item.op === 'attempt') applyAttempt(u, item.level);
            else if(item.op === 'complete') applyCompletion(u, item.level, item.data || {});
            return { doc: doc, value: true };
          }).then(function(){ flushed++; }).catch(function(){ /* keep for later */ });
        });
      });
      return chain.then(function(){
        // Drop the ops that succeeded (prefix) — failures stay queued.
        var rest = readOutbox().slice(flushed);
        writeOutbox(rest);
        return { ok: true, flushed: flushed, pending: rest.length };
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
