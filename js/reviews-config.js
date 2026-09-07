/* STARLIT PIP — Reviews backend configuration.
   ---------------------------------------------------------------------------
   SECURITY: this file ships to every browser, so it contains ZERO secrets.
   There is intentionally no credential of any kind here.

   HOW GLOBAL REVIEWS WORK (default, no setup):
     - Published reviews are a static file in this repo: data/reviews.json,
       served same-origin by GitHub Pages. Browsers can only READ it.
     - New submissions are POSTed as individual entries into a KEYLESS
       MantleDB inbox namespace ("starlit-pip-inbox"). The inbox name is
       PUBLIC BY DESIGN — like a mailbox slot, anyone may drop a submission
       in, and no key is needed (or exists). A scheduled GitHub Actions
       workflow validates the inbox and publishes valid reviews to git.
     - Because published reviews can only change via git push (workflow /
       collaborators), visitors CANNOT delete or modify published reviews,
       and there is no private data or admin surface reachable from a browser.

   OPTIONAL INSTANT PATH — Supabase (recommended if you want reviews to
   appear immediately instead of after the ~15 min publish sync):
     1. Create a free project at https://supabase.com
     2. Run supabase-reviews.sql in its SQL editor.
     3. Paste the Project URL + ANON public key below and redeploy.
   The Supabase ANON key is explicitly designed to be embedded in frontend
   code: Row Level Security in supabase-reviews.sql allows anonymous clients
   to SELECT + INSERT only (no UPDATE, no DELETE, no admin). NEVER put a
   service_role key (or any password/connection string) in this file. */
(function(global){
  'use strict';
  global.SP_ReviewsConfig = {
    // ---- Supabase instant path (empty = use the static + inbox flow) ----
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',

    // ---- Keyless submission inbox (public name, no credential) ----
    INBOX_BASE: 'https://mantledb.sh/v2',
    INBOX_NAMESPACE: 'starlit-pip-inbox',

    // ---- Published reviews (same-origin static file, read-only) ----
    DATA_URL: 'data/reviews.json'
  };
})(window);
