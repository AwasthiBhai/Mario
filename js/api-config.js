/* STARBOUND — public API base URL (frontend → secure backend → MantleDB).
   ---------------------------------------------------------------------------
   SECURITY: this file ships to every browser and contains ZERO secrets.
   The ONLY thing the frontend knows is the PUBLIC backend URL below.
   Private database credentials live exclusively as environment variables on
   the backend host (see server/.env.example) and are never sent here.

   - Local development (or file:// testing): http://localhost:8787
   - Production: PROD_API_BASE — set this to the deployed backend URL once
     (see server/README.md), then redeploy Pages. Until then, API features
     gracefully fall back to offline/cached behavior; the game stays playable.
   - Override (dev only): ?api=http://host:port for the session, or
     localStorage "starboundApiBaseV1" for a sticky local override. */
(function(global){
  'use strict';
  var PROD_API_BASE = 'https://starbound-api.onrender.com';
  var DEV_API_BASE = 'http://localhost:8787';
  var OVERRIDE_KEY = 'starboundApiBaseV1';

  function isLocalHost(h){
    h = String(h || '').toLowerCase();
    return !h || h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  }
  function sanitizeBase(u){
    if (typeof u !== 'string') return '';
    u = u.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(u)) return '';
    return u;
  }
  function queryOverride(){
    try{
      var q = null;
      if (global.location && global.location.search) {
        q = (/[?&]api=([^&]+)/.exec(global.location.search) || [])[1];
      }
      if (q) return sanitizeBase(decodeURIComponent(q));
    }catch(e){}
    return '';
  }
  function storedOverride(){
    try{
      var v = global.localStorage && global.localStorage.getItem(OVERRIDE_KEY);
      return sanitizeBase(v || '');
    }catch(e){ return ''; }
  }
  function defaultBase(){
    try{
      var h = global.location && global.location.hostname;
      if (isLocalHost(h)) return DEV_API_BASE;
    }catch(e){}
    return PROD_API_BASE;
  }

  var ApiConfig = {
    PROD_API_BASE: PROD_API_BASE,
    DEV_API_BASE: DEV_API_BASE,
    getBase: function(){
      return queryOverride() || storedOverride() || defaultBase();
    },
    setOverride: function(url){
      var clean = sanitizeBase(url);
      try{
        if (global.localStorage) {
          if (clean) global.localStorage.setItem(OVERRIDE_KEY, clean);
          else global.localStorage.removeItem(OVERRIDE_KEY);
        }
      }catch(e){}
      return clean;
    },
    clearOverride: function(){ return this.setOverride(''); }
  };

  global.SP_ApiConfig = ApiConfig;
})(window);
