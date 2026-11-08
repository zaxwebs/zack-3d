# Zack rig audit

The rig fits the character well enough for the current arm presets, moderate head turns, and moderate leg bends. It is not a finished facial-animation or extreme-bend rig.

The audit started from drawstring commit `8687415`, merged into `main`, with changes developed on `rig-adjustment`. The mesh remains at 22,862 vertices and 10,712 triangles. No geometry, drawstring texture, or previously rejected elbow-volume correction was added by this audit.

## Changes

- **Upright head turns.** The imported head bone's local Y axis points approximately `(0, 0.894, 0.447)` in world space, about 26.6° from upright. The previous head control introduced visible roll. `setHeadTurn()` now rotates around the character's upright axis, preserves the imported rest orientation, and clamps to ±30° in gentle mode or ±45° with gentle mode disabled. The viewer uses this control.
- **Hoodie weights.** The imported thigh weights extended into the pocket and abdomen. A 50° hip flex visibly folded the pocket into the leg. Leg influence now fades out between heights 0.405 and 0.450, with removed weight transferred to the waist/spine. This corrects 790 vertices and preserves at most four normalized influences per vertex.
- **Complete pose restoration.** Selecting a pose now restores bone positions and scales as well as rotations. Head turns remain consistent across pose changes. Temporary bone translations/scales from other manipulations no longer contaminate preset poses.

## Visual review

`scripts/audit-rig.mjs` captures the T-pose, hands down, hands forward, and wave from front, side, and back, plus a skeleton overlay, ±30° head turns, a hip-flex test, a knee-bend test, and a mild finger-flex test.

Before/after screenshots are saved locally under `artifacts/rig-audit/before/` and `artifacts/rig-audit/after/`. The head-turn and hip-flex close-ups show the changes most clearly. The current presets retain the inward-facing wave thumb and stable chest.

Reproduce the current screenshots with the dev server running:

```powershell
$env:RIG_AUDIT_DIR = 'artifacts/rig-audit/after'
node scripts/audit-rig.mjs
```

## Validation

`npm test` covers source rest-shape agreement, geometry attributes, preset pose switching, correct wave handedness, stable chest vertices, and native Three.js JSON export/import. `scripts/verify-rig.mjs` additionally checks:

- Requested head rotations at ±30° and ±45°, including a rotated model root, agree with the active mode's clamped upright yaw within 0.000001 radians.
- Corrupting a calf's position and scale is repaired by pose selection.
- The central hoodie stays fixed within 0.000001 units during a 50° hip flex and 65° knee bend on each side, while the knee actually moves more than 0.1 units.
- All joint indices are valid, weights are finite/nonnegative and sum to one within 0.000001, and coincident vertices have matching weights across UV seams.
- A posed native JSON round trip retains world vertex positions within 0.000001 units.

Measurements are written to `artifacts/rig-audit/checks.json`.

## Gentle posing mode

The default controller limits elbow flexion to 60°, shoulder elevation to 115° from arms-down, and head yaw to ±30°. The greeting raises the upper arm and opens the elbow to about 26° instead of the earlier 94° bend. A maximum 20° of the palm turn is shared with the upper arm while preserving the forearm/hand world frame. Bone scales, geometry, and topology stay unchanged.

`scripts/verify-gentle.mjs` tracks 13 unique surface samples around the waving elbow and projects them into the joint's cross-section. The sampled minor-radius ratio improves from approximately 0.66 in the previous greeting to 0.94 in gentle mode. This is a local shape metric, not proof of whole-mesh volume preservation. The test checks the angle limits, unchanged bone scales, and thickness improvement. Measurements are in `artifacts/gentle/verification.json`.

The viewer's **Gentle poses** checkbox allows comparison with the earlier presets. Limits constrain this controller's poses, not arbitrary direct bone edits. No stretch, inflation, corrective morphs, or added elbow geometry are used; some surface deformation remains inherent to skinning.

## Remaining limitations

- The outer elbow can still look angular during a strong bend. The earlier rejected bulge, helper scaling, extra topology, and morph corrections remain removed. The source's coarse topology and linear skinning limit this joint.
- The imported eye and facial helper bones have no direct skin influence. Eye appearance is part of the face texture; rotating those helpers does not provide independent gaze or facial expressions.
- Several twist/share helper bones also have no direct weights. They remain in the hierarchy, but should not be assumed to provide automatic volume preservation. Parent bones can legitimately have no direct weights while still driving descendants.
- This is a single skinned, textured surface. Deep finger curls, extreme hip compression, and large limb intersections need further dedicated pose review before use in a full animation set. No collision handling or foot placement system is provided.
