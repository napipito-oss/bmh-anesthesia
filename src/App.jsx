import { useState, useCallback, useEffect, useRef } from 'react';
import { PROVIDERS, ANESTHETIST_SHIFTS, LATE_STAY_PRIORITY } from './data/providers.js';
import { SURGEON_BLOCKS } from './data/surgeons.js';
import { parseQGenda, parseCubeData, buildAssignments } from './utils/parsers.js';
import { buildCareTeams, CARE_TEAM_COLORS } from './utils/careTeams.js';
import { getAnesthetistLocationCounts, saveFullDayHistory } from './utils/history.js';
import { saveORCallChoice, getORCallPrediction } from './utils/orCallTracker.js';
import { callAI } from './utils/api.js';
import HistoryTab from './components/HistoryTab.jsx';
import ORCallPrompt from './components/ORCallPrompt.jsx';
import './App.css';

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
  { id: 'handoff',   label: '2PM HANDOFF' },
  { id: 'providers', label: 'PROVIDER INTEL' },
  { id: 'surgeons',  label: 'SURGEON DB' },
  { id: 'history',   label: 'HISTORY' },
  { id: 'import',    label: 'IMPORT HISTORY' },
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

// ── PAIR UTILITIES ────────────────────────────────────────────
function buildPairsFromFractional(fractionalPairs, rooms) {
  const newPairs = {};
  for (const fp of fractionalPairs) {
    const morningRoom = rooms.find(r => {
      const b = r.building || '';
      if (fp.morning === 'IR')      return b === 'IR';
      if (fp.morning === 'BOOS')    return b === 'BOOS';
      if (fp.morning === 'CATH')    return b === 'CATH_FLOOR';
      if (fp.morning === 'ENDO')    return b === 'ENDO_FLOOR';
      if (fp.morning === 'MAIN OR') return b === 'MAIN_OR_FLOOR';
      return false;
    });
    const afternoonRoom = rooms.find(r => {
      if (r === morningRoom) return false;
      const b = r.building || '';
      if (fp.afternoon === 'IR')      return b === 'IR';
      if (fp.afternoon === 'BOOS')    return b === 'BOOS';
      if (fp.afternoon === 'CATH')    return b === 'CATH_FLOOR';
      if (fp.afternoon === 'ENDO')    return b === 'ENDO_FLOOR';
      if (fp.afternoon === 'MAIN OR') return b === 'MAIN_OR_FLOOR';
      return false;
    });
    if (morningRoom && afternoonRoom) {
      newPairs[morningRoom.room]   = afternoonRoom.room;
      newPairs[afternoonRoom.room] = morningRoom.room;
    }
  }
  return newPairs;
}

// ── IMPORT HISTORY STORAGE HELPERS ───────────────────────────
const HISTORY_PREFIX = 'daysheet:';

async function saveImportedDay(record) {
  const key = `${HISTORY_PREFIX}${record.date}`;
  try {
    await window.storage.set(key, JSON.stringify(record));
    return true;
  } catch (e) {
    console.error('Storage save error:', e);
    return false;
  }
}

