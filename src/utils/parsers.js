// ─────────────────────────────────────────────────────────────
// PARSING UTILITIES — v5.1
// v4.2:
//   - OB Call excluded from workingMDs
//   - OR Call provider removed from fill order after choice applied
//   - BMH WL relabel (removed in v5.0)
// v5.0:
//   - QGenda parser recognizes "Month Day, Year" date lines
//   - CardioMEMS procedures excluded (RN-administered)
//   - Dr. Alalwan excluded entirely (RN-administered)
//   - WL rooms no longer relabeled as phantom Add-On rooms
//   - OR.endo.CCL Main OR number enforced as hard ceiling
// v5.1:
//   - parseCubeData accepts committedCath; generates Cath Lab Add-On
//     phantom rooms when committedCath > visible cath rooms
//   - cardiacDecisionTree restructured as two-pass assignment:
//     Layer 1 — Tier 1 & 2 cases (open heart, TAVR, thoracic) first
//     Layer 2 — remaining CV MDs to cath rooms with minors-preference
//     (CV Call → minors/phantom, Backup CV → EP) for easier extraction
//     if open-heart emergency arises
//     Cath rooms with no CV MD left flow to standard general fill.
// ─────────────────────────────────────────────────────────────
import { SURGEON_BLOCKS } from '../data/surgeons.js';
 
const EP_ANES_SURGEONS = ['Rose', 'Almnajam'];
const NO_DEVICE_ANES_SURGEONS = ['Moran', 'Graham', 'Rivera Maza', 'Wagle', 'Saleb', 'Madmani'];
 
// Procedures we never cover — RN-administered sedation or no sedation needed.
// Cases are filtered out of the case list entirely.
const NO_ANESTHESIA_PROCEDURES = ['cardiomems', 'cardiomem'];
 
// Surgeons whose cases we never cover — RN-administered sedation for all procedures.
// Cases filtered out of the case list entirely.
const NO_ANESTHESIA_SURGEONS = ['Alalwan'];
 
export function classifyRoom(roomStr) {
  const r = (roomStr || '').toLowerCase();
  const isIR     = /\brir\b/.test(r) || /\bir\s*[12]\b/.test(r) || r.includes('ir suite');
  const isEndo   = r.includes('endo') || r.includes('gi ');
  const isCathEP = r.includes('cl ') || r.includes('cath') ||
    r.includes('yanes') || r.includes('ep lab') || r.includes('ep ');
  const isBOOS   = r.includes('boos');
  const isAddOn  = /\bwl\b/i.test(roomStr || '');   // tightened: word-boundary match
  const isMainOR = !isIR && !isEndo && !isCathEP && !isBOOS;
 
  let building;
  if (isBOOS)        building = 'BOOS';
  else if (isIR)     building = 'IR';
  else if (isEndo)   building = 'ENDO_FLOOR';
  else if (isCathEP) building = 'CATH_FLOOR';
  else               building = 'MAIN_OR_FLOOR';
 
  return { building, isEndo, isCathEP, isBOOS, isIR, isMainOR, isAddOn };
}
 
function needsAnesthesia(procedure, surgeon, room) {
  const proc     = (procedure || '').toLowerCase();
  const rm       = (room || '').toLowerCase();
  const surgLast = (surgeon || '').split(',')[0].trim();
 
  if (rm.includes('zno anes') || rm.includes('z no anes') || proc.includes('zno anes'))
    return { needs: false, reason: 'No anesthesia room' };
 
  // CardioMEMS and similar — RN-administered, no anesthesia involvement
  if (NO_ANESTHESIA_PROCEDURES.some(k => proc.includes(k)))
    return { needs: false, reason: 'No anesthesia procedure — RN-administered sedation' };
 
  // Surgeon-level exclusion — all cases for these providers use RN-administered sedation
  if (NO_ANESTHESIA_SURGEONS.includes(surgLast))
    return { needs: false, reason: `${surgLast} — all cases RN-administered sedation` };
 
  const radioKeywords = [
    'ct scan', 'ct liver', 'ct adrenal', 'ct bone', 'ct chest', 'ct abdomen',
    'mri', 'x-ray', 'bone marrow biopsy', 'lumbar puncture', 'lp procedure',
    'myelogram', 'kyphoplasty', 'vertebral augmentation',
  ];
  if (radioKeywords.some(k => proc.includes(k)))
    return { needs: false, reason: 'Radiology/non-procedure' };
 
  if (proc.includes('manometry'))
    return { needs: false, reason: 'Manometry — no anesthesia' };
 
  if (rm.includes('endo bs') || rm.includes('endobs'))
    return { needs: false, reason: 'Endo BS room — no anesthesia' };
 
  if (
    (proc.includes('left heart cath') || proc.includes('right heart cath') ||
     proc.includes('heart cath') || proc.includes('cardiac catheterization')) &&
    !proc.includes('tee') && !proc.includes('transesophageal')
  )
    return { needs: false, reason: 'Heart cath — no anesthesia' };
 
  if (proc.includes('loop recorder'))
    return { needs: false, reason: 'Loop recorder — no anesthesia (all surgeons)' };
 
  if (proc.includes('pfo closure') || proc.includes('pfo repair') || proc.includes('patent foramen ovale'))
    return { needs: false, reason: 'PFO closure — no anesthesia' };
 
  if (proc.includes('tee') || proc.includes('transesophageal'))
    return { needs: true, reason: 'TEE — always needs anesthesia', cardiac: true };
 
  if (proc.includes('cardioversion'))
    return { needs: true, reason: 'Cardioversion — always needs anesthesia', cardiac: true };
 
  if (proc.includes('watchman'))
    return { needs: true, reason: 'Watchman — always needs anesthesia', cardiac: true };
 
  // IR room or cryoablation — always needs anesthesia, checked BEFORE EP logic
  // because 'cryoablation' contains 'ablation' which triggers the EP exclusion path
  if (classifyRoom(room).isIR || proc.includes('cryoablation'))
    return { needs: true, reason: 'IR/cryoablation — always needs anesthesia' };
 
  const isEP =
    proc.includes('ep study') || proc.includes('electrophysiology') ||
    proc.includes('ablation') || proc.includes('afib') || proc.includes('a fib') ||
    proc.includes('affera') || proc.includes('atrial fib');
  if (isEP) {
    if (EP_ANES_SURGEONS.includes(surgLast))
      return { needs: true, reason: `EP case — ${surgLast} requires anesthesia`, cardiac: true };
    return { needs: false, reason: `EP case — ${surgLast} does not use anesthesia for EP` };
  }
 
  const isDevice =
    proc.includes('pacemaker') || proc.includes(' icd') ||
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
 
  // IR/cryoablation check moved above EP logic
 
  return { needs: true, reason: 'Standard case' };
}
 
