# Zack: editable Three.js model

This project reconstructs `Zack 3D V2.glb` as native Three.js `BufferGeometry`, a `SkinnedMesh`, and a named skeleton. The model module does not load the GLB. Extracted arrays, rig metadata, and the original texture live in `public/model/`.

This is a geometry conversion, not a newly authored parametric character. It preserves the source topology and UV seams, with a small runtime hand-seam repair described below. Hair, clothing, eyes, and body are part of one textured mesh; they are not separate editable objects.

## Preview

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173/. Orbit, zoom, inspect clay/wireframe surfaces, show the skeleton, pose the head/shoulder, and export a native Three.js JSON scene.

The viewer starts with **Hands down** and **Gentle poses** enabled. Choose **Hands front** or **Hi** for the other poses, or **T-pose** to inspect the rest pose. Shoulder rotations use character-space arm directions and coordinated clavicles rather than the imported bone's oblique local axes. The gentle wave uses a more open arm and shares a small amount of palm rotation with the upper arm, preserving the palm-forward, thumb-inward orientation while reducing elbow pinching. Bind geometry is retained; chest skin weights are corrected to prevent the arms pulling the torso inward.

Gentle controls limit head yaw to ±30°, elbow flex to 60°, and arm elevation to 115° from arms-down. They restore all original bone scales and translations on pose selection. Turning **Gentle poses** off restores the earlier pose shapes and ±45° head control for comparison. These limits apply to the rig controller; direct edits to exposed bones can bypass them. Skinning still changes the surface during bends—the mode reduces visible collapse but does not guarantee zero deformation or prevent every intersection. No volume bulges, morphs, topology changes, or bone stretching are used. `rig.setConservativeMode(false)` is the API equivalent of disabling the checkbox.

```js
import { createZackRig } from './ZackRig.js';
const rig = createZackRig(zack); // Create once, before posing.
rig.setPose('down'); // Also: front, hi, rest, elbows, twist, lean, bow, knee.
```

Pose screenshots and self-contained Three.js scenes are in `artifacts/poses/`. Pose selection is immediate. The Mocap animation section loads the imported preset collection from `public/animations/preset-mocap.glb`, then retargets each clip onto Zack's skeleton the first time it is selected and crossfades between cached actions. **Static** returns to the selected pose.

The timeline below the viewport provides **Play/Pause**, current time and duration, and a draggable playhead. Scroll over the ruler to move horizontally and use **− / +** to zoom. Scrubbing updates the pose immediately and preserves the playback state; Home/End jump to the endpoints while the scrubber is focused. Space toggles playback outside form controls. Selecting a new clip starts playback; selecting Static disables the timeline. Run `node scripts/verify-timeline.mjs` with the dev server running for desktop/mobile playback and scrubbing checks.

The viewer provides **Arms down**, **Arms forward**, **Right-hand wave**, **T-pose**, **Bend elbows**, **Torso twist**, **Side bend**, **Bend forward**, and **Right knee lift**. Each preset describes the joints it exercises below the buttons. Enable **Skeleton** and orbit or zoom to inspect the bends. These are static deformation checks, not balanced animation poses: the raised leg is not ground-constrained. Switching presets restores all bone transforms before applying the next pose, and preserves the head-turn slider. The exported `POSES` registry in `src/ZackRig.js` defines the available names, labels, and descriptions. `src/MocapController.js` owns lazy clip retargeting, action caching, and transitions; `loadMocapAnimations()` in `src/MocapAnimations.js` remains the eager-loading helper for another Three.js scene. Source-specific retarget settings live in `src/mocapConfig.js`. Run `node scripts/verify-poses.mjs` for standalone preset checks.

The model factory moves the source shoulder pivots outward by 0.03 scene units per side, down by 0.015, and forward by 0.004 to better center them within the sleeve caps. It compensates child bone positions and inverse bind matrices so the rest mesh and elbow positions stay unchanged. Upper-arm twist-helper midpoints and endpoints are aligned with the corrected shoulder-to-elbow axis. `root.userData.shoulderCorrections` and `root.userData.armHelperCorrections` record the changes. Reset uses the corrected rig. Run `npm run audit:shoulders` for the structural and bind-matrix checks; see `SHOULDER_AUDIT.md` for findings and limitations.

Static poses use the fitted clavicle directions as their base. Arms down and the relaxed sides of other presets add a gentle downward shoulder slope, closer to the imported Idle animation; reaching and waving add lift explicitly. This prevents the old almost-horizontal collarbone target from shrugging the shoulders after the skeleton adjustment.

