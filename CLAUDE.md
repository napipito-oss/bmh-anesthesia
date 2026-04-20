BMH Anesthesia Command Center
Project Overview
A live OR scheduling tool for Ball Memorial Hospital (BMH) Anesthesia Department.
Built in React + Vite, deployed on Vercel.
Repo: napipito-oss/bmh-anesthesia | Live: bmh-anesthesia.vercel.app
Owner/developer: Nick Pipito, MD — Director of Anesthesia and OR Medical Director.
Not a software engineer by trade. Prioritize clean, readable, well-commented code.

Architecture
Key Files

src/parsers.js — Handles priority locks only (do not add team formation logic here)
src/careTeams.js — All team formation and solo fill logic lives here
src/App.jsx — Main UI and state management

Stack

React + Vite
Deployed via Vercel (auto-deploy on push to main)
No backend — all logic runs client-side


Core Scheduling Rules (DO NOT BREAK THESE)
These rules are non-negotiable constraints embedded in the scheduling logic:

Care Team Ratios

Standard: 1 MD : 3 CRNAs (target model)
BOOS rooms: max 1:2 ratio
IR: MD solo only (no CRNA pairing)
Endo: phantom pairing allowed


Call Priority

OR Call is honored first before any elective assignment
OB Call is excluded from OR team assignments


Drag-to-Pair

Users can manually override automated pairings via drag-and-drop
Do not break this interaction when modifying team formation logic


CBS Ranking

Fairness tracking system for equitable case/call distribution
Ranking informs assignment priority — lower CBS score = higher assignment priority




What's Working (Don't Regress)

Correct care team ratio calculation
OR Call honored first
BOOS capped at 1:2
IR solo enforcement
Endo phantom pairing
Drag-to-pair functionality
OB Call exclusion from OR teams


Known Complexity / Watch Areas

parsers.js and careTeams.js have a strict division of responsibility.
Priority locks → parsers.js. Team formation → careTeams.js. Keep them separate.
Vercel deploys automatically on push to main. Test logic changes before pushing.
The scheduling model is shifting from 1:2 toward 1:3. Any ratio logic changes
should preserve backward compatibility or be explicitly flagged.


Department Context (for understanding feature requests)

9 MD anesthesiologists + CRNAs operating under care team model
Heavy locum use currently — scheduling system is part of reducing that dependency
OB nocturnist program in development (3 nocturnists, 7pm–7am, 1-on/2-off rotation)
Scheduling Governance Committee (SGC) being built — tool may need governance exports


Development Preferences

Prefer small, testable changes over large rewrites
Comment non-obvious logic thoroughly
If a change touches ratio logic, call priority, or CBS ranking — flag it explicitly
before implementing and explain the downstream impact
When uncertain about intent, ask before building
