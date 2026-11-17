# Live speech for Zack

Implemented on `feature/microphone-lip-sync`, November 17, 2026.

## Findings from the model

Zack is one textured, skinned mesh. The face has a sculpted, painted closed smile, but no jaw joint, mouth cavity, tongue, teeth geometry, or authored speech targets. Moving the head bone alone cannot open the mouth. The current runtime mesh, including the existing clothing/shoe repairs, has 22,886 vertex records and 10,731 triangles. The speech feature adds **zero vertices, zero triangles, and zero bones**. It adds three relative position/normal targets on existing records.

There is an unavoidable tradeoff: a sealed surface cannot expose a physical oral cavity without changing its topology. This implementation uses a surface mouth, with a small amount of real chin and cheek deformation. It suits a stylized streaming avatar at front and three-quarter views. It is not a full anatomical facial rig. The underlying sculpted smile can remain subtly visible beside narrow rounded shapes, especially in strong lighting or extreme close-ups.

## Research and what transfers

| Reference | Technique supported by the source | Useful lesson here |
| --- | --- | --- |
| [Valve's Half-Life SDK renderer](https://github.com/ValveSoftware/halflife/blob/master/cl_dll/StudioModelRenderer.cpp) | `StudioCalcBoneAdj` maps a single `mouthopen` value into a model bone-controller range and clamps it. | A scalar speaking envelope is a useful inexpensive baseline. It cannot convey vowel shape by itself. |
| [Valve's Source SDK facial controller](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/c_baseflex.cpp) | Weighted visemes, weak/normal/strong emphasis settings, overlapping phoneme intervals, and temporal filtering. | Blend a compact set of shapes and smooth their transitions. This is later published SDK code in the Half-Life 2 engine family, not a verified copy of its 2004 shipping code. |
| [Kalberer, Müller, and Van Gool: Speech Animation using Viseme Space, 2002](https://homes.esat.kuleuven.be/~konijn/publications/2002/eth_biwi_00243.pdf) | Compact learned deformation modes adapted to a face, with coarticulation between speech shapes. | Shape interpolation matters as much as the number of poses. More polygons alone do not solve speech timing. |
| [Disney Research: Dynamic Units of Visual Speech, 2012](https://la.disneyresearch.com/publication/dynamic-units-of-visual-speech/) | Moving speech gestures rather than only static phoneme poses; evaluation uses phonetically annotated audio. | Avoid abrupt pose swapping. The paper's result does not imply that an RMS meter can recognize phonemes. |
| [Pixar: Inside Out 2 Character Rig Challenges and Techniques, 2024](https://research.pixar.com/docs/2024.SiggraphTalks.HNSZ.pdf) | Independent broad silhouette, mouth-corner, lip refinement, and teeth controls for Anxiety. | Borrow the separation of opening, width, rounding, and interior appearance. This lightweight implementation does not reproduce Pixar's production tooling. |
| [Disney's animation process](https://www.disneyanimation.com/process/animation/) | Timing, staging, squash/stretch, anticipation, follow-through, and secondary action. | Prefer readable, restrained shapes with fast response and a softer close. Live input cannot anticipate an unknown future sound without buffering. |

These references span the inexpensive controller approach of older games, period speech research, the more elaborate Source approach, and modern film articulation. They are not evidence that all early-2000s games shared one facial-animation system. The hybrid used here is an implementation choice based on Zack's actual asset constraints.

## Options considered

| Option | Geometry cost | Live suitability | Decision |
| --- | --- | --- | --- |
| One amplitude-driven jaw joint | No new polygons, but needs a working lip opening and cavity | Very responsive, limited expression | Asset lacks a jaw/cavity; a joint alone would stretch the sealed smile. |
| Discrete texture mouth swaps | No new polygons | Very cheap; transitions can pop | Useful low-poly aesthetic, but use continuous shape controls for softer motion. |
| Authored 3D viseme targets | Targets reuse vertex count; cavity may require a mesh edit | Excellent with an appropriate driver | Three small surface-deformation targets are used now; anatomical visemes need further asset authoring. |
| Surface mouth plus small face shapes | No new polygons or bones | Local, inexpensive, works with existing skinning | Chosen retrofit: procedural interior, teeth band, tongue accent, subtle jaw/corner motion. |
| Neural audio-to-viseme or face tracking | Usually no new topology for inference, but suitable controls still needed | More expressive; model/runtime cost and latency need evaluation | Possible later driver upgrade. It cannot create a missing oral cavity. |

## Implemented signal path

`getUserMedia` → mono Web Audio source → 1,024-sample analyser → RMS and broad spectral bands → gate/envelope → three face targets and mouth-material uniforms.

- Access starts only after **Start mic**. **Preview speech** never requests microphone access.
- Audio is processed locally, with no recording, transcription, network inference, upload, or audible microphone monitoring.
- RMS is calculated after removing the sample mean, so a DC offset does not open the mouth.
- A configurable gate defaults to −52 dBFS, with 3 dB opening hysteresis, a 45 ms hold, 25 ms attack, and 75 ms release. Sensitivity adjusts gain before the gate and aperture mapping.
- Energy in 150–700 Hz, 700–2,200 Hz, and 2,200–6,000 Hz provides a **rough** rounded-versus-wide bias. These are acoustic heuristics, not vowel or language recognition. Voice timbre, microphone response, and noise affect the estimates.
- The same three relative targets reuse existing facial vertices. UV duplicates receive identical position offsets. Bone weights, indices, UVs, and base attributes stay unchanged.
- Mouth coordinates are taken before morphing/skinning, so the painted aperture follows the face through head and body motion. Only facial morph slots are written; body corrective slots remain independent.
- Live rendering changes uniforms and morph weights rather than re-uploading a full texture every frame. A JSON export bakes the current mouth into a texture and retains standard relative shapes, so its still pose loads without the custom shader.

Web APIs were checked against [MDN's microphone documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [AnalyserNode documentation](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode), and [AudioContext constructor documentation](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext). A 1,024-sample window spans about 21 ms at 48 kHz; device capture, browser processing, animation scheduling, and smoothing add latency. The interactive latency setting is a request, not a guarantee. No end-to-end physical-microphone latency is claimed.

## Operating and validating

Run `npm run dev`, open the localhost viewer, select **Face close-up**, and try **Preview speech**. Then select **Start mic** and allow the browser's permission prompt. Choose the input, adjust sensitivity for quiet speech, and raise the noise gate if room noise opens the mouth. Stop and restart to change inputs. HTTPS is required outside localhost. The browser can deny or interrupt capture independently of the app.

`npm run test:speech` checks the signal envelope, noise rejection, response, frame-rate independence, deformation scope, unchanged mesh arrays, seam consistency, corrective independence, and reset. Its Chrome regression supplies a generated WAV through the browser's fake microphone capture to exercise the actual `getUserMedia`/Web Audio path. It also checks silence, stop/retry, denied access, cancellation with a late stream, interrupted audio, track end, page exit, head turning, mocap layering, mobile layout, surface modes, and standard JSON round trips. Captures and results are written under `artifacts/speech/`. These tests do not validate the user's physical microphone, permissions, voice, or acoustic environment.

The next quality step would be a small authored cavity/lip opening if side-profile fidelity becomes important, then a real phonetic driver for closed-lip consonants and more accurate vowel transitions. Both can reuse the current audio/controller boundary.

Validation on this branch passed `test:speech`, `test:correctives`, `test:shoulders`, `test:soft-arms`, `test:run`, the production build, and `git diff --check`. The older default `npm test` fails in its source-GLB vertex comparison: the current repaired runtime has additional records beyond the source mesh. Replacing the speech module with a no-op in a temporary browser route reproduces the identical failure, confirming that it is independent of this feature. The legacy comparison was left unchanged.
