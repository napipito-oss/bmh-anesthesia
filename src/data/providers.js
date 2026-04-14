// ─────────────────────────────────────────────────────────────
// BMH ANESTHESIA PROVIDER INTELLIGENCE DATABASE
// Update this file to add/modify provider profiles
// ─────────────────────────────────────────────────────────────

export const PROVIDERS = {
  // ── EMPLOYED MDs ─────────────────────────────────────────
  "Eskew, Gregory S": {
    type:"MD", employed:true, cardiac:false, cardiacEmergencyOnly:true,
    strengths:["Robotic GYN","Robotic Gen Surg","TAP blocks","Cysto","Fast turnover"],
    avoidances:["BOOS","Cath Lab","Endo","Care teams"],
    careTeam:false, blockCapable:true, blockTypes:["TAP"],
    thoracicCapable:true,
    callPref:"Solo — robotic or cysto preferred",
    lateStay:"prefers not", acuity:"high",
    notes:"Near retirement. Honor preferences. Cardiac-capable in true emergency only — strongly prefers not.",
    flags:["No care teams","Avoid BOOS/Cath/Endo","Cardiac emergency only"]
  },
  "DeWitt, Bracken J": {
    type:"MD", employed:true, cardiac:false,
    strengths:["Fast turnover","Peds","High acuity","Thoracic"],
    avoidances:["US-guided blocks"],
    careTeam:"reluctant", blockCapable:false,
    thoracicCapable:true,
    callPref:"Available — first add-on, prefer not actively assigned",
    lateStay:"moderate", acuity:"high",
    notes:"Smooth, well-liked. Prefers autonomy. Good thoracic fallback.",
    flags:["No US-guided blocks"]
  },
  "Wu, Jennifer": {
    type:"MD", employed:true, cardiac:false,
    strengths:["Generalist","Care team direction","Ortho (no triple shoulder)","Endo","Thoracic"],
    avoidances:["Triple shoulder block rooms"],
    careTeam:true, blockCapable:true, blockTypes:["basic"],
    thoracicCapable:true,
    callPref:"Easy solo assignment",
    lateStay:"moderate", acuity:"medium-high",
    notes:"Reliable generalist. Frequent OB call. Thoracic fallback capable."
  },
  "Kuraganti, Manjusha": {
    type:"MD", employed:true, cardiac:false,
    strengths:["Generalist","Care team direction","Thoracic"],
    avoidances:["Complex blocks"],
    careTeam:true, blockCapable:false,
    thoracicCapable:true,
    callPref:"Easy solo assignment",
    lateStay:"moderate", acuity:"medium-high",
    notes:"Very similar profile to Wu. Thoracic fallback capable."
  },
  "Singh, Karampal": {
    type:"MD", employed:true, cardiac:false,
    strengths:["High acuity","Care team direction"],
    avoidances:["Blocks"],
    careTeam:true, blockCapable:false,
    thoracicCapable:false,
    callPref:"Care team or easy solo",
    lateStay:"moderate", acuity:"high",
    notes:"Abrasive — manage assignment optics carefully.",
    flags:["Interpersonal — monitor placement","No blocks"]
  },
  "Raghove, Vikas": {
    type:"MD", employed:true, cardiac:false,
    strengths:["Medical direction","Care teams","Slow general cases"],
    avoidances:["Complex blocks","Fast turnovers","High-acuity solo"],
    careTeam:true, blockCapable:false,
    thoracicCapable:false,
    callPref:"Care team assignment",
    lateStay:"low", acuity:"low-medium",
    notes:"Best in low-risk rooms. Medical direction preferred.",
    flags:["Low acuity only","Avoid solo complex"]
  },
  "Raghove, Punam": {
    type:"MD", employed:true, cardiac:false,
    strengths:["Medical direction","Care teams","Simple cases"],
    avoidances:["Sick patients","Complex setups","Fast turnovers","Blocks"],
    careTeam:true, blockCapable:false,
    thoracicCapable:false,
    callPref:"Care team assignment",
    lateStay:"low", acuity:"low",
    notes:"Appropriate: lap chole, bowel, cystos, GI, GYN, basic ortho (no blocks). Keep simple.",
    flags:["Low acuity only","No sick patients","No fast turnover","No blocks"]
  },
  "Pipito, Nicholas A": {
    type:"MD", employed:true, cardiac:false, cardiacEmergencyOnly:true,
    strengths:["Regional blocks","OB","BOOS","Peds","Fast turnover","High acuity","Endo","Cath Lab","Thoracic"],
    avoidances:[],
    careTeam:true, blockCapable:true, blockTypes:["shoulder","regional","US-guided","TAP"],
    thoracicCapable:true,
    callPref:"Most impactful room — blocks or fast turnover",
    lateStay:"moderate", acuity:"high",
    notes:"OR 2 days/week only. ~60% call load. Cardiac-capable in true emergency only — strongly prefers not.",
    flags:["OR 2 days/week — verify schedule","Cardiac emergency only"]
  },
  "Brand, David L": {
    type:"MD", employed:true, cardiac:false,
    strengths:["Endo care team"],
    avoidances:["All non-endo rooms","Solo assignments"],
    careTeam:true, blockCapable:false,
    thoracicCapable:false,
    callPref:"No OR call",
    lateStay:"low", acuity:"low",
    notes:"Endo ONLY. Care team 1:2 or 1:3. Never solo. Out ~2:30pm (7/8 shift).",
    flags:["Endo only","Never solo","Out ~2:30pm"]
  },
  "Thomas, Michael": {
    type:"MD", employed:true, cardiac:true, cardiacPrimary:true,
    strengths:["Open heart","TAVR","Thoracic","All cardiac"],
    avoidances:["Non-cardiac"],
    careTeam:false, blockCapable:false, thoracicCapable:true,
    callPref:"Cardiac cases only",
    lateStay:"per cardiac protocol", acuity:"cardiac",
    notes:"26 weeks on/off. Full cardiac primary.",
    flags:["Cardiac only"]
  },
  "Kane, Paul": {
    type:"MD", employed:true, cardiac:true, cardiacPrimary:true,
    strengths:["Open heart","TAVR","Thoracic","EP","Watchman","All cardiac"],
    avoidances:["Non-cardiac"],
    careTeam:false, blockCapable:false, thoracicCapable:true,
    callPref:"CV Call — highest tier case first",
    lateStay:"until 4pm", acuity:"cardiac",
    notes:"CV Call: Open Heart > TAVR > Thoracic > EP/Watchman > Cath minor. Out 4pm.",
    flags:["Cardiac only","Out 4pm — plan relief"]
  },
  "Munro, Jonathan": {
    type:"MD", employed:true, cardiac:true, cardiacPrimary:true, watchmanPreferred:true,
    strengths:["Open heart","TAVR","Thoracic","EP","Watchman TEE","All cardiac"],
    avoidances:["Non-cardiac"],
    careTeam:false, blockCapable:false, thoracicCapable:true,
    callPref:"Backup CV — second-tier. Watchman first choice (complex TEE).",
    lateStay:"until 4pm", acuity:"cardiac",
    notes:"Full cardiac. Watchman first choice — requires complex TEE skill. Out 4pm.",
    flags:["Cardiac only","Out 4pm — plan relief","Watchman preferred"]
  },

  // ── LOCUM MDs ────────────────────────────────────────────
  "Gathings, Vincent": {
    type:"MD", employed:false, locum:true,
    strengths:["Critical/sick cases","High acuity","Complex general"],
    avoidances:["Blocks","Fast turnover"],
    careTeam:true, blockCapable:false, thoracicCapable:true,
    callPref:"Complex or high-acuity room",
    lateStay:"sometimes", acuity:"high",
    notes:"Thorough but slow. Best: ICU-level, complex general. Not for fast rooms.",
    flags:["Slow turnover","Avoid block rooms"]
  },
  "Lambert": {
    type:"MD", employed:false, locum:true, fullName:"Lambert, Mark",
    strengths:["Regional","Shoulder","Fast turnover","Complex cases"],
    avoidances:[],
    careTeam:true, blockCapable:true, blockTypes:["shoulder","regional"],
    thoracicCapable:false,
    callPref:"Shoulder/ortho block rooms or general",
    lateStay:"rarely", acuity:"medium-high",
    notes:"Lambert, Mark. Regional capable. Backup shoulder if Nielson out. Mild self-limiting on acuity.",
    flags:["Acuity self-limiting — confirm complex cases"]
  },
  "Siddiqui": {
    type:"MD", employed:false, locum:true, fullName:"Siddiqui, Faisal A",
    strengths:["Generalist","Team player","Any assignment"],
    avoidances:["Blocks"],
    careTeam:true, blockCapable:false, thoracicCapable:false,
    callPref:"Any assignment — will do whatever needed",
    lateStay:"yes — first ask", acuity:"medium-high",
    notes:"Siddiqui, Faisal A. Best late-stay resource. Any assignment except blocks.",
    flags:["No blocks","First ask for late coverage"]
  },
  "Nielson, Mark": {
    type:"MD", employed:false, locum:true,
    strengths:["Shoulder/rotator cuff blocks","Regional","Generalist — anything"],
    avoidances:[],
    careTeam:true, blockCapable:true, blockTypes:["shoulder","rotator cuff","regional","US-guided"],
    thoracicCapable:true,
    callPref:"Shoulder/rotator cuff rooms first, then anything",
    lateStay:"sometimes", acuity:"high",
    notes:"First choice for shoulder/rotator cuff block rooms. Highly capable.",
    flags:[]
  },
  "Pond, William": {
    type:"MD", employed:false, locum:true, cardiacFillIn:true,
    strengths:["Open heart","TAVR","Thoracic","Blocks","High acuity","Backup CV fill-in","Anything"],
    avoidances:[],
    careTeam:true, blockCapable:true, blockTypes:["regional","US-guided","shoulder"],
    thoracicCapable:true,
    callPref:"Wherever needed — prefers challenge",
    lateStay:"yes — willing to work", acuity:"high",
    notes:"Full cardiac capable but keep as backup — doesn't know surgeon nuances. Fills Backup CV. Likes to work.",
    flags:["Cardiac fill-in — use if primary CV unavailable","Prefers challenging cases"]
  },
  "Dodwani": {
    type:"MD", employed:false, locum:true, cardiacFillIn:true,
    strengths:["Open heart","TAVR","Thoracic","Blocks","High acuity","Backup CV fill-in","Anything"],
    avoidances:[],
    careTeam:true, blockCapable:true, blockTypes:["regional","US-guided","shoulder"],
    thoracicCapable:true,
    callPref:"Wherever needed — identical profile to Pond",
    lateStay:"yes — willing to work", acuity:"high",
    notes:"Identical profile to Pond. Full cardiac capable. Fills Backup CV when needed.",
    flags:["Cardiac fill-in — use if primary CV unavailable"]
  },
  "Powell, Jason": {
    type:"MD", employed:false, locum:true,
    strengths:["Regional blocks","Fast turnover","Complex cases"],
    avoidances:[],
    careTeam:true, blockCapable:true, blockTypes:["shoulder","regional"],
    thoracicCapable:false,
    callPref:"Ortho block rooms or general",
    lateStay:"rarely", acuity:"medium-high",
    notes:"Identical profile to Lambert. Regional capable, fast turnover, complex cases.",
    flags:["Acuity self-limiting — confirm complex cases"]
  },
  "Fraley": {
    type:"MD", employed:false, locum:true,
    strengths:["Simple cases","EP","Gen surg","Endo","GYN"],
    avoidances:["Complex blocks — claims capable, often declines day-of","High acuity"],
    careTeam:true, blockCapable:false, thoracicCapable:false,
    callPref:"Simple to moderate cases only",
    lateStay:"rarely", acuity:"low-medium",
    notes:"Near retirement, tires easily. Confirm block capability day-of.",
    flags:["Confirm blocks day-of","Low acuity preferred","Near retirement"]
  },
  "Watkins": {
    type:"MD", employed:false, locum:true,
    strengths:["General cases — most types"],
    avoidances:["Blocks","Fast turnover","Complex high-acuity"],
    careTeam:true, blockCapable:false, thoracicCapable:false,
    callPref:"Any routine assignment",
    lateStay:"unlikely — near retirement", acuity:"medium",
    notes:"Near retirement. Can do most cases but not preferred in any specific room. No blocks, slow between cases. Not a fast-turnover provider.",
    flags:["Slow turnover — avoid fast rooms","No blocks","Near retirement — honor pace"]
  },
    type:"MD", employed:false, locum:true, fullName:"Shepherd, Meredith",
    strengths:["Generalist"],
    avoidances:["Care teams (prefers solo)"],
    careTeam:false, blockCapable:true, thoracicCapable:false,
    callPref:"Solo assignments preferred",
    lateStay:"unknown", acuity:"medium-high",
    notes:"Shepherd, Meredith. Occasional locum. Avoids care teams.",
    flags:["No care teams preferred"]
  },
};

