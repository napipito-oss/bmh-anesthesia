// ─────────────────────────────────────────────────────────────
// CARE TEAM ENGINE — v3.1 (Chunk 3 corrected)
// BOOS rules:
//   - Max 1:2 (only 2 ORs exist)
//   - Only gets a care team if anesthetists remain after
//     Main OR + Endo are optimally covered
//   - Never mixed into a Main OR care team
//   - Block-capable MD required if peripheral nerve blocks needed
//     (interscalene, PENG, adductor canal, popliteal/sciatic)
//   - Spinals do not require regional-capable MD
// IR rules:
//   - Always solo, never care team
// ─────────────────────────────────────────────────────────────
import { classifyRoom } from './parsers.js';
 
export function getRoomBuilding(room) {
  return classifyRoom(room).building;
}
 
// Check if two buildings can share a care team
// Returns: 'yes' | 'ok' | 'no'
export function careTeamCompatible(buildingA, buildingB) {
  if (buildingA === buildingB) return 'yes';
  const combo = [buildingA, buildingB].sort().join('+');
  if (combo.includes('BOOS'))               return 'no';  // hard — BOOS never mixes
  if (combo.includes('IR'))                 return 'no';  // hard — IR always solo
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
  const ratios = Array(mdsNeeded).fill(3);
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
 
// ── Detect if a BOOS room needs a peripheral nerve block MD ──
// Spinals do NOT require regional-capable — only peripheral blocks do
const PERIPHERAL_BLOCK_KEYWORDS = [
  'interscalene', 'peng', 'adductor canal', 'popliteal', 'sciatic',
  'femoral nerve', 'fascia iliaca', 'infraclavicular', 'axillary block',
  'supraclavicular', 'wrist block', 'ankle block',
];
 
function boosNeedsPeripheralBlock(room) {
  if (!room?.cases?.length) return room?.blockRequired || false;
  const allProcs = room.cases.map(c => (c.procedure || '').toLowerCase()).join(' ');
  // If it's just a spinal, regional-capable not required
  if (allProcs.includes('spinal') && !PERIPHERAL_BLOCK_KEYWORDS.some(k => allProcs.includes(k)))
    return false;
  return PERIPHERAL_BLOCK_KEYWORDS.some(k => allProcs.includes(k)) || room.blockRequired;
}
 
const REGIONAL_CAPABLE = ['Nielson, Mark', 'Lambert', 'Powell, Jason', 'Pipito, Nicholas A', 'Dodwani', 'Pond, William'];
 
// ─────────────────────────────────────────────────────────────
// MAIN CARE TEAM BUILDER
// ─────────────────────────────────────────────────────────────
export function buildCareTeams(rooms, qg, anesthetistHistory = {}, resourceStructure = {}) {
  if (!rooms?.length || !qg) return { rooms, careTeams: [], floats: [], available: [] };
 
  const activeAnesthetists = (qg.Anesthetists || []).filter(a => !a.isAdmin && !a.isOff);
  const anesthetistCount   = activeAnesthetists.length;
  const config             = getCareTeamConfig(anesthetistCount);
  const { careTeamRooms: maxCTRooms, ratios, floats: floatCount } = config;
 
  // ── Pre-assigned rooms ──────────────────────────────────────
  // preAssigned = cardiac/cath rooms (MD locked by decision tree).
  // unassignedRooms = everything else (care teams form from these).
  // ctUsed = used set for care team MD selection (cardiac/cath only).
  // soloUsed = used set for the final solo fill pass (ALL assigned providers,
  //   prevents the solo pass from re-assigning MDs already placed by buildAssignments).
  const preAssigned     = rooms.filter(r => r.assignedProvider && (r.isCardiac || r.isCathEP));
  const unassignedRooms = rooms.filter(r => !preAssigned.find(p => p.room === r.room) && !r.isORCallChoice);
 
  // ctUsed: cardiac/cath providers + OR Call choice — excludes them from care team formation
  const globalUsed = new Set();
  preAssigned.forEach(r => { if (r.assignedProvider) globalUsed.add(r.assignedProvider); });
  // OR Call choice room is locked — exclude that provider from care team MD pool too
  rooms.filter(r => r.isORCallChoice).forEach(r => { if (r.assignedProvider) globalUsed.add(r.assignedProvider); });
 
  // soloUsed: ALL already-assigned providers — prevents solo pass double-assignment
  const soloUsed = new Set();
  rooms.forEach(r => { if (r.assignedProvider) soloUsed.add(r.assignedProvider); });
 
  // ── Hard geographic segregation ──────────────────────────────
  // BOOS and IR are pulled out before care team formation begins.
  // They are never in the pool that Main OR care teams draw from.
  const endoRooms = unassignedRooms.filter(r => r.isEndo);
  const boosRooms = unassignedRooms.filter(r => r.isBOOS);
  const irRooms   = unassignedRooms.filter(r => r.isIR);
  const mainRooms = unassignedRooms.filter(r =>
    !r.isEndo && !r.isBOOS && !r.isIR && !r.isCardiac && !r.isCathEP
  );
 
  const scoredMain = mainRooms.map(r => ({
    ...r,
    building: r.building || getRoomBuilding(r.room),
    ctScore: roomCareTeamSuitability(r) === 'good' ? 2 :
             roomCareTeamSuitability(r) === 'ok'   ? 1 : 0,
  })).sort((a, b) => b.ctScore - a.ctScore);
 
  let remainingRatios = [...ratios];
 
  const workingMDs   = qg.workingMDs || [];
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
 
  // ── CARE TEAM A: Brand → Endo ────────────────────────────────
  if (brandMD && endoRooms.length > 0) {
    const committedEndo = Math.min(Math.ceil(parseFloat(resourceStructure.endo) || 0), 3);
    const cappedRatio   = Math.min(Math.max(endoRooms.length, committedEndo), 3);
    const endoAnests    = anesthetistPool.splice(0, cappedRatio);
    const visibleRooms  = endoRooms.slice(0, cappedRatio);
    const phantomCount  = cappedRatio - visibleRooms.length;
 
    const phantomRooms = Array.from({ length: phantomCount }, (_, i) => ({
      room: 'Endo Add-Ons',
      area: 'BMH ENDO', building: 'ENDO_FLOOR',
      isEndo: true, isCareTeam: true, isPhantom: true,
      acuity: 'routine', cases: [], caseCount: 0, surgeons: [],
      flags: [{ level: 'info', msg: 'Reserved for inpatient add-on — no cases booked yet' }],
      assignedProvider: brandMD.name,
      anesthetist: endoAnests[visibleRooms.length + i]?.name || null,
      careTeamId: 0, careTeamLabel: 'Care Team 1 — Brand',
      careTeamRatio: `1:${cappedRatio}`, caseStatus: 'Not Started',
      cardiacNote: '', blockRequired: false, blockPossible: false,
      preferredProviders: [], avoidProviders: [], manuallyAdded: false,
    }));
 
    const endoAssignment = [
      ...visibleRooms.map((room, i) => ({
        ...room,
        assignedProvider: brandMD.name,
        anesthetist:   endoAnests[i]?.name || null,
        careTeamId:    0,
        careTeamLabel: `Care Team 1 — Brand 1:${cappedRatio}`,
        careTeamRatio: `1:${cappedRatio}`,
        isCareTeam:    true,
      })),
      ...phantomRooms,
    ];
 
    careTeams.push({
      id: 0, md: brandMD.name, ratio: `1:${cappedRatio}`,
      rooms: endoAssignment.map(r => r.room),
      anesthetists: endoAnests.map(a => a.name),
      color: CARE_TEAM_COLORS[0],
      hasReserve: phantomCount > 0,
    });
 
    usedMDs.add(brandMD.name);
    endoAnests.forEach(a => usedAnesthetists.add(a.name));
    if (remainingRatios.length > 0) remainingRatios.shift();
 
    visibleRooms.forEach((room, i) => {
      const idx = rooms.findIndex(r => r.room === room.room);
      if (idx >= 0) rooms[idx] = endoAssignment[i];
    });
    phantomRooms.forEach(pr => rooms.push(pr));
  }
 
  // ── CARE TEAMS B+: Main OR rooms ────────────────────────────
  // BOOS and IR are not in scoredMain — they cannot leak in here.
  // ctMDs = all available MDs in priority order (Locums → Back Up Call → Rank 3+)
  // CARE_TEAM_COMFORTABLE only controls anesthetist assignment, not room assignment
  // Every MD gets a room in QGenda priority order regardless of care team comfort
  const ctMDs = availableMDs
    .filter(p => !usedMDs.has(p.name));
 
  let ctIdx    = 1;
  let roomPool = [...scoredMain.filter(r => roomCareTeamSuitability(r) !== 'avoid')];
 
  for (const ratio of remainingRatios) {
    if (ctMDs.length === 0 || roomPool.length === 0) break;
    const actualRatio = Math.min(ratio, roomPool.length);
    if (actualRatio === 0) break;
 
    const md = ctMDs.shift();
    if (!md || usedMDs.has(md.name)) continue;
 
    // MDs who avoid care teams (e.g. Eskew) get one solo room, no anesthetist
    const avoidsCT = CARE_TEAM_AVOID.includes(md.name);
    const isCTComfy = !avoidsCT && CARE_TEAM_COMFORTABLE.includes(md.name);
    const assignRatio = avoidsCT ? 1 : actualRatio;
 
    const ctRooms = pickStaggeredRooms(roomPool, assignRatio);
    if (ctRooms.length === 0) break;
 
    ctRooms.forEach(r => { roomPool = roomPool.filter(x => x.room !== r.room); });
 
    // Only assign anesthetists if MD is care-team-comfortable
    const anestCandidates = isCTComfy ? sortAnesthetistsByVariety(
      anesthetistPool.filter(a => !usedAnesthetists.has(a.name)),
      'main', anesthetistHistory
    ) : [];
    const ctAnests = anestCandidates.slice(0, assignRatio);
    ctAnests.forEach(a => usedAnesthetists.add(a.name));
    anesthetistPool = anesthetistPool.filter(a => !usedAnesthetists.has(a.name));
 
    const color     = CARE_TEAM_COLORS[ctIdx % CARE_TEAM_COLORS.length];
    const teamLabel = isCTComfy
      ? `Care Team ${ctIdx + 1} — ${md.name.split(',')[0]} 1:${assignRatio}`
      : null;
 
    if (isCTComfy) {
      careTeams.push({
        id: ctIdx, md: md.name, ratio: `1:${assignRatio}`,
        rooms: ctRooms.map(r => r.room),
        anesthetists: ctAnests.map(a => a.name),
        color,
      });
    }
    usedMDs.add(md.name);
 
    ctRooms.forEach((room, i) => {
      const idx = rooms.findIndex(r => r.room === room.room);
      if (idx >= 0) {
        rooms[idx] = {
          ...rooms[idx],
          assignedProvider: md.name,
          anesthetist:      ctAnests[i]?.name || null,
          careTeamId:       isCTComfy ? ctIdx : undefined,
          careTeamLabel:    teamLabel,
          careTeamRatio:    isCTComfy ? `1:${assignRatio}` : null,
          isCareTeam:       isCTComfy,
        };
      }
    });
 
    if (isCTComfy) ctIdx++;
  }
 
  // ── BOOS: opportunistic 1:2 care team or solo ────────────────
  // Only attempted after Main OR + Endo are fully formed.
  // Max ratio is 1:2 (only 2 BOOS ORs exist — never 1:3).
  // Gets a care team only if 2 BOOS rooms are running AND
  // at least 2 anesthetists remain unused.
  // Block-capable MD required if any room needs peripheral nerve blocks.
  const remainingAnests = anesthetistPool.filter(a => !usedAnesthetists.has(a.name));
  const bооsCareTeamPossible = boosRooms.length >= 2 && remainingAnests.length >= 2;
 
  if (bооsCareTeamPossible) {
    // Pick the best MD for BOOS — block-capable if needed
    const boosNeedsBlock = boosRooms.some(r => boosNeedsPeripheralBlock(r));
    const remainingMDsForBoos = availableMDs.filter(p => !usedMDs.has(p.name));
 
    let boosMD = null;
    if (boosNeedsBlock) {
      // Regional-capable first
      boosMD = remainingMDsForBoos.find(p => REGIONAL_CAPABLE.includes(p.name));
    }
    // Fall back to next available if no regional MD free, or blocks not needed
    if (!boosMD) boosMD = remainingMDsForBoos[0];
 
    if (boosMD) {
      const boosAnests = remainingAnests.slice(0, 2); // max 2 — only 2 rooms
      const boosColor  = CARE_TEAM_COLORS[ctIdx % CARE_TEAM_COLORS.length];
      const boosLabel  = `Care Team ${ctIdx + 1} — ${boosMD.name.split(',')[0]} 1:2 (BOOS)`;
 
      careTeams.push({
        id: ctIdx, md: boosMD.name, ratio: '1:2',
        rooms: boosRooms.slice(0, 2).map(r => r.room),
        anesthetists: boosAnests.map(a => a.name),
        color: boosColor,
        isBOOS: true,
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
            careTeamLabel: boosLabel,
            careTeamRatio: '1:2',
            isCareTeam:    true,
          };
        }
      });
 
      ctIdx++;
    }
  }
 
  // ── FLOAT anesthetists ────────────────────────────────────────
  const floatAnests = anesthetistPool
    .filter(a => !usedAnesthetists.has(a.name))
    .slice(0, floatCount);
 
  // ── SOLO ROOMS ────────────────────────────────────────────────
  // Covers: BOOS rooms that didn't get a care team, IR (always),
  // and any remaining Main OR rooms not in a care team.
  const soloRooms = rooms.filter(r =>
    !r.isCareTeam && !r.isCardiac && !r.isCathEP && !r.isPhantom
  );
 
  // soloUsed blocks ALL providers already placed anywhere (by buildAssignments or care teams)
  // so the solo fill pass never reassigns someone already in a room.
  const allAssignedNow = new Set([...soloUsed, ...usedMDs]);
 
  // Sort remaining MDs in priority order: Locums first, then Backup Call (#2), then Rank 3+
  // This ensures Watkins/Siddiqui/locums are used before Pipito, and Pipito before Raghove
  const remainingMDs = [
    ...workingMDs.filter(p => p.role === 'Locum'),
    ...workingMDs.filter(p => p.role === 'Back Up Call (#2)'),
    ...workingMDs.filter(p => p.rankNum >= 3 && p.rankNum < 50).sort((a, b) => a.rankNum - b.rankNum),
    ...workingMDs.filter(p => p.role === '7/8 Hr Shift'),
    ...workingMDs.filter(p => p.role === 'OR Call (#1)'),
  ].filter(p => !allAssignedNow.has(p.name));
 
  let mdPool = [...remainingMDs];
 
  // BOOS solo block rooms — regional-capable MD first
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
 
  // All other solo rooms (BOOS non-block, IR, leftover Main OR)
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
 
// ── Pick rooms for a care team (Main OR only) ─────────────────
// BOOS and IR never reach this function.
// Hard-stops on 'no' compatibility in both passes.
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
    if (dominantBuilding) {
      if (careTeamCompatible(dominantBuilding, room.building) === 'no') continue;
    }
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
 