async function loadAllImportedDays() {
  try {
    const result = await window.storage.list(HISTORY_PREFIX);
    const keys = result?.keys || [];
    const days = [];
    for (const key of keys) {
      try {
        const item = await window.storage.get(key);
        if (item?.value) days.push(JSON.parse(item.value));
      } catch {}
    }
    return days.sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

async function deleteImportedDay(date) {
  const key = `${HISTORY_PREFIX}${date}`;
  try {
    await window.storage.delete(key);
    return true;
  } catch {
    return false;
  }
}

// ── CLAUDE VISION PARSER ──────────────────────────────────────
async function parseDaySheetWithVision(imageBase64, cubeRoomsForDate) {
  const cubeContext = cubeRoomsForDate?.length > 0
    ? `\n\nFor reference, the cube schedule for this date shows these rooms:\n${cubeRoomsForDate.map(r => `- ${r.room} (${r.acuity || 'routine'}, surgeons: ${r.surgeons?.join(', ') || 'unknown'})`).join('\n')}`
    : '';

  const prompt = `You are parsing a handwritten anesthesia day sheet from IU Health Ball Memorial Hospital.

Extract ALL assignments visible. Return ONLY valid JSON — no markdown, no explanation, no backticks.
${cubeContext}

Return this exact structure:
{
  "date": "YYYY-MM-DD or null if not visible",
  "assignments": [
    {
      "room": "room name as written (e.g. OR 2, Endo 1, BOOS OR 1, Cath Lab, IR)",
      "md": "MD last name or full name as written",
      "anesthetist": "anesthetist name or null",
      "careTeam": true or false,
      "callRole": "OR Call / Backup Call / Cardiac Call / OB Call / Locum / Rank 3 / etc — or null",
      "notes": "any handwritten notes for this row or null"
    }
  ],
  "staffingNotes": "any general staffing notes on the sheet or null",
  "confidence": "high / medium / low",
  "readabilityIssues": "describe any illegible sections or null"
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
          },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'API error');
  const text = (data.content || []).map(c => c.text || '').join('');
  const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(clean);
}

// ── CONFIDENCE COLORS ─────────────────────────────────────────
const CONF_COLORS = { high: '#22c55e', medium: '#f59e0b', low: '#ef4444' };
const CONF_BG     = { high: '#0f2a1e', medium: '#2a1f00', low: '#2a0a0a' };

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

  // ── IMPORT HISTORY STATE ──────────────────────────────────────
  const [importDate, setImportDate] = useState('');
  const [importImage, setImportImage] = useState(null);
  const [importImageUrl, setImportImageUrl] = useState(null);
  const [importCubeRaw, setImportCubeRaw] = useState('');
  const [importParsing, setImportParsing] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');
  const [importedDays, setImportedDays] = useState([]);
  const [importSaving, setImportSaving] = useState(false);
  const [importSaved, setImportSaved] = useState(false);
  const [importViewDay, setImportViewDay] = useState(null);
  const [storageAvailable, setStorageAvailable] = useState(true);

  useEffect(() => {
    // Check storage availability and load existing records
    loadAllImportedDays()
      .then(days => setImportedDays(days))
      .catch(() => setStorageAvailable(false));
  }, []);

  const handleImageUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImportImageUrl(url);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      setImportImage(base64);
    };
    reader.readAsDataURL(file);
    setImportResult(null);
    setImportError('');
    setImportSaved(false);
  }, []);

  const handleImportParse = useCallback(async () => {
    if (!importImage) { setImportError('Upload a day sheet image first.'); return; }
    setImportParsing(true);
    setImportError('');
    setImportResult(null);
    try {
      let cubeRooms = [];
      if (importCubeRaw && importDate) {
        try {
          const parsed = parseCubeData(importCubeRaw, importDate);
          cubeRooms = parsed.rooms || [];
        } catch {}
      }
      const result = await parseDaySheetWithVision(importImage, cubeRooms);
      // Always use user-specified date if provided
      if (importDate) result.date = importDate;
      setImportResult(result);
    } catch (e) {
      setImportError(`Parse failed: ${e.message}. Check image quality or try a clearer scan.`);
    }
    setImportParsing(false);
  }, [importImage, importCubeRaw, importDate]);

  const handleImportSave = useCallback(async () => {
    if (!importResult) return;
    setImportSaving(true);
    const record = {
      date: importResult.date || importDate || 'unknown',
      assignments: importResult.assignments || [],
      staffingNotes: importResult.staffingNotes || null,
      confidence: importResult.confidence || 'low',
      readabilityIssues: importResult.readabilityIssues || null,
      importedAt: new Date().toISOString(),
      hasCubeData: !!importCubeRaw,
    };
    const ok = await saveImportedDay(record);
    if (ok) {
      setImportSaved(true);
      const updated = await loadAllImportedDays();
      setImportedDays(updated);
      // Reset form for next upload
      setImportImage(null);
      setImportImageUrl(null);
      setImportCubeRaw('');
      setImportResult(null);
      setImportDate('');
    } else {
      setImportError('Save failed — storage unavailable.');
    }
    setImportSaving(false);
  }, [importResult, importDate, importCubeRaw]);

  const handleDeleteDay = useCallback(async (date) => {
    const ok = await deleteImportedDay(date);
    if (ok) {
      const updated = await loadAllImportedDays();
      setImportedDays(updated);
      if (importViewDay?.date === date) setImportViewDay(null);
    }
  }, [importViewDay]);

  const loadQG = useCallback(() => {
    const parsed = parseQGenda(qgRaw, selectedDate);
    if (!parsed) return;
    setQg(parsed);
    setQgLoaded(true);
    if (rooms.length) setRooms(buildAssignments(rooms, parsed));
  }, [qgRaw, rooms, selectedDate]);

  const [dateMismatch, setDateMismatch] = useState(false);
  const [careTeamResult, setCareTeamResult] = useState(null);
  const [showORCallPrompt, setShowORCallPrompt] = useState(false);
  const [orCallChoice, setOrCallChoice] = useState(null);
  const [pendingRooms, setPendingRooms] = useState(null);

  const [orCallWarning, setOrCallWarning] = useState('');
  const [resourceStructure, setResourceStructure] = useState({
    mainOR: '', endo: '', cath: '', boos: '', ir: ''
  });
  const [resourceLoaded, setResourceLoaded] = useState(false);
  const [resourceBypassed, setResourceBypassed] = useState(false);
  const [coverageGaps, setCoverageGaps] = useState([]);
  const [fractionalPairs, setFractionalPairs] = useState([]);

  const stepsUnlocked = resourceLoaded || resourceBypassed;

  const finishRef = useRef(null);

  const finishBuildingSchedule = useCallback((roomsIn, orChoice) => {
    const assigned = qg ? buildAssignments(roomsIn, qg, orChoice) : roomsIn;
    const history  = getAnesthetistLocationCounts();
    const ctResult = qg
      ? buildCareTeams(assigned, qg, history, resourceStructure, orChoice)
      : { rooms: assigned, careTeams: [], floats: [], available: [] };
    setRooms(ctResult.rooms);
    setCareTeamResult(ctResult);
    setOrCallChoice(orChoice);

    // ── Post-build OR Call validation ───────────────────────────
    // Catches choices that passed the prompt check but still failed
    // once the full scheduling logic ran (e.g. "Available" but rooms
    // went uncovered, or "Care Team" but no team slot was left).
    if (orChoice && qg?.ORCall) {
      const unassigned = (ctResult.rooms || []).filter(r => !r.assignedProvider && !r.isPhantom);
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
      setRoomPairs(buildPairsFromFractional(fractionalPairs, ctResult.rooms));
    }
  }, [qg, resourceStructure, fractionalPairs]);

  finishRef.current = finishBuildingSchedule;

  const loadSchedule = useCallback(() => {
    // Pass committed room counts from OR.endo.CCL:
    //  - Main OR: trims excess rooms if cube exceeds committed
    //  - Cath: generates Cath Lab Add-On phantom rooms if committed > cube visible
    // Undefined is passed for any value that is 0/empty (Step 1 bypassed etc.)
    const mainORCommitted = parseFloat(resourceStructure.mainOR) || 0;
    const cathCommitted   = parseFloat(resourceStructure.cath)   || 0;
    const parsed = parseCubeData(
      cubeRaw,
      selectedDate,
      mainORCommitted > 0 ? Math.ceil(mainORCommitted) : undefined,
      cathCommitted   > 0 ? Math.ceil(cathCommitted)   : undefined
    );
    setDateMismatch(selectedDate && parsed.totalParsed === 0);
    setPendingRooms(parsed.rooms);
    setSchedLoaded(true);
    if (qg?.ORCall && parsed.rooms.length > 0) {
      setShowORCallPrompt(true);
    } else {
      finishRef.current(parsed.rooms, null);
    }
  }, [cubeRaw, qg, selectedDate, resourceStructure.mainOR, resourceStructure.cath]);

  const handleORCallConfirm = useCallback((choice) => {
    setShowORCallPrompt(false);
    if (qg?.ORCall && selectedDate) saveORCallChoice(qg.ORCall, selectedDate, choice);
    finishRef.current(pendingRooms, choice);
  }, [qg, selectedDate, pendingRooms]);

  const handleORCallSkip = useCallback(() => {
    setShowORCallPrompt(false);
    finishRef.current(pendingRooms, null);
  }, [pendingRooms]);

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

  const updateAssignment = useCallback((roomName, provider) => {
    setRooms(prev => {
      const pairedRoom = roomPairs[roomName];
      return prev.map(r => {
        if (r.room === roomName) return { ...r, assignedProvider: provider };
        if (pairedRoom && r.room === pairedRoom) return { ...r, assignedProvider: provider };
        return r;
      });
    });
  }, [roomPairs]);

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
      const sourceRoom = prev.find(r => r.room === roomA);
      if (!sourceRoom?.assignedProvider) return prev;
      return prev.map(r => r.room === roomB ? { ...r, assignedProvider: sourceRoom.assignedProvider } : r);
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
            {importedDays.length > 0 && <span className="status-ok" style={{color:'#a78bfa'}}>📋 {importedDays.length} imported</span>}
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
          <div className="grid-3">
            <div>
              <div className="section-label">STEP 1 — OR.ENDO.CCL RESOURCE STRUCTURE</div>
              <div className="card">
                <div style={{marginBottom:'12px'}}>
                  <div style={{fontSize:'10px',color:'var(--accent-blue)',letterSpacing:'2px',marginBottom:'6px'}}>SELECT DATE TO BUILD</div>
                  <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
                    <input type="date" value={selectedDate}
                      onChange={e => {
                        setSelectedDate(e.target.value);
                        setSchedLoaded(false); setQgLoaded(false); setRooms([]); setQg(null);
                        setResourceLoaded(false); setResourceBypassed(false);
                        setCoverageGaps([]); setFractionalPairs([]); setRoomPairs({});
                      }}
                      style={{background:'var(--bg-base)',border:'1px solid var(--border-bright)',borderRadius:'var(--radius)',color:selectedDate?'var(--text-primary)':'var(--text-muted)',padding:'7px 12px',fontSize:'12px',fontFamily:'var(--font-mono)',cursor:'pointer',outline:'none'}}
                    />
                    {selectedDate && <span style={{fontSize:'11px',color:'var(--accent-blue)',fontWeight:'600'}}>{new Date(selectedDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</span>}
                  </div>
                  {!selectedDate && <div style={{fontSize:'10px',color:'var(--accent-amber)',marginTop:'5px'}}>⚠ Select a date first</div>}
                </div>
                <div className="card-hint">Enter today's row from the OR.Endo.CCL Resource Structure spreadsheet. Decimals allowed (e.g. 0.5). This is the source of truth for what we cover.</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'10px'}}>
                  {[{key:'mainOR',label:'MAIN OR'},{key:'endo',label:'ENDO'},{key:'cath',label:'CATH LAB'},{key:'boos',label:'BOOS (Ortho AS)'},{key:'ir',label:'IR'}].map(({ key, label }) => (
                    <div key={key}>
                      <div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'3px'}}>{label}</div>
                      <input type="number" min="0" max="15" step="0.5"
                        value={resourceStructure[key]}
                        onChange={e => setResourceStructure(prev => ({ ...prev, [key]: e.target.value }))}
                        placeholder="0" disabled={!selectedDate}
                        style={{width:'100%',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text-primary)',padding:'6px 10px',fontSize:'13px',fontFamily:'var(--font-mono)',outline:'none',textAlign:'center',opacity:selectedDate?1:0.5}}
                      />
                    </div>
                  ))}
                </div>
                <div style={{display:'flex',gap:'8px'}}>
                  <button className="btn" onClick={() => loadResourceStructure()} disabled={!selectedDate} style={{flex:1,opacity:selectedDate?1:0.5}}>CONFIRM COVERAGE</button>
                  <button onClick={() => { setResourceBypassed(true); setResourceLoaded(false); setCoverageGaps([]); setFractionalPairs([]); }} disabled={!selectedDate}
                    style={{background:'var(--bg-elevated)',color:'var(--text-muted)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'9px 14px',fontSize:'10px',fontFamily:'var(--font-mono)',cursor:'pointer',opacity:selectedDate?1:0.5}}>
                    BYPASS
                  </button>
                </div>
                {resourceBypassed && !resourceLoaded && (
                  <div className="flag-warn" style={{marginTop:'8px'}}>⚠ Coverage data bypassed — assignments will run without coverage ceiling. Steps 2 and 3 are now unlocked.</div>
                )}
              </div>
              {resourceLoaded && (
                <div style={{marginTop:'12px'}}>
                  {coverageGaps.length === 0 ? (
                    <div style={{background:'#0f2a1e',border:'1px solid #22c55e',borderRadius:'var(--radius)',padding:'10px 12px'}}>
                      <div style={{fontSize:'10px',color:'#4ade80',letterSpacing:'1px'}}>✓ COVERAGE COMPLETE</div>
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
                    const total = (parseFloat(resourceStructure.mainOR)||0)+(parseFloat(resourceStructure.endo)||0)+(parseFloat(resourceStructure.cath)||0)+(parseFloat(resourceStructure.boos)||0)+(parseFloat(resourceStructure.ir)||0);
                    const mds = qg?.workingMDs?.length||0;
                    const aas = qg?.Anesthetists?.filter(a=>!a.isAdmin&&!a.isOff).length||0;
                    return total>0?(
                      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'10px 12px',marginTop:'8px'}}>
                        <div style={{fontSize:'10px',color:'var(--accent-blue)',letterSpacing:'2px',marginBottom:'6px'}}>STAFFING SUMMARY</div>
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

            <div>
              <div className="section-label">STEP 2 — QGENDA EXPORT</div>
              <div className="card">
                {!stepsUnlocked && <div style={{fontSize:'10px',color:'var(--accent-amber)',marginBottom:'8px'}}>⚠ Confirm or bypass Step 1 first</div>}
                <textarea className="textarea" value={qgRaw} onChange={e=>setQgRaw(e.target.value)}
                  placeholder={"Paste full week QGenda Calendar By Task export...\n\nOR Call\tEskew, Gregory S\nBack Up Call\tSingh, Karampal\nLocum\tNielson, Mark\n..."}
                  disabled={!stepsUnlocked} style={{opacity:stepsUnlocked?1:0.4}} />
                <button className="btn" onClick={loadQG} style={{marginTop:'10px',opacity:stepsUnlocked?1:0.4}} disabled={!stepsUnlocked}>LOAD STAFFING</button>
              </div>
              {qgLoaded && qg && (
                <div style={{marginTop:'14px'}}>
                  <div className="section-label">WORKING TODAY</div>
                  {qg.aaBackupCall && (
                    <div style={{background:'#2a1a00',border:'1px solid #f59e0b',borderRadius:'var(--radius)',padding:'10px 12px',marginBottom:'10px'}}>
                      <div style={{fontSize:'10px',color:'#fbbf24',fontWeight:'600',letterSpacing:'1px',marginBottom:'4px'}}>⚠ AA BACKUP CALL DAY</div>
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
                            <div className="anest-shift" style={{color:a.isAdmin?'#475569':'#f9a8d4'}}>{a.isAdmin?'ADMIN — NOT IN OR':(ANESTHETIST_SHIFTS[`Anesthetist ${a.shift}`]?.label||a.shift)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <div className="section-label">STEP 3 — CUBE SCHEDULE (paste all data)</div>
              <div className="card">
                {!stepsUnlocked && <div style={{fontSize:'10px',color:'var(--accent-amber)',marginBottom:'8px'}}>⚠ Confirm or bypass Step 1 first</div>}
                <div className="card-hint">Paste the full SharePoint cube file. The parser will automatically filter to{' '}
                  {selectedDate ? <strong>{new Date(selectedDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'})}</strong> : <span style={{color:'var(--accent-amber)'}}>the date selected in Step 1</span>}.
                </div>
                <textarea className="textarea" value={cubeRaw} onChange={e=>setCubeRaw(e.target.value)}
                  placeholder={"Paste entire cube schedule here — all dates, all areas.\nDate is set from Step 1.\n\nBMH OR\n4/14/2026 7:30 AM\tBMHOR-2026-701\tBMH OR 10\t..."}
                  disabled={!stepsUnlocked} style={{opacity:stepsUnlocked?1:0.4}} />
                <button className="btn" onClick={loadSchedule} style={{marginTop:'10px',opacity:stepsUnlocked?1:0.4}} disabled={!stepsUnlocked}>LOAD SCHEDULE</button>
              </div>
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
              <div style={{background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'8px 14px',marginBottom:'12px',display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
                <span style={{fontSize:'10px',color:'var(--accent-blue)',letterSpacing:'1px',fontWeight:'600'}}>⇄ ROOM PAIRING</span>
                <span style={{fontSize:'10px',color:'var(--text-muted)'}}>Drag one card onto another to pair them. Paired rooms share one provider (morning → afternoon). Click ✕ on a badge to break a pair.</span>
                {pairCount > 0 && <button onClick={() => setRoomPairs({})} style={{marginLeft:'auto',background:'transparent',border:'1px solid #475569',borderRadius:'var(--radius-sm)',color:'#64748b',fontSize:'9px',padding:'3px 8px',cursor:'pointer',fontFamily:'var(--font-mono)',letterSpacing:'1px'}}>CLEAR ALL PAIRS</button>}
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
                        <div style={{fontSize:'10px',color:'#ec4899',fontWeight:'600',letterSpacing:'1px',marginBottom:'5px'}}>AVAILABLE ANESTHETISTS</div>
                        {unusedAnests.map(a => <div key={a.name} style={{fontSize:'11px',color:'var(--text-secondary)',marginBottom:'2px'}}>{a.name.split(',')[0]}</div>)}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
            {orCallWarning && (
              <div style={{background:'#2a0f00',border:'1px solid #f97316',borderRadius:'var(--radius)',padding:'10px 14px',marginBottom:'12px',fontSize:'11px',color:'#fb923c',lineHeight:'1.6'}}>
                {orCallWarning}
              </div>
            )}
            {critFlags.length>0 && <div style={{marginBottom:'12px'}}>{critFlags.map((f,i)=><div key={i} className="flag-crit">⚠ {f.room}: {f.msg}</div>)}</div>}
            {schedLoaded && rooms.length > 0 && selectedDate && (
              <div style={{marginBottom:'12px'}}>
                <button className="btn" style={{fontSize:'9px',padding:'6px 14px',background:'var(--bg-elevated)',color:'var(--accent-green)',border:'1px solid var(--accent-green)'}}
                  onClick={() => { saveFullDayHistory(selectedDate, rooms.filter(r=>!r.isPhantom)); alert('Assignments saved to history.'); }}>
                  SAVE TO HISTORY
                </button>
              </div>
            )}
            <div className="room-grid">
              {rooms.map(room => {
                const ac = ACUITY_COLORS[room.acuity]||'#475569';
                const conflict = room.assignedProvider && room.avoidProviders?.includes(room.assignedProvider);
                const isExp = expanded === `room-${room.room}`;
                const ctColor = room.isCareTeam && room.careTeamId !== undefined ? CARE_TEAM_COLORS[room.careTeamId % CARE_TEAM_COLORS.length] : null;
                const pairedWith = roomPairs[room.room];
                const isDragOver = dragOverRoom === room.room && dragSourceRoom !== room.room;
                const isDragging = dragSourceRoom === room.room;

                if (room.isPhantom) {
                  const phantomCtColor = CARE_TEAM_COLORS[0];
                  return (
                    <div key={room.room} className="card room-card" style={{borderLeft:`3px solid ${phantomCtColor.border}`,borderColor:phantomCtColor.border,background:phantomCtColor.bg,opacity:0.9}}>
                      {room.careTeamLabel && <div style={{fontSize:'9px',color:phantomCtColor.text,letterSpacing:'1px',marginBottom:'5px',fontWeight:'600'}}>{room.careTeamLabel}</div>}
                      <div className="room-header"><span className="room-name" style={{color:phantomCtColor.text}}>{room.room}</span><span style={{fontSize:'9px',color:phantomCtColor.border,letterSpacing:'1px',fontWeight:'700'}}>ADD-ON SLOT</span></div>
                      <div style={{fontSize:'10px',color:'var(--text-secondary)',marginTop:'4px',fontStyle:'italic'}}>No cases booked — add-on slot</div>
                      <div style={{marginTop:'8px'}}><div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'3px'}}>ANESTHETIST</div><div style={{background:'var(--bg-base)',border:`1px solid ${phantomCtColor.border}`,borderRadius:'var(--radius-sm)',padding:'5px 8px',fontSize:'11px',color:phantomCtColor.text}}>{room.anesthetist || '—'}</div></div>
                    </div>
                  );
                }

                return (
                  <div key={room.room} className="card room-card" draggable
                    onDragStart={e => handleDragStart(e, room.room)} onDragOver={e => handleDragOver(e, room.room)}
                    onDragLeave={handleDragLeave} onDrop={e => handleDrop(e, room.room)} onDragEnd={handleDragEnd}
                    style={{borderLeft:`3px solid ${pairedWith?'#06b6d4':ctColor?ctColor.border:ac}`,borderColor:isDragOver?'#06b6d4':conflict?'#ef4444':pairedWith?'#06b6d4':ctColor?ctColor.border:'var(--border)',background:isDragOver?'#0a1f2a':isDragging?'var(--bg-elevated)':ctColor?ctColor.bg:'var(--bg-surface)',outline:isDragOver?'2px dashed #06b6d4':'none',opacity:isDragging?0.6:1,cursor:'grab',transition:'border-color 0.15s, background 0.15s, outline 0.15s'}}
                    onClick={() => setExpanded(isExp ? null : `room-${room.room}`)}>
                    {pairedWith && (
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'5px'}}>
                        <div style={{display:'inline-flex',alignItems:'center',gap:'5px',background:'#0c2030',border:'1px solid #06b6d4',borderRadius:'var(--radius-sm)',padding:'2px 7px'}}>
                          <span style={{fontSize:'9px',color:'#06b6d4',fontWeight:'700',letterSpacing:'1px'}}>⇄ PAIRED</span>
                          <span style={{fontSize:'9px',color:'#67e8f9'}}>→ {pairedWith}</span>
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
                        value={room.assignedProvider||''} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();updateAssignment(room.room,e.target.value);}}>
                        <option value="">— Unassigned —</option>
                        {qg?.workingMDs?.map(p=>(<option key={p.name} value={p.name}>{room.preferredProviders?.includes(p.name)?'★ ':room.avoidProviders?.includes(p.name)?'⚠ ':''}{p.name} ({p.role})</option>))}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'3px'}}>ANESTHETIST</div>
                      <div style={{background:'var(--bg-base)',border:`1px solid ${ctColor?ctColor.border:'var(--border)'}`,borderRadius:'var(--radius-sm)',padding:'5px 8px',fontSize:'11px',color:room.anesthetist?(ctColor?ctColor.text:'var(--text-primary)'):'var(--text-faint)',fontStyle:room.anesthetist?'normal':'italic'}}>{room.anesthetist || 'NONE'}</div>
                    </div>
                    {conflict && <div className="flag-crit" style={{marginTop:'6px'}}>⚠ Conflict — {room.assignedProvider} flagged for this room</div>}
                    {room.cardiacNote && <div className="flag-info" style={{marginTop:'6px'}}>{room.cardiacNote}</div>}
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
              <span style={{color:'#ef4444'}}>■</span> Always &nbsp;<span style={{color:'#f97316'}}>■</span> Usually &nbsp;<span style={{color:'#60a5fa'}}>■</span> Specific cases &nbsp;<span style={{color:'#eab308'}}>■</span> Confirm day-of &nbsp;<span style={{color:'#22c55e'}}>■</span> Never &nbsp;<span style={{color:'#94a3b8'}}>■</span> If offered/appropriate
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

        {/* ── IMPORT HISTORY ── */}
        {tab === 'import' && (
          <div>
            <div style={{display:'flex',alignItems:'baseline',gap:'12px',marginBottom:'4px'}}>
              <div className="section-label" style={{margin:0}}>IMPORT HISTORY — DAY SHEET UPLOAD</div>
              {importedDays.length > 0 && <span style={{fontSize:'10px',color:'#a78bfa',letterSpacing:'1px'}}>{importedDays.length} RECORDS STORED</span>}
            </div>
            <div className="card-hint" style={{marginBottom:'20px'}}>
              Upload scanned day sheets to build a historical training dataset. Claude vision reads the handwritten grid and extracts assignments.
              Optionally paste cube data for the same date to enrich the record with case types and acuity.
            </div>

            {!storageAvailable && (
              <div className="flag-warn" style={{marginBottom:'16px'}}>⚠ Persistent storage unavailable in this environment. Records will not persist across sessions.</div>
            )}

            <div className="grid-2" style={{gap:'24px',alignItems:'start',marginBottom:'28px'}}>

              {/* ── LEFT: UPLOAD FORM ── */}
              <div>
                <div className="section-label" style={{color:'var(--accent-blue)'}}>STEP 1 — UPLOAD &amp; CONFIGURE</div>

                <div className="card" style={{marginBottom:'10px'}}>
                  <div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'6px'}}>DATE OF THIS DAY SHEET</div>
                  <input type="date" value={importDate} onChange={e=>{setImportDate(e.target.value);setImportSaved(false);setImportResult(null);}}
                    style={{background:'var(--bg-base)',border:'1px solid var(--border-bright)',borderRadius:'var(--radius)',color:importDate?'var(--text-primary)':'var(--text-muted)',padding:'7px 12px',fontSize:'12px',fontFamily:'var(--font-mono)',cursor:'pointer',outline:'none',width:'100%',boxSizing:'border-box'}}
                  />
                  {!importDate && <div style={{fontSize:'9px',color:'var(--accent-amber)',marginTop:'4px'}}>⚠ Specify the date so it can be stored correctly</div>}
                </div>

                <div className="card" style={{marginBottom:'10px'}}>
                  <div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'8px'}}>SCANNED DAY SHEET IMAGE</div>
                  <div style={{fontSize:'10px',color:'var(--text-secondary)',marginBottom:'8px'}}>JPG or PNG. Best results with a flat, well-lit scan. Handwriting doesn't need to be perfect.</div>
                  <input type="file" accept="image/jpeg,image/png,image/jpg" onChange={handleImageUpload}
                    style={{display:'block',width:'100%',fontSize:'11px',color:'var(--text-secondary)',fontFamily:'var(--font-mono)',cursor:'pointer'}}
                  />
                  {importImageUrl && (
                    <div style={{marginTop:'10px',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden',background:'#0a0a0a'}}>
                      <img src={importImageUrl} alt="Day sheet preview"
                        style={{width:'100%',display:'block',maxHeight:'280px',objectFit:'contain'}} />
                    </div>
                  )}
                </div>

                <div className="card" style={{marginBottom:'14px'}}>
                  <div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'4px'}}>CUBE DATA FOR THIS DATE <span style={{color:'var(--text-faint)',fontWeight:'normal',letterSpacing:'0'}}>— OPTIONAL</span></div>
                  <div style={{fontSize:'10px',color:'var(--text-secondary)',marginBottom:'8px'}}>
                    Enriches the record with case types and acuity. Paste the same cube data you'd use in Step 3 on the Daily Board — the parser will filter to the date above.
                  </div>
                  <textarea className="textarea" value={importCubeRaw} onChange={e=>setImportCubeRaw(e.target.value)}
                    placeholder="Paste cube schedule for this date (optional)..." style={{height:'90px'}} />
                </div>

                <button className="btn" onClick={handleImportParse}
                  disabled={!importImage || importParsing}
                  style={{width:'100%',opacity:importImage&&!importParsing?1:0.45,background:importParsing?'var(--bg-elevated)':'var(--accent-blue)',color:importParsing?'var(--text-muted)':'#fff',borderColor:importParsing?'var(--border)':'var(--accent-blue)'}}>
                  {importParsing
                    ? <span style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'8px'}}><span style={{fontSize:'12px'}}>●</span> READING HANDWRITING...</span>
                    : 'PARSE WITH CLAUDE VISION'}
                </button>
                {importError && <div className="flag-crit" style={{marginTop:'10px'}}>{importError}</div>}
              </div>

              {/* ── RIGHT: RESULT ── */}
              <div>
                <div className="section-label" style={{color:'var(--accent-blue)'}}>STEP 2 — REVIEW &amp; SAVE</div>

                {!importResult && !importParsing && (
                  <div style={{color:'var(--text-muted)',fontSize:'11px',fontStyle:'italic',paddingTop:'12px'}}>
                    Upload a day sheet and click "Parse" to extract assignments.
                  </div>
                )}

                {importParsing && (
                  <div style={{padding:'20px 0',display:'flex',flexDirection:'column',gap:'8px',alignItems:'flex-start'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'10px',color:'var(--accent-blue)',fontSize:'11px'}}>
                      <span style={{fontSize:'16px',lineHeight:1}}>●</span>
                      <span>Sending image to Claude vision...</span>
                    </div>
                    <div style={{fontSize:'10px',color:'var(--text-muted)',paddingLeft:'26px'}}>This takes 5–15 seconds depending on image complexity.</div>
                  </div>
                )}

                {importSaved && !importResult && (
                  <div style={{background:'#0f2a1e',border:'1px solid #22c55e',borderRadius:'var(--radius)',padding:'14px 16px',marginTop:'8px'}}>
                    <div style={{fontSize:'11px',color:'#4ade80',fontWeight:'600',letterSpacing:'1px',marginBottom:'4px'}}>✓ SAVED TO DATABASE</div>
                    <div style={{fontSize:'10px',color:'var(--text-secondary)'}}>Ready for the next upload. The record appears below in the history list.</div>
                  </div>
                )}

                {importResult && (
                  <div>
                    {/* Header row: date + confidence + count */}
                    <div style={{display:'flex',gap:'8px',marginBottom:'12px',flexWrap:'wrap'}}>
                      <div style={{background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'6px 12px'}}>
                        <div style={{fontSize:'8px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'2px'}}>DATE</div>
                        <div style={{fontSize:'11px',color:'var(--text-primary)',fontFamily:'var(--font-mono)'}}>{importResult.date || importDate || 'Unknown'}</div>
                      </div>
                      <div style={{background:CONF_BG[importResult.confidence]||'var(--bg-elevated)',border:`1px solid ${CONF_COLORS[importResult.confidence]||'#475569'}`,borderRadius:'var(--radius)',padding:'6px 12px'}}>
                        <div style={{fontSize:'8px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'2px'}}>CONFIDENCE</div>
                        <div style={{fontSize:'11px',color:CONF_COLORS[importResult.confidence]||'#94a3b8',fontWeight:'600',textTransform:'uppercase',fontFamily:'var(--font-mono)'}}>{importResult.confidence}</div>
                      </div>
                      <div style={{background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'6px 12px'}}>
                        <div style={{fontSize:'8px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'2px'}}>ASSIGNMENTS</div>
                        <div style={{fontSize:'11px',color:'var(--text-primary)',fontFamily:'var(--font-mono)'}}>{importResult.assignments?.length || 0}</div>
                      </div>
                    </div>

                    {importResult.readabilityIssues && (
                      <div className="flag-warn" style={{marginBottom:'10px'}}>
                        <span style={{fontWeight:'600',letterSpacing:'1px',fontSize:'9px'}}>READABILITY NOTE </span>{importResult.readabilityIssues}
                      </div>
                    )}

                    {/* Assignment table */}
                    <div style={{marginBottom:'14px',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:'10px',fontFamily:'var(--font-mono)'}}>
                        <thead>
                          <tr style={{background:'var(--bg-elevated)'}}>
                            {['ROOM','MD','ANEST','ROLE'].map(h=>(
                              <th key={h} style={{padding:'6px 10px',textAlign:'left',color:'var(--text-muted)',letterSpacing:'1px',fontWeight:'600',fontSize:'9px',borderBottom:'1px solid var(--border)'}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(importResult.assignments || []).map((a, i) => (
                            <tr key={i} style={{borderBottom:'1px solid var(--border)',background:i%2===0?'var(--bg-surface)':'var(--bg-base)'}}>
                              <td style={{padding:'5px 10px',color:'var(--text-primary)',fontWeight:'500'}}>{a.room}</td>
                              <td style={{padding:'5px 10px',color:'#60a5fa'}}>{a.md || '—'}</td>
                              <td style={{padding:'5px 10px',color:'#f9a8d4'}}>{a.anesthetist || '—'}</td>
                              <td style={{padding:'5px 10px',color:'var(--text-muted)'}}>
                                {a.callRole || (a.careTeam ? 'Care Team' : '—')}
                              </td>
                            </tr>
                          ))}
                          {(!importResult.assignments || importResult.assignments.length === 0) && (
                            <tr><td colSpan={4} style={{padding:'12px 10px',color:'var(--text-muted)',fontStyle:'italic',textAlign:'center'}}>No assignments extracted</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {importResult.staffingNotes && (
                      <div className="flag-info" style={{marginBottom:'12px'}}>
                        <span style={{fontWeight:'600',fontSize:'9px',letterSpacing:'1px'}}>STAFFING NOTE </span>{importResult.staffingNotes}
                      </div>
                    )}

                    {importResult.confidence === 'low' && (
                      <div className="flag-warn" style={{marginBottom:'12px'}}>
                        Low confidence read. Review the table above carefully before saving — consider rescanning with better lighting or higher resolution.
                      </div>
                    )}

                    {importSaved ? (
                      <div style={{background:'#0f2a1e',border:'1px solid #22c55e',borderRadius:'var(--radius)',padding:'10px 14px',color:'#4ade80',fontSize:'11px',letterSpacing:'1px'}}>
                        ✓ SAVED — visible in the history list below
                      </div>
                    ) : (
                      <button className="btn" onClick={handleImportSave} disabled={importSaving||!importResult.assignments?.length}
                        style={{width:'100%',background:'linear-gradient(135deg,#1d4ed8,#6d28d9)',opacity:importSaving||!importResult.assignments?.length?0.5:1}}>
                        {importSaving ? 'SAVING...' : 'SAVE TO HISTORY DATABASE'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── STORED DAYS ── */}
            <div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'10px'}}>
                <div className="section-label" style={{margin:0}}>STORED RECORDS — {importedDays.length} DAYS</div>
                {importedDays.length > 0 && (
                  <span style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px'}}>CLICK TO EXPAND · ✕ TO DELETE</span>
                )}
              </div>

              {importedDays.length === 0 ? (
                <div style={{color:'var(--text-muted)',fontSize:'11px',fontStyle:'italic',padding:'12px 0'}}>
                  No days imported yet. Upload a scanned day sheet above to begin building the dataset.
                </div>
              ) : (
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:'8px'}}>
                  {importedDays.map(day => {
                    const isViewing = importViewDay?.date === day.date;
                    const confColor = CONF_COLORS[day.confidence] || '#475569';
                    const dateLabel = day.date !== 'unknown'
                      ? (() => { try { return new Date(day.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'}); } catch { return day.date; } })()
                      : 'Unknown date';

                    return (
                      <div key={day.date} className="card"
                        style={{cursor:'pointer',border:`1px solid ${isViewing?'var(--accent-blue)':'var(--border)'}`,background:isViewing?'var(--bg-elevated)':'var(--bg-surface)',transition:'border-color 0.15s'}}
                        onClick={() => setImportViewDay(isViewing ? null : day)}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'8px'}}>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:'12px',color:'var(--text-primary)',fontWeight:'600',fontFamily:'var(--font-mono)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{dateLabel}</div>
                            <div style={{display:'flex',gap:'8px',marginTop:'4px',flexWrap:'wrap'}}>
                              <span style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px'}}>{day.assignments?.length || 0} rooms</span>
                              {day.hasCubeData && <span style={{fontSize:'9px',color:'var(--accent-teal)',letterSpacing:'1px'}}>+CUBE</span>}
                              <span style={{fontSize:'9px',color:confColor,letterSpacing:'1px',textTransform:'uppercase'}}>{day.confidence}</span>
                            </div>
                          </div>
                          <button onClick={e=>{e.stopPropagation();handleDeleteDay(day.date);}}
                            style={{background:'transparent',border:'none',color:'#374151',cursor:'pointer',fontSize:'14px',padding:'0',lineHeight:1,flexShrink:0,marginTop:'1px'}}
                            title="Delete record">✕</button>
                        </div>

                        {isViewing && (
                          <div style={{marginTop:'12px',paddingTop:'10px',borderTop:'1px solid var(--border)'}}>
                            {day.assignments?.map((a, i) => (
                              <div key={i} style={{display:'grid',gridTemplateColumns:'55px 1fr 1fr',gap:'6px',fontSize:'10px',fontFamily:'var(--font-mono)',marginBottom:'4px',alignItems:'baseline'}}>
                                <span style={{color:'var(--text-muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.room}</span>
                                <span style={{color:'#60a5fa',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.md || '—'}</span>
                                <span style={{color:'#f9a8d4',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.anesthetist || '—'}</span>
                              </div>
                            ))}
                            {day.staffingNotes && (
                              <div style={{fontSize:'10px',color:'var(--text-secondary)',marginTop:'8px',fontStyle:'italic',borderTop:'1px solid var(--border)',paddingTop:'6px'}}>{day.staffingNotes}</div>
                            )}
                            {day.readabilityIssues && (
                              <div style={{fontSize:'9px',color:'var(--accent-amber)',marginTop:'6px'}}>⚠ {day.readabilityIssues}</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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
