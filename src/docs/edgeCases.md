# Edge Cases

## OR Call

- OR Call does not automatically substitute for missing Cardiac Call. That behavior was explicitly removed because it pulled OR Call into cath work and broke the OR Call choice flow.
- If OR Call chooses "Available," the prompt checks whether there are enough non-OR-Call providers to cover the day. Best-case coverage assumes Main OR care teams at 1:3 plus one MD each for Endo, BOOS, and IR when present.
- If OR Call chooses "Available" but the final build still leaves non-phantom rooms uncovered, the app shows a post-build warning and asks the user to rebuild with OR Call covering the gap.
- If OR Call chooses "Care Team" but no care-team placement remains, the app shows a post-build warning.
- OR Call can join a care team only if at least two anesthetists are available and there is at least one care-team-eligible non-cardiac, non-cath, non-IR, non-Endo room.

## Endo

- OR.Endo.CCL is both the floor and ceiling for Endo coverage.
- If committed Endo is zero, Endo is not staffed even if Cube contains Endo cases.
- If Cube has fewer Endo rooms than committed, phantom Endo Add-On rooms are created up to the committed count.
- If Cube has equal or more Endo rooms than committed, only the committed number of Endo rooms is staffed.
- Committed Endo is capped at 3 in the current care-team logic.
- Brand is preferred for Endo, but if Brand is unavailable the next available MD in priority order covers the Endo care team.

## Main OR Commitment

- OR.Endo.CCL Main OR is treated as a hard ceiling.
- When Cube shows more Main OR rooms than the committed count, excess Main OR rooms are trimmed by priority.
- Main OR trimming favors keeping higher-acuity rooms, required block rooms, and rooms with more cases.
- Non-Main OR areas are not included in Main OR trimming.

## Cath

- Cath committed count can create Cath Lab Add-On phantom rooms when committed cath coverage exceeds visible cath rooms in Cube.
- Cath rooms left unassigned by the cardiac decision tree are filled before general solo Main OR rooms consume the remaining MD pool.
- Cath-adjacent rooms may carry notes showing whether CV team is occupied or whether general fill is appropriate.

## Block And Regional

- Triplet shoulder/rotator cuff rooms are always block-required and call out Nielson first, Lambert second, Pipito third.
- Block-required cases add avoidances for providers who should not take block rooms.
- Non-block-capable MDs should not take block rooms while block-capable MDs remain and enough non-block rooms exist.
- Jump/flip pairs with block rooms are claimed by block-capable MDs before staggered picking can reorder the room pool.
- Spinal-only language should not by itself imply peripheral block need unless peripheral block keywords are also present.

## No-Anesthesia Filtering

- Cases marked zNo Anes or z no anes are filtered out.
- CardioMEMS/Cardiomem cases are filtered out as no-anesthesia procedures.
- Alalwan cases are filtered out as RN-administered sedation.
- Radiology/non-procedure cases such as CT, MRI, bone marrow biopsy, LP, myelogram, kyphoplasty, and vertebral augmentation are filtered out.
- Manometry and Endo BS rooms are filtered out.
- Heart cath/PCI without TEE/transesophageal language is filtered out as RN-administered sedation.
- Loop recorder and PFO closure are filtered out.

## EP And Device Ambiguity

- Rose and Almnajam EP cases require anesthesia.
- Other EP cases generally do not use anesthesia unless another rule applies.
- Device cases for Rose and Almnajam require anesthesia.
- Device cases for Moran, Graham, Rivera Maza, Wagle, Saleb, and Madmani do not use anesthesia.
- Unknown device preferences are treated as anesthesia-needed and flagged.

## Surgeon And Case Flags

- Unknown surgeons are flagged for block preference confirmation unless the procedure is clearly neurosurgery/spine, in which case no block is assumed.
- Unknown Team Health providers should have block preference confirmed day-of.
- Flack is flagged as often late to OR, so buffer time should be planned.
- El-Amir requires cardiac anesthesia and escalation if CV team is unavailable.
- Watchman prefers Munro when possible because of complex TEE requirements.

## Fractional Resources

- Fractional OR.Endo.CCL resources imply split-day coverage, such as 0.5 IR plus 0.5 Main OR.
- Fractional areas are paired in a fixed order: IR, BOOS, Cath, Endo, Main OR.
- The app creates informational coverage gaps for split-day resources and lets users adjust pairings in Assignments.
- Paired rooms share assignment changes: updating one room assignment updates its paired room.

## Duplicate Assignment Prevention

- buildCareTeams treats every already-assigned provider as globally used before forming care teams.
- This prevents a provider assigned by cardiac, OR Call choice, peds, block, or other priority logic from being reused in a care team.
- Solo fill also tracks already-assigned providers to prevent duplicate MD assignment.
