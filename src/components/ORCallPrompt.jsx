import { useState, useEffect } from 'react';
import { getORCallPrediction, getORCallCount, getORCallSummary, classifyRoomType } from '../utils/orCallTracker.js';

const S = {
  overlay: {
    position:'fixed', inset:0, background:'rgba(0,0,0,0.75)',
    display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000,
  },
  modal: {
    background:'var(--bg-elevated)', border:'1px solid var(--border-bright)',
    borderRadius:'8px', padding:'24px', width:'480px', maxWidth:'90vw',
    boxShadow:'0 20px 60px rgba(0,0,0,0.6)',
  },
  title: { fontSize:'11px', color:'var(--accent-blue)', letterSpacing:'3px', marginBottom:'4px' },
  name: { fontSize:'18px', color:'var(--text-primary)', fontWeight:'600', marginBottom:'4px', fontFamily:'var(--font-sans)' },
  sub: { fontSize:'10px', color:'var(--text-muted)', marginBottom:'16px' },
  label: { fontSize:'10px', color:'var(--text-secondary)', letterSpacing:'1px', marginBottom:'6px', display:'block' },
  select: { width:'100%', background:'var(--bg-base)', border:'1px solid var(--border-bright)', borderRadius:'var(--radius)', color:'var(--text-primary)', padding:'9px 12px', fontSize:'12px', fontFamily:'var(--font-mono)', cursor:'pointer', marginBottom:'14px' },
  btnRow: { display:'flex', gap:'8px', marginTop:'4px' },
  btnPrimary: { flex:1, background:'linear-gradient(135deg,#1d4ed8,#7c3aed)', color:'white', border:'none', borderRadius:'var(--radius)', padding:'10px', fontSize:'11px', letterSpacing:'2px', fontFamily:'var(--font-mono)', cursor:'pointer' },
  btnSecondary: { background:'var(--bg-surface)', color:'var(--text-secondary)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'10px 16px', fontSize:'11px', fontFamily:'var(--font-mono)', cursor:'pointer' },
  predicted: { background:'#f0fdf4', border:'1.5px solid #16a34a', borderRadius:'var(--radius)', padding:'10px 12px', marginBottom:'14px' },
  history: { background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'8px 12px', marginBottom:'14px', fontSize:'11px', color:'var(--text-muted)' },
};

export default function ORCallPrompt({ orCallProvider, rooms, anesthetistCount = 0, workingMDCount = 0, onConfirm, onSkip }) {
  const [choice, setChoice] = useState('available');
  const [prediction, setPrediction] = useState(null);
  const [callCount, setCallCount] = useState(0);
  const [summary, setSummary] = useState('');
  const [usedPrediction, setUsedPrediction] = useState(false);
  const [warning, setWarning] = useState('');

  useEffect(() => {
    if (!orCallProvider) return;
    const pred = getORCallPrediction(orCallProvider);
    const count = getORCallCount(orCallProvider);
    const sum = getORCallSummary(orCallProvider);
    setPrediction(pred);
    setCallCount(count);
    setSummary(sum);

    // Pre-fill with prediction if available
    if (pred.predicted) {
      if (pred.suggestion.type === 'available') {
        setChoice('available');
      } else {
        // Find best matching room from prediction
        const matchingRoom = findRoomByType(rooms, pred.suggestion.roomType);
        setChoice(matchingRoom?.room || 'available');
      }
      setUsedPrediction(true);
    }
  }, [orCallProvider]);

  const handleConfirm = () => {
    setWarning('');

    // ── "Available" feasibility check ───────────────────────────
    // OR Call can only be available if there's at least 1 provider more than
    // the minimum needed to cover all rooms without them.
    if (choice === 'available') {
      const nonCardiacRooms = rooms.filter(r => !r.isCardiac && !r.isCathEP);
      const endoCount  = nonCardiacRooms.filter(r => r.isEndo).length;
      const irCount    = nonCardiacRooms.filter(r => r.isIR).length;
      const boosCount  = nonCardiacRooms.filter(r => r.isBOOS).length;
      const mainCount  = nonCardiacRooms.filter(r => !r.isEndo && !r.isIR && !r.isBOOS).length;
      // Best-case: care teams cover main OR at 1:3; endo/BOOS/IR each need 1 MD
      const mdsNeeded =
        Math.ceil(mainCount / 3) +
        (endoCount > 0 ? 1 : 0) +
        (boosCount > 0 ? 1 : 0) +
        (irCount   > 0 ? 1 : 0);
      const mdsWithoutORCall = workingMDCount - 1;
      if (mdsWithoutORCall < mdsNeeded) {
        setWarning(
          `OR Call cannot be Available today — at least ${mdsNeeded} provider${mdsNeeded !== 1 ? 's' : ''} ` +
          `needed to cover all rooms, but only ${mdsWithoutORCall} available without them. ` +
          `Choose a room or Care Team instead.`
        );
        return;
      }
    }

    if (choice === 'careteam' && anesthetistCount < 2) {
      setWarning(`Cannot join a care team — only ${anesthetistCount} anesthetist${anesthetistCount === 1 ? '' : 's'} available today. Choose Available or a specific room instead.`);
      return;
    }
    if (choice === 'careteam') {
      const careTeamRooms = rooms.filter(r => !r.isCardiac && !r.isCathEP && !r.isIR && !r.isEndo);
      if (careTeamRooms.length === 0) {
        setWarning('No care-team-eligible rooms found in today\'s schedule. Choose Available or a specific room instead.');
        return;
      }
    }

    const type = choice === 'available' ? 'available'
               : choice === 'careteam'  ? 'careteam'
               : 'room';
    const selectedRoom = type === 'room' ? rooms.find(r => r.room === choice) : null;

    onConfirm({
      type,
      room: type === 'room' ? choice : null,
      roomType: type === 'room' ? classifyRoomType(choice, selectedRoom) : null,
      isChoice: true,
      isPredicted: usedPrediction,
    });
  };

  const roomOptions = [
    { value: 'available', label: '— Available (no room assignment) —' },
    { value: 'careteam',  label: '— Join a Care Team —' },
    ...rooms
      .filter(r => !r.isCardiac && !r.isCathEP)
      .map(r => ({
        value: r.room,
        label: `${r.room} — ${r.cases?.map(c=>c.procedure).join(' / ').slice(0,50) || r.acuity}${r.blockRequired?' [BLOCK]':''}${r.isRobotic?' [ROBOTIC]':''}`,
      }))
  ];

  if (!orCallProvider) return null;

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={S.title}>OR CALL ASSIGNMENT</div>
        <div style={S.name}>{orCallProvider}</div>
        <div style={S.sub}>OR Call today — what room do they want?</div>

        {/* Prediction banner */}
        {prediction?.predicted && (
          <div style={S.predicted}>
            <div style={{fontSize:'11px',color:'#15803d',fontWeight:'700',letterSpacing:'1px',marginBottom:'3px'}}>
              PREDICTED PREFERENCE ({Math.round(prediction.confidence * 100)}% confidence, {prediction.callCount} prior calls)
            </div>
            <div style={{fontSize:'11px',color:'var(--text-primary)'}}>
              {prediction.suggestion.type === 'available'
                ? 'Usually takes "Available" — no room assignment'
                : `Usually wants a ${prediction.suggestion.roomType?.replace('_',' ')} room`}
            </div>
          </div>
        )}

        {/* History summary */}
        {callCount > 0 && (
          <div style={S.history}>
            {summary}
          </div>
        )}

        {callCount < 10 && (
          <div style={{fontSize:'10px',color:'var(--text-muted)',marginBottom:'12px'}}>
            {callCount === 0 ? 'First time as OR Call — no history yet.' : `${callCount}/10 OR Call builds logged. Prediction unlocks at 10.`}
          </div>
        )}

        <span style={S.label}>ROOM CHOICE</span>
        <select
          style={S.select}
          value={choice}
          onChange={e => { setChoice(e.target.value); setUsedPrediction(false); }}
        >
          {roomOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {warning && (
          <div style={{background:'#fef2f2',border:'1.5px solid #dc2626',borderRadius:'var(--radius)',padding:'8px 12px',marginBottom:'10px',fontSize:'12px',color:'#991b1b',lineHeight:'1.5',fontWeight:'600'}}>
            ⚠ {warning}
          </div>
        )}

        <div style={S.btnRow}>
          <button style={S.btnSecondary} onClick={onSkip}>Skip for now</button>
          <button style={S.btnPrimary} onClick={handleConfirm}>
            CONFIRM CHOICE
          </button>
        </div>
      </div>
    </div>
  );
}

function findRoomByType(rooms, roomType) {
  if (!roomType || !rooms?.length) return null;
  return rooms.find(r => {
    switch(roomType) {
      case 'endo': return r.isEndo;
      case 'robotic': return r.isRobotic;
      case 'fast_turnover': return r.isFastTurnover;
      case 'block_room': return r.blockRequired;
      case 'high_acuity': return r.acuity === 'high';
      case 'boos': return r.isBOOS;
      default: return r.acuity === 'routine';
    }
  });
}
