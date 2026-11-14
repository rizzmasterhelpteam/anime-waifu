# Anime Waifu Companion

A Manifest V3 Chrome extension featuring Seraphina and Crimson in animated 2D and adult-proportion 3D modes. Current version: **1.7.1**.

## Features
- Draggable companions with gestures, walking, adjustable size and opacity, and per-site visibility.
- Distinct character designs, fitted outfits and bounded secondary motion for 3D avatars.
- A compact dashboard with a static thumbnail and optional live preview.
- Focus/break timers, editable speech bubbles and background tab notifications.
- Deferred renderer loading, direct binary model fetching, automatic 2D fallback and page retry.
- Local settings and bundled assets, plus optional Supabase accounts, settings sync and Gemini 3.8 Live voice conversations. See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for required provider credentials.

## Personality behavior

Both render modes share a local, code-only attention brain and choreography. Playful progresses through relaxed waiting, gardening with a plant prop, a short dance, a brief playful pout and a longer independent recovery. A fresh Playful mount performs an introductory dance after about six eligible seconds and attempts a walk after about twenty seconds. Subsequent attention stages use randomized 90–120 seconds of eligible time; recovery lasts 4–6 minutes. Seraphina is relaxed and teasing; Crimson is more dramatic and energetic. A tap during a pout can trigger one bounded sidestep and a short look-away cooldown, followed by normal interaction. Tapping during gardening acknowledges the user with the plant.

Choose **Playful** (default: autonomous activities and attention reactions) or **Calm** (peaceful idle, combining the old Stay/Quiet controls). Auto and the separate frequency control have been removed. Existing Auto/Balanced preferences migrate to Playful; Calm preferences are preserved. Tap the character to interact. The dashboard and character toolbar expose only Calm and Playful; walking, dancing and gardening are selected automatically by Playful, with no separate activity buttons. Playful re-enables movement and page stroll, greets immediately, and makes an introductory dance eligible after six seconds, followed by a walk. Mode controls report connection failures. Mode selections match between the dashboard and page toolbar. Attention progression pauses during focus/break sessions, dragging, movement, hidden tabs, full-screen blocking, five minutes without page activity, and disabled animation. Mouse movement indicates device activity but does not count as affection. Manual clicks and drags count as attention. Notifications retain their factual content with character-specific bubble wording. While typing, automatic chatter and strolls are deferred; background mood progression continues. No API calls or payment changes are involved.

Both renderers share behavior timing. Dance now uses 24 FPS transparent video-derived frames in 2D and authored GLB skeletal tracks in 3D, replacing the celebration-and-bounce substitute. Other activities retain their existing rendering. The garden is a lightweight SVG prop rather than a new 3D environment. Brain state is session-local: it does not yet persist mood or plant growth across reloads. `npm run test:behavior` verifies the state machine, pause semantics, cooldowns, shared motion bounds and untouched automatic startup. Visible tabs do not require window focus. Walking checks the opposite direction when an edge blocks the initial choice and retries promptly when movement is unavailable.

See [ANIMATION_PIPELINE.md](ANIMATION_PIPELINE.md) for source selection, reproducible processing, playback budgets and limitations.

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
