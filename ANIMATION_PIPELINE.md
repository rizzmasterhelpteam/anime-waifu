# Dance assets and playback

The 2D dance now uses actual video-derived frames, not a celebration sprite with an oscillator. Each character has one 10-second, 24 FPS primary sequence, stored as ten transparent WebP atlases. Each page has 24 cells of 320×420 pixels. Fixed scaling and registration preserve movement without per-frame resizing. Largest-component masking excludes detached background marks; chroma keying and edge despill remove the green screen. Originals are untouched.

Decoded playback retains the current and next page (1920×1680 RGBA each: approximately 24.6 MiB combined). Pages load only when a dance is requested, not during dashboard or companion startup. The first two pages must decode before the action clock starts. A missing page returns to idle with a development warning rather than playing the old bounce. Closing/hiding, changing model, Calm, focus sessions and direct manipulation cancel playback. Entry/exit use a 250 ms blend. Video design differences, including Crimson's stockings, remain visible; no claim of pixel-identical reconstruction is made.

The 3D `dance-natural.glb` clips start from the same primary video frames and timestamps used by 2D playback. Offline conditioning repairs unreliable motion before shipping: Seraphina's 6.25–7.8 s spin and Crimson's 7.45–8.85 s spin become modest turns between reliable poses. Torso lean, wrist rotation and leg spread are constrained; elbows and knees use anatomical hinges. Quaternion smoothing and angular-rate limits remove abrupt joint flips. Foot counter-rotation and support height are rebuilt afterward to retain level soles and floor contact.

Tracks cover torso, head, arms, all finger joints, thighs, knees, feet and root translation. Redundant keys are removed within 0.12° rotation and 0.0003 leg-length translation tolerances from the conditioned 24 Hz samples. The resulting files are 104,528 bytes for Seraphina and 123,056 bytes for Crimson, 52% and 43% smaller than the previous clips. They load only when dancing. Playback caches rig bindings and applies normalized VRM quaternions directly, avoiding per-joint Euler conversions each frame. A 600 ms smooth entry/exit blends with the current base pose. No pose-estimation model, Python process, API or paid service runs in the extension.

The offline process uses MediaPipe Pose Landmarker heavy for body landmarks and estimated depth, then confidence interpolation and a short jitter filter. It detected all 240 Seraphina frames. Crimson needs a proportion-adjusted inference image to detect her large-head artwork; the coordinates are mapped back afterward. Her first 14 standing frames are held from the earliest reliable detection. Neither source artwork nor the adult 3D avatar proportions are modified.

Automatic arm tracking is insufficient where hands overlap the face or dress. `pipeline/motion/source-arm-corrections.json` contains source-frame shoulder, elbow and wrist annotations every half second, with bidirectional optical-flow tracking between those anchors. Hidden arms during the turn retain the body track. Corrected, filtered landmarks are saved alongside the annotations so the shipped clips can be rebuilt without inference weights or access to the original videos.

Retargeting measures each actual VRM rig. Two-bone arm IK adapts source hand targets and elbow hints to the adult rig's proportions, with forward clearance to reduce torso intersections. Feet retain heading while keeping soles level; root height follows the lower support ankle. Source hand-shape and wink intervals are annotated separately. Hands reset to rest and asymmetric blink channels clear when dancing stops.

This is **not an exact recovery of a hidden 3D performance**. Single-view depth, obscured joints, finger details, source-art inconsistencies and different body proportions remain approximate. Source gesture timing remains recognizable, but unreliable full spins and extreme poses are deliberately replaced for steadier movement. Hand shapes are timed pose cues, not full finger motion capture. Hair and clothing use the existing spring simulation.

## Source review and disposition

All six supplied files are 10 seconds, 1080×1920, 24 FPS. Reviewed source frames and primary extraction intermediates stay under ignored `work/` and outside the shipped extension.

