# Companion polish update

## Delivered
- Speed-driven 3D walking, alternating planted stance / lifted swing targets, restrained pelvis and shoulder movement, and smooth pose blends.
- Arm reach targets for thinking and tea; level saucer and relaxed finger grip.
- Four registered side-view walk frames for each 2D character. Gentle body movement replaces the front/side pose flicker and elastic walking scale.
- Crimson rebuilt in Seraphina's chibi illustration style across idle, blink, wave, thinking, cheer, tea, sip and walking. Cherry-black bob, ruby eyes, burgundy coat dress, ivory collar and boots.
- Crimson 3D: shorter bob geometry, burgundy tailoring with dark waist panel and brass piping, ivory cravat, reduced hair glare, and hand skin separated from the stocking texture.
- Compact dashboard with character thumbnails, mode, mood and size; opacity and behavior controls under an expandable section. Keyboard tab navigation and visible focus states.
- Fixed missing buildMesh call during 2D character switches, stale 2D preview selection, stale 3D loads, and image bitmap cleanup. Serialized popup preview loading.
- Render loops capped at 30 frames per second; popup animation pauses when hidden and releases resources when closed.

## Checks
JavaScript syntax checks and automated headless Chrome preview checks cover both character rigs and all five 3D poses, walking, 2D model selection, rapid selection changes, static mode, keyboard tabs, 24 sprite loads, eight registered walking frames, and dashboard overflow. Browser extension APIs are simulated for preview checks; this does not replace a pass in a loaded extension on real websites. Frame rate cap is a work limit, not a measured CPU reduction claim.

Run a local server from the project root on port 8765, then `node tests/studio-review.cjs` with Playwright installed. Optional environment variables: PLAYWRIGHT_MODULE, BROWSER_PATH, REVIEW_OUTPUT. Rebuild sprites using `node pipeline/build_character_sprites.cjs` and `node pipeline/build_character_sprites.cjs --seraphina` with Sharp installed (or SHARP_MODULE set).

## Art provenance
Built-in image generation was used for the two source atlases in assets/previews. Final frames live in assets/sprites and assets/sprites/crimson. The sprite builder extracts, registers and normalizes transparent frames at 460 by 600 pixels, preserving the alpha edges.

Prompt brief for Crimson: match Seraphina's crisp chibi cel shading and sticker outline, create a distinct adult companion with a cherry-black bob, ruby eyes, burgundy tailored coat dress, black waist panel, ivory collar and black boots; supply an aligned 4 by 3 atlas of the listed gestures and four left-facing walk phases. Cleanup pass: preserve the artwork and remove background noise outside the cutouts.

Prompt brief for Seraphina: preserve the existing lavender-haired character and navy gold-trim gown exactly, supply four left-facing walk phases at the same scale and baseline on transparent background.

Reload the unpacked extension and refresh existing website tabs to pick up changed scripts and bundled assets.

## Adult evening styling, version 1.1.1
Both built-in 3D models now use a slightly smaller head proportion, tailored waist, an open shoulder neckline with full chest coverage, warmer face grading, controlled hair sheen and softer portrait lighting. Seraphina keeps her navy evening gown; Crimson has a slimmer calf-length burgundy cocktail silhouette. Idle poise adds a subtle asymmetric weight shift, chin tilt, softer gaze and slight smile. Cursor following is slower and smoother. The 2D artwork is unchanged by this styling pass.

