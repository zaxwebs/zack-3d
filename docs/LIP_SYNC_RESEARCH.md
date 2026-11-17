# Live speech and the split mouth

Updated November 17, 2026, on `feature/microphone-lip-sync`.

## Checkpoints

- `d0b6ae7` on `animation-fixes` commits the earlier elbow/shoulder corrections, arm surface pass, and run-loop work.
- `579e267` on `feature/microphone-lip-sync` preserves the first microphone feature and its surface-painted mouth.
- The current version replaces that painted aperture with an actual split in the smile, recessed mouth geometry, and a seated tooth band. Microphone analysis and its controls retain their previous behavior.

## Research and design decisions

| Primary source | Relevant technique | Application to Zack |
| --- | --- | --- |
| [Valve Half-Life SDK renderer](https://github.com/ValveSoftware/halflife/blob/master/cl_dll/StudioModelRenderer.cpp) | A scalar `mouthopen` value drives a bone-controller range. | A lightweight opening envelope remains a useful live input, even with a more capable mouth mesh. |
| [Valve Source SDK facial controller](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/c_baseflex.cpp) | Weighted visemes, emphasis settings, overlapping intervals, and temporal filtering. | Blend a few readable shapes smoothly. This is later published code in the Half-Life 2 engine family, not a verified copy of its 2004 shipping code. |
| [Speech Animation using Viseme Space, 2002](https://homes.esat.kuleuven.be/~konijn/publications/2002/eth_biwi_00243.pdf) | Compact deformation modes and coarticulation adapted to different faces. | Separate shape authoring from the audio driver; extra polygons alone do not improve timing. |
| [Disney Research: Dynamic Units of Visual Speech, 2012](https://la.disneyresearch.com/publication/dynamic-units-of-visual-speech/) | Speech is modeled as moving gestures, with evaluation using phonetically annotated audio. | Smooth the transitions. Broad audio bands do not provide the phonetic information used by that research. |
| [Autodesk Softimage: Modeling the Mouth Area](https://download.autodesk.com/global/docs/softimage2014/en_us/files/face_modeling_ModelingtheMouthArea.htm) | Closed lips with carefully separated corners; inner lip surfaces continue into a recessed mouth. | Split the existing crease, retain shared corner endpoints, and build a lining that remains attached to both moving lips. Avoid placing a disconnected dark plane behind the face. |
| [Pixar: Inside Out 2 Character Rig Challenges and Techniques, 2024](https://research.pixar.com/docs/2024.SiggraphTalks.HNSZ.pdf) | Distinct broad silhouette, corner, lip-refinement, and teeth controls for Anxiety. | Keep jaw motion, width/rounding, and tooth seating distinct. The lightweight rig here does not reproduce Pixar's production system. |
| [Three.js BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html) and [SkinnedMesh](https://threejs.org/docs/pages/SkinnedMesh.html) | Indexed attributes, material groups, relative morphs, and bone weights. Morph layout is established before rendering. | Cut and author targets once during model construction. Reuse one skeleton and ordinary material groups; animate weights rather than rebuilding geometry. |

The initial surface mouth was an inexpensive retrofit for a sealed asset. The new requirement explicitly allows a local opening, so a true lip split is now the appropriate solution. Full remeshing, subdivision, extra facial bone chains, and runtime booleans are unnecessary for this low-poly target.

## Geometry and attachment

The pre-mouth runtime, including existing repairs and sole caps, contains **22,886 vertex records and 10,731 triangles**. The new model contains **23,052 records and 10,965 triangles**. The difference is **166 records and 234 triangles**, about 2.18% more triangles. No outer-face triangles or bones are added.

`src/mouthTopology.js` defines 13 inspected source landmarks following 12 connected edges of the smile. It verifies that each edge has two incident faces and that each internal landmark has two separable surface fans. The lower fan receives duplicated records with the same attributes; the original triangles retain their order and shape. All pre-existing positions, normals, UVs, and weights remain unchanged by this topology operation. Only the lower fan's index references change. This operation happens before weight corrections, rest snapshots, and corrective-shape authoring, so their arrays all have the final vertex count.

The mouth corners remain shared endpoints. Separate lip edges can therefore open in the middle while remaining attached at both ends. Three rings extend from the opening into the head and close at a back cap. The outer lining ring has exactly the same position, weights, and speech displacement as the corresponding lip records. Its attachment is geometric across the material boundary; it is not a floating overlay.

The added triangles are 120 for the lining, 84 for the curved upper tooth band, and 30 for the tongue. They use three additional materials on the **same skinned mesh**. The tooth band has thickness and is inset behind the lip. Its top extends into the upper lip, while width and rounding follow the upper seam. This avoids both a dark gap above the teeth and teeth sticking through compressed cheeks. The tongue follows a smaller fraction of lower-jaw motion. The lining closes the oral cavity; a complete tongue underside and individual teeth are intentionally not modeled.

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
- 45 open/spread/round combinations; fixed nose records; chin travel; matching lining/lip positions; closed corners; no checked front-facing lip triangle folding backward.
- Ray tests for an actual cavity, tooth seating within 1.2 mm of the upper edge, closed-mouth occlusion, and tooth clearance in wide/rounded poses.
- 567 local edges checked for a two-face fan across the opened skin/lining surface; no open seam or non-manifold edge in that tested region.
- Stable buffers and morph arrays over 1,000 updates, followed by exact reset.
- A generated synthetic WAV through Chrome's fake microphone capture, exercising actual `getUserMedia` and Web Audio; cancellation, denial/retry, late streams, interruption, disconnection, and page-exit cleanup.
- Front, three-quarter, profile, clay, wireframe, and mobile captures; head turns; mocap layering; draw counts; and standard JSON round trips.

Captures and reports are written under `artifacts/speech/`. Geometry checks observed zero nose displacement and zero lining-attachment error in the tested cases, with no extra outer triangles. These checks do not constitute a general collision proof for every conceivable facial edit. Synthetic input does not validate a particular physical microphone or room.

The completed pass also passed the elbow, shoulder, and arm-softening geometry checks; the elbow, shoulder, and Shovel browser regressions; run-loop continuity; rig/skin-weight/export checks; all static pose presets; the isolated hand-seam checks; the production build; and `git diff --check`. Browser regressions were run serially on the finished source to avoid software-renderer contention and development-server reloads during capture. Detailed final browser/rig/build results are in `artifacts/speech/validation/`.

The default source comparison has been updated to compare all original source records, recognize the documented earlier repairs, and verify the mouth additions rather than reading beyond the source GLB. Its later legacy `inspect-poses.mjs` chest audit still reports 0.0034573285 units of movement where it expects less than 0.000001. Running that audit with the complete saved `579e267` model and mouth implementation reproduces the exact same failure, independently of the new mouth. The chest behavior and that audit's limit were left unchanged.
