# Animation assets and playback

## Active native 3D pipeline (1.10.0)

Seraphina and Crimson now use `authored-actions.glb`, one compact library per avatar. Nine authored clips drive idle, walking, dancing, waving, thinking, tea, celebration, gardening, folded-arm reactions, rest and plant presentation. The complete 3D performance replaces the earlier procedural native-VRM pose stack and video-estimated dance. The starter/custom GLB fallback retains its separate legacy renderer.

Sources are the free CC0 Standard editions of [Quaternius Universal Animation Library](https://quaternius.itch.io/universal-animation-library), [Universal Animation Library 2](https://quaternius.itch.io/universal-animation-library-2) and [KayKit Character Animations Free 1.1](https://kaylousberg.itch.io/kaykit-character-animations). `assets/animations/AUTHORED-SOURCES.json` records input hashes and source identifiers; `AUTHORED-LICENSES.txt` preserves the supplied licence notices. Originals remain in ignored `work/authored-motion/`.

`pipeline/retarget_authored_actions.py` reconstructs each source skeleton's animated and rest world rotations. It transfers their difference into the normalized VRM hierarchy, accounting for intermediate source joints such as wrists. This preserves forearm depth rotation, wrist orientation and coordinated torso/leg motion instead of estimating hidden joints from 2D images. It measures the actual shipped target rigs for root-height fitting with heel/toe sole proxies. Source foot roll and small airborne clearance survive. Idle is rebased from the library's combat-ready stance to a narrower, relaxed pose with open hands; relative authored breathing/weight-shift motion remains.

Clips are sampled at 30 Hz and reduced within 0.08 degrees angular and 0.0002 leg-length positional tolerances. Identical accessor data is shared. Only mismatched loop joints receive a short seam easing; already closed locomotion tracks remain unchanged. The resulting libraries are 248,804 bytes for Seraphina and 249,132 bytes for Crimson.

`content/authored-motion.js` loads with the 3D renderer and selected model. It applies complete quaternion poses directly, with one 450 ms whole-pose handoff on action changes. It does not run the old native procedural IK, per-joint damping or Euler hinge clamps. Native VRM expressions and spring simulation still run. Gaze is a small optional head/eye response, and user orbit remains independent of walking direction. The static-animation setting samples a settled pose rather than freezing a partial transition. No motion inference, Python process, remote API or paid service runs in the extension.

The normal `Walk_Loop` provides arm swing and coordinated steps. Its measured foot travel, duration and target rig height determine the natural pixel speed. The page path extends its travel duration when necessary, so it does not slide a slow walk rapidly across the viewport. Cadence can adjust modestly with speed. Both characters retain adult proportions.

Gardening lasts 16 seconds: the pot appears first, standing watering runs from 1-7.2 s, growth from 7.2-11.8 s, then a presentation gesture and the shared 13 s comment. The can follows the hand; its spout pours toward the soil in a 3D pot. The plant grows in stages. `showPlant` presents an already grown plant. The 3D scene owns these props, creates them on demand and releases geometry/materials when the model changes. A cancellable timer handles reveal text; no hidden 2D SVG animation runs for 3D. Calm, hiding, focus sessions and cancellation stop props and delayed speech.

These are stylized authored game animations adapted to the two clothed avatars, not an exact recreation of the supplied 2D video or a cloth simulation. The fitted outfits and different proportions still require visual review when adding extreme poses. A passing numerical test is not a judgement of animation quality.

Gardening stays upright: the deep kneeling source clip is excluded because it does not suit the fitted gown. The lower gown and its gold trim are reweighted from independent cloth joints to a normalized hip/thigh/calf blend so they follow stepping legs; their rest geometry is unchanged. A thin opaque fabric underlap, derived from each model's continuous torso skin and sharing its skeleton/weights, covers garment panel gaps during bends. It leaves the neckline intact and is disposed with the model; it does not add a rigid torso shell or alter the VRM files.

## 2D assets and behavior

Each character keeps its 10-second, 24 FPS primary dance sequence derived from the supplied green-screen video, stored as ten transparent WebP atlases. Each page contains 24 cells of 320x420 pixels. Fixed scale and registration preserve body proportions. Largest-component masking, chroma keying and edge despill remove the surrounding green screen; original videos remain untouched.

Playback retains only the current and next atlas page (about 24.6 MiB decoded together). Dance pages load on demand; the first two must decode before the action clock starts. Closing/hiding, Calm, model changes, focus sessions and direct manipulation cancel playback. Entry/exit use a 250 ms blend. Video design differences remain visible. The 3D dance now uses different authored choreography.

2D walking draws the four clean registered source poses with fixed aspect ratio, full opacity and rigid transforms. Screen translation updates at 60 Hz. There is no optical-flow warping or perspective deformation during locomotion. Additional drawn poses would be needed for finer leg articulation.

2D gardening keeps its existing SVG/whole-sprite timeline: soil/pot, watering, growth, then the look/comment at 13 seconds. Both modes continue using the same local personality brain, Calm/Playful controls, action selection and interruption rules.

## Supplied video disposition

All six reviewed files were 10 seconds, 1080x1920 and 24 FPS. The two `Person_dancing_on_green_screen_*` videos remain the primary 2D sequences. The four `Animated_character_*`/`dance_*` files informed earlier visual review; they are not shipped as additional finished dances. Video tracking inputs and the old retargeting tools remain available for the legacy GLB fallback and historical experiments. They no longer drive the native VRM avatars.

## Reproduce and verify

- Put the recorded source glTF/bin, UAL2 Standard GLB and KayKit Rig_Medium Simulation GLB at the paths listed in `AUTHORED-SOURCES.json`, under `work/authored-motion/`, then run `python pipeline/retarget_authored_actions.py`. It requires NumPy and SciPy, plus the existing pipeline's dependencies. The script does not modify the character VRMs.
- `python pipeline/process_dance_videos.py <source-folder>` rebuilds the unchanged 2D atlases from the original videos.
- `npm run test:dance` tests 2D/legacy playback and resource cleanup, then parses both authored libraries, checks complete joint tracks, normalized quaternions, loop continuity and the preserved 3D elbow plane.
- `npm run test:motion` checks the shared gardening timer, legacy GLB gait and 2D walk stability, then runs production native motion through all twelve action paths on skeletons measured from both shipped VRMs. It checks source-pose preservation after handoff, sole penetration, props, growth, interruption, static poses, turns and cleanup. Calls into the old procedural clamp/IK functions are test failures.
- `npm run test:behavior` checks activity rarity, cooldowns, continuous scheduling, mode semantics, viewport bounds and stride-paced 3D travel.

Serve the repository with `python tests/runtime-fixture-server.py`. `/tests/all-3d-actions.html` displays both actual clothed VRMs with playback, pose/soil/watering/growth/reveal checkpoints, orbit views and a contact sheet. Review continuous movement as well as still poses. `/tests/reference-dance.html` compares the 2D video and new authored 3D choreography; it does not claim frame-for-frame matching.
