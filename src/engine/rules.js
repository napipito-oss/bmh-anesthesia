import { SURGEON_BLOCKS } from '../data/surgeons.js';
import { PROVIDERS } from '../data/providers.js';

export const CARE_TEAM_MAX_RATIO = 3;
export const CARE_TEAM_IDEAL_RATIO = 3;

export const CARE_TEAM_LOCATION_HARD_AVOIDANCES = ['BOOS', 'IR'];

export const BRAND_ENDO_RULE_LABEL = 'Care Team A: Brand → Endo';
export const BRAND_ENDO_PROVIDER = 'Brand, David L';

export const REGIONAL_BLOCK_PROVIDER_PRIORITY = [
  'Nielson, Mark',
  'Lambert',
  'Powell, Jason',
  'Pipito, Nicholas A',
  'Dodwani',
  'Pond, William',
];

export const CARE_TEAM_AVOID = ['Eskew, Gregory S', 'DeWitt, Bracken J'];
export const CARE_TEAM_RELUCTANT = [];

export const DOCTRINE_CATEGORIES = Object.freeze({
  HARD_CONSTRAINT: 'hard_constraint',
  OPERATIONAL_REQUIREMENT: 'operational_requirement',
  STRATEGIC_PREFERENCE: 'strategic_preference',
  SOFT_PREFERENCE: 'soft_preference',
});

const CARE_TEAM_DOCTRINE = Object.freeze({
  [BRAND_ENDO_PROVIDER]: [
    {
      category: DOCTRINE_CATEGORIES.HARD_CONSTRAINT,
      code: 'brand_endo_only_never_solo',
      note: 'Brand is Endo medical direction only; never generic care team or solo',
      excludesCareTeamOutsideEndo: true,
      excludesSolo: true,
    },
  ],
  'Eskew, Gregory S': [
    {
      category: DOCTRINE_CATEGORIES.HARD_CONSTRAINT,
      code: 'eskew_no_care_teams',
      note: 'No care teams per provider doctrine',
      excludesCareTeam: true,
    },
  ],
  'DeWitt, Bracken J': [
    {
      category: DOCTRINE_CATEGORIES.SOFT_PREFERENCE,
      code: 'dewitt_generally_avoid_care_teams',
      note: 'Generally avoid care teams per current simple assignment pattern',
      excludesCareTeam: true,
    },
  ],
});

function providerName(provider) {
  return typeof provider === 'string' ? provider : provider?.name;
}

export function getCareTeamDoctrineClassifications(provider, context = {}) {
  const name = providerName(provider);
  const profile = PROVIDERS[name];
  if (!name) return [];

  const classifications = [...(CARE_TEAM_DOCTRINE[name] || [])];

  // These categories organize doctrine for auditability only; they do not create
  // a scoring system or change priority ordering.
  if (profile?.careTeam === false && !classifications.some(item => item.excludesCareTeam)) {
    classifications.push({
      category: DOCTRINE_CATEGORIES.HARD_CONSTRAINT,
      code: 'profile_no_care_teams',
      note: 'No care teams per provider profile',
      excludesCareTeam: true,
    });
  }
  if (profile?.acuity === 'low' || profile?.acuity === 'low-medium') {
    classifications.push({
      category: DOCTRINE_CATEGORIES.SOFT_PREFERENCE,
      code: 'routine_acuity_preferred',
      note: 'Routine or moderate acuity preferred',
    });
  }
  if (profile?.avoidances?.some(item => /high-acuity|sick|complex/i.test(item))) {
    classifications.push({
      category: DOCTRINE_CATEGORIES.SOFT_PREFERENCE,
      code: 'restricted_high_acuity_participation',
      note: 'Restricted high-acuity participation',
    });
  }
  if (context.preserveSpecializedCoverage && (profile?.cardiacFillIn || profile?.cardiacPrimary)) {
    classifications.push({
      category: DOCTRINE_CATEGORIES.STRATEGIC_PREFERENCE,
      code: 'preserve_specialized_coverage_depth',
      note: 'Preserve for specialized cardiac coverage when possible',
    });
  }
  if (context.hasProtectedExpertiseRooms && profile?.blockCapable) {
    classifications.push({
      category: DOCTRINE_CATEGORIES.OPERATIONAL_REQUIREMENT,
      code: 'preserve_protected_regional_expertise',
      note: 'May need preservation for protected regional expertise rooms',
    });
  }

  return classifications;
}

export function getCareTeamEligibilityNotes(provider, context = {}) {
  if (!providerName(provider)) return ['No provider supplied'];
  return getCareTeamDoctrineClassifications(provider, context).map(item => item.note);
}

