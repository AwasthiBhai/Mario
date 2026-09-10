/* STARBOUND — Profiles/Leaderboard backend configuration.
   ---------------------------------------------------------------------------
   SECURITY: this file ships to every browser and contains ZERO secrets.

   Profiles now live behind the secure backend API (see server/):

     Frontend → {API_BASE}/api/profiles… → backend → MantleDB → database

   The browser NEVER talks to the database directly and never sees private
   credentials. The only value used here is the PUBLIC backend URL from
   js/api-config.js (SP_ApiConfig.getBase()).

    IDENTITY: each password account owns opaque session tokens minted by
    POST /api/auth/signup|signin (stored ONLY in the owner's browser
    localStorage, sent ONLY over HTTPS in Authorization/X-Session-Token
    headers or JSON bodies — never URLs). The backend stores only
    SHA-256(token) with expiry and resolves identity FROM the token
    server-side, so a forged id can never authenticate as someone else.
    Pre-password devices keep their 256-bit edit secret (same storage,
    same timing-safe server verification) until the owner sets a password.

    PASSWORDS: verified ONLY on the backend (scrypt + server pepper);
    this frontend never hashes, verifies, or stores passwords.

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
