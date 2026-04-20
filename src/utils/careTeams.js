// ─────────────────────────────────────────────────────────────
// CARE TEAM ENGINE — v3.4
// v3.2:
//   - unassignedRooms excludes isORCallChoice rooms
//   - globalUsed includes OR Call choice provider
//   - remainingMDs in solo pass sorted by priority order
//   - Watkins added to CARE_TEAM_COMFORTABLE
// v3.4:
//   - ctMDs NO LONGER filtered by CARE_TEAM_COMFORTABLE.
//     The "locums before backup call" rule is absolute. Every MD takes
//     rooms in strict priority order. CARE_TEAM_COMFORTABLE now only
//     gates whether the MD gets anesthetists (1:2/1:3) vs solo (1:1).
//   - Endo phantom add-on room restored: if committedEndo > cube rooms,
//     generate phantom Endo Add-On Room(s) to reach committed count.
// v3.5:
//   - Cath Lab Add-On fallback pass added.
// v3.6 (critical fixes):
//   - globalUsed now includes ALL already-assigned providers, not just
//     cardiac/cath. This prevents an MD assigned to a block/endo/peds
//     room in buildAssignments from being reassigned by the care team
//     loop here. Symptom: Nielson assigned to both a block room AND a
//     care team, causing downstream MDs like Pond to get skipped.
//   - unassignedRooms now filters by !assignedProvider, so rooms already
//     assigned in buildAssignments stay put — no more overwrites.
//   - Endo MD fallback: if Brand is off/PTO, the next available MD in
//     priority order covers endo. Without this, endo rooms and phantom
//     Endo Add-On rooms were skipped entirely when Brand wasn't working.
// ─────────────────────────────────────────────────────────────
import { classifyRoom } from './parsers.js';
 
export function getRoomBuilding(room) {
  return classifyRoom(room).building;
}
 
export function careTeamCompatible(buildingA, buildingB) {
  if (buildingA === buildingB) return 'yes';
  const combo = [buildingA, buildingB].sort().join('+');
  if (combo.includes('BOOS'))               return 'no';
  if (combo.includes('IR'))                 return 'no';
  if (combo === 'ENDO_FLOOR+MAIN_OR_FLOOR') return 'yes';
  if (combo === 'CATH_FLOOR+MAIN_OR_FLOOR') return 'ok';
  if (combo === 'CATH_FLOOR+ENDO_FLOOR')    return 'ok';
  return 'ok';
}
 
export const CARE_TEAM_COMFORTABLE = [
  'Wu, Jennifer', 'Kuraganti, Manjusha', 'Singh, Karampal',
  'Raghove, Vikas', 'Raghove, Punam', 'Pipito, Nicholas A',
  'Brand, David L', 'Gathings, Vincent', 'Siddiqui',
  'Nielson, Mark', 'Lambert', 'Powell, Jason',
  'Pond, William', 'Dodwani', 'Fraley', 'Watkins',
];
 
export const CARE_TEAM_AVOID     = ['Eskew, Gregory S', 'Shepherd'];
export const CARE_TEAM_RELUCTANT = ['DeWitt, Bracken J'];
 
export const CARE_TEAM_TABLE = {
  0:  { careTeamRooms: 0, mdsNeeded: 0, ratios: [],        floats: 0 },
  1:  { careTeamRooms: 1, mdsNeeded: 1, ratios: [1],       floats: 0 },
  2:  { careTeamRooms: 2, mdsNeeded: 1, ratios: [2],       floats: 0 },
  3:  { careTeamRooms: 3, mdsNeeded: 1, ratios: [3],       floats: 0 },
  4:  { careTeamRooms: 3, mdsNeeded: 1, ratios: [3],       floats: 1 },
  5:  { careTeamRooms: 5, mdsNeeded: 2, ratios: [2, 3],    floats: 0 },
  6:  { careTeamRooms: 6, mdsNeeded: 2, ratios: [3, 3],    floats: 0 },
  7:  { careTeamRooms: 6, mdsNeeded: 2, ratios: [3, 3],    floats: 1 },
  8:  { careTeamRooms: 8, mdsNeeded: 3, ratios: [3, 3, 2], floats: 0 },
  9:  { careTeamRooms: 9, mdsNeeded: 3, ratios: [3, 3, 3], floats: 0 },
  10: { careTeamRooms: 9, mdsNeeded: 3, ratios: [3, 3, 3], floats: 1 },
};
 
