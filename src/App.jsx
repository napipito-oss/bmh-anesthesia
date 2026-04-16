import { useState, useCallback, useEffect } from 'react';
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

// ── CONSTANTS ────────────────────────────────────────────────
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
  { id: 'board', label: 'DAILY BOARD' },
  { id: 'assign', label: 'ASSIGNMENTS' },
  { id: 'handoff', label: '2PM HANDOFF' },
  { id: 'providers', label: 'PROVIDER INTEL' },
  { id: 'surgeons', label: 'SURGEON DB' },
  { id: 'history', label: 'HISTORY' },
  { id: 'ai', label: 'AI ASSISTANT' },
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

  // OR.Endo.CCL Resource Structure — Step 1 (now first)
  const [resourceStructure, setResourceStructure] = useState({
    mainOR: '', endo: '', cath: '', boos: '', ir: ''
  });
  const [resourceLoaded, setResourceLoaded] = useState(false);
  const [resourceBypassed, setResourceBypassed] = useState(false);
  const [coverageGaps, setCoverageGaps] = useState([]);
  const [fractionalPairs, setFractionalPairs] = useState([]);

  // Steps 2+3 (QGenda + cube) are locked until resource step is confirmed or bypassed
  const stepsUnlocked = resourceLoaded || resourceBypassed;

  // Load anesthetist history on mount
  useEffect(() => {
    // History loaded lazily when needed by care team engine
  }, []);

  const loadSchedule = useCallback(() => {
    const parsed = parseCubeData(cubeRaw, selectedDate);
    setDateMismatch(selectedDate && parsed.totalParsed === 0);
    // Store parsed rooms and show OR Call prompt before building care teams
    setPendingRooms(parsed.rooms);
    setSchedLoaded(true);
    if (qg?.ORCall && parsed.rooms.length > 0) {
      setShowORCallPrompt(true);
    } else {
      finishBuildingSchedule(parsed.rooms, null);
    }
  }, [cubeRaw, qg, selectedDate]);

  const finishBuildingSchedule = useCallback((roomsIn, orChoice) => {
    const assigned = qg ? buildAssignments(roomsIn, qg, orChoice) : roomsIn;
    const history = getAnesthetistLocationCounts();
    const ctResult = qg ? buildCareTeams(assigned, qg, history) : { rooms: assigned, careTeams: [], floats: [], available: [] };
    setRooms(ctResult.rooms);
    setCareTeamResult(ctResult);
    setOrCallChoice(orChoice);
  }, [qg]);

  const handleORCallConfirm = useCallback((choice) => {
    setShowORCallPrompt(false);
    if (qg?.ORCall && selectedDate) {
      saveORCallChoice(qg.ORCall, selectedDate, choice);
    }
    finishBuildingSchedule(pendingRooms, choice);
  }, [qg, selectedDate, pendingRooms, finishBuildingSchedule]);

  const handleORCallSkip = useCallback(() => {
    setShowORCallPrompt(false);
    finishBuildingSchedule(pendingRooms, null);
  }, [pendingRooms, finishBuildingSchedule]);

  const loadResourceStructure = useCallback((currentRooms) => {
    const rs = resourceStructure;
    const mainOR = parseFloat(rs.mainOR) || 0;
    const endo = parseFloat(rs.endo) || 0;
    const cath = parseFloat(rs.cath) || 0;
    const boos = parseFloat(rs.boos) || 0;
    const ir = parseFloat(rs.ir) || 0;
    const roomsToAnalyze = currentRooms || rooms;
    const gaps = [];
    const pairs = [];

    const cubeEndo = roomsToAnalyze.filter(r => r.isEndo).length;
    const cubeCath = roomsToAnalyze.filter(r => r.isCathEP).length;
    const cubeBOOS = roomsToAnalyze.filter(r => r.isBOOS).length;
    const cubeIR = roomsToAnalyze.filter(r => (r.room||'').toLowerCase().includes('rir') || (r.room||'').toLowerCase().includes('ir ')).length;
    const cubeMainOR = roomsToAnalyze.filter(r =>
      !r.isEndo && !r.isCathEP && !r.isBOOS &&
      !(r.room||'').toLowerCase().includes('rir') &&
      !(r.room||'').toLowerCase().includes('ir ')
    ).length;

    // Detect fractional room pairs
    const fractions = [];
    if (ir % 1 !== 0 && ir > 0) fractions.push({ area:'IR', frac: ir % 1 });
    if (mainOR % 1 !== 0 && mainOR > 0) fractions.push({ area:'MAIN OR', frac: mainOR % 1 });
    if (endo % 1 !== 0 && endo > 0) fractions.push({ area:'ENDO', frac: endo % 1 });
    if (cath % 1 !== 0 && cath > 0) fractions.push({ area:'CATH', frac: cath % 1 });
    if (boos % 1 !== 0 && boos > 0) fractions.push({ area:'BOOS', frac: boos % 1 });

    // Pair fractional locations — morning (IR/BOOS) + afternoon (main OR)
    const fracOrder = { 'IR':0,'BOOS':1,'CATH':2,'ENDO':3,'MAIN OR':4 };
    const sortedFracs = [...fractions].sort((a,b) => (fracOrder[a.area]||5)-(fracOrder[b.area]||5));
    for (let i = 0; i+1 < sortedFracs.length; i += 2) {
      pairs.push({
        morning: sortedFracs[i].area,
        afternoon: sortedFracs[i+1].area,
        label: `${sortedFracs[i].area} → ${sortedFracs[i+1].area}`,
        autoDetected: true,
        overrideRoom: null,
      });
      gaps.push({ area:'COMBINED', needed:1, booked:1, gap:0, level:'info',
        msg:`Combined resource: ${sortedFracs[i].area} (morning) → ${sortedFracs[i+1].area} (afternoon) — one provider covers both. Can be adjusted in Assignments.` });
    }

    const endoNeeded = Math.ceil(endo);
    const cathNeeded = Math.ceil(cath);
    const mainORNeeded = Math.ceil(mainOR);
    const boosNeeded = Math.ceil(boos);
    const irNeeded = Math.ceil(ir);

    if (endoNeeded > 0 && cubeEndo < endoNeeded) {
      const gap = endoNeeded - cubeEndo;
      gaps.push({ area:'ENDO', needed:endoNeeded, booked:cubeEndo, gap, level:'warn',
        msg:`Endo: ${endo} rooms committed, ${cubeEndo} booked → ${gap} unstaffed. Staff for inpatient add-ons.` });
    }
    if (cathNeeded > 0 && cubeCath < cathNeeded) {
      const gap = cathNeeded - cubeCath;
      gaps.push({ area:'CATH', needed:cathNeeded, booked:cubeCath, gap, level:'warn',
        msg:`Cath Lab: ${cath} slots committed, ${cubeCath} booked → ${gap} slot(s) for TEE/cardioversion/cath minor.` });
    }
    if (mainORNeeded > 0 && cubeMainOR < mainORNeeded) {
      const gap = mainORNeeded - cubeMainOR;
      gaps.push({ area:'MAIN OR', needed:mainORNeeded, booked:cubeMainOR, gap,
        level: gap > 1 ? 'critical' : 'warn',
        msg:`Main OR: ${mainOR} rooms committed, ${cubeMainOR} booked → ${gap} unbooked.${gap===1?' Includes add-on room — staff even with no cases.':' Includes add-on room + possible open heart coverage (OR 5).'}` });
    }
    if (boosNeeded > 0 && cubeBOOS < boosNeeded) {
      gaps.push({ area:'BOOS', needed:boosNeeded, booked:cubeBOOS, gap:boosNeeded-cubeBOOS, level:'info',
        msg:`BOOS: ${boos} rooms committed, ${cubeBOOS} booked → staff for add-ons.` });
    }
    if (irNeeded > 0 && cubeIR < irNeeded) {
      gaps.push({ area:'IR', needed:irNeeded, booked:cubeIR, gap:irNeeded-cubeIR, level:'info',
        msg:`IR: ${ir} slot committed, ${cubeIR} booked → keep IR-capable provider available.` });
    }
    if (cath > 0 && cubeCath === 1 && cathNeeded >= 2) {
      gaps.push({ area:'CATH', needed:cathNeeded, booked:cubeCath, gap:0, level:'info',
        msg:`Cath Lab light today — consider pulling cath minor resource to main OR if short-staffed.` });
    }

    setFractionalPairs(pairs);
    setCoverageGaps(gaps);
    setResourceLoaded(true);
  }, [resourceStructure, rooms]);

  const updateAssignment = useCallback((room, provider) => {
    setRooms(prev => prev.map(r => r.room === room ? { ...r, assignedProvider: provider } : r));
  }, []);

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

  return (
    <div className="app">
      {/* ── HEADER ── */}
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
            <span className={qgLoaded ? 'status-ok' : 'status-off'}>● QGenda {qgLoaded ? '✓' : '—'}</span>
            <span className={schedLoaded ? 'status-ok' : 'status-off'}>● Schedule {schedLoaded ? '✓' : '—'}</span>
            <span className={resourceLoaded ? 'status-ok' : 'status-off'}>● Resource {resourceLoaded ? '✓' : '—'}</span>
            {qg?.aaBackupCall && <span className="status-crit">⚠ AA Backup Call</span>}
            {coverageGaps.filter(g=>g.level==='critical').length > 0 && <span className="status-crit">⚠ {coverageGaps.filter(g=>g.level==='critical').length} gap{coverageGaps.filter(g=>g.level==='critical').length>1?'s':''}</span>}
            {critFlags.length > 0 && <span className="status-crit">⚠ {critFlags.length} critical</span>}
          </div>
        </div>
      </header>

      {/* ── TABS ── */}
      <nav className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={`tab ${tab===t.id?'tab-active':''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {/* ── BODY ── */}
      <main className="body">

        {/* DAILY BOARD */}
        {tab === 'board' && (
          <div className="grid-3">

            {/* ── STEP 1: OR.ENDO.CCL RESOURCE STRUCTURE ── */}
            <div>
              <div className="section-label">STEP 1 — OR.ENDO.CCL RESOURCE STRUCTURE</div>
              <div className="card">
                {/* Date picker lives here — drives everything */}
                <div style={{marginBottom:'12px'}}>
                  <div style={{fontSize:'10px',color:'var(--accent-blue)',letterSpacing:'2px',marginBottom:'6px'}}>SELECT DATE TO BUILD</div>
                  <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={e => {
                        setSelectedDate(e.target.value);
                        setSchedLoaded(false);
                        setQgLoaded(false);
                        setRooms([]);
                        setQg(null);
                        setResourceLoaded(false);
                        setResourceBypassed(false);
                        setCoverageGaps([]);
                        setFractionalPairs([]);
                      }}
                      style={{background:'var(--bg-base)',border:'1px solid var(--border-bright)',borderRadius:'var(--radius)',color:selectedDate?'var(--text-primary)':'var(--text-muted)',padding:'7px 12px',fontSize:'12px',fontFamily:'var(--font-mono)',cursor:'pointer',outline:'none'}}
                    />
                    {selectedDate && <span style={{fontSize:'11px',color:'var(--accent-blue)',fontWeight:'600'}}>{new Date(selectedDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</span>}
                  </div>
                  {!selectedDate && <div style={{fontSize:'10px',color:'var(--accent-amber)',marginTop:'5px'}}>⚠ Select a date first</div>}
                </div>

                <div className="card-hint">
                  Enter today's row from the OR.Endo.CCL Resource Structure spreadsheet. Decimals allowed (e.g. 0.5). This is the source of truth for what we cover.
                </div>

                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'10px'}}>
                  {[
                    { key:'mainOR', label:'MAIN OR' },
                    { key:'endo',   label:'ENDO' },
                    { key:'cath',   label:'CATH LAB' },
                    { key:'boos',   label:'BOOS (Ortho AS)' },
                    { key:'ir',     label:'IR' },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'3px'}}>{label}</div>
                      <input
                        type="number" min="0" max="15" step="0.5"
                        value={resourceStructure[key]}
                        onChange={e => setResourceStructure(prev => ({ ...prev, [key]: e.target.value }))}
                        placeholder="0"
                        disabled={!selectedDate}
                        style={{width:'100%',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text-primary)',padding:'6px 10px',fontSize:'13px',fontFamily:'var(--font-mono)',outline:'none',textAlign:'center',opacity:selectedDate?1:0.5}}
                      />
                    </div>
                  ))}
                </div>

                <div style={{display:'flex',gap:'8px'}}>
                  <button
                    className="btn"
                    onClick={() => loadResourceStructure()}
                    disabled={!selectedDate}
                    style={{flex:1,opacity:selectedDate?1:0.5}}
                  >
                    CONFIRM COVERAGE
                  </button>
                  <button
                    onClick={() => { setResourceBypassed(true); setResourceLoaded(false); setCoverageGaps([]); setFractionalPairs([]); }}
                    disabled={!selectedDate}
                    style={{background:'var(--bg-elevated)',color:'var(--text-muted)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'9px 14px',fontSize:'10px',fontFamily:'var(--font-mono)',cursor:'pointer',opacity:selectedDate?1:0.5}}
                  >
                    BYPASS
                  </button>
                </div>

                {resourceBypassed && !resourceLoaded && (
                  <div className="flag-warn" style={{marginTop:'8px'}}>⚠ Coverage data bypassed — assignments will run without coverage ceiling. Steps 2 and 3 are now unlocked.</div>
                )}
              </div>

              {/* Coverage gap results */}
              {resourceLoaded && (
                <div style={{marginTop:'12px'}}>
                  {coverageGaps.length === 0 ? (
                    <div style={{background:'#0f2a1e',border:'1px solid #22c55e',borderRadius:'var(--radius)',padding:'10px 12px'}}>
                      <div style={{fontSize:'10px',color:'#4ade80',letterSpacing:'1px'}}>✓ COVERAGE COMPLETE</div>
                      <div style={{fontSize:'11px',color:'var(--text-secondary)',marginTop:'3px'}}>All committed rooms have cases booked.</div>
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

            {/* ── STEP 2: QGENDA EXPORT ── */}
            <div>
              <div className="section-label">STEP 2 — QGENDA EXPORT</div>
              <div className="card">
                {!stepsUnlocked && (
                  <div style={{fontSize:'10px',color:'var(--accent-amber)',marginBottom:'8px'}}>⚠ Confirm or bypass Step 1 first</div>
                )}
                <textarea className="textarea" value={qgRaw} onChange={e=>setQgRaw(e.target.value)}
                  placeholder={"Paste full week QGenda Calendar By Task export...\n\nOR Call\tEskew, Gregory S\nBack Up Call\tSingh, Karampal\nLocum\tNielson, Mark\n..."}
                  disabled={!stepsUnlocked}
                  style={{opacity:stepsUnlocked?1:0.4}}
                />
                <button className="btn" onClick={loadQG} style={{marginTop:'10px',opacity:stepsUnlocked?1:0.4}} disabled={!stepsUnlocked}>
                  LOAD STAFFING
                </button>
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
                    const prof = PROVIDERS[p.name];
                    return (
                      <div key={p.name} className="card provider-card"
                        style={{borderLeft:`3px solid ${ROLE_COLORS[p.role]||'#475569'}`,marginBottom:'5px'}}
                        onClick={()=>setExpanded(isExp?null:`md-${p.name}`)}>
                        <div className="provider-row">
                          <div>
                            <span className="provider-name">{p.name}</span>
                            <span className="provider-role" style={{color:ROLE_COLORS[p.role]||'#64748b'}}>{p.role}</span>
                          </div>
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
                      <div className="chip-row">
                        {qg.notAvailable.map(p=>(
                          <div key={p.name} className="chip chip-muted">{p.name} — {p.reason}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {qg.Anesthetists?.filter(a=>!a.isOff).length > 0 && (
                    <div style={{marginTop:'10px'}}>
                      <div className="section-label">ANESTHETISTS</div>
                      <div className="grid-2-sm">
                        {qg.Anesthetists.filter(a=>!a.isOff).map(a=>(
                          <div key={a.name} className="card anest-card"
                            style={{borderLeft:`3px solid ${a.isAdmin?'#374151':'#ec4899'}`,opacity:a.isAdmin?0.45:1}}>
                            <div className="anest-name">{a.name}</div>
                            <div className="anest-shift" style={{color:a.isAdmin?'#475569':'#f9a8d4'}}>
                              {a.isAdmin?'ADMIN — NOT IN OR':(ANESTHETIST_SHIFTS[`Anesthetist ${a.shift}`]?.label||a.shift)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── STEP 3: CUBE SCHEDULE ── */}
            <div>
              <div className="section-label">STEP 3 — CUBE SCHEDULE (paste all data)</div>
              <div className="card">
                {!stepsUnlocked && (
                  <div style={{fontSize:'10px',color:'var(--accent-amber)',marginBottom:'8px'}}>⚠ Confirm or bypass Step 1 first</div>
                )}
                <div className="card-hint">
                  Paste the full SharePoint cube file. The parser will automatically filter to{' '}
                  {selectedDate
                    ? <strong>{new Date(selectedDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'})}</strong>
                    : <span style={{color:'var(--accent-amber)'}}>the date selected in Step 1</span>
                  }.
                </div>
                <textarea className="textarea" value={cubeRaw} onChange={e=>setCubeRaw(e.target.value)}
                  placeholder={"Paste entire cube schedule here — all dates, all areas.
Date is set from Step 1.

BMH OR
4/14/2026 7:30 AM	BMHOR-2026-701	BMH OR 10	..."}
                  disabled={!stepsUnlocked}
                  style={{opacity:stepsUnlocked?1:0.4}}
                />
                <button className="btn" onClick={loadSchedule} style={{marginTop:'10px',opacity:stepsUnlocked?1:0.4}} disabled={!stepsUnlocked}>
                  LOAD SCHEDULE
                </button>
              </div>

              {schedLoaded && (
                <div style={{marginTop:'14px'}}>
                  {dateMismatch ? (
                    <div className="flag-crit">
                      ⚠ No cases found for {selectedDate?new Date(selectedDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}):'selected date'}. The cube data may not contain cases for this date yet.
                    </div>
                  ) : rooms.length > 0 ? (
                    <div>
                      <div className="section-label">
                        SCHEDULE — {rooms.length} ROOMS
                        {selectedDate && <span style={{color:'var(--text-secondary)',fontWeight:'normal',marginLeft:'8px',letterSpacing:'0'}}>{new Date(selectedDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span>}
                      </div>
                      <div className="chip-row">
                        {[['cardiac','#8b5cf6'],['high','#ef4444'],['peds','#3b82f6'],['medium-high','#f97316']].map(([a,c])=>{
                          const ct=rooms.filter(r=>r.acuity===a).length;
                          return ct>0?<div key={a} className="chip" style={{borderColor:c,color:c}}>{a}: {ct}</div>:null;
                        })}
                        {rooms.filter(r=>r.blockRequired).length>0 && (
                          <div className="chip" style={{borderColor:'#f59e0b',color:'#f59e0b'}}>blocks: {rooms.filter(r=>r.blockRequired).length}</div>
                        )}
                      </div>
                      {critFlags.map((f,i)=><div key={i} className="flag-crit">⚠ {f.room}: {f.msg}</div>)}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

          </div>
        )}

        {/* OR CALL PROMPT MODAL */}
        {showORCallPrompt && qg?.ORCall && (
          <ORCallPrompt
            orCallProvider={qg.ORCall}
            rooms={pendingRooms || []}
            onConfirm={handleORCallConfirm}
            onSkip={handleORCallSkip}
          />
        )}

        {/* ASSIGNMENTS */}
        {tab === 'assign' && (
          <div>
            <div className="section-header">
              <div className="section-label">ROOM ASSIGNMENTS</div>
              {(!schedLoaded||!qgLoaded) && <div className="warn-text">Load QGenda and schedule on Daily Board first</div>}
            </div>

            {/* Care team summary */}
            {careTeamResult?.careTeams?.length > 0 && (
              <div style={{marginBottom:'16px'}}>
                <div className="section-label">CARE TEAM SUMMARY</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:'8px',marginBottom:'8px'}}>
                  {careTeamResult.careTeams.map((ct, i) => (
                    <div key={i} style={{background:ct.color.bg,border:`1px solid ${ct.color.border}`,borderRadius:'var(--radius)',padding:'8px 12px',minWidth:'180px'}}>
                      <div style={{fontSize:'10px',color:ct.color.text,fontWeight:'600',letterSpacing:'1px',marginBottom:'3px'}}>{ct.color.label} — {ct.ratio}</div>
                      <div style={{fontSize:'11px',color:'var(--text-primary)'}}>{ct.md.split(',')[0]}</div>
                      <div style={{fontSize:'10px',color:'var(--text-secondary)',marginTop:'2px'}}>Rooms: {ct.rooms.join(', ')}</div>
                      <div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'2px'}}>AAs: {ct.anesthetists.join(', ') || '—'}</div>
                    </div>
                  ))}
                  {careTeamResult.floats?.length > 0 && (
                    <div style={{background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'8px 12px'}}>
                      <div style={{fontSize:'10px',color:'var(--accent-amber)',fontWeight:'600',letterSpacing:'1px',marginBottom:'3px'}}>FLOAT</div>
                      {careTeamResult.floats.map(f => (
                        <div key={f.name} style={{fontSize:'11px',color:'var(--text-primary)'}}>{f.name}</div>
                      ))}
                    </div>
                  )}
                  {careTeamResult.available?.length > 0 && (
                    <div style={{background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'8px 12px'}}>
                      <div style={{fontSize:'10px',color:'var(--text-muted)',fontWeight:'600',letterSpacing:'1px',marginBottom:'3px'}}>AVAILABLE</div>
                      {orCallChoice?.type === 'available' && qg?.ORCall && (
                        <div style={{fontSize:'11px',color:'#f97316',marginBottom:'2px'}}>
                          {qg.ORCall.split(',')[0]} — 1st Available <span style={{fontSize:'9px',letterSpacing:'1px'}}>[CHOICE]</span>
                        </div>
                      )}
                      {careTeamResult.available.map(p => (
                        <div key={p.name} style={{fontSize:'11px',color:'var(--text-secondary)'}}>{p.label}: {p.name.split(',')[0]}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {critFlags.length>0 && <div style={{marginBottom:'12px'}}>{critFlags.map((f,i)=><div key={i} className="flag-crit">⚠ {f.room}: {f.msg}</div>)}</div>}

            {/* Save today's assignments to history */}
            {schedLoaded && rooms.length > 0 && selectedDate && (
              <div style={{marginBottom:'12px'}}>
                <button className="btn" style={{fontSize:'9px',padding:'6px 14px',background:'var(--bg-elevated)',color:'var(--accent-green)',border:'1px solid var(--accent-green)'}}
                  onClick={() => { saveFullDayHistory(selectedDate, rooms); alert('Assignments saved to history.'); }}>
                  SAVE TO HISTORY
                </button>
              </div>
            )}

            <div className="room-grid">
              {rooms.map(room => {
                const ac = ACUITY_COLORS[room.acuity]||'#475569';
                const conflict = room.assignedProvider && room.avoidProviders?.includes(room.assignedProvider);
                const isExp = expanded === `room-${room.room}`;
                const ctColor = room.isCareTeam && room.careTeamId !== undefined
                  ? CARE_TEAM_COLORS[room.careTeamId % CARE_TEAM_COLORS.length]
                  : null;

                return (
                  <div key={room.room} className="card room-card"
                    style={{
                      borderLeft:`3px solid ${ctColor ? ctColor.border : ac}`,
                      borderColor: conflict ? '#ef4444' : ctColor ? ctColor.border : 'var(--border)',
                      background: ctColor ? ctColor.bg : 'var(--bg-surface)',
                    }}
                    onClick={()=>setExpanded(isExp?null:`room-${room.room}`)}>

                    {/* Care team label badge */}
                    {room.isCareTeam && room.careTeamLabel && (
                      <div style={{fontSize:'9px',color:ctColor?.text,letterSpacing:'1px',marginBottom:'5px',fontWeight:'600'}}>
                        {room.careTeamLabel}
                      </div>
                    )}

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

                    {/* Attending MD */}
                    <div style={{marginBottom:'5px'}}>
                      <div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'3px'}}>ATTENDING MD</div>
                      <select className="room-select" style={{borderColor:conflict?'#ef4444':ctColor?ctColor.border:'var(--border)'}}
                        value={room.assignedProvider||''} onClick={e=>e.stopPropagation()}
                        onChange={e=>{e.stopPropagation();updateAssignment(room.room,e.target.value);}}>
                        <option value="">— Unassigned —</option>
                        {qg?.workingMDs?.map(p=>(
                          <option key={p.name} value={p.name}>
                            {room.preferredProviders?.includes(p.name)?'★ ':room.avoidProviders?.includes(p.name)?'⚠ ':''}{p.name} ({p.role})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Anesthetist */}
                    <div>
                      <div style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',marginBottom:'3px'}}>ANESTHETIST</div>
                      <div style={{
                        background:'var(--bg-base)',
                        border:`1px solid ${ctColor?ctColor.border:'var(--border)'}`,
                        borderRadius:'var(--radius-sm)',
                        padding:'5px 8px',
                        fontSize:'11px',
                        color: room.anesthetist ? (ctColor?ctColor.text:'var(--text-primary)') : 'var(--text-faint)',
                        fontStyle: room.anesthetist ? 'normal' : 'italic',
                      }}>
                        {room.anesthetist || 'NONE'}
                      </div>
                    </div>

                    {conflict && <div className="flag-crit" style={{marginTop:'6px'}}>⚠ Conflict — {room.assignedProvider} flagged for this room</div>}
                    {room.cardiacNote && <div className="flag-info" style={{marginTop:'6px'}}>{room.cardiacNote}</div>}

                    {isExp && (
                      <div className="room-detail">
                        {room.preferredProviders?.length>0 && <div className="detail-preferred">★ Preferred: {room.preferredProviders.join(', ')}</div>}
                        {room.avoidProviders?.length>0 && <div className="detail-avoid">✗ Avoid: {room.avoidProviders.join(', ')}</div>}
                        {(room.flags||[]).map((f,i)=>(
                          <div key={i} className={f.level==='critical'?'flag-crit':f.level==='warn'?'flag-warn':'flag-info'}>{f.msg}</div>
                        ))}
                        {room.cases?.map((c,i)=>(
                          <div key={i} className="case-detail">
                            <span className="case-proc">{c.procedure}</span> · {c.surgeon}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 2PM HANDOFF */}
        {tab === 'handoff' && (
          <div>
            <div className="section-label">2PM HANDOFF GENERATOR</div>
            <div className="grid-2" style={{marginBottom:'20px'}}>
              <div>
                <div className="section-label" style={{color:'var(--text-secondary)'}}>ROOM STATUS (~1:45PM)</div>
                {(rooms.length?rooms:[{room:'OR 1'},{room:'OR 2'},{room:'OR 3'},{room:'OR 4'},{room:'OR 5 (CV)'},{room:'OR 6'},{room:'OR 7'},{room:'OR 8'},{room:'Endo 1'},{room:'Endo 2'},{room:'Cath Lab'},{room:'EP Lab'}]).map(r=>(
                  <div key={r.room} className="card handoff-row" style={{marginBottom:'5px'}}>
                    <div>
                      <span className="handoff-room">{r.room}</span>
                      {r.assignedProvider && <span className="handoff-provider">→ {r.assignedProvider}</span>}
                    </div>
                    <select className="handoff-select"
                      style={{color:handoffStatus[r.room]?STATUS_COLORS[handoffStatus[r.room]]:'var(--text-muted)'}}
                      value={handoffStatus[r.room]||''} onChange={e=>setHandoffStatus(p=>({...p,[r.room]:e.target.value}))}>
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
                    <select className="handoff-select"
                      style={{color:overrides[p.name]?'var(--accent-amber)':'var(--text-muted)'}}
                      value={overrides[p.name]||''} onChange={e=>setOverrides(prev=>({...prev,[p.name]:e.target.value}))}>
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
              const active = Object.entries(handoffStatus)
                .filter(([,v])=>v&&v!=='Done'&&v!=='Not Started')
                .map(([room,status])=>{
                  const r=rooms.find(x=>x.room===room);
                  return `${room}(${status})${r?.assignedProvider?` — ${r.assignedProvider}`:''}`;
                }).join(', ')||'No statuses entered';
              const ov = Object.entries(overrides).filter(([,v])=>v).map(([n,f])=>`${n}:${f}`).join(', ')||'None';
              runAI(`Generate the 2pm afternoon handoff report.\nRoom statuses: ${active}\nProvider flags: ${ov}\n\nProvide:\n1. ONE-PAGE DECISION BRIEF for OR Call physician: what's still running, status, who needs relief and when, who to call next for add-ons, cardiac 4pm flags, late-stay options.\n2. FULL INFORMATIONAL LAYER: all providers still working with shift ends, complete relief order, location coverage plan 2pm-7pm, anesthetist shift ends, any coverage gaps.`);
            }}>GENERATE HANDOFF REPORT</button>
            {aiLoad && <div className="ai-loading">● Generating report...</div>}
            {aiError && <div className="flag-crit" style={{marginTop:'12px'}}>{aiError}</div>}
            {aiResp && <div className="ai-response"><div className="section-label">HANDOFF REPORT</div>{aiResp}</div>}
          </div>
        )}

        {/* PROVIDER INTEL */}
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
                        <div key={name} className="card provider-card" style={{cursor:'pointer',border:`1px solid ${isExp?'var(--accent-blue)':'var(--border)'}`}}
                          onClick={()=>setExpanded(isExp?null:`prov-${name}`)}>
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

        {/* SURGEON DB */}
        {tab === 'surgeons' && (
          <div>
            <div className="section-label">SURGEON BLOCK DATABASE</div>
            <input className="search-input" value={surgSearch} onChange={e=>setSurgSearch(e.target.value)} placeholder="Search surgeons or specialty..." />
            <div className="legend">
              <span style={{color:'#ef4444'}}>■</span> Always &nbsp;
              <span style={{color:'#f97316'}}>■</span> Usually &nbsp;
              <span style={{color:'#60a5fa'}}>■</span> Specific cases &nbsp;
              <span style={{color:'#eab308'}}>■</span> Confirm day-of &nbsp;
              <span style={{color:'#22c55e'}}>■</span> Never &nbsp;
              <span style={{color:'#94a3b8'}}>■</span> If offered/appropriate
            </div>
            <div className="provider-grid">
              {Object.entries(SURGEON_BLOCKS)
                .filter(([n,p])=>!surgSearch||n.toLowerCase().includes(surgSearch.toLowerCase())||(p.specialty||'').toLowerCase().includes(surgSearch.toLowerCase()))
                .map(([name,p]) => {
                  const ruleColor = p.blockRule==='always'?'#ef4444':p.blockRule==='never'?'#22c55e':p.blockRule==='usually'?'#f97316':p.blockRule==='mood-dependent'?'#eab308':'#60a5fa';
                  const isExp = expanded===`surg-${name}`;
                  return (
                    <div key={name} className="card surgeon-card" style={{borderLeft:`3px solid ${ruleColor}`,cursor:'pointer'}}
                      onClick={()=>setExpanded(isExp?null:`surg-${name}`)}>
                      <div className="surgeon-row">
                        <div>
                          <span className="surgeon-name">{name}</span>
                          <span className="surgeon-specialty">{p.specialty}</span>
                        </div>
                        <span className="surgeon-rule" style={{color:ruleColor}}>{p.blockRule}</span>
                      </div>
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

        {/* HISTORY */}
        {tab === 'history' && (
          <div>
            <div className="section-label">ASSIGNMENT HISTORY</div>
            <HistoryTab qg={qg} />
          </div>
        )}

        {/* AI ASSISTANT */}
        {tab === 'ai' && (
          <div>
            <div className="section-label">AI SCHEDULING ASSISTANT</div>
            <div className="quick-prompts">
              {QUICK_PROMPTS.map(q=>(
                <button key={q} className="quick-btn" onClick={()=>{setAiPrompt(q);runAI(q);}}>{q}</button>
              ))}
            </div>
            <textarea className="textarea" value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)}
              placeholder="Ask anything about today's staffing, assignments, or afternoon coverage..." />
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
