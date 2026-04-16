// ─────────────────────────────────────────────────────────────
// CARE TEAM ENGINE — v2 (Chunk 2)
// Changes:
//   - getRoomBuilding() now delegates to classifyRoom() from parsers
//     (single source of truth for room geography)
//   - pickStaggeredRooms() uses pre-attached room.building field
//     instead of re-computing it
//   - careTeamCompatible() and all logic unchanged
// ─────────────────────────────────────────────────────────────
import { classifyRoom } from './parsers.js';

// Get building for a room string — delegates to classifyRoom for consistency
export function getRoomBuilding(room) {
  return classifyRoom(room).building;
}

// Check if two buildings can share a care team
// Returns: 'yes' | 'ok' | 'no'
export function careTeamCompatible(buildingA, buildingB) {
  if (buildingA === buildingB) return 'yes';
  const combo = [buildingA, buildingB].sort().join('+');
  if (combo.includes('BOOS'))                              return 'no';  // BOOS + anything = never
  if (combo.includes('IR'))                               return 'ok';  // IR + anything = not preferred
  if (combo === 'ENDO_FLOOR+MAIN_OR_FLOOR')               return 'yes'; // OK
  if (combo === 'CATH_FLOOR+MAIN_OR_FLOOR')               return 'ok';  // not preferred but ok
  if (combo === 'CATH_FLOOR+ENDO_FLOOR')                  return 'ok';  // not preferred
  return 'ok';
}

export const CARE_TEAM_COMFORTABLE = [
  'Wu, Jennifer',
  'Kuraganti, Manjusha',
  'Singh, Karampal',
  'Raghove, Vikas',
  'Raghove, Punam',
  'Pipito, Nicholas A',
  'Brand, David L',
  'Gathings, Vincent',
  'Siddiqui',
  'Nielson, Mark',
  'Lambert',
  'Powell, Jason',
  'Pond, William',
  'Dodwani',
  'Fraley',
];

export const CARE_TEAM_AVOID = [
  'Eskew, Gregory S',
  'Shepherd',
];

export const CARE_TEAM_RELUCTANT = [
  'DeWitt, Bracken J',
];

