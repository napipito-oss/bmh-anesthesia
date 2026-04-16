// ─────────────────────────────────────────────────────────────
// CARE TEAM ENGINE — v5
//
// SEQUENCE:
// 1. buildAssignments (parsers.js) locks priority assignments:
//    cardiac, OR Call choice, blocks, endo/Brand, peds
// 2. buildCareTeams (here) takes remaining UNASSIGNED rooms,
//    forms care teams with available MDs + anesthetists,
//    then fills remaining solo rooms
//
// OR Call care team eligibility:
//   - Provider profile takes precedence (CARE_TEAM_AVOID = always solo)
//   - If care-team-comfortable, room type decides
// BOOS: max 1:2, opportunistic after Main OR/Endo
// IR: always solo
// ─────────────────────────────────────────────────────────────
import { classifyRoom } from './parsers.js';
import { PROVIDERS } from '../data/providers.js';
 
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
  'Pond, William', 'Dodwani', 'Fraley',
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
 
// Determine if a provider is care-team-comfortable based on profile
function isCTComfortable(mdName) {
  if (CARE_TEAM_AVOID.includes(mdName)) return false;
  if (CARE_TEAM_COMFORTABLE.includes(mdName)) return true;
  // Check providers.js profile if available
  const prof = PROVIDERS?.[mdName];
  if (prof?.careTeam === false) return false;
  if (prof?.careTeam === true)  return true;
  return true; // default: assume comfortable
}
 
