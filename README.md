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
- Saves + reviews persist in `localStorage` (per browser/device)

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
| `js/reviews.js` | localStorage reviews                 |
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

## Reviews

Stored in `localStorage`, so they persist per browser/device but are
**not shared** between visitors. The UI already says this. A future server
version can swap the `SP_Reviews` module for an API without touching the UI.

## License / assets

- All code, art, and audio are original creations of BundLal Studios.
- No third-party game assets. Fonts (Baloo 2 + Nunito) are SIL Open Font
  License 1.1 via Google Fonts.
- © 2026 BundLal Studios.
