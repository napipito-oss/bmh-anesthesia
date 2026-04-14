// ─────────────────────────────────────────────────────────────
// PARSING UTILITIES — v3
// Philosophy: CAPTURE EVERYTHING, then filter known exclusions.
// ─────────────────────────────────────────────────────────────

import { SURGEON_BLOCKS } from '../data/surgeons.js';

const EP_ANES_SURGEONS = ['Rose', 'Almnajam'];
const NO_DEVICE_ANES_SURGEONS = ['Moran', 'Graham', 'Rivera Maza', 'Wagle', 'Saleb', 'Madmani'];

function needsAnesthesia(procedure, surgeon, room) {
  const proc = (procedure || '').toLowerCase();
  const rm = (room || '').toLowerCase();
  const surgLast = (surgeon || '').split(',')[0].trim();

  if (rm.includes('zno anes') || rm.includes('z no anes') || proc.includes('zno anes'))
    return { needs: false, reason: 'No anesthesia room' };

  const radioKeywords = ['ct scan','ct liver','ct adrenal','ct bone','ct chest','ct abdomen',
    'mri','x-ray','bone marrow biopsy','lumbar puncture','lp procedure','myelogram',
    'kyphoplasty','vertebral augmentation'];
  if (radioKeywords.some(k => proc.includes(k)))
    return { needs: false, reason: 'Radiology/non-procedure' };

  if (proc.includes('manometry'))
    return { needs: false, reason: 'Manometry — no anesthesia' };

  if (rm.includes('endo bs') || rm.includes('endobs'))
    return { needs: false, reason: 'Endo BS room — no anesthesia' };

  if ((proc.includes('left heart cath') || proc.includes('right heart cath') ||
       proc.includes('heart cath') || proc.includes('cardiac catheterization')) &&
      !proc.includes('tee') && !proc.includes('transesophageal'))
    return { needs: false, reason: 'Heart cath — no anesthesia' };

  // Loop recorder — ALWAYS no anesthesia, no exceptions
  if (proc.includes('loop recorder'))
    return { needs: false, reason: 'Loop recorder — no anesthesia (all surgeons)' };

  if (proc.includes('tee') || proc.includes('transesophageal'))
    return { needs: true, reason: 'TEE — always needs anesthesia', cardiac: true };

  if (proc.includes('cardioversion'))
    return { needs: true, reason: 'Cardioversion — always needs anesthesia', cardiac: true };

  if (proc.includes('watchman'))
    return { needs: true, reason: 'Watchman — always needs anesthesia', cardiac: true };

  const isEP = proc.includes('ep study') || proc.includes('electrophysiology') ||
    proc.includes('ablation') || proc.includes('afib') || proc.includes('a fib') ||
    proc.includes('affera') || proc.includes('atrial fib');
  if (isEP) {
    if (EP_ANES_SURGEONS.includes(surgLast))
      return { needs: true, reason: `EP case — ${surgLast} requires anesthesia`, cardiac: true };
    return { needs: false, reason: `EP case — ${surgLast} does not use anesthesia for EP` };
  }

  const isDevice = proc.includes('pacemaker') || proc.includes(' icd') ||
    proc.includes('biventricular') || proc.includes('biv ') ||
    proc.includes('generator change') || proc.includes('defibrillator') ||
    proc.includes('device implant') || proc.includes('device removal');
  if (isDevice) {
    if (EP_ANES_SURGEONS.includes(surgLast))
      return { needs: true, reason: `Device case — ${surgLast} requires anesthesia`, cardiac: true };
    if (NO_DEVICE_ANES_SURGEONS.includes(surgLast))
      return { needs: false, reason: `Device case — ${surgLast} does not use anesthesia` };
    return { needs: true, reason: `Device case — ${surgLast} preference unknown`, flag: true, cardiac: true };
  }

  if (rm.includes('rir') || rm.includes('ir 2') || rm.includes('ir 1') || proc.includes('cryoablation'))
    return { needs: true, reason: 'IR case — needs anesthesia' };

  return { needs: true, reason: 'Standard case' };
}