| Source basename | Use |
| --- | --- |
| `Person_dancing_on_green_screen_8cbd46c3_1080p.mp4` | Seraphina primary 2D sequence, 0–10 s. Includes a turn around 7 s; full body remains visible. Main pose/timing reference for reconstruction. |
| `Person_dancing_on_green_screen_76c716b8_1080p.mp4` | Crimson primary 2D sequence, 0–10 s. Full-body steps and hand gestures. Main pose reference for reconstruction. |
| `Animated_character_dancing_grace…_3034f990_1080p.mp4` | Seraphina crossed-step and open-arm references. Taller proportions excluded from direct 2D playback. |
| `Animated_character_performing_dance_a9437b57_1080p.mp4` | Crimson alternating steps, face gestures and hands-on-waist references. Shaded background excluded from direct playback. |
| `dance_b2c114b1_1080p.mp4` | Seraphina expression/flourish reference. Stage background and leg close-up around 4 s excluded from extraction. |
| `dance_7a2d1714_1080p.mp4` | Crimson cheeky expressions and hand gestures. Stage lighting and face close-up around 5–6 s excluded from extraction. |

Rebuilding every unsuitable shot as a separate 2D clip would add redundant assets and identity changes. Only the primary pair drives the latest retargeted clips. The other four were visual references in earlier reviews; they are not concatenated into this timeline or represented as additional finished dances. Other actions use the shared behavior scheduler.

## Walking and gardening

2D walking draws the four registered original 460x600 PNG poses directly: contact, pass, opposite contact, opposite pass. The sprite aspect ratio stays fixed, with full opacity and rigid transforms. Screen movement updates at 60 Hz; each complete pose is selected at the speed-related gait cadence. Perspective bending and nonuniform scaling are disabled during locomotion. The cycle contains four drawn poses; additional drawn poses are needed for finer leg animation.

The old optical-flow atlas, loader and builder have been removed because inferred frames warped the dress and limbs. Walking reuses already-loaded sprites, eliminating the additional atlas download and roughly 12.3 MiB decoded cache per active character.

3D walking separates planted stance (56% of a cycle) and swing (44%), with bounded foot clearance, heel/toe roll, narrow inward steps and restrained arm swing. IK uses the avatar's measured leg segments. Full-viewport movement remains handled by the existing two-axis path scheduler.

Gardening runs for 16 seconds: soil/pot appears first, watering runs from 1-6 s, growth from 6-11 s, and the companion straightens, looks toward the user and comments at 13 s. Both render modes share the SVG prop timeline; 3D adds joint-driven bending/arm movement and 2D uses a whole-sprite lean. The watering can is an overlay rather than a hand-constrained 3D object. Calm, hiding, focus sessions and cancellation stop the sequence and prevent delayed speech.

## Reproduce and verify

- `python pipeline/process_dance_videos.py <source-folder>` requires Python, NumPy, Pillow, imageio and imageio-ffmpeg. It generates atlases and per-character manifests, leaving the videos untouched.
- `python pipeline/retarget_dance_clips.py` (or the compatibility entry point `author_dance_clips.py`) regenerates both GLBs from committed landmark data and the shipped VRMs. Requires NumPy, SciPy, Pillow and OpenCV.
- To re-extract the original sources, run `process_dance_videos.py` first, download the [official MediaPipe heavy model](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task) into ignored `work/pose-tracking/pose_landmarker_heavy.task`, run `python pipeline/track_dance_video.py`, then `python pipeline/retarget_dance_clips.py --import-tracking`. This additionally requires MediaPipe; inference weights remain outside the extension.
- `npm run test:motion` verifies soil/water/growth/reveal order, cancellation, bounded gardening bend, planted stance and swing clearance. It also runs the production 2D renderer across both characters, both directions and three sizes, checking complete source poses, aspect ratio, opacity and rigid scaling.
- `npm run test:dance` parses both GLBs with the shipped loader, samples joint speeds and knee hinges at 60 Hz, and checks gentle heading changes, sole orientation, support contact, distinct gestures and finger/wink cues. It verifies normalized VRM playback, cached bindings, fade continuity and cleanup, plus all 2D atlas page transitions and the decoded cache bound.
- `npm run test:behavior` checks personality timing and mode/control regressions.

Serve the repository with `python tests/runtime-fixture-server.py`, then open `/tests/reference-dance.html` for a synchronized 2D/3D comparison with character selection, playback and timestamp checkpoints. The fixture uses the production players and VRM renderer. Browser review covered both characters, gesture checkpoints and continuous playback. Generated-art variation and monocular depth limitations should remain explicit when adding future clips.