export const CARE_TEAM_TABLE = {
  0:  { careTeamRooms: 0, mdsNeeded: 0, ratios: [],          floats: 0 },
  1:  { careTeamRooms: 1, mdsNeeded: 1, ratios: [1],         floats: 0 },
  2:  { careTeamRooms: 2, mdsNeeded: 1, ratios: [2],         floats: 0 },
  3:  { careTeamRooms: 3, mdsNeeded: 1, ratios: [3],         floats: 0 },
  4:  { careTeamRooms: 3, mdsNeeded: 1, ratios: [3],         floats: 1 },
  5:  { careTeamRooms: 5, mdsNeeded: 2, ratios: [2, 3],      floats: 0 },
  6:  { careTeamRooms: 6, mdsNeeded: 2, ratios: [3, 3],      floats: 0 },
  7:  { careTeamRooms: 6, mdsNeeded: 2, ratios: [3, 3],      floats: 1 },
  8:  { careTeamRooms: 8, mdsNeeded: 3, ratios: [3, 3, 2],   floats: 0 },
  9:  { careTeamRooms: 9, mdsNeeded: 3, ratios: [3, 3, 3],   floats: 0 },
  10: { careTeamRooms: 9, mdsNeeded: 3, ratios: [3, 3, 3],   floats: 1 },
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
  if (room.isIR)                             return 'avoid'; // IR — no care teams
  if (room.isCardiac || room.acuity === 'cardiac') return 'avoid';
  if (room.isThoracic)                       return 'avoid';
  if (room.acuity === 'high')                return 'ok';
  if (room.isEndo)                           return 'good';
  if (room.isFastTurnover)                   return 'good';
  if (room.isBOOS)                           return 'good';
  if (room.isRobotic)                        return 'ok';
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

// ─────────────────────────────────────────────────────────────
// MAIN CARE TEAM BUILDER
// ─────────────────────────────────────────────────────────────
export function buildCareTeams(rooms, qg, anesthetistHistory = {}) {
  if (!rooms?.length || !qg) return { rooms, careTeams: [], floats: [], available: [] };

  const activeAnesthetists = (qg.Anesthetists || []).filter(a => !a.isAdmin && !a.isOff);
  const anesthetistCount   = activeAnesthetists.length;
  const config             = getCareTeamConfig(anesthetistCount);
  const { careTeamRooms: maxCTRooms, mdsNeeded, ratios, floats: floatCount } = config;

  const preAssigned    = rooms.filter(r => r.assignedProvider && (r.isCardiac || r.isCathEP));
  const unassignedRooms = rooms.filter(r => !preAssigned.find(p => p.room === r.room));

  const globalUsed = new Set();
  preAssigned.forEach(r => { if (r.assignedProvider) globalUsed.add(r.assignedProvider); });

  const endoRooms = unassignedRooms.filter(r => r.isEndo);
  const mainRooms = unassignedRooms.filter(r => !r.isEndo && !r.isCardiac && !r.isCathEP);

  // Score rooms — building field now pre-attached from Chunk 2
  const scoredMain = mainRooms.map(r => ({
    ...r,
    // Use pre-attached building if available, fall back to compute
    building: r.building || getRoomBuilding(r.room),
    ctScore:  roomCareTeamSuitability(r) === 'good' ? 2 :
              roomCareTeamSuitability(r) === 'ok'   ? 1 : 0,
  })).sort((a, b) => b.ctScore - a.ctScore);

  let remainingCTSlots = maxCTRooms;
  let remainingRatios  = [...ratios];

  const workingMDs     = qg.workingMDs || [];
  const availableMDs   = [
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

  const brandMD    = workingMDs.find(p => p.name === 'Brand, David L');
  const careTeams  = [];
  const usedMDs    = new Set([...globalUsed]);
  const usedAnesthetists = new Set([...globalUsed]);

  let anesthetistPool = activeAnesthetists.filter(a => !globalUsed.has(a.name));
  anesthetistPool = sortAnesthetistsByVariety(anesthetistPool, 'endo', anesthetistHistory);

  // ── Care Team A: Brand → Endo ─────────────────────────────
  if (brandMD && endoRooms.length > 0) {
    const endoRatio  = endoRooms.length >= 3 ? 3 : endoRooms.length;
    const endoAnests = anesthetistPool.splice(0, endoRatio);
    const endoAssignment = endoRooms.slice(0, endoRatio).map((room, i) => ({
      ...room,
      assignedProvider: brandMD.name,
      anesthetist:      endoAnests[i]?.name || null,
      careTeamId:       0,
      careTeamLabel:    `Care Team 1 — Brand 1:${endoRatio}`,
      careTeamRatio:    `1:${endoRatio}`,
      isCareTeam:       true,
    }));
    careTeams.push({
      id:          0,
      md:          brandMD.name,
      ratio:       `1:${endoRatio}`,
      rooms:       endoAssignment.map(r => r.room),
      anesthetists: endoAnests.map(a => a.name),
      color:       CARE_TEAM_COLORS[0],
    });
    usedMDs.add(brandMD.name);
    endoAnests.forEach(a => usedAnesthetists.add(a.name));
    remainingCTSlots -= endoRatio;
    if (remainingRatios.length > 0) remainingRatios.shift();
    endoAssignment.forEach(ea => {
      const idx = rooms.findIndex(r => r.room === ea.room);
      if (idx >= 0) rooms[idx] = ea;
    });
  }

  // ── Care Teams B+: Main OR rooms ──────────────────────────
  const ctMDs = availableMDs
    .filter(p => !usedMDs.has(p.name) && CARE_TEAM_COMFORTABLE.includes(p.name))
    .sort((a, b) => {
      const preferred = ['Wu, Jennifer','Kuraganti, Manjusha','Raghove, Vikas','Raghove, Punam'];
      return (preferred.includes(b.name) ? 2 : 1) - (preferred.includes(a.name) ? 2 : 1);
    });

  let ctIdx    = 1;
  let roomPool = [...scoredMain.filter(r => roomCareTeamSuitability(r) !== 'avoid')];

  for (const ratio of remainingRatios) {
    if (ctMDs.length === 0 || roomPool.length < ratio) break;
    const md = ctMDs.shift();
    if (!md || usedMDs.has(md.name)) continue;

    const ctRooms = pickStaggeredRooms(roomPool, ratio);
    if (ctRooms.length === 0) break;

    ctRooms.forEach(r => { roomPool = roomPool.filter(x => x.room !== r.room); });

    const ctArea      = ctRooms[0]?.isEndo ? 'endo' : ctRooms[0]?.isBOOS ? 'boos' : 'main';
    const sortedAnests = sortAnesthetistsByVariety(
      anesthetistPool.filter(a => !usedAnesthetists.has(a.name)),
      ctArea,
      anesthetistHistory
    );
    const ctAnests = sortedAnests.splice(0, ratio);
    ctAnests.forEach(a => usedAnesthetists.add(a.name));
    anesthetistPool = anesthetistPool.filter(a => !usedAnesthetists.has(a.name));

    const color     = CARE_TEAM_COLORS[ctIdx % CARE_TEAM_COLORS.length];
    const teamLabel = `Care Team ${ctIdx + 1} — ${md.name.split(',')[0]} 1:${ratio}`;

    careTeams.push({
      id:          ctIdx,
      md:          md.name,
      ratio:       `1:${ratio}`,
      rooms:       ctRooms.map(r => r.room),
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
          anesthetist:      ctAnests[i]?.name || null,
          careTeamId:       ctIdx,
          careTeamLabel:    teamLabel,
          careTeamRatio:    `1:${ratio}`,
          isCareTeam:       true,
        };
      }
    });

    ctIdx++;
    remainingCTSlots -= ratio;
  }

  // ── Float anesthetists ────────────────────────────────────
  const floatAnests = anesthetistPool
    .filter(a => !usedAnesthetists.has(a.name))
    .slice(0, floatCount);

  // ── Solo rooms → remaining MDs ────────────────────────────
  const soloRooms    = rooms.filter(r => !r.isCareTeam && !r.isCardiac && !r.isCathEP);
  const remainingMDs = workingMDs.filter(p =>
    !usedMDs.has(p.name) &&
    !preAssigned.find(r => r.assignedProvider === p.name)
  );

  let mdPool = [...remainingMDs];
  for (const room of soloRooms) {
    if (room.assignedProvider) continue;
    const md = mdPool.shift();
    if (md) {
      const idx = rooms.findIndex(r => r.room === room.room);
      if (idx >= 0) {
        rooms[idx] = { ...rooms[idx], assignedProvider: md.name, anesthetist: null, isCareTeam: false, careTeamLabel: null };
      }
    }
  }

  const availableMDsList = mdPool
    .filter(p => !globalUsed.has(p.name) && !usedMDs.has(p.name))
    .map((p, i) => ({
      ...p,
      availabilityRank: i + 1,
      label: i === 0 ? '1st Available' : i === 1 ? '2nd Available' : `${i + 1}th Available`,
    }));

  return { rooms, careTeams, floats: floatAnests, available: availableMDsList, config, anesthetistCount };
}