export function isEligibleForCareTeam(provider, context = {}) {
  const name = providerName(provider);
  if (!name) return false;

  if (name === BRAND_ENDO_PROVIDER) return context.area === 'endo';
  if (getCareTeamDoctrineClassifications(provider, context).some(item => item.excludesCareTeam)) return false;

  return true;
}

export function isEligibleForSoloAssignment(provider) {
  const name = providerName(provider);
  if (!name) return false;

  // Brand's staffing doctrine is Endo medical direction only, not solo rooms.
  if (getCareTeamDoctrineClassifications(provider).some(item => item.excludesSolo)) return false;

  return true;
}

function primaryDoctrineCategory(classifications, fallback = DOCTRINE_CATEGORIES.SOFT_PREFERENCE) {
  return classifications.find(item => item.category === DOCTRINE_CATEGORIES.HARD_CONSTRAINT)?.category ||
    classifications.find(item => item.category === DOCTRINE_CATEGORIES.OPERATIONAL_REQUIREMENT)?.category ||
    classifications.find(item => item.category === DOCTRINE_CATEGORIES.STRATEGIC_PREFERENCE)?.category ||
    classifications[0]?.category ||
    fallback;
}

export function buildAssignmentExplanation(room) {
  if (!room?.assignedProvider) return null;

  const area = room.isEndo ? 'endo' : 'main';
  const providerClassifications = room.careTeamDoctrineClassifications ||
    getCareTeamDoctrineClassifications(room.assignedProvider, {
      area,
      preserveSpecializedCoverage: room.isCardiac || room.isCathEP,
      hasProtectedExpertiseRooms: !!room.protectedExpertise?.qualified,
    });

  const protectedClassification = room.protectedExpertise?.doctrineCategory
    ? [{
        category: room.protectedExpertise.doctrineCategory,
        code: 'protected_expertise_reservation',
        note: room.protectedExpertise.note || 'Protected regional expertise preserved before generic care-team formation',
      }]
    : [];

  const classifications = [...protectedClassification, ...providerClassifications];
  const providerRestriction = providerClassifications.find(item => item.excludesCareTeam || item.excludesSolo);
  const conflict = room.avoidProviders?.includes(room.assignedProvider);
  const alternatePathway = !!room.protectedExpertise?.alternateRequired;
  const generalFillCompromise = /general fill|occupied|unavailable/i.test(room.cardiacNote || '');
  const assignmentType = conflict || alternatePathway || generalFillCompromise ? 'compromise' : 'standard';

  let primaryReason = 'Standard priority assignment';
  let note = 'Assigned through standard room coverage flow';

  if (room.protectedExpertise?.qualified) {
    primaryReason = `${room.room} - priority regional pathway`;
    note = alternatePathway
      ? 'Alternate qualified pathway used due to preferred provider unavailable'
      : 'Protected shoulder/regional expertise preserved before generic care-team formation';
  } else if (room.isEndo && room.isCareTeam) {
    primaryReason = 'Endoscopy care team';
    note = room.assignedProvider === BRAND_ENDO_PROVIDER
      ? 'Endoscopy care team - Brand preferred endoscopy assignment'
      : 'Endoscopy care team assigned through eligible provider pathway';
  } else if (room.isCareTeam) {
    primaryReason = 'Care-team assignment';
    note = providerRestriction
      ? `Care-team assignment reviewed against provider restriction: ${providerRestriction.note}`
      : 'Assigned through standard care-team formation';
  } else if (providerRestriction && !room.isCareTeam) {
    primaryReason = 'No care-team assignment';
    note = 'No care-team assignment - provider restriction';
  } else if (room.isORCallChoice) {
    primaryReason = 'OR Call selected room';
    note = 'Manual OR Call choice preserved before downstream assignment passes';
  } else if (room.cardiacNote) {
    primaryReason = room.cardiacNote;
    note = room.cardiacNote;
  } else if (room.roomState === 'Add-On Reserve' || room.isPhantom) {
    primaryReason = 'Add-on reserve coverage';
    note = 'Obligated reserve room carried forward for visible staffing coverage';
  } else if (conflict) {
    primaryReason = 'Assigned despite provider room avoidance';
    note = 'Compromise assignment - provider is flagged for this room';
  }

  return {
    primaryReason,
    doctrineCategory: primaryDoctrineCategory(classifications),
    assignmentType,
    note,
  };
}

