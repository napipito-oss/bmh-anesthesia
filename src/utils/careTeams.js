// ─────────────────────────────────────────────────────────────
// CARE TEAM ENGINE
// Implements BMH scheduling logic from Coordination Logic doc
// ─────────────────────────────────────────────────────────────

// MDs who are comfortable with / prefer care teams
export const CARE_TEAM_COMFORTABLE = [
  'Wu, Jennifer',
  'Kuraganti, Manjusha',
  'Singh, Karampal',
  'Raghove, Vikas',
  'Raghove, Punam',
  'Pipito, Nicholas A',
  'Brand, David L',
  // Locums generally OK with care teams
  'Gathings, Vincent',
  'Siddiqui',
  'Nielson, Mark',
  'Lambert',
  'Powell, Jason',
  'Pond, William',
  'Dodwani',
  'Fraley',
];

// MDs who avoid care teams
export const CARE_TEAM_AVOID = [
  'Eskew, Gregory S',
  'Shepherd',
];

// MDs who will do care teams if asked but prefer solo
export const CARE_TEAM_RELUCTANT = [
  'DeWitt, Bracken J',
];

// Ideal care team ratios from scheduling doc
// Key = number of available anesthetists
// Value = { careTeamRooms, mdsNeeded, ratios }
export const CARE_TEAM_TABLE = {
  0: { careTeamRooms: 0, mdsNeeded: 0, ratios: [], floats: 0 },
  1: { careTeamRooms: 1, mdsNeeded: 1, ratios: [1], floats: 0 },
  2: { careTeamRooms: 2, mdsNeeded: 1, ratios: [2], floats: 0 },
  3: { careTeamRooms: 3, mdsNeeded: 1, ratios: [3], floats: 0 },
  4: { careTeamRooms: 3, mdsNeeded: 1, ratios: [3], floats: 1 },
  5: { careTeamRooms: 5, mdsNeeded: 2, ratios: [2, 3], floats: 0 },
  6: { careTeamRooms: 6, mdsNeeded: 2, ratios: [3, 3], floats: 0 },
  7: { careTeamRooms: 6, mdsNeeded: 2, ratios: [3, 3], floats: 1 },
  8: { careTeamRooms: 8, mdsNeeded: 3, ratios: [3, 3, 2], floats: 0 },
  9: { careTeamRooms: 9, mdsNeeded: 3, ratios: [3, 3, 3], floats: 0 },
  10: { careTeamRooms: 9, mdsNeeded: 3, ratios: [3, 3, 3], floats: 1 },
};

// Get care team config — for counts > 10, extrapolate
export function getCareTeamConfig(anesthetistCount) {
  if (anesthetistCount <= 0) return CARE_TEAM_TABLE[0];
  if (CARE_TEAM_TABLE[anesthetistCount]) return CARE_TEAM_TABLE[anesthetistCount];
  // Extrapolate: 1:3 base ratio, floor(n/3) MDs, remainder becomes float or 1:2
  const mdsNeeded = Math.floor(anesthetistCount / 3);
  const remainder = anesthetistCount % 3;
  const ratios = Array(mdsNeeded).fill(3);
  if (remainder > 0) ratios.push(remainder);
  const floats = 0;
  return {
    careTeamRooms: anesthetistCount - floats,
    mdsNeeded: ratios.length,
    ratios,
    floats,
  };
}

// Determine if a room is appropriate for a care team
// Returns: 'good' | 'ok' | 'avoid'
export function roomCareTeamSuitability(room) {
  if (!room) return 'ok';

  // Hard avoids
  if (room.isBOOS === false && (room.room || '').toLowerCase().includes('ir')) return 'avoid'; // IR
  if (room.isCardiac || room.acuity === 'cardiac') return 'avoid'; // Cardiac solo only
  if (room.isThoracic) return 'avoid'; // Thoracic needs 1:2 or solo

  // High acuity complex cases — 1:2 max, not 1:3
  if (room.acuity === 'high') return 'ok'; // Can do 1:2 but not 1:3

  // Endo — great for care teams
  if (room.isEndo) return 'good';

  // Fast turnover rooms with predictable staggered starts — good for care teams
  if (room.isFastTurnover) return 'good';

  // BOOS — good for care teams
  if (room.isBOOS) return 'good';

  // Robotic — prefer solo (Eskew), but can be care team
  if (room.isRobotic) return 'ok';

  return 'ok';
}