Raised-arm rotation (especially **Angry 01**) now uses the eight existing upper-arm and forearm twist helpers, which previously had no skin weights. `src/armTwist.js` distributes the sleeve weights along three rotation frames per segment. The upper sleeve follows the arm swing while axial roll increases toward the elbow; forearm roll increases toward the wrist. Forearm helper pivots are aligned with the elbow-to-wrist axis with inverse-bind compensation. Main joint transforms, motion timing, and the rest surface are retained. Weights use at most four normalized influences, including matching weights across UV seams. `root.userData.armTwistWeights` records the affected vertices.

Static presets update the helpers through `rig.setPose()`. Mocap clips bake helper quaternion tracks after retargeting, so playback, crossfades, and exported clips use ordinary Three.js animation tracks. For manual bone edits, call `zack.armTwist.update()` afterward. Run `npm run test:arms` with the dev server running to check 120-degree twist cases, all 43 mocap clips against the original main-joint tracks, transitions, and a posed JSON round trip. Before/after Angry 01 captures are in `artifacts/arm-audit/`.

Elbows separate hinge flex from forearm roll. The added `ElbowBlend` frames carry swing only at the hinge; the forearm twist frames progressively add elbow and wrist roll at 50% and 100% toward the wrist. This avoids putting the full forearm roll directly into the elbow seam. `src/refineElbowWeights.js` paints a 0.05-unit outer bend transition and a tighter 0.04-unit inner transition, keeping the sleeve sections straighter and allowing the inside to compress and overlap. Two `ElbowRound` frames share the bend only on the outer sleeve to round its silhouette. All helper motion is baked into ordinary quaternion tracks. `root.userData.elbowWeightCorrection` and `root.userData.elbowBlendWeights` record the adjustments. Positions, normals, UVs, vertex count, and triangle indices remain exactly unchanged by the elbow work. Run `node scripts/inspect-elbows.mjs` to capture **Frustrated 02** around 5 seconds in `artifacts/frustrated-elbow/after/`.

Chest vertices are anchored to the spine by removing leaked arm/clavicle weights in the torso center and smoothly restoring those influences toward the sleeve caps (0.085–0.145 units from the centerline). At shoulder height, the outer boundary narrows to 0.125 units, blending over heights 0.54–0.59. This releases the upper sleeve to reduce bunching when the arm is raised while retaining the lower torso correction. Weights remain normalized with at most four influences per vertex. `root.userData.chestWeightCorrection` records the correction. The pose tests measure central chest displacement against the rest pose to catch torso shrinkage.

`src/softenShoulderWeights.js` spreads shoulder motion through an oval patch of upper hoodie centered between each collarbone root and shoulder pivot. A smooth spatial falloff transfers part of the spine influence to the matching clavicle and upper arm; upper-arm participation increases toward the sleeve. This also adds motion where the earlier chest correction had removed arm weights entirely, softening the shoulder-to-torso hinge. The patch radii are 0.085 × 0.085 × 0.14 model units, with a maximum transfer strength of 0.65. Influence fades to zero within 0.015 units of the chest centerline and reaches its full lateral fade by 0.045. The zipper and lower torso stay anchored. The pass preserves four normalized influences per vertex and records its scope in `root.userData.shoulderWeightTransition`.

`src/softenJointWeights.js` softens the existing blends at both elbows, wrists, hips, knees, and ankles using nearby connected surface edges. UV-seam duplicates share the calculation, while disconnected nearby surfaces remain separate. Each joint uses a local brush with a smooth falloff and a bounded weight transfer; hip softening uses the existing Pelvis-to-thigh skin blend and fades out before the hoodie hem. Skeleton transforms, mesh geometry, and animation timing are unchanged by this pass. Run `npm run audit:joints` for the measured transition changes and weight checks, or see `JOINT_WEIGHT_AUDIT.md`. Results are recorded in `root.userData.jointWeightTransitions`.

The rig audit also removes thigh influence from the hoodie above the hem, with a smooth transition between heights 0.405 and 0.450. This keeps the pocket and abdomen stable during leg lifts. `root.userData.hoodieWeightCorrection` records the change. `rig.setHeadTurn(degrees)` turns the head around the character's upright axis, uses the active mode's yaw limit, and preserves the turn when switching poses. Pose selection restores the original bone positions and scales as well as rotations. See `RIG_AUDIT.md` for scope, evidence, and remaining limitations.

## Use in another Three.js project

Copy `src/` and `public/model/` into your project. Install `three`, then:

