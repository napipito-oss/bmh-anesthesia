# Scheduling Doctrine

## Core Assignment Order

1. CV / hard qualifications
2. Brand to Endo when available/appropriate
3. Pediatric/regional/block needs
4. Build care teams
5. Best fit
6. Fairness/preference

## Provider Availability

- qGenda determines who is working and what role they hold.
- OB Call is intentionally excluded from OR assignment. It remains visible as unavailable because that provider is covering OB.
- PTO, OFF, Post OR, and Post OB providers are unavailable for room assignment.
- OR Call is available for assignment only through the explicit OR Call choice flow or normal fill if no choice consumes them.
- Back Up Call can be either an MD or anesthetists. If the backup-call names are anesthetists, the app treats that as AA backup-call coverage rather than an MD backup-call role.

## Priority Rooms

- Cardiac and cath-adjacent cases are routed before general assignment.
- Open heart, TAVR, MitraClip, structural heart, El-Amir, and major thoracic cases are hard CV-team work.
- Cardiac cath, PCI, loop recorder, PFO closure, and many device cases may be excluded from anesthesia coverage unless the procedure or surgeon rule requires anesthesia.
- TEE, cardioversion, Watchman, selected EP, and selected device cases are anesthesia cases and route through cardiac/cath logic.
- Brand is the preferred Endo care-team MD when available. If Brand is unavailable and Endo is committed, the next available MD in priority order covers Endo.
- Peds ENT-type cases prefer DeWitt first, then Pipito. Existing logic also considers Gathings and Nielson in the peds assignment order before Pipito for some peds passes.
- Required block rooms prefer Nielson, Lambert, Powell, and Pipito. Interscalene/shoulder rooms specifically call out Nielson first, Lambert second, Pipito third; Wu is capable but not preferred.

## Care Team Principles

- 1:3 is the normal target for comfortable MDs.
- 1:2 is used for reluctant MDs, OR Call joining a care team, BOOS opportunistic teams, and low remaining-AA situations.
- 1:1 is not intentionally formed as a care team.
- Remaining anesthetists after care-team formation are floats, not "available anesthetists."
- Geography matters. BOOS and IR are hard avoidances for cross-location care teams.
- Endo with Main OR is compatible. Cath with Main OR or Endo is allowed but less ideal.
- Care-team room selection favors suitable main OR rooms, fast-turnover rooms, and Endo where applicable, while avoiding IR, cardiac, thoracic, and other poor fits.
- Anesthetists are sorted by prior location history to spread variety across Endo and Main OR assignments.

## Care Team MD Ordering

- Available care-team MD order is CV Call, Backup CV, OR Call if they chose care team, locums, Backup Call, ranked providers, then 7/8-hour shift.
- OR Call who chooses care team is inserted before locums so the explicit choice is honored.
- Eskew and Shepherd are excluded from care teams and flow to solo fill.
- DeWitt is allowed in care teams but is reluctant and capped at 1:2.
- Brand is handled first for Endo and should not be consumed by other rooms before Endo logic runs.

## Block Room Doctrine

- Block-capable physicians should claim block rooms when feasible.
- Block-capable care-team MDs explicitly claim a block room before staggered room-picking runs.
- If a jump/flip pair includes a block room and the MD is block-capable, the pair is honored.
- Non-block-capable MDs skip block rooms when at least two non-block rooms are available, leaving block rooms for capable providers.
- BOOS rooms needing peripheral blocks prefer a regional-capable MD in solo fallback.

## Solo Fill

- Cath fallback runs before general solo fill so cath rooms left open by CV constraints do not lose all available MDs to main OR rooms.
- Solo fill excludes care-team rooms, cardiac rooms, cath rooms already handled, and phantom rooms already assigned.
- Remaining MD priority for solo fill is locums, Backup Call, Rank #3+, 7/8-hour shift, then OR Call.
- Room-level avoid-provider lists are respected when choosing from the remaining MD pool when possible.

## Late Coverage

- Late-stay tendency is tracked separately in provider intelligence.
- Siddiqui is first ask for late coverage, followed by Dodwani, Pond, Gathings, Nielson, Lambert, Powell, and Fraley.
