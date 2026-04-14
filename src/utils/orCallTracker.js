// ─────────────────────────────────────────────────────────────
// OR CALL CHOICE TRACKER
// Tracks what OR Call providers choose over time
// Predicts preference after 10 times as OR Call
// ─────────────────────────────────────────────────────────────

const OR_CALL_HISTORY_KEY = 'bmh_orcall_choices';
const PATTERN_THRESHOLD = 10;   // builds before prediction kicks in
const PATTERN_CONFIDENCE = 0.6; // 60% same choice = pattern detected

export function loadORCallHistory() {
  try {
    const raw = localStorage.getItem(OR_CALL_HISTORY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveORCallChoice(providerName, date, choice) {
  // choice: { type: 'available' | 'room', room: string|null, roomType: string|null }
  try {
    const history = loadORCallHistory();
    if (!history[providerName]) history[providerName] = [];
    // Remove any existing entry for this date
    history[providerName] = history[providerName].filter(e => e.date !== date);
    history[providerName].push({ date, ...choice });
    localStorage.setItem(OR_CALL_HISTORY_KEY, JSON.stringify(history));
    return true;
  } catch { return false; }
}

// Get how many times a provider has been OR Call
export function getORCallCount(providerName) {
  const history = loadORCallHistory();
  return (history[providerName] || []).length;
}

// Analyze history and return prediction if pattern detected
// Returns: { predicted: bool, suggestion: object, confidence: number, callCount: number }
export function getORCallPrediction(providerName) {
  const history = loadORCallHistory();
  const entries = history[providerName] || [];
  const callCount = entries.length;

  if (callCount < PATTERN_THRESHOLD) {
    return { predicted: false, suggestion: null, confidence: 0, callCount };
  }

  // Count choice types
  const typeCounts = {};
  const roomTypeCounts = {};
  entries.forEach(e => {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
    if (e.roomType) roomTypeCounts[e.roomType] = (roomTypeCounts[e.roomType] || 0) + 1;
  });

  // Find dominant choice type
  const dominantType = Object.entries(typeCounts).sort((a,b) => b[1]-a[1])[0];
  const typeConfidence = dominantType ? dominantType[1] / callCount : 0;

  if (typeConfidence < PATTERN_CONFIDENCE) {
    return { predicted: false, suggestion: null, confidence: typeConfidence, callCount };
  }

  if (dominantType[0] === 'available') {
    return {
      predicted: true,
      suggestion: { type: 'available', room: null, roomType: null },
      confidence: typeConfidence,
      callCount,
    };
  }

  // Find dominant room type within 'room' choices
  const dominantRoomType = Object.entries(roomTypeCounts).sort((a,b) => b[1]-a[1])[0];
  const roomTypeConfidence = dominantRoomType ? dominantRoomType[1] / callCount : 0;

  return {
    predicted: true,
    suggestion: {
      type: 'room',
      room: null, // specific room TBD at assignment time
      roomType: dominantRoomType?.[0] || null,
    },
    confidence: Math.max(typeConfidence, roomTypeConfidence),
    callCount,
  };
}

// Room type classifier — used when logging a choice
export function classifyRoomType(room, roomData) {
  if (!room || room === 'available') return null;
  const r = roomData || {};
  if (r.isEndo) return 'endo';
  if (r.isCathEP) return 'cardiac';
  if (r.isBOOS) return 'boos';
  if (r.isRobotic) return 'robotic';
  if (r.isFastTurnover) return 'fast_turnover';
  if (r.blockRequired) return 'block_room';
  if (r.acuity === 'high') return 'high_acuity';
  return 'general';
}

// Human-readable summary of a provider's OR Call history
export function getORCallSummary(providerName) {
  const history = loadORCallHistory();
  const entries = history[providerName] || [];
  if (entries.length === 0) return 'No OR Call history yet.';

  const available = entries.filter(e => e.type === 'available').length;
  const roomChoices = entries.filter(e => e.type === 'room');
  const roomTypeCounts = {};
  roomChoices.forEach(e => {
    if (e.roomType) roomTypeCounts[e.roomType] = (roomTypeCounts[e.roomType] || 0) + 1;
  });

  const parts = [];
  if (available > 0) parts.push(`Available: ${available}x`);
  Object.entries(roomTypeCounts).sort((a,b)=>b[1]-a[1]).forEach(([type, count]) => {
    parts.push(`${type.replace('_',' ')}: ${count}x`);
  });

  return `${entries.length} times as OR Call — ${parts.join(', ')}`;
}