// COLORS for care team visual grouping
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
// Takes rooms and qgenda data, returns enriched assignments
// with care teams, anesthetist assignments, and floats
// ─────────────────────────────────────────────────────────────
export function buildCareTeams(rooms, qg, anesthetistHistory = {}) {
  if (!rooms?.length || !qg) return { rooms, careTeams: [], floats: [], available: [] };

  // Get active anesthetists (not admin, not off)
  const activeAnesthetists = (qg.Anesthetists || []).filter(a => !a.isAdmin && !a.isOff);
  const anesthetistCount = activeAnesthetists.length;

  const config = getCareTeamConfig(anesthetistCount);
  const { careTeamRooms: maxCTRooms, mdsNeeded, ratios, floats: floatCount } = config;

  // ── STEP 1: Pre-assign rooms that CANNOT be care teams ──────
  // These are already handled by cardiac decision tree + block assignments
  const preAssigned = rooms.filter(r => r.assignedProvider && (r.isCardiac || r.isCathEP));
  const unassignedRooms = rooms.filter(r => !preAssigned.find(p => p.room === r.room));

  // ── STEP 2: Separate Endo rooms ─────────────────────────────
  const endoRooms = unassignedRooms.filter(r => r.isEndo);
  const mainRooms = unassignedRooms.filter(r => !r.isEndo && !r.isCardiac && !r.isCathEP);

  // ── STEP 3: Score rooms for care team suitability ───────────
  const scoredMain = mainRooms.map(r => ({
    ...r,
    ctScore: roomCareTeamSuitability(r) === 'good' ? 2 : roomCareTeamSuitability(r) === 'ok' ? 1 : 0,
  })).sort((a, b) => b.ctScore - a.ctScore);

  // ── STEP 4: Determine how many rooms get care teams ─────────
  // Brand always gets Endo first
  let remainingCTSlots = maxCTRooms;
  let remainingRatios = [...ratios];

  // ── STEP 5: Get available MDs for care teams ─────────────────
  const workingMDs = qg.workingMDs || [];
  const availableMDs = workingMDs.filter(p =>
    !preAssigned.find(r => r.assignedProvider === p.name) &&
    p.role !== '7/8 Hr Shift' // Brand handled separately
  );

  // Brand first — always Endo care team
  const brandMD = workingMDs.find(p => p.name === 'Brand, David L');
  const careTeams = [];
  const usedMDs = new Set();
  const usedAnesthetists = new Set();
  let anesthetistPool = [...activeAnesthetists];

  // Sort anesthetists: prefer variety based on history
  anesthetistPool = sortAnesthetistsByVariety(anesthetistPool, 'endo', anesthetistHistory);

  // ── CARE TEAM A: Brand → Endo ────────────────────────────────
  if (brandMD && endoRooms.length > 0) {
    const endoRatio = endoRooms.length >= 3 ? 3 : endoRooms.length;
    const endoAnests = anesthetistPool.splice(0, endoRatio);
    const endoAssignment = endoRooms.slice(0, endoRatio).map((room, i) => ({
      ...room,
      assignedProvider: brandMD.name,
      anesthetist: endoAnests[i]?.name || null,
      careTeamId: 0,
      careTeamLabel: `Care Team 1 — Brand 1:${endoRatio}`,
      careTeamRatio: `1:${endoRatio}`,
      isCareTeam: true,
    }));
    careTeams.push({
      id: 0,
      md: brandMD.name,
      ratio: `1:${endoRatio}`,
      rooms: endoAssignment.map(r => r.room),
      anesthetists: endoAnests.map(a => a.name),
      color: CARE_TEAM_COLORS[0],
    });
    usedMDs.add(brandMD.name);
    endoAnests.forEach(a => usedAnesthetists.add(a.name));
    remainingCTSlots -= endoRatio;
    if (remainingRatios.length > 0) remainingRatios.shift();

    // Update rooms
    endoAssignment.forEach(ea => {
      const idx = rooms.findIndex(r => r.room === ea.room);
      if (idx >= 0) rooms[idx] = ea;
    });
  }

  // ── CARE TEAMS B+: Main OR rooms ─────────────────────────────
  // Pick care-team-comfortable MDs
  const ctMDs = availableMDs
    .filter(p => !usedMDs.has(p.name) && CARE_TEAM_COMFORTABLE.includes(p.name))
    .sort((a, b) => {
      // Prefer employed MDs that like care teams over locums
      const aScore = ['Wu, Jennifer','Kuraganti, Manjusha','Raghove, Vikas','Raghove, Punam'].includes(a.name) ? 2 : 1;
      const bScore = ['Wu, Jennifer','Kuraganti, Manjusha','Raghove, Vikas','Raghove, Punam'].includes(b.name) ? 2 : 1;
      return bScore - aScore;
    });

  let ctIdx = 1; // care team index (0 = Brand/Endo)
  let roomPool = [...scoredMain.filter(r => roomCareTeamSuitability(r) !== 'avoid')];

  for (const ratio of remainingRatios) {
    if (ctMDs.length === 0 || roomPool.length < ratio) break;

    const md = ctMDs.shift();
    if (!md || usedMDs.has(md.name)) continue;

    // Pick rooms for this care team — prefer staggered starts
    const ctRooms = pickStaggeredRooms(roomPool, ratio);
    if (ctRooms.length === 0) break;

    // Remove picked rooms from pool
    ctRooms.forEach(r => { roomPool = roomPool.filter(x => x.room !== r.room); });

    // Assign anesthetists
    const ctArea = ctRooms[0]?.isEndo ? 'endo' : ctRooms[0]?.isBOOS ? 'boos' : 'main';
    const sortedAnests = sortAnesthetistsByVariety(
      anesthetistPool.filter(a => !usedAnesthetists.has(a.name)),
      ctArea,
      anesthetistHistory
    );
    const ctAnests = sortedAnests.splice(0, ratio);
    ctAnests.forEach(a => usedAnesthetists.add(a.name));
    // Remove used from pool
    anesthetistPool = anesthetistPool.filter(a => !usedAnesthetists.has(a.name));

    const color = CARE_TEAM_COLORS[ctIdx % CARE_TEAM_COLORS.length];
    const teamLabel = `Care Team ${ctIdx + 1} — ${md.name.split(',')[0]} 1:${ratio}`;

    careTeams.push({
      id: ctIdx,
      md: md.name,
      ratio: `1:${ratio}`,
      rooms: ctRooms.map(r => r.room),
      anesthetists: ctAnests.map(a => a.name),
      color,
    });

    usedMDs.add(md.name);

    // Update rooms
    ctRooms.forEach((room, i) => {
      const idx = rooms.findIndex(r => r.room === room.room);
      if (idx >= 0) {
        rooms[idx] = {
          ...rooms[idx],
          assignedProvider: md.name,
          anesthetist: ctAnests[i]?.name || null,
          careTeamId: ctIdx,
          careTeamLabel: teamLabel,
          careTeamRatio: `1:${ratio}`,
          isCareTeam: true,
        };
      }
    });

    ctIdx++;
    remainingCTSlots -= ratio;
  }

  // ── FLOAT ANESTHETISTS ────────────────────────────────────────
  const floatAnests = anesthetistPool
    .filter(a => !usedAnesthetists.has(a.name))
    .slice(0, floatCount);

  // ── REMAINING ROOMS → Solo MDs ───────────────────────────────
  // These rooms get solo MD, no anesthetist
  const soloRooms = rooms.filter(r => !r.isCareTeam && !r.isCardiac && !r.isCathEP);
  const remainingMDs = workingMDs.filter(p =>
    !usedMDs.has(p.name) &&
    !preAssigned.find(r => r.assignedProvider === p.name)
  );

  // Assign remaining MDs to solo rooms in order
  const soloAssigned = [];
  let mdPool = [...remainingMDs];
  for (const room of soloRooms) {
    if (room.assignedProvider) continue; // already assigned
    const md = mdPool.shift();
    if (md) {
      const idx = rooms.findIndex(r => r.room === room.room);
      if (idx >= 0) {
        rooms[idx] = {
          ...rooms[idx],
          assignedProvider: md.name,
          anesthetist: null,
          isCareTeam: false,
          careTeamLabel: null,
        };
      }
      soloAssigned.push({ md: md.name, room: room.room });
    }
  }

  // Available MDs — not assigned to any room
  const availableMDsList = mdPool.map((p, i) => ({
    ...p,
    availabilityRank: i + 1,
    label: i === 0 ? '1st Available' : i === 1 ? '2nd Available' : `${i+1}th Available`,
  }));

  return {
    rooms,
    careTeams,
    floats: floatAnests,
    available: availableMDsList,
    config,
    anesthetistCount,
  };
}

