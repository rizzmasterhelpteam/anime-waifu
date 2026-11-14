# Anime Waifu Companion

A Manifest V3 Chrome extension featuring Seraphina and Crimson in animated 2D and adult-proportion 3D modes. Current version: **1.4.0**.

## Features
- Draggable companions with gestures, walking, adjustable size and opacity, and per-site visibility.
- Distinct character designs, fitted outfits and bounded secondary motion for 3D avatars.
- A compact dashboard with a static thumbnail and optional live preview.
- Focus/break timers, editable speech bubbles and background tab notifications.
- Deferred renderer loading, direct binary model fetching, automatic 2D fallback and page retry.
- Local settings and bundled assets, plus optional Supabase accounts, settings sync and Gemini chat. See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for required provider credentials.

## Install
1. Clone or download this repository.
2. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
3. Choose **Load unpacked** and select the repository root containing `manifest.json`.
4. Pin the extension and open a regular HTTP/HTTPS website.

After updating, reload the extension and refresh existing website tabs. Browser-protected pages and sites where access is withheld remain subject to browser restrictions.

## Development
The runtime is plain JavaScript and requires no build step.

| Directory | Purpose |
| --- | --- |
| `content/` | Startup, tab monitoring, animation and page overlay |
| `popup/` | Dashboard and controls |
| `shared/` | Defaults and custom-model storage |
| `assets/` | Models, sprites, thumbnails and icons |
| `vendor/` | Bundled Three.js/VRM runtime |
| `pipeline/` | Editable asset builders and repair tools |
| `tests/` | Browser and runtime regression checks |

## Verification
Install Playwright for browser checks. Asset-generation scripts may also require Sharp, NumPy and Pillow; these are not extension runtime dependencies.

Start the local test server:
```powershell
python tests/runtime-fixture-server.py
```

Run the actual unpacked-extension review with Playwright Chromium or Chrome for Testing:
```powershell
node tests/runtime-performance-review.cjs
```

Optional environment variables: `PLAYWRIGHT_MODULE`, `BROWSER_PATH`, `EXTENSION_DIR`, `REVIEW_BASE_URL` and `REVIEW_OUTPUT`. The fixture server uses port 8766. Other reviews include `studio-review.cjs`, `size-walk-review.cjs` and `physics-ui-check.cjs` in `tests/`; set `REVIEW_BASE_URL=http://127.0.0.1:8766` to use that server.

See [STUDIO_UPDATE.md](STUDIO_UPDATE.md) for implementation notes, asset provenance, verification and limitations.

## Credentials
Keep private API keys, Supabase secret/service-role keys, environment files and browser profiles out of Git. Future AI credentials belong in backend secrets, not extension source.
