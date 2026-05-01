import { useState, useCallback, useEffect, useRef } from 'react';
import { PROVIDERS, ANESTHETIST_SHIFTS, LATE_STAY_PRIORITY } from './data/providers.js';
import { SURGEON_BLOCKS } from './data/surgeons.js';
import { parseQGenda, parseCubeData } from './utils/parsers.js';
import { CARE_TEAM_COLORS } from './utils/careTeams.js';
import { buildDailyAssignments } from './engine/assignmentEngine.js';
import { getAnesthetistLocationCounts, saveFullDayHistory, saveCCSchedule } from './utils/history.js';
import { saveORCallChoice, getORCallPrediction } from './utils/orCallTracker.js';
import { callAI } from './utils/api.js';
import HistoryTab from './components/HistoryTab.jsx';
import ORCallPrompt from './components/ORCallPrompt.jsx';
import AssignmentReview from './components/AssignmentReview.jsx';
import './App.css';

// ── OR.endo.CCL week parser ───────────────────────────────────────
// Accepts a pasted Excel/Sheets block (any number of rows).
// Finds a date in the first 3 columns of each row, then reads
// columns C–G (indices 2–6) as: Main OR, Endo, Cath, BOOS, IR.
function parseORCCLWeek(raw) {
  if (!raw?.trim()) return {};
  const result = {};
  for (const line of raw.trim().split('\n')) {
    const cols = line.split('\t').map(c => c.trim());
    if (cols.length < 3) continue;
    let dateKey = null;
    for (const col of cols.slice(0, 3)) {
      const m = col.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
      if (m) {
        const yr = m[3] ? (m[3].length === 2 ? '20'+m[3] : m[3]) : new Date().getFullYear();
        dateKey = `${parseInt(m[1])}/${parseInt(m[2])}/${yr}`;
        break;
      }
    }
    if (!dateKey) continue;
    // Columns C–G are indices 2–6 when the row has ≥7 cols (date + label + 5 values).
    // If shorter, assume the first 5 numeric-looking cols are the values.
    const valueCols = cols.length >= 7 ? cols.slice(2, 7) : cols.filter(c => /^[\d.]+$/.test(c)).slice(0, 5);
    const vals = valueCols.map(v => v.replace(/[^0-9.]/g, ''));
    if (vals.some(v => v)) {
      result[dateKey] = { mainOR: vals[0]||'', endo: vals[1]||'', cath: vals[2]||'', boos: vals[3]||'', ir: vals[4]||'' };
    }
  }
  return result;
}

function extractCubeDates(raw) {
  const seen = new Set(), dates = [];
  for (const line of (raw||'').split('\n')) {
    const m = line.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (m && !seen.has(m[1])) { seen.add(m[1]); dates.push(m[1]); }
  }
  return dates.sort((a, b) => new Date(a) - new Date(b));
}

function extractQGendaDayName(raw, targetISO) {
  if (!raw || !targetISO) return false;
  const d = new Date(targetISO + 'T12:00:00');
  const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const dateLabel = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toLowerCase();
  for (const line of raw.split('\n')) {
    const first = line.split('\t')[0]?.trim().toLowerCase();
    if (first === dayName || first === dateLabel) return true;
  }
  return false;
}

function isoToMDY(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
}

