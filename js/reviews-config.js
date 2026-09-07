/* STARLIT PIP — Reviews backend configuration.
   ---------------------------------------------------------------------------
   SECURITY: this file ships to every browser and contains ZERO secrets.
   No credential of any kind exists anywhere in this design.

   HOW GLOBAL REVIEWS WORK:
     - Reviews live in ONE shared backend document (single source of truth):
       a single JSON doc {"reviews":[...]} in the MantleDB namespace
       "starlit-pip-guestbook", entry "reviews".
     - The namespace is UNCLAIMED, so every operation is keyless: no key is
       needed, none exists, none can leak. Reads and writes work directly
       from the browser (CORS-open), with no login and no GitHub Pages
       redeploy involved in any review submission.
     - Submit flow: validate → GET fresh doc → prepend review → POST full
       doc → backend confirms HTTP 200 {"success":true}. The UI reports
       success only after that confirmation.
     - Read flow: GET the doc on every Reviews open (newest first). No
       polling loops, no waiting on Actions/deployments.
     - localStorage holds ONLY a read cache of the last fetched list
       (offline fallback) — never the source of truth.

   HONEST LIMITS (anonymous public guestbook — true of ANY such design):
     - There is no per-user auth, so spam/vandalism cannot be cryptographically
       prevented. Mitigations: strict validation, bounded doc size, no delete
       button in the UI, and a daily secret-free backup workflow
       (.github/workflows/reviews-backup.yml) plus a restore runbook in README.
     - If the namespace is ever squatted/claimed (writes return 401), the UI
       reports "temporarily blocked" and the runbook is: rename the namespace
       here and redeploy.

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
    // ---- Supabase strict path (empty = direct shared-backend flow) ----
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',

    // ---- Direct shared backend (single source of truth, keyless) ----
    BACKEND_BASE: 'https://mantledb.sh/v2',
    BACKEND_NAMESPACE: 'starlit-pip-guestbook',
    BACKEND_ENTRY: 'reviews'
  };
})(window);
