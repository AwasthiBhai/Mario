/* STARBOUND — Reviews: GLOBAL backend API client, zero secrets.
   ---------------------------------------------------------------------------
   ARCHITECTURE: Frontend → {API_BASE}/api/reviews → backend → MantleDB.
   The browser NEVER contacts the database directly and holds no private
   credentials — only the public backend URL (js/api-config.js).

   SUBMIT FLOW (no redeploy, no Actions, no polling):
     1. validate input → 2. POST {name,rating,text} to /api/reviews →
     3. backend validates, prepends, writes back, verifies persistence →
     4. resolve ok:true with the saved review.
   READ FLOW: GET /api/reviews on every open, newest first — a genuine
   backend read every time (the localStorage cache is used ONLY when the
   backend is unreachable). Every fetch has a 12 s timeout; all failures
   resolve to a friendly error — load()/submit() NEVER throw, so the game
   can never break.

   OPTIONAL STRICT PATH — Supabase (used automatically when configured):
   server timestamps, RLS SELECT+INSERT only (see supabase-reviews.sql).

   All review text is PLAIN TEXT. Rendering must use textContent (never
   innerHTML) — see js/ui.js. */
(function(global){
  'use strict';

  var MAX_NAME = 40, MAX_TEXT = 600, MAX_SHARED = 120;
  var CACHE_KEY = 'starlitPipReviewsCacheV3';
  var LEGACY_KEY = 'starlitPipReviewsV1';
  var FETCH_TIMEOUT_MS = 12000;
  var MAX_ATTEMPTS = 3;

  function cfg(){
    return global.SP_ReviewsConfig || {};
  }

  function apiBase(){
    try{
      if(global.SP_ApiConfig && typeof global.SP_ApiConfig.getBase === 'function'){
        var b = global.SP_ApiConfig.getBase();
        if(typeof b === 'string' && b) return b.replace(/\/$/, '');
      }
    }catch(e){}
    return '';
  }

  function uid(){
    try{
      if(global.crypto && global.crypto.getRandomValues){
        var b = new Uint8Array(12); global.crypto.getRandomValues(b);
        return 'r_' + Date.now().toString(36) + '_' +
          Array.from(b).map(function(x){ return x.toString(16).padStart(2,'0'); }).join('');
      }
    }catch(e){}
    return 'r_' + Date.now().toString(36) + '_' + Math.floor(Math.random()*1e12).toString(36);
  }

  function sanitizeOne(r){
    if(!r || typeof r !== 'object') return null;
    var name = String(r.name == null ? '' : r.name).trim().slice(0, MAX_NAME);
    var text = String(r.text == null ? '' : r.text).trim().slice(0, MAX_TEXT);
    var rating = Math.min(5, Math.max(1, parseInt(r.rating, 10) || 0));
    var createdAt = 0;
    if(typeof r.createdAt === 'number' && r.createdAt > 0) createdAt = Math.floor(r.createdAt);
    else if(typeof r.created_at === 'string' && r.created_at){
      var t = Date.parse(r.created_at);
      if(!isNaN(t)) createdAt = t;
    }
    if(!createdAt) createdAt = Date.now();
    if(!name || !text || !(rating >= 1 && rating <= 5)) return null;
    return { id: String(r.id || uid()), name: name, rating: rating, text: text, createdAt: createdAt };
  }

  function sanitizeList(arr){
    if(!Array.isArray(arr)) return [];
    return arr.map(sanitizeOne).filter(Boolean).sort(function(a,b){ return b.createdAt - a.createdAt; });
  }

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
    what = what || 'reviews';
    if(!err) return 'Something went wrong. Please try again.';
    if(err.network) return 'Could not reach the review server. Check your connection and try again.';
    if(err.status === 429) return 'The review server is busy. Please wait a moment and try again.';
    if(err.status === 413) return 'Reviews storage is full right now. Please try again later.';
    if(err.status === 401 || err.status === 403) return 'Review submissions are temporarily blocked. Please try again later.';
    if(err.status === 404 && what === 'load') return 'Unable to load reviews. Please try again.';
    if(err.status >= 500 && err.status <= 599) return 'The review server had a hiccup. Please try again.';
    if(err.name === 'AbortError' || (err.cause && err.cause.name === 'AbortError')) return 'The review server took too long. Please try again.';
    if(err.message && !/^Request failed/.test(err.message)) return err.message;
    return 'Could not ' + (what === 'load' ? 'load reviews' : 'save your review') + ' right now. Please try again.';
  }

  /* ---------------- Supabase strict path (only when configured) ---------------- */
  function supaBase(){
    var c = cfg();
    if(c.SUPABASE_URL && c.SUPABASE_ANON_KEY) return String(c.SUPABASE_URL).replace(/\/$/, '');
    return null;
  }
  function supaHeaders(json){
    var c = cfg();
    var h = { 'apikey': c.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + c.SUPABASE_ANON_KEY };
    if(json) h['Content-Type'] = 'application/json';
    return h;
  }
  function supaLoad(){
    var base = supaBase();
    var url = base + '/rest/v1/reviews?select=id,name,rating,text,created_at&order=created_at.desc&limit=200';
    return fetchJson(url, { headers: supaHeaders(false) }).then(function(rows){
      return sanitizeList(rows);
    });
  }
  function supaSubmit(review){
    var base = supaBase();
    var url = base + '/rest/v1/reviews';
    return fetchJson(url, {
      method: 'POST',
      headers: Object.assign(supaHeaders(true), { 'Prefer': 'return=representation' }),
      body: JSON.stringify({ name: review.name, rating: review.rating, text: review.text })
    }).then(function(rows){
      var saved = sanitizeList(rows)[0];
      if(!saved) throw new Error('Server did not confirm the review.');
      return saved;
    });
  }

  /* ---------------- Secure backend API (single source of truth) ---------------- */
  function apiLoad(){
    var base = apiBase();
    if(!base) return Promise.reject(Object.assign(new Error('not configured'), { status: 404 }));
    return fetchJson(base + '/api/reviews', {}).then(function(doc){
      var arr = doc && Array.isArray(doc.reviews) ? doc.reviews : [];
      return sanitizeList(arr).slice(0, MAX_SHARED);
    });
  }
  function apiSubmit(review){
    var base = apiBase();
    if(!base) return Promise.reject(new Error('Review submissions are not configured.'));
    var attempt = 0;
    function once(){
      attempt++;
      return fetchJson(base + '/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: review.name, rating: review.rating, text: review.text })
      }).then(function(res){
        var saved = sanitizeOne(res && res.review ? res.review : review);
        if(!saved) throw new Error('Server did not confirm the review.');
        return saved;
      }).catch(function(err){
        if(attempt < MAX_ATTEMPTS && err && (err.network || err.status === 429 ||
            (err.status >= 500 && err.status <= 599))){
          return new Promise(function(res){ setTimeout(res, 500 * attempt); }).then(once);
        }
        throw err;
      });
    }
    return once();
  }

  /* ---------------- localStorage: read cache + legacy viewer only ---------------- */
  function readCache(){
    try{
      var raw = global.localStorage && global.localStorage.getItem(CACHE_KEY);
      if(!raw) return { at: 0, reviews: [] };
      var doc = JSON.parse(raw);
      return { at: doc.at || 0, reviews: sanitizeList(doc.reviews) };
    }catch(e){ return { at: 0, reviews: [] }; }
  }
  function writeCache(list){
    try{
      if(global.localStorage) global.localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), reviews: list.slice(0, MAX_SHARED) }));
    }catch(e){}
  }
  function readLegacy(){
    try{
      var raw = global.localStorage && global.localStorage.getItem(LEGACY_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return sanitizeList(arr);
    }catch(e){ return []; }
  }

  var Reviews = {
    MAX_NAME: MAX_NAME,
    MAX_TEXT: MAX_TEXT,

    /* Active path: 'supabase' | 'api' */
    backend: function(){
      return supaBase() ? 'supabase' : 'api';
    },

    validate: function(name, rating, text){
      var errors = [];
      name = String(name == null ? '' : name).trim();
      text = String(text == null ? '' : text).trim();
      rating = parseInt(rating, 10);
      if(!name) errors.push('Please enter a display name.');
      else if(name.length > MAX_NAME) errors.push('Name must be ' + MAX_NAME + ' characters or fewer.');
      if(!(rating >= 1 && rating <= 5)) errors.push('Please choose a star rating (1–5).');
      if(!text) errors.push('Please write a review.');
      else if(text.length > MAX_TEXT) errors.push('Review must be ' + MAX_TEXT + ' characters or fewer.');
      return { ok: errors.length === 0, errors: errors };
    },

    /* Fetch the GLOBAL list (newest first) with a genuine backend read every
       time. Never throws: resolves { ok, reviews, stale, error }. */
    load: function(){
      var self = this;
      var p = supaBase() ? supaLoad() : apiLoad();
      return p.then(function(list){
        writeCache(list);
        self._cache = list;
        return { ok: true, reviews: list, stale: false, error: '' };
      }).catch(function(err){
        var cached = readCache();
        self._cache = cached.reviews;
        if(cached.reviews.length){
          return { ok: true, reviews: cached.reviews, stale: true,
            error: friendlyError(err, 'load') + ' Showing the last saved copy.' };
        }
        return { ok: false, reviews: [], stale: false, error: friendlyError(err, 'load') };
      });
    },

    /* Submit to the GLOBAL backend. Resolves ok:true ONLY after the backend
       confirms persistence — no redeploy, no Actions, no polling involved. */
    submit: function(name, rating, text){
      var v = this.validate(name, rating, text);
      if(!v.ok) return Promise.resolve({ ok: false, errors: v.errors.join(' ') });
      var review = {
        id: uid(),
        name: String(name).trim().slice(0, MAX_NAME),
        rating: parseInt(rating, 10),
        text: String(text).trim().slice(0, MAX_TEXT),
        createdAt: Date.now()
      };
      var self = this;
      var p = supaBase() ? supaSubmit(review) : apiSubmit(review);
      return p.then(function(saved){
        var keep = self._cache || readCache().reviews || [];
        var next = [saved].concat(keep.filter(function(r){ return r.id !== saved.id; })).slice(0, MAX_SHARED);
        self._cache = next;
        writeCache(next);
        return { ok: true, review: saved };
      }).catch(function(err){
        var msg = (err && err.network) ? friendlyError(err, 'save')
          : ((err && err.message) || friendlyError(err, 'save'));
        return { ok: false, errors: msg };
      });
    },

    getCached: function(){ return this._cache || readCache().reviews || []; },

    statsOf: function(arr){
      arr = Array.isArray(arr) ? arr : this.getCached();
      var dist = [0,0,0,0,0], sum = 0;
      for(var i = 0; i < arr.length; i++){ dist[arr[i].rating - 1]++; sum += arr[i].rating; }
      return { count: arr.length, avg: arr.length ? +(sum / arr.length).toFixed(1) : 0, dist: dist };
    },
    stats: function(){ return this.statsOf(this.getCached()); },

    /* Legacy device-only reviews from before reviews went global.
       Shown separately in the UI, clearly labeled — never the database. */
    legacyList: function(){ return readLegacy(); },
    legacyRemove: function(id){
      try{
        var raw = global.localStorage && global.localStorage.getItem(LEGACY_KEY);
        var arr = raw ? JSON.parse(raw) : [];
        var next = (Array.isArray(arr) ? arr : []).filter(function(r){ return r && r.id !== id; });
        if(global.localStorage) global.localStorage.setItem(LEGACY_KEY, JSON.stringify(next));
        return true;
      }catch(e){ return false; }
    },

    _cache: null
  };

  global.SP_Reviews = Reviews;
})(window);
