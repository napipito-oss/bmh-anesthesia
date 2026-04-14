import { useState, useEffect } from 'react';
import {
  LOCATION_TYPES, MD_ASSIGNMENT_TYPES,
  loadHistory, saveFullDayHistory, getAllDates,
  getHistoryForDate, deleteHistoryDate, getAnesthetistLocationCounts,
} from '../utils/history.js';

const ANESTHETISTS = [
  'Anders, Kendall','Blakely, Spencer J','Hester, Charles','Holt',
  'McCarter, Niko','Monteiro, Derrianne M','Nguyen, An B','Benzinger',
  'Colaianni','Johnson','Thompson, Riley',
];

const MDS = [
  'Eskew, Gregory S','DeWitt, Bracken J','Wu, Jennifer','Kuraganti, Manjusha',
  'Singh, Karampal','Raghove, Vikas','Raghove, Punam','Pipito, Nicholas A',
  'Brand, David L','Kane, Paul','Munro, Jonathan','Thomas, Michael',
  'Gathings, Vincent','Lambert','Siddiqui','Nielson, Mark',
  'Pond, William','Dodwani','Powell, Jason','Fraley','Shepherd',
];

const ROOMS = [
  'BMH OR 01','BMH OR 02','BMH OR 03','BMH OR 04','BMH OR 05',
  'BMH OR 06','BMH OR 07','BMH OR 08','BMH OR 09','BMH OR 10',
  'BMH Endo 01','BMH Endo 02','BMH Endo 03',
  'BMH CL 2','BMH CL 3','BMH CL Minor 2',
  'BOOS OR 01','BOOS OR 02',
];

const S = {
  label: { fontSize:'10px', color:'var(--accent-blue)', letterSpacing:'2px', marginBottom:'6px', display:'block' },
  select: { width:'100%', background:'var(--bg-base)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', color:'var(--text-primary)', padding:'5px 8px', fontSize:'11px', fontFamily:'var(--font-mono)', cursor:'pointer' },
  card: { background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'12px 14px' },
  btn: { background:'linear-gradient(135deg,#1d4ed8,#7c3aed)', color:'white', border:'none', borderRadius:'var(--radius)', padding:'8px 18px', fontSize:'10px', letterSpacing:'2px', fontFamily:'var(--font-mono)', cursor:'pointer' },
  btnSm: { background:'var(--bg-elevated)', color:'var(--text-secondary)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', padding:'4px 10px', fontSize:'10px', fontFamily:'var(--font-mono)', cursor:'pointer' },
  btnDanger: { background:'#450a0a', color:'#fca5a5', border:'1px solid #ef4444', borderRadius:'var(--radius-sm)', padding:'4px 10px', fontSize:'10px', fontFamily:'var(--font-mono)', cursor:'pointer' },
  row: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr auto', gap:'8px', alignItems:'end', marginBottom:'8px' },
};

function emptyEntry() {
  return { anesthetist: '', location: '', room: '', mdDirecting: '', notes: '' };
}

