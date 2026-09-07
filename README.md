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
| `index.html`    | All views: Home, Game, Levels, Reviews, How to Play, Settings, Credits, About |
| `css/main.css`  | Full responsive stylesheet           |
| `js/levels.js`  | Deterministic procedural 50-level builder (all level data ships in-JS) |
| `js/engine.js`  | Platformer engine, physics, camera, enemies, bosses |
| `js/audio.js`   | Generative music + SFX (WebAudio)    |
| `js/intro.js`   | "BundLal Studios Presents" cinematic |
| `js/ui.js`      | Navigation, HUD, level select, reviews, settings |
| `js/save.js`    | localStorage saves                   |
| `js/reviews-config.js` | Shared-backend endpoints for global reviews (zero secrets) |
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

## Reviews (global, shared — zero secrets)

One authoritative source: a single shared backend document
`{"reviews":[...]}` (MantleDB namespace `starlit-pip-guestbook`, entry
`reviews`). The namespace is UNCLAIMED, so all access is keyless — no
credential exists anywhere: not in the repo, not in the browser, not in
Actions secrets. Nothing can leak.

- **Submit:** validate → GET fresh doc → prepend → POST → backend confirms
  `HTTP 200 {"success":true}` → UI reports success. No redeploy, no Actions,
  no polling. (`js/reviews.js`: `SP_Reviews.submit()` resolves `ok:true`
  only after that confirmation.)
- **Read:** every Reviews open performs a genuine backend GET (newest
  first); stats come from that live data. Verified backend behavior:
  keyless POST creates/overwrites, immediate read-after-write consistency,
  malformed JSON rejected (400), CORS preflight passes for the Pages origin.
- `localStorage` holds **only** a read cache of the last fetched list
  (used solely when the backend is unreachable) plus read-only pre-global
  "legacy" reviews shown separately — never the source of truth.
- Review text is rendered as plain text (`textContent` only). Every fetch
  has a 12 s timeout; failures show "Unable to load reviews. Please try
  again." + Retry while the game keeps working. The UI offers no delete
  button for shared reviews.
- **Honest limits** (inherent to any anonymous public guestbook): spam or
  deletion cannot be cryptographically prevented without user accounts.
  Mitigations: strict validation, bounded doc size, and a daily secret-free
  [backup workflow](.github/workflows/reviews-backup.yml) committing
  `data/reviews-backup.json` on change — see its RESTORE RUNBOOK header.
  If writes ever return 401 (namespace claimed by someone else): rename the
  namespace in `js/reviews-config.js`, redeploy, restore from backup.
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
