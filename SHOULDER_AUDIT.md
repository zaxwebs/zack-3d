# Shoulder skeleton and weight audit

The audit covers the fitted shoulder skeleton, the sleeve fade at 0.085–0.125 model units from the centerline, and the broad upper-hoodie weight transition described below. Pivot changes preserve the rest mesh; the shoulder-region weight pass controls how the hoodie follows subsequent arm motion.

## Findings and changes

- **Shoulder pivots:** The existing 0.03-unit outward correction fits the lateral sleeve transition. However, the hinges remained about 0.028–0.029 units away from the sleeve-section center in the vertical/depth plane, mostly above it. Both hinges now also move down 0.015 and forward 0.004 units. The remaining center distance is approximately 0.0133 on the left and 0.0136 on the right. These are measurements of the hoodie cross-section, not anatomical joint-center estimates; the hinge is deliberately retained above the clothing center rather than moved all the way to it.
- **Collarbones:** The existing spine → clavicle → upper arm hierarchy remains valid. Lowering the shoulder endpoint gives the clavicle a slight downward slope. Upper-hoodie weights distribute motion between the clavicle and upper arm using a broad, smooth shoulder patch.
- **Upper-arm helpers:** The previous outward shoulder move kept every helper at its original world position, leaving the helper midpoint off the revised shoulder-to-elbow axis. The first helper is now centered halfway along that axis, with the second at the elbow. Inverse bind matrices are updated for both helpers.
- **Elbows and wrists:** Their rest positions are unchanged. Their existing hierarchy and pivots remain in place; this audit found no reason to move them as part of the shoulder correction.
- **Skinning limits:** All eight arm twist helpers still have zero direct skin influence. Aligning them makes the skeleton coherent but does not activate twist deformation. Using them for skinning requires coordinated helper animation and weight authoring, rather than assigning weights to the existing source-mapped rotations without review.

## Verification

Run `npm run audit:shoulders`. It independently reconstructs the original exported node transforms and checks every effective rest bind matrix against the corrected skeleton. Maximum matrix error is approximately 3.3 × 10⁻¹⁶. Rest elbow/wrist displacement and helper alignment error are below 10⁻¹⁵ model units. The script saves the shoulder sections, pivot positions, helper alignment, and weight summary to `artifacts/shoulder-skeleton/audit.json`.

`node scripts/verify-rig.mjs`, `node scripts/verify-poses.mjs`, and `node scripts/verify-gentle.mjs` pass after the change, including normalized seam weights, stable hoodie during leg flexion, repeatable static poses, and a posed JSON round trip. Front and side comparisons of the wave, arms-down, arms-forward, and Complain 02 at 5.5 seconds were inspected during the audit.

A browser playback check also evaluated every vertex in 43 supported animation presets at four points per clip (172 sampled frames), with finite bone transforms and vertex positions and no browser errors. Results are saved in `artifacts/shoulder-skeleton/playback-check.json`.

## Default pose alignment

The old Arms down preset aimed the clavicles almost horizontally, overriding the fitted shoulder drop and making the pose look shrugged compared with Idle. Static presets now derive their clavicle directions from the fitted bind pose. Relaxed arms add a modest downward slope; reaching and the waving side add lift relative to the bind direction. The non-waving side stays relaxed.

In Arms down, the shoulder is now approximately 0.032 units below its clavicle root, compared with 0.0023 in the previous preset and roughly 0.040 in the Idle frame inspected at three seconds. Upper-arm and forearm aiming directions are retained. This relaxed base also applies to elbow, knee-lift, and torso-check presets before their specific joint motions are applied. `scripts/verify-poses.mjs` checks the relaxed shoulder slope, intentional lift during reaching/waving, and the relaxed non-waving side, including a rotated model root.

## Soft upper-torso distribution

The marked shoulder/collar region requires influence farther inward than the sleeve fade. `softenShoulderWeights.js` uses an oval patch centered between each clavicle root and shoulder pivot, with radii 0.085, 0.085, and 0.14 along the character's X, Y, and Z axes. A smooth falloff transfers eligible spine weight to the matching clavicle and upper arm. The arm's share grows toward the sleeve, providing a gradual shoulder-to-torso transition even where original arm weights were removed entirely. The previous narrow 20% clavicle-only redistribution is replaced by this pass.

The current patch changes 1,927 vertex records. Maximum transferred weight in this mesh is approximately 0.494; four normalized influences are retained at each vertex. The central zipper is protected by a lateral fade that reaches zero at 0.015 units from the centerline. The patch also fades out vertically and in depth, leaving the lower hoodie anchored.

The audit rotates each upper arm by 25° while keeping its clavicle fixed. Samples inside the old sleeve boundary move up to approximately 0.0026–0.0028 model units, confirming that the inner shoulder now responds to arm motion. The protected zipper and lower-hoodie samples remain fixed. Bind-matrix checks, matching seam weights, and the existing rig/pose checks remain valid.

The deep elbow folds in Complain 02 remain a separate deformation issue. This shoulder correction does not add collision avoidance, bend corrections, bone scaling, or mesh inflation. The existing full `npm test` has a source-versus-repaired-mesh comparison failure documented during this branch's earlier work; it is not counted as passing validation here.
