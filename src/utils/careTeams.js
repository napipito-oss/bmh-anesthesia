// ─────────────────────────────────────────────────────────────
// CARE TEAM ENGINE — v3.2
// Based on v3.1 (last confirmed working state)
// Changes from v3.1:
//   - unassignedRooms excludes isORCallChoice rooms (Eskew fix)
//   - globalUsed includes OR Call choice provider
//   - remainingMDs in solo pass sorted by priority order
//     (Locums → Back Up Call → Rank 3+) so Watkins/Siddiqui
//     are assigned before Pipito, Pipito before Raghove
//   - Watkins added to CARE_TEAM_COMFORTABLE
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
 
  // unassignedRooms excludes cardiac/cath AND OR Call choice rooms
  const unassignedRooms = rooms.filter(r =>
    !preAssigned.find(p => p.room === r.room) && !r.isORCallChoice
  );
 
  // ctUsed: cardiac/cath + OR Call choice providers locked out of care team MD pool
  const globalUsed = new Set();
  preAssigned.forEach(r => { if (r.assignedProvider) globalUsed.add(r.assignedProvider); });
  rooms.filter(r => r.isORCallChoice).forEach(r => { if (r.assignedProvider) globalUsed.add(r.assignedProvider); });
 
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
  // OR.endo.CCL is the source of truth for how many endo rooms we cover.
  // The cube only tells us which rooms have cases — it never determines room count.
  // committedEndo = number from OR.endo.CCL. We staff exactly that many rooms.
  // No phantom rooms generated — the OR.endo.CCL number already accounts for
  // add-on capacity. If cube shows fewer rooms, those got consolidated; not our concern.
  if (brandMD && !usedMDs.has(brandMD.name) && endoRooms.length > 0) {
    const committedEndo  = Math.min(Math.ceil(parseFloat(resourceStructure.endo) || 0), 3);
    // Staff the visible cube rooms, up to committedEndo. Never generate extra rooms.
    const endoRoomCount  = Math.min(endoRooms.length, Math.max(endoRooms.length, committedEndo));
    const roomsToAssign  = endoRooms.slice(0, endoRoomCount);
    const endoAnests     = anesthetistPool.splice(0, endoRoomCount);
 
    const endoAssignment = roomsToAssign.map((room, i) => ({
      ...room,
      assignedProvider: brandMD.name,
      anesthetist:   endoAnests[i]?.name || null,
      careTeamId:    0,
      careTeamLabel: `Care Team 1 — Brand 1:${endoRoomCount}`,
      careTeamRatio: `1:${endoRoomCount}`,
      isCareTeam:    true,
    }));
 
    careTeams.push({
      id: 0, md: brandMD.name, ratio: `1:${endoRoomCount}`,
      rooms: endoAssignment.map(r => r.room),
      anesthetists: endoAnests.map(a => a.name),
      color: CARE_TEAM_COLORS[0],
      hasReserve: false,
    });
 
    usedMDs.add(brandMD.name);
    endoAnests.forEach(a => usedAnesthetists.add(a.name));
    if (remainingRatios.length > 0) remainingRatios.shift();
 
    roomsToAssign.forEach((room, i) => {
      const idx = rooms.findIndex(r => r.room === room.room);
      if (idx >= 0) rooms[idx] = endoAssignment[i];
    });
  }
 
  // ── Care Teams B+: Main OR ────────────────────────────────────
  // ctMDs preserves availableMDs priority order — no re-sorting
  // CARE_TEAM_COMFORTABLE still controls whether anesthetists are assigned
  const ctMDs = availableMDs.filter(p => !usedMDs.has(p.name) && CARE_TEAM_COMFORTABLE.includes(p.name));
 
  let ctIdx    = 1;
  let roomPool = [...scoredMain.filter(r => roomCareTeamSuitability(r) !== 'avoid')];
 
  for (const ratio of remainingRatios) {
    if (ctMDs.length === 0 || roomPool.length === 0) break;
    const actualRatio = Math.min(ratio, roomPool.length);
    if (actualRatio === 0) break;
 
    const md = ctMDs.shift();
    if (!md || usedMDs.has(md.name)) continue;
 
    const ctRooms = pickStaggeredRooms(roomPool, actualRatio);
    if (ctRooms.length === 0) break;
 
    ctRooms.forEach(r => { roomPool = roomPool.filter(x => x.room !== r.room); });
 
    const sortedAnests = sortAnesthetistsByVariety(
      anesthetistPool.filter(a => !usedAnesthetists.has(a.name)),
      'main', anesthetistHistory
    );
    const ctAnests = sortedAnests.splice(0, actualRatio);
    ctAnests.forEach(a => usedAnesthetists.add(a.name));
    anesthetistPool = anesthetistPool.filter(a => !usedAnesthetists.has(a.name));
 
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
      if (idx >= 0) {
        rooms[idx] = {
          ...rooms[idx],
          assignedProvider: md.name,
          anesthetist:   ctAnests[i]?.name || null,
          careTeamId:    ctIdx,
          careTeamLabel: teamLabel,
          careTeamRatio: `1:${actualRatio}`,
          isCareTeam:    true,
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
 
  // ── Solo fill ─────────────────────────────────────────────────
  const soloRooms = rooms.filter(r =>
    !r.isCareTeam && !r.isCardiac && !r.isCathEP && !r.isPhantom
  );
 
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
 
