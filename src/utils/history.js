// ─────────────────────────────────────────────────────────────
// HISTORY STORE
// Tracks past assignments for variety/rotation logic
// Uses localStorage for persistence between sessions
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'bmh_assignment_history';
const MD_HISTORY_KEY = 'bmh_md_history';

// Location categories for tracking
export const LOCATION_TYPES = [
  { value: 'endo', label: 'Endoscopy' },
  { value: 'main_or', label: 'Main OR' },
  { value: 'cath_ep', label: 'Cath Lab / EP' },
  { value: 'boos', label: 'BOOS' },
  { value: 'ir', label: 'IR' },
  { value: 'float', label: 'Float' },
];

// Assignment types for MDs
export const MD_ASSIGNMENT_TYPES = [
  { value: 'solo', label: 'Solo Room' },
  { value: 'care_team_1_2', label: 'Care Team 1:2 (directing)' },
  { value: 'care_team_1_3', label: 'Care Team 1:3 (directing)' },
  { value: 'available', label: 'Available (1st/2nd)' },
  { value: 'cardiac', label: 'Cardiac Case' },
  { value: 'blocks', label: 'Block Room' },
];

export function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function loadMDHistory() {
  try {
    const raw = localStorage.getItem(MD_HISTORY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveHistoryEntry(entry) {
  // entry: { date, anesthetist, location, room, mdDirecting }
  try {
    const history = loadHistory();
    const key = entry.date;
    if (!history[key]) history[key] = [];
    // Remove duplicate for same anesthetist+date
    history[key] = history[key].filter(e => e.anesthetist !== entry.anesthetist);
    history[key].push(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    return true;
  } catch { return false; }
}

export function saveMDHistoryEntry(entry) {
  // entry: { date, md, assignmentType, room }
  try {
    const history = loadMDHistory();
    const key = entry.date;
    if (!history[key]) history[key] = [];
    history[key] = history[key].filter(e => e.md !== entry.md);
    history[key].push(entry);
    localStorage.setItem(MD_HISTORY_KEY, JSON.stringify(history));
    return true;
  } catch { return false; }
}

export function saveFullDayHistory(date, assignments) {
  // Save entire day's assignments at once
  try {
    const history = loadHistory();
    const mdHistory = loadMDHistory();
    history[date] = [];
    mdHistory[date] = [];

    assignments.forEach(room => {
      if (room.anesthetist) {
        const locType = room.isEndo ? 'endo' : room.isBOOS ? 'boos' : room.isCathEP ? 'cath_ep' : 'main_or';
        history[date].push({
          anesthetist: room.anesthetist,
          location: locType,
          room: room.room,
          mdDirecting: room.assignedProvider,
          isCareTeam: room.isCareTeam,
          ratio: room.careTeamRatio,
        });
      }
      if (room.assignedProvider) {
        const assignType = room.isCareTeam
          ? (room.careTeamRatio === '1:2' ? 'care_team_1_2' : 'care_team_1_3')
          : room.isCardiac ? 'cardiac'
          : room.blockRequired ? 'blocks'
          : 'solo';
        mdHistory[date].push({
          md: room.assignedProvider,
          assignmentType: assignType,
          room: room.room,
        });
      }
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    localStorage.setItem(MD_HISTORY_KEY, JSON.stringify(mdHistory));
    return true;
  } catch { return false; }
}

// Get aggregated location counts per anesthetist (for variety logic)
export function getAnesthetistLocationCounts() {
  const history = loadHistory();
  const counts = {};

  Object.values(history).forEach(dayEntries => {
    dayEntries.forEach(entry => {
      if (!counts[entry.anesthetist]) counts[entry.anesthetist] = {};
      const loc = entry.location || 'main_or';
      counts[entry.anesthetist][loc] = (counts[entry.anesthetist][loc] || 0) + 1;
    });
  });

  return counts;
}

export function getAllDates() {
  const history = loadHistory();
  return Object.keys(history).sort().reverse();
}

export function getHistoryForDate(date) {
  const history = loadHistory();
  return history[date] || [];
}

export function deleteHistoryDate(date) {
  try {
    const history = loadHistory();
    const mdHistory = loadMDHistory();
    delete history[date];
    delete mdHistory[date];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    localStorage.setItem(MD_HISTORY_KEY, JSON.stringify(mdHistory));
    return true;
  } catch { return false; }
}
