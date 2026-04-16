// ─────────────────────────────────────────────────────────────
// CARE TEAM ENGINE — v4
//
// ARCHITECTURE CHANGE:
// buildAssignments (parsers.js) owns ALL MD assignment.
// buildCareTeams owns ONLY anesthetist assignment + care team grouping.
//
// Flow:
//   1. Rooms arrive already MD-assigned from buildAssignments.
//   2. Care team engine groups rooms by their assigned MD into
//      care teams, respecting geographic and ratio constraints.
//   3. Anesthetists are distributed across care teams.
//   4. Any MD assigned to multiple rooms gets grouped as a care team.
//   5. Solo MD rooms (one room per MD) get no anesthetist unless
//      there are leftover anesthetists after care teams are formed.
//
// This eliminates the double-assignment problem entirely because
// the care team engine never touches MD assignments at all.
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
 
// Peripheral nerve block keywords — require regional-capable MD at BOOS
const PERIPHERAL_BLOCK_KEYWORDS = [
  'interscalene', 'peng', 'adductor canal', 'popliteal', 'sciatic',
  'femoral nerve', 'fascia iliaca', 'infraclavicular', 'axillary block',
  'supraclavicular', 'wrist block', 'ankle block',
];
 
function boosNeedsPeripheralBlock(room) {
  if (!room?.cases?.length) return room?.blockRequired || false;
  const allProcs = room.cases.map(c => (c.procedure || '').toLowerCase()).join(' ');
  if (allProcs.includes('spinal') && !PERIPHERAL_BLOCK_KEYWORDS.some(k => allProcs.includes(k)))
    return false;
  return PERIPHERAL_BLOCK_KEYWORDS.some(k => allProcs.includes(k)) || room.blockRequired;
}
 
