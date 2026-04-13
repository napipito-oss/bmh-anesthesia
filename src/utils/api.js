// ─────────────────────────────────────────────────────────────
// ANTHROPIC API UTILITY
// Calls go through /api/chat (Vercel serverless function)
// API key never touches the browser — stays on the server
// ─────────────────────────────────────────────────────────────

const MODEL = 'claude-sonnet-4-20250514';

function buildSystemPrompt(qg, rooms) {
  const provSummary = `
ASSIGNMENT ORDER: OR Call (pref asked day-before) → Locums (by fit) → Backup Call (#2) → Rank 3 → 4 → 5+
CARDIAC TREE: OpenHeart/TAVR→CVCall then BackupCV. Watchman→Munro first (complex TEE). EP/device→BackupCV first. Thoracic→CVteam first, then DeWitt/Pipito/Wu/Kuraganti/Eskew/experienced locum. Both CV occupied→Pond or Dodwani. True emergency last resort→Pipito or Eskew (strongly prefer not).
KEY RULES:
- Brand = Endo only, never solo, out ~2:30pm
- Siddiqui = first ask for late coverage
- Eskew = no care teams, no BOOS/Cath/Endo, prefers robotic/cysto solo
- DeWitt = prefers "available" on call (first add-on, not active)
- Raghove (both) = low acuity only, no blocks, no fast turnover
- Pond/Dodwani = cardiac fill-in, willing to stay, block capable
- Shoulder blocks = Nielson first → Lambert/Powell → Pipito
- Flack = often late to OR, build buffer
- El-Amir = very particular, cardiac anesthesia required
- Care team ratios: 1:3 ideal, 1:4 max brief, Brand always care team in endo
- POST OR/OB = off-site unavailable. Cardiac team out 4pm.
- Backup Call = Rank #2, potential overnight callback if OR Call occupied
SURGEON BLOCKS: Triplet=always. Cieply/Damer=TKA/THA adductor+iPACK+spinal. McPherron=most except knee arthroscopy. Voss/Hoversland/Lopiccolo/Kojima/Khalid=DaVinci hyst. Kim=TAP for robotic prostatectomy/nephrectomy. Lescay=same as Kim. Arscott=usually for robotic. Cassel=confirm day-of. Flack/Kern/Hart/Duncan/Bandt/neurosurgery/spine=never.
LATE STAY ORDER: Siddiqui (first) → Dodwani → Pond → Gathings (sometimes) → Nielson (sometimes) → Lambert/Powell (rarely).`;

  const schedSummary = rooms.length
    ? rooms.map(r => `${r.room}(${r.acuity}): [${r.cases?.map(c=>c.procedure).join('/')||''}] Surg:${r.surgeons?.join(',')} Block:${r.blockRequired} → ${r.assignedProvider||'UNASSIGNED'} ${r.cardiacNote||''}`).join('\n')
    : 'No schedule loaded.';

  const qgSummary = qg
    ? `Working MDs: ${qg.workingMDs?.map(p=>`${p.name}(${p.role})`).join(', ')}\nCV Call:${qg.CardiacCall||'none'} BackupCV:${qg.BackupCV||'none'}\nAnesthetists: ${qg.Anesthetists?.filter(a=>!a.isAdmin&&!a.isOff).map(a=>`${a.name} ${a.shift}`).join(', ')}`
    : 'QGenda not loaded.';

  return `You are the AI operations assistant for IU Health Ball Memorial Hospital Anesthesia Department (BMH). You have complete knowledge of this specific department.

${provSummary}

TODAY'S SCHEDULE:
${schedSummary}

STAFFING:
${qgSummary}

Be specific, practical, direct. Reference actual provider names. Flag mismatches clearly. Never hallucinate provider names.`;
}

export async function callAI(prompt, qg, rooms) {
  // Calls /api/chat — our Vercel serverless proxy
  // The Anthropic API key lives on the server, never in the browser
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: buildSystemPrompt(qg, rooms),
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || `Server error ${response.status}`);
  }

  const data = await response.json();
  return data.content?.map(c => c.text || '').join('\n') || 'No response.';
}
