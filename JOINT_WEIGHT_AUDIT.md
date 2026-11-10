# Joint weight softening

The model now softens the existing skin-weight transitions at both elbows, wrists, hips, knees, and ankles. This extends the shoulder work to ten additional joint regions without moving their pivots or altering animation timing.

## Method

The pass averages each joint's proximal/distal weight blend along connected mesh edges. It welds coincident UV-seam vertices for the calculation, then writes matching weights back to their separate vertex records. It does not average across nearby surfaces that have no connecting edges.

Three conservative averaging iterations use a smooth, local brush around each joint. Transfers are capped at 0.12 weight at elbows/knees and 0.08 at wrists/hips/ankles. Other bone influences are preserved; vertices that cannot accommodate both blend partners within four skin slots are excluded. Joint positions, bone scales, geometry, UVs, and the rest shape are retained.

The pants use `Pelvis` weights, rather than direct `Hip` weights, for their proximal skin support. The hip pass therefore blends Pelvis/thigh influence and fades out between heights 0.39 and 0.425 to preserve the hoodie correction. Actual hip transfers are small, below 0.012 weight.

## Measurements

The pass changes 2,885 vertex records. The following reductions measure squared differences in the bone-blend ratio across neighboring surface edges within each brush. They indicate smoother weight transitions, not measured volume preservation or proof of improved appearance in every animation.

| Joint region | Reduction in neighboring blend differences |
| --- | --- |
| Elbows | 37–41% |
| Wrists | 38–41% |
| Hips | 22–26% |
| Knees | 34–35% |
| Ankles | 56–57% |

Run `npm run audit:joints` to regenerate `artifacts/joint-softening/audit.json`. The audit checks that all ten regions have reduced blend differences, transfers stay bounded, and every joint index and weight is valid. Maximum weight-sum error is approximately 4.9 × 10⁻⁸.

## Review and limits

Before/after comparisons were inspected for the wave, bent elbows, knee lift, walking, and Complain 02 at 5.5 seconds. The visual changes are deliberately modest. The severe Complain 02 elbow fold remains; this pass does not add corrective shapes, change topology, activate twist helpers, or provide collision avoidance.

Rig, static-pose, gentle-pose, and shoulder-audit checks pass. These include matching seam weights, stable hoodie during leg flexion, repeatable pose switching, finite vertices, and a posed JSON round trip. A browser check sampled every vertex at four points in each of the 43 supported animation presets, with no invalid positions or browser errors. The production build passes. The previously documented full-suite source-mesh comparison failure remains outside this change.