export function buildAssignmentReviewNotes(room) {
  if (!room?.assignedProvider) return [];

  const notes = [];
  const providerProfile = PROVIDERS[room.assignedProvider];
  const explanation = room.assignmentExplanation || buildAssignmentExplanation(room);
  const highAcuity = ['high', 'cardiac', 'complex'].includes(String(room.acuity || '').toLowerCase());

  // Review notes are advisory only. They surface useful context without changing
  // assignment order, eligibility, reconciliation, or fairness behavior.
  if (room.protectedExpertise?.alternateRequired) {
    notes.push({
      category: 'review suggested',
      note: 'Preferred shoulder assignment unavailable; alternate-qualified pathway used.',
    });
  } else if (room.protectedExpertise?.qualified) {
    notes.push({
      category: 'informational',
      note: 'Protected regional expertise pathway was preserved for this room.',
    });
  }

  if (/general fill|occupied|unavailable/i.test(room.cardiacNote || '')) {
    notes.push({
      category: 'attention',
      note: 'Limited backup coverage remained; this room followed the general coverage pathway.',
    });
  }

  if (highAcuity && (providerProfile?.acuity === 'low' || providerProfile?.acuity === 'low-medium')) {
    notes.push({
      category: 'review suggested',
      note: 'High-acuity room assigned outside this provider\'s usual pattern; manual review may be helpful.',
    });
  }

  if (room.avoidProviders?.includes(room.assignedProvider)) {
    notes.push({
      category: 'review suggested',
      note: 'Restricted assignment used due to staffing; consider manual review.',
    });
  }

  if (explanation?.assignmentType === 'compromise' && notes.length === 0) {
    notes.push({
      category: 'attention',
      note: 'Assignment may benefit from manual review.',
    });
  }

  return notes;
}

export function annotateAssignmentExplanations(rooms = []) {
  return rooms.map(room => {
    const assignmentExplanation = buildAssignmentExplanation(room);
    const annotatedRoom = { ...room, assignmentExplanation };
    return {
      ...annotatedRoom,
      assignmentReviewNotes: buildAssignmentReviewNotes(annotatedRoom),
    };
  });
}

export function getProtectedExpertiseRoomMetadata(room) {
  if (!room?.cases?.length) return { qualified: false, reasons: [] };

  const cases = room.cases || [];
  const roomBlockTypes = (room.blockTypes || []).map(type => String(type).toLowerCase());
  const text = cases
    .map(c => `${c.procedure || ''} ${c.surgeon || ''}`)
    .join(' ')
    .toLowerCase();

  const surgeons = cases.map(c => (c.surgeon || '').split(',')[0].trim()).filter(Boolean);
  const surgeonProfiles = surgeons.map(name => SURGEON_BLOCKS[name]).filter(Boolean);
  const surgeonBlockTypes = surgeonProfiles
    .flatMap(profile => profile.blockTypes || [])
    .map(type => String(type).toLowerCase());

  const allBlockTypes = [...roomBlockTypes, ...surgeonBlockTypes];
  const hasInterscaleneSignal = allBlockTypes.some(type => type.includes('interscalene'));
  const hasShoulderAnatomy = /\b(shoulder|humerus|rotator cuff|glenoid|proximal humerus)\b/.test(text);
  const hasMajorShoulderProcedure =
    text.includes('shoulder arthroplasty') ||
    text.includes('shoulder replacement') ||
    text.includes('total shoulder') ||
    text.includes('reverse shoulder') ||
    text.includes('proximal humerus');

  // Triplet doctrine is protected because his shoulder and complex arm/hand cases
  // specifically require interscalene/regional expertise with named preferred providers.
  const tripletCase = surgeons.includes('Triplet');
  const tripletProtectedCase = tripletCase && (
    room.blockRequired ||
    hasShoulderAnatomy ||
    /\b(complex hand|complex arm|arthroplasty)\b/.test(text)
  );

  // Major shoulder/proximal humerus work is protected when the case itself signals
  // high-value regional expertise, independent of whether the surgeon string is clean.
  const majorShoulderCase = hasMajorShoulderProcedure || (hasShoulderAnatomy && hasInterscaleneSignal);

  // This is not "any block room." It only promotes block-required rooms when the
  // anatomy/procedure points to protected shoulder/humerus regional expertise.
  const blockDependentShoulderCase = room.blockRequired && hasShoulderAnatomy;

  const reasons = [];
  if (tripletProtectedCase) reasons.push('Triplet doctrine: shoulder/complex arm work needs protected regional expertise');
  if (hasMajorShoulderProcedure) reasons.push('Major shoulder/proximal humerus procedure');
  if (hasInterscaleneSignal) reasons.push('Interscalene block signal from room or surgeon doctrine');
  if (blockDependentShoulderCase) reasons.push('Block-required shoulder/humerus anatomy');

  return {
    qualified: tripletProtectedCase || majorShoulderCase || blockDependentShoulderCase,
    doctrineCategory: DOCTRINE_CATEGORIES.OPERATIONAL_REQUIREMENT,
    reasons,
  };
}

export function isProtectedExpertiseRoom(room) {
  return getProtectedExpertiseRoomMetadata(room).qualified;
}
