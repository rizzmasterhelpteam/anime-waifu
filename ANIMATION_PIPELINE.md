# Dance assets and playback

The 2D dance now uses actual video-derived frames, not a celebration sprite with an oscillator. Each character has one 10-second, 24 FPS primary sequence, stored as ten transparent WebP atlases. Each page has 24 cells of 320×420 pixels. Fixed scaling and registration preserve movement without per-frame resizing. Largest-component masking excludes detached background marks; chroma keying and edge despill remove the green screen. Originals are untouched.

Decoded playback retains the current and next page (1920×1680 RGBA each: approximately 24.6 MiB combined). Pages load only when a dance is requested, not during dashboard or companion startup. The first two pages must decode before the action clock starts. A missing page returns to idle with a development warning rather than playing the old bounce. Closing/hiding, changing model, Calm, focus sessions and direct manipulation cancel playback. Entry/exit use a 250 ms blend. Video design differences, including Crimson's stockings, remain visible; no claim of pixel-identical reconstruction is made.

The 3D clips are authored humanoid keyframes exported directly to animation-only GLB. They are reconstructed choreography, not extracted mocap or an exact reproduction of the source dance. Tracks cover hips, spine, chest, neck/head, arms/hands, thighs, knees and feet. The player uses Three.js AnimationMixer and the existing rest-world bone adapters to retarget to normalized VRM joints. Old body oscillators do not drive dance poses. Facial expressions and spring-bone simulation remain active. The revised `dance-v2.glb` clips add step-touch foot placements, alternating swing-foot lifts, knee/ankle articulation and a translated pelvis track, with eased keys between beats. Each GLB is approximately 97 KB. No paid service, new account or runtime Blender dependency is required.

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

Rebuilding every unsuitable shot as a separate 2D clip would add redundant assets and identity changes. Only the primary pair ships; the other four inform reconstruction rather than being concatenated or represented as additional finished dances. Other actions use the shared behavior scheduler.

## Walking and gardening

`pipeline/smooth_walk_frames.py` builds 24 registered 320x420 walk frames from each character's four original side-view poses. Bidirectional DIS optical flow warps premultiplied RGBA images offline. Each intermediate uses one warped source instead of cross-fading silhouettes, avoiding doubled limbs. One transparent 1920x1680 WebP atlas per character loads on the first walk (about 12.3 MiB decoded). The runtime draws this cycle at a speed-related cadence with 60 Hz transform updates. This improves continuity within the existing artwork; optical-flow warping can still distort small details and is not a newly hand-drawn rig.

3D walking separates planted stance (56% of a cycle) and swing (44%), with bounded foot clearance, heel/toe roll, narrow inward steps and restrained arm swing. IK uses the avatar's measured leg segments. Full-viewport movement remains handled by the existing two-axis path scheduler.

Gardening runs for 16 seconds: soil/pot appears first, watering runs from 1-6 s, growth from 6-11 s, and the companion straightens, looks toward the user and comments at 13 s. Both render modes share the SVG prop timeline; 3D adds joint-driven bending/arm movement and 2D uses a whole-sprite lean. The watering can is an overlay rather than a hand-constrained 3D object. Calm, hiding, focus sessions and cancellation stop the sequence and prevent delayed speech.

## Reproduce and verify

- `python pipeline/process_dance_videos.py <source-folder>` requires Python, NumPy, Pillow, imageio and imageio-ffmpeg. It generates atlases and per-character manifests, leaving the videos untouched.
- `python pipeline/author_dance_clips.py` regenerates the compact GLB keyframes using only Python's standard library.
- `python pipeline/smooth_walk_frames.py` requires NumPy, Pillow and opencv-python-headless; it regenerates both walk atlases.
- `npm run test:motion` verifies soil/water/growth/reveal order, cancellation, bounded gardening bend, planted stance and swing clearance.
- `npm run test:dance` parses both GLBs with the shipped loader, checks meaningful rotations, runs all atlas page transitions, verifies cache bounds and closes decoded image resources.
- `npm run test:behavior` checks personality timing and mode/control regressions.

Browser review covered both transparent 2D characters and both retargeted 3D characters. The 2D video sequences contain generated-art variation, and the 3D reconstruction is an authored interpretation. These limitations should remain explicit when adding future clips.