// Late stay tendency lookup
export const LATE_STAY_PRIORITY = [
  "Siddiqui",       // First ask — always willing
  "Dodwani",        // Willing to work
  "Pond, William",  // Willing to work
  "Gathings, Vincent", // Sometimes
  "Nielson, Mark",  // Sometimes
  "Lambert",        // Rarely
  "Powell, Jason",  // Rarely
  "Fraley",         // Rarely
];

// Anesthetist shift definitions
export const ANESTHETIST_SHIFTS = {
  "Anesthetist 630a-730p": { start:"06:30", end:"19:30", label:"6:30a–7:30p", longShift:true },
  "Anesthetist 7a-3p":     { start:"07:00", end:"15:00", label:"7a–3p",       longShift:false },
  "Anesthetist 7a-5p":     { start:"07:00", end:"17:00", label:"7a–5p",       longShift:false },
  "Anesthetist 7a-8p":     { start:"07:00", end:"20:00", label:"7a–8p",       longShift:true },
  "CRNA 7a-7p":            { start:"07:00", end:"19:00", label:"7a–7p",       longShift:true },
  "Lead Anesthetist Admin Day": { start:null, end:null,  label:"Admin — NOT in OR", longShift:false },
  "Anesthetist Off/PTO":   { start:null, end:null,       label:"Off/PTO",      longShift:false },
};

// Known anesthetist roster — used for history tracking and dropdowns
export const ANESTHETIST_ROSTER = [
  'Anders, Kendall',
  'Benzinger',
  'Blakely, Spencer J',
  'Colaianni',
  'Hester, Charles',
  'Holt, Jordan',
  'Kemp, Sundance',
  'McCarter, Niko',
  'Monteiro, Derrianne M',
  'Nguyen, An B',
  'Soloway, Melanie',
  'Thompson, Riley',
];
