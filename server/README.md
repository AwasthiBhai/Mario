# STARBOUND — secure backend API

Architecture:

```
PLAYER
  ↓
GitHub Pages FRONTEND (static, no secrets)
  ↓  HTTPS JSON (`/api/*`)
SECURE BACKEND/API (this folder, Node — holds ALL private config)
  ↓  server-to-server HTTPS
MANTLEDB
  ↓
DATABASE (existing `reviews` + `profiles-v1` entries — no new database)
```

The browser never talks to MantleDB directly and never receives private
credentials. The only thing the frontend knows is the public backend URL
(`js/api-config.js` → `API_BASE_URL`).

## What it does

- `GET /api/reviews` — fetch + sanitize global reviews (newest first, public only)
- `POST /api/reviews` — validate → fetch fresh → prepend → write back → verify
- `GET /api/leaderboard` — ranked public leaderboard (no private fields)
- `GET /api/profiles` — public profile list (no private fields)
- `GET /api/profiles/me?id=…` (+ `X-Profile-Secret` header) — owner record
  (includes `privateId`, NEVER includes `secretHash`)
- `GET /api/profiles/:id` — one public profile (no private fields)
- `POST /api/profiles` — create account (server mints id + edit secret)
- `PATCH /api/profiles/:id` — owner edit (secret verified server-side)
- `POST /api/profiles/:id/attempt` — validated attempt counter
- `POST /api/profiles/:id/completion` — validated max-wins/min-wins merge
- `GET /api/health` — liveness probe

Server-side guarantees: input validation + bounds (scores, coins, times,
levels, sizes), ownership verification (SHA-256 secret, timing-safe compare),
public responses strip `privateId` / `secretHash` / `runs`, body-size limits,
per-IP rate limiting, strict CORS, friendly JSON errors (no stacks/secrets),
and serialized read-modify-write cycles per entry.

## Local development (Windows 11, no admin)

```powershell
cd server
npm install
npm run dev
# API on http://localhost:8787 — frontend auto-uses it on localhost
```

Optional: copy `.env.example` to `.env` to override defaults locally.
NEVER commit `.env` (already in root `.gitignore`).

Environment variable NAMES (values live ONLY on the backend host):

```
PORT=
MANTLEDB_BASE_URL=
MANTLEDB_NAMESPACE=
MANTLEDB_REVIEWS_ENTRY=
MANTLEDB_PROFILES_ENTRY=
MANTLEDB_API_KEY=
ALLOWED_ORIGINS=
RATE_LIMIT_WINDOW_MS=
RATE_LIMIT_MAX=
MAX_BODY_BYTES=
```

Defaults work with zero configuration: base `https://mantledb.sh/v2`,
namespace `starlit-pip-guestbook`, entries `reviews` / `profiles-v1`,
port `8787`, localhost + `*.github.io` CORS. `MANTLEDB_API_KEY` is empty
today (namespace is unclaimed/keyless) and is only needed if the namespace
is ever claimed — set it on the host, never in code.

## Production deployment (free, no domain, no credit card required)

Recommended: **Render** free web service (or **Koyeb** / **Glitch** — same steps).

1. Push this repo (the deploy workflow only publishes the static root to
   Pages; the backend is deployed separately — see below).
2. Create account at https://render.com (GitHub sign-in, free tier).
3. **New → Web Service → Build from your fork of this repo.**
   - Root directory: `server`
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance: Free.
4. **Environment tab** → add variable NAMES from `.env.example`
   (paste VALUES there — never into code):
   `MANTLEDB_BASE_URL`, `MANTLEDB_NAMESPACE`, `MANTLEDB_REVIEWS_ENTRY`,
   `MANTLEDB_PROFILES_ENTRY`, plus `ALLOWED_ORIGINS` set to your Pages URL,
   e.g. `https://<YOU>.github.io` (comma-separated if you have more).
   Leave `MANTLEDB_API_KEY` empty unless the namespace gets claimed.
5. Deploy → copy the public URL, e.g. `https://starbound-api.onrender.com`.
6. Point the frontend at it: set `PROD_API_BASE` in `js/api-config.js`
   to that URL, commit + push (Pages redeploys; no secrets involved).
7. Verify: open `<api-url>/api/health` → `{"ok":true,…}`, then check the
   live site's Reviews / Leaderboard / Profile pages.

Alternatives with the same `server/` folder: Koyeb (New App → from GitHub,
run `npm start`), Glitch (import folder, `npm start`), Railway/Fly
(same Node start command). No domain purchase is needed anywhere — use the
host's default `*.onrender.com` / `*.koyeb.app` URL.

## Backups

Before changing production access, snapshots of both entries were taken and
kept LOCAL ONLY (never committed). Daily backup workflows continue to read
through the same public documents. To restore: POST a known-good snapshot
back to the MantleDB entry from the backend host (see workflow runbooks).

## Security notes

- Private config exists ONLY as host environment variables.
- Frontend files contain NO passwords, keys, tokens, or connection strings.
- No review-delete endpoint exists. No secret is ever logged or returned.
- `npm test` runs the local API test suite (no production writes).