function mdyToISO(mdy) {
  if (!mdy) return '';
  const [m, d, y] = mdy.split('/');
  if (!m || !d || !y) return '';
  return `${y.length === 2 ? '20'+y : y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function formatMDY(mdy) {
  try {
    return new Date(mdyToISO(mdy)+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
  } catch { return mdy; }
}

const ROLE_COLORS = {
  'OR Call (#1)': '#ef4444',
  'Back Up Call (#2)': '#f97316',
  'Cardiac Call (CV)': '#8b5cf6',
  'Backup CV': '#a855f7',
  'OB Call': '#ec4899',
  '7/8 Hr Shift': '#3b82f6',
  'Locum': '#14b8a6',
  'Rank #3': '#22c55e',
  'Rank #4': '#84cc16',
  'Rank #5': '#eab308',
  'Rank #6': '#f59e0b',
};

const ACUITY_COLORS = {
  cardiac: '#8b5cf6', high: '#ef4444', peds: '#3b82f6',
  'medium-high': '#f97316', routine: '#22c55e', 'low-medium': '#84cc16', low: '#475569',
};

const STATUS_COLORS = {
  'Not Started': '#475569', Early: '#3b82f6', Mid: '#f59e0b',
  Closing: '#f97316', Done: '#22c55e',
};

const TABS = [
  { id: 'board',     label: 'DAILY BOARD' },
  { id: 'assign',    label: 'ASSIGNMENTS' },
  { id: 'review',    label: 'ASSIGNMENT REVIEW' },
  { id: 'handoff',   label: '2PM HANDOFF' },
  { id: 'providers', label: 'PROVIDER INTEL' },
  { id: 'surgeons',  label: 'SURGEON DB' },
  { id: 'history',   label: 'HISTORY' },
  { id: 'ai',        label: 'AI ASSISTANT' },
];

const QUICK_PROMPTS = [
  "Review today's assignment draft — flag any mismatches",
  "Who should stay late if cases run long today?",
  "Optimal relief order for this afternoon",
  "Shoulder/rotator cuff add-on — who gets it?",
  "Cardiac team: Kane and Munro in Cath Lab — 4pm relief plan",
  "Build the afternoon handoff brief for the OR call physician",
  "We're short a backup CV provider today — what's the plan?",
  "Which anesthetists need relief first this afternoon?",
];

const OVERRIDE_REASONS = [
  'physician preference',
  'staffing limitation',
  'provider request',
  'workload balancing',
  'late schedule change',
  'manual judgment',
  'other',
];

const COVERAGE_KEYS = ['mainOR', 'endo', 'cath', 'boos', 'ir'];
const REVIEWED_DISCREPANCY_KEYS = ['mainOR', 'endo', 'cath', 'boos'];
const RESOLVED_OBLIGATION_STORAGE_KEY = 'bmh.resolvedOperationalObligations.v1';

const COVERAGE_LABELS = {
  mainOR: 'Main OR',
  endo: 'Endo',
  cath: 'Cath',
  boos: 'BOOS',
  ir: 'IR',
};

function committedValue(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.ceil(n) : undefined;
}

function buildCommittedObligations(resourceStructure) {
  return {
    mainOR: committedValue(resourceStructure.mainOR),
    endo: committedValue(resourceStructure.endo),
    cath: committedValue(resourceStructure.cath),
    boos: committedValue(resourceStructure.boos),
    ir: committedValue(resourceStructure.ir),
  };
}

function obligationsToResourceStructure(values = {}) {
  return Object.fromEntries(
    COVERAGE_KEYS.map(key => [key, typeof values[key] === 'number' ? String(values[key]) : ''])
  );
}

function buildCubeVisibilityCounts(rooms = []) {
  return {
    mainOR: rooms.filter(r => r.building === 'MAIN_OR_FLOOR' && !r.isEndo && !r.isCathEP && !r.isBOOS && !r.isIR).length,
    endo: rooms.filter(r => r.isEndo).length,
    cath: rooms.filter(r => r.isCathEP).length,
    boos: rooms.filter(r => r.isBOOS).length,
    ir: rooms.filter(r => r.isIR).length,
  };
}

function buildResolutionSignature(date, rawObligations, cubeVisibility) {
  return JSON.stringify({ date, rawObligations, cubeVisibility });
}

function buildOperationalDiscrepancies(rawObligations, cubeVisibility) {
  return REVIEWED_DISCREPANCY_KEYS.map(key => {
    const obligated = rawObligations[key];
    if (typeof obligated !== 'number' || obligated < 0) return null;

    const visible = cubeVisibility[key] || 0;
    const difference = Math.abs(visible - obligated);
    if (difference === 0) return null;

    let level = 'info';
    let requiresConfirmation = false;
    let interpretation = 'Cube procedural visibility differs from OR.Endo.CCL staffing obligation.';

    if (key === 'mainOR') {
      if (difference <= 1) {
        interpretation = 'Likely open-heart, add-on reserve, or expected consolidation behavior.';
      } else if (difference === 2) {
        level = 'warn';
        interpretation = 'Mild Main OR mismatch; likely placeholder or consolidation issue.';
      } else {
        level = 'critical';
        requiresConfirmation = true;
        interpretation = 'Large Main OR mismatch; confirm intended anesthesia staffing obligation before assignment.';
      }
    } else if (key === 'endo' || key === 'cath') {
      const zeroVisibilityWithObligation = obligated > 0 && visible === 0;
      const majorMismatch = zeroVisibilityWithObligation || difference >= 2;
      level = majorMismatch ? 'critical' : 'warn';
      requiresConfirmation = majorMismatch;
      interpretation = zeroVisibilityWithObligation
        ? `${COVERAGE_LABELS[key]} obligation exists but Cube shows no anesthesia-relevant procedural visibility.`
        : `${COVERAGE_LABELS[key]} procedural visibility differs from staffing obligation; confirm if this is expected.`;
    } else if (key === 'boos') {
      const majorMismatch = obligated > 0 && visible === 0;
      level = majorMismatch ? 'critical' : 'warn';
      requiresConfirmation = majorMismatch;
      interpretation = majorMismatch
        ? 'BOOS obligation exists but Cube shows no BOOS procedural visibility.'
        : 'BOOS visibility differs from staffing obligation; confirm if this is expected.';
    }

    return {
      source: 'operational-discrepancy-arbitration',
      area: COVERAGE_LABELS[key],
      key,
      obligated,
      visible,
      difference,
      level,
      requiresConfirmation,
      suggestedCount: obligated,
      interpretation,
      msg: `${COVERAGE_LABELS[key]}: OR.Endo.CCL shows ${obligated}, Cube shows ${visible}. ${interpretation}`,
    };
  }).filter(Boolean);
}

function buildResolvedOperationalObligations({ values, source, rawObligations, cubeVisibility, discrepancies = [], date }) {
  return {
    version: 1,
    source,
    date,
    rawObligations: { ...rawObligations },
    cubeVisibility: { ...cubeVisibility },
    values: { ...values },
    discrepancies,
    inputSignature: buildResolutionSignature(date, rawObligations, cubeVisibility),
    confirmedAt: new Date().toISOString(),
  };
}

function readResolvedObligationStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RESOLVED_OBLIGATION_STORAGE_KEY) || '');
    return parsed?.version === 1 && parsed.byDate ? parsed : { version: 1, byDate: {} };
  } catch {
    return { version: 1, byDate: {} };
  }
}

function writeResolvedObligations(date, resolved) {
  if (!date || !resolved) return;
  const store = readResolvedObligationStore();
  store.byDate[date] = resolved;
  localStorage.setItem(RESOLVED_OBLIGATION_STORAGE_KEY, JSON.stringify(store, null, 2));
}

function roomIdentity(room) {
  return room?.generatedRoomId || room?.room || '';
}

function buildManualOverride(room, provider, reason = 'manual judgment') {
  const originalProvider = room.manualOverride?.originalProvider ?? room.assignedProvider ?? '';
  if ((provider || '') === (originalProvider || '')) return null;

  const fromLabel = originalProvider || 'unassigned';
  const toLabel = provider || 'unassigned';
  return {
    originalProvider,
    newProvider: provider || '',
    reason,
    note: `Manual change from ${fromLabel} to ${toLabel}; reason: ${reason}.`,
  };
}

function applyManualAssignment(room, provider, reason = room.manualOverride?.reason || 'manual judgment') {
  const manualOverride = buildManualOverride(room, provider, reason);
  const next = { ...room, assignedProvider: provider };
  if (room.isPhantom && provider) {
    next.assignmentExplanation = {
      primaryReason: 'Add-on reserve attending assignment',
      doctrineCategory: 'operational_requirement',
      assignmentType: 'standard',
      note: 'Attending assigned to operational reserve capacity; anesthetist is not required until procedural staffing is needed.',
    };
    const reserveNote = 'Add-on reserve has an attending assignment for operational coverage comparison.';
    next.assignmentReviewNotes = [
      ...(room.assignmentReviewNotes || []).filter(note => note.note !== reserveNote),
      { category: 'informational', note: reserveNote },
    ];
  } else if (room.isPhantom && !provider) {
    delete next.assignmentExplanation;
    next.assignmentReviewNotes = (room.assignmentReviewNotes || []).filter(note =>
      note.note !== 'Add-on reserve has an attending assignment for operational coverage comparison.'
    );
  }
  if (manualOverride) return { ...next, manualOverride };
  const { manualOverride: _manualOverride, ...withoutOverride } = next;
  return withoutOverride;
}

function buildAssignmentConfidenceSummary(rooms = [], coverageGaps = []) {
  const assignedRooms = rooms.filter(room => room.assignedProvider);
  const alternateAssignments = assignedRooms.filter(room => room.protectedExpertise?.alternateRequired);
  const protectedRooms = assignedRooms.filter(room => room.protectedExpertise?.qualified);
  const manualOverrides = assignedRooms.filter(room => room.manualOverride);
  const reviewSuggested = assignedRooms.filter(room =>
    (room.assignmentReviewNotes || []).some(note => note.category === 'review suggested')
  );
  const attentionNotes = assignedRooms.filter(room =>
    (room.assignmentReviewNotes || []).some(note => note.category === 'attention')
  );
  const reconciliationDiscrepancies = coverageGaps.filter(gap =>
    gap.source === 'room-obligation-reconciliation' && gap.level !== 'info'
  );
  const specializedDepthNotes = assignedRooms.filter(room =>
    (room.careTeamDoctrineClassifications || []).some(item =>
      item.code === 'preserve_specialized_coverage_depth'
    )
  );

  const statements = [];
  if (!assignedRooms.length) {
    statements.push({ category: 'informational', text: 'No generated assignments are available yet.' });
  } else if (!alternateAssignments.length && !manualOverrides.length && !reviewSuggested.length && !reconciliationDiscrepancies.length) {
    statements.push({ category: 'informational', text: 'Mostly standard assignment pathways were used.' });
  } else {
    statements.push({ category: 'informational', text: 'Assignment pathways are generated and ready for scheduler review.' });
  }

  if (protectedRooms.length && !alternateAssignments.length) {
    statements.push({ category: 'informational', text: 'Protected regional coverage was preserved through the preferred pathway.' });
  }
  if (alternateAssignments.length) {
    statements.push({ category: 'attention', text: 'A few alternate-qualified assignments were needed.' });
  }
  if (specializedDepthNotes.length || attentionNotes.length) {
    statements.push({ category: 'attention', text: 'Regional or specialized coverage depth may be thinner than usual today.' });
  }
  if (manualOverrides.length) {
    statements.push({
      category: manualOverrides.length > 2 ? 'review suggested' : 'attention',
      text: manualOverrides.length > 2 ? 'Several manual adjustments have been applied.' : 'A manual adjustment has been applied.',
    });
  }
  if (reviewSuggested.length || reconciliationDiscrepancies.length) {
    statements.push({ category: 'review suggested', text: 'Assignment plan may benefit from review before final use.' });
  }

  return {
    statements,
    hasReviewSuggested: statements.some(item => item.category === 'review suggested'),
    generatedFrom: [
      'protected-expertise usage',
      'alternate-qualified assignments',
      'override activity',
      'assignment review notes',
      'reconciliation discrepancies',
    ],
  };
}

export default function App() {
  const [tab, setTab] = useState('board');
  const [qgRaw, setQgRaw] = useState('');
  const [cubeRaw, setCubeRaw] = useState('');
  const [qg, setQg] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [handoffStatus, setHandoffStatus] = useState({});
  const [overrides, setOverrides] = useState({});
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResp, setAiResp] = useState('');
  const [aiLoad, setAiLoad] = useState(false);
  const [aiError, setAiError] = useState('');
  const [schedLoaded, setSchedLoaded] = useState(false);
  const [qgLoaded, setQgLoaded] = useState(false);
  const [provSearch, setProvSearch] = useState('');
  const [surgSearch, setSurgSearch] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  const [roomPairs, setRoomPairs] = useState({});
  const [dragSourceRoom, setDragSourceRoom] = useState(null);
  const [dragOverRoom, setDragOverRoom] = useState(null);

  const [dateMismatch, setDateMismatch] = useState(false);
  const [careTeamResult, setCareTeamResult] = useState(null);
  const [showORCallPrompt, setShowORCallPrompt] = useState(false);
  const [orCallChoice, setOrCallChoice] = useState(null);
  const [pendingRooms, setPendingRooms] = useState(null);

  const [orCallWarning, setOrCallWarning] = useState('');
  const [cclRaw, setCclRaw] = useState('');
  const [cclWeekData, setCclWeekData] = useState({});
  const [resourceStructure, setResourceStructure] = useState({
    mainOR: '', endo: '', cath: '', boos: '', ir: ''
  });
  const [resourceLoaded, setResourceLoaded] = useState(false);
  const [resourceBypassed, setResourceBypassed] = useState(false);
  const [coverageGaps, setCoverageGaps] = useState([]);
  const [fractionalPairs, setFractionalPairs] = useState([]);
  const [discrepancyReview, setDiscrepancyReview] = useState(null);
  const [resolvedOperationalObligations, setResolvedOperationalObligations] = useState(null);

  const stepsUnlocked = resourceLoaded || resourceBypassed;

  // When the selected date changes and CCL week data is loaded, auto-fill the coverage fields.
  useEffect(() => {
    if (!selectedDate || !Object.keys(cclWeekData).length) return;
    const found = cclWeekData[isoToMDY(selectedDate)];
    if (found) {
      resolvedOperationalObligationsRef.current = null;
      setResolvedOperationalObligations(null);
      setResourceStructure(found);
    }
  }, [selectedDate, cclWeekData]);

  const finishRef = useRef(null);
  const resolvedOperationalObligationsRef = useRef(null);

  useEffect(() => {
    if (!selectedDate) {
      resolvedOperationalObligationsRef.current = null;
      setResolvedOperationalObligations(null);
      return;
    }
    const stored = readResolvedObligationStore().byDate?.[selectedDate] || null;
    resolvedOperationalObligationsRef.current = stored;
    setResolvedOperationalObligations(stored);
  }, [selectedDate]);

  const commitResolvedOperationalObligations = useCallback((resolved) => {
    resolvedOperationalObligationsRef.current = resolved;
    setResolvedOperationalObligations(resolved);
    if (selectedDate) writeResolvedObligations(selectedDate, resolved);
  }, [selectedDate]);

  const finishBuildingSchedule = useCallback((roomsIn, orChoice) => {
    const history  = getAnesthetistLocationCounts();
    // Resolved obligations are the final staffing-generation authority after
    // operational arbitration. Raw OR.Endo.CCL is used only until arbitration
    // confirms or adjusts the intended staffing counts.
    const effectiveResourceStructure = resolvedOperationalObligationsRef.current
      ? obligationsToResourceStructure(resolvedOperationalObligationsRef.current.values)
      : resourceStructure;
    const { roomPairs: generatedRoomPairs, ...ctResult } = buildDailyAssignments({
      rooms: roomsIn,
      qg,
      resourceStructure: effectiveResourceStructure,
      orCallChoice: orChoice,
      anesthetistHistory: history,
      fractionalPairs,
    });
    setRooms(ctResult.rooms);
    setCareTeamResult(ctResult);
    setOrCallChoice(orChoice);

    // ── Post-build OR Call validation ───────────────────────────
    // Catches choices that passed the prompt check but still failed
    // once the full scheduling logic ran (e.g. "Available" but rooms
    // went uncovered, or "Care Team" but no team slot was left).
    if (orChoice && qg?.ORCall) {
      const unassigned = (ctResult.rooms || []).filter(r => !r.assignedProvider && !r.isPhantom && !r.staffingExcluded);
      if (orChoice.type === 'available' && unassigned.length > 0) {
        setOrCallWarning(
          `⚠ OR Call (${qg.ORCall}) is set to Available, but ${unassigned.length} room${unassigned.length !== 1 ? 's' : ''} ` +
          `(${unassigned.map(r => r.room).join(', ')}) ended up without coverage. ` +
          `Re-build with OR Call assigned to cover the gap.`
        );
      } else if (orChoice.type === 'careteam') {
        const inTeam = (ctResult.careTeams || []).some(ct => ct.md === qg.ORCall);
        if (!inTeam) {
          setOrCallWarning(
            `⚠ OR Call (${qg.ORCall}) chose Care Team but wasn't placed in one — ` +
            `all care team slots may have been filled before their turn. ` +
            `Choose a specific room or re-check the assignment.`
          );
        } else {
          setOrCallWarning('');
        }
      } else {
        setOrCallWarning('');
      }
    } else {
      setOrCallWarning('');
    }
    if (fractionalPairs.length > 0) {
      setRoomPairs(generatedRoomPairs);
    }
  }, [qg, resourceStructure, fractionalPairs]);

  finishRef.current = finishBuildingSchedule;

  const loadQG = useCallback(() => {
    const parsed = parseQGenda(qgRaw, selectedDate);
    if (!parsed) return;
    setQg(parsed);
    setQgLoaded(true);
    if (rooms.length) {
      const history = getAnesthetistLocationCounts();
      const effectiveResourceStructure = resolvedOperationalObligationsRef.current
        ? obligationsToResourceStructure(resolvedOperationalObligationsRef.current.values)
        : resourceStructure;
      const { roomPairs: generatedRoomPairs, ...ctResult } = buildDailyAssignments({
        rooms,
        qg: parsed,
        resourceStructure: effectiveResourceStructure,
        orCallChoice,
        anesthetistHistory: history,
        fractionalPairs,
      });
      setRooms(ctResult.rooms);
      setCareTeamResult(ctResult);
      if (fractionalPairs.length > 0) setRoomPairs(generatedRoomPairs);
    }
  }, [fractionalPairs, orCallChoice, qgRaw, resourceStructure, rooms, selectedDate]);

  const applyParsedSchedule = useCallback((parsed) => {
    setDateMismatch(selectedDate && parsed.totalParsed === 0);
    const discrepancyNotes = (resolvedOperationalObligationsRef.current?.discrepancies || parsed.operationalDiscrepancies || []).map(item => ({
      source: 'operational-discrepancy-arbitration',
      area: item.area,
      needed: item.obligated,
      booked: item.visible,
      level: item.level,
      msg: item.msg,
    }));
    const reconciliationNotes = parsed.reconciliationWarnings || [];
    const nextGaps = [...discrepancyNotes, ...reconciliationNotes];
    setCoverageGaps(prev => [
      ...prev.filter(g =>
        g.source !== 'room-obligation-reconciliation' &&
        g.source !== 'operational-discrepancy-arbitration'
      ),
      ...nextGaps,
    ]);
    setPendingRooms(parsed.rooms);
    setSchedLoaded(true);
    if (qg?.ORCall && parsed.rooms.length > 0) {
      setShowORCallPrompt(true);
    } else {
      finishRef.current(parsed.rooms, null);
    }
  }, [qg, selectedDate]);

  const parseScheduleWithResolvedObligations = useCallback((resolvedObligations) => {
    const values = resolvedObligations?.values || {};
    // Pipeline stage 6: room generation consumes resolved obligations only.
    // Raw CCL and raw Cube visibility are never used directly after arbitration.
    return parseCubeData(
    cubeRaw,
    selectedDate,
    values.mainOR,
    values.cath,
    values.endo,
    values.boos,
    values.ir
    );
  }, [cubeRaw, selectedDate]);

  const loadSchedule = useCallback(() => {
    // Staffing-resolution pipeline:
    // raw OR.Endo.CCL -> raw Cube visibility -> discrepancy detection ->
    // operational arbitration -> resolved obligations -> room generation.
    const existingResolved = resolvedOperationalObligationsRef.current;
    const rawObligations = buildCommittedObligations(resourceStructure);
    const visibilityParsed = parseCubeData(cubeRaw, selectedDate);
    const cubeVisibility = buildCubeVisibilityCounts(visibilityParsed.rooms);
    const inputSignature = buildResolutionSignature(selectedDate, rawObligations, cubeVisibility);
    const existingResolvedMatches = existingResolved?.inputSignature === inputSignature;
    const discrepancies = buildOperationalDiscrepancies(rawObligations, cubeVisibility);
    const requiresReview = discrepancies.filter(item => item.requiresConfirmation);

    if (!existingResolvedMatches && requiresReview.length > 0) {
      setDiscrepancyReview({
        discrepancies,
        rawObligations: { ...rawObligations },
        cubeVisibility: { ...cubeVisibility },
        counts: Object.fromEntries(
          discrepancies.map(item => [item.key, String(item.suggestedCount ?? item.obligated ?? 0)])
        ),
      });
      setDateMismatch(selectedDate && visibilityParsed.totalParsed === 0);
      setCoverageGaps(prev => [
        ...prev.filter(g => g.source !== 'operational-discrepancy-arbitration'),
        ...discrepancies.map(item => ({
          source: 'operational-discrepancy-arbitration',
          area: item.area,
          needed: item.obligated,
          booked: item.visible,
          level: item.level,
          msg: item.msg,
        })),
      ]);
      return;
    }
    const resolved = existingResolvedMatches
      ? existingResolved
      : buildResolvedOperationalObligations({
          values: rawObligations,
          source: 'or-endo-ccl',
          rawObligations,
          cubeVisibility,
          discrepancies,
          date: selectedDate,
        });
    if (!existingResolvedMatches) commitResolvedOperationalObligations(resolved);
    const parsed = parseScheduleWithResolvedObligations(resolved);
    setDiscrepancyReview(null);
    applyParsedSchedule(parsed);
  }, [applyParsedSchedule, commitResolvedOperationalObligations, cubeRaw, parseScheduleWithResolvedObligations, resourceStructure, selectedDate]);

  const handleORCallConfirm = useCallback((choice) => {
    setShowORCallPrompt(false);
    if (qg?.ORCall && selectedDate) saveORCallChoice(qg.ORCall, selectedDate, choice);
    finishRef.current(pendingRooms, choice);
  }, [qg, selectedDate, pendingRooms]);

  const handleORCallSkip = useCallback(() => {
    setShowORCallPrompt(false);
    finishRef.current(pendingRooms, null);
  }, [pendingRooms]);

  const updateDiscrepancyCount = useCallback((key, value) => {
    setDiscrepancyReview(prev => prev ? {
      ...prev,
      counts: { ...prev.counts, [key]: value },
    } : prev);
  }, []);

  const confirmDiscrepancyReview = useCallback(() => {
    if (!discrepancyReview) return;
    const confirmedObligations = { ...discrepancyReview.rawObligations };
    for (const key of COVERAGE_KEYS) {
      if (!(key in (discrepancyReview.counts || {}))) continue;
      const n = parseFloat(discrepancyReview.counts[key]);
      if (Number.isFinite(n) && n >= 0) confirmedObligations[key] = Math.ceil(n);
    }
    const confirmedFields = obligationsToResourceStructure(confirmedObligations);
    const resolved = buildResolvedOperationalObligations({
      values: confirmedObligations,
      source: 'operational-arbitration',
      rawObligations: discrepancyReview.rawObligations,
      cubeVisibility: discrepancyReview.cubeVisibility,
      discrepancies: discrepancyReview.discrepancies || [],
      date: selectedDate,
    });
    commitResolvedOperationalObligations(resolved);
    setResourceStructure(prev => ({ ...prev, ...confirmedFields }));
    const parsed = parseScheduleWithResolvedObligations(resolved);
    setDiscrepancyReview(null);
    applyParsedSchedule(parsed);
  }, [applyParsedSchedule, commitResolvedOperationalObligations, discrepancyReview, parseScheduleWithResolvedObligations, selectedDate]);

  const loadResourceStructure = useCallback((currentRooms) => {
    const rs     = resourceStructure;
    const mainOR = parseFloat(rs.mainOR) || 0;
    const endo   = parseFloat(rs.endo)   || 0;
    const cath   = parseFloat(rs.cath)   || 0;
    const boos   = parseFloat(rs.boos)   || 0;
    const ir     = parseFloat(rs.ir)     || 0;
    const roomsToAnalyze = currentRooms || rooms;
    const gaps = [], pairs = [];

    // OR.endo.CCL is the ceiling — the cube tells us case types, not room count.
    // We do NOT compare cube room counts to OR.endo.CCL numbers; a difference just
    // means a room was closed overnight or add-ons are being absorbed into existing rooms.
    // Fractional providers = split-day coverage (e.g. 0.5 IR + 0.5 Main OR = 1 combined).
    const fractions = [];
    if (ir     % 1 !== 0 && ir     > 0) fractions.push({ area: 'IR',      frac: ir     % 1 });
    if (mainOR % 1 !== 0 && mainOR > 0) fractions.push({ area: 'MAIN OR', frac: mainOR % 1 });
    if (endo   % 1 !== 0 && endo   > 0) fractions.push({ area: 'ENDO',    frac: endo   % 1 });
    if (cath   % 1 !== 0 && cath   > 0) fractions.push({ area: 'CATH',    frac: cath   % 1 });
    if (boos   % 1 !== 0 && boos   > 0) fractions.push({ area: 'BOOS',    frac: boos   % 1 });

    const fracOrder   = { 'IR':0,'BOOS':1,'CATH':2,'ENDO':3,'MAIN OR':4 };
    const sortedFracs = [...fractions].sort((a,b) => (fracOrder[a.area]||5)-(fracOrder[b.area]||5));
    for (let i = 0; i+1 < sortedFracs.length; i += 2) {
      pairs.push({ morning: sortedFracs[i].area, afternoon: sortedFracs[i+1].area, label: `${sortedFracs[i].area} → ${sortedFracs[i+1].area}`, autoDetected: true, overrideRoom: null });
      gaps.push({ area:'COMBINED', needed:1, booked:1, gap:0, level:'info', msg:`Split-day resource: ${sortedFracs[i].area} (morning) → ${sortedFracs[i+1].area} (afternoon) — one provider covers both. Adjust pairing in Assignments if needed.` });
    }

    setFractionalPairs(pairs);
    setCoverageGaps(gaps);
    setResourceLoaded(true);
  }, [resourceStructure, rooms]);

  const updateAssignment = useCallback((roomKey, provider) => {
    setRooms(prev => {
      const pairedRoom = roomPairs[roomKey];
      return prev.map(r => {
        const key = roomIdentity(r);
        if (key === roomKey) return applyManualAssignment(r, provider);
        if (pairedRoom && key === pairedRoom) return applyManualAssignment(r, provider, 'workload balancing');
        return r;
      });
    });
  }, [roomPairs]);

  const updateOverrideReason = useCallback((roomKey, reason) => {
    setRooms(prev => prev.map(r => {
      if (roomIdentity(r) !== roomKey || !r.manualOverride) return r;
      return {
        ...r,
        manualOverride: {
          ...r.manualOverride,
          reason,
          note: `Manual change from ${r.manualOverride.originalProvider || 'unassigned'} to ${r.assignedProvider || 'unassigned'}; reason: ${reason}.`,
        },
      };
    }));
  }, []);

  const createPair = useCallback((roomA, roomB) => {
    if (roomA === roomB) return;
    setRoomPairs(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (next[k] === roomA || next[k] === roomB) delete next[k]; });
      delete next[roomA]; delete next[roomB];
      next[roomA] = roomB; next[roomB] = roomA;
      return next;
    });
    setRooms(prev => {
      const sourceRoom = prev.find(r => roomIdentity(r) === roomA);
      if (!sourceRoom?.assignedProvider) return prev;
      return prev.map(r => roomIdentity(r) === roomB ? applyManualAssignment(r, sourceRoom.assignedProvider, 'workload balancing') : r);
    });
  }, []);

  const breakPair = useCallback((roomName) => {
    setRoomPairs(prev => {
      const next = { ...prev };
      const partner = next[roomName];
      delete next[roomName];
      if (partner) delete next[partner];
      return next;
    });
  }, []);

  const handleDragStart = useCallback((e, roomName) => {
    setDragSourceRoom(roomName);
    e.dataTransfer.effectAllowed = 'link';
    e.dataTransfer.setData('text/plain', roomName);
  }, []);

  const handleDragOver = useCallback((e, roomName) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
    setDragOverRoom(roomName);
  }, []);

  const handleDragLeave = useCallback(() => { setDragOverRoom(null); }, []);

  const handleDrop = useCallback((e, targetRoom) => {
    e.preventDefault();
    const sourceRoom = e.dataTransfer.getData('text/plain') || dragSourceRoom;
    setDragOverRoom(null); setDragSourceRoom(null);
    if (sourceRoom && targetRoom && sourceRoom !== targetRoom) createPair(sourceRoom, targetRoom);
  }, [dragSourceRoom, createPair]);

  const handleDragEnd = useCallback(() => { setDragSourceRoom(null); setDragOverRoom(null); }, []);

  const runAI = useCallback(async (prompt) => {
    if (!prompt?.trim()) return;
    setAiLoad(true); setAiResp(''); setAiError('');
    try {
      const resp = await callAI(prompt, qg, rooms);
      setAiResp(resp);
    } catch (e) {
      setAiError(e.message || 'Error contacting AI.');
    }
    setAiLoad(false);
  }, [qg, rooms]);

  const critFlags = (() => {
    const seen = new Set();
    return rooms.flatMap(r => (r.flags||[]).filter(f=>f.level==='critical').map(f=>({...f,room:r.room})))
      .filter(f => { const key = `${f.room}:${f.msg}`; if (seen.has(key)) return false; seen.add(key); return true; });
  })();

  const today = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const pairCount = Object.keys(roomPairs).length / 2;

  // ── Board-tab derived values (computed unconditionally to avoid IIFE in JSX) ──
  const boardCclDates    = Object.keys(cclWeekData).sort((a,b) => new Date(a)-new Date(b));
  const boardCubeDates   = extractCubeDates(cubeRaw);
  const boardQgHasDate   = extractQGendaDayName(qgRaw, selectedDate);
  const boardCclKey      = isoToMDY(selectedDate);
  const boardCclHasDate  = !!(selectedDate && cclWeekData[boardCclKey]);
  const boardCubeHasDate = !!(selectedDate && boardCubeDates.includes(isoToMDY(selectedDate)));
  const boardAllDates    = [...new Set([...boardCclDates, ...boardCubeDates])].sort((a,b) => new Date(a)-new Date(b));
  const boardInputWarnings = [];
  if (selectedDate) {
    if (qgRaw   && !boardQgHasDate)  boardInputWarnings.push('QGenda data loaded but the selected day was not found — confirm the correct week is pasted.');
    if (cclRaw  && !boardCclHasDate) boardInputWarnings.push(`OR.endo.CCL data pasted but no row found for ${boardCclKey || 'selected date'} — check the date format in the spreadsheet.`);
    if (cubeRaw && !boardCubeHasDate) boardInputWarnings.push(`Cube data pasted but no cases found for ${boardCclKey || 'selected date'} — confirm the correct date range is included.`);
  }
  const boardChangeDate = (iso) => {
    setSelectedDate(iso);
    setSchedLoaded(false); setQgLoaded(false); setRooms([]); setQg(null);
    setResourceLoaded(false); setResourceBypassed(false);
    setCoverageGaps([]); setFractionalPairs([]); setRoomPairs({});
    setOrCallWarning('');
    resolvedOperationalObligationsRef.current = null;
    setResolvedOperationalObligations(null);
  };

  const getPhantomSource = (room) => {
    if (room.roomState === 'Add-On Reserve') return 'parser reconciliation';
    if (room.isPhantom && (room.isCareTeam || room.careTeamLabel)) return 'careTeams';
    return 'unknown';
  };

  const effectiveObligations = resolvedOperationalObligations?.values || buildCommittedObligations(resourceStructure);

  const reconciliationDiagnostics = [
    {
      label: 'Main OR',
      obligation: effectiveObligations.mainOR || 0,
      matches: room => room.building === 'MAIN_OR_FLOOR' && !room.isEndo && !room.isCathEP && !room.isBOOS && !room.isIR,
    },
    {
      label: 'Endo',
      obligation: effectiveObligations.endo || 0,
      matches: room => room.isEndo || room.building === 'ENDO_FLOOR',
    },
    {
      label: 'Cath',
      obligation: effectiveObligations.cath || 0,
      matches: room => room.isCathEP || room.building === 'CATH_FLOOR',
    },
  ].map(area => {
    const areaRooms = rooms.filter(area.matches);
    const cubeVisibleCount = areaRooms.filter(room => !room.isPhantom).length;
    const phantomRooms = areaRooms.filter(room => room.isPhantom);
    const parserReserveCount = phantomRooms.filter(room => getPhantomSource(room) === 'parser reconciliation').length;
    const warnings = coverageGaps.filter(gap =>
      gap.source === 'room-obligation-reconciliation' && gap.area === area.label
    );

    return {
      ...area,
      cubeVisibleCount,
      reserveCreated: parserReserveCount > 0,
      excessCubeCount: Math.max(0, cubeVisibleCount - area.obligation),
      remainingDeficit: Math.max(0, area.obligation - cubeVisibleCount - parserReserveCount),
      phantomRooms: phantomRooms.map(room => ({
        name: room.room,
        source: getPhantomSource(room),
      })),
      warnings,
    };
  });

  const protectedExpertiseAuditRows = rooms
    .filter(room => room.protectedExpertiseReserved || room.protectedExpertise?.qualified)
    .map(room => ({
      room: room.room,
      reasons: room.protectedExpertise?.reasons || [],
      reservedProvider: room.protectedExpertise?.reservedProvider || room.assignedProvider || '',
      pathway: room.protectedExpertise?.pathway || 'Preferred',
      alternateRequired: !!room.protectedExpertise?.alternateRequired,
      note: room.protectedExpertise?.note || 'Protected regional expertise preserved before generic care-team formation',
    }));

  const assignmentConfidenceSummary = buildAssignmentConfidenceSummary(rooms, coverageGaps);

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="header-sub">IU HEALTH BALL MEMORIAL HOSPITAL</div>
          <div className="header-title">ANESTHESIA COMMAND CENTER</div>
        </div>
        <div className="header-right">
          <div className="header-date">
            {schedLoaded && selectedDate
              ? new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})
              : today}
          </div>
          <div className="header-status">
            <span className={qgLoaded      ? 'status-ok' : 'status-off'}>● QGenda {qgLoaded      ? '✓' : '—'}</span>
            <span className={schedLoaded   ? 'status-ok' : 'status-off'}>● Schedule {schedLoaded   ? '✓' : '—'}</span>
            <span className={resourceLoaded? 'status-ok' : 'status-off'}>● Resource {resourceLoaded? '✓' : '—'}</span>
            {pairCount > 0 && <span className="status-ok">⇄ {pairCount} pair{pairCount>1?'s':''}</span>}
            {qg?.aaBackupCall && <span className="status-crit">⚠ AA Backup Call</span>}
            {coverageGaps.filter(g=>g.level==='critical').length > 0 && <span className="status-crit">⚠ {coverageGaps.filter(g=>g.level==='critical').length} gap{coverageGaps.filter(g=>g.level==='critical').length>1?'s':''}</span>}
            {critFlags.length > 0 && <span className="status-crit">⚠ {critFlags.length} critical</span>}
          </div>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={`tab ${tab===t.id?'tab-active':''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="body">

        {/* ── DAILY BOARD ── */}
        {tab === 'board' && (
          <div>
            {/* ══ BUILD DATE BAR (full-width) ══ */}
            <div className="card" style={{marginBottom:'16px'}}>
              <div style={{display:'flex',alignItems:'center',gap:'20px',flexWrap:'wrap',marginBottom: boardAllDates.length || boardInputWarnings.length ? '12px' : 0}}>
                <div>
                  <div style={{fontSize:'11px',fontWeight:'700',color:'var(--accent-blue)',letterSpacing:'1.5px',marginBottom:'6px'}}>BUILD DATE</div>
                  <input type="date" value={selectedDate}
                    onChange={e => boardChangeDate(e.target.value)}
                    style={{background:'#fff',border:'2px solid var(--border)',borderRadius:'var(--radius)',color:selectedDate?'var(--text-primary)':'var(--text-muted)',padding:'8px 14px',fontSize:'14px',fontFamily:'var(--font-mono)',cursor:'pointer',outline:'none',fontWeight:'600'}}
                  />
                </div>
                {selectedDate
                  ? <div style={{fontSize:'17px',fontWeight:'700',color:'var(--text-primary)'}}>
                      {new Date(selectedDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}
                    </div>
                  : <div style={{fontSize:'13px',color:'var(--accent-amber)',fontWeight:'600'}}>⚠ Select a date to begin</div>
                }
                {/* Validation status pills */}
                {selectedDate && (qgRaw || cclRaw || cubeRaw) && (
                  <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginLeft:'auto'}}>
                    {qgRaw   && <span style={{background:boardQgHasDate?'#f0fdf4':'#fef2f2',border:`1px solid ${boardQgHasDate?'#16a34a':'#dc2626'}`,borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:'700',color:boardQgHasDate?'#15803d':'#dc2626'}}>{boardQgHasDate?'✓':'⚠'} QGenda</span>}
                    {cclRaw  && <span style={{background:boardCclHasDate?'#f0fdf4':'#fef2f2',border:`1px solid ${boardCclHasDate?'#16a34a':'#dc2626'}`,borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:'700',color:boardCclHasDate?'#15803d':'#dc2626'}}>{boardCclHasDate?'✓':'⚠'} Coverage</span>}
                    {cubeRaw && <span style={{background:boardCubeHasDate?'#f0fdf4':'#fef2f2',border:`1px solid ${boardCubeHasDate?'#16a34a':'#dc2626'}`,borderRadius:'999px',padding:'3px 10px',fontSize:'11px',fontWeight:'700',color:boardCubeHasDate?'#15803d':'#dc2626'}}>{boardCubeHasDate?'✓':'⚠'} Cube</span>}
                  </div>
                )}
              </div>

              {/* Quick-select from detected dates */}
              {boardAllDates.length > 0 && (
                <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom: boardInputWarnings.length ? '10px' : 0}}>
                  <span style={{fontSize:'11px',fontWeight:'600',color:'var(--text-muted)'}}>DATES IN PASTED DATA:</span>
                  {boardAllDates.map(mdy => {
                    const iso = mdyToISO(mdy);
                    const active = selectedDate === iso;
                    return (
                      <button key={mdy} onClick={() => boardChangeDate(iso)}
                        style={{background:active?'var(--accent-blue)':'var(--bg-elevated)',color:active?'#fff':'var(--text-secondary)',border:`1.5px solid ${active?'var(--accent-blue)':'var(--border)'}`,borderRadius:'var(--radius-sm)',padding:'5px 12px',fontSize:'12px',fontWeight:'700',cursor:'pointer',transition:'all 0.15s'}}>
                        {formatMDY(mdy)}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Input conflict warnings */}
              {boardInputWarnings.map((w,i) => (
                <div key={i} className="flag-warn" style={{marginTop:'6px'}}>{w}</div>
              ))}
            </div>

            {/* ══ Three data-entry columns ══ */}
            <div className="grid-3">
              {/* ── STEP 1: COVERAGE ── */}
              <div>
                <div className="section-label">STEP 1 — OR.ENDO.CCL COVERAGE</div>
                <div className="card">
                  <div className="card-hint" style={{marginBottom:'10px'}}>
                    Paste a week (or any rows) from OR.Endo.CCL. The app reads columns C–G for the selected date and fills the fields below automatically. You can also edit the numbers directly.
                  </div>
                  <textarea className="textarea" rows={4} value={cclRaw}
                    onChange={e => {
                      setCclRaw(e.target.value);
                      resolvedOperationalObligationsRef.current = null;
                      setResolvedOperationalObligations(null);
                      const parsed = parseORCCLWeek(e.target.value);
                      setCclWeekData(parsed);
                      if (selectedDate) {
                        const found = parsed[isoToMDY(selectedDate)];
                        if (found) setResourceStructure(found);
                      }
                    }}
                    placeholder={"Paste OR.Endo.CCL spreadsheet rows here (tab-separated, any number of days).\nThe app finds the row matching your selected date and extracts columns C–G."}
                    style={{marginBottom:'10px'}}
                  />
                  {boardCclDates.length > 0 && (
                    <div style={{fontSize:'11px',color:boardCclHasDate?'#15803d':'var(--text-muted)',fontWeight:'600',marginBottom:'10px'}}>
                      {boardCclHasDate ? `✓ Coverage found for ${boardCclKey}` : `Dates in paste: ${boardCclDates.join(', ')} — selected date not matched`}
                    </div>
                  )}
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'10px'}}>
                    {[{key:'mainOR',label:'MAIN OR'},{key:'endo',label:'ENDO'},{key:'cath',label:'CATH LAB'},{key:'boos',label:'BOOS'},{key:'ir',label:'IR'}].map(({ key, label }) => (
                      <div key={key}>
                        <div style={{fontSize:'10px',color:'var(--text-muted)',fontWeight:'700',letterSpacing:'1px',marginBottom:'3px'}}>{label}</div>
                        <input type="number" min="0" max="15" step="0.5"
                          value={resourceStructure[key]}
                          onChange={e => {
                            resolvedOperationalObligationsRef.current = null;
                            setResolvedOperationalObligations(null);
                            setResourceStructure(prev => ({ ...prev, [key]: e.target.value }));
                          }}
                          placeholder="0" disabled={!selectedDate}
                          style={{width:'100%',background:'#fff',border:'1.5px solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text-primary)',padding:'6px 10px',fontSize:'14px',fontFamily:'var(--font-mono)',fontWeight:'700',outline:'none',textAlign:'center',opacity:selectedDate?1:0.5}}
                        />
                      </div>
                    ))}
                  </div>
                  <div style={{display:'flex',gap:'8px'}}>
                    <button className="btn" onClick={() => loadResourceStructure()} disabled={!selectedDate} style={{flex:1,opacity:selectedDate?1:0.5}}>CONFIRM COVERAGE</button>
                    <button onClick={() => { setResourceBypassed(true); setResourceLoaded(false); setCoverageGaps([]); setFractionalPairs([]); }} disabled={!selectedDate}
                      style={{background:'var(--bg-elevated)',color:'var(--text-muted)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'9px 14px',fontSize:'11px',cursor:'pointer',fontWeight:'600',opacity:selectedDate?1:0.5}}>
                      BYPASS
                    </button>
                  </div>
                  {resourceBypassed && !resourceLoaded && (
                    <div className="flag-warn" style={{marginTop:'8px'}}>⚠ Coverage bypassed — assignments run without coverage ceiling.</div>
                  )}
                </div>
                {resourceLoaded && (
                <div style={{marginTop:'12px'}}>
                  {coverageGaps.length === 0 ? (
                    <div style={{background:'#f0fdf4',border:'1.5px solid #16a34a',borderRadius:'var(--radius)',padding:'10px 12px'}}>
                      <div style={{fontSize:'11px',color:'#15803d',letterSpacing:'1px',fontWeight:'700'}}>✓ COVERAGE COMPLETE</div>
                      <div style={{fontSize:'11px',color:'var(--text-secondary)',marginTop:'3px'}}>Coverage structure confirmed. Cube data will populate room assignments.</div>
                    </div>
                  ) : (
                    <div>
                      <div className="section-label">COVERAGE GAPS — {coverageGaps.length} FOUND</div>
                      {coverageGaps.map((gap, i) => (
                        <div key={i} className={gap.level==='critical'?'flag-crit':gap.level==='warn'?'flag-warn':'flag-info'} style={{marginBottom:'6px'}}>
                          <div style={{fontWeight:'600',letterSpacing:'1px',fontSize:'9px',marginBottom:'3px'}}>{gap.area}{gap.needed?` — ${gap.needed} committed / ${gap.booked} booked`:''}</div>
                          <div>{gap.msg}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {(() => {
                    const summaryObligations = resolvedOperationalObligations?.values || buildCommittedObligations(resourceStructure);
                    const total = COVERAGE_KEYS.reduce((sum, key) => sum + (summaryObligations[key] || 0), 0);
                    const mds = qg?.workingMDs?.length||0;
                    const aas = qg?.Anesthetists?.filter(a=>!a.isAdmin&&!a.isOff).length||0;
                    return total>0?(
                      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'10px 12px',marginTop:'8px'}}>
                        <div style={{fontSize:'10px',color:'var(--accent-blue)',letterSpacing:'2px',marginBottom:'6px'}}>STAFFING SUMMARY{resolvedOperationalObligations ? ' - RESOLVED' : ''}</div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px',textAlign:'center'}}>
                          <div><div style={{fontSize:'18px',color:'var(--text-primary)',fontWeight:'600'}}>{total}</div><div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px'}}>COMMITTED</div></div>
                          <div><div style={{fontSize:'18px',color:'var(--accent-blue)',fontWeight:'600'}}>{mds}</div><div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px'}}>MDs</div></div>
                          <div><div style={{fontSize:'18px',color:'var(--accent-teal)',fontWeight:'600'}}>{aas}</div><div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px'}}>AAs/CRNAs</div></div>
                        </div>
                      </div>
                    ):null;
                  })()}
                </div>
              )}
            </div>

            {/* ── STEP 2: QGENDA ── */}
            <div>
              <div className="section-label">STEP 2 — QGENDA STAFFING</div>
              <div className="card">
                <div className="card-hint" style={{marginBottom:'8px'}}>Paste a day, week, or any amount of QGenda data. The app finds the day matching your selected date automatically.</div>
                {!stepsUnlocked && <div className="flag-warn" style={{marginBottom:'8px'}}>⚠ Confirm or bypass Step 1 first</div>}
                <textarea className="textarea" value={qgRaw} onChange={e=>setQgRaw(e.target.value)}
                  placeholder={"Paste QGenda export here — any date range works.\n\nMonday\nOR Call\tEskew, Gregory S\nBack Up Call\tSingh, Karampal\nLocum\tNielson, Mark\n..."}
                  disabled={!stepsUnlocked} style={{opacity:stepsUnlocked?1:0.4}} />
                {qgRaw && selectedDate && (
                  <div style={{fontSize:'11px',fontWeight:'600',color:boardQgHasDate?'#15803d':'#dc2626',margin:'6px 0'}}>
                    {boardQgHasDate ? `✓ Staffing found for ${new Date(selectedDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'long'})}` : `⚠ No staffing found for ${new Date(selectedDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'long'})} — confirm the correct week is pasted`}
                  </div>
                )}
                <button className="btn" onClick={loadQG} style={{marginTop:'8px',opacity:stepsUnlocked?1:0.4}} disabled={!stepsUnlocked}>LOAD STAFFING</button>
              </div>
              {qgLoaded && qg && (
                <div style={{marginTop:'14px'}}>
                  <div className="section-label">WORKING TODAY</div>
                  {qg.aaBackupCall && (
                    <div style={{background:'#fffbeb',border:'1.5px solid #d97706',borderRadius:'var(--radius)',padding:'10px 12px',marginBottom:'10px'}}>
                      <div style={{fontSize:'11px',color:'#92400e',fontWeight:'700',letterSpacing:'1px',marginBottom:'4px'}}>⚠ AA BACKUP CALL DAY</div>
                      <div style={{fontSize:'11px',color:'var(--text-secondary)'}}>No physician on backup call. {qg.BackUpCallAAs.join(' + ')} are covering the backup call role as anesthetists today.</div>
                      <div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'4px'}}>After 9pm: if OR Call is occupied and an emergency comes in, both AAs are called in and OR Call converts to 1:2 medical direction.</div>
                    </div>
                  )}
                  {qg.workingMDs?.map(p => {
                    const isExp = expanded === `md-${p.name}`;
                    const prof  = PROVIDERS[p.name];
                    return (
                      <div key={p.name} className="card provider-card" style={{borderLeft:`3px solid ${ROLE_COLORS[p.role]||'#475569'}`,marginBottom:'5px'}} onClick={()=>setExpanded(isExp?null:`md-${p.name}`)}>
                        <div className="provider-row">
                          <div><span className="provider-name">{p.name}</span><span className="provider-role" style={{color:ROLE_COLORS[p.role]||'#64748b'}}>{p.role}</span></div>
                          {prof?.flags?.length > 0 && <span className="flag-icon">⚠</span>}
                        </div>
                        {isExp && prof && (
                          <div className="provider-detail">
                            <div><span className="detail-label green">✓</span> {prof.strengths?.join(', ')}</div>
                            {prof.avoidances?.length>0 && <div><span className="detail-label red">✗</span> {prof.avoidances.join(', ')}</div>}
                            <div><span className="detail-label amber">Call:</span> {prof.callPref}</div>
                            <div><span className="detail-label purple">Late:</span> {prof.lateStay}</div>
                            {prof.blockTypes && <div><span className="detail-label blue">Blocks:</span> {prof.blockTypes.join(', ')}</div>}
                            {prof.flags?.length>0 && prof.flags.map((f,i)=><div key={i} className="detail-flag">⚠ {f}</div>)}
                            {prof.notes && <div className="detail-note">{prof.notes}</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {qg.notAvailable?.length > 0 && (
                    <div style={{marginTop:'10px'}}>
                      <div className="section-label" style={{color:'#475569'}}>NOT AVAILABLE</div>
                      <div className="chip-row">{qg.notAvailable.map(p=><div key={p.name} className="chip chip-muted">{p.name} — {p.reason}</div>)}</div>
                    </div>
                  )}
                  {qg.Anesthetists?.filter(a=>!a.isOff).length > 0 && (
                    <div style={{marginTop:'10px'}}>
                      <div className="section-label">ANESTHETISTS</div>
                      <div className="grid-2-sm">
                        {qg.Anesthetists.filter(a=>!a.isOff).map(a=>(
                          <div key={a.name} className="card anest-card" style={{borderLeft:`3px solid ${a.isAdmin?'#374151':'#ec4899'}`,opacity:a.isAdmin?0.45:1}}>
                            <div className="anest-name">{a.name}</div>
                            <div className="anest-shift" style={{color:a.isAdmin?'#94a3b8':'#be185d'}}>{a.isAdmin?'ADMIN — NOT IN OR':(ANESTHETIST_SHIFTS[`Anesthetist ${a.shift}`]?.label||a.shift)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── STEP 3: CUBE ── */}
            <div>
              <div className="section-label">STEP 3 — CUBE SCHEDULE</div>
              <div className="card">
                <div className="card-hint" style={{marginBottom:'8px'}}>Paste any days of cube data — a single day, a week, whatever you have. The app extracts cases for the selected date only.</div>
                {!stepsUnlocked && <div className="flag-warn" style={{marginBottom:'8px'}}>⚠ Confirm or bypass Step 1 first</div>}
                <textarea className="textarea" value={cubeRaw} onChange={e=>{
                  resolvedOperationalObligationsRef.current = null;
                  setResolvedOperationalObligations(null);
                  setCubeRaw(e.target.value);
                }}
                  placeholder={"Paste cube schedule here — any date range.\n\nBMH OR\n4/14/2026 7:30 AM\tBMHOR-2026-701\tBMH OR 10\t..."}
                  disabled={!stepsUnlocked} style={{opacity:stepsUnlocked?1:0.4}} />
                {cubeRaw && boardCubeDates.length > 0 && (
                  <div style={{fontSize:'11px',fontWeight:'600',color:boardCubeHasDate?'#15803d':'var(--text-muted)',margin:'6px 0'}}>
                    {boardCubeHasDate
                      ? `✓ Cases found for ${isoToMDY(selectedDate)}`
                      : `Dates in paste: ${boardCubeDates.slice(0,5).join(', ')}${boardCubeDates.length>5?` +${boardCubeDates.length-5} more`:''} — selected date not matched`}
                  </div>
                )}
                <button className="btn" onClick={loadSchedule} style={{marginTop:'8px',opacity:stepsUnlocked?1:0.4}} disabled={!stepsUnlocked}>LOAD SCHEDULE</button>
              </div>
              {discrepancyReview && (
                <div style={{marginTop:'12px',background:'#fffbeb',border:'1.5px solid #d97706',borderRadius:'var(--radius)',padding:'10px 12px'}}>
                  <div style={{fontSize:'10px',color:'#92400e',letterSpacing:'1px',fontWeight:'800',marginBottom:'6px'}}>OPERATIONAL DISCREPANCY REVIEW</div>
                  <div style={{fontSize:'11px',color:'var(--text-secondary)',lineHeight:1.5,marginBottom:'8px'}}>
                    OR.Endo.CCL is the staffing obligation source. Cube is procedural visibility only. Confirm the intended staffing count before assignments are generated.
                  </div>
                  {discrepancyReview.discrepancies.map(item => (
                    <div key={item.key} className={item.requiresConfirmation ? 'flag-crit' : item.level === 'warn' ? 'flag-warn' : 'flag-info'} style={{marginBottom:'8px'}}>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 86px',gap:'10px',alignItems:'center'}}>
                        <div>
                          <div style={{fontSize:'10px',fontWeight:'800',letterSpacing:'1px',marginBottom:'3px'}}>{item.area}</div>
                          <div>{item.msg}</div>
                        </div>
                        <div>
                          <div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',fontWeight:'700',marginBottom:'3px'}}>CONFIRM</div>
                          <input type="number" min="0" max="15" step="1"
                            value={discrepancyReview.counts[item.key] ?? ''}
                            onChange={e => updateDiscrepancyCount(item.key, e.target.value)}
                            style={{width:'100%',background:'#fff',border:'1.5px solid var(--border)',borderRadius:'var(--radius-sm)',padding:'5px 8px',fontSize:'13px',fontFamily:'var(--font-mono)',fontWeight:'800',textAlign:'center'}}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
                    <button onClick={() => setDiscrepancyReview(null)}
                      style={{background:'transparent',color:'var(--text-muted)',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',padding:'7px 10px',fontSize:'10px',fontWeight:'700',cursor:'pointer'}}>CANCEL</button>
                    <button className="btn" onClick={confirmDiscrepancyReview} style={{fontSize:'10px',padding:'7px 12px'}}>CONFIRM STAFFING COUNTS</button>
                  </div>
                </div>
              )}
              {schedLoaded && (
                <div style={{marginTop:'14px'}}>
                  {dateMismatch ? (
                    <div className="flag-crit">⚠ No cases found for {selectedDate?new Date(selectedDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}):'selected date'}. The cube data may not contain cases for this date yet.</div>
                  ) : rooms.length > 0 ? (
                    <div>
                      <div className="section-label">SCHEDULE — {rooms.filter(r=>!r.isPhantom).length} ROOMS{selectedDate && <span style={{color:'var(--text-secondary)',fontWeight:'normal',marginLeft:'8px',letterSpacing:'0'}}>{new Date(selectedDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span>}</div>
                      <div className="chip-row">
                        {[['cardiac','#8b5cf6'],['high','#ef4444'],['peds','#3b82f6'],['medium-high','#f97316']].map(([a,c])=>{
                          const ct=rooms.filter(r=>r.acuity===a&&!r.isPhantom).length;
                          return ct>0?<div key={a} className="chip" style={{borderColor:c,color:c}}>{a}: {ct}</div>:null;
                        })}
                        {rooms.filter(r=>r.blockRequired).length>0 && <div className="chip" style={{borderColor:'#f59e0b',color:'#f59e0b'}}>blocks: {rooms.filter(r=>r.blockRequired).length}</div>}
                        {pairCount > 0 && <div className="chip" style={{borderColor:'#06b6d4',color:'#06b6d4'}}>⇄ {pairCount} pair{pairCount>1?'s':''}</div>}
                      </div>
                      {critFlags.map((f,i)=><div key={i} className="flag-crit">⚠ {f.room}: {f.msg}</div>)}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            </div>{/* close grid-3 */}
          </div>
        )}

        {showORCallPrompt && qg?.ORCall && (
          <ORCallPrompt
            orCallProvider={qg.ORCall}
            rooms={pendingRooms || []}
            anesthetistCount={qg?.Anesthetists?.filter(a => !a.isAdmin && !a.isOff).length || 0}
            workingMDCount={qg?.workingMDs?.length || 0}
            onConfirm={handleORCallConfirm}
            onSkip={handleORCallSkip}
          />
        )}

        {/* ── ASSIGNMENTS ── */}
        {tab === 'assign' && (
          <div>
            <div className="section-header">
              <div className="section-label">ROOM ASSIGNMENTS</div>
              {(!schedLoaded||!qgLoaded) && <div className="warn-text">Load QGenda and schedule on Daily Board first</div>}
            </div>
            {schedLoaded && rooms.length > 0 && (
              <div style={{background:'#ffffff',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'10px 12px',marginBottom:'12px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',marginBottom:'8px'}}>
                  <div className="section-label" style={{marginBottom:0}}>ASSIGNMENT CONFIDENCE SUMMARY</div>
                  <div style={{fontSize:'10px',color:'var(--text-muted)',fontWeight:'700',letterSpacing:'1px'}}>READ ONLY</div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:'8px'}}>
                  {assignmentConfidenceSummary.statements.map((item, i) => (
                    <div key={`${item.category}-${i}`} className={item.category === 'review suggested' ? 'flag-warn' : 'flag-info'} style={{marginTop:0}}>
                      <strong>{item.category}</strong> - {item.text}
                    </div>
                  ))}
                </div>
                <div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'8px'}}>
                  Based on protected expertise usage, alternate pathways, manual overrides, review notes, and reconciliation discrepancies.
                </div>
              </div>
            )}
            {schedLoaded && rooms.length > 0 && (
              <div style={{background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'8px 14px',marginBottom:'12px',display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
                <span style={{fontSize:'10px',color:'var(--accent-blue)',letterSpacing:'1px',fontWeight:'600'}}>⇄ ROOM PAIRING</span>
                <span style={{fontSize:'10px',color:'var(--text-muted)'}}>Drag one card onto another to pair them. Paired rooms share one provider (morning → afternoon). Click ✕ on a badge to break a pair.</span>
                {pairCount > 0 && <button onClick={() => setRoomPairs({})} style={{marginLeft:'auto',background:'transparent',border:'1px solid #475569',borderRadius:'var(--radius-sm)',color:'#64748b',fontSize:'9px',padding:'3px 8px',cursor:'pointer',fontFamily:'var(--font-mono)',letterSpacing:'1px'}}>CLEAR ALL PAIRS</button>}
              </div>
            )}
            {schedLoaded && rooms.length > 0 && (
              <div style={{background:'#ffffff',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'10px 12px',marginBottom:'12px',overflowX:'auto'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',marginBottom:'8px'}}>
                  <div className="section-label" style={{marginBottom:0}}>ROOM RECONCILIATION DIAGNOSTIC</div>
                  <div style={{fontSize:'10px',color:'var(--text-muted)',fontWeight:'700',letterSpacing:'1px'}}>READ ONLY</div>
                </div>
                <table style={{width:'100%',borderCollapse:'collapse',minWidth:'980px'}}>
                  <thead>
                    <tr>
                      {['AREA','CUBE VISIBLE','OR.ENDO.CCL','RESERVE CREATED','EXCESS CUBE','REMAINING DEFICIT','PHANTOMS / SOURCE','WARNINGS'].map(h => (
                        <th key={h} style={{background:'var(--bg-elevated)',borderBottom:'1px solid var(--border)',padding:'6px 8px',textAlign:'left',fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',fontWeight:'700'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reconciliationDiagnostics.map((row, i) => (
                      <tr key={row.label} style={{background:i%2===0?'var(--bg-surface)':'#ffffff'}}>
                        <td style={{padding:'7px 8px',borderBottom:'1px solid var(--border)',fontSize:'11px',fontWeight:'800',color:'var(--text-primary)',whiteSpace:'nowrap'}}>{row.label}</td>
                        <td style={{padding:'7px 8px',borderBottom:'1px solid var(--border)',fontSize:'11px',color:'var(--text-secondary)'}}>{row.cubeVisibleCount}</td>
                        <td style={{padding:'7px 8px',borderBottom:'1px solid var(--border)',fontSize:'11px',color:'var(--text-secondary)'}}>{row.obligation || '0'}</td>
                        <td style={{padding:'7px 8px',borderBottom:'1px solid var(--border)',fontSize:'11px',fontWeight:'700',color:row.reserveCreated?'var(--accent-green)':'var(--text-muted)'}}>{row.reserveCreated ? 'Yes' : 'No'}</td>
                        <td style={{padding:'7px 8px',borderBottom:'1px solid var(--border)',fontSize:'11px',fontWeight:'700',color:row.excessCubeCount?'var(--accent-amber)':'var(--text-muted)'}}>{row.excessCubeCount}</td>
                        <td style={{padding:'7px 8px',borderBottom:'1px solid var(--border)',fontSize:'11px',fontWeight:'700',color:row.remainingDeficit?'var(--accent-amber)':'var(--text-muted)'}}>{row.remainingDeficit}</td>
                        <td style={{padding:'7px 8px',borderBottom:'1px solid var(--border)',fontSize:'10px',color:'var(--text-secondary)',lineHeight:1.6}}>
                          {row.phantomRooms.length
                            ? row.phantomRooms.map(room => `${room.name} (${room.source})`).join('; ')
                            : 'None'}
                        </td>
                        <td style={{padding:'7px 8px',borderBottom:'1px solid var(--border)',fontSize:'10px',color:row.warnings.length?'var(--accent-amber)':'var(--text-muted)',lineHeight:1.6}}>
                          {row.warnings.length ? row.warnings.map(w => w.msg).join(' ') : 'None'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {protectedExpertiseAuditRows.length > 0 && (
              <div style={{background:'#ffffff',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'10px 12px',marginBottom:'12px',overflowX:'auto'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',marginBottom:'8px'}}>
                  <div className="section-label" style={{marginBottom:0}}>PROTECTED REGIONAL EXPERTISE AUDIT</div>
                  <div style={{fontSize:'10px',color:'var(--text-muted)',fontWeight:'700',letterSpacing:'1px'}}>READ ONLY</div>
                </div>
                <table style={{width:'100%',borderCollapse:'collapse',minWidth:'900px'}}>
                  <thead>
                    <tr>
                      {['ROOM','WHY PROTECTED','RESERVED PROVIDER','PATHWAY','ALTERNATE REQUIRED','NOTE'].map(h => (
                        <th key={h} style={{background:'var(--bg-elevated)',borderBottom:'1px solid var(--border)',padding:'6px 8px',textAlign:'left',fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',fontWeight:'700'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {protectedExpertiseAuditRows.map((row, i) => (
                      <tr key={row.room} style={{background:i%2===0?'var(--bg-surface)':'#ffffff'}}>
                        <td style={{padding:'7px 8px',borderBottom:'1px solid var(--border)',fontSize:'11px',fontWeight:'800',color:'var(--text-primary)',whiteSpace:'nowrap'}}>{row.room}</td>
                        <td style={{padding:'7px 8px',borderBottom:'1px solid var(--border)',fontSize:'10px',color:'var(--text-secondary)',lineHeight:1.6}}>{row.reasons.join('; ') || 'Protected regional signal detected'}</td>
                        <td style={{padding:'7px 8px',borderBottom:'1px solid var(--border)',fontSize:'11px',fontWeight:'700',color:'var(--text-primary)',whiteSpace:'nowrap'}}>{row.reservedProvider || 'None'}</td>
                        <td style={{padding:'7px 8px',borderBottom:'1px solid var(--border)',fontSize:'11px',fontWeight:'700',color:row.pathway==='Preferred'?'var(--accent-green)':'var(--accent-amber)',whiteSpace:'nowrap'}}>{row.pathway}</td>
                        <td style={{padding:'7px 8px',borderBottom:'1px solid var(--border)',fontSize:'11px',fontWeight:'700',color:row.alternateRequired?'var(--accent-amber)':'var(--text-muted)',whiteSpace:'nowrap'}}>{row.alternateRequired ? 'Yes' : 'No'}</td>
                        <td style={{padding:'7px 8px',borderBottom:'1px solid var(--border)',fontSize:'10px',color:'var(--text-muted)',lineHeight:1.6}}>{row.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {careTeamResult?.careTeams?.length > 0 && (
              <div style={{marginBottom:'16px'}}>
                <div className="section-label">CARE TEAM SUMMARY</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:'8px',marginBottom:'8px'}}>
                  {careTeamResult.careTeams.map((ct, i) => (
                    <div key={i} style={{background:ct.color.bg,border:`1px solid ${ct.color.border}`,borderRadius:'var(--radius)',padding:'8px 12px',minWidth:'180px'}}>
                      <div style={{fontSize:'10px',color:ct.color.text,fontWeight:'600',letterSpacing:'1px',marginBottom:'3px'}}>
                        {ct.color.label} — {ct.ratio}
                        {ct.hasReserve && <span style={{color:'var(--accent-amber)',marginLeft:'6px'}}>+ RESERVE</span>}
                        {ct.isBOOS && <span style={{color:'#94a3b8',marginLeft:'6px'}}>BOOS</span>}
                      </div>
                      <div style={{fontSize:'11px',color:'var(--text-primary)'}}>{ct.md.split(',')[0]}</div>
                      <div style={{fontSize:'10px',color:'var(--text-secondary)',marginTop:'2px'}}>Rooms: {ct.rooms.join(', ')}</div>
                      <div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'2px'}}>AAs: {ct.anesthetists.join(', ') || '—'}</div>
                    </div>
                  ))}
                  {careTeamResult.floats?.length > 0 && (
                    <div style={{background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'8px 12px'}}>
                      <div style={{fontSize:'10px',color:'var(--accent-amber)',fontWeight:'600',letterSpacing:'1px',marginBottom:'3px'}}>FLOAT</div>
                      {careTeamResult.floats.map(f=><div key={f.name} style={{fontSize:'11px',color:'var(--text-primary)'}}>{f.name}</div>)}
                    </div>
                  )}
                  {(() => {
                    const assignedMDs = new Set(rooms.filter(r=>r.assignedProvider).map(r=>r.assignedProvider));
                    const unusedMDs = (qg?.workingMDs || []).filter(p => !assignedMDs.has(p.name));
                    const orCallFloating = orCallChoice?.type === 'available' && qg?.ORCall;
                    if (unusedMDs.length === 0 && !orCallFloating) return null;
                    return (
                      <div style={{background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'8px 12px',minWidth:'160px'}}>
                        <div style={{fontSize:'10px',color:'var(--accent-blue)',fontWeight:'600',letterSpacing:'1px',marginBottom:'5px'}}>AVAILABLE MDs</div>
                        {orCallFloating && <div style={{fontSize:'11px',color:'#f97316',marginBottom:'3px',display:'flex',alignItems:'center',gap:'4px'}}><span style={{fontSize:'9px',background:'#f97316',color:'#000',borderRadius:'2px',padding:'1px 4px',fontWeight:'700'}}>1ST AVAIL</span>{qg.ORCall.split(',')[0]}</div>}
                        {unusedMDs.filter(p => !(orCallFloating && p.name === qg?.ORCall)).map((p) => (
                          <div key={p.name} style={{fontSize:'11px',color:'var(--text-secondary)',marginBottom:'2px'}}>{p.name.split(',')[0]}<span style={{fontSize:'9px',color:'var(--text-muted)',marginLeft:'5px'}}>{p.role}</span></div>
                        ))}
                      </div>
                    );
                  })()}
                  {(() => {
                    const assignedAnests  = new Set(rooms.filter(r=>r.anesthetist).map(r=>r.anesthetist));
                    const floatAnestNames = new Set((careTeamResult?.floats || []).map(f => f.name));
                    const unusedAnests = (qg?.Anesthetists || []).filter(a => !a.isAdmin && !a.isOff && !assignedAnests.has(a.name) && !floatAnestNames.has(a.name));
                    if (unusedAnests.length === 0) return null;
                    return (
                      <div style={{background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'8px 12px',minWidth:'160px'}}>
                        <div style={{fontSize:'11px',color:'#be185d',fontWeight:'700',letterSpacing:'1px',marginBottom:'5px'}}>AVAILABLE ANESTHETISTS</div>
                        {unusedAnests.map(a => <div key={a.name} style={{fontSize:'11px',color:'var(--text-secondary)',marginBottom:'2px'}}>{a.name.split(',')[0]}</div>)}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
            {orCallWarning && (
              <div style={{background:'#fff7ed',border:'1.5px solid #ea580c',borderRadius:'var(--radius)',padding:'10px 14px',marginBottom:'12px',fontSize:'12px',color:'#9a3412',lineHeight:'1.6',fontWeight:'600'}}>
                {orCallWarning}
              </div>
            )}
            {critFlags.length>0 && <div style={{marginBottom:'12px'}}>{critFlags.map((f,i)=><div key={i} className="flag-crit">⚠ {f.room}: {f.msg}</div>)}</div>}
            {schedLoaded && rooms.length > 0 && selectedDate && (
              <div style={{marginBottom:'12px'}}>
                <button className="btn" style={{fontSize:'9px',padding:'6px 14px',background:'var(--bg-elevated)',color:'var(--accent-green)',border:'1px solid var(--accent-green)'}}
                  onClick={() => {
                    const nonPhantom = rooms.filter(r => !r.isPhantom);
                    saveFullDayHistory(selectedDate, nonPhantom);  // keeps anesthetist rotation stats
                    saveCCSchedule(selectedDate, nonPhantom);       // full snapshot for comparison
                    alert('Assignments saved to history.');
                  }}>
                  SAVE TO HISTORY
                </button>
              </div>
            )}
            <div className="room-grid">
              {rooms.map(room => {
                const roomKey = roomIdentity(room);
                const ac = ACUITY_COLORS[room.acuity]||'#475569';
                const conflict = room.assignedProvider && room.avoidProviders?.includes(room.assignedProvider);
                const isExp = expanded === `room-${roomKey}`;
                const ctColor = room.isCareTeam && room.careTeamId !== undefined ? CARE_TEAM_COLORS[room.careTeamId % CARE_TEAM_COLORS.length] : null;
                const pairedWith = roomPairs[roomKey];
                const isDragOver = dragOverRoom === roomKey && dragSourceRoom !== roomKey;
                const isDragging = dragSourceRoom === roomKey;
                const explanation = room.assignmentExplanation;
                const reviewNotes = room.assignmentReviewNotes || [];
                const manualOverride = room.manualOverride;

                if (room.isPhantom) {
                  const phantomCtColor = CARE_TEAM_COLORS[0];
                  return (
                    <div key={roomKey} className="card room-card" style={{borderLeft:`3px solid ${phantomCtColor.border}`,borderColor:phantomCtColor.border,background:phantomCtColor.bg,opacity:0.9}}>
                      {room.careTeamLabel && <div style={{fontSize:'9px',color:phantomCtColor.text,letterSpacing:'1px',marginBottom:'5px',fontWeight:'600'}}>{room.careTeamLabel}</div>}
                      <div className="room-header"><span className="room-name" style={{color:phantomCtColor.text}}>{room.room}</span><span style={{fontSize:'9px',color:phantomCtColor.border,letterSpacing:'1px',fontWeight:'700'}}>ADD-ON SLOT</span></div>
                      <div style={{fontSize:'10px',color:'var(--text-secondary)',marginTop:'4px',fontStyle:'italic'}}>No cases booked — add-on slot</div>
                      <div style={{marginTop:'8px'}}>
                        <div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'3px'}}>ATTENDING MD</div>
                        <select className="room-select" style={{borderColor:phantomCtColor.border}}
                          value={room.assignedProvider||''} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();updateAssignment(roomKey,e.target.value);}}>
                          <option value="">Unassigned reserve</option>
                          {qg?.workingMDs?.map(p=>(<option key={p.name} value={p.name}>{p.name} ({p.role})</option>))}
                        </select>
                        {manualOverride && (
                          <div style={{marginTop:'5px'}}>
                            <div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'3px'}}>OVERRIDE REASON</div>
                            <select className="room-select" style={{borderColor:'#06b6d4'}}
                              value={manualOverride.reason} onClick={e=>e.stopPropagation()}
                              onChange={e=>{e.stopPropagation();updateOverrideReason(roomKey,e.target.value);}}>
                              {OVERRIDE_REASONS.map(reason => <option key={reason} value={reason}>{reason}</option>)}
                            </select>
                          </div>
                        )}
                      </div>
                      <div style={{marginTop:'8px'}}><div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'3px'}}>ANESTHETIST</div><div style={{background:'var(--bg-base)',border:`1px solid ${phantomCtColor.border}`,borderRadius:'var(--radius-sm)',padding:'5px 8px',fontSize:'11px',color:phantomCtColor.text}}>{room.anesthetist || '—'}</div></div>
                      {explanation && (
                        <div style={{marginTop:'6px',background:'#ffffff',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',padding:'6px 8px'}}>
                          <div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',fontWeight:'700'}}>{explanation.doctrineCategory} - {explanation.assignmentType}</div>
                          <div style={{fontSize:'10px',color:'var(--text-secondary)',marginTop:'2px'}}>{explanation.primaryReason} - {explanation.note}</div>
                        </div>
                      )}
                      {reviewNotes.map((reviewNote, i) => (
                        <div key={i} className={reviewNote.category === 'review suggested' ? 'flag-warn' : 'flag-info'} style={{marginTop:'6px'}}>
                          <strong>{reviewNote.category}</strong> - {reviewNote.note}
                        </div>
                      ))}
                      {manualOverride && (
                        <div className="flag-info" style={{marginTop:'6px'}}>
                          <strong>manual override</strong> - {manualOverride.note}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <div key={roomKey} className="card room-card" draggable
                    onDragStart={e => handleDragStart(e, roomKey)} onDragOver={e => handleDragOver(e, roomKey)}
                    onDragLeave={handleDragLeave} onDrop={e => handleDrop(e, roomKey)} onDragEnd={handleDragEnd}
                    style={{borderLeft:`3px solid ${pairedWith?'#06b6d4':ctColor?ctColor.border:ac}`,borderColor:isDragOver?'#06b6d4':conflict?'#ef4444':pairedWith?'#06b6d4':ctColor?ctColor.border:'var(--border)',background:isDragOver?'#dbeafe':isDragging?'var(--bg-elevated)':ctColor?ctColor.bg:'var(--bg-surface)',outline:isDragOver?'2px dashed #06b6d4':'none',opacity:isDragging?0.6:1,cursor:'grab',transition:'border-color 0.15s, background 0.15s, outline 0.15s'}}
                    onClick={() => setExpanded(isExp ? null : `room-${roomKey}`)}>
                    {pairedWith && (
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'5px'}}>
                        <div style={{display:'inline-flex',alignItems:'center',gap:'5px',background:'#ecfeff',border:'1.5px solid #0891b2',borderRadius:'var(--radius-sm)',padding:'2px 7px'}}>
                          <span style={{fontSize:'10px',color:'#0e7490',fontWeight:'700',letterSpacing:'1px'}}>⇄ PAIRED</span>
                          <span style={{fontSize:'10px',color:'#0e7490'}}>→ {pairedWith}</span>
                        </div>
                        <button onClick={e=>{e.stopPropagation();breakPair(room.room);}} style={{background:'transparent',border:'none',color:'#475569',cursor:'pointer',fontSize:'12px',padding:'0 2px',lineHeight:1}} title="Break pair">✕</button>
                      </div>
                    )}
                    {room.isCareTeam && room.careTeamLabel && <div style={{fontSize:'9px',color:ctColor?.text,letterSpacing:'1px',marginBottom:'5px',fontWeight:'600'}}>{room.careTeamLabel}</div>}
                    <div className="room-header">
                      <div>
                        <span className="room-name">{room.room}</span>
                        <span className="room-acuity" style={{color:ac}}>{room.acuity?.toUpperCase()}</span>
                        {room.blockRequired && <span className="badge-block">BLOCK</span>}
                        {room.isORCallChoice && <span style={{fontSize:'9px',color:'#f97316',marginLeft:'6px',fontWeight:'700',letterSpacing:'1px'}}>CHOICE</span>}
                      </div>
                      <span className="room-count">{room.caseCount}c</span>
                    </div>
                    <div className="room-procedure">{room.cases?.map(c=>c.procedure).filter(Boolean).join(' → ') || ''}</div>
                    <div className="room-surgeon">{room.surgeons?.join(', ')}</div>
                    {isDragOver && <div style={{fontSize:'10px',color:'#06b6d4',marginBottom:'4px',fontStyle:'italic'}}>Drop to pair with {dragSourceRoom}</div>}
                    <div style={{marginBottom:'5px'}}>
                      <div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'3px'}}>ATTENDING MD {pairedWith && <span style={{color:'#06b6d4'}}>— shared with {pairedWith}</span>}</div>
                      <select className="room-select" style={{borderColor:conflict?'#ef4444':pairedWith?'#06b6d4':ctColor?ctColor.border:'var(--border)'}}
                        value={room.assignedProvider||''} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();updateAssignment(roomKey,e.target.value);}}>
                        <option value="">— Unassigned —</option>
                        {qg?.workingMDs?.map(p=>(<option key={p.name} value={p.name}>{room.preferredProviders?.includes(p.name)?'★ ':room.avoidProviders?.includes(p.name)?'⚠ ':''}{p.name} ({p.role})</option>))}
                      </select>
                      {manualOverride && (
                        <div style={{marginTop:'5px'}}>
                          <div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'3px'}}>OVERRIDE REASON</div>
                          <select className="room-select" style={{borderColor:'#06b6d4'}}
                            value={manualOverride.reason} onClick={e=>e.stopPropagation()}
                            onChange={e=>{e.stopPropagation();updateOverrideReason(roomKey,e.target.value);}}>
                            {OVERRIDE_REASONS.map(reason => <option key={reason} value={reason}>{reason}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                    <div>
                      <div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'3px'}}>ANESTHETIST</div>
                      <div style={{background:'var(--bg-base)',border:`1px solid ${ctColor?ctColor.border:'var(--border)'}`,borderRadius:'var(--radius-sm)',padding:'5px 8px',fontSize:'11px',color:room.anesthetist?(ctColor?ctColor.text:'var(--text-primary)'):'var(--text-faint)',fontStyle:room.anesthetist?'normal':'italic'}}>{room.anesthetist || 'NONE'}</div>
                    </div>
                    {conflict && <div className="flag-crit" style={{marginTop:'6px'}}>⚠ Conflict — {room.assignedProvider} flagged for this room</div>}
                    {room.cardiacNote && <div className="flag-info" style={{marginTop:'6px'}}>{room.cardiacNote}</div>}
                    {explanation && (
                      <div className={explanation.assignmentType === 'compromise' ? 'flag-warn' : 'flag-info'} style={{marginTop:'6px'}}>
                        <strong>{explanation.doctrineCategory}</strong> - {explanation.primaryReason}: {explanation.note}
                      </div>
                    )}
                    {reviewNotes.map((reviewNote, i) => (
                      <div key={i} className={reviewNote.category === 'review suggested' ? 'flag-warn' : 'flag-info'} style={{marginTop:'6px'}}>
                        <strong>{reviewNote.category}</strong> - {reviewNote.note}
                      </div>
                    ))}
                    {manualOverride && (
                      <div className="flag-info" style={{marginTop:'6px'}}>
                        <strong>manual override</strong> - {manualOverride.note}
                      </div>
                    )}
                    {isExp && (
                      <div className="room-detail">
                        {room.preferredProviders?.length>0 && <div className="detail-preferred">★ Preferred: {room.preferredProviders.join(', ')}</div>}
                        {room.avoidProviders?.length>0 && <div className="detail-avoid">✗ Avoid: {room.avoidProviders.join(', ')}</div>}
                        {(room.flags||[]).map((f,i)=>(<div key={i} className={f.level==='critical'?'flag-crit':f.level==='warn'?'flag-warn':'flag-info'}>{f.msg}</div>))}
                        {room.cases?.map((c,i)=>(<div key={i} className="case-detail"><span className="case-proc">{c.procedure}</span> · {c.surgeon}</div>))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ASSIGNMENT REVIEW */}
        {tab === 'review' && (
          <AssignmentReview
            rooms={rooms}
            date={selectedDate}
            resolvedOperationalObligations={resolvedOperationalObligations}
          />
        )}

        {/* ── 2PM HANDOFF ── */}
        {tab === 'handoff' && (
          <div>
            <div className="section-label">2PM HANDOFF GENERATOR</div>
            <div className="grid-2" style={{marginBottom:'20px'}}>
              <div>
                <div className="section-label" style={{color:'var(--text-secondary)'}}>ROOM STATUS (~1:45PM)</div>
                {(rooms.filter(r=>!r.isPhantom).length?rooms.filter(r=>!r.isPhantom):[{room:'OR 1'},{room:'OR 2'},{room:'OR 3'},{room:'OR 4'},{room:'OR 5 (CV)'},{room:'OR 6'},{room:'OR 7'},{room:'OR 8'},{room:'Endo 1'},{room:'Endo 2'},{room:'Cath Lab'},{room:'EP Lab'}]).map(r=>(
                  <div key={r.room} className="card handoff-row" style={{marginBottom:'5px'}}>
                    <div><span className="handoff-room">{r.room}</span>{r.assignedProvider && <span className="handoff-provider">→ {r.assignedProvider}</span>}{roomPairs[r.room] && <span style={{fontSize:'9px',color:'#06b6d4',marginLeft:'6px'}}>⇄ {roomPairs[r.room]}</span>}</div>
                    <select className="handoff-select" style={{color:handoffStatus[r.room]?STATUS_COLORS[handoffStatus[r.room]]:'var(--text-muted)'}} value={handoffStatus[r.room]||''} onChange={e=>setHandoffStatus(p=>({...p,[r.room]:e.target.value}))}>
                      <option value="">—</option>
                      {['Not Started','Early','Mid','Closing','Done'].map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div>
                <div className="section-label" style={{color:'var(--accent-amber)'}}>PROVIDER FLAGS</div>
                {(qg?.workingMDs||[]).map(p=>(
                  <div key={p.name} className="card handoff-row" style={{marginBottom:'5px'}}>
                    <span className="handoff-room">{p.name}</span>
                    <select className="handoff-select" style={{color:overrides[p.name]?'var(--accent-amber)':'var(--text-muted)'}} value={overrides[p.name]||''} onChange={e=>setOverrides(prev=>({...prev,[p.name]:e.target.value}))}>
                      <option value="">— Normal —</option>
                      <option value="willing-late">Willing to stay late</option>
                      <option value="must-leave">Must leave on time</option>
                      <option value="in-case">In case — don't pull</option>
                      <option value="available">Available / floating</option>
                      <option value="non-responsive">Non-responsive → assign ahead of locum</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
            <button className="btn" onClick={()=>{
              const active = Object.entries(handoffStatus).filter(([,v])=>v&&v!=='Done'&&v!=='Not Started').map(([room,status])=>{const r=rooms.find(x=>x.room===room);const pair=roomPairs[room];return `${room}(${status})${r?.assignedProvider?` — ${r.assignedProvider}`:''}${pair?` [paired w/ ${pair}]`:''}`;}).join(', ')||'No statuses entered';
              const ov = Object.entries(overrides).filter(([,v])=>v).map(([n,f])=>`${n}:${f}`).join(', ')||'None';
              const pairSummary = Object.keys(roomPairs).length > 0 ? `Paired rooms: ${Object.entries(roomPairs).filter(([a,b])=>a<b).map(([a,b])=>`${a} ⇄ ${b}`).join(', ')}` : '';
              runAI(`Generate the 2pm afternoon handoff report.\nRoom statuses: ${active}\nProvider flags: ${ov}\n${pairSummary}\n\nProvide:\n1. ONE-PAGE DECISION BRIEF for OR Call physician: what's still running, status, who needs relief and when, who to call next for add-ons, cardiac 4pm flags, late-stay options.\n2. FULL INFORMATIONAL LAYER: all providers still working with shift ends, complete relief order, location coverage plan 2pm-7pm, anesthetist shift ends, any coverage gaps.`);
            }}>GENERATE HANDOFF REPORT</button>
            {aiLoad && <div className="ai-loading">● Generating report...</div>}
            {aiError && <div className="flag-crit" style={{marginTop:'12px'}}>{aiError}</div>}
            {aiResp && <div className="ai-response"><div className="section-label">HANDOFF REPORT</div>{aiResp}</div>}
          </div>
        )}

        {/* ── PROVIDER INTEL ── */}
        {tab === 'providers' && (
          <div>
            <div className="section-label">PROVIDER INTELLIGENCE</div>
            <input className="search-input" value={provSearch} onChange={e=>setProvSearch(e.target.value)} placeholder="Search providers..." />
            {['Employed MDs','Locum MDs','Cardiac MDs'].map(section => {
              const list = Object.entries(PROVIDERS).filter(([n,p]) => {
                const matchSection = section==='Employed MDs'?p.employed&&!p.cardiac:section==='Locum MDs'?p.locum:p.cardiac;
                const matchSearch = !provSearch||n.toLowerCase().includes(provSearch.toLowerCase())||(p.notes||'').toLowerCase().includes(provSearch.toLowerCase());
                return matchSection && matchSearch;
              });
              if (!list.length) return null;
              return (
                <div key={section} style={{marginBottom:'22px'}}>
                  <div className="section-label" style={{color:section==='Cardiac MDs'?'#8b5cf6':section==='Locum MDs'?'#14b8a6':'#60a5fa'}}>{section}</div>
                  <div className="provider-grid">
                    {list.map(([name,p]) => {
                      const isExp = expanded === `prov-${name}`;
                      return (
                        <div key={name} className="card provider-card" style={{cursor:'pointer',border:`1px solid ${isExp?'var(--accent-blue)':'var(--border)'}`}} onClick={()=>setExpanded(isExp?null:`prov-${name}`)}>
                          <div className="provider-row">
                            <span className="provider-name">{name}</span>
                            <div className="badge-row">
                              {p.blockCapable && <span className="badge badge-blue">BLOCKS</span>}
                              {p.thoracicCapable && <span className="badge badge-indigo">THOR</span>}
                              {p.cardiacFillIn && <span className="badge badge-purple">CV FILL</span>}
                              {p.cardiac && <span className="badge badge-purple">CARDIAC</span>}
                              {p.locum && <span className="badge badge-teal">LOCUM</span>}
                            </div>
                          </div>
                          {isExp && (
                            <div className="provider-detail">
                              <div><span className="detail-label green">✓</span> {p.strengths?.join(', ')||'—'}</div>
                              {p.avoidances?.length>0 && <div><span className="detail-label red">✗</span> {p.avoidances.join(', ')}</div>}
                              {p.blockTypes?.length>0 && <div><span className="detail-label blue">Blocks:</span> {p.blockTypes.join(', ')}</div>}
                              <div><span className="detail-label amber">Care team:</span> {p.careTeam===true?'Yes':p.careTeam===false?'No — avoids':'Reluctant'}</div>
                              <div><span className="detail-label purple">Call pref:</span> {p.callPref||'—'}</div>
                              <div><span className="detail-label green">Late stay:</span> {p.lateStay}</div>
                              {p.flags?.length>0 && <div>{p.flags.map((f,i)=><div key={i} className="detail-flag">⚠ {f}</div>)}</div>}
                              <div className="detail-note">{p.notes}</div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── SURGEON DB ── */}
        {tab === 'surgeons' && (
          <div>
            <div className="section-label">SURGEON BLOCK DATABASE</div>
            <input className="search-input" value={surgSearch} onChange={e=>setSurgSearch(e.target.value)} placeholder="Search surgeons or specialty..." />
            <div className="legend">
              <span style={{color:'#dc2626'}}>■</span> Always &nbsp;<span style={{color:'#ea580c'}}>■</span> Usually &nbsp;<span style={{color:'#1d4ed8'}}>■</span> Specific cases &nbsp;<span style={{color:'#b45309'}}>■</span> Confirm day-of &nbsp;<span style={{color:'#16a34a'}}>■</span> Never &nbsp;<span style={{color:'#64748b'}}>■</span> If offered/appropriate
            </div>
            <div className="provider-grid">
              {Object.entries(SURGEON_BLOCKS).filter(([n,p])=>!surgSearch||n.toLowerCase().includes(surgSearch.toLowerCase())||(p.specialty||'').toLowerCase().includes(surgSearch.toLowerCase())).map(([name,p]) => {
                const ruleColor = p.blockRule==='always'?'#ef4444':p.blockRule==='never'?'#22c55e':p.blockRule==='usually'?'#f97316':p.blockRule==='mood-dependent'?'#eab308':'#60a5fa';
                const isExp = expanded===`surg-${name}`;
                return (
                  <div key={name} className="card surgeon-card" style={{borderLeft:`3px solid ${ruleColor}`,cursor:'pointer'}} onClick={()=>setExpanded(isExp?null:`surg-${name}`)}>
                    <div className="surgeon-row"><div><span className="surgeon-name">{name}</span><span className="surgeon-specialty">{p.specialty}</span></div><span className="surgeon-rule" style={{color:ruleColor}}>{p.blockRule}</span></div>
                    {isExp && (
                      <div className="provider-detail">
                        {p.blockCases?.length>0 && <div><span className="detail-label amber">Block cases:</span> {p.blockCases.join(', ')}</div>}
                        {p.neverBlock?.length>0&&p.neverBlock[0]!=='all' && <div><span className="detail-label red">Never:</span> {p.neverBlock.join(', ')}</div>}
                        {p.blockTypes?.length>0 && <div><span className="detail-label blue">Block types:</span> {p.blockTypes.join(', ')}</div>}
                        <div className="detail-note">{p.notes}</div>
                        {p.flags?.map((f,i)=><div key={i} className="detail-flag">⚠ {f}</div>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── HISTORY ── */}
        {tab === 'history' && (
          <div>
            <div className="section-label">ASSIGNMENT HISTORY</div>
            <HistoryTab qg={qg} />
          </div>
        )}

        {/* ── AI ASSISTANT ── */}
        {tab === 'ai' && (
          <div>
            <div className="section-label">AI SCHEDULING ASSISTANT</div>
            <div className="quick-prompts">
              {QUICK_PROMPTS.map(q=>(<button key={q} className="quick-btn" onClick={()=>{setAiPrompt(q);runAI(q);}}>{q}</button>))}
            </div>
            <textarea className="textarea" value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder="Ask anything about today's staffing, assignments, or afternoon coverage..." />
            <button className="btn" onClick={()=>runAI(aiPrompt)} style={{marginTop:'8px'}}>ASK AI</button>
            {aiLoad && <div className="ai-loading">● Processing...</div>}
            {aiError && <div className="flag-crit" style={{marginTop:'12px'}}>{aiError}</div>}
            {aiResp && <div className="ai-response"><div className="section-label">RESPONSE</div>{aiResp}</div>}
          </div>
        )}

      </main>
    </div>
  );
}
