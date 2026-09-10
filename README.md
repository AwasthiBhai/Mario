# ✦ STARLIT PIP — Echoes of the Aether

A complete 50-level 2D platform adventure by **BundLal Studios**.
Play **Pip**, a lantern-fox cub: run, bounce, outwit 7 critter species,
topple 10 bosses — and face the **Voidstar** in Level 50.

**Live site:** `https://<YOUR-USERNAME>.github.io/Mario/` (after enabling Pages)

## Technology

- Pure static site — no framework, no bundler, no backend
- HTML5 Canvas + vanilla JS modules (`js/`)
- 100% original generative WebAudio soundtrack (`js/audio.js`, no audio files)
- All art drawn in code/CSS/SVG — zero binary game assets
- Saves persist in `localStorage` (per browser/device); reviews are global via a shared database

## Run locally

No install step. Either open the file directly:

```powershell
start index.html
```

or serve the folder (closest to how GitHub Pages serves it):

```powershell
# Python 3
python -m http.server 8000
# then open http://localhost:8000/

# or Node
npx serve .
```

To simulate the GitHub Pages subpath (`/<repo>/`), serve and check that
CSS/JS/favicon all still load — all references are relative, so this works
unchanged.

## Build

There is no build. The repository root **is** the website:

| File            | Purpose                              |
| --------------- | ------------------------------------ |
| `index.html`    | All views: Home, Game, Levels, Reviews, Settings, Credits, About |
| `css/main.css`  | Full responsive stylesheet           |
| `js/levels.js`  | Deterministic procedural 50-level builder (all level data ships in-JS) |
| `js/engine.js`  | Platformer engine, physics, camera, enemies, bosses |
| `js/audio.js`   | Generative music + SFX (WebAudio)    |
| `js/intro.js`   | "BundLal Studios Presents" cinematic |
| `js/ui.js`      | Navigation, HUD, level select, reviews, settings |
| `js/save.js`    | localStorage saves                   |
| `js/api-config.js` | Public backend URL only (localhost ↔ production, zero secrets) |
| `js/reviews-config.js` | Optional Supabase strict-path keys only (empty by default) |
| `js/reviews.js` | Global shared reviews (`SP_Reviews`, async load/submit) |
| `js/input.js`   | Keyboard (remappable) + touch + gamepad |
| `favicon.svg`   | Favicon                              |
| `404.html`      | Pages fallback → redirects to game root |

## Deployment (GitHub Pages)

Pushes to `main` auto-deploy via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
(modern Pages flow: `configure-pages` → `upload-pages-artifact` → `deploy-pages`).

One-time setup after pushing:

1. Create the repo named **`Mario`** on GitHub.
2. Push this folder (`git push -u origin main`).
3. Repo → **Settings → Pages** → Source: **GitHub Actions**.
4. Open `https://<YOUR-USERNAME>.github.io/Mario/`.

Notes:

- No `base` path config exists or is needed — every asset URL is relative,
  so `/Mario/` works as-is, as does any future repo rename.
- Routing is in-page view switching (no History API, no deep URLs), so no
  route can 404. `404.html` is a safety net that bounces strays home.

## Audio rules (preserved in production)

- Website screens: silent (no background music)
- Intro: cinematic audio allowed
- Level: world theme ON · Boss: boss music ON
- Leaving a level / pausing to menus: music OFF/ducked
- Browsers block autoplay: music starts after the first click/tap (intro button)

## Backend API (secure: frontend → API → MantleDB)

The browser NEVER talks to the database directly and holds NO private
credentials — only the public backend URL (`js/api-config.js`).

```
PLAYER → GitHub Pages frontend → Node API (server/) → MantleDB → database
```

- The API (`server/server.js`, zero dependencies) owns ALL database
  configuration as host environment variables (see `server/.env.example`
  for NAMES — values live only on the backend host, never in code).
- Reviews: `GET /api/reviews` (public) / `POST /api/reviews` (signed-in
  accounts only — session verified server-side, guests get 401) —
  validated, sanitized, newest first.
  No public delete endpoint exists.