export function getCareTeamConfig(anesthetistCount) {
  if (anesthetistCount <= 0) return CARE_TEAM_TABLE[0];
  if (CARE_TEAM_TABLE[anesthetistCount]) return CARE_TEAM_TABLE[anesthetistCount];
  const mdsNeeded = Math.floor(anesthetistCount / 3);
  const remainder = anesthetistCount % 3;
  const ratios    = Array(mdsNeeded).fill(3);
  if (remainder > 0) ratios.push(remainder);
  return { careTeamRooms: anesthetistCount, mdsNeeded: ratios.length, ratios, floats: 0 };
}
 
export function roomCareTeamSuitability(room) {
  if (!room) return 'ok';
  if (room.isIR)                                   return 'avoid';
  if (room.isCardiac || room.acuity === 'cardiac')  return 'avoid';
  if (room.isThoracic)                              return 'avoid';
  if (room.acuity === 'high')                       return 'ok';
  if (room.isEndo)                                  return 'good';
  if (room.isFastTurnover)                          return 'good';
  if (room.isBOOS)                                  return 'ok';
  if (room.isRobotic)                               return 'ok';
  return 'ok';
}
 
export const CARE_TEAM_COLORS = [
  { bg: '#0f2a1e', border: '#22c55e', text: '#4ade80', label: 'Care Team 1' },
  { bg: '#1e1a0f', border: '#f59e0b', text: '#fbbf24', label: 'Care Team 2' },
  { bg: '#0f1a2e', border: '#3b82f6', text: '#60a5fa', label: 'Care Team 3' },
  { bg: '#2a0f2a', border: '#a855f7', text: '#c084fc', label: 'Care Team 4' },
  { bg: '#2a1a0f', border: '#f97316', text: '#fb923c', label: 'Care Team 5' },
  { bg: '#0f2a2a', border: '#14b8a6', text: '#2dd4bf', label: 'Care Team 6' },
];
 
const PERIPHERAL_BLOCK_KEYWORDS = [
  'interscalene','peng','adductor canal','popliteal','sciatic',
  'femoral nerve','fascia iliaca','infraclavicular','axillary block',
  'supraclavicular','wrist block','ankle block',
];
const REGIONAL_CAPABLE = ['Nielson, Mark','Lambert','Powell, Jason','Pipito, Nicholas A','Dodwani','Pond, William'];
 
function boosNeedsPeripheralBlock(room) {
  if (!room?.cases?.length) return room?.blockRequired || false;
  const allProcs = room.cases.map(c => (c.procedure || '').toLowerCase()).join(' ');
  if (allProcs.includes('spinal') && !PERIPHERAL_BLOCK_KEYWORDS.some(k => allProcs.includes(k)))
    return false;
  return PERIPHERAL_BLOCK_KEYWORDS.some(k => allProcs.includes(k)) || room.blockRequired;
}
 