export function parseQGenda(raw) {
  if (!raw?.trim()) return null;
  const result = {
    date: null, ORCall: null, BackUpCall: null, OBCall: null,
    CardiacCall: null, BackupCV: null, SevenEightShift: null,
    PostOR: [], PostOB: [], PTO: [], OFF: [],
    Ranks: {}, Locums: [], Anesthetists: [], workingMDs: [], notAvailable: [],
  };
  const assigned = new Set();
  for (const line of raw.trim().split('\n')) {
    const parts = line.split('\t').map(p => p.trim());
    const roleRaw = parts[0]?.trim() || '';
    const name = parts[1]?.trim() || '';
    const rl = roleRaw.toLowerCase();
    if (!roleRaw || !name || name.length < 2) continue;
    const skipWords = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday',
      'january','february','march','april','may','june','july','august','september',
      'october','november','december','scheduled','grand total'];
    if (skipWords.some(w => rl.includes(w))) { const dm = roleRaw.match(/(\w+ \d+, \d{4})/); if (dm) result.date = dm[1]; continue; }
    const rankM = rl.match(/rank #(\d+)/);
    if (rankM) { result.Ranks[parseInt(rankM[1])] = name; continue; }
    if (rl.includes('anesthetist') || rl.includes('crna')) {
      const shiftM = roleRaw.match(/(630a-730p|7a-3p|7a-5p|7a-8p|7a-7p)/i);
      const isAdmin = rl.includes('admin');
      const isOff = rl.includes('off/pto') || (rl.includes('off') && rl.includes('pto'));
      if (!isOff) result.Anesthetists.push({ name, shift: shiftM?.[1] || '7a-5p', isAdmin, isOff: false });
      continue;
    }
    if (name && !assigned.has(name)) {
      assigned.add(name);
      if (rl.includes('personal time off')) result.PTO.push(name);
      else if (rl.trim() === 'off') result.OFF.push(name);
      else if (rl.includes('post or')) result.PostOR.push(name);
      else if (rl.includes('post ob')) result.PostOB.push(name);
      else if (rl.includes('or call') && !rl.includes('post') && !rl.includes('back')) result.ORCall = name;
      else if (rl.includes('back up call') || rl.includes('backup call')) result.BackUpCall = name;
      else if (rl.includes('ob call')) result.OBCall = name;
      else if (rl.includes('cardiac call')) result.CardiacCall = name;
      else if (rl.includes('backup cv')) result.BackupCV = name;
      else if (rl.includes('7/8 hour shift')) result.SevenEightShift = name;
      else if (rl.includes('locum')) result.Locums.push(name);
    }
  }
  const addMD = (name, role, rankNum) => { if (name && !result.workingMDs.find(p => p.name === name)) result.workingMDs.push({ name, role, rankNum }); };
  addMD(result.ORCall, 'OR Call (#1)', 1);
  addMD(result.BackUpCall, 'Back Up Call (#2)', 2);
  addMD(result.CardiacCall, 'Cardiac Call (CV)', 0);
  addMD(result.BackupCV, 'Backup CV', 0);
  addMD(result.OBCall, 'OB Call', 0);
  addMD(result.SevenEightShift, '7/8 Hr Shift', 99);
  Object.entries(result.Ranks).sort(([a],[b]) => parseInt(a)-parseInt(b)).forEach(([num, name]) => addMD(name, `Rank #${num}`, parseInt(num)));
  result.Locums.forEach(name => addMD(name, 'Locum', 50));
  result.notAvailable = [...result.PTO.map(n => ({name:n,reason:'PTO'})),...result.OFF.map(n => ({name:n,reason:'OFF'})),...result.PostOR.map(n => ({name:n,reason:'Post OR — off-site'})),...result.PostOB.map(n => ({name:n,reason:'Post OB — off-site'}))];
  return result;
}