```js
import { loadZackModel } from './ZackModel.js';

const zack = await loadZackModel('/model/');
scene.add(zack.root);

// Pose a named bone. Rotations apply in the source bone's local axes.
zack.bones.Head.rotateY(0.2);

// Edit a vertex in mesh-local coordinates.
const position = zack.geometry.getAttribute('position');
position.setY(0, position.getY(0) + 0.01);
zack.refreshGeometry();

// Inspect vertex indices by their strongest influencing bone.
console.log(zack.regions.Head);

// Restore original bone transforms, vertices, and normals.
zack.reset();

// Remove and release owned resources when finished.
scene.remove(zack.root);
zack.dispose();
```

`regions` is a convenience map based on dominant skin weights, not a clothing or anatomical segmentation. Mesh-local coordinates use the source export's orientation. For deliberate surface edits, consider all coincident vertices along UV seams. `refreshGeometry()` recalculates normals; call `refreshGeometry(false)` if supplying your own normals.

The default loader fetches `manifest.json`, `geometry.bin`, and a texture variant: 1024 on viewports up to 700 CSS pixels wide, or 2048 on wider viewports. Pass `{ textureSize: 1024 }`, `{ textureSize: 2048 }`, or `{ textureSize: 4096 }` as the second argument to choose explicitly. The loaded model also provides `await zack.setTextureSize(1024)` to switch texture resolution without reloading the model. The 4096 option uses the lossless source texture. Run `python scripts/optimize_textures.py` to rebuild the lossy 2048 and 1024 WebP variants from that source. You can also call `createZackModel(manifest, arrayBuffer, texture)` directly. Each instance gets independent geometry and skeleton data. Exported `artifacts/zack.three.json` is self-contained and can be read with `THREE.ObjectLoader().loadAsync(url)`.

The lossless WebP texture repairs the drawstring roots using mesh geometry and restores a circular white cornea highlight with direct pixel drawing. It projects circular white eyelets onto the hoodie UVs and extends the original cord texture upward to the roots. No generated images are used. The original `basecolor.jpg` remains available. Run `python scripts/retexture_drawstrings.py` to rebuild the drawstring texture, then `python scripts/repair_eye_highlight.py` and `python scripts/optimize_textures.py` to regenerate the repaired texture variants. The retexture script fits the cord axes and hoodie planes, records the intersections and ring centers, and verifies that pixels outside the geometry masks stay unchanged. Geometry and rigging are unaffected.

## Source inspection and verification

The source mesh has a narrow open slit at the base of each thumb. `repairHandSeams()` detects only four-edge hand openings with a sub-0.001-unit diagonal and stitches their near-coincident corners. It adjusts eight existing vertex records by at most 0.000245 model units, sharing position, normal, and normalized skin weights across the joined corners while preserving UV coordinates, vertex count, and triangle indices. A separate load-time repair removes one isolated sliver triangle near the head that made a welded edge non-manifold; the runtime mesh has 10,711 triangles. Larger openings, clothing boundaries, and the source files are left unchanged. `root.userData.handSeamCorrection` and `root.userData.nonManifoldSliverCorrection` record the repairs. Reset retains them, and `node scripts/verify-hand-seams.mjs` checks hand closure in every preset.

- 1 skinned mesh, 22,862 vertices, 10,712 source triangles (10,711 at runtime after repair)
- 78 source bones, plus four runtime elbow helpers; four skin influences per vertex
- 4096 × 4096 base-color texture
- No embedded Zack animation clips or degenerate triangles
- Original source scale retained; world dimensions approximately 0.862 × 1.000 × 0.391 units

`geometry.bin` uses 16-bit triangle indices and 8-bit joint indices. Skin weights are stored as normalized 8-bit values that sum to 255 for each vertex, then decoded to floats before runtime rig corrections. Positions, normals, UVs, and topology remain unchanged. The packed geometry is 983,744 bytes (about 0.94 MiB); `geometry-report.json` records its maximum weight quantization error.

See `geometry-report.json` for extracted measurements and `artifacts/verification.json` for comparison results. `scripts/extract_geometry.py` reproduces the extracted assets using Python, NumPy, and Pillow. The extractor is specific to this source's uncompressed, non-interleaved accessors.

With the dev server running, `npm test` compares every geometry attribute and every skinned world vertex against `GLTFLoader`, exercises viewer controls, checks JSON export/import, and saves screenshots. The test uses the installed Windows Chrome path in `scripts/verify.mjs`; adjust that path for another machine. `npm run build` produces the standalone viewer in `dist/`.