// ── Pick rooms for a care team — uses pre-attached building ──
function pickStaggeredRooms(roomPool, count) {
  if (roomPool.length <= count) return roomPool.slice(0, count);

  const withTimes = roomPool.map(r => ({
    ...r,
    // Use pre-attached building field (Chunk 2) — no recompute needed
    building:  r.building || getRoomBuilding(r.room),
    sortTime:  r.startTime || '9999',
  })).sort((a, b) => a.sortTime.localeCompare(b.sortTime));

  const picked   = [];
  const usedTimes = new Set();
  let dominantBuilding = null;

  for (const room of withTimes) {
    if (picked.length >= count) break;
    if (dominantBuilding) {
      const compat = careTeamCompatible(dominantBuilding, room.building);
      if (compat === 'no') continue;
    }
    const timeKey = room.sortTime?.split(' ')[1] || 'unknown';
    if (!usedTimes.has(timeKey) || picked.length < count) {
      picked.push(room);
      usedTimes.add(timeKey);
      if (!dominantBuilding) dominantBuilding = room.building;
    }
  }

  // Fill remaining slots if needed — compatible buildings only
  for (const room of withTimes) {
    if (picked.length >= count) break;
    if (!picked.find(p => p.room === room.room)) {
      const compat = dominantBuilding ? careTeamCompatible(dominantBuilding, room.building) : 'yes';
      if (compat !== 'no') picked.push(room);
    }
  }

  return picked.slice(0, count);
}

// ── Sort anesthetists by variety ─────────────────────────────
function sortAnesthetistsByVariety(anesthetists, area, history) {
  if (!history || Object.keys(history).length === 0) return anesthetists;
  return [...anesthetists].sort((a, b) => {
    const aCount = (history[a.name] || {})[area] || 0;
    const bCount = (history[b.name] || {})[area] || 0;
    return aCount - bCount;
  });
}
