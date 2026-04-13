// ─────────────────────────────────────────────────────────────
// PARSING UTILITIES
// QGenda export parser + Cube schedule parser
// ─────────────────────────────────────────────────────────────

import { SURGEON_BLOCKS } from '../data/surgeons.js';

// ── QGENDA PARSER ────────────────────────────────────────────
export function parseQGenda(raw) {
  if (!raw?.trim()) return null;

  const result = {
    date: null,
    ORCall: null, BackUpCall: null, OBCall: null,
    CardiacCall: null, BackupCV: null, SevenEightShift: null,
    PostOR: [], PostOB: [], PTO: [], OFF: [],
    Ranks: {}, Locums: [], Anesthetists: [],
    workingMDs: [], notAvailable: [],
  };

  const assigned = new Set();

  for (const line of raw.trim().split('\n')) {
    const parts = line.split('\t').map(p => p.trim());
    const roleRaw = parts[0]?.trim() || '';
    const name = parts[1]?.trim() || '';
    const rl = roleRaw.toLowerCase();

    // Skip date/day headers and empty lines
    if (!roleRaw || !name || name.length < 2) continue;
    const skipWords = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday',
      'january','february','march','april','may','june','july','august','september',
      'october','november','december','scheduled','grand total'];
    if (skipWords.some(w => rl.includes(w))) {
      // Try to extract date
      const dm = roleRaw.match(/(\w+ \d+, \d{4})/);
      if (dm) result.date = dm[1];
      continue;
    }

    // Rank rows — store for ordering reference only, not headcount
    const rankM = rl.match(/rank #(\d+)/);
    if (rankM) {
      result.Ranks[parseInt(rankM[1])] = name;
      continue;
    }

    // Anesthetists
    if (rl.includes('anesthetist') || rl.includes('crna')) {
      const shiftM = roleRaw.match(/(630a-730p|7a-3p|7a-5p|7a-8p|7a-7p)/i);
      const isAdmin = rl.includes('admin');
      const isOff = rl.includes('off/pto') || (rl.includes('off') && rl.includes('pto'));
      if (!isOff) {
        result.Anesthetists.push({
          name, shift: shiftM?.[1] || '7a-5p', isAdmin, isOff: false
        });
      }
      continue;
    }

    // Primary role assignment — first-come wins (dedup)
    if (name && !assigned.has(name)) {
      assigned.add(name);
      if (rl.includes('personal time off')) result.PTO.push(name);
      else if (rl === 'off') result.OFF.push(name);
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

  // Build working MD list in assignment priority order
  const addMD = (name, role, rankNum) => {
    if (name && !result.workingMDs.find(p => p.name === name)) {
      result.workingMDs.push({ name, role, rankNum });
    }
  };
  addMD(result.ORCall, 'OR Call (#1)', 1);
  addMD(result.BackUpCall, 'Back Up Call (#2)', 2);
  addMD(result.CardiacCall, 'Cardiac Call (CV)', 0);
  addMD(result.BackupCV, 'Backup CV', 0);
  addMD(result.OBCall, 'OB Call', 0);
  addMD(result.SevenEightShift, '7/8 Hr Shift', 99);
  Object.entries(result.Ranks).sort(([a],[b]) => parseInt(a)-parseInt(b))
    .forEach(([num, name]) => addMD(name, `Rank #${num}`, parseInt(num)));
  result.Locums.forEach(name => addMD(name, 'Locum', 50));

  result.notAvailable = [
    ...result.PTO.map(n => ({ name: n, reason: 'PTO' })),
    ...result.OFF.map(n => ({ name: n, reason: 'OFF' })),
    ...result.PostOR.map(n => ({ name: n, reason: 'Post OR — off-site' })),
    ...result.PostOB.map(n => ({ name: n, reason: 'Post OB — off-site' })),
  ];

  return result;
}

// ── CASE CLASSIFIER ──────────────────────────────────────────
export function classifyCase(procedure, surgeon, room) {
  const proc = (procedure || '').toLowerCase();
  const rm = (room || '').toLowerCase();
  const surgLast = (surgeon || '').split(',')[0].trim();
  const surgProfile = SURGEON_BLOCKS[surgLast];

  const flags = [];
  let acuity = 'routine';
  let caseType = 'general';
  let blockRequired = false;
  let blockPossible = false;
  let blockNote = '';
  let isCathEP = false, isCardiac = false, isThoracic = false;
  let isEndo = false, isBOOS = false, isPeds = false;
  let isFastTurnover = false, isRobotic = false;
  let preferredProviders = [];
  let avoidProviders = [];

  // ── Location routing ──
  if (rm.includes('endo') || ['colonoscopy','egd','eus','ercp','bronch','ebus'].some(k => proc.includes(k))) {
    isEndo = true; caseType = 'endo';
    preferredProviders.push('Brand, David L');
  }
  if (rm.includes('yanes') || rm.includes('cath') || rm.includes('ep lab')) {
    isCathEP = true; caseType = 'cath_ep'; acuity = 'cardiac';
    flags.push({ level:'critical', msg:'Cardiac/EP — route through cardiac decision tree' });
  }
  if (rm.includes('boos')) {
    isBOOS = true;
    preferredProviders.push('Pipito, Nicholas A','DeWitt, Bracken J');
    avoidProviders.push('Eskew, Gregory S','Brand, David L');
    flags.push({ level:'warn', msg:'BOOS — Eskew avoids; Pipito or DeWitt preferred' });
  }
  if (rm.includes('rir') || rm.includes('ir ')) {
    flags.push({ level:'info', msg:'IR case — cell/wifi issues, avoid care teams' });
  }

  // ── Cardiac procedures ──
  const openHeartKw = ['open heart','cabg','coronary bypass','valve replacement','valve repair','aortic valve','mitral valve','tavr','transcatheter aortic'];
  if (openHeartKw.some(k => proc.includes(k))) {
    isCardiac = true; acuity = 'cardiac';
    flags.push({ level:'critical', msg:'Open Heart/TAVR — CV primary MDs only (Kane/Thomas/Munro/Pond/Dodwani)' });
  }
  const cardiacKw = ['watchman','pacemaker','icd','biventricular','biv ','ablation','electrophysiology','tee','cardioversion'];
  if (!isCardiac && cardiacKw.some(k => proc.includes(k))) {
    isCathEP = true; acuity = 'cardiac';
  }

  // ── Thoracic ──
  const thoracicKw = ['lobectomy','pneumonectomy','thoracotomy','vats','esophagectomy','thoracic'];
  if (thoracicKw.some(k => proc.includes(k))) {
    isThoracic = true; acuity = 'high';
    preferredProviders.push('Kane, Paul','Thomas, Michael','Munro, Jonathan');
    flags.push({ level:'warn', msg:'Thoracic — CV team first; fallback: DeWitt, Pipito, Wu, Kuraganti, Eskew, experienced locum' });
  }

  // ── El-Amir flag ──
  if (surgLast === 'El-Amir') {
    flags.push({ level:'critical', msg:'El-Amir is very particular — cardiac anesthesia team required. Escalate if CV unavailable.' });
    acuity = 'cardiac';
  }

  // ── Surgeon block lookup ──
  if (surgProfile) {
    const rule = surgProfile.blockRule;
    const procLower = proc.toLowerCase();
    const neverAll = surgProfile.neverBlock?.includes('all');

    if (rule === 'always') {
      blockRequired = true; blockPossible = true;
      blockNote = surgProfile.notes;
    } else if (rule === 'never' || neverAll) {
      blockRequired = false; blockPossible = false;
      blockNote = surgProfile.notes;
    } else if (rule === 'usually') {
      const isNever = surgProfile.neverBlock?.some(n => procLower.includes(n));
      blockRequired = !isNever; blockPossible = !isNever;
      blockNote = surgProfile.notes;
    } else if (['specific','selective'].includes(rule)) {
      const matches = surgProfile.blockCases?.some(bc => procLower.includes(bc.toLowerCase()));
      blockRequired = matches; blockPossible = matches;
      blockNote = surgProfile.notes;
    } else if (rule === 'offered') {
      blockRequired = false; blockPossible = true;
      blockNote = surgProfile.notes;
    } else if (rule === 'appropriate') {
      blockRequired = false; blockPossible = true;
      blockNote = surgProfile.notes;
    } else if (rule === 'rarely') {
      const openCase = proc.includes('open') || proc.includes('laparotomy');
      blockRequired = false; blockPossible = openCase;
      blockNote = surgProfile.notes;
    } else if (rule === 'mood-dependent') {
      blockRequired = false; blockPossible = true;
      blockNote = surgProfile.notes;
      flags.push({ level:'warn', msg:`${surgLast}: ${surgProfile.notes}` });
    }

    if (surgProfile.flags?.length) {
      surgProfile.flags.forEach(f => flags.push({ level:'warn', msg: f }));
    }
  } else {
    // Neurosurgery/spine hard rule regardless of surgeon
    const neuroKw = ['craniotomy','brain','laminectomy','spinal fusion','spine','discectomy','foraminotomy','interbody'];
    if (neuroKw.some(k => proc.includes(k))) {
      blockRequired = false; blockPossible = false;
      blockNote = 'No blocks for neurosurgery/spine — hard rule';
    } else {
      blockNote = `${surgLast} not in surgeon database — verify block preference`;
      flags.push({ level:'info', msg: `Surgeon ${surgLast} not profiled — confirm block preference` });
    }
  }

  // Flack-specific flag
  if (surgLast === 'Flack') {
    flags.push({ level:'warn', msg:'Flack: often late to OR — build buffer time into room planning' });
  }

  // ── Block provider routing ──
  if (blockRequired) {
    preferredProviders.push('Nielson, Mark','Lambert','Powell, Jason','Pipito, Nicholas A');
    avoidProviders.push('Siddiqui','Singh, Karampal','DeWitt, Bracken J',
      'Raghove, Vikas','Raghove, Punam','Brand, David L','Fraley');
    const isShoulderBlock = proc.includes('shoulder') || proc.includes('rotator') || proc.includes('bicep tenodesis');
    flags.push({
      level: isShoulderBlock ? 'critical' : 'warn',
      msg: `Block required${surgProfile?.blockTypes ? ` (${surgProfile.blockTypes.join(', ')})` : ''} — assign Nielson (1st), Lambert/Powell (2nd), Pipito (3rd)`
    });
  }

  // ── Peds ──
  const pedsKw = ['tonsil','adenoid','myringotomy','ear tube','tympanostomy'];
  if (pedsKw.some(k => proc.includes(k)) || surgLast === 'Rogers' || surgLast === 'Schmidt') {
    if (surgLast !== 'Schmidt' || !proc.includes('adult')) {
      isPeds = true; acuity = 'peds';
      preferredProviders.push('DeWitt, Bracken J','Pipito, Nicholas A');
      avoidProviders.push('Raghove, Punam','Brand, David L','Fraley');
      flags.push({ level:'warn', msg:'Peds — assign peds-capable provider (DeWitt, Pipito first)' });
    }
  }

  // ── Robotic ──
  if (proc.includes('robotic') || proc.includes('davinci') || proc.includes('da vinci')) {
    isRobotic = true;
    if (!isEndo) {
      preferredProviders.push('Eskew, Gregory S','Pipito, Nicholas A');
      flags.push({ level:'info', msg:'Robotic case — Eskew preferred (solo, no care teams)' });
    }
  }

  // ── Fast turnover ──
  if (proc.includes('cystoscopy') || proc.includes('cysto') || proc.includes('turbt') || proc.includes('turp')) {
    isFastTurnover = true;
    preferredProviders.push('Eskew, Gregory S','DeWitt, Bracken J','Pipito, Nicholas A');
    avoidProviders.push('Raghove, Punam','Raghove, Vikas','Gathings, Vincent','Fraley');
    flags.push({ level:'info', msg:'Fast turnover — avoid slow providers' });
  }

  // ── High acuity ──
  const highKw = ['craniotomy','brain','aaa','aortic','trauma','tracheostomy','esophagectomy'];
  if (highKw.some(k => proc.includes(k))) {
    acuity = 'high';
    avoidProviders.push('Raghove, Punam','Brand, David L','Fraley');
    flags.push({ level:'warn', msg:'High acuity — experienced provider required' });
  }

  return {
    acuity, caseType, isPeds, isFastTurnover, isRobotic,
    isCathEP, isCardiac, isThoracic, isEndo, isBOOS,
    blockRequired, blockPossible, blockNote,
    preferredProviders: [...new Set(preferredProviders)],
    avoidProviders: [...new Set(avoidProviders)],
    flags,
  };
}

// ── CUBE SCHEDULE PARSER ─────────────────────────────────────
export function parseCubeData(raw) {
  if (!raw?.trim()) return [];

  const lines = raw.trim().split('\n');
  const cases = [];
  let currentDate = null;
  let currentArea = null;
  const dateCounts = {};

  for (const line of lines) {
    const parts = line.split('\t').map(p => p?.trim() || '');

    // Area headers
    if (/^(BMH ENDO|BMH OR|BOOS OR)$/i.test(parts[0])) {
      currentArea = parts[0].trim(); continue;
    }

    // Skip headers/footers
    if (['Scheduled Surgical Area','Grand Total','Scheduled Location','Scheduled Start Hierarchy']
        .some(h => parts[0]?.includes(h))) continue;

    // Filter no-anes
    if (parts.some(p => p.toLowerCase().includes('zno anes'))) continue;

    // Find date
    for (const p of parts.slice(0, 2)) {
      const dm = p.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
      if (dm) { currentDate = dm[1]; break; }
    }

    // Find case number
    const caseP = parts.find(p => /BMHGI-|BMHOR-|BOOS-/.test(p));
    if (!caseP) continue;

    // Find room
    const roomP = parts.find(p => /BMH (OR \d|Endo \d|yAnes|BOOS)|BOOS OR \d/i.test(p)) || '';

    // Find surgeon (Last, First, MD/DO/DPM format)
    const surgP = parts.find(p => /[A-Z][a-z]+,\s+[A-Z].*(?:MD|DO|DPM)/i.test(p)) || '';

    // Find procedure — field after surgeon
    const surgIdx = parts.indexOf(surgP);
    const procP = surgIdx >= 0 && surgIdx + 1 < parts.length ? parts[surgIdx + 1] : '';
    const cleanProc = procP.replace(/\s+\d+$/, '').trim();

    // Count dates
    if (currentDate) {
      dateCounts[currentDate] = (dateCounts[currentDate] || 0) + 1;
    }

    cases.push({
      date: currentDate,
      caseNumber: caseP,
      room: roomP,
      area: currentArea || (roomP.toLowerCase().includes('endo') ? 'BMH ENDO' :
            roomP.toLowerCase().includes('yanes') ? 'BMH CATH/EP' :
            roomP.toLowerCase().includes('boos') ? 'BOOS OR' : 'BMH OR'),
      encounterType: parts.find(p => /OUTPATIENT|INPATIENT|EMERGENCY|PREADMIT/i.test(p)) || '',
      surgeon: surgP,
      procedure: cleanProc,
    });
  }

  // Find target date — most common, or today if present
  const today = new Date().toLocaleDateString('en-US', { month:'numeric', day:'numeric', year:'numeric' });
  const todayShort = today; // e.g. "4/9/2026"
  const targetDate = dateCounts[todayShort]
    ? todayShort
    : Object.entries(dateCounts).sort((a,b) => b[1]-a[1])[0]?.[0];

  const filtered = cases.filter(c => c.date === targetDate);

  // Group by room
  const roomMap = {};
  for (const c of filtered) {
    if (!roomMap[c.room]) roomMap[c.room] = [];
    roomMap[c.room].push(c);
  }

  // Build room assignment units
  return Object.entries(roomMap).map(([room, roomCases]) => {
    const allIntel = roomCases.map(c => classifyCase(c.procedure, c.surgeon, c.room));
    const acuity = allIntel.some(i => i.acuity==='cardiac') ? 'cardiac'
      : allIntel.some(i => i.acuity==='high') ? 'high'
      : allIntel.some(i => i.acuity==='peds') ? 'peds'
      : allIntel.some(i => i.acuity==='medium-high') ? 'medium-high' : 'routine';

    return {
      room, area: roomCases[0].area,
      cases: roomCases,
      caseCount: roomCases.length,
      surgeons: [...new Set(roomCases.map(c => c.surgeon))],
      startTime: roomCases[0].date,
      acuity,
      blockRequired: allIntel.some(i => i.blockRequired),
      blockPossible: allIntel.some(i => i.blockPossible),
      isCathEP: allIntel.some(i => i.isCathEP),
      isCardiac: allIntel.some(i => i.isCardiac),
      isThoracic: allIntel.some(i => i.isThoracic),
      isEndo: allIntel.some(i => i.isEndo),
      isBOOS: allIntel.some(i => i.isBOOS),
      preferredProviders: [...new Set(allIntel.flatMap(i => i.preferredProviders))],
      avoidProviders: [...new Set(allIntel.flatMap(i => i.avoidProviders))],
      flags: allIntel.flatMap(i => i.flags),
      assignedProvider: null,
      caseStatus: 'Not Started',
      cardiacNote: '',
    };
  }).sort((a,b) => a.room.localeCompare(b.room));
}

// ── CARDIAC DECISION TREE ────────────────────────────────────
export function cardiacDecisionTree(rooms, cvCallMD, backupCVMD) {
  const result = rooms.map(r => ({ ...r }));
  let cvCallOccupied = false;
  let backupCVOccupied = false;

  const getTier = proc => {
    const p = (proc || '').toLowerCase();
    if (['open heart','cabg','bypass','valve replacement','valve repair','tavr','transcatheter aortic'].some(k=>p.includes(k))) return 1;
    if (['thoracic','lobectomy','pneumonectomy','thoracotomy','vats','esophagectomy'].some(k=>p.includes(k))) return 2;
    if (p.includes('watchman')) return 3;
    if (['ep ','electrophysiology','ablation','pacemaker','icd','biventricular','biv '].some(k=>p.includes(k))) return 4;
    if (['tee','cardioversion','cath'].some(k=>p.includes(k))) return 5;
    return 0;
  };

  for (const room of result) {
    if (!room.isCathEP && !room.isCardiac && !room.isThoracic) continue;

    const topTier = Math.min(...room.cases.map(c => getTier(c.procedure)).filter(t => t > 0), 99);
    const isWatchman = room.cases.some(c => (c.procedure||'').toLowerCase().includes('watchman'));

    let assignedTo = null;
    let note = '';

    if (topTier === 1) {
      if (!cvCallOccupied) {
        assignedTo = cvCallMD; cvCallOccupied = true;
        note = 'CV Call — open heart/TAVR (highest tier)';
      } else if (!backupCVOccupied) {
        assignedTo = backupCVMD; backupCVOccupied = true;
        note = 'Backup CV — simultaneous open heart';
      } else {
        assignedTo = null;
        note = '⚠ Both CV providers occupied — use Pond or Dodwani. Last resort: Pipito or Eskew.';
      }
    } else if (topTier === 2) {
      if (!cvCallOccupied) { assignedTo = cvCallMD; cvCallOccupied = true; note = 'CV Call — thoracic'; }
      else if (!backupCVOccupied) { assignedTo = backupCVMD; backupCVOccupied = true; note = 'Backup CV — thoracic'; }
      else { note = 'CV team occupied — assign thoracic-capable general MD (DeWitt, Pipito, Wu, Kuraganti, Eskew, experienced locum)'; }
    } else if (isWatchman) {
      if (backupCVMD === 'Munro, Jonathan' && !backupCVOccupied) {
        assignedTo = 'Munro, Jonathan'; backupCVOccupied = true;
        note = 'Munro preferred — complex TEE for Watchman';
      } else if (!backupCVOccupied) {
        assignedTo = backupCVMD; backupCVOccupied = true;
        note = 'Backup CV — Watchman (confirm TEE capability)';
      } else if (!cvCallOccupied) {
        assignedTo = cvCallMD; cvCallOccupied = true;
        note = 'CV Call — Watchman (Backup CV occupied)';
      } else {
        note = '⚠ Both CV occupied — general MD for Watchman. Confirm TEE skill.';
      }
    } else if (topTier <= 4) {
      if (!backupCVOccupied) { assignedTo = backupCVMD; backupCVOccupied = true; note = 'Backup CV — EP/device'; }
      else if (!cvCallOccupied) { assignedTo = cvCallMD; cvCallOccupied = true; note = 'CV Call — EP/device (Backup CV occupied)'; }
      else { note = 'Both CV occupied — general MD appropriate for EP/device'; }
    } else {
      if (!backupCVOccupied) { assignedTo = backupCVMD; backupCVOccupied = true; note = 'Backup CV — TEE/cath minor'; }
      else if (!cvCallOccupied) { assignedTo = cvCallMD; cvCallOccupied = true; note = 'CV Call — cath minor'; }
      else { note = 'Both CV occupied — general MD OK for cath minor'; }
    }

    if (assignedTo) room.assignedProvider = assignedTo;
    room.cardiacNote = note;
  }

  return result;
}

// ── ASSIGNMENT ENGINE ────────────────────────────────────────
export function buildAssignments(rooms, qg) {
  if (!rooms.length || !qg?.workingMDs?.length) return rooms;

  let result = rooms.map(r => ({ ...r }));
  const used = new Set();

  // Step 1: Cardiac decision tree
  result = cardiacDecisionTree(result, qg.CardiacCall || qg.ORCall, qg.BackupCV);
  result.forEach(r => { if (r.assignedProvider) used.add(r.assignedProvider); });

  // Assignment order: OR Call → Locums → Backup Call → Rank 3+
  const order = [
    ...qg.workingMDs.filter(p => p.role === 'OR Call (#1)'),
    ...qg.workingMDs.filter(p => p.role === 'Locum'),
    ...qg.workingMDs.filter(p => p.role === 'Back Up Call (#2)'),
    ...qg.workingMDs.filter(p => p.rankNum >= 3 && p.rankNum < 50).sort((a,b) => a.rankNum-b.rankNum),
    ...qg.workingMDs.filter(p => p.role === '7/8 Hr Shift'),
  ];

  // Step 2: Block rooms
  const blockOrder = ['Nielson, Mark','Lambert','Powell, Jason','Pipito, Nicholas A','Dodwani','Pond, William'];
  for (const room of result) {
    if (room.assignedProvider || !room.blockRequired) continue;
    for (const name of blockOrder) {
      const p = order.find(p => p.name === name && !used.has(p.name));
      if (p) { room.assignedProvider = p.name; used.add(p.name); break; }
    }
  }

  // Step 3: Endo → Brand first
  for (const room of result) {
    if (room.assignedProvider || !room.isEndo) continue;
    const brand = order.find(p => p.name === 'Brand, David L' && !used.has(p.name));
    if (brand) { room.assignedProvider = brand.name; used.add(brand.name); }
  }

  // Step 4: Peds
  const pedsOrder = ['DeWitt, Bracken J','Pipito, Nicholas A'];
  for (const room of result) {
    if (room.assignedProvider || room.acuity !== 'peds') continue;
    for (const name of pedsOrder) {
      const p = order.find(p => p.name === name && !used.has(p.name));
      if (p) { room.assignedProvider = p.name; used.add(p.name); break; }
    }
  }

  // Step 5: Remaining rooms
  for (const room of result) {
    if (room.assignedProvider) continue;
    for (const provider of order) {
      if (used.has(provider.name)) continue;
      if (room.avoidProviders?.includes(provider.name)) continue;
      const profile = import('../data/providers.js').then ? null : null; // handled at component level
      room.assignedProvider = provider.name;
      used.add(provider.name);
      break;
    }
  }

  return result;
}
