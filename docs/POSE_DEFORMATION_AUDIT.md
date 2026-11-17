# Production pose deformation audit

## Coverage

- Sampled all nine static presets at head yaw −30°, 0°, and +30°.
- Sampled 43 mocap presets at 17 evenly spaced timestamps each, including both endpoints. The scan used the viewer's normal seek path, with baked arm twist, elbow and shoulder correctives, and posed arm smoothing.
- Tested 51 primary joints in isolation at half and full rotation toward their largest sampled local mocap rotation. This includes both arm and leg chains, fingers, spine and head. Isolated poses diagnose the rig and can create combinations the production presets never use.
- Checked all 23,186 posed vertices for finite positions in each of the 860 samples. Screened 28,023 indexed edges at least 0.003 character units long for height- and width-based regional outliers. Edge length ratios flag possible deformation and do not measure volume, intersection or visual severity.
- Reviewed front, side and rear renders of the torso bends, knee lift, forward reach, bent elbows, wave and selected mocap outliers. Existing elbow and shoulder corrective checks each cover 48 combined angle cases.

## Findings

| Area | Reproduction and result |
| --- | --- |
| Rear hoodie hem | In Front Kick 02 at 0.797 s, thigh influence pulls the rear hem. Widening the rear weight fade reduced the flagged edge from 3.34× to 1.83× its rest length. The maximum measured abdomen stretch across the mocap samples fell from 3.34× to 2.70×. |
| Front hoodie and abdomen | The bow, lean and twist presets retain a rounded hoodie silhouette from the reviewed angles. Front Kick 01 at 1.271 s still compresses one front hem edge to 4.4% of rest length. An earlier trial that lowered the fade across both sides of the hem increased front compression, so the final fade change is limited to the rear. |
| Shoulders and armpits | The static forward reach and wave retain the sleeve cap. Scratch at 2.594 s shows a small underarm dimple. Sing 02 at 3.781 s stretches an underarm transition edge to 2.94× rest length. The isolated left clavicle case reproduces most of the stretch at 2.88×, which points to the clavicle-to-sleeve weight transition. |
| Elbows and cuffs | The static elbow bend and the inspected deep bend in Angry 01 at 0 s have a rounded outer sleeve. A single inner-fold edge compresses to 2.5% in Angry 01. Angry 02 at 0.552 s has a separate cuff/wrist outlier at 2.12×, with a small visible crease where the cuff meets the hand. |
| Pants and knees | The most visible remaining defect is the inner-pants pinch in Shoot at 1.703 s. The largest 6.89× stretch is at the inseam, where both thighs share influence, while the right calf rotates about 160° from its local rest orientation. Isolating the right thigh also reproduces strong inseam stretch. A knee-only weight change would miss the cross-thigh transition. |
| Fingers, ankles and shoes | Tight grips in Angry 01 and Box 02 and extreme foot poses in Flip and Box 01 produce localized edge outliers. The isolated thumb and foot tests reproduce those regions. These areas received geometric screening and isolated-joint checks, with less visual coverage than the torso and arms. |

The tested limits are the static viewer's ±30° head yaw, 60° elbow flex and 115° shoulder elevation controls and the rotations observed in the supplied clips. The mocap scan samples time and can miss brief defects between timestamps. It does not certify arbitrary joint combinations or detect every surface intersection.

The rear fade extends from 0.37 to 0.45 in character space. Across the sampled clips, the maximum pants stretch outside the inseam fell from 2.61× to 2.47×. The shortest edge ratio in that region fell from 0.194× to 0.173×, in Frustrated 02 at 6.771 s.

## Reproduce

Start the viewer with `npm run dev`, then run `node scripts/audit-pose-deformation.mjs` from the repository root. Set `ZACK_VIEWER_URL` or `CHROME_PATH` if using a different viewer port or Chrome executable. The script writes per-region extrema, joint samples and the rear hem regression check to `artifacts/production-pose-audit/audit.json`.

The build and focused rig, pose, arm twist, arm smoothing, elbow corrective and shoulder corrective checks pass. The legacy `npm test` viewer check also fails on the pre-audit model: its chest sample moves 0.00346 character units in Arms down against a 0.000001 tolerance.