// Pick rooms with staggered starts for care team assignment
function pickStaggeredRooms(roomPool, count) {
  if (roomPool.length <= count) return roomPool.slice(0, count);

  // Sort by start time to identify stagger opportunities
  const withTimes = roomPool.map(r => {
    const timeStr = r.cases?.[0]?.encounterType || '';
    return { ...r, sortTime: r.startTime || '9999' };
  }).sort((a, b) => a.sortTime.localeCompare(b.sortTime));

  // Try to pick rooms with different start times (staggered)
  const picked = [];
  const usedTimes = new Set();
  for (const room of withTimes) {
    if (picked.length >= count) break;
    const timeKey = room.startTime?.split(' ')[1] || 'unknown';
    if (!usedTimes.has(timeKey) || picked.length < count) {
      picked.push(room);
      usedTimes.add(timeKey);
    }
  }

  // Fill remaining if needed
  for (const room of withTimes) {
    if (picked.length >= count) break;
    if (!picked.find(p => p.room === room.room)) picked.push(room);
  }

  return picked.slice(0, count);
}

// Sort anesthetists by variety — prefer those who haven't been to this area recently
function sortAnesthetistsByVariety(anesthetists, area, history) {
  if (!history || Object.keys(history).length === 0) return anesthetists;

  return [...anesthetists].sort((a, b) => {
    const aHistory = history[a.name] || {};
    const bHistory = history[b.name] || {};
    const aCount = aHistory[area] || 0;
    const bCount = bHistory[area] || 0;
    return aCount - bCount; // prefer fewer assignments to this area
  });
}