// ─────────────────────────────────────────────────────────────
export function buildCareTeams(rooms, qg, anesthetistHistory = {}, resourceStructure = {}) {
  if (!rooms?.length || !qg) return { rooms, careTeams: [], floats: [], available: [] };
 
  const activeAnesthetists = (qg.Anesthetists || []).filter(a => !a.isAdmin && !a.isOff);
  const anesthetistCount   = activeAnesthetists.length;
  const config             = getCareTeamConfig(anesthetistCount);
  const { careTeamRooms: maxCTRooms, ratios, floats: floatCount } = config;
 
  // ── Pre-assigned rooms ──────────────────────────────────────
  const preAssigned = rooms.filter(r => r.assignedProvider && (r.isCardiac || r.isCathEP));
 
  // unassignedRooms: rooms WITHOUT an assignedProvider, excluding OR Call choice rooms.
  // Any room already assigned by buildAssignments (block, endo, peds, cardiac) stays
  // put — we never re-process it here.
  const unassignedRooms = rooms.filter(r =>
    !r.assignedProvider && !r.isORCallChoice
  );
 
  // globalUsed: EVERY provider already assigned by the time buildCareTeams runs.
  // This includes cardiac/cath (cardiacDecisionTree), block rooms, endo, peds, OR Call
  // choice — anything buildAssignments did. Without this, an MD assigned to a block
  // room would also be picked for a care team, duplicating them across rooms.
  const globalUsed = new Set();
  rooms.forEach(r => { if (r.assignedProvider) globalUsed.add(r.assignedProvider); });
 
  // soloUsed: ALL already-assigned providers — prevents solo pass double-assignment
  const soloUsed = new Set();
  rooms.forEach(r => { if (r.assignedProvider) soloUsed.add(r.assignedProvider); });
 
  // ── Geographic segregation ────────────────────────────────────
  const endoRooms = unassignedRooms.filter(r => r.isEndo);
  const boosRooms = unassignedRooms.filter(r => r.isBOOS);
  const irRooms   = unassignedRooms.filter(r => r.isIR);
  const mainRooms = unassignedRooms.filter(r =>
    !r.isEndo && !r.isBOOS && !r.isIR && !r.isCardiac && !r.isCathEP
  );
 
  const scoredMain = mainRooms.map(r => ({
    ...r,
    building: r.building || getRoomBuilding(r.room),
    ctScore:  roomCareTeamSuitability(r) === 'good' ? 2 :
              roomCareTeamSuitability(r) === 'ok'   ? 1 : 0,
  })).sort((a, b) => b.ctScore - a.ctScore);
 
  let remainingRatios = [...ratios];
 
  const workingMDs   = qg.workingMDs || [];
 
  // availableMDs: priority order — Locums first, then Backup Call, then Rank 3+
  const availableMDs = [
    ...workingMDs.filter(p => p.role === 'Cardiac Call (CV)'),
    ...workingMDs.filter(p => p.role === 'Backup CV'),
    ...workingMDs.filter(p => p.role === 'Locum'),
    ...workingMDs.filter(p => p.role === 'Back Up Call (#2)'),
    ...workingMDs.filter(p => p.rankNum >= 3 && p.rankNum < 50).sort((a, b) => a.rankNum - b.rankNum),
    ...workingMDs.filter(p => p.role === '7/8 Hr Shift'),
  ].filter(p =>
    !preAssigned.find(r => r.assignedProvider === p.name) &&
    !globalUsed.has(p.name)
  );
 
  const brandMD   = workingMDs.find(p => p.name === 'Brand, David L');
  const careTeams = [];
  const usedMDs   = new Set([...globalUsed]);
  const usedAnesthetists = new Set([...globalUsed]);
 
  let anesthetistPool = activeAnesthetists.filter(a => !globalUsed.has(a.name));
  anesthetistPool = sortAnesthetistsByVariety(anesthetistPool, 'endo', anesthetistHistory);
 
  // ── Care Team A: Brand → Endo ─────────────────────────────────
  // OR.endo.CCL is BOTH the floor AND the ceiling for endo rooms we cover.
  //   - If cube shows FEWER rooms than committed, generate Endo Add-On Room(s)
  //     to fill up to the committed count — those are the add-on rooms the
  //     department holds open for inpatient adds.
  //   - If cube shows EQUAL or MORE rooms than committed, we staff exactly
  //     the committed count (no excess).
  //   - If committed is 0, we staff no endo rooms even if cube shows cases.
  // Endo MD selection: Brand is preferred, but if he's off/PTO we use the next
  // available MD in priority order (same availableMDs ordering used elsewhere).
  // Without this fallback, the whole endo block (including phantom add-on
  // generation) would be skipped when Brand isn't working.
  const committedEndo = Math.min(Math.ceil(parseFloat(resourceStructure.endo) || 0), 3);
  const endoMD = (brandMD && !usedMDs.has(brandMD.name))
    ? brandMD
    : availableMDs.find(p => !usedMDs.has(p.name));
  if (endoMD && committedEndo > 0) {
    // How many visible (cube) endo rooms we'll use: capped at committed
    const visibleCount  = Math.min(endoRooms.length, committedEndo);
    const visibleToUse  = endoRooms.slice(0, visibleCount);
    // How many phantom Add-On rooms to generate to reach committed
    const phantomCount  = committedEndo - visibleCount;
    const totalRooms    = committedEndo;
    const endoAnests    = anesthetistPool.splice(0, totalRooms);
 
    // Real (cube) endo rooms — update in place
    const endoMDLastName = endoMD.name.split(',')[0];
    const visibleAssignment = visibleToUse.map((room, i) => ({
      ...room,
      assignedProvider: endoMD.name,
      anesthetist:   endoAnests[i]?.name || null,
      careTeamId:    0,
      careTeamLabel: `Care Team 1 — ${endoMDLastName} 1:${totalRooms}`,
      careTeamRatio: `1:${totalRooms}`,
      isCareTeam:    true,
    }));
 
    // Phantom add-on rooms — fresh room objects appended to the rooms array
    const phantomRooms = Array.from({ length: phantomCount }, (_, i) => ({
      room:            phantomCount === 1 ? 'Endo Add-On Room' : `Endo Add-On Room ${i + 1}`,
      area:            'BMH ENDO',
      building:        'ENDO_FLOOR',
      isEndo:          true,
      isCareTeam:      true,
      isPhantom:       true,
      acuity:          'routine',
      cases:           [],
      caseCount:       0,
      surgeons:        [],
      flags:           [{ level: 'info', msg: 'Endo Add-On Room — reserved per OR.endo.CCL, no cases booked yet' }],
      assignedProvider: endoMD.name,
      anesthetist:      endoAnests[visibleCount + i]?.name || null,
      careTeamId:       0,
      careTeamLabel:    `Care Team 1 — ${endoMDLastName} 1:${totalRooms}`,
      careTeamRatio:    `1:${totalRooms}`,
      caseStatus:       'Not Started',
      cardiacNote:      '',
      blockRequired:    false,
      blockPossible:    false,
      preferredProviders: [],
      avoidProviders:   [],
      manuallyAdded:    false,
    }));
 
    careTeams.push({
      id: 0, md: endoMD.name, ratio: `1:${totalRooms}`,
      rooms: [...visibleAssignment.map(r => r.room), ...phantomRooms.map(r => r.room)],
      anesthetists: endoAnests.map(a => a.name),
      color: CARE_TEAM_COLORS[0],
      hasReserve: phantomCount > 0,
    });
 
    usedMDs.add(endoMD.name);
    endoAnests.forEach(a => usedAnesthetists.add(a.name));
    if (remainingRatios.length > 0) remainingRatios.shift();
 
    // Update real rooms in place
    visibleToUse.forEach((room, i) => {
      const idx = rooms.findIndex(r => r.room === room.room);
      if (idx >= 0) rooms[idx] = visibleAssignment[i];
    });
    // Append phantom rooms
    phantomRooms.forEach(pr => rooms.push(pr));
  }
 
  // ── Care Teams B+: Main OR ────────────────────────────────────
  // ctMDs: only MDs who will actually form care teams (1:2 or 1:3).
  // CARE_TEAM_AVOID (Eskew, Shepherd) and CARE_TEAM_RELUCTANT (DeWitt) are
  // excluded here — they go to the solo fill pass instead. Including them here
  // gave them a "1:1 (Solo)" care team label (which we never do) and wasted
  // a ratio slot from the care team table, leaving AAs stranded as "available."
  const ctMDs = availableMDs.filter(p =>
    !usedMDs.has(p.name) &&
    !CARE_TEAM_AVOID.includes(p.name) &&
    !CARE_TEAM_RELUCTANT.includes(p.name)
  );
 
  let ctIdx    = 1;
  let roomPool = [...scoredMain.filter(r => roomCareTeamSuitability(r) !== 'avoid')];
 
  for (const ratio of remainingRatios) {
    if (ctMDs.length === 0 || roomPool.length === 0) break;
    const md = ctMDs.shift();
    if (!md || usedMDs.has(md.name)) continue;
 
    // Check if THIS MD is care-team-comfortable.
    // If yes → form a care team (1:2 or 1:3 with anesthetists).
    // If no → they take ONE room solo (1:1, no anesthetist attached).
    // Either way, this MD got a room — we never skip them to keep priority order.
    const mdComfortable = CARE_TEAM_COMFORTABLE.includes(md.name);
    const desiredRatio  = mdComfortable ? ratio : 1;
    const actualRatio   = Math.min(desiredRatio, roomPool.length);
    if (actualRatio === 0) { usedMDs.add(md.name); continue; }
 
    const ctRooms = pickStaggeredRooms(roomPool, actualRatio);
    if (ctRooms.length === 0) { usedMDs.add(md.name); continue; }
 
    ctRooms.forEach(r => { roomPool = roomPool.filter(x => x.room !== r.room); });
 
    // Only attach anesthetists if this MD is care-team-comfortable.
    // Non-comfortable MDs run solo (no AA attached at this stage).
    let ctAnests = [];
    if (mdComfortable) {
      const sortedAnests = sortAnesthetistsByVariety(
        anesthetistPool.filter(a => !usedAnesthetists.has(a.name)),
        'main', anesthetistHistory
      );
      ctAnests = sortedAnests.splice(0, actualRatio);
      ctAnests.forEach(a => usedAnesthetists.add(a.name));
      anesthetistPool = anesthetistPool.filter(a => !usedAnesthetists.has(a.name));
    }
 
    const color     = CARE_TEAM_COLORS[ctIdx % CARE_TEAM_COLORS.length];
    const teamLabel = mdComfortable
      ? `Care Team ${ctIdx + 1} — ${md.name.split(',')[0]} 1:${actualRatio}`
      : `${md.name.split(',')[0]} — Solo`;
 
    careTeams.push({
      id: ctIdx, md: md.name, ratio: mdComfortable ? `1:${actualRatio}` : '1:1 (Solo)',
      rooms: ctRooms.map(r => r.room),
      anesthetists: ctAnests.map(a => a.name),
      color,
      isSolo: !mdComfortable,
    });
    usedMDs.add(md.name);
 
    ctRooms.forEach((room, i) => {
      const idx = rooms.findIndex(r => r.room === room.room);
      if (idx >= 0) {
        rooms[idx] = {
          ...rooms[idx],
          assignedProvider: md.name,
          anesthetist:   ctAnests[i]?.name || null,
          careTeamId:    mdComfortable ? ctIdx : undefined,
          careTeamLabel: mdComfortable ? teamLabel : null,
          careTeamRatio: mdComfortable ? `1:${actualRatio}` : null,
          isCareTeam:    mdComfortable,
        };
      }
    });
 
    ctIdx++;
  }
 
  // ── BOOS: opportunistic 1:2 ──────────────────────────────────
  const remainingAnests    = anesthetistPool.filter(a => !usedAnesthetists.has(a.name));
  const boosCareTeamPossible = boosRooms.length >= 2 && remainingAnests.length >= 2;
 
  if (boosCareTeamPossible) {
    const boosNeedsBlock    = boosRooms.some(r => boosNeedsPeripheralBlock(r));
    const remainingMDsForBoos = availableMDs.filter(p => !usedMDs.has(p.name));
    let boosMD = null;
    if (boosNeedsBlock) {
      boosMD = remainingMDsForBoos.find(p => REGIONAL_CAPABLE.includes(p.name));
    }
    if (!boosMD) boosMD = remainingMDsForBoos[0];
 
    if (boosMD) {
      const boosAnests = remainingAnests.slice(0, 2);
      const color      = CARE_TEAM_COLORS[ctIdx % CARE_TEAM_COLORS.length];
      const teamLabel  = `Care Team ${ctIdx + 1} — ${boosMD.name.split(',')[0]} 1:2 (BOOS)`;
 
      careTeams.push({
        id: ctIdx, md: boosMD.name, ratio: '1:2',
        rooms: boosRooms.slice(0, 2).map(r => r.room),
        anesthetists: boosAnests.map(a => a.name),
        color, isBOOS: true,
      });
 
      usedMDs.add(boosMD.name);
      boosAnests.forEach(a => usedAnesthetists.add(a.name));
      anesthetistPool = anesthetistPool.filter(a => !usedAnesthetists.has(a.name));
 
      boosRooms.slice(0, 2).forEach((room, i) => {
        const idx = rooms.findIndex(r => r.room === room.room);
        if (idx >= 0) {
          rooms[idx] = {
            ...rooms[idx],
            assignedProvider: boosMD.name,
            anesthetist:   boosAnests[i]?.name || null,
            careTeamId:    ctIdx,
            careTeamLabel: teamLabel,
            careTeamRatio: '1:2',
            isCareTeam:    true,
          };
        }
      });
      ctIdx++;
    }
  }
 
  // ── Float anesthetists ────────────────────────────────────────
  const floatAnests = anesthetistPool
    .filter(a => !usedAnesthetists.has(a.name))
    .slice(0, floatCount);
 
  // Sort remaining MDs in strict priority order: Locums → Backup Call → Rank 3+
  const allAssignedNow = new Set([...soloUsed, ...usedMDs]);
  const remainingMDs = [
    ...workingMDs.filter(p => p.role === 'Locum'),
    ...workingMDs.filter(p => p.role === 'Back Up Call (#2)'),
    ...workingMDs.filter(p => p.rankNum >= 3 && p.rankNum < 50).sort((a, b) => a.rankNum - b.rankNum),
    ...workingMDs.filter(p => p.role === '7/8 Hr Shift'),
    ...workingMDs.filter(p => p.role === 'OR Call (#1)'),
  ].filter(p => !allAssignedNow.has(p.name));
 
  let mdPool = [...remainingMDs];
 
  // ── Cath fallback ─────────────────────────────────────────────
  // Cath rooms (real or phantom) left unassigned by cardiacDecisionTree
  // (because CV team was occupied by Tier 1/2 cases elsewhere) get
  // filled here from standard priority. Must run BEFORE solo fill so
  // these rooms get providers before general main-OR solo rooms consume the pool.
  const unassignedCathRooms = rooms.filter(r => r.isCathEP && !r.assignedProvider);
  for (const room of unassignedCathRooms) {
    const md = mdPool.find(p => !room.avoidProviders?.includes(p.name)) || mdPool[0];
    if (md) {
      const idx = rooms.findIndex(r => r.room === room.room);
      if (idx >= 0) {
        rooms[idx] = {
          ...rooms[idx],
          assignedProvider: md.name,
          anesthetist: null,
          isCareTeam: false,
          careTeamLabel: null,
          cardiacNote: rooms[idx].cardiacNote || 'General fill — CV team occupied',
        };
      }
      mdPool = mdPool.filter(p => p.name !== md.name);
      usedMDs.add(md.name);
    }
  }
 
  // ── Solo fill ─────────────────────────────────────────────────
  // Cath rooms already handled above. Phantoms (including the Endo phantom
  // created earlier in this function) already have providers assigned.
  const soloRooms = rooms.filter(r =>
    !r.isCareTeam && !r.isCardiac && !r.isCathEP && !r.isPhantom
  );
 
  // BOOS block rooms — regional MD first
  for (const room of soloRooms.filter(r => r.isBOOS && boosNeedsPeripheralBlock(r))) {
    if (room.assignedProvider) continue;
    const md = mdPool.find(p => REGIONAL_CAPABLE.includes(p.name)) || mdPool[0];
    if (md) {
      const idx = rooms.findIndex(r => r.room === room.room);
      if (idx >= 0) rooms[idx] = { ...rooms[idx], assignedProvider: md.name, anesthetist: null, isCareTeam: false, careTeamLabel: null };
      mdPool = mdPool.filter(p => p.name !== md.name);
      usedMDs.add(md.name);
    }
  }
 
  // All other solo rooms (including IR — always solo, never care team)
  for (const room of soloRooms) {
    if (room.assignedProvider) continue;
    const md = mdPool.find(p => !room.avoidProviders?.includes(p.name)) || mdPool[0];
    if (md) {
      const idx = rooms.findIndex(r => r.room === room.room);
      if (idx >= 0) rooms[idx] = { ...rooms[idx], assignedProvider: md.name, anesthetist: null, isCareTeam: false, careTeamLabel: null };
      mdPool = mdPool.filter(p => p.name !== md.name);
      usedMDs.add(md.name);
    }
  }
 
  const availableMDsList = mdPool
    .filter(p => !allAssignedNow.has(p.name) && !usedMDs.has(p.name))
    .map((p, i) => ({
      ...p,
      availabilityRank: i + 1,
      label: i === 0 ? '1st Available' : i === 1 ? '2nd Available' : `${i + 1}th Available`,
    }));
 
  return { rooms, careTeams, floats: floatAnests, available: availableMDsList, config, anesthetistCount };
}
 
