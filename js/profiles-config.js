/* STARBOUND — Profiles/Leaderboard backend configuration.
   ---------------------------------------------------------------------------
   SECURITY: this file ships to every browser and contains ZERO secrets.
   No credential of any kind exists anywhere in this design.

   HOW GLOBAL PROFILES WORK (same architecture as global Reviews):
     - Profiles live in ONE shared backend document (single source of truth):
       {BACKEND_BASE}/{BACKEND_NAMESPACE}/{BACKEND_ENTRY}  →  {"v":1,"users":[...]}
       Same MantleDB service AND same namespace as Reviews ("starlit-pip-guestbook"),
       but a different entry ("profiles-v1") — i.e. a new table in the SAME
       database, not a second database. The namespace is UNCLAIMED, so every
       operation is keyless: no key is needed, none exists, none can leak.
       Reads and writes work directly from the browser (CORS-open), with no
       login server and no GitHub Pages redeploy involved in any write.
     - Write flow: validate → GET fresh doc → apply max-wins/min-wins merge →
       POST full doc → backend confirms HTTP 200 {"success":true}. The UI
       reports success only after that confirmation.
     - Read flow: GET the doc on every Profile/Leaderboard open — a genuine
       backend read every time, so Player B always sees Player A's latest
       name/avatar after a refresh. localStorage holds ONLY the owner's
       session (publicId + edit secret), a read cache, and an offline outbox —
       never the source of truth.
     - Reviews are untouched: different entry, different module, different UI.

   IDENTITY (appropriate for a Pages-only static site — there is no login
   server, and GitHub Pages cannot run one):
     - Each account owns an unguessable 256-bit edit secret kept ONLY in the
       owner's browser localStorage. The shared doc stores only its SHA-256
       hash. Every honest client verifies the secret before mutating that
       account's record, so nobody can edit someone else's profile through
       the game's UI. A player can only ever edit THEIR OWN name/avatar.
     - HONEST LIMIT (same class as the Reviews guestbook limits): a keyless
       public store cannot cryptographically stop a hostile client from
       forging raw HTTP calls. Mitigations: strict validation on every
       read AND write path, secret-hash gating in all product code, bounded
       doc size, plus a daily secret-free backup workflow
       (.github/workflows/profiles-backup.yml) with a restore runbook.

   OPTIONAL STRICT PATH — Supabase (schema only, see supabase-profiles.sql):
     Normalized `profiles` + `level_stats` tables with a `profiles_public`
     view that structurally excludes private IDs and secret hashes, and RLS
     that allows anonymous SELECT (via the view) + INSERT with checks but no
     UPDATE/DELETE. Wiring live Supabase writes for profiles requires a
     follow-up with server-side update gating (e.g. Supabase Auth) that a
     static Pages site cannot provide — so the game always uses the shared
     document below, and the SQL file is the documented upgrade path. */
(function(global){
  'use strict';
  global.SP_ProfilesConfig = {
    // ---- Direct shared backend (single source of truth, keyless) ----
    BACKEND_BASE: 'https://mantledb.sh/v2',
    BACKEND_NAMESPACE: 'starlit-pip-guestbook',
    BACKEND_ENTRY: 'profiles-v1'
  };
})(window);