Geometry index bounds and JavaScript syntax were checked; both models and their poses were inspected again in the headless browser preview. Reload the extension and refresh existing website tabs to load the updated models.
`nThe evening dresses retain their tailored silhouette by using skinning for fabric movement; incompatible original skirt spring chains were removed. Hair spring motion remains active. Both final rigs and their gestures rendered without runtime errors in the final browser pass.

## Size and locomotion, version 1.1.2
- Size slider expanded from 360 to 1,000 pixels, with S (180), M (320), L (480), XL (720), and Fit (up to 1,000) presets. Existing saved sizes remain available. New installations default to 280 pixels.
- The page overlay fits the requested height within both viewport dimensions, adjusts when the window changes size, and uses the displayed height for dragging, gaze and positioning.
- WebGL and sprite backing buffers have pixel budgets to keep large avatars from allocating unnecessarily large canvases.
- Walking now has a short acceleration ramp and a steady travel speed through the middle of each trip. Stroll distance and duration scale with displayed character height. Drag walking uses measured pointer speed.
- 3D cadence and stride adapt to travel speed, with opposing arm swings, a 50/50 stance and swing cycle, foot lift during swing and matching hip lowering during leg flexion. Reused leg solver buffers avoid allocations in each frame. Rendering can reach 60 fps during walks, with 30 fps for idle animation.
- 2D walking maintains a minimum 1.55 cycles per second instead of slowing almost to a stop at large sizes or low travel speeds. Body stretching remains disabled.

Verification: tests/size-walk-review.cjs checks size presets, persistence through the storage adapter, the actual injected content overlay fitting a 1,000-pixel request to 744 pixels in an 800-pixel window and then resizing to 444 pixels in a 500-pixel window, 2D frame progression at 180/720/1,000 pixels, both 3D renderers accepting 1,000 pixels, finite joint transforms, and supporting ankle height stability over several gait cycles. The 2D renderer advanced 12ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“13 frames over two seconds at all tested sizes. Supporting ankle vertical variation was about 1.3% of leg length in the tested 3D rigs. No runtime errors were recorded. Browser APIs are simulated in these checks; hardware performance on the user's live browser was not measured.

## Matching 2D and 3D character designs, version 1.1.3
The user selected matching chibi proportions. Both built-in 3D assets now have enlarged heads, shorter bodies and legs, and rebuilt rest skeletons and inverse bind matrices. Facial morph deltas, normals, hair chains, collider positions and attached wardrobe geometry were transformed with the rig. The long hairstyle retains its waist-length silhouette. Template braid links were removed and the fringe was swept to match the drawings.

Seraphina: lavender hair, violet eyes, sleeveless navy-and-burgundy gown, muted gold trim, silver/amethyst teardrop earrings, gold-framed amethyst necklace, taupe stockings and dark heels. Crimson: cherry bob, berry eyes, one red bow, ruby earrings, ivory collar and ruby brooch, fitted burgundy coat with long sleeves and lapels, dark waistcoat, gold piping/buttons/floral stitching, charcoal tights and laced ankle boots. Template costume parts and the mismatched footwear were removed. The native coat and accessories have humanoid skin weights and follow poses and walking.

Thinking and tea hand targets recognize the chibi asset marker; imported models retain the adult target calculation. Default expressions were adjusted toward the references' open-eyed, gentle smiles.

Verification: both final avatars and their poses were rendered in headless Chrome; the size and locomotion checks passed again on the rebuilt rigs with no runtime errors. Supporting ankle variation was below 2% of leg length. Structural checks cover indexed geometry, finite skin weights and valid inverse binds. These checks simulate extension APIs and do not measure performance in the user's live browser.

Editable asset builders: pipeline/match_character_designs.py and pipeline/retarget_chibi_rigs.py. Each accepts --source-archive pointing to the corresponding pre-change source archive (entries named seraphina and companion_alt). Character palette and reference metadata are saved in assets/models/character-designs.json.

## Chibi conversion reverted at the user's request
Restored both complete adult-proportion assets from the snapshot taken immediately before the chibi conversion. The matching wardrobe, hair colors, jewelry, bow, collar, stockings and footwear remain. The chibi rest-skeleton and enlarged-head changes are no longer active. Larger size controls and walking improvements remain available. The runtime selects its adult hand targets for these restored assets.

## Secondary body physics, version 1.2.0
Both adult models now have movement-driven chest mass response, torso follow-through, native hair springs, controlled garment hinges, and separate earring/necklace/bow motion where those accessories exist. Four existing chest bones and seven accessory/clothing joints are driven per avatar. Clothing skin weights follow the chest joints so the outfit moves with the body. The incompatible original skirt simulation remains replaced by bounded custom hinges.

Walking footfalls, gestures, clicks, horizontal drag acceleration and vertical drag acceleration drive damped springs. Small breathing motion continues while idle. Chest travel is capped and integrated at 120 Hz substeps. Torso motion affects shoulders, head and arms while the supporting feet retain the walking solver. The adult proportions and character designs remain in place.

Controls: Companion Ã¢â€ â€™ Behavior & performance Ã¢â€ â€™ 3D body physics. Motion intensity defaults to 90%; chest bounce defaults to 100%. Each can be reduced independently. Preview motion triggers the popup character and sends a pulse to the active website companion. Disabling physics resets the secondary bones and pauses native spring simulation. Turning Animation off stops the animation loop and clears motion. Physics controls are hidden in 2D mode.

Verification: physics-check.cjs exercised both rigs through impulses, sustained walking, abrupt horizontal/vertical drags, settling, chest-zero, physics-off and static mode. Each rig resolved 11 owned bones and 65 native hair joints. Chest peak was approximately 2.3% of avatar height in the tested high preset (about 3 cm), returning below 0.1% at idle; no state exceeded its limits and no runtime errors were recorded. physics-ui-check.cjs verified live controls, persistence, pulse delivery, off/zero behavior and 2D hiding. These checks use simulated extension APIs in headless Chrome; live-browser hardware performance was not measured.

Editable implementation: content/secondary-motion.js. Asset builder: pipeline/prepare_secondary_physics.py, using --source-archive with the pre-physics adult model archive. Native bones, skinning and pose rendering are preserved; 2D sprites retain their existing animation system.

## Seraphina adult silhouette and showy evening look, version 1.2.1
Seraphina is presented as an adult woman around 25. The first 3D model now has a visibly fuller bust with increased width and projection, a tailored waist and a subtly fuller hip silhouette. The navy-and-burgundy gown has a fitted sweetheart bodice, exposed shoulders and upper chest, a higher side/front leg slit, brighter embroidery and new gold piping along the actual cut edges. The bodice retains chest coverage.

The skin surface, dress and piping share interpolated skin weights along their joins. The existing chest, cloth, hair and accessory physics remain active. Geometry normals were transformed with the silhouette; new neckline and slit geometry use actual clipped triangles rather than pose-dependent sprite changes. The editable builder is pipeline/style_seraphina_showy.py and accepts --source-archive containing seraphina.vrm.

Validation: both avatars and all existing gestures rendered without runtime errors in the browser preview. Seraphina's stronger motion and settling, physics-off, chest-zero and static-mode checks passed. Indexed geometry, skin weights and joint ranges were checked after the outfit changes. Preview rendering uses simulated extension APIs; reload the extension and refresh existing tabs for the updated asset.


## Coverage, contour and natural walking response, version 1.2.2
Both adult 3D avatars now have a closed, opaque, skinned torso beneath their outfits and rounded shoulder bridges. Body and clothing materials no longer inherit unintended alpha cutouts; hair and eye cutouts remain intact. Crimson's coat back has more clearance, and its sleeve weights follow the arm. Seraphina retains the fuller adult silhouette with a denser conforming torso mesh, rounded contour and smoother bodice fit.

Walking now drives a smaller secondary response with stronger damping. Chest vertical travel is bounded to 1.5% of avatar height, with smaller depth and lateral limits; ordinary walking stays well below that cap. Footfall impulses, torso rocking, clothing sway and accessory forces are reduced together. Click responses are also softened. Existing intensity and chest controls, physics-off reset and static mode remain available.

Editable builders: pipeline/style_seraphina_showy.py (pre-styling archive with seraphina.vrm), pipeline/repair_crimson_coverage.py (pre-repair archive with companion_alt), and shared pipeline/repair_meshes.py. Builders require numpy and Pillow. Run tests/coverage-review.cjs with the local server on port 8765 for both models across front, back, sides, tea, wave and walking views. Coverage tests inspect opacity at skinned torso samples; they do not certify every possible imported model or pose. Tests use simulated extension APIs in headless Chrome.

Verification result: all 2,688 skinned torso opacity samples passed across fourteen model/view combinations. Both assets passed finite position, index bounds, skin weight and joint range checks. At the default tested intensity, vertical chest response peaked around 0.45% of avatar height during walking and 0.63% on a click, then settled below 0.06%. Off, zero-chest, static, live controls, size, 2D cadence and support-foot checks passed; both models rendered all five poses without runtime errors.


## Remaining shoulder and skin openings, version 1.2.3
The earlier torso-only test did not exercise the cut boundaries at the upper arms. Both models now have explicit shoulder-to-arm bridge geometry with exact original boundary positions and weights. Inner rings blend into the chest and shoulder. Nine small skin loops on Seraphina and four on Crimson are capped. Crimson's hidden costume-shaped arm and torso skin and covered waistcoat surfaces are removed to prevent them protruding through the coat. Separate hands, neckline coverage, and the adult silhouette remain. Solid skin, hair, stockings and boots have appropriate double-sided coverage; eye detail cutouts are preserved.

Editable builder: pipeline/repair_surface_gaps.py --source-archive, with pre-1.2.3 source entries seraphina and companion_alt. Rebuilding reproduced the shipped binary hashes. The builder rejects an already repaired source to avoid duplicate geometry.

Validation: tests/surface-opacity-review.cjs checks eight angles in idle, wave, think, tea, celebrate and walking states: 96 model/angle/pose combinations. 58,847 of 58,848 sampled repaired triangle centers passed the opacity cutoff, within the edge tolerance. Comparison against a fully opaque diagnostic differed by at most three edge pixels per model view. Both final assets passed finite position, index, normalized skin weight and joint range checks. The bounded natural-motion, settling, off, zero-chest and static-mode regression also passed. Rendering uses headless Chrome with simulated extension model loading and is not a live installed-extension test. Run with a server on port 8765, PLAYWRIGHT_MODULE and BROWSER_PATH as needed; optional REVIEW_BASE_URL, REVIEW_OUTPUT and REVIEW_POSES customize the test.


## Crimson fitted silhouette, version 1.2.4
Crimson's coat has a narrower waist, softly rounded chest and hips, a tapered hem and slimmer sleeves. Longer garment edges are subdivided with conforming splits before applying a smooth monotone profile, replacing the coarse straight transitions. Body backing, coat lining, vest, lapels, gold trim and buttons follow the same deformation, preserving their fit. Sleeves taper around the actual limb axes while maintaining the cuffs; hidden shoulder backing follows the slimmer sleeves. Area-weighted surface normals and softer toon shading improve the roundness.

The adult skeleton, repaired shoulder joins, accessory joints and bounded natural-motion physics are preserved. Editable builder: pipeline/tailor_crimson.py --source <pre-tailoring VRM> --output <target VRM>. The builder rejects an already tailored source.

Validation: both models rendered across eight angles and six poses (96 combinations), with no runtime errors. The surface opacity check passed within its antialiasing tolerance. Both assets passed finite position, indexed geometry, normalized weight and skin joint checks. Natural-motion bounds, settling, zero-chest, physics-off and static-mode checks passed. Rebuilding the edited source produced the shipped binary exactly. Validation uses headless Chrome and simulated extension loading; live-browser hardware performance was not measured.


## Dashboard and page runtime performance, version 1.3.0
The dashboard no longer starts WebGL or downloads a model when opened. It renders a small static thumbnail and binds controls from local state; Play preview explicitly loads the selected renderer. Preview loading is single-flight, keeps its canvas across 3D character changes, pauses outside the Companion tab, and releases GPU contexts when destroyed. Alert rows and quote editors are preserved when unrelated state changes. Settings edits use a debounced patch queue and serialized background merges so slider echoes do not replace newer edits.

Web pages start with shared defaults, an independent lightweight tab-alert watcher and a bootstrap at document_start. Disabled/hidden companions and unopened background pages defer the render runtime. The notification watcher remains available without loading WebGL. Bundled VRMs load as binary from their extension URLs; encoded message transport remains a compatibility/custom-model fallback. Two-dimensional loading paints idle before loading the remaining sprites and retains the previous painted frame during character transitions. Startup no longer fetches an entire model merely to detect its existence, and unrelated settings changes no longer reset the wellness alarm.

The overlay falls back to a fixed host when opening a popover fails, reattaches its existing renderer after document-root replacement, discards obsolete load callbacks and clears listeners/timers when unmounted. Retry page restarts the companion and can restore 3D after a lost context. Model shapes and the natural walking physics are preserved.

The scripting permission and HTTP/HTTPS host permissions support deferred isolated-world injection over the same ordinary website scope as the earlier content scripts. Browser internal pages, protected browser-store pages and sites where access is withheld remain controlled by Chrome. The API and isolated-world behavior follow Chrome's documentation: https://developer.chrome.com/docs/extensions/reference/api/scripting and https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts .

Validation used the actual unpacked extension in a fresh Chrome for Testing profile. Opening the dashboard requested zero VRMs or WebGL bundles, its static preview stayed unchanged across screenshots, and 50 slider input events produced one persisted write. Background title alerts worked before renderer startup. Tests cover strict CSP, a slow page whose load event is still pending, document replacement, blocked popovers, 2D/3D upgrades, lost-context fallback and retry recovery. The public example.com and wikipedia.org pages rendered the 3D companion. Dashboard/quote/alert persistence, keyboard navigation, size and gait checks, both character rigs and all five gestures passed with no runtime errors. Native tab visibility did not change in headless Chrome, so visibility branches were also tested with a controlled isolated-world signal. Local timings are observations rather than performance guarantees.

Re-run: python tests/runtime-fixture-server.py, then node tests/runtime-performance-review.cjs with Playwright and a Chromium/Chrome for Testing executable supporting unpacked extensions. Optional PLAYWRIGHT_MODULE, BROWSER_PATH, EXTENSION_DIR, REVIEW_BASE_URL and REVIEW_OUTPUT configure the test. It creates a fresh isolated browser profile under its output folder. Other reviews accept REVIEW_BASE_URL; the fixture server defaults to port 8766. Regenerate static thumbnails with pipeline/build_dashboard_thumbnails.cjs when model artwork changes.

Reload the unpacked extension and refresh existing website tabs to activate the new scripts and permissions.
