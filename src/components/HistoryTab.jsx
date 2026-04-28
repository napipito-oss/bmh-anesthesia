import { useState, useEffect, useRef } from 'react';
import {
  LOCATION_TYPES,
  getAnesthetistLocationCounts,
  getCCSchedule, deleteCCSchedule,
  getCoordSchedule, saveCoordSchedule, deleteCoordSchedule,
  getScheduleDates,
} from '../utils/history.js';

const CONF_COLOR = { high: '#16a34a', medium: '#b45309', low: '#dc2626' };
const CONF_BG    = { high: '#f0fdf4', medium: '#fffbeb', low: '#fef2f2' };

const S = {
  label:    { fontSize:'10px', color:'var(--accent-blue)', letterSpacing:'2px', marginBottom:'6px', display:'block' },
  select:   { width:'100%', background:'var(--bg-base)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', color:'var(--text-primary)', padding:'5px 8px', fontSize:'11px', fontFamily:'var(--font-mono)', cursor:'pointer' },
  card:     { background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'12px 14px' },
  btn:      { background:'linear-gradient(135deg,#1d4ed8,#7c3aed)', color:'white', border:'none', borderRadius:'var(--radius)', padding:'8px 18px', fontSize:'10px', letterSpacing:'2px', fontFamily:'var(--font-mono)', cursor:'pointer' },
  btnSm:    { background:'var(--bg-elevated)', color:'var(--text-secondary)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', padding:'4px 10px', fontSize:'10px', fontFamily:'var(--font-mono)', cursor:'pointer' },
  btnDanger:{ background:'#450a0a', color:'#fca5a5', border:'1px solid #ef4444', borderRadius:'var(--radius-sm)', padding:'4px 10px', fontSize:'10px', fontFamily:'var(--font-mono)', cursor:'pointer' },
  th:       { padding:'6px 10px', textAlign:'left', color:'var(--text-muted)', letterSpacing:'1px', fontWeight:'600', fontSize:'9px', borderBottom:'1px solid var(--border)', background:'var(--bg-elevated)' },
  td:       { padding:'5px 10px', fontSize:'10px', fontFamily:'var(--font-mono)', borderBottom:'1px solid var(--border)' },
};

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' }); }
  catch { return iso; }
}

// Compress image to ≤1200px wide before sending — day sheets don't need full resolution
async function compressImage(base64, maxPx = 1200) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / img.width);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.src = 'data:image/jpeg;base64,' + base64;
  });
}

async function parseDaySheet(imageBase64) {
  const compressed = await compressImage(imageBase64);
  const prompt = `You are parsing a handwritten anesthesia assignment day sheet from IU Health Ball Memorial Hospital.

Extract ALL assignments visible on the sheet. Return ONLY valid JSON — no markdown, no explanation, no backticks.

Return exactly:
{
  "confidence": "high | medium | low",
  "readabilityNotes": "describe illegible sections or null",
  "staffingNotes": "any general notes written on the sheet or null",
  "assignments": [
    {
      "room": "room name as written (e.g. OR 2, Endo 1, BOOS OR 1, CL 2, IR)",
      "md": "MD last name as written, or null if not shown",
      "anesthetist": "anesthetist/CRNA/AA last name, or null",
      "careTeam": true if this row has both an MD and anesthetist, false otherwise,
      "callRole": "OR Call / Backup Call / Cardiac Call / Locum / Rank 3 / etc — or null",
      "notes": "handwritten notes for this row or null"
    }
  ]
}

Location guide: OR 1–10 = main OR; Endo 1–3 = endoscopy; BOOS OR 1–2 = BOOS; CL 2/3/Minor = cath lab; IR/rIR = interventional radiology.
If a name is illegible, write your best guess and lower confidence.`;

  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: compressed } },
        { type: 'text',  text: prompt },
      ]}],
    }),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `Server error ${resp.status}`);
  const text = (data.content || []).map(c => c.text || '').join('');
  return JSON.parse(text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
}

