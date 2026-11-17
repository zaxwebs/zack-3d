# Live speech and the split mouth

Updated November 18, 2026, on `feature/microphone-lip-sync`.

## Checkpoints

- `d0b6ae7` on `animation-fixes` commits the earlier elbow/shoulder corrections, arm surface pass, and run-loop work.
- `579e267` on `feature/microphone-lip-sync` preserves the first microphone feature and its surface-painted mouth.
- `807f2a3` preserves the first split-mesh mouth.
- The current pass moves that split to the recessed end of the upper lip, retaining the full upper-lip roll above the opening. It also refines the teeth, tongue, and interior shading. Microphone analysis and its controls retain their previous behavior.

## Research and design decisions

| Primary source | Relevant technique | Application to Zack |
| --- | --- | --- |
| [Valve Half-Life SDK renderer](https://github.com/ValveSoftware/halflife/blob/master/cl_dll/StudioModelRenderer.cpp) | A scalar `mouthopen` value drives a bone-controller range. | A lightweight opening envelope remains a useful live input, even with a more capable mouth mesh. |
| [Valve Source SDK facial controller](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/c_baseflex.cpp) | Weighted visemes, emphasis settings, overlapping intervals, and temporal filtering. | Blend a few readable shapes smoothly. This is later published code in the Half-Life 2 engine family, not a verified copy of its 2004 shipping code. |
| [Speech Animation using Viseme Space, 2002](https://homes.esat.kuleuven.be/~konijn/publications/2002/eth_biwi_00243.pdf) | Compact deformation modes and coarticulation adapted to different faces. | Separate shape authoring from the audio driver; extra polygons alone do not improve timing. |
| [Disney Research: Dynamic Units of Visual Speech, 2012](https://la.disneyresearch.com/publication/dynamic-units-of-visual-speech/) | Speech is modeled as moving gestures, with evaluation using phonetically annotated audio. | Smooth the transitions. Broad audio bands do not provide the phonetic information used by that research. |
| [Autodesk Softimage: Modeling the Mouth Area](https://download.autodesk.com/global/docs/softimage2014/en_us/files/face_modeling_ModelingtheMouthArea.htm) | Closed lips with carefully separated corners; inner lip surfaces continue into a recessed mouth. | Split the existing crease, retain shared corner endpoints, and build a lining that remains attached to both moving lips. Avoid placing a disconnected dark plane behind the face. |
| [Pixar: Inside Out 2 Character Rig Challenges and Techniques, 2024](https://research.pixar.com/docs/2024.SiggraphTalks.HNSZ.pdf) | Distinct broad silhouette, corner, lip-refinement, and teeth controls for Anxiety. | Keep jaw motion, width/rounding, and tooth seating distinct. The lightweight rig here does not reproduce Pixar's production system. |
| [OpenStax: The Mouth, Pharynx, and Esophagus](https://openstax.org/books/anatomy-and-physiology-2e/pages/23-3-the-mouth-pharynx-and-esophagus) | Dental arches, crowns seated in gums, and the arched palate behind the upper teeth. | Use the user's horseshoe reference for a continuous upper crown arch and recessed gum/palate volume. This is a stylized anatomical arrangement, not a complete dentition. |
| [Three.js BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html) and [SkinnedMesh](https://threejs.org/docs/pages/SkinnedMesh.html) | Indexed attributes, material groups, relative morphs, and bone weights. Morph layout is established before rendering. | Cut and author targets once during model construction. Reuse one skeleton and ordinary material groups; animate weights rather than rebuilding geometry. |

The initial surface mouth was an inexpensive retrofit for a sealed asset. The new requirement explicitly allows a local opening, so a true lip split is now the appropriate solution. Full remeshing, subdivision, extra facial bone chains, and runtime booleans are unnecessary for this low-poly target.

## Geometry and attachment

The pre-mouth runtime, including existing repairs and sole caps, contains **22,886 vertex records and 10,731 triangles**. The current model contains **23,186 records and 11,237 triangles**. The mouth adds **300 records and 506 triangles**, about 4.72% more triangles than the pre-mouth mesh. No outer-face triangles or bones are added.

`src/mouthTopology.js` defines 13 inspected source landmarks following 12 connected edges in the recessed lip separation. The earlier path was on the higher ridge at the beginning of the upper-lip roll, which incorrectly transferred that roll to the lower jaw. The corrected center lies about 2.44 mm lower and 3.42 mm farther inside the head in model coordinates. This keeps the original upper-lip geometry and its painted strip attached to the upper face.

The existing corner vertices remain in use. `src/alignSmileCornerUVs.js` registers the source artwork's raised smile tips onto those corners by shifting a small UV patch, without moving or adding corner geometry. Each patch has a 2 mm core and fades out by 9.5 mm in model coordinates. It changes 71 UV records, leaves every other UV exact, and keeps all affected UV triangles positively oriented. The surrounding UVs move with the endpoint correction so a second painted endpoint does not remain above the opening. Texture images remain unchanged, and the same normalized coordinates work at 1K, 2K, and 4K. This registration runs once at model creation and exports as ordinary UV data.

The topology builder verifies that each edge has two incident faces and each internal landmark has two separable surface fans. The lower fan receives duplicated records with the same attributes; the original triangles retain their order and shape. All pre-existing positions, normals, UVs, and weights remain unchanged by this topology operation. Only the lower fan's index references change. The cut happens before weight corrections, rest snapshots, and corrective-shape authoring, so their arrays all have the final vertex count.

The mouth corners remain shared endpoints. Separate lip edges can therefore open in the middle while remaining attached at both ends. Three rings extend from the opening into the head and close at a back cap. The outer lining ring has exactly the same position, weights, and speech displacement as the corresponding lip records. Its attachment is geometric across the material boundary; it is not a floating overlay.

The added triangles are 120 for the lining, 200 for the upper tooth arch, 136 for the gum/palate volume, and 50 for the tongue. They use three additional materials on the **same skinned mesh**. The gum/palate shares the lining material group, adding no draw call.

`src/upperDentalArch.js` sweeps a six-point beveled crown section along 17 stations: nine across the front and four extending backward along each cheek. The section rotates with the arch tangent, preserving real crown thickness around the sides. The front follows a rounded curve registered to the lip depth; caps are approximately 36 mm behind the central front crowns, rather than at the visible ends of a smile strip. A connected, closed gum/palate volume overlaps the crown roots and rises behind the arch. The upper jaw has an open center between the white crowns, filled by the darker palate rather than a solid white plate. Front crowns follow the upper lip's stylized shapes; this influence fades smoothly to zero at the posterior teeth, keeping the rear jaw stable.

The tongue has an extra top ring to form a rounded mound instead of a single pointed fan, and sits slightly higher and farther forward inside the mouth. It follows a smaller fraction of lower-jaw motion and narrows/recedes during rounded shapes to remain behind the cheeks. The lining closes the oral cavity; a complete tongue underside, individual tooth divisions, and a lower tooth arch are intentionally not modeled.

Linear vertex colors shade the lining from subdued warm red near the lip to dark burgundy at the back. A desaturated rose gradient gives the tongue more volume. The lining uses an unlit basic material to keep the interior dim under the viewer's environment light; the teeth and tongue retain rough standard materials. Original character vertices have white color values, and its material does not use vertex colors, so this adds no tint to the skin, hair, or clothing. The gradient is static vertex data, adds no texture upload or shader callback, and survives native JSON export.

## Shape authoring and nose protection

`src/SpeechFace.js` builds relative jaw, spread, and round targets. Jaw opening separates the actual mesh; it no longer paints an oval over a closed face. The lower lip opens more than the chin, and the chin retains roughly 0.01 model units of downward travel at full opening. Width and rounding use a local horizontal falloff rather than scaling the whole lower head.

Vertices and normals at or above rest height 0.749 are protected. The transition below this plane fades smoothly. A positive-weight displacement solve on the connected upper-face surface distributes the lip motion between fixed lip landmarks and the pinned nose/outer region. The lower lip retains its authored jaw motion, preventing its near-edge triangles from curling backward during a wide opening. Imported normal detail is transported by the change in the welded surface normal, with separate upper/lower fans at the slit and matching transport across ordinary UV seams.

The solve and normal generation run only when constructing the model. Playback writes the same three weights: `open`, `open * spread`, and `open * round`. It does not run a mesh-cut operation, topology search, smoothing solve, or CPU vertex deformation each frame. Temporary authoring data is not needed by the live controller.

## Audio, rendering, and export

`getUserMedia` → mono Web Audio analyser → RMS and broad frequency bands → gate/envelope → three relative shape weights.

Microphone behavior is unchanged: explicit start, local processing, no recording/upload/transcription, input selection, sensitivity, gate, cancellation, interruption handling, and cleanup. Defaults remain a −52 dBFS gate, 3 dB opening hysteresis, 45 ms gate hold, 25 ms attack, and 75 ms release. A 1,024-sample analysis window spans about 21 ms at 48 kHz. Device capture and browser processing add latency; no physical end-to-end timing is claimed. API references: [microphone capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [AnalyserNode](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode), and [AudioContext](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext).

Broad energy bands only bias rounded versus wide shapes. They do not identify vowels, closed-lip consonants, or language. This remains a stylized live speaking persona rather than phonetic reconstruction or performance capture.

The original face texture moves with the real lip surface. The old procedural mouth shader and export texture-baking module have been removed. Mouth materials are culled when fully closed, giving **one model draw call while silent and four while speaking** in the viewer. No full texture is uploaded per audio frame. Textured, Clay, and Wireframe modes all expose the same physical opening. The occluded interior is hidden at exact rest to avoid subpixel seam artifacts and unnecessary draws; the closed geometry is also checked independently by ray tests.

JSON snapshots contain the lip split, lining, teeth, tongue, ordinary material groups, skin weights, and current relative shapes. A standard `THREE.ObjectLoader` reproduces the still pose without speech-specific code. The existing arm surface pass still supplies its own native snapshot morph. Animating an exported asset later requires supplying shape weights, as before.

## Validation

Run `npm run test:speech` with the dev server running. It includes:

- Audio envelope response, silence/noise rejection, DC rejection, gain, and frame-rate independence.
- An isolated mouth-cut check proving all old attributes and outer triangle order are retained, except the documented lower-lip index remap.
- 45 open/spread/round combinations; fixed nose records; chin travel; matching lining/lip positions; closed corners; front-facing surfaces retain positive projected orientation and the retained lip underside keeps its orientation in 3D.
- The upper-lip ridge remains attached to the upper face when the jaw opens, and the separation lies below and behind that ridge. Existing mesh corners are retained; only the two local UV patches change, both corners sample the original painted tips, and no UV triangle inverts.
- Ray tests for an actual cavity, tooth seating within 1.2 mm of the upper edge, closed-mouth occlusion, and clearance of teeth, tongue, and lining outside the aperture in wide/rounded poses.
- Closed, consistently wound tooth and gum/palate volumes; rearward continuation on both sides; crown surfaces around the front and sides; an open arch center; and fixed posterior teeth across speech targets.
- 567 local edges checked for a two-face fan across the opened skin/lining surface; no open seam or non-manifold edge in that tested region.
- Stable buffers and morph arrays over 1,000 updates, followed by exact reset.
- A generated synthetic WAV through Chrome's fake microphone capture, exercising actual `getUserMedia` and Web Audio; cancellation, denial/retry, late streams, interruption, disconnection, and page-exit cleanup.
- Front, three-quarter, profile, clay, wireframe, and mobile captures, plus close front/left/right, rounded, and partial openings; isolated upper-arch and oblique jaw views from the actual posed geometry; texture-resolution changes; head turns; mocap layering; draw counts; and standard JSON round trips including vertex colors and UVs.

Captures and reports are written under `artifacts/speech/`. Geometry checks observed zero nose displacement and zero lining-attachment error in the tested cases, with no extra outer triangles. These checks do not constitute a general collision proof for every conceivable facial edit. Synthetic input does not validate a particular physical microphone or room.

The completed pass also passed the elbow, shoulder, and arm-softening geometry checks; the elbow, shoulder, and Shovel browser regressions; run-loop continuity; rig/skin-weight/export checks; all static pose presets; the isolated hand-seam checks; the production build; and `git diff --check`. Browser regressions were run serially on the finished source to avoid software-renderer contention and development-server reloads during capture. Detailed final browser/rig/build results are in `artifacts/speech/validation/`.

The default source comparison has been updated to compare all original source records, recognize the documented earlier repairs, and verify the mouth additions rather than reading beyond the source GLB. Its later legacy `inspect-poses.mjs` chest audit still reports 0.0034573285 units of movement where it expects less than 0.000001. Running that audit with the complete saved `579e267` model and mouth implementation reproduces the exact same failure, independently of the new mouth. The chest behavior and that audit's limit were left unchanged.
