/* STARBOUND — Profiles/Leaderboard backend configuration.
   ---------------------------------------------------------------------------
   SECURITY: this file ships to every browser and contains ZERO secrets.

   Profiles now live behind the secure backend API (see server/):

     Frontend → {API_BASE}/api/profiles… → backend → MantleDB → database

   The browser NEVER talks to the database directly and never sees private
   credentials. The only value used here is the PUBLIC backend URL from
   js/api-config.js (SP_ApiConfig.getBase()).

   IDENTITY: each account owns an unguessable 256-bit edit secret kept ONLY
   in the owner's browser localStorage. The backend stores only its SHA-256
   hash and verifies it server-side before ANY mutation, so nobody can edit
   someone else's profile — and the hash itself is never returned to any
   browser. A player can only ever edit THEIR OWN name/avatar/stats.

   PRIVACY: public endpoints return ONLY public fields (id, name, avatar,
   totals, per-level bests). privateId / secretHash / runIds are stripped
   server-side — never filtered by frontend code alone. */
(function(global){
  'use strict';
  global.SP_ProfilesConfig = {
    // Reserved for future client-tunable options. The API base URL lives in
    // js/api-config.js (SP_ApiConfig) — the single configurable value.
  };
})(window);