export function parseQGenda(raw, forceDateStr) {
  if (!raw?.trim()) return null;
 
  let targetDayName = null;
  let targetDateFormatted = null;
  let targetDateLower = null;
  if (forceDateStr) {
    const d = new Date(forceDateStr + 'T12:00:00');
    targetDayName       = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    targetDateFormatted = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    targetDateLower     = targetDateFormatted.toLowerCase();
  }
 
  const result = {
    date: targetDateFormatted,
    ORCall: null, OBCall: null,
    CardiacCall: null, BackupCV: null, SevenEightShift: null,
    BackUpCall: null, BackUpCallAAs: [], aaBackupCall: false,
    PostOR: [], PostOB: [], PTO: [], OFF: [],
    Ranks: {}, Locums: [], Anesthetists: [], workingMDs: [], notAvailable: [],
  };
 
  const assigned       = new Set();
  const backUpCallNames = [];
  const lines          = raw.trim().split('\n');
  let inTargetDay      = !forceDateStr;
 
  for (const line of lines) {
    const parts   = line.split('\t').map(p => p.trim());
    const roleRaw = parts[0]?.trim() || '';
    const name    = parts[1]?.trim() || '';
    const rl      = roleRaw.toLowerCase().trim();
 
    const isDayName  = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].includes(rl);
    const isDateLine = /^[a-z]+ \d+, \d{4}$/i.test(roleRaw.trim());
 
    if (isDayName)  { if (forceDateStr) inTargetDay = (rl === targetDayName); continue; }
    // Date lines (e.g. "April 20, 2026") also flip target-day mode when they match
    // the selected date. This handles QGenda exports that start with a date line
    // instead of a weekday name.
    if (isDateLine) {
      if (forceDateStr) inTargetDay = (rl === targetDateLower);
      continue;
    }
    if (!inTargetDay) continue;
    if (!roleRaw || !name || name.length < 2) continue;
 
    const rankM = rl.match(/rank #(\d+)/);
    if (rankM) {
      const rn = parseInt(rankM[1]);
      if (!result.Ranks[rn]) result.Ranks[rn] = [];
      result.Ranks[rn].push(name);
      continue;
    }
 
    if (rl.includes('anesthetist') || rl.includes('crna')) {
      const shiftM  = roleRaw.match(/(630a-730p|7a-3p|7a-5p|7a-8p|7a-7p)/i);
      const isAdmin = rl.includes('admin');
      const isOff   = rl.includes('off/pto') || (rl.includes('off') && rl.includes('pto'));
      if (!isOff && !result.Anesthetists.find(a => a.name === name))
        result.Anesthetists.push({ name, shift: shiftM?.[1] || '7a-5p', isAdmin, isOff: false });
      continue;
    }
 
    if (name && !assigned.has(name)) {
      assigned.add(name);
      if      (rl.includes('personal time off'))                                   result.PTO.push(name);
      else if (rl.trim() === 'off')                                                result.OFF.push(name);
      else if (rl.includes('post or'))                                             result.PostOR.push(name);
      else if (rl.includes('post ob'))                                             result.PostOB.push(name);
      else if (rl.includes('or call') && !rl.includes('post') && !rl.includes('back')) result.ORCall = name;
      else if (rl.includes('back up call') || rl.includes('backup call'))         backUpCallNames.push(name);
      else if (rl.includes('ob call'))                                             result.OBCall = name;
      else if (rl.includes('cardiac call'))                                        result.CardiacCall = name;
      else if (rl.includes('backup cv'))                                           result.BackupCV = name;
      else if (rl.includes('7/8 hour shift'))                                      result.SevenEightShift = name;
      else if (rl.includes('locum'))                                               result.Locums.push(name);
    }
  }
 
  const anesthetistNames = new Set(result.Anesthetists.map(a => a.name));
  const backUpAAs        = backUpCallNames.filter(n => anesthetistNames.has(n));
  const backUpMDs        = backUpCallNames.filter(n => !anesthetistNames.has(n));
 
  if (backUpAAs.length >= 2 && backUpMDs.length === 0) {
    result.aaBackupCall = true; result.BackUpCallAAs = backUpAAs; result.BackUpCall = null;
  } else if (backUpMDs.length >= 1) {
    result.BackUpCall = backUpMDs[0]; result.aaBackupCall = false;
  } else if (backUpAAs.length === 1) {
    result.aaBackupCall = true; result.BackUpCallAAs = backUpAAs; result.BackUpCall = null;
  }
 
  const addMD = (name, role, rankNum) => {
    if (name && !result.workingMDs.find(p => p.name === name))
      result.workingMDs.push({ name, role, rankNum });
  };
 
  addMD(result.ORCall,          'OR Call (#1)',      1);
  if (result.BackUpCall) addMD(result.BackUpCall, 'Back Up Call (#2)', 2);
  addMD(result.CardiacCall,     'Cardiac Call (CV)', 0);
  addMD(result.BackupCV,        'Backup CV',         0);
  // ── OB Call intentionally excluded from workingMDs ───────────
  // OB Call provider covers OB only — not available for OR assignments.
  // result.OBCall is still stored for reference but never added to workingMDs.
  addMD(result.SevenEightShift, '7/8 Hr Shift',     99);
 
  Object.entries(result.Ranks)
    .sort(([a],[b]) => parseInt(a) - parseInt(b))
    .forEach(([num, names]) => {
      const nameArr = Array.isArray(names) ? names : [names];
      nameArr.forEach(n => { if (!anesthetistNames.has(n)) addMD(n, `Rank #${num}`, parseInt(num)); });
    });
 
  result.Locums.forEach(name => addMD(name, 'Locum', 50));
 
  result.notAvailable = [
    ...result.PTO.map(n    => ({ name: n, reason: 'PTO' })),
    ...result.OFF.map(n    => ({ name: n, reason: 'OFF' })),
    ...result.PostOR.map(n => ({ name: n, reason: 'Post OR — off-site' })),
    ...result.PostOB.map(n => ({ name: n, reason: 'Post OB — off-site' })),
    // OB Call shown as unavailable so user knows where they are
    ...(result.OBCall ? [{ name: result.OBCall, reason: 'OB Call — covering OB' }] : []),
  ];
 
  return result;
}
 
