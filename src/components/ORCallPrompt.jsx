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
  predicted: { background:'#0f2a1e', border:'1px solid #22c55e', borderRadius:'var(--radius)', padding:'10px 12px', marginBottom:'14px' },
  history: { background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'8px 12px', marginBottom:'14px', fontSize:'10px', color:'var(--text-muted)' },
};

export default function ORCallPrompt({ orCallProvider, rooms, onConfirm, onSkip }) {
  const [choice, setChoice] = useState('available');
  const [prediction, setPrediction] = useState(null);
  const [callCount, setCallCount] = useState(0);
  const [summary, setSummary] = useState('');
  const [usedPrediction, setUsedPrediction] = useState(false);

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
    const selectedRoom = rooms.find(r => r.room === choice);
    onConfirm({
      type: choice === 'available' ? 'available' : 'room',
      room: choice === 'available' ? null : choice,
      roomType: choice === 'available' ? null : classifyRoomType(choice, selectedRoom),
      isChoice: true,
      isPredicted: usedPrediction,
    });
  };

  const roomOptions = [
    { value: 'available', label: '— Available (no room assignment) —' },
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
            <div style={{fontSize:'9px',color:'#4ade80',letterSpacing:'2px',marginBottom:'3px'}}>
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