// ── Main component ────────────────────────────────────────────────
export default function HistoryTab({ qg }) {
  const [view, setView]         = useState('compare');
  const [dates, setDates]       = useState([]);
  const [selDate, setSelDate]   = useState('');
  const [ccSched, setCCSched]   = useState(null);
  const [coordSched, setCoord]  = useState(null);
  const [locationCounts, setLC] = useState({});

  // Import state
  const [impDate, setImpDate]       = useState('');
  const [impB64, setImpB64]         = useState(null);
  const [impName, setImpName]       = useState('');
  const [impParsing, setImpParsing] = useState(false);
  const [impResult, setImpResult]   = useState(null);
  const [impError, setImpError]     = useState('');
  const [impSaved, setImpSaved]     = useState(false);
  const fileRef = useRef(null);

  const reload = () => {
    const d = getScheduleDates();
    setDates(d);
    setLC(getAnesthetistLocationCounts());
    if (selDate) { setCCSched(getCCSchedule(selDate)); setCoord(getCoordSchedule(selDate)); }
  };

  useEffect(reload, []);

  // Load schedule data when date changes
  useEffect(() => {
    if (!selDate) { setCCSched(null); setCoord(null); return; }
    setCCSched(getCCSchedule(selDate));
    setCoord(getCoordSchedule(selDate));
  }, [selDate]);

  // ── Import handlers ───────────────────────────────────────────
  const handleFile = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImpName(file.name);
    setImpResult(null); setImpError(''); setImpSaved(false);
    const reader = new FileReader();
    reader.onload = () => setImpB64(reader.result.split(',')[1]);
    reader.readAsDataURL(file);
  };

  const handleParse = async () => {
    if (!impB64 || !impDate) return;
    setImpParsing(true); setImpError(''); setImpResult(null); setImpSaved(false);
    try {
      const result = await parseDaySheet(impB64);
      setImpResult(result);
    } catch (e) {
      setImpError(e.message || 'Parse failed. Check image quality and try again.');
    }
    setImpParsing(false);
  };

  const handleSaveImport = () => {
    if (!impResult || !impDate) return;
    saveCoordSchedule(impDate, impResult.assignments || [], {
      confidence:       impResult.confidence,
      readabilityNotes: impResult.readabilityNotes,
      staffingNotes:    impResult.staffingNotes,
    });
    setImpSaved(true);
    reload();
  };

  const handleDeleteCC    = d => { if (confirm(`Delete CC schedule for ${d}?`))    { deleteCCSchedule(d);    reload(); } };
  const handleDeleteCoord = d => { if (confirm(`Delete coordinator schedule for ${d}?`)) { deleteCoordSchedule(d); reload(); } };

  return (
    <div>
      {/* Sub-navigation */}
      <div style={{ display:'flex', gap:'4px', marginBottom:'20px', borderBottom:'1px solid var(--border)', paddingBottom:'0' }}>
        {[['compare','COMPARE SCHEDULES'],['import','IMPORT COORDINATOR'],['stats','ANESTHETIST STATS']].map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} style={{
            background: view===id ? 'var(--bg-elevated)' : 'transparent',
            color: view===id ? 'var(--accent-blue)' : 'var(--text-muted)',
            border:'none', borderBottom: view===id ? '2px solid var(--accent-blue)' : '2px solid transparent',
            padding:'8px 14px', fontSize:'10px', letterSpacing:'2px', fontFamily:'var(--font-mono)', cursor:'pointer',
          }}>{label}</button>
        ))}
      </div>

      {/* ── COMPARE ── */}
      {view === 'compare' && (
        <div>
          <span style={S.label}>COMPARE — COMMAND CENTER VS COORDINATOR SCHEDULE</span>
          <p style={{ fontSize:'11px', color:'var(--text-muted)', marginTop:0, marginBottom:'16px' }}>
            Save assignments from the Assignments tab ("SAVE TO HISTORY") to record the command center schedule.
            Import Jenni's day sheet below to record the coordinator schedule. Both appear here side by side.
          </p>

          <div style={{ marginBottom:'16px', display:'flex', gap:'12px', alignItems:'center', flexWrap:'wrap' }}>
            <div>
              <span style={{ ...S.label, marginBottom:'4px' }}>SELECT DATE</span>
              <select style={{ ...S.select, width:'220px' }} value={selDate} onChange={e => setSelDate(e.target.value)}>
                <option value="">— Pick a date —</option>
                {dates.map(d => <option key={d} value={d}>{formatDate(d)} ({d})</option>)}
              </select>
            </div>
            {selDate && (
              <div style={{ display:'flex', gap:'8px', alignItems:'center', marginTop:'18px' }}>
                {ccSched    && <button style={S.btnDanger} onClick={() => handleDeleteCC(selDate)}>Delete CC</button>}
                {coordSched && <button style={S.btnDanger} onClick={() => handleDeleteCoord(selDate)}>Delete Coord</button>}
              </div>
            )}
          </div>

          {!selDate && (
            <div style={{ color:'var(--text-muted)', fontSize:'11px', fontStyle:'italic' }}>
              Select a date to view schedules. Dates appear here once you save a CC schedule or import a coordinator day sheet.
            </div>
          )}

          {selDate && !ccSched && !coordSched && (
            <div style={{ color:'var(--text-muted)', fontSize:'11px', fontStyle:'italic' }}>
              No data saved for {formatDate(selDate)}. Save from the Assignments tab and/or import a coordinator day sheet.
            </div>
          )}

          {selDate && (ccSched || coordSched) && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px', alignItems:'start' }}>

              {/* CC Schedule column */}
              <div>
                <div style={{ fontSize:'10px', color:'#1d4ed8', letterSpacing:'2px', fontWeight:'700', marginBottom:'8px', display:'flex', alignItems:'center', gap:'8px' }}>
                  COMMAND CENTER
                  {ccSched && <span style={{ fontSize:'9px', color:'var(--text-muted)', fontWeight:'normal', letterSpacing:'1px' }}>saved {new Date(ccSched.savedAt).toLocaleTimeString()}</span>}
                </div>
                {!ccSched ? (
                  <div style={{ ...S.card, color:'var(--text-muted)', fontSize:'11px', fontStyle:'italic' }}>
                    No CC schedule saved for this date. Use "SAVE TO HISTORY" on the Assignments tab.
                  </div>
                ) : (
                  <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse' }}>
                      <thead>
                        <tr>
                          {['ROOM','MD','ANEST','RATIO'].map(h => <th key={h} style={S.th}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {ccSched.rooms.map((r, i) => (
                          <tr key={i} style={{ background: i%2===0 ? 'var(--bg-surface)' : 'var(--bg-base)' }}>
                            <td style={{ ...S.td, color:'var(--text-muted)', whiteSpace:'nowrap' }}>{r.room}</td>
                            <td style={{ ...S.td, color:'#1d4ed8', fontWeight:'600' }}>{r.md || '—'}</td>
                            <td style={{ ...S.td, color:'#be185d', fontWeight:'600' }}>{r.anesthetist || '—'}</td>
                            <td style={{ ...S.td, color:'var(--text-muted)' }}>{r.isCareTeam ? r.careTeamRatio : r.md ? 'solo' : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Coordinator column */}
              <div>
                <div style={{ fontSize:'10px', color:'#7c3aed', letterSpacing:'2px', fontWeight:'700', marginBottom:'8px', display:'flex', alignItems:'center', gap:'8px' }}>
                  COORDINATOR (JENNI)
                  {coordSched && (
                    <>
                      <span style={{ fontSize:'9px', color:'var(--text-muted)', fontWeight:'normal', letterSpacing:'1px' }}>saved {new Date(coordSched.savedAt).toLocaleTimeString()}</span>
                      <span style={{ fontSize:'9px', letterSpacing:'1px', fontWeight:'700', color: CONF_COLOR[coordSched.confidence] || '#475569', textTransform:'uppercase' }}>{coordSched.confidence}</span>
                    </>
                  )}
                </div>
                {!coordSched ? (
                  <div style={{ ...S.card, color:'var(--text-muted)', fontSize:'11px', fontStyle:'italic' }}>
                    No coordinator schedule imported for this date. Use the "Import Coordinator" tab.
                  </div>
                ) : (
                  <div>
                    {coordSched.readabilityNotes && (
                      <div style={{ fontSize:'10px', color:'var(--accent-amber)', background:'#fffbeb', border:'1px solid #f59e0b', borderRadius:'var(--radius-sm)', padding:'6px 10px', marginBottom:'8px' }}>
                        ⚠ {coordSched.readabilityNotes}
                      </div>
                    )}
                    {coordSched.staffingNotes && (
                      <div style={{ fontSize:'10px', color:'var(--text-secondary)', background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', padding:'6px 10px', marginBottom:'8px' }}>
                        {coordSched.staffingNotes}
                      </div>
                    )}
                    <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden' }}>
                      <table style={{ width:'100%', borderCollapse:'collapse' }}>
                        <thead>
                          <tr>
                            {['ROOM','MD','ANEST','NOTES'].map(h => <th key={h} style={S.th}>{h}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {coordSched.assignments.map((a, i) => (
                            <tr key={i} style={{ background: i%2===0 ? 'var(--bg-surface)' : 'var(--bg-base)' }}>
                              <td style={{ ...S.td, color:'var(--text-muted)', whiteSpace:'nowrap' }}>{a.room || '—'}</td>
                              <td style={{ ...S.td, color:'#1d4ed8', fontWeight:'600' }}>{a.md || '—'}</td>
                              <td style={{ ...S.td, color:'#be185d', fontWeight:'600' }}>{a.anesthetist || '—'}</td>
                              <td style={{ ...S.td, color:'var(--text-muted)', fontSize:'9px' }}>{a.notes || a.callRole || (a.careTeam ? 'Care Team' : '—')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── IMPORT COORDINATOR ── */}
      {view === 'import' && (
        <div>
          <span style={S.label}>IMPORT COORDINATOR SCHEDULE — JENNI'S DAY SHEET</span>
          <p style={{ fontSize:'11px', color:'var(--text-muted)', marginTop:0, marginBottom:'16px' }}>
            Upload a photo of the handwritten day sheet. AI reads the assignments and pre-fills the table for review before saving.
            Saved data appears in the Compare tab for the selected date.
          </p>

          <div style={{ ...S.card, marginBottom:'16px' }}>
            <div style={{ display:'grid', gridTemplateColumns:'160px 1fr', gap:'12px', marginBottom:'14px', alignItems:'end' }}>
              <div>
                <span style={{ ...S.label, marginBottom:'4px' }}>DATE</span>
                <input type="date" value={impDate}
                  onChange={e => { setImpDate(e.target.value); setImpSaved(false); setImpResult(null); }}
                  style={{ ...S.select, width:'100%' }} />
              </div>
              <div>
                <span style={{ ...S.label, marginBottom:'4px' }}>DAY SHEET IMAGE (JPG/PNG)</span>
                <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display:'none' }} />
                <button onClick={() => fileRef.current?.click()} style={{
                  width:'100%', background:'var(--bg-base)', cursor:'pointer', padding:'9px 12px',
                  fontSize:'10px', fontFamily:'var(--font-mono)', letterSpacing:'1px', textAlign:'left',
                  border: `1px dashed ${impB64 ? '#22c55e' : 'var(--border)'}`,
                  color: impB64 ? '#4ade80' : 'var(--text-muted)',
                  borderRadius:'var(--radius)',
                }}>
                  {impB64 ? `✓  ${impName}` : '+ CLICK TO UPLOAD SCAN (JPG / PNG)'}
                </button>
              </div>
            </div>

            <button style={{ ...S.btn, opacity: (!impB64 || !impDate || impParsing) ? 0.45 : 1 }}
              onClick={handleParse} disabled={!impB64 || !impDate || impParsing}>
              {impParsing ? '● READING HANDWRITING...' : 'PARSE WITH AI VISION'}
            </button>

            {impError && (
              <div style={{ background:'#450a0a', border:'1px solid #ef4444', borderRadius:'var(--radius)', padding:'9px 12px', marginTop:'10px', fontSize:'10px', color:'#fca5a5' }}>
                ⚠ {impError}
              </div>
            )}
          </div>

          {impResult && (
            <div>
              {/* Confidence banner */}
              <div style={{
                background: CONF_BG[impResult.confidence] || 'var(--bg-elevated)',
                border: `1px solid ${CONF_COLOR[impResult.confidence] || '#475569'}`,
                borderRadius:'var(--radius)', padding:'9px 14px', marginBottom:'12px',
                display:'flex', gap:'16px', alignItems:'center',
              }}>
                <span style={{ fontSize:'10px', fontWeight:'700', letterSpacing:'1px', color: CONF_COLOR[impResult.confidence] || '#94a3b8' }}>
                  {impResult.confidence?.toUpperCase()} CONFIDENCE — {impResult.assignments?.length || 0} assignments extracted
                </span>
                {impResult.readabilityNotes && (
                  <span style={{ fontSize:'10px', color:'var(--text-secondary)' }}>⚠ {impResult.readabilityNotes}</span>
                )}
              </div>

              {/* Extracted table */}
              <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden', marginBottom:'12px' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr>{['ROOM','MD','ANEST','ROLE / NOTES'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {(impResult.assignments || []).map((a, i) => (
                      <tr key={i} style={{ background: i%2===0 ? 'var(--bg-surface)' : 'var(--bg-base)' }}>
                        <td style={{ ...S.td, color:'var(--text-muted)' }}>{a.room}</td>
                        <td style={{ ...S.td, color:'#1d4ed8', fontWeight:'600' }}>{a.md || '—'}</td>
                        <td style={{ ...S.td, color:'#be185d', fontWeight:'600' }}>{a.anesthetist || '—'}</td>
                        <td style={{ ...S.td, color:'var(--text-muted)', fontSize:'9px' }}>{a.notes || a.callRole || (a.careTeam ? 'Care Team' : '—')}</td>
                      </tr>
                    ))}
                    {(!impResult.assignments || impResult.assignments.length === 0) && (
                      <tr><td colSpan={4} style={{ ...S.td, color:'var(--text-muted)', fontStyle:'italic', textAlign:'center' }}>No assignments extracted</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {impResult.staffingNotes && (
                <div style={{ fontSize:'10px', color:'var(--text-secondary)', background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', padding:'8px 12px', marginBottom:'12px' }}>
                  {impResult.staffingNotes}
                </div>
              )}

              {impSaved ? (
                <div style={{ background:'#f0fdf4', border:'1.5px solid #16a34a', borderRadius:'var(--radius)', padding:'10px 14px', color:'#15803d', fontSize:'12px', letterSpacing:'1px', fontWeight:'700' }}>
                  ✓ SAVED — visible in Compare tab for {formatDate(impDate)}
                </div>
              ) : (
                <button style={S.btn} onClick={handleSaveImport} disabled={!impDate || !(impResult.assignments?.length)}>
                  SAVE COORDINATOR SCHEDULE
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── STATS ── */}
      {view === 'stats' && (
        <div>
          <span style={S.label}>ANESTHETIST LOCATION HISTORY</span>
          <p style={{ fontSize:'10px', color:'var(--text-muted)', marginTop:0, marginBottom:'12px' }}>
            Tracks how many times each anesthetist has been to each location. Used to ensure variety in assignments.
            Populated from saved CC schedules.
          </p>
          {Object.keys(locationCounts).length === 0 ? (
            <div style={{ color:'var(--text-muted)', fontSize:'11px' }}>No history data yet. Save CC schedules from the Assignments tab.</div>
          ) : (
            <div>
              <div style={{ display:'grid', gridTemplateColumns:`1fr repeat(${LOCATION_TYPES.length}, auto)`, gap:'8px', marginBottom:'8px', padding:'6px 10px' }}>
                <span style={{ fontSize:'9px', color:'var(--text-muted)', letterSpacing:'1px' }}>ANESTHETIST</span>
                {LOCATION_TYPES.map(l => (
                  <span key={l.value} style={{ fontSize:'9px', color:'var(--text-muted)', letterSpacing:'1px', textAlign:'center' }}>
                    {l.label.split(' ')[0].toUpperCase()}
                  </span>
                ))}
              </div>
              {Object.entries(locationCounts).sort(([a],[b]) => a.localeCompare(b)).map(([name, counts]) => (
                <div key={name} style={{ display:'grid', gridTemplateColumns:`1fr repeat(${LOCATION_TYPES.length}, auto)`, gap:'8px', padding:'7px 10px', background:'var(--bg-elevated)', borderRadius:'var(--radius-sm)', marginBottom:'4px', alignItems:'center' }}>
                  <span style={{ fontSize:'11px', color:'var(--text-primary)' }}>{name}</span>
                  {LOCATION_TYPES.map(l => {
                    const count = counts[l.value] || 0;
                    const max   = Math.max(...Object.values(counts));
                    return (
                      <span key={l.value} style={{ fontSize:'11px', textAlign:'center', color: count > 0 && count === max ? 'var(--accent-amber)' : count > 0 ? 'var(--text-secondary)' : 'var(--text-faint)', fontWeight: count > 0 && count === max ? '600' : 'normal' }}>
                        {count || '—'}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