export default function HistoryTab({ qg }) {
  const [historyDate, setHistoryDate] = useState('');
  const [entries, setEntries] = useState([emptyEntry()]);
  const [savedDates, setSavedDates] = useState([]);
  const [viewDate, setViewDate] = useState('');
  const [viewData, setViewData] = useState([]);
  const [saved, setSaved] = useState(false);
  const [locationCounts, setLocationCounts] = useState({});
  const [activeView, setActiveView] = useState('entry'); // 'entry' | 'history' | 'stats'

  useEffect(() => {
    setSavedDates(getAllDates());
    setLocationCounts(getAnesthetistLocationCounts());
  }, [saved]);

  const addRow = () => setEntries(prev => [...prev, emptyEntry()]);
  const removeRow = (i) => setEntries(prev => prev.filter((_, idx) => idx !== i));
  const updateEntry = (i, field, value) => setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: value } : e));

  const handleSave = () => {
    if (!historyDate) return;
    const valid = entries.filter(e => e.anesthetist && e.location);
    // Build room-like objects for the history saver
    const roomObjects = valid.map(e => ({
      room: e.room || e.location,
      isEndo: e.location === 'endo',
      isBOOS: e.location === 'boos',
      isCathEP: e.location === 'cath_ep',
      blockRequired: false,
      isCardiac: e.location === 'cath_ep',
      isCareTeam: e.mdDirecting ? true : false,
      careTeamRatio: '1:3',
      anesthetist: e.anesthetist,
      assignedProvider: e.mdDirecting || null,
    }));
    saveFullDayHistory(historyDate, roomObjects);
    setSaved(s => !s);
    setSavedDates(getAllDates());
    setLocationCounts(getAnesthetistLocationCounts());
    setEntries([emptyEntry()]);
    setHistoryDate('');
    alert(`Saved ${valid.length} entries for ${historyDate}`);
  };

  const handleView = (date) => {
    setViewDate(date);
    setViewData(getHistoryForDate(date));
    setActiveView('history');
  };

  const handleDelete = (date) => {
    if (!confirm(`Delete all history for ${date}?`)) return;
    deleteHistoryDate(date);
    setSavedDates(getAllDates());
    if (viewDate === date) { setViewDate(''); setViewData([]); }
  };

  // Get anesthetists from QGenda if available, otherwise use default list
  const anesthetistList = qg?.Anesthetists?.filter(a => !a.isAdmin && !a.isOff).map(a => a.name) || ANESTHETISTS;

  return (
    <div>
      {/* Sub-navigation */}
      <div style={{display:'flex',gap:'4px',marginBottom:'20px',borderBottom:'1px solid var(--border)',paddingBottom:'0'}}>
        {[['entry','ENTER HISTORY'],['history','VIEW HISTORY'],['stats','ANESTHETIST STATS']].map(([id,label]) => (
          <button key={id} onClick={()=>setActiveView(id)} style={{
            background: activeView===id ? 'var(--bg-elevated)' : 'transparent',
            color: activeView===id ? 'var(--accent-blue)' : 'var(--text-muted)',
            border:'none', borderBottom: activeView===id ? '2px solid var(--accent-blue)' : '2px solid transparent',
            padding:'8px 14px', fontSize:'10px', letterSpacing:'2px', fontFamily:'var(--font-mono)', cursor:'pointer',
          }}>{label}</button>
        ))}
      </div>

      {/* ENTRY TAB */}
      {activeView === 'entry' && (
        <div>
          <span style={S.label}>ENTER PAST SCHEDULE DATA</span>
          <div style={{...S.card, marginBottom:'16px'}}>
            <div style={{marginBottom:'12px', display:'flex', gap:'12px', alignItems:'center'}}>
              <div>
                <span style={{...S.label, marginBottom:'4px'}}>DATE</span>
                <input type="date" value={historyDate} onChange={e=>setHistoryDate(e.target.value)}
                  style={{...S.select, width:'160px'}} />
              </div>
              {historyDate && <span style={{fontSize:'11px',color:'var(--accent-blue)',marginTop:'16px'}}>
                {new Date(historyDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}
              </span>}
            </div>

            {/* Column headers */}
            <div style={{...S.row, marginBottom:'4px'}}>
              <span style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px'}}>ANESTHETIST</span>
              <span style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px'}}>LOCATION TYPE</span>
              <span style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px'}}>ROOM</span>
              <span style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px'}}>MD DIRECTING</span>
              <span></span>
            </div>

            {entries.map((entry, i) => (
              <div key={i} style={S.row}>
                <select style={S.select} value={entry.anesthetist} onChange={e=>updateEntry(i,'anesthetist',e.target.value)}>
                  <option value="">— Select —</option>
                  {anesthetistList.map(a => <option key={a} value={a}>{a}</option>)}
                  <option value="FLOAT">FLOAT</option>
                </select>
                <select style={S.select} value={entry.location} onChange={e=>updateEntry(i,'location',e.target.value)}>
                  <option value="">— Location —</option>
                  {LOCATION_TYPES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
                <select style={S.select} value={entry.room} onChange={e=>updateEntry(i,'room',e.target.value)}>
                  <option value="">— Room —</option>
                  {ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <select style={S.select} value={entry.mdDirecting} onChange={e=>updateEntry(i,'mdDirecting',e.target.value)}>
                  <option value="">— MD (if care team) —</option>
                  {MDS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <button style={S.btnDanger} onClick={()=>removeRow(i)}>✕</button>
              </div>
            ))}

            <div style={{display:'flex',gap:'8px',marginTop:'12px'}}>
              <button style={S.btnSm} onClick={addRow}>+ Add Row</button>
              <button style={S.btn} onClick={handleSave} disabled={!historyDate}>
                SAVE HISTORY
              </button>
            </div>
          </div>

          {savedDates.length > 0 && (
            <div>
              <span style={S.label}>SAVED DATES ({savedDates.length})</span>
              <div style={{display:'flex',flexWrap:'wrap',gap:'6px'}}>
                {savedDates.map(d => (
                  <div key={d} style={{display:'flex',gap:'4px',alignItems:'center'}}>
                    <button style={S.btnSm} onClick={()=>handleView(d)}>{d}</button>
                    <button style={S.btnDanger} onClick={()=>handleDelete(d)}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* HISTORY VIEW TAB */}
      {activeView === 'history' && (
        <div>
          <div style={{display:'flex',gap:'12px',alignItems:'center',marginBottom:'16px'}}>
            <span style={S.label}>VIEW HISTORY</span>
            <select style={{...S.select,width:'160px'}} value={viewDate} onChange={e=>{setViewDate(e.target.value);setViewData(getHistoryForDate(e.target.value));}}>
              <option value="">— Select date —</option>
              {savedDates.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {viewData.length > 0 ? (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'8px',marginBottom:'6px'}}>
                {['ANESTHETIST','LOCATION','ROOM','MD DIRECTING'].map(h => (
                  <span key={h} style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px'}}>{h}</span>
                ))}
              </div>
              {viewData.map((e, i) => (
                <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:'8px',marginBottom:'5px',padding:'8px',background:'var(--bg-elevated)',borderRadius:'var(--radius-sm)'}}>
                  <span style={{fontSize:'11px',color:'var(--text-primary)'}}>{e.anesthetist}</span>
                  <span style={{fontSize:'11px',color:'var(--text-secondary)'}}>{LOCATION_TYPES.find(l=>l.value===e.location)?.label || e.location}</span>
                  <span style={{fontSize:'11px',color:'var(--text-secondary)'}}>{e.room || '—'}</span>
                  <span style={{fontSize:'11px',color:'var(--text-muted)'}}>{e.mdDirecting || '—'}</span>
                </div>
              ))}
            </div>
          ) : viewDate ? (
            <div style={{color:'var(--text-muted)',fontSize:'11px'}}>No data for this date.</div>
          ) : null}
        </div>
      )}

      {/* STATS TAB */}
      {activeView === 'stats' && (
        <div>
          <span style={S.label}>ANESTHETIST LOCATION HISTORY</span>
          <div style={{fontSize:'10px',color:'var(--text-muted)',marginBottom:'12px'}}>
            Tracks how many times each anesthetist has been assigned to each location type. Used to ensure variety in assignments.
          </div>
          {Object.keys(locationCounts).length === 0 ? (
            <div style={{color:'var(--text-muted)',fontSize:'11px'}}>No history data yet. Enter past schedules on the Entry tab.</div>
          ) : (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'1fr repeat(6, auto)',gap:'8px',marginBottom:'8px',padding:'6px 10px'}}>
                <span style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px'}}>ANESTHETIST</span>
                {LOCATION_TYPES.map(l => <span key={l.value} style={{fontSize:'9px',color:'var(--text-muted)',letterSpacing:'1px',textAlign:'center'}}>{l.label.split(' ')[0].toUpperCase()}</span>)}
              </div>
              {Object.entries(locationCounts).sort(([a],[b])=>a.localeCompare(b)).map(([name, counts]) => (
                <div key={name} style={{display:'grid',gridTemplateColumns:'1fr repeat(6, auto)',gap:'8px',padding:'7px 10px',background:'var(--bg-elevated)',borderRadius:'var(--radius-sm)',marginBottom:'4px',alignItems:'center'}}>
                  <span style={{fontSize:'11px',color:'var(--text-primary)'}}>{name}</span>
                  {LOCATION_TYPES.map(l => {
                    const count = counts[l.value] || 0;
                    const max = Math.max(...Object.values(counts));
                    const isHigh = count > 0 && count === max;
                    return (
                      <span key={l.value} style={{
                        fontSize:'11px', textAlign:'center',
                        color: isHigh ? 'var(--accent-amber)' : count > 0 ? 'var(--text-secondary)' : 'var(--text-faint)',
                        fontWeight: isHigh ? '600' : 'normal',
                      }}>{count || '—'}</span>
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