export function classifyCase(procedure, surgeon, room) {
  const proc = (procedure || '').toLowerCase();
  const rm = (room || '').toLowerCase();
  const surgLast = (surgeon || '').split(',')[0].trim();
  const surgProfile = SURGEON_BLOCKS[surgLast];
  const flags = [];
  let acuity = 'routine', caseType = 'general', blockRequired = false, blockPossible = false, blockNote = '';
  let isCathEP = false, isCardiac = false, isThoracic = false, isEndo = false, isBOOS = false;
  let isFastTurnover = false, isRobotic = false;
  let preferredProviders = [], avoidProviders = [];

  if (rm.includes('endo') || ['colonoscopy','egd','eus','ercp','bronch','ebus'].some(k => proc.includes(k))) { isEndo = true; caseType = 'endo'; preferredProviders.push('Brand, David L'); }
  if (rm.includes('cl ') || rm.includes('cath') || rm.includes('yanes') || rm.includes('ep lab')) { isCathEP = true; caseType = 'cath_ep'; acuity = 'cardiac'; flags.push({ level:'critical', msg:'Cardiac/EP — route through cardiac decision tree' }); }
  if (rm.includes('boos')) { isBOOS = true; preferredProviders.push('Pipito, Nicholas A','DeWitt, Bracken J'); avoidProviders.push('Eskew, Gregory S','Brand, David L'); flags.push({ level:'warn', msg:'BOOS — Eskew avoids; Pipito or DeWitt preferred' }); }
  if (rm.includes('rir') || rm.includes('ir 2') || rm.includes('ir 1')) flags.push({ level:'info', msg:'IR case — cell/wifi issues, avoid care teams' });
  if (['open heart','cabg','coronary bypass','valve replacement','valve repair','tavr','transcatheter aortic'].some(k => proc.includes(k))) { isCardiac = true; acuity = 'cardiac'; flags.push({ level:'critical', msg:'Open Heart/TAVR — CV primary MDs only' }); }
  if (!isCardiac && ['watchman','tee','transesophageal','cardioversion'].some(k => proc.includes(k))) { isCathEP = true; acuity = 'cardiac'; }
  if (['lobectomy','pneumonectomy','thoracotomy','vats','esophagectomy','thoracic'].some(k => proc.includes(k))) { isThoracic = true; acuity = 'high'; preferredProviders.push('Kane, Paul','Thomas, Michael','Munro, Jonathan'); flags.push({ level:'warn', msg:'Thoracic — CV team first; fallback: DeWitt, Pipito, Wu, Kuraganti, Eskew' }); }
  if (surgLast === 'El-Amir') { flags.push({ level:'critical', msg:'El-Amir — cardiac anesthesia required. Very particular.' }); acuity = 'cardiac'; }

  if (surgProfile) {
    const rule = surgProfile.blockRule, neverAll = surgProfile.neverBlock?.includes('all');
    if (rule === 'always') { blockRequired = true; blockPossible = true; blockNote = surgProfile.notes; }
    else if (rule === 'never' || neverAll) { blockRequired = false; blockPossible = false; blockNote = surgProfile.notes; }
    else if (rule === 'usually') { const isNev = surgProfile.neverBlock?.some(n => proc.includes(n)); blockRequired = !isNev; blockPossible = !isNev; blockNote = surgProfile.notes; }
    else if (['specific','selective'].includes(rule)) { const m = surgProfile.blockCases?.some(bc => proc.includes(bc.toLowerCase())); blockRequired = m; blockPossible = m; blockNote = surgProfile.notes; }
    else if (rule === 'offered') { blockRequired = false; blockPossible = true; blockNote = surgProfile.notes; }
    else if (rule === 'appropriate') { blockRequired = false; blockPossible = true; blockNote = surgProfile.notes; }
    else if (rule === 'rarely') { blockRequired = false; blockPossible = proc.includes('open') || proc.includes('laparotomy'); blockNote = surgProfile.notes; }
    else if (rule === 'mood-dependent') { blockRequired = false; blockPossible = true; blockNote = surgProfile.notes; flags.push({ level:'warn', msg:`${surgLast}: ${surgProfile.notes}` }); }
    if (surgProfile.flags?.length) surgProfile.flags.forEach(f => flags.push({ level:'warn', msg:f }));
  } else {
    const neuroKw = ['craniotomy','brain','laminectomy','spinal fusion','spine','discectomy','foraminotomy','interbody'];
    if (neuroKw.some(k => proc.includes(k))) { blockRequired = false; blockPossible = false; blockNote = 'No blocks — neurosurgery/spine'; }
    else { blockNote = `${surgLast} not in surgeon DB`; flags.push({ level:'info', msg:`${surgLast} not profiled — confirm block preference` }); }
  }

  if (surgLast === 'Flack') flags.push({ level:'warn', msg:'Flack: often late to OR — build buffer time' });
  if (blockRequired) {
    preferredProviders.push('Nielson, Mark','Lambert','Powell, Jason','Pipito, Nicholas A');
    avoidProviders.push('Siddiqui','Singh, Karampal','DeWitt, Bracken J','Raghove, Vikas','Raghove, Punam','Brand, David L','Fraley');
    const isShoulder = proc.includes('shoulder') || proc.includes('rotator') || proc.includes('bicep tenodesis');
    flags.push({ level: isShoulder ? 'critical' : 'warn', msg:`Block required${surgProfile?.blockTypes?` (${surgProfile.blockTypes.join(', ')})`:''} — Nielson (1st), Lambert/Powell (2nd), Pipito (3rd)` });
  }
  if (['tonsil','adenoid','myringotomy','ear tube','tympanostomy'].some(k => proc.includes(k))) {
    acuity = 'peds'; preferredProviders.push('DeWitt, Bracken J','Pipito, Nicholas A'); avoidProviders.push('Raghove, Punam','Brand, David L','Fraley'); flags.push({ level:'warn', msg:'Peds — DeWitt or Pipito first' });
  }
  if (proc.includes('robotic') || proc.includes('davinci') || proc.includes('da vinci')) {
    isRobotic = true;
    if (!isEndo) { preferredProviders.push('Eskew, Gregory S','Pipito, Nicholas A'); flags.push({ level:'info', msg:'Robotic — Eskew preferred (solo)' }); }
  }
  if (proc.includes('cystoscopy') || proc.includes('cysto') || proc.includes('turbt') || proc.includes('turp')) {
    isFastTurnover = true; preferredProviders.push('Eskew, Gregory S','DeWitt, Bracken J','Pipito, Nicholas A'); avoidProviders.push('Raghove, Punam','Raghove, Vikas','Gathings, Vincent','Fraley'); flags.push({ level:'info', msg:'Fast turnover room' });
  }
  if (['craniotomy','brain','aaa','aortic aneurysm','trauma','tracheostomy'].some(k => proc.includes(k))) {
    acuity = 'high'; avoidProviders.push('Raghove, Punam','Brand, David L','Fraley'); flags.push({ level:'warn', msg:'High acuity — experienced provider required' });
  }
  return { acuity, caseType, isFastTurnover, isRobotic, isCathEP, isCardiac, isThoracic, isEndo, isBOOS, blockRequired, blockPossible, blockNote, preferredProviders:[...new Set(preferredProviders)], avoidProviders:[...new Set(avoidProviders)], flags };
}

