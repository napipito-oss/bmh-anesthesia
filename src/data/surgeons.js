// ─────────────────────────────────────────────────────────────
// BMH SURGEON BLOCK DATABASE
// blockRule options: always | usually | specific | selective |
//                   offered | appropriate | rarely | never | mood-dependent
// Add new surgeons as they appear in the schedule
// ─────────────────────────────────────────────────────────────

export const SURGEON_BLOCKS = {
  // ── ORTHOPEDIC ────────────────────────────────────────────
  "Triplet": {
    specialty:"Ortho", blockRule:"always",
    blockCases:["shoulder","rotator cuff","complex hand","complex arm","arthroplasty"],
    neverBlock:[],
    notes:"Blocks for ALL shoulder + complex hand/arm. Always assign block-capable provider."
  },
  "McPherron": {
    specialty:"Ortho", blockRule:"usually",
    blockCases:["most ortho"], neverBlock:["knee arthroscopy"],
    notes:"Blocks for most cases. Never for knee arthroscopy."
  },
  "Cieply": {
    specialty:"Ortho", blockRule:"always",
    blockCases:["total knee","total hip","knee replacement","hip replacement","arthroplasty"],
    neverBlock:[], blockTypes:["adductor canal","iPACK","spinal"],
    notes:"Total knees/hips — adductor canal + iPACK + spinal required."
  },
  "Damer": {
    specialty:"Ortho", blockRule:"always",
    blockCases:["total knee","total hip","knee replacement","hip replacement","arthroplasty"],
    neverBlock:[], blockTypes:["adductor canal","iPACK","spinal"],
    notes:"Same as Cieply — total knees/hips, adductor canal + iPACK + spinal."
  },

  // ── TEAM HEALTH ORTHO HOSPITALISTS ───────────────────────
  "Weber": {
    specialty:"Ortho Hospitalist", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"Team Health ortho hospitalist. No blocks."
  },
  "Tankson": {
    specialty:"Ortho Hospitalist", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"Team Health ortho hospitalist. No blocks."
  },
  "Robinson, Ben": {
    specialty:"Ortho Hospitalist", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"Team Health ortho hospitalist. No blocks. Different from Robinson, Daniel L (spine)."
  },
  "Zucker": {
    specialty:"Ortho Hospitalist", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"Team Health ortho hospitalist. No blocks."
  },
  "Jepsen": {
    specialty:"Ortho Hospitalist", blockRule:"selective",
    blockCases:["when requested — usually wants one"], neverBlock:[],
    notes:"Usually wants a block but won't insist if unavailable. Confirm day-of.",
    flags:["Confirm block preference day-of"]
  },

  // ── GYN / ROBOTIC ─────────────────────────────────────────
  "Lopiccolo": {
    specialty:"GYN", blockRule:"specific",
    blockCases:["davinci hysterectomy","robotic hysterectomy","complex abdominal"],
    neverBlock:[],
    notes:"Blocks for DaVinci hysterectomy and complex abdominal cases."
  },
  "Voss": {
    specialty:"GYN", blockRule:"specific",
    blockCases:["davinci hysterectomy","robotic hysterectomy","complex abdominal","tap block"],
    neverBlock:[],
    notes:"Both Derek and Yashoba Voss. Same as Lopiccolo. TAP blocks noted in case names."
  },
  "Hoversland": {
    specialty:"GYN", blockRule:"specific",
    blockCases:["davinci hysterectomy","robotic hysterectomy","complex abdominal"],
    neverBlock:[],
    notes:"Same as Lopiccolo group."
  },
  "Kojima": {
    specialty:"GYN", blockRule:"specific",
    blockCases:["davinci hysterectomy","robotic hysterectomy","complex abdominal"],
    neverBlock:[],
    notes:"Same as Lopiccolo group."
  },
  "Khalid": {
    specialty:"GYN", blockRule:"specific",
    blockCases:["davinci hysterectomy","robotic hysterectomy","complex abdominal"],
    neverBlock:[],
    notes:"Same as Hoversland/Lopiccolo group. DaVinci hysts and GYN procedures."
  },

  // ── GENERAL SURGERY ───────────────────────────────────────
  "Arscott": {
    specialty:"Gen Surg", blockRule:"usually",
    blockCases:["robotic","davinci","appropriate cases"],
    neverBlock:[],
    notes:"Robotic gen surg, usually prefers blocks but not required. Block-capable provider preferred."
  },
  "Simpson": {
    specialty:"Gen Surg", blockRule:"offered",
    blockCases:["any — if provider offers"], neverBlock:[],
    notes:"Never requests blocks but accepts if proficient provider offers. Safe to offer, not required."
  },
  "Saleem": {
    specialty:"Gen Surg", blockRule:"specific",
    blockCases:["robotic","davinci"], neverBlock:[],
    notes:"Blocks for robotic general surgery cases."
  },
  "Lopez": {
    specialty:"Gen Surg", blockRule:"appropriate",
    blockCases:["appropriate general surgery cases"], neverBlock:[],
    notes:"Open to blocks for appropriate gen surg cases. Provider judgment."
  },
  "Cadogan": {
    specialty:"Gen Surg", blockRule:"selective",
    blockCases:["cases with good clinical indication"], neverBlock:["routine"],
    notes:"OK with blocks for good clinical reason only. Does not want routine blocks."
  },
  "Kern": {
    specialty:"Gen Surg", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"No blocks for gen surg."
  },
  "Stewart": {
    specialty:"Gen Surg", blockRule:"rarely",
    blockCases:["painful open cases"], neverBlock:["routine"],
    notes:"No blocks unless painful open case specifically."
  },
  "Cassel": {
    specialty:"Gen Surg", blockRule:"mood-dependent",
    blockCases:["when he requests"], neverBlock:[],
    notes:"Blocks only when he specifically requests — unpredictable. Don't assume.",
    flags:["Confirm block preference day-of"]
  },

  // ── UROLOGY ───────────────────────────────────────────────
  "Kim": {
    specialty:"Urology", blockRule:"specific",
    blockCases:["davinci prostatectomy","robotic prostatectomy","nephrectomy"],
    neverBlock:["cysto","hydrodistention","botox","turbt","laser"],
    blockTypes:["TAP"],
    notes:"TAP blocks for DaVinci prostatectomy and nephrectomy only. No blocks for cysto/endo uro."
  },
  "Flack": {
    specialty:"Urology", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"Cystos, MOSES lasers, prostate lasers, TURPs. No blocks. OFTEN LATE — slow to OR.",
    flags:["Often late to OR — plan accordingly"]
  },
  "Lescay": {
    specialty:"Urology", blockRule:"specific",
    blockCases:["davinci prostatectomy","robotic prostatectomy","nephrectomy"],
    neverBlock:["cysto","turp","laser"],
    notes:"Cystos like Flack, nephrectomy, DaVinci prostatectomy. TAP/blocks OK for DaVinci only."
  },

  // ── PODIATRY ──────────────────────────────────────────────
  "Smith": {
    specialty:"Podiatry", blockRule:"specific",
    blockCases:["achilles tendon repair","complex foot"],
    neverBlock:["routine podiatry"],
    notes:"Blocks for Achilles tendon repair and complex foot cases only."
  },
  "Reed": {
    specialty:"Podiatry", blockRule:"specific",
    blockCases:["achilles tendon repair","complex foot"],
    neverBlock:["routine podiatry"],
    notes:"Same as Smith."
  },
  "Meshulam": {
    specialty:"Podiatry", blockRule:"specific",
    blockCases:["achilles tendon repair","complex foot"],
    neverBlock:["routine podiatry"],
    notes:"Same as Smith and Reed."
  },

  // ── ENT / PEDS ────────────────────────────────────────────
  "Rogers": {
    specialty:"ENT/Peds", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"Peds ENT — no blocks. Fast turnover room, peds-capable provider required."
  },
  "Schmidt": {
    specialty:"ENT", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"ENT — tonsils, septoplasty, ear tubes. No blocks. Similar to Rogers."
  },

  // ── CV SURGERY ────────────────────────────────────────────
  "El-Amir": {
    specialty:"CV Surgery", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"CV surgeon — open heart, VATS, DaVinci lung. VERY PARTICULAR. Requires cardiac anesthesia team.",
    flags:["Cardiac anesthesia required — El-Amir is particular","Escalate if CV team unavailable"]
  },

  // ── NEUROSURGERY / SPINE ──────────────────────────────────
  "Bandt": {
    specialty:"Neurosurgery", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"Craniotomies, EVDs. No blocks — neurosurgery rule."
  },
  "Hart": {
    specialty:"Spine/Neuro", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"Cervical spines, lumbar discs/fusions, minimally invasive discectomies. No blocks."
  },
  "Duncan": {
    specialty:"Ortho Spine", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"Ortho spine, some carpal tunnels. No blocks."
  },
  "Robinson": {
    specialty:"Spine", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"Robinson, Daniel L — spine surgery. No blocks. Different from Robinson, Ben (Team Health ortho)."
  },
  "Coleman": {
    specialty:"Chronic Pain", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"Spinal cord stimulators, pain pumps, chronic pain. No blocks. Usually straightforward."
  },

  // ── CATH LAB / CARDIOLOGY (all yAnes — CV team routing) ──
  "Madmani": {
    specialty:"Cardiology/EP", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"EP cases, pacemakers, TAVRs. Routes to CV anesthesia team via cardiac decision tree."
  },
  "Saleb": {
    specialty:"Cardiology", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"TEEs and cardioversion. High volume TEE. Routes to CV team."
  },
  "Almnajam": {
    specialty:"Cardiology/EP", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"EP studies, ablations, pacemakers, ICD implants, Watchman. Routes to CV team."
  },
  "Rose": {
    specialty:"Cardiology/EP", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"Same as Almnajam — EP/ablation/Watchman. Routes to CV team."
  },
  "Graham": {
    specialty:"Cardiology", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"TEEs, cardioversion, occasional pacemaker. Routes to CV team."
  },
  "Rivera Maza": {
    specialty:"Cardiology", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"TEEs, cardioversion. Routes to CV team."
  },
  "Wagle": {
    specialty:"Cardiology", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"TEEs, cardioversion. Routes to CV team. Same as Rivera Maza."
  },

  // ── IR ────────────────────────────────────────────────────
  "Wilson": {
    specialty:"IR", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"IR procedures — cryoablation etc. Easy to work with. IR has cell/wifi issues — avoid care teams."
  },

  // ── ORTHO (additional) ────────────────────────────────────
  "Swope": {
    specialty:"Ortho", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"Team Health ortho surgeon (new). No blocks pending confirmation.",
    flags:["New surgeon — confirm block preference"]
  },

  // ── UROLOGY (additional) ──────────────────────────────────
  "Johnson": {
    specialty:"Urology", blockRule:"never",
    blockCases:[], neverBlock:["all"],
    notes:"Urology — cystos only. No blocks. Similar to Flack but not late. Leaving soon."
  },

  // ── UNKNOWN / DEFAULT ─────────────────────────────────────
  "_UNKNOWN_TEAM_HEALTH": {
    specialty:"Ortho Hospitalist", blockRule:"confirm",
    blockCases:[], neverBlock:[],
    notes:"Unrecognized Team Health provider — confirm block preference day-of.",
    flags:["Unknown Team Health provider — confirm block preference"]
  },
};

// Helper: get surgeon profile by last name from full surgeon string
export function getSurgeonProfile(surgeonStr) {
  if (!surgeonStr) return null;
  const lastName = surgeonStr.split(",")[0].trim();

  // Direct match
  if (SURGEON_BLOCKS[lastName]) return SURGEON_BLOCKS[lastName];

  // Team Health hospitalist check — flag as unknown if unrecognized
  const knownTeamHealth = ["Weber","Tankson","Zucker","Jepsen"];
  const knownSpine = ["Robinson","Hart","Duncan","Bandt","Coleman"];

  // Return null if not found (caller handles unknown)
  return null;
}
