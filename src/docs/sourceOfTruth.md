# Source Of Truth

## Resource Sources

- qGenda = provider staffing
- OR.Endo.CCL = resource commitment / ceiling
- BMH Cube schedule = procedural demand copied into app

## qGenda

- qGenda is the source for provider staffing, roles, and availability.
- Parsed roles include OR Call, Back Up Call, Cardiac Call, Backup CV, OB Call, 7/8-hour shift, locums, ranks, anesthetists, PTO, OFF, Post OR, and Post OB.
- QGenda date matching accepts weekday lines and "Month Day, Year" date lines.
- Anesthetist rows include shift labels when present and exclude Off/PTO anesthetists from the active anesthetist pool.
- Rank rows build the ranked MD pool, excluding anesthetists.
- Locum rows enter the MD pool after ranked/backup logic according to assignment ordering.
- Provider profile details live in `src/data/providers.js`.

## OR.Endo.CCL

- OR.Endo.CCL is the source for resource commitments by area.
- App-level parser reads a pasted week block, finds a date in the first three columns, and reads columns C-G as Main OR, Endo, Cath, BOOS, and IR.
- When a selected date has OR.Endo.CCL data, the app auto-fills resource structure for that day.
- Main OR commitment is passed into Cube parsing as a ceiling.
- Cath commitment is passed into Cube parsing to create Cath Add-On phantom rooms when needed.
- Endo commitment is applied during care-team construction, not Cube parsing.
- Fractional commitments create split-day pairing guidance rather than direct room-count gaps.

## BMH Cube Schedule

- BMH Cube is the source for procedural demand copied into the app.
- Cube parsing groups cases into rooms, filters no-anesthesia cases, classifies room type, case type, acuity, block need, cardiac/cath flags, and provider preferences/avoidances.
- Cube date extraction detects dates from pasted schedule text and flags date mismatch when the selected date yields no parsed cases.
- BMH WL is not relabeled as an Add-On room; WL uses word-boundary matching only.
- Cube room names determine geography: Main OR, Endo, Cath/EP, BOOS, IR, and add-on status.

## Assignment Engine Inputs

- `rooms` come from parsed Cube data after Main OR/Cath commitment handling.
- `qg` comes from parsed qGenda data.
- `resourceStructure` comes from OR.Endo.CCL or manual resource entry/bypass.
- `orCallChoice` comes from the OR Call prompt.
- `anesthetistHistory` comes from saved historical location counts.
- `fractionalPairs` come from fractional OR.Endo.CCL resources.

## Assignment Engine Outputs

- `rooms` are the built daily room assignments.
- `careTeams` describes MD, ratio, room list, anesthetists, color, and reserve status when applicable.
- `floats` are anesthetists not placed in care teams.
- `available` is the remaining MD list with availability ranks.
- `config` and `anesthetistCount` describe the care-team model used.
- Generated room pairs connect split-day fractional resources for assignment updates.

## Provider Intelligence

- `src/data/providers.js` is the source for provider strengths, avoidances, care-team suitability, block capability, thoracic/cardiac flags, late-stay tendency, and notes.
- Brand is documented as Endo-only, never solo, and out around 2:30pm.
- CV primary providers are Thomas, Kane, and Munro.
- Pond and Dodwani can fill cardiac backup roles when needed.
- Regional/block-capable providers include Nielson, Lambert, Powell, Pipito, Dodwani, Pond, and selected limited-capability profiles such as Wu/Eskew depending on block type.

## Surgeon Intelligence

- `src/data/surgeons.js` is the source for surgeon block preferences.
- Block rules include always, usually, specific, selective, offered, appropriate, rarely, never, mood-dependent, and confirm.
- Surgeon profiles may include block case keywords, never-block keywords, block types, notes, and flags.
- Triplet is the key shoulder/interscalene rule source: blocks for all shoulder plus complex hand/arm, Nielson first, Lambert second, Pipito third.
- CV, cath, EP, IR, neurosurgery/spine, orthopedic, GYN, general surgery, urology, podiatry, ENT/peds, and unknown surgeon categories are documented there.

## User Overrides And Manual State

- Assignment dropdown changes update the selected room and any paired split-day room.
- Drag/drop pairing can create manual room pairs; breaking a pair removes both directions.
- Handoff status and overrides are UI state layered on top of the generated room assignments.
- OR Call choices are saved by provider/date for future prediction.