export function parseCubeData(raw, forceDateStr) {
  if (!raw?.trim()) return { rooms:[], excluded:[], flagged:[], targetDate:null, totalParsed:0 };
  const lines = raw.trim().split('\n');
  const allCases = [];
  let currentDate = null, currentArea = null;

  for (const line of lines) {
    const parts = line.split('\t').map(p => p?.trim() || '');
    if (parts.every(p => !p)) continue;
    const firstCol = parts[0].trim();
    const skipHeaders = ['scheduled surgical area','scheduled start','scheduled location','grand total','printed:','scheduled start hierarchy'];
    if (skipHeaders.some(h => firstCol.toLowerCase().startsWith(h))) continue;
    const hasDate = firstCol.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
    const hasCaseNum = firstCol.match(/BMH[A-Z]+-\d{4}-\d+|BOOS-\d{4}-\d+/i);
    const looksLikeArea = firstCol && !hasDate && !hasCaseNum && firstCol === firstCol.toUpperCase() && firstCol.length > 2 && !firstCol.match(/^\d/) && parts.filter(p=>p).length < 5;
    if (looksLikeArea) { currentArea = firstCol; continue; }
    for (const p of parts.slice(0,2)) { const dm = p.match(/(\d{1,2}\/\d{1,2}\/\d{4})/); if (dm) { currentDate = dm[1]; break; } }
    const caseP = parts.find(p => /BMH[A-Z]+-\d{4}-\d+|BOOS-\d{4}-\d+/i.test(p));
    if (!caseP) continue;
    const roomP = parts.find(p => /BMH\s+(OR\s+\d+|Endo\s+\d+|CL\s+\d+|CL\s+Minor|yAnes|BOOS|rIR|IR\s+\d+|Endo\s+BS)/i.test(p) || /BOOS\s+OR\s+\d+/i.test(p)) || '';
    const surgP = parts.find(p => /[A-Z][a-z]+,\s+[A-Z].*(?:MD|DO|DPM)/i.test(p)) || '';
    const surgIdx = parts.indexOf(surgP);
    const cleanProc = (surgIdx>=0 && surgIdx+1<parts.length ? parts[surgIdx+1] : '').replace(/\s+\d+$/, '').trim();
    const encP = parts.find(p => /OUTPATIENT|INPATIENT|EMERGENCY|PREADMIT|OBSERVATION/i.test(p)) || '';
    const detectedArea = currentArea ||
      (roomP.toLowerCase().includes('cl ') || roomP.toLowerCase().includes('cath') ? 'BMH CATH LAB' :
       roomP.toLowerCase().includes('endo') ? 'BMH ENDO' :
       roomP.toLowerCase().includes('yanes') ? 'BMH CATH LAB' :
       roomP.toLowerCase().includes('boos') ? 'BOOS OR' :
       roomP.toLowerCase().includes('rir') ? 'BMH IR' : 'BMH OR');
    const anesCheck = needsAnesthesia(cleanProc, surgP, roomP);
    allCases.push({ date:currentDate, caseNumber:caseP, room:roomP, area:detectedArea, encounterType:encP, surgeon:surgP, procedure:cleanProc, needsAnesthesia:anesCheck.needs, anesReason:anesCheck.reason, anesFlag:anesCheck.flag||false, manuallyAdded:false });
  }

  const dateCounts = {};
  allCases.forEach(c => { if (c.date) dateCounts[c.date]=(dateCounts[c.date]||0)+1; });

  // If user selected a date, convert from YYYY-MM-DD to M/D/YYYY format to match cube data
  let targetDate;
  if (forceDateStr) {
    const d = new Date(forceDateStr + 'T12:00:00');
    targetDate = `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
  } else {
    const today = new Date().toLocaleDateString('en-US');
    targetDate = dateCounts[today] ? today : Object.entries(dateCounts).sort((a,b)=>b[1]-a[1])[0]?.[0];
  }
  const todayCases = allCases.filter(c => c.date === targetDate);
  const needsCoverage = todayCases.filter(c => c.needsAnesthesia);
  const excluded = todayCases.filter(c => !c.needsAnesthesia);
  const flagged = todayCases.filter(c => c.anesFlag);
  const roomMap = {};
  for (const c of needsCoverage) { const key = c.room || `${c.area}-unknown`; if (!roomMap[key]) roomMap[key]=[]; roomMap[key].push(c); }
  const roomAssignments = Object.entries(roomMap).map(([room, roomCases]) => {
    const allIntel = roomCases.map(c => classifyCase(c.procedure, c.surgeon, c.room));
    const acuity = allIntel.some(i=>i.acuity==='cardiac')?'cardiac':allIntel.some(i=>i.acuity==='high')?'high':allIntel.some(i=>i.acuity==='peds')?'peds':allIntel.some(i=>i.acuity==='medium-high')?'medium-high':'routine';
    return { room, area:roomCases[0].area, cases:roomCases, caseCount:roomCases.length, surgeons:[...new Set(roomCases.map(c=>c.surgeon))], startTime:roomCases[0].date, acuity, blockRequired:allIntel.some(i=>i.blockRequired), blockPossible:allIntel.some(i=>i.blockPossible), isCathEP:allIntel.some(i=>i.isCathEP), isCardiac:allIntel.some(i=>i.isCardiac), isThoracic:allIntel.some(i=>i.isThoracic), isEndo:allIntel.some(i=>i.isEndo), isBOOS:allIntel.some(i=>i.isBOOS), preferredProviders:[...new Set(allIntel.flatMap(i=>i.preferredProviders))], avoidProviders:[...new Set(allIntel.flatMap(i=>i.avoidProviders))], flags:allIntel.flatMap(i=>i.flags), assignedProvider:null, caseStatus:'Not Started', cardiacNote:'', manuallyAdded:false };
  }).sort((a,b)=>a.room.localeCompare(b.room));
  return { rooms:roomAssignments, excluded, flagged, targetDate, totalParsed:todayCases.length };
}

export function cardiacDecisionTree(rooms, cvCallMD, backupCVMD) {
  const result = rooms.map(r=>({...r}));
  let cvCallOccupied=false, backupCVOccupied=false;
  const getTier = proc => { const p=(proc||'').toLowerCase(); if (['open heart','cabg','bypass','valve replacement','valve repair','tavr','transcatheter aortic'].some(k=>p.includes(k))) return 1; if (['thoracic','lobectomy','pneumonectomy','thoracotomy','vats','esophagectomy'].some(k=>p.includes(k))) return 2; if (p.includes('watchman')) return 3; if (['ep study','electrophysiology','ablation','afib','a fib','affera'].some(k=>p.includes(k))) return 4; if (['tee','transesophageal','cardioversion'].some(k=>p.includes(k))) return 5; return 0; };
  for (const room of result) {
    if (!room.isCathEP&&!room.isCardiac&&!room.isThoracic) continue;
    const topTier=Math.min(...room.cases.map(c=>getTier(c.procedure)).filter(t=>t>0),99);
    if (topTier===99) continue;
    const isWatchman=room.cases.some(c=>(c.procedure||'').toLowerCase().includes('watchman'));
    let assignedTo=null, note='';
    if (topTier===1) { if (!cvCallOccupied){assignedTo=cvCallMD;cvCallOccupied=true;note='CV Call — open heart/TAVR';}else if(!backupCVOccupied){assignedTo=backupCVMD;backupCVOccupied=true;note='Backup CV — simultaneous open heart';}else{note='⚠ Both CV occupied — use Pond or Dodwani';} }
    else if (topTier===2) { if (!cvCallOccupied){assignedTo=cvCallMD;cvCallOccupied=true;note='CV Call — thoracic';}else if(!backupCVOccupied){assignedTo=backupCVMD;backupCVOccupied=true;note='Backup CV — thoracic';}else{note='CV team occupied — assign thoracic-capable general MD';} }
    else if (isWatchman) { if (backupCVMD==='Munro, Jonathan'&&!backupCVOccupied){assignedTo='Munro, Jonathan';backupCVOccupied=true;note='Munro — Watchman (complex TEE)';}else if(!backupCVOccupied){assignedTo=backupCVMD;backupCVOccupied=true;note='Backup CV — Watchman';}else if(!cvCallOccupied){assignedTo=cvCallMD;cvCallOccupied=true;note='CV Call — Watchman';}else{note='⚠ Both CV occupied — general MD for Watchman, confirm TEE';} }
    else if (topTier<=4) { if (!backupCVOccupied){assignedTo=backupCVMD;backupCVOccupied=true;note='Backup CV — EP/ablation';}else if(!cvCallOccupied){assignedTo=cvCallMD;cvCallOccupied=true;note='CV Call — EP';}else{note='Both CV occupied — general MD for EP';} }
    else { if (!backupCVOccupied){assignedTo=backupCVMD;backupCVOccupied=true;note='Backup CV — TEE/cardioversion';}else if(!cvCallOccupied){assignedTo=cvCallMD;cvCallOccupied=true;note='CV Call — TEE';}else{note='Both CV occupied — general MD OK for TEE';} }
    if (assignedTo) room.assignedProvider=assignedTo;
    room.cardiacNote=note;
  }
  return result;
}

export function buildAssignments(rooms, qg) {
  if (!rooms.length||!qg?.workingMDs?.length) return rooms;
  let result=rooms.map(r=>({...r}));
  const used=new Set();
  result=cardiacDecisionTree(result,qg.CardiacCall||qg.ORCall,qg.BackupCV);
  result.forEach(r=>{if(r.assignedProvider)used.add(r.assignedProvider);});
  const order=[...qg.workingMDs.filter(p=>p.role==='OR Call (#1)'),...qg.workingMDs.filter(p=>p.role==='Locum'),...qg.workingMDs.filter(p=>p.role==='Back Up Call (#2)'),...qg.workingMDs.filter(p=>p.rankNum>=3&&p.rankNum<50).sort((a,b)=>a.rankNum-b.rankNum),...qg.workingMDs.filter(p=>p.role==='7/8 Hr Shift')];
  const blockOrder=['Nielson, Mark','Lambert','Powell, Jason','Pipito, Nicholas A','Dodwani','Pond, William'];
  for (const room of result) { if (room.assignedProvider||!room.blockRequired) continue; for (const name of blockOrder) { const p=order.find(p=>p.name===name&&!used.has(p.name)); if(p){room.assignedProvider=p.name;used.add(p.name);break;} } }
  for (const room of result) { if (room.assignedProvider||!room.isEndo) continue; const brand=order.find(p=>p.name==='Brand, David L'&&!used.has(p.name)); if(brand){room.assignedProvider=brand.name;used.add(brand.name);} }
  const pedsOrder=['DeWitt, Bracken J','Pipito, Nicholas A'];
  for (const room of result) { if (room.assignedProvider||room.acuity!=='peds') continue; for (const name of pedsOrder) { const p=order.find(p=>p.name===name&&!used.has(p.name)); if(p){room.assignedProvider=p.name;used.add(p.name);break;} } }
  for (const room of result) { if (room.assignedProvider) continue; for (const provider of order) { if (used.has(provider.name)||room.avoidProviders?.includes(provider.name)) continue; room.assignedProvider=provider.name; used.add(provider.name); break; } }
  return result;
}
