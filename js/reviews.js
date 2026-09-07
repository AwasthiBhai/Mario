/* STARLIT PIP — Reviews: GLOBAL shared store, zero browser secrets.
   ---------------------------------------------------------------------------
   ARCHITECTURE (see js/reviews-config.js for the full security rationale):

     DEFAULT — static publish + keyless inbox queue:
       * READ:  same-origin static file data/reviews.json (published by a
                scheduled GitHub Actions workflow). No CORS, no key, no login.
       * WRITE: the browser POSTs ONE self-contained entry to a KEYLESS
                MantleDB inbox namespace. There is no credential to steal —
                the inbox is a public submission slot. The Actions workflow
                validates each pending entry and appends the valid ones to
                data/reviews.json. Submissions appear for everyone after the
                next publish sync (about every 15 minutes).
       * Because published reviews change ONLY via git push, no visitor can
         delete or modify a published review, and there is no private data
         or admin functionality reachable from the browser.

     OPTIONAL INSTANT PATH — Supabase:
       * Used automatically when SUPABASE_URL + SUPABASE_ANON_KEY are set in
         js/reviews-config.js (table/RLS: supabase-reviews.sql). The anon key
         is browser-safe by design (RLS: SELECT + INSERT only).

   localStorage holds ONLY a read cache of the last fetched published list
   (offline fallback) plus read-only pre-global "legacy" reviews shown
   separately — never the database.

   All review text is PLAIN TEXT. Rendering must use textContent (never
   innerHTML) — see js/ui.js. */
(function(global){
  'use strict';

  var MAX_NAME = 40, MAX_TEXT = 600, MAX_CACHE = 200;
  var CACHE_KEY = 'starlitPipReviewsCacheV2';
  var LEGACY_KEY = 'starlitPipReviewsV1';
  var FETCH_TIMEOUT_MS = 12000;
  var ID_RE = /^r_[A-Za-z0-9_.-]{1,64}$/;

  function cfg(){
    return global.SP_ReviewsConfig || {};
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
    if(r.id != null && typeof r.id === 'string' && !ID_RE.test(r.id)) return null;
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
    var p = global.fetch(url, {
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

  /* ---------------- Supabase instant path (only when configured) ---------------- */
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
      return { review: saved, pending: false };
    });
  }

  /* ---------------- Static publish + keyless inbox queue ---------------- */
  function inbox(){
    var c = cfg();
    if(!c.INBOX_BASE || !c.INBOX_NAMESPACE) return null;
    return { base: String(c.INBOX_BASE).replace(/\/$/, ''), ns: c.INBOX_NAMESPACE };
  }
  function dataUrl(){
    var c = cfg();
    return c.DATA_URL || 'data/reviews.json';
  }
  function staticLoad(){
    // Same-origin static JSON: no CORS involved, no key, no login.
    return fetchJson(dataUrl(), {}).then(function(doc){
      var arr = doc && Array.isArray(doc.reviews) ? doc.reviews : [];
      return sanitizeList(arr);
    });
  }
  function inboxSubmit(review){
    var box = inbox();
    if(!box) return Promise.reject(new Error('Review submissions are not configured.'));
    // One self-contained entry per review. Keyless by design: the inbox is a
    // public submission slot, so there is no credential in this request.
    var url = box.base + '/' + encodeURIComponent(box.ns) + '/inbox/' + encodeURIComponent(review.id);
    var attempt = 0;
    function once(){
      attempt++;
      return fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(review)
      }).then(function(){
        return { review: review, pending: true };
      }).catch(function(err){
        if(err && (err.status === 401 || err.status === 403)){
          throw new Error('Submissions are temporarily blocked. Please try again later.');
        }
        if(attempt < 3 && err && (err.network || err.status === 429 || (err.status >= 500 && err.status <= 599))){
          return new Promise(function(res){ setTimeout(res, 600 * attempt); }).then(once);
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
      if(global.localStorage) global.localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), reviews: list.slice(0, MAX_CACHE) }));
    }catch(e){}
  }
  function readLegacy(){
    try{
      var raw = global.localStorage && global.localStorage.getItem(LEGACY_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return sanitizeList(arr);
    }catch(e){ return []; }
  }

  function friendlyError(err){
    if(!err) return 'Something went wrong. Please try again.';
    if(err.network) return 'Could not reach the review server. Check your connection and try again.';
    if(err.status === 429) return 'The review server is busy. Please wait a moment and try again.';
    if(err.status === 401 || err.status === 403) return 'The review server refused the request. Please try again later.';
    if(err.status >= 500 && err.status <= 599) return 'The review server had a hiccup. Please try again.';
    return 'Could not load reviews right now. Please try again.';
  }

  var Reviews = {
    MAX_NAME: MAX_NAME,
    MAX_TEXT: MAX_TEXT,

    /* Active read path: 'supabase' | 'static' */
    backend: function(){
      return supaBase() ? 'supabase' : 'static';
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

    /* Fetch the GLOBAL published list (newest first). Never throws:
       resolves { ok, reviews, stale, error } so the game can never crash. */
    load: function(){
      var self = this;
      var p = supaBase() ? supaLoad() : staticLoad();
      return p.then(function(list){
        writeCache(list);
        self._cache = list;
        return { ok: true, reviews: list, stale: false, error: '' };
      }).catch(function(err){
        var cached = readCache();
        self._cache = cached.reviews;
        if(cached.reviews.length){
          return { ok: true, reviews: cached.reviews, stale: true,
            error: friendlyError(err) + ' Showing the last saved copy.' };
        }
        return { ok: false, reviews: [], stale: false, error: friendlyError(err) };
      });
    },

    /* Submit a review for GLOBAL publishing.
       - Supabase path: resolves ok:true only after the database confirms.
       - Inbox path: resolves ok:true + pending:true once the submission is
         accepted into the publish queue (it appears for everyone after the
         next scheduled sync). Never pretends a review is published early. */
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
      var p = supaBase() ? supaSubmit(review) : inboxSubmit(review);
      return p.then(function(out){
        return { ok: true, review: out.review, pending: !!out.pending };
      }).catch(function(err){
        var msg = (err && err.network) ? friendlyError(err) : ((err && err.message) || friendlyError(err));
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