export function classifyCase(procedure, surgeon, room) {
  const proc     = (procedure || '').toLowerCase();
  const surgLast = (surgeon || '').split(',')[0].trim();
  const surgProfile = SURGEON_BLOCKS[surgLast];
 
  const flags = [];
  let acuity = 'routine', caseType = 'general';
  let blockRequired = false, blockPossible = false, blockNote = '';
  let isCathEP = false, isCardiac = false, isThoracic = false;
  let isFastTurnover = false, isRobotic = false;
  let preferredProviders = [], avoidProviders = [];
 
  const roomType = classifyRoom(room);
 
  if (roomType.isEndo || ['colonoscopy','egd','eus','ercp','bronch','ebus'].some(k => proc.includes(k))) {
    caseType = 'endo';
    preferredProviders.push('Brand, David L');
  }
 
  if (roomType.isCathEP) {
    isCathEP = true; caseType = 'cath_ep'; acuity = 'cardiac';
    flags.push({ level: 'critical', msg: 'Cardiac/EP — route through cardiac decision tree' });
  }
 
  if (roomType.isBOOS) {
    caseType = 'boos';
    preferredProviders.push('Pipito, Nicholas A', 'DeWitt, Bracken J');
    avoidProviders.push('Eskew, Gregory S', 'Brand, David L');
    flags.push({ level: 'warn', msg: 'BOOS — Eskew avoids; Pipito or DeWitt preferred' });
  }
 
  if (roomType.isIR)
    flags.push({ level: 'info', msg: 'IR case — cell/wifi issues, avoid care teams' });
 
  if (['open heart','cabg','coronary bypass','valve replacement','valve repair','tavr','transcatheter aortic'].some(k => proc.includes(k))) {
    isCardiac = true; acuity = 'cardiac';
    flags.push({ level: 'critical', msg: 'Open Heart/TAVR — CV primary MDs only' });
  }
 
  if (!isCardiac && ['watchman','tee','transesophageal','cardioversion'].some(k => proc.includes(k))) {
    isCathEP = true; acuity = 'cardiac';
  }
 
  if (['lobectomy','pneumonectomy','thoracotomy','vats','esophagectomy','thoracic'].some(k => proc.includes(k))) {
    isThoracic = true; acuity = 'high';
    preferredProviders.push('Kane, Paul', 'Thomas, Michael', 'Munro, Jonathan');
    flags.push({ level: 'warn', msg: 'Thoracic — CV team first; fallback: DeWitt, Pipito, Wu, Kuraganti, Eskew' });
  }
 
  if (surgLast === 'El-Amir') {
    flags.push({ level: 'critical', msg: 'El-Amir — cardiac anesthesia required. Very particular.' });
    acuity = 'cardiac';
  }
 
  if (surgProfile) {
    const rule    = surgProfile.blockRule;
    const neverAll = surgProfile.neverBlock?.includes('all');
    if      (rule === 'always')      { blockRequired = true;  blockPossible = true;  blockNote = surgProfile.notes; }
    else if (rule === 'never' || neverAll)
                                      { blockRequired = false; blockPossible = false; blockNote = surgProfile.notes; }
    else if (rule === 'usually')     { const isNev = surgProfile.neverBlock?.some(n => proc.includes(n)); blockRequired = !isNev; blockPossible = !isNev; blockNote = surgProfile.notes; }
    else if (['specific','selective'].includes(rule)) { const m = surgProfile.blockCases?.some(bc => proc.includes(bc.toLowerCase())); blockRequired = m; blockPossible = m; blockNote = surgProfile.notes; }
    else if (rule === 'offered')     { blockRequired = false; blockPossible = true;  blockNote = surgProfile.notes; }
    else if (rule === 'appropriate') { blockRequired = false; blockPossible = true;  blockNote = surgProfile.notes; }
    else if (rule === 'rarely')      { blockRequired = false; blockPossible = proc.includes('open') || proc.includes('laparotomy'); blockNote = surgProfile.notes; }
    else if (rule === 'mood-dependent') { blockRequired = false; blockPossible = true; blockNote = surgProfile.notes; flags.push({ level: 'warn', msg: `${surgLast}: ${surgProfile.notes}` }); }
    if (surgProfile.flags?.length) surgProfile.flags.forEach(f => flags.push({ level: 'warn', msg: f }));
  } else {
    const neuroKw = ['craniotomy','brain','laminectomy','spinal fusion','spine','discectomy','foraminotomy','interbody'];
    if (neuroKw.some(k => proc.includes(k))) {
      blockRequired = false; blockPossible = false; blockNote = 'No blocks — neurosurgery/spine';
    } else {
      blockNote = `${surgLast} not in surgeon DB`;
      flags.push({ level: 'info', msg: `${surgLast} not profiled — confirm block preference` });
    }
  }
 
  if (surgLast === 'Flack')
    flags.push({ level: 'warn', msg: 'Flack: often late to OR — build buffer time' });
 
  if (blockRequired) {
    preferredProviders.push('Nielson, Mark', 'Lambert', 'Powell, Jason', 'Pipito, Nicholas A');
    avoidProviders.push('Siddiqui', 'Singh, Karampal', 'DeWitt, Bracken J', 'Raghove, Vikas', 'Raghove, Punam', 'Brand, David L', 'Fraley');
    const isShoulder = proc.includes('shoulder') || proc.includes('rotator') || proc.includes('bicep tenodesis');
    flags.push({ level: isShoulder ? 'critical' : 'warn', msg: `Block required${surgProfile?.blockTypes ? ` (${surgProfile.blockTypes.join(', ')})` : ''} — Nielson (1st), Lambert/Powell (2nd), Pipito (3rd)` });
  }
 
  if (['tonsil','adenoid','myringotomy','ear tube','tympanostomy'].some(k => proc.includes(k))) {
    acuity = 'peds';
    preferredProviders.push('DeWitt, Bracken J', 'Pipito, Nicholas A');
    avoidProviders.push('Raghove, Punam', 'Brand, David L', 'Fraley');
    flags.push({ level: 'warn', msg: 'Peds — DeWitt or Pipito first' });
  }
 
  if (proc.includes('robotic') || proc.includes('davinci') || proc.includes('da vinci')) {
    isRobotic = true;
    if (!roomType.isEndo) {
      preferredProviders.push('Eskew, Gregory S', 'Pipito, Nicholas A');
      flags.push({ level: 'info', msg: 'Robotic — Eskew preferred (solo)' });
    }
  }
 
  if (proc.includes('cystoscopy') || proc.includes('cysto') || proc.includes('turbt') || proc.includes('turp')) {
    isFastTurnover = true;
    preferredProviders.push('Eskew, Gregory S', 'DeWitt, Bracken J', 'Pipito, Nicholas A');
    avoidProviders.push('Raghove, Punam', 'Raghove, Vikas', 'Gathings, Vincent', 'Fraley');
    flags.push({ level: 'info', msg: 'Fast turnover room' });
  }
 
  if (['craniotomy','brain','aaa','aortic aneurysm','trauma','tracheostomy'].some(k => proc.includes(k))) {
    acuity = 'high';
    avoidProviders.push('Raghove, Punam', 'Brand, David L', 'Fraley');
    flags.push({ level: 'warn', msg: 'High acuity — experienced provider required' });
  }
 
  return {
    acuity, caseType, isFastTurnover, isRobotic,
    isCathEP, isCardiac, isThoracic,
    isEndo:   roomType.isEndo,
    isBOOS:   roomType.isBOOS,
    isIR:     roomType.isIR,
    building: roomType.building,
    blockRequired, blockPossible, blockNote,
    preferredProviders: [...new Set(preferredProviders)],
    avoidProviders:     [...new Set(avoidProviders)],
    flags,
  };
}
 