function pickStaggeredRooms(roomPool, count) {
  if (roomPool.length <= count) return roomPool.slice(0, count);
 
  const withTimes = roomPool.map(r => ({
    ...r,
    building: r.building || getRoomBuilding(r.room),
    sortTime: r.startTime || '9999',
  })).sort((a, b) => a.sortTime.localeCompare(b.sortTime));
 
  const picked    = [];
  const usedTimes = new Set();
  let dominantBuilding = null;
 
  for (const room of withTimes) {
    if (picked.length >= count) break;
    if (dominantBuilding && careTeamCompatible(dominantBuilding, room.building) === 'no') continue;
    const timeKey = room.sortTime?.split(' ')[1] || 'unknown';
    if (!usedTimes.has(timeKey) || picked.length < count) {
      picked.push(room);
      usedTimes.add(timeKey);
      if (!dominantBuilding) dominantBuilding = room.building;
    }
  }
 
  for (const room of withTimes) {
    if (picked.length >= count) break;
    if (picked.find(p => p.room === room.room)) continue;
    const compat = dominantBuilding ? careTeamCompatible(dominantBuilding, room.building) : 'yes';
    if (compat !== 'no') picked.push(room);
  }
 
  return picked.slice(0, count);
}
 
function sortAnesthetistsByVariety(anesthetists, area, history) {
  if (!history || Object.keys(history).length === 0) return anesthetists;
  return [...anesthetists].sort((a, b) => {
    const aCount = (history[a.name] || {})[area] || 0;
    const bCount = (history[b.name] || {})[area] || 0;
    return aCount - bCount;
  });
}
 
