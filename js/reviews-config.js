/* STARBOUND — Reviews backend configuration.
   ---------------------------------------------------------------------------
   SECURITY: this file ships to every browser and contains ZERO secrets.

   Reviews now live behind the secure backend API (see server/):

     Frontend → {API_BASE}/api/reviews → backend → MantleDB → database

   The browser NEVER talks to the database directly and never sees private
   credentials. The only value used here is the PUBLIC backend URL from
   js/api-config.js (SP_ApiConfig.getBase()).

   OPTIONAL STRICT PATH — Supabase (per-user least privilege via RLS):
     1. Create a free project at https://supabase.com
     2. Run supabase-reviews.sql in its SQL editor.
     3. Paste the Project URL + ANON public key below and redeploy.
   The Supabase ANON key is designed for public frontend code (RLS in
   supabase-reviews.sql allows SELECT + INSERT only — no UPDATE/DELETE).
   NEVER put a service_role key, password, or connection string here. */
(function(global){
  'use strict';
  global.SP_ReviewsConfig = {
    // ---- Supabase strict path (empty = secure-backend flow) ----
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: ''
  };
})(window);