export function parseCubeData(raw, forceDateStr, mainORCommitted, committedCath) {
  if (!raw?.trim()) return { rooms: [], excluded: [], flagged: [], targetDate: null, totalParsed: 0 };
 
  const lines      = raw.trim().split('\n');
  const allCases   = [];
  let currentDate  = null;
  let currentArea  = null;
 
  for (const line of lines) {
    const parts    = line.split('\t').map(p => p?.trim() || '');
    if (parts.every(p => !p)) continue;
 
    const firstCol = parts[0].trim();
    const skipHeaders = [
      'scheduled surgical area', 'scheduled start', 'scheduled location',
      'grand total', 'printed:', 'scheduled start hierarchy',
    ];
    if (skipHeaders.some(h => firstCol.toLowerCase().startsWith(h))) continue;
 
    const hasDate    = firstCol.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
    const hasCaseNum = firstCol.match(/BMH[A-Z]+-\d{4}-\d+|BOOS-\d{4}-\d+/i);
    const looksLikeArea =
      firstCol && !hasDate && !hasCaseNum &&
      firstCol === firstCol.toUpperCase() &&
      firstCol.length > 2 && !firstCol.match(/^\d/) &&
      parts.filter(p => p).length < 5;
 
    if (looksLikeArea) { currentArea = firstCol; continue; }
 
    for (const p of parts.slice(0, 2)) {
      const dm = p.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
      if (dm) { currentDate = dm[1]; break; }
    }
 
    const caseP = parts.find(p => /BMH[A-Z]+-\d{4}-\d+|BOOS-\d{4}-\d+/i.test(p));
    if (!caseP) continue;
 
    const roomP = parts.find(p =>
      /BMH\s+(OR\s+\d+|Endo\s+\d+|CL\s+\d+|CL\s+Minor|yAnes|BOOS|rIR\s*\d*|IR\s+\d+|Endo\s+BS|WL\b)/i.test(p) ||
      /BOOS\s+OR\s+\d+/i.test(p)
    ) || '';
 
    const surgP     = parts.find(p => /[A-Z][a-z]+,\s+[A-Z].*(?:MD|DO|DPM)/i.test(p)) || '';
    const surgIdx   = parts.indexOf(surgP);
    const cleanProc = (surgIdx >= 0 && surgIdx + 1 < parts.length ? parts[surgIdx + 1] : '')
      .replace(/\s+\d+$/, '').trim();
    const encP = parts.find(p => /OUTPATIENT|INPATIENT|EMERGENCY|PREADMIT|OBSERVATION/i.test(p)) || '';
 
    const roomType = classifyRoom(roomP);
 
    // Keep the raw room name. WL (add-on) rooms used to be relabeled as
    // "BMH OR Add-On Room" which produced phantom rooms with no cases.
    // Now: the room only survives if it has cases that need anesthesia.
    const displayRoom = roomP;
 
    const detectedArea = currentArea || (
      roomType.isCathEP ? 'BMH CATH LAB' :
      roomType.isEndo   ? 'BMH ENDO' :
      roomType.isBOOS   ? 'BOOS OR' :
      roomType.isIR     ? 'BMH IR' :
                          'BMH OR'
    );
 
    const anesCheck = needsAnesthesia(cleanProc, surgP, roomP);
 
    allCases.push({
      date:           currentDate,
      caseNumber:     caseP,
      room:           displayRoom,
      area:           detectedArea,
      building:       roomType.building,
      encounterType:  encP,
      surgeon:        surgP,
      procedure:      cleanProc,
      needsAnesthesia: anesCheck.needs,
      anesReason:     anesCheck.reason,
      anesFlag:       anesCheck.flag || false,
      manuallyAdded:  false,
    });
  }
 
  const dateCounts = {};
  allCases.forEach(c => { if (c.date) dateCounts[c.date] = (dateCounts[c.date] || 0) + 1; });
 
  let targetDate;
  if (forceDateStr) {
    const d  = new Date(forceDateStr + 'T12:00:00');
    targetDate = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  } else {
    const today = new Date().toLocaleDateString('en-US');
    targetDate  = dateCounts[today]
      ? today
      : Object.entries(dateCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  }
 
  const todayCases    = allCases.filter(c => c.date === targetDate);
  const needsCoverage = todayCases.filter(c => c.needsAnesthesia);
  const excluded      = todayCases.filter(c => !c.needsAnesthesia);
  const flagged       = todayCases.filter(c => c.anesFlag);
 
  const roomMap = {};
  for (const c of needsCoverage) {
    // Drop cases with no room name entirely (rather than bucketing them
    // into a phantom Add-On Room). If we can't match a room, we can't staff it.
    if (!c.room) continue;
    if (!roomMap[c.room]) roomMap[c.room] = [];
    roomMap[c.room].push(c);
  }
 
  const roomAssignments = Object.entries(roomMap).map(([room, roomCases]) => {
    const allIntel = roomCases.map(c => classifyCase(c.procedure, c.surgeon, c.room));
 
    const acuity =
      allIntel.some(i => i.acuity === 'cardiac')     ? 'cardiac' :
      allIntel.some(i => i.acuity === 'high')        ? 'high' :
      allIntel.some(i => i.acuity === 'peds')        ? 'peds' :
      allIntel.some(i => i.acuity === 'medium-high') ? 'medium-high' : 'routine';
 
    const building = roomCases[0]?.building || classifyRoom(room).building;
 
    return {
      room,
      area:               roomCases[0].area,
      building,
      cases:              roomCases,
      caseCount:          roomCases.length,
      surgeons:           [...new Set(roomCases.map(c => c.surgeon))],
      startTime:          roomCases[0].date,
      acuity,
      blockRequired:      allIntel.some(i => i.blockRequired),
      blockPossible:      allIntel.some(i => i.blockPossible),
      isCathEP:           allIntel.some(i => i.isCathEP),
      isCardiac:          allIntel.some(i => i.isCardiac),
      isThoracic:         allIntel.some(i => i.isThoracic),
      isEndo:             allIntel.some(i => i.isEndo),
      isBOOS:             allIntel.some(i => i.isBOOS),
      isIR:               allIntel.some(i => i.isIR),
      preferredProviders: [...new Set(allIntel.flatMap(i => i.preferredProviders))],
      avoidProviders:     [...new Set(allIntel.flatMap(i => i.avoidProviders))],
      flags:              allIntel.flatMap(i => i.flags),
      assignedProvider:   null,
      caseStatus:         'Not Started',
      cardiacNote:        '',
      manuallyAdded:      false,
    };
  }).sort((a, b) => a.room.localeCompare(b.room));
 
  // ── OR.endo.CCL Main OR cap ───────────────────────────────────
  // If the Main OR committed number is provided and the cube shows MORE rooms
  // than committed, trim the excess Main OR rooms (lowest acuity first,
  // then highest room number). Non-Main OR rooms (Endo/Cath/BOOS/IR) are
  // never trimmed — those are managed separately. If the cube shows FEWER
  // rooms than committed, we do nothing — rooms may have been consolidated.
  let finalRooms = roomAssignments;
  if (typeof mainORCommitted === 'number' && mainORCommitted > 0) {
    const mainORRooms = roomAssignments.filter(r =>
      r.building === 'MAIN_OR_FLOOR' && !r.isEndo && !r.isCathEP && !r.isBOOS && !r.isIR
    );
    const otherRooms  = roomAssignments.filter(r =>
      r.building !== 'MAIN_OR_FLOOR' || r.isEndo || r.isCathEP || r.isBOOS || r.isIR
    );
    if (mainORRooms.length > mainORCommitted) {
      // Rank by priority to keep — cardiac > high > peds > medium-high > routine,
      // then by blockRequired, then by caseCount desc
      const priorityRank = a => {
        const acuityRank = { cardiac: 0, high: 1, peds: 2, 'medium-high': 3, routine: 4 }[a.acuity] ?? 5;
        return acuityRank * 1000 - (a.blockRequired ? 500 : 0) - (a.caseCount || 0);
      };
      const keep = [...mainORRooms].sort((a, b) => priorityRank(a) - priorityRank(b)).slice(0, mainORCommitted);
      const keepSet = new Set(keep.map(r => r.room));
      finalRooms = roomAssignments.filter(r => keepSet.has(r.room) || otherRooms.includes(r));
    }
  }
 
  // ── Cath Lab Add-On phantom generation ──────────────────────────
  // OR.endo.CCL is both floor AND ceiling for cath rooms we cover.
  // If committedCath > visible cath rooms, generate phantom Cath Lab Add-On
  // rooms to reach committed count. These are treated as cath minors
  // (low acuity, no specific procedure) and will be assigned by cardiacDecisionTree
  // with CV Call preference (easier to extract for emergency open heart).
  // If committedCath <= visible, no phantoms generated. We never trim cath
  // rooms down — if the cube shows 3 cath rooms and we're committed to 2,
  // that's a scheduling oversight we don't handle here.
  if (typeof committedCath === 'number' && committedCath > 0) {
    const cathRooms = finalRooms.filter(r => r.isCathEP);
    const phantomsNeeded = committedCath - cathRooms.length;
    if (phantomsNeeded > 0) {
      const cathPhantoms = Array.from({ length: phantomsNeeded }, (_, i) => ({
        room:            phantomsNeeded === 1 ? 'Cath Lab Add-On' : `Cath Lab Add-On ${i + 1}`,
        area:            'BMH CATH LAB',
        building:        'CATH_FLOOR',
        cases:           [],
        caseCount:       0,
        surgeons:        [],
        startTime:       null,
        acuity:          'routine',
        blockRequired:   false,
        blockPossible:   false,
        isCathEP:        true,
        isCardiac:       false,
        isThoracic:      false,
        isEndo:          false,
        isBOOS:          false,
        isIR:            false,
        isPhantom:       true,
        isCathMinors:    true,
        preferredProviders: [],
        avoidProviders:  [],
        flags:           [{ level: 'info', msg: 'Cath Lab Add-On — reserved per OR.endo.CCL, no cases booked yet' }],
        assignedProvider: null,
        caseStatus:      'Not Started',
        cardiacNote:     '',
        manuallyAdded:   false,
      }));
      finalRooms = [...finalRooms, ...cathPhantoms];
    }
  }
 
  return { rooms: finalRooms, excluded, flagged, targetDate, totalParsed: todayCases.length };
}
 
export function cardiacDecisionTree(rooms, cvCallMD, backupCVMD) {
  const result = rooms.map(r => ({ ...r }));
  let cvCallOccupied = false, backupCVOccupied = false;
 
  // ── Tier classifier ──────────────────────────────────────────
  // 1 = open heart / TAVR (highest priority — why we hired CV team)
  // 2 = thoracic
  // 3 = Watchman
  // 4 = EP/ablation
  // 5 = TEE/cardioversion
  // 0 = doesn't match cardiac categories
  const getTier = proc => {
    const p = (proc || '').toLowerCase();
    if (['open heart','cabg','bypass','valve replacement','valve repair','tavr','transcatheter aortic'].some(k => p.includes(k))) return 1;
    if (['thoracic','lobectomy','pneumonectomy','thoracotomy','vats','esophagectomy'].some(k => p.includes(k))) return 2;
    if (p.includes('watchman')) return 3;
    if (['ep study','electrophysiology','ablation','afib','a fib','affera'].some(k => p.includes(k))) return 4;
    if (['tee','transesophageal','cardioversion'].some(k => p.includes(k))) return 5;
    return 0;
  };
 
  // Compute top tier for each cardiac/cath room up front so we can reason
  // about the whole day before assigning any CV MD.
  const cardiacRooms = result.filter(r => r.isCathEP || r.isCardiac || r.isThoracic);
  for (const room of cardiacRooms) {
    if (room.isPhantom) {
      // Phantom cath (Cath Lab Add-On) — has no cases, treated as cath minors
      room._topTier  = 99;
      room._isMinors = true;
    } else {
      room._topTier  = Math.min(...room.cases.map(c => getTier(c.procedure)).filter(t => t > 0), 99);
      room._isMinors = false;
    }
  }
 
  // ── LAYER 1: Tier 1 & 2 (big cardiac cases CV team was hired for) ──
  // Open heart, TAVR, thoracic. These claim CV MDs first.
  const tier12Rooms = cardiacRooms
    .filter(r => r._topTier === 1 || r._topTier === 2)
    .sort((a, b) => a._topTier - b._topTier);   // Tier 1 before Tier 2
 
  for (const room of tier12Rooms) {
    const isWatchman = false;
    let assignedTo = null, note = '';
 
    if (room._topTier === 1) {
      if (!cvCallOccupied)        { assignedTo = cvCallMD;   cvCallOccupied = true;   note = 'CV Call — open heart/TAVR'; }
      else if (!backupCVOccupied) { assignedTo = backupCVMD; backupCVOccupied = true; note = 'Backup CV — simultaneous open heart'; }
      else                        { note = '⚠ Both CV occupied — use Pond or Dodwani'; }
    } else {
      // Tier 2 — thoracic
      if (!cvCallOccupied)        { assignedTo = cvCallMD;   cvCallOccupied = true;   note = 'CV Call — thoracic'; }
      else if (!backupCVOccupied) { assignedTo = backupCVMD; backupCVOccupied = true; note = 'Backup CV — thoracic'; }
      else                        { note = 'CV team occupied — assign thoracic-capable general MD'; }
    }
 
    if (assignedTo) room.assignedProvider = assignedTo;
    room.cardiacNote = note;
  }
 
  // ── LAYER 2: Remaining cath rooms, CV preference applies ─────
  // Only runs if CV MDs weren't fully consumed by Layer 1.
  // The rule: CV Call prefers the minors/phantom room (easier to extract
  // for emergency open heart). Backup CV prefers EP/higher-acuity cath.
  const remainingCathRooms = cardiacRooms
    .filter(r => !r.assignedProvider && (r.isCathEP || r._isMinors));
 
  // Split by type: "high" cath rooms (EP/Watchman/TEE — have real cases) vs
  // "minors" (phantom Add-On or rooms with only low-acuity procedures).
  const highCathRooms   = remainingCathRooms.filter(r => !r._isMinors && r._topTier >= 3 && r._topTier <= 5);
  const minorsCathRooms = remainingCathRooms.filter(r => r._isMinors);
  const otherCathRooms  = remainingCathRooms.filter(r =>
    !highCathRooms.includes(r) && !minorsCathRooms.includes(r)
  );
 
  // Rule: if CV Call is still free AND there's a minors room, CV Call → minors.
  // This frees Backup CV (also still free, if applicable) for the high cath room.
  if (!cvCallOccupied && cvCallMD && minorsCathRooms.length > 0) {
    const minorsRoom = minorsCathRooms.shift();
    minorsRoom.assignedProvider = cvCallMD;
    minorsRoom.cardiacNote      = 'CV Call — cath minors (easier to extract if emergency)';
    cvCallOccupied = true;
  }
 
  // Assign Backup CV to highest-acuity remaining cath room first (Watchman > EP > TEE)
  const tierPriority = [3, 4, 5];
  for (const tier of tierPriority) {
    if (backupCVOccupied) break;
    const room = highCathRooms.find(r => r._topTier === tier && !r.assignedProvider);
    if (!room || !backupCVMD) continue;
 
    // Special case: Munro on Watchman preferred (complex TEE)
    if (tier === 3 && backupCVMD === 'Munro, Jonathan') {
      room.assignedProvider = 'Munro, Jonathan';
      room.cardiacNote      = 'Munro — Watchman (complex TEE)';
    } else if (tier === 3) {
      room.assignedProvider = backupCVMD;
      room.cardiacNote      = 'Backup CV — Watchman';
    } else if (tier === 4) {
      room.assignedProvider = backupCVMD;
      room.cardiacNote      = 'Backup CV — EP/ablation';
    } else {
      room.assignedProvider = backupCVMD;
      room.cardiacNote      = 'Backup CV — TEE/cardioversion';
    }
    backupCVOccupied = true;
  }
 
  // If CV Call is still free (no Layer 1 work, no minors room to claim),
  // place them on the highest-acuity remaining cath room.
  if (!cvCallOccupied && cvCallMD) {
    for (const tier of tierPriority) {
      const room = highCathRooms.find(r => r._topTier === tier && !r.assignedProvider);
      if (!room) continue;
      room.assignedProvider = cvCallMD;
      room.cardiacNote      = tier === 3 ? 'CV Call — Watchman'
                            : tier === 4 ? 'CV Call — EP'
                            : 'CV Call — TEE';
      cvCallOccupied = true;
      break;
    }
  }
 
  // If Backup CV is still free (no Layer 1 work, no high cath room), place on minors.
  if (!backupCVOccupied && backupCVMD && minorsCathRooms.length > 0) {
    const minorsRoom = minorsCathRooms.shift();
    minorsRoom.assignedProvider = backupCVMD;
    minorsRoom.cardiacNote      = 'Backup CV — cath minors';
    backupCVOccupied = true;
  }
 
  // Any remaining cath rooms (highCathRooms, minorsCathRooms, otherCathRooms)
  // without an assignedProvider flow to standard general fill in buildAssignments/buildCareTeams.
  // We annotate them so downstream logic knows they're cath-adjacent.
  for (const room of remainingCathRooms) {
    if (!room.assignedProvider && !room.cardiacNote) {
      room.cardiacNote = 'Cath room — general fill (CV team occupied or unavailable)';
    }
  }
 
  // Clean up internal markers before returning
  for (const room of result) {
    delete room._topTier;
    delete room._isMinors;
  }
 
  return result;
}
 
export function buildAssignments(rooms, qg, orCallChoice) {
  if (!rooms.length || !qg?.workingMDs?.length) return rooms;
 
  let result = rooms.map(r => ({ ...r }));
  const used = new Set();
 
  // OB Call is excluded from workingMDs at parse time, so no filter needed here.
  // Cardiac decision tree runs first.
  result = cardiacDecisionTree(result, qg.CardiacCall || qg.ORCall, qg.BackupCV);
  result.forEach(r => { if (r.assignedProvider) used.add(r.assignedProvider); });
 
  // Apply OR Call choice and lock them out of all further passes only if assignment succeeds.
  // orCallConsumed is ONLY set true when the room is actually found and assigned.
  // If the room isn't found for any reason, OR Call stays in the fill order so they
  // still get assigned somewhere — we never silently drop them.
  let orCallConsumed = false;
  if (orCallChoice && qg.ORCall) {
    if (orCallChoice.type === 'available') {
      used.add(qg.ORCall);
      orCallConsumed = true;
    } else if (orCallChoice.type === 'room' && orCallChoice.room) {
      // Try exact match first, then fuzzy (normalise spaces/leading zeros)
      const normalise = s => (s || '').toLowerCase().replace(/\s+/g, ' ').replace(/\b0+(\d)/g, '$1').trim();
      const target = normalise(orCallChoice.room);
      let idx = result.findIndex(r => r.room === orCallChoice.room);
      if (idx < 0) idx = result.findIndex(r => normalise(r.room) === target);
      if (idx >= 0 && !result[idx].assignedProvider) {
        result[idx] = { ...result[idx], assignedProvider: qg.ORCall, isORCallChoice: true, choiceLabel: 'CHOICE' };
        used.add(qg.ORCall);
        orCallConsumed = true;
      }
      // If room still not found, orCallConsumed stays false —
      // OR Call remains in the fill order and will be assigned normally.
    }
  }
 
  // Build fill order — exclude OR Call if their choice was applied (consumed),
  // and always exclude OB Call (not in workingMDs anyway, but belt-and-suspenders).
  const order = [
    ...qg.workingMDs.filter(p => p.role === 'Cardiac Call (CV)'),
    ...qg.workingMDs.filter(p => p.role === 'Backup CV'),
    // OR Call only included in fill order if they haven't been consumed by their choice
    ...(!orCallConsumed ? qg.workingMDs.filter(p => p.role === 'OR Call (#1)') : []),
    ...qg.workingMDs.filter(p => p.role === 'Locum'),
    ...qg.workingMDs.filter(p => p.role === 'Back Up Call (#2)'),
    ...qg.workingMDs.filter(p => p.rankNum >= 3 && p.rankNum < 50).sort((a, b) => a.rankNum - b.rankNum),
    ...qg.workingMDs.filter(p => p.role === '7/8 Hr Shift'),
  ];
 
  // ── PRIORITY ASSIGNMENTS ONLY ────────────────────────────────
  // buildAssignments locks in specialty/priority rooms.
  // General fill and care team formation happen in buildCareTeams.
 
  // All working MDs available for priority assignment
  const allMDs = [
    ...qg.workingMDs.filter(p => p.role === 'Cardiac Call (CV)'),
    ...qg.workingMDs.filter(p => p.role === 'Backup CV'),
    ...(!orCallConsumed ? qg.workingMDs.filter(p => p.role === 'OR Call (#1)') : []),
    ...qg.workingMDs.filter(p => p.role === 'Locum'),
    ...qg.workingMDs.filter(p => p.role === 'Back Up Call (#2)'),
    ...qg.workingMDs.filter(p => p.rankNum >= 3 && p.rankNum < 50).sort((a, b) => a.rankNum - b.rankNum),
    ...qg.workingMDs.filter(p => p.role === '7/8 Hr Shift'),
  ];
 
  // Block rooms — locum block-capable MDs first, then backup call/ranked
  // Order respects: Nielson/Lambert/Powell (locums) → Dodwani/Pond (locums) → Pipito (backup call)
  const blockOrder = ['Nielson, Mark', 'Lambert', 'Powell, Jason', 'Dodwani', 'Pond, William', 'Pipito, Nicholas A'];
 
  for (const room of result) {
    if (room.assignedProvider || !room.blockRequired) continue;
    for (const name of blockOrder) {
      const p = allMDs.find(p => p.name === name && !used.has(p.name));
      if (p) { room.assignedProvider = p.name; used.add(p.name); break; }
    }
  }
 
  // Endo — Brand always
  for (const room of result) {
    if (room.assignedProvider || !room.isEndo) continue;
    const brand = allMDs.find(p => p.name === 'Brand, David L' && !used.has(p.name));
    if (brand) { room.assignedProvider = brand.name; used.add(brand.name); }
  }
 
  // Peds — DeWitt first (employed, peds-capable), then locums capable of peds, then Pipito
  // Pipito is backup call (#2) so locums should be exhausted before pulling him for peds
  const pedsOrder = ['DeWitt, Bracken J', 'Gathings, Vincent', 'Nielson, Mark', 'Pipito, Nicholas A'];
  for (const room of result) {
    if (room.assignedProvider || room.acuity !== 'peds') continue;
    for (const name of pedsOrder) {
      const p = allMDs.find(p => p.name === name && !used.has(p.name));
      if (p) { room.assignedProvider = p.name; used.add(p.name); break; }
    }
  }
 
  // Remaining rooms left unassigned — buildCareTeams handles them
  return result;
}
 
