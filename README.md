# Anime Waifu Companion

A Manifest V3 Chrome extension featuring Seraphina and Crimson in animated 2D and adult-proportion 3D modes. Current version: **1.10.0**.

## Features
- Draggable companions with gestures, walking, adjustable size and opacity, and per-site visibility.
- Distinct character designs, fitted outfits and bounded secondary motion for 3D avatars. Seraphina includes fitted opaque black briefs beneath her gown for orbit-view coverage.
- A compact dashboard with a static thumbnail and optional live preview.
- Focus/break timers, editable speech bubbles and background tab notifications.
- Deferred renderer loading, direct binary model fetching, automatic 2D fallback and page retry.
- Local settings and bundled assets, plus optional Supabase accounts, settings sync and Gemini 3.8 Live voice conversations. See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for required provider credentials.

## Personality behavior

Both render modes share a local, code-only personality brain. **Playful** (default) continuously chooses activities, starting after roughly three seconds and taking short 3–6 second pauses between completed actions. Internal baseline weights are walk 70, dance 15, garden 10 and rest 5; these weights are developer configuration, not UI controls. Dance/garden/rest have 45/60/90 second cooldowns and avoid consecutive repeats. Actual choices vary with cooldowns and movement availability. Seraphina stays graceful and teasing; Crimson is livelier and dramatic. Attention still influences brief pouts and touch reactions independently of activity selection.

Walking wanders across the whole available browser viewport, including diagonal and vertical travel. Five candidate destinations favour meaningful journeys while keeping the entire character within the current window. Travel uses a single accelerated/decelerated two-axis transform; movement speed and gait follow actual path length. Changing window size clamps the path. Page stroll can still be disabled in behavior settings.

**Calm** keeps the companion standing idle with natural blinking/breathing. It does not walk, dance, garden or perform notification gestures; notification text can still appear. Tapping in Calm acknowledges the user without starting movement. Playful pauses during focus/break timers, hidden tabs, dragging, fullscreen blocking and disabled animation. It does not stop merely because the user has been inactive for five minutes. Automatic activity bubbles are rate-limited to avoid chatter after every walk or action.

Only Calm and Playful appear in the dashboard and character toolbar. Mode selections are synchronized. Both modes share the personality brain and activity timings. 2D retains its transparent video-derived dance and four intact walking poses; original bitmap proportions and opacity remain fixed while walking.

Both native 3D models now use complete authored skeletal clips, retargeted from the CC0 Quaternius and KayKit libraries. One coordinated body performance drives each action, with a 450 ms whole-pose transition. The former native 3D procedural pose stack, video-estimated dance and per-frame Euler/hinge overrides are bypassed. Forearm rotation, wrist motion, torso balance, foot roll and fingers retain their authored 3D relationship. The relaxed idle pose is adapted to the fitted outfits. 3D choreography differs from the 2D video.

3D walking uses the normal authored walk with arm swing. Screen travel is paced against the measured stride, including diagonal journeys, and heading changes ease into the new direction. Gardening uses authored standing watering motion, a hand-following 3D can, soil/pot, staged growth and a final presentation gesture. Calm, interruption and model changes clean up props and delayed reveal text. No API or paid service runs these animations.

See [ANIMATION_PIPELINE.md](ANIMATION_PIPELINE.md) for sources, processing and limitations. `npm run test:behavior` verifies weighted selection, cooldowns, continuous scheduling, pause semantics and viewport bounds; `npm run test:dance` verifies 2D/legacy playback, authored clip loops and 3D joint data; `npm run test:motion` checks full rig motion across all 12 actions on both measured rigs, gardening, static poses, cancellation and 2D walk stability.

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
Install Playwright for browser checks. Asset-generation scripts may also require Sharp, NumPy, Pillow and OpenCV; these are not extension runtime dependencies.

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