// Peripheral block detection for BOOS
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
// MAIN CARE TEAM BUILDER
// ─────────────────────────────────────────────────────────────
export function buildCareTeams(rooms, qg, anesthetistHistory = {}, resourceStructure = {}) {
  if (!rooms?.length || !qg) return { rooms, careTeams: [], floats: [], available: [] };
 
  const activeAnesthetists = (qg.Anesthetists || []).filter(a => !a.isAdmin && !a.isOff);
  const anesthetistCount   = activeAnesthetists.length;
  const config             = getCareTeamConfig(anesthetistCount);
  const { ratios, floats: floatCount } = config;
 
  const workingMDs = qg.workingMDs || [];
 
  // Providers already consumed by priority assignments (cardiac, OR Call, blocks, endo, peds)
  const priorityUsed = new Set(
    rooms.filter(r => r.assignedProvider).map(r => r.assignedProvider)
  );
 
  // Available MDs for care team formation — not yet assigned anywhere
  // Order: Locums → Backup Call → Rank 3+ → 7/8 shift
  const availableForCT = [
    ...workingMDs.filter(p => p.role === 'Locum'),
    ...workingMDs.filter(p => p.role === 'Back Up Call (#2)'),
    ...workingMDs.filter(p => p.rankNum >= 3 && p.rankNum < 50).sort((a, b) => a.rankNum - b.rankNum),
    ...workingMDs.filter(p => p.role === '7/8 Hr Shift'),
  ].filter(p => !priorityUsed.has(p.name));
 
  // Unassigned rooms available for care team formation
  // Segregated by geography — BOOS and IR pulled out separately
  const unassigned = rooms.filter(r => !r.assignedProvider && !r.isPhantom);
  const endoUnassigned = unassigned.filter(r => r.isEndo);
  const boosUnassigned = unassigned.filter(r => r.isBOOS);
  const irUnassigned   = unassigned.filter(r => r.isIR);
  const mainUnassigned = unassigned.filter(r =>
    !r.isEndo && !r.isBOOS && !r.isIR && !r.isCardiac && !r.isCathEP
  );
 
  // Score main OR rooms
  const scoredMain = mainUnassigned.map(r => ({
    ...r,
    building: r.building || getRoomBuilding(r.room),
    ctScore: roomCareTeamSuitability(r) === 'good' ? 2 :
             roomCareTeamSuitability(r) === 'ok'   ? 1 : 0,
  })).sort((a, b) => b.ctScore - a.ctScore);
 
  const careTeams      = [];
  const usedMDs        = new Set([...priorityUsed]);
  const usedAnests     = new Set();
  let ctIdx            = 0;
  let remainingRatios  = [...ratios];
 
  let anestPool = [...activeAnesthetists];
  anestPool = sortAnesthetistsByVariety(anestPool, 'endo', anesthetistHistory);
 
  // ── CARE TEAM A: Brand → Endo ─────────────────────────────────
  const brandMD        = workingMDs.find(p => p.name === 'Brand, David L');
  const committedEndo  = Math.min(Math.ceil(parseFloat(resourceStructure.endo) || 0), 3);
 
  if (brandMD && !usedMDs.has(brandMD.name)) {
    const endoRooms    = endoUnassigned.length > 0
      ? endoUnassigned
      : rooms.filter(r => r.isEndo && !r.isPhantom); // Brand may already be assigned to endo by priority pass
    const cappedRatio  = Math.min(Math.max(endoRooms.length, committedEndo), 3);
    const endoAnests   = anestPool.splice(0, cappedRatio);
    const visibleRooms = endoRooms.slice(0, cappedRatio);
    const phantomCount = cappedRatio - visibleRooms.length;
 
    const phantomRooms = Array.from({ length: phantomCount }, (_, i) => ({
      room: 'Endo Add-Ons',
      area: 'BMH ENDO', building: 'ENDO_FLOOR',
      isEndo: true, isCareTeam: true, isPhantom: true,
      acuity: 'routine', cases: [], caseCount: 0, surgeons: [],
      flags: [{ level: 'info', msg: 'Reserved for inpatient add-on — no cases booked yet' }],
      assignedProvider: brandMD.name,
      anesthetist: endoAnests[visibleRooms.length + i]?.name || null,
      careTeamId: ctIdx, careTeamLabel: `Care Team ${ctIdx + 1} — Brand 1:${cappedRatio}`,
      careTeamRatio: `1:${cappedRatio}`, caseStatus: 'Not Started',
      cardiacNote: '', blockRequired: false, blockPossible: false,
      preferredProviders: [], avoidProviders: [], manuallyAdded: false,
    }));
 
    const color = CARE_TEAM_COLORS[ctIdx % CARE_TEAM_COLORS.length];
    const teamLabel = `Care Team ${ctIdx + 1} — Brand 1:${cappedRatio}`;
 
    careTeams.push({
      id: ctIdx, md: brandMD.name, ratio: `1:${cappedRatio}`,
      rooms: [...visibleRooms.map(r => r.room), ...phantomRooms.map(r => r.room)],
      anesthetists: endoAnests.map(a => a.name),
      color, hasReserve: phantomCount > 0,
    });
 
    usedMDs.add(brandMD.name);
    endoAnests.forEach(a => usedAnests.add(a.name));
    if (remainingRatios.length > 0) remainingRatios.shift();
 
    visibleRooms.forEach((room, i) => {
      const idx = rooms.findIndex(r => r.room === room.room);
      if (idx >= 0) rooms[idx] = {
        ...rooms[idx],
        assignedProvider: brandMD.name,
        anesthetist: endoAnests[i]?.name || null,
        careTeamId: ctIdx, careTeamLabel: teamLabel,
        careTeamRatio: `1:${cappedRatio}`, isCareTeam: true,
      };
    });
    phantomRooms.forEach(pr => rooms.push(pr));
    ctIdx++;
  }
 
  // ── CARE TEAMS B+: Main OR rooms ──────────────────────────────
  // Pick care-team-comfortable MDs from available pool
  const ctMDs = availableForCT
    .filter(p => !usedMDs.has(p.name) && isCTComfortable(p.name))
    .sort((a, b) => {
      const preferred = ['Wu, Jennifer','Kuraganti, Manjusha','Raghove, Vikas','Raghove, Punam'];
      return (preferred.includes(b.name) ? 2 : 1) - (preferred.includes(a.name) ? 2 : 1);
    });
 
  let roomPool = [...scoredMain.filter(r => roomCareTeamSuitability(r) !== 'avoid')];
 
  for (const ratio of remainingRatios) {
    if (ctMDs.length === 0 || roomPool.length === 0) break;
    const actualRatio = Math.min(ratio, roomPool.length);
    if (actualRatio === 0) break;
 
    const md = ctMDs.shift();
    if (!md || usedMDs.has(md.name)) continue;
 
    const ctRooms = pickRooms(roomPool, actualRatio);
    if (ctRooms.length === 0) break;
 
    ctRooms.forEach(r => { roomPool = roomPool.filter(x => x.room !== r.room); });
 
    const sortedAnests = sortAnesthetistsByVariety(
      anestPool.filter(a => !usedAnests.has(a.name)),
      'main', anesthetistHistory
    );
    const ctAnests = sortedAnests.splice(0, actualRatio);
    ctAnests.forEach(a => usedAnests.add(a.name));
    anestPool = anestPool.filter(a => !usedAnests.has(a.name));
 
    const color     = CARE_TEAM_COLORS[ctIdx % CARE_TEAM_COLORS.length];
    const teamLabel = `Care Team ${ctIdx + 1} — ${md.name.split(',')[0]} 1:${actualRatio}`;
 
    careTeams.push({
      id: ctIdx, md: md.name, ratio: `1:${actualRatio}`,
      rooms: ctRooms.map(r => r.room),
      anesthetists: ctAnests.map(a => a.name),
      color,
    });
    usedMDs.add(md.name);
 
    ctRooms.forEach((room, i) => {
      const idx = rooms.findIndex(r => r.room === room.room);
      if (idx >= 0) rooms[idx] = {
        ...rooms[idx],
        assignedProvider: md.name,
        anesthetist: ctAnests[i]?.name || null,
        careTeamId: ctIdx, careTeamLabel: teamLabel,
        careTeamRatio: `1:${actualRatio}`, isCareTeam: true,
      };
    });
 
    ctIdx++;
  }
 
  // ── BOOS: opportunistic 1:2 care team ────────────────────────
  // Only if 2 rooms running AND anesthetists remain after Main OR/Endo
  const remainingAnests = anestPool.filter(a => !usedAnests.has(a.name));
  const bооsCTPossible  = boosUnassigned.length >= 2 && remainingAnests.length >= 2;
 
  if (bооsCTPossible) {
    const boosNeedsBlock = boosUnassigned.some(r => boosNeedsPeripheralBlock(r));
    const remainingForBoos = availableForCT.filter(p => !usedMDs.has(p.name));
    let boosMD = boosNeedsBlock
      ? remainingForBoos.find(p => REGIONAL_CAPABLE.includes(p.name)) || remainingForBoos[0]
      : remainingForBoos[0];
 
    if (boosMD) {
      const boosAnests = remainingAnests.slice(0, 2);
      const color      = CARE_TEAM_COLORS[ctIdx % CARE_TEAM_COLORS.length];
      const teamLabel  = `Care Team ${ctIdx + 1} — ${boosMD.name.split(',')[0]} 1:2 (BOOS)`;
 
      careTeams.push({
        id: ctIdx, md: boosMD.name, ratio: '1:2',
        rooms: boosUnassigned.slice(0, 2).map(r => r.room),
        anesthetists: boosAnests.map(a => a.name),
        color, isBOOS: true,
      });
 
      usedMDs.add(boosMD.name);
      boosAnests.forEach(a => usedAnests.add(a.name));
      anestPool = anestPool.filter(a => !usedAnests.has(a.name));
 
      boosUnassigned.slice(0, 2).forEach((room, i) => {
        const idx = rooms.findIndex(r => r.room === room.room);
        if (idx >= 0) rooms[idx] = {
          ...rooms[idx],
          assignedProvider: boosMD.name,
          anesthetist: boosAnests[i]?.name || null,
          careTeamId: ctIdx, careTeamLabel: teamLabel,
          careTeamRatio: '1:2', isCareTeam: true,
        };
      });
      ctIdx++;
    }
  }
 
  // ── FLOAT anesthetists ────────────────────────────────────────
  const floatAnests = anestPool
    .filter(a => !usedAnests.has(a.name))
    .slice(0, floatCount);
 
  // ── SOLO FILL: remaining unassigned rooms ─────────────────────
  // Priority: BOOS block rooms get regional-capable MD first,
  // then all remaining rooms get next available MD in priority order.
  const soloRooms = rooms.filter(r =>
    !r.assignedProvider && !r.isCareTeam && !r.isPhantom &&
    !r.isCardiac && !r.isCathEP
  );
 
  const soloMDPool = [
    ...workingMDs.filter(p => p.role === 'Locum'),
    ...workingMDs.filter(p => p.role === 'Back Up Call (#2)'),
    ...workingMDs.filter(p => p.rankNum >= 3 && p.rankNum < 50).sort((a, b) => a.rankNum - b.rankNum),
    ...workingMDs.filter(p => p.role === '7/8 Hr Shift'),
    // OR Call and cardiac MDs as last resort
    ...workingMDs.filter(p => p.role === 'OR Call (#1)'),
    ...workingMDs.filter(p => p.role === 'Cardiac Call (CV)'),
    ...workingMDs.filter(p => p.role === 'Backup CV'),
  ].filter(p => !usedMDs.has(p.name));
 
  let mdPool = [...soloMDPool];
 
  // BOOS block rooms — regional MD first
  for (const room of soloRooms.filter(r => r.isBOOS && boosNeedsPeripheralBlock(r))) {
    if (room.assignedProvider) continue;
    const md = mdPool.find(p => REGIONAL_CAPABLE.includes(p.name)) || mdPool[0];
    if (md) {
      const idx = rooms.findIndex(r => r.room === room.room);
      if (idx >= 0) rooms[idx] = { ...rooms[idx], assignedProvider: md.name, isCareTeam: false };
      mdPool = mdPool.filter(p => p.name !== md.name);
      usedMDs.add(md.name);
    }
  }
 
  // All remaining solo rooms
  for (const room of soloRooms) {
    if (room.assignedProvider) continue;
    const md = mdPool.find(p => !room.avoidProviders?.includes(p.name)) || mdPool[0];
    if (md) {
      const idx = rooms.findIndex(r => r.room === room.room);
      if (idx >= 0) rooms[idx] = { ...rooms[idx], assignedProvider: md.name, isCareTeam: false, careTeamLabel: null };
      mdPool = mdPool.filter(p => p.name !== md.name);
      usedMDs.add(md.name);
    }
  }
 
  return {
    rooms, careTeams,
    floats: floatAnests,
    available: [], // computed in App.jsx from room state
    config, anesthetistCount,
  };
}
 
// Pick rooms for a care team — geographic compatibility enforced
function pickRooms(roomPool, count) {
  if (roomPool.length <= count) return roomPool.slice(0, count);
 
  const sorted = [...roomPool].sort((a, b) =>
    (a.startTime || '9999').localeCompare(b.startTime || '9999')
  );
 
  const picked = [];
  let dominantBuilding = null;
 
  for (const room of sorted) {
    if (picked.length >= count) break;
    const b = room.building || getRoomBuilding(room.room);
    if (dominantBuilding && careTeamCompatible(dominantBuilding, b) === 'no') continue;
    picked.push(room);
    if (!dominantBuilding) dominantBuilding = b;
  }
 
  // Fill if needed
  for (const room of sorted) {
    if (picked.length >= count) break;
    if (picked.find(p => p.room === room.room)) continue;
    const b     = room.building || getRoomBuilding(room.room);
    const compat = dominantBuilding ? careTeamCompatible(dominantBuilding, b) : 'yes';
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
 
