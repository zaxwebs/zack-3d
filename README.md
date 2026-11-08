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

Pose screenshots and self-contained Three.js scenes are in `artifacts/poses/`. Pose selection is immediate; no looping animation is applied.

The viewer provides **Arms down**, **Arms forward**, **Right-hand wave**, **T-pose**, **Bend elbows**, **Torso twist**, **Side bend**, **Bend forward**, and **Right knee lift**. Each preset describes the joints it exercises below the buttons. Enable **Skeleton** and orbit or zoom to inspect the bends. These are static deformation checks, not balanced animation poses: the raised leg is not ground-constrained. Switching presets restores all bone transforms before applying the next pose, and preserves the head-turn slider. The exported `POSES` registry in `src/ZackRig.js` defines the available names, labels, and descriptions. Run `node scripts/verify-poses.mjs` for standalone preset checks.

The model factory moves the source shoulder pivots outward by 0.03 scene units per side, toward the sleeve caps. It compensates child bone positions and inverse bind matrices so the rest mesh and elbow positions stay unchanged. `root.userData.shoulderCorrections` records the original and corrected pivots. Reset uses the corrected rig.

Chest vertices are anchored to the spine by removing leaked arm/clavicle weights in the torso center and smoothly restoring those influences toward the sleeve caps (0.085–0.145 units from the centerline). Weights remain normalized with at most four influences per vertex. `root.userData.chestWeightCorrection` records the correction. The pose tests measure central chest displacement against the rest pose to catch torso shrinkage.

The rig audit also removes thigh influence from the hoodie above the hem, with a smooth transition between heights 0.405 and 0.450. This keeps the pocket and abdomen stable during leg lifts. `root.userData.hoodieWeightCorrection` records the change. `rig.setHeadTurn(degrees)` turns the head around the character's upright axis, uses the active mode's yaw limit, and preserves the turn when switching poses. Pose selection restores the original bone positions and scales as well as rotations. See `RIG_AUDIT.md` for scope, evidence, and remaining limitations.

## Use in another Three.js project

Copy `src/ZackModel.js`, `src/ZackRig.js`, `src/repairHandSeams.js`, and `public/model/` into your project. Install `three`, then:

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

The lossless WebP texture repairs the drawstring roots using mesh geometry. It projects circular white eyelets onto the hoodie UVs and extends the original cord texture upward to the roots. No generated images are used. The original `basecolor.jpg` remains available. Run `python scripts/retexture_drawstrings.py` to rebuild the texture (NumPy and Pillow required), then `python scripts/optimize_textures.py` to regenerate the smaller variants. The retexture script fits the cord axes and hoodie planes, records the intersections and ring centers, and verifies that pixels outside the geometry masks stay unchanged. Geometry and rigging are unaffected.

## Source inspection and verification

The source mesh has a narrow open slit at the base of each thumb. `repairHandSeams()` detects only four-edge hand openings with a sub-0.001-unit diagonal and stitches their near-coincident corners. It adjusts eight existing vertex records by at most 0.000245 model units, sharing position, normal, and normalized skin weights across the joined corners while preserving UV coordinates, vertex count, and triangle indices. Larger openings, clothing boundaries, and the source files are left unchanged. `root.userData.handSeamCorrection` records the repair. Reset retains it, and `node scripts/verify-hand-seams.mjs` checks closure in every preset.

- 1 skinned mesh, 22,862 vertices, 10,712 triangles
- 78 named bones, four skin influences per vertex
- 4096 × 4096 base-color texture
- No animation clips or degenerate triangles
- Original source scale retained; world dimensions approximately 0.862 × 1.000 × 0.391 units

`geometry.bin` uses 16-bit triangle indices and 8-bit joint indices. Skin weights are stored as normalized 8-bit values that sum to 255 for each vertex, then decoded to floats before runtime rig corrections. Positions, normals, UVs, and topology remain unchanged. The packed geometry is 983,744 bytes (about 0.94 MiB); `geometry-report.json` records its maximum weight quantization error.

See `geometry-report.json` for extracted measurements and `artifacts/verification.json` for comparison results. `scripts/extract_geometry.py` reproduces the extracted assets using Python, NumPy, and Pillow. The extractor is specific to this source's uncompressed, non-interleaved accessors.

With the dev server running, `npm test` compares every geometry attribute and every skinned world vertex against `GLTFLoader`, exercises viewer controls, checks JSON export/import, and saves screenshots. The test uses the installed Windows Chrome path in `scripts/verify.mjs`; adjust that path for another machine. `npm run build` produces the standalone viewer in `dist/`.