- Profiles: `GET /api/profiles` (public list + world `resetVersion`, which
  clients use to detect a world wipe and reset stale local progress),
  `GET /api/profiles/:id`,
  `GET /api/profiles/me` (owner, secret- or session-verified),
  `POST /api/profiles` (legacy create: server mints id + edit secret),
  `PATCH /api/profiles/:id` (403 without the owner's credential),
  `POST /api/profiles/:id/attempt`, `POST /api/profiles/:id/completion`
  (bounds-checked: level/score/coins/time), `GET /api/leaderboard`.
- Auth: `POST /api/auth/signup` (name + private ID + avatar + password →
  owner record + session token), `POST /api/auth/signin` (all three must
  match the same account; every failure is one generic 401),
  `POST /api/auth/signout` (revokes that session),
  `GET /api/auth/session` (validates a session token),
  `POST /api/auth/set-password/:id` (owner-only migration for
  pre-password accounts; current password required once one exists).
  Passwords verify ONLY server-side (Node scrypt + `AUTH_PEPPER` server
  secret, unique salt each); sessions are opaque 256-bit tokens stored as
  SHA-256 with expiry. Sign-out clears local state only — cloud data stays.
- Public responses contain ONLY public fields — `privateId`, `secretHash`
  and run ids are stripped server-side. Ownership secrets are verified with
  a timing-safe SHA-256 compare and never returned to any browser.
- Protections: body-size limits, per-IP rate limiting, strict CORS
  (Pages origin + localhost), friendly JSON errors (no stacks/secrets).
- If the API is unreachable the game keeps working: cached reads, an
  offline outbox with safe retry, and guest play are all preserved.

Local dev (Windows, no admin): `cd server` → `npm install` → `npm run dev`
(API on `http://localhost:8787`, auto-used by the frontend on localhost).
Production: deploy `server/` to Render/Koyeb/Glitch (free, no domain —
see `server/README.md`), then set `PROD_API_BASE` in `js/api-config.js`
to the live URL. `npm test` (in `server/`) runs the 21-check API suite.

## Reviews (global, shared — zero secrets in the browser)

One authoritative source: a single shared backend document
`{"reviews":[...]}` (MantleDB namespace `starlit-pip-guestbook`, entry
`reviews`), read and written ONLY through the backend API above. The
namespace is UNCLAIMED, so all access is keyless — no credential exists
anywhere: not in the repo, not in the browser, not in Actions secrets.
Nothing can leak. (If the namespace is ever claimed, set `MANTLEDB_API_KEY`
on the backend host — never in frontend code.)

- **Submit (account holders only; READ stays public):** validate → require
  local account → `POST /api/reviews` (session/secret attached) → backend
  re-verifies the session server-side (guest POSTs get 401), GETs
  the fresh doc, prepends, POSTs it back, verifies persistence → UI reports
  success. No redeploy, no Actions, no polling. (`js/reviews.js`:
  `SP_Reviews.submit()` resolves `ok:true` only after that confirmation.)
- **Read:** every Reviews open performs a genuine `GET /api/reviews`
  (newest first); stats come from that live data. Verified behavior:
  malformed JSON rejected (400), oversized bodies rejected (413),
  rate-limited abuse rejected (429), CORS restricted to the Pages origin.
- `localStorage` holds **only** a read cache of the last fetched list
  (used solely when the backend is unreachable) plus read-only pre-global
  "legacy" reviews shown separately — never the source of truth.
- Review text is rendered as plain text (`textContent` only). Every fetch
  has a 12 s timeout; failures show "Unable to load reviews. Please try
  again." + Retry while the game keeps working. The UI offers no delete
  button for shared reviews.
- **Honest limits** (inherent to any anonymous public guestbook): spam or
  deletion cannot be cryptographically prevented without user accounts.
  Mitigations: strict validation on BOTH frontend and backend, bounded doc
  size, no delete button in the UI, no delete endpoint in the API, and a
  daily secret-free [backup workflow](.github/workflows/reviews-backup.yml)
  committing `data/reviews-backup.json` on change — see its RESTORE RUNBOOK
  header. If the namespace is ever claimed by someone else: set
  `MANTLEDB_API_KEY` on the backend host (writes keep working, browsers
  still see nothing secret).
- **Optional strict path:** Supabase (Postgres, server timestamps). Create a
  free project, run [`supabase-reviews.sql`](supabase-reviews.sql), paste the
  Project URL + `anon` key into `js/reviews-config.js` — the code switches
  automatically. The anon key is browser-safe by design (RLS: SELECT +
  INSERT only, no UPDATE/DELETE). Never commit a `service_role` key.

GitHub Actions deploys website code only; it is never in the review
submit/read path. If a workflow push fails with 403: Repo → Settings →
Actions → General → Workflow permissions → "Read and write permissions".

## License / assets

- All code, art, and audio are original creations of BundLal Studios.
- No third-party game assets. Fonts (Baloo 2 + Nunito) are SIL Open Font
  License 1.1 via Google Fonts.
- © 2026 BundLal Studios.