// ─────────────────────────────────────────────────────────────
// MAIN CARE TEAM BUILDER
// Rooms arrive with MDs already assigned by buildAssignments.
// This function groups them into care teams and assigns anesthetists.
// ─────────────────────────────────────────────────────────────
export function buildCareTeams(rooms, qg, anesthetistHistory = {}, resourceStructure = {}) {
  if (!rooms?.length || !qg) return { rooms, careTeams: [], floats: [], available: [] };
 
  const activeAnesthetists = (qg.Anesthetists || []).filter(a => !a.isAdmin && !a.isOff);
  const anesthetistCount   = activeAnesthetists.length;
  const config             = getCareTeamConfig(anesthetistCount);
  const { floats: floatCount } = config;
 
  const workingMDs = qg.workingMDs || [];
  const careTeams  = [];
  const usedAnesthetists = new Set();
 
  let anesthetistPool = [...activeAnesthetists];
  anesthetistPool = sortAnesthetistsByVariety(anesthetistPool, 'endo', anesthetistHistory);
 
  // ── STEP 1: Handle endo phantom slots (reserved add-on rooms) ─
  // These are created here since they require knowing the committed endo count.
  const committedEndo  = Math.min(Math.ceil(parseFloat(resourceStructure.endo) || 0), 3);
  const existingEndo   = rooms.filter(r => r.isEndo && !r.isPhantom);
  const phantomCount   = Math.max(0, committedEndo - existingEndo.length);
  const brandMD        = workingMDs.find(p => p.name === 'Brand, David L');
 
  if (brandMD && phantomCount > 0) {
    for (let i = 0; i < phantomCount; i++) {
      rooms.push({
        room: 'Endo Add-Ons',
        area: 'BMH ENDO', building: 'ENDO_FLOOR',
        isEndo: true, isCareTeam: false, isPhantom: true,
        acuity: 'routine', cases: [], caseCount: 0, surgeons: [],
        flags: [{ level: 'info', msg: 'Reserved for inpatient add-on — no cases booked yet' }],
        assignedProvider: brandMD.name,
        anesthetist: null,
        careTeamId: null, careTeamLabel: null, careTeamRatio: null,
        caseStatus: 'Not Started', cardiacNote: '',
        blockRequired: false, blockPossible: false,
        preferredProviders: [], avoidProviders: [], manuallyAdded: false,
      });
    }
  }
 
  // ── STEP 2: Group rooms by assigned MD ────────────────────────
  // Each MD who covers multiple rooms forms a care team.
  // MDs covering only one room are solo.
  // Cardiac/cath/IR rooms are excluded from care team grouping.
  const eligibleRooms = rooms.filter(r =>
    !r.isPhantom && !r.isCardiac && !r.isCathEP && !r.isIR &&
    r.assignedProvider && roomCareTeamSuitability(r) !== 'avoid'
  );
 
  // Count rooms per MD
  const mdRoomMap = {};
  for (const room of eligibleRooms) {
    const md = room.assignedProvider;
    if (!mdRoomMap[md]) mdRoomMap[md] = [];
    mdRoomMap[md].push(room);
  }
 
  // ── STEP 3: Form care teams from MDs with multiple rooms ──────
  // Also form care teams from single-room MDs if anesthetists are available
  // and the MD is care-team-comfortable.
  let ctIdx = 0;
 
  // Sort MD groups: endo first (Brand), then by room count desc, then by MD priority
  const mdGroups = Object.entries(mdRoomMap).sort(([mdA, roomsA], [mdB, roomsB]) => {
    const aIsEndo = roomsA.some(r => r.isEndo);
    const bIsEndo = roomsB.some(r => r.isEndo);
    if (aIsEndo && !bIsEndo) return -1;
    if (!aIsEndo && bIsEndo) return 1;
    return roomsB.length - roomsA.length;
  });
 
  // Determine how many anesthetists to allocate per care team
  // Distribute anesthetists across teams proportionally to room count
  const totalEligibleRooms = eligibleRooms.length;
  const canFormTeams = CARE_TEAM_AVOID.every(name =>
    !mdGroups.find(([md]) => md === name && mdGroups.find(([m]) => m === name)?.[1]?.length > 1)
  );
 
  for (const [md, mdRooms] of mdGroups) {
    const isCTComfortable = CARE_TEAM_COMFORTABLE.includes(md);
    const isCTAvoid       = CARE_TEAM_AVOID.includes(md);
    const roomCount       = mdRooms.length;
 
    // BOOS max ratio is 1:2
    const isBOOS     = mdRooms.every(r => r.isBOOS);
    const maxRatio   = isBOOS ? 2 : 3;
    const ratio      = Math.min(roomCount, maxRatio);
 
    // Assign anesthetists to this group if:
    // - MD covers 2+ rooms (natural care team), OR
    // - MD is care-team-comfortable and anesthetists remain
    const needsAnests = ratio >= 2 || (isCTComfortable && !isCTAvoid && anesthetistPool.filter(a => !usedAnesthetists.has(a.name)).length > 0);
 
    if (!needsAnests) continue;
    if (isCTAvoid && ratio < 2) continue; // solo avoidance MDs never get anesthetists
 
    const availAnests = sortAnesthetistsByVariety(
      anesthetistPool.filter(a => !usedAnesthetists.has(a.name)),
      mdRooms[0]?.isEndo ? 'endo' : mdRooms[0]?.isBOOS ? 'boos' : 'main',
      anesthetistHistory
    );
 
    const assignedAnests = availAnests.slice(0, ratio);
    if (assignedAnests.length === 0) continue;
 
    assignedAnests.forEach(a => usedAnesthetists.add(a.name));
 
    const color     = CARE_TEAM_COLORS[ctIdx % CARE_TEAM_COLORS.length];
    const teamLabel = `Care Team ${ctIdx + 1} — ${md.split(',')[0]} 1:${ratio}`;
 
    careTeams.push({
      id:           ctIdx,
      md,
      ratio:        `1:${ratio}`,
      rooms:        mdRooms.slice(0, ratio).map(r => r.room),
      anesthetists: assignedAnests.map(a => a.name),
      color,
      isBOOS,
      hasReserve:   false,
    });
 
    // Update rooms with care team info and anesthetist assignment
    mdRooms.slice(0, ratio).forEach((room, i) => {
      const idx = rooms.findIndex(r => r.room === room.room && !r.isPhantom);
      if (idx >= 0) {
        rooms[idx] = {
          ...rooms[idx],
          anesthetist:   assignedAnests[i]?.name || null,
          careTeamId:    ctIdx,
          careTeamLabel: teamLabel,
          careTeamRatio: `1:${ratio}`,
          isCareTeam:    true,
        };
      }
    });
 
    ctIdx++;
  }
 
  // ── STEP 4: Assign anesthetists to phantom endo slots ─────────
  if (brandMD) {
    const endoCareTeam = careTeams.find(ct => ct.md === brandMD.name);
    const phantomSlots = rooms.filter(r => r.isPhantom && r.assignedProvider === brandMD.name);
    phantomSlots.forEach((pr, i) => {
      const anest = anesthetistPool.filter(a => !usedAnesthetists.has(a.name))[0];
      const idx   = rooms.findIndex(r => r.room === pr.room && r.isPhantom);
      if (idx >= 0) {
        const ratio = endoCareTeam
          ? parseInt(endoCareTeam.ratio.split(':')[1]) + phantomSlots.length
          : 1;
        rooms[idx] = {
          ...rooms[idx],
          anesthetist:   anest?.name || null,
          careTeamId:    endoCareTeam?.id ?? ctIdx,
          careTeamLabel: endoCareTeam ? endoCareTeam.rooms.length > 0
            ? `Care Team ${(endoCareTeam.id ?? 0) + 1} — Brand`
            : 'Care Team 1 — Brand'
            : 'Care Team 1 — Brand',
          careTeamRatio: endoCareTeam?.ratio || '1:1',
          isCareTeam:    true,
        };
        if (anest) {
          usedAnesthetists.add(anest.name);
          if (endoCareTeam) endoCareTeam.anesthetists.push(anest.name);
        }
      }
    });
    // Update endo care team to note reserve
    if (endoCareTeam && phantomSlots.length > 0) {
      endoCareTeam.hasReserve = true;
      endoCareTeam.rooms = [...endoCareTeam.rooms, ...phantomSlots.map(r => r.room)];
    }
  }
 
  // ── STEP 5: Float anesthetists ────────────────────────────────
  const floatAnests = anesthetistPool
    .filter(a => !usedAnesthetists.has(a.name))
    .slice(0, floatCount);
 
  // ── STEP 6: Available MDs and anesthetists ────────────────────
  // These are computed in App.jsx from room state, not here.
  // Return empty available list — App.jsx handles display.
  const availableMDsList = [];
 
  return { rooms, careTeams, floats: floatAnests, available: availableMDsList, config, anesthetistCount };
}
 
function sortAnesthetistsByVariety(anesthetists, area, history) {
  if (!history || Object.keys(history).length === 0) return anesthetists;
  return [...anesthetists].sort((a, b) => {
    const aCount = (history[a.name] || {})[area] || 0;
    const bCount = (history[b.name] || {})[area] || 0;
    return aCount - bCount;
  });
}
 
