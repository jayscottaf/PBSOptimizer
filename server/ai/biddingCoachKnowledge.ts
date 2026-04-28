/**
 * Phase 0 knowledge base for the AI Bidding Coach.
 *
 * This is intentionally compact and source-linked. It gives the assistant
 * enough NAVBLUE/PBS structure to interview the pilot and draft strategy while
 * keeping the full PDFs as the deeper source of truth.
 */

export type CoachSourceId = 'navblue-bidder-guide' | 'delta-pbs-handbook';

export interface CoachSourceRef {
  sourceId: CoachSourceId;
  title: string;
  file: string;
  pages: string;
}

export interface CoachConcept {
  id: string;
  label: string;
  summary: string;
  sourceRefs: CoachSourceRef[];
}

export interface BidPreferenceTemplate {
  id: string;
  label: string;
  category:
    | 'award'
    | 'avoid'
    | 'prefer-off'
    | 'set-condition'
    | 'instruction'
    | 'waive'
    | 'reserve';
  useWhen: string[];
  coachGuidance: string[];
  draftPattern: string;
  sourceRefs: CoachSourceRef[];
}

export interface StrategyArchetype {
  id: string;
  label: string;
  goal: string;
  recommendedStructure: string[];
  warnings: string[];
}

const NAVBLUE_SOURCE: CoachSourceRef = {
  sourceId: 'navblue-bidder-guide',
  title: 'NAVBLUE N-PBS Bidder Guide 21-3',
  file: 'docs/navblue-pbs-bidder-guide (1).pdf',
  pages: '64-68, 173-183',
};

const DELTA_SOURCE: CoachSourceRef = {
  sourceId: 'delta-pbs-handbook',
  title: "Delta Pilots' PBS Reference Handbook v4",
  file: 'docs/PBS Reference Handbook.pdf',
  pages: '41-61, 67-86, 93-108',
};

export const BIDDING_COACH_CONCEPTS: CoachConcept[] = [
  {
    id: 'top-down-seniority-processing',
    label: 'Top-down seniority processing',
    summary:
      'PBS processes pilots in seniority order. By the time it reaches a pilot, more senior awards have reduced the available pairing pool. The coach should frame recommendations around what remains likely for the pilot seniority.',
    sourceRefs: [DELTA_SOURCE],
  },
  {
    id: 'bid-group-independence',
    label: 'Bid groups are independent attempts',
    summary:
      'PBS stays inside a bid group until the group builds an award, an exit instruction moves processing to the next group, or the pilot cannot hold that type of line. Pairing groups and reserve groups should be treated as separate strategy layers.',
    sourceRefs: [DELTA_SOURCE, NAVBLUE_SOURCE],
  },
  {
    id: 'conditional-vs-unconditional',
    label: 'Conditional versus unconditional bid groups',
    summary:
      'A bid group with Else Start Next or Clear Schedule and Start Next is conditional. Without those exits, a pairing group ultimately accepts any legal regular line PBS can build inside the group.',
    sourceRefs: [DELTA_SOURCE, NAVBLUE_SOURCE],
  },
  {
    id: 'line-construction-window',
    label: 'Line Construction Window',
    summary:
      'Regular lines are built inside the LCW around the ALV, subject to vacation/training/sick credit, FAR limits, and PWA limits. The coach should avoid promising an exact line value without simulating these constraints.',
    sourceRefs: [DELTA_SOURCE],
  },
  {
    id: 'negative-before-positive',
    label: 'Negative preferences filter before awards',
    summary:
      'Prefer Off and Avoid Pairings remove matching pairings from consideration; Award Pairings then attempts to place trips from the remaining pool. If negative filters are too restrictive, PBS can deny them unless guarded by a start-next instruction.',
    sourceRefs: [DELTA_SOURCE, NAVBLUE_SOURCE],
  },
  {
    id: 'system-generated-awards',
    label: 'System-generated award lines',
    summary:
      'PBS includes system-generated award behavior when a bid group cannot otherwise complete a line. The coach should tell pilots when a draft relies on system-generated fallback instead of explicit award lines.',
    sourceRefs: [DELTA_SOURCE],
  },
  {
    id: 'ordered-specific-pairings',
    label: 'Pairing Number Departing On with ordering',
    summary:
      'Specific pairing/date bids can be prioritized left to right with the ordered option. This is useful for an explicit wish list of pairings and dates, but it should not be treated as a broad strategy by itself.',
    sourceRefs: [DELTA_SOURCE],
  },
  {
    id: 'coverage-risk',
    label: 'Coverage can override preferences',
    summary:
      'Coverage processing can deny preferences to satisfy staffing needs. The coach should warn junior or holiday-month bidders that otherwise good-looking bids may be affected by coverage.',
    sourceRefs: [DELTA_SOURCE],
  },
];

export const BID_PREFERENCE_TEMPLATES: BidPreferenceTemplate[] = [
  {
    id: 'award-pairings',
    label: 'Award Pairings',
    category: 'award',
    useWhen: [
      'Pilot wants specific trips, trip lengths, credit ranges, routes, layovers, or dates.',
      'Pilot has a ranked target list from app pairing analysis.',
    ],
    coachGuidance: [
      'Order from most important or hardest-to-hold preference to broader fallback.',
      'Use limits when the pilot wants only a certain number from a class of trips.',
      'Pair with fallback award lines so PBS has enough material to complete a line.',
    ],
    draftPattern:
      'Award Pairings If [pairing property/date/route/layover/credit condition] [optional Limit N]',
    sourceRefs: [NAVBLUE_SOURCE, DELTA_SOURCE],
  },
  {
    id: 'avoid-pairings',
    label: 'Avoid Pairings',
    category: 'avoid',
    useWhen: [
      'Pilot wants to exclude redeyes, deadheads, undesirable report times, routes, layovers, or trip lengths.',
      'Pilot can tolerate PBS relaxing the avoid if needed unless an exit instruction is used.',
    ],
    coachGuidance: [
      'Avoids can be denied if they make a complete line impossible.',
      'Keep must-have avoids above a guarded exit strategy.',
      'Avoid overly broad filters that leave too few pairings for the pilot seniority.',
    ],
    draftPattern: 'Avoid Pairings If [undesired pairing property]',
    sourceRefs: [NAVBLUE_SOURCE, DELTA_SOURCE],
  },
  {
    id: 'prefer-off',
    label: 'Prefer Off',
    category: 'prefer-off',
    useWhen: [
      'Pilot wants specific calendar days, weekdays, weekends, or holiday blocks protected.',
      'Quality-of-life goals outrank trip selection.',
    ],
    coachGuidance: [
      'Date order matters when the pilot has multiple time-off priorities.',
      'Prefer Off can remove many pairings; watch for over-constraining the line.',
      'Use a start-next instruction when the pilot would rather try another strategy than have the request denied.',
    ],
    draftPattern: 'Prefer Off [date/day/date range]',
    sourceRefs: [NAVBLUE_SOURCE, DELTA_SOURCE],
  },
  {
    id: 'set-condition-credit',
    label: 'Set Condition credit window',
    category: 'set-condition',
    useWhen: [
      'Pilot wants a minimum, maximum, or mid-credit target for the final line.',
      'Pilot is balancing pay against quality of life.',
    ],
    coachGuidance: [
      'These are global line-construction conditions, not pairing filters.',
      'Place them near the top of the pairing bid group before award lines.',
      'Explain that thresholds and ALV can affect the final result.',
    ],
    draftPattern:
      'Set Condition [Minimum Credit | Maximum Credit | Mid Credit]',
    sourceRefs: [DELTA_SOURCE],
  },
  {
    id: 'else-start-next',
    label: 'Else Start Next Bid Group',
    category: 'instruction',
    useWhen: [
      'Pilot wants to abandon the current group if a specific preference cannot be honored.',
      'A must-have avoid or prefer-off should not simply be denied.',
    ],
    coachGuidance: [
      'Attach it to the preference that defines the boundary of the strategy.',
      'Use sparingly; too many exits can skip otherwise workable lines.',
    ],
    draftPattern: '[Preference] Else Start Next Bid Group',
    sourceRefs: [NAVBLUE_SOURCE, DELTA_SOURCE],
  },
  {
    id: 'clear-schedule-start-next',
    label: 'Clear Schedule and Start Next Bid Group',
    category: 'instruction',
    useWhen: [
      'Pilot wants PBS to try a clean fallback group instead of relying on system-generated awards or denied negative preferences.',
      'Pilot is testing a narrow premium strategy before broader fallback.',
    ],
    coachGuidance: [
      'Use after a focused group so the next group starts fresh.',
      'Explain that CSSN does not force any specific award line; it protects against completing the line by relaxing the group.',
    ],
    draftPattern: 'Clear Schedule and Start Next Bid Group',
    sourceRefs: [NAVBLUE_SOURCE, DELTA_SOURCE],
  },
  {
    id: 'waive',
    label: 'Waive',
    category: 'waive',
    useWhen: [
      'Pilot is willing to relax a specific contractual/scheduling protection that PBS allows to be waived.',
      'The waiver is intentional and tied to a clear goal.',
    ],
    coachGuidance: [
      'Never add a waiver casually.',
      'Ask for explicit pilot confirmation before including waivers in a draft bid.',
      'Describe the practical tradeoff in plain language.',
    ],
    draftPattern: 'Waive [allowed waiver type]',
    sourceRefs: [NAVBLUE_SOURCE, DELTA_SOURCE],
  },
  {
    id: 'reserve-fallback',
    label: 'Reserve fallback group',
    category: 'reserve',
    useWhen: [
      'Pilot may not hold a regular line or wants a reserve strategy if regular goals fail.',
      'Holiday or junior-lineholder risk makes reserve fallback worth planning.',
    ],
    coachGuidance: [
      'Ask whether the pilot prefers a regular line at lower quality or reserve with protected days.',
      'Keep reserve goals in a separate bid group from pairing awards.',
    ],
    draftPattern:
      'Reserve Bid Group with [reserve days off / reserve line preferences]',
    sourceRefs: [NAVBLUE_SOURCE, DELTA_SOURCE],
  },
];

export const STRATEGY_ARCHETYPES: StrategyArchetype[] = [
  {
    id: 'quality-of-life',
    label: 'Quality of life first',
    goal: 'Protect days off and avoid fatigue drivers before chasing pay.',
    recommendedStructure: [
      'Pairing Bid Group',
      'Prefer Off must-have dates in priority order',
      'Avoid Pairings for fatigue or lifestyle exclusions',
      'Award Pairings for acceptable trip classes',
      'Guard with Else Start Next or CSSN if the pilot would rather fall back than relax must-haves',
      'Broader fallback Pairing Bid Group',
    ],
    warnings: [
      'Can become too restrictive if the pilot has junior seniority.',
      'Needs enough fallback award material to avoid system-generated results.',
    ],
  },
  {
    id: 'maximize-credit',
    label: 'Maximize credit',
    goal: 'Target high-credit trips and upper credit line construction while preserving legal/rest constraints.',
    recommendedStructure: [
      'Set Condition Maximum Credit when appropriate',
      'Award Pairings for high credit and efficient trips',
      'Avoid the most unacceptable fatigue or route items',
      'Broaden award filters as the fallback group',
    ],
    warnings: [
      'High-credit desirable trips may be senior and hard to hold.',
      'Credit goals can conflict with days-off goals.',
    ],
  },
  {
    id: 'specific-wishlist',
    label: 'Specific pairing wishlist',
    goal: 'Prioritize named pairings/dates from the app shortlist.',
    recommendedStructure: [
      'Award Pairings using Pairing Number Departing On in desired order',
      'Optional limit to avoid over-awarding from the list',
      'Secondary Award Pairings for similar trips by attributes',
      'Fallback group for broader acceptable pairings',
    ],
    warnings: [
      'A specific-pairing list is brittle if pairings are already gone by seniority.',
      'Needs broader fallback lines to prevent poor system-generated completion.',
    ],
  },
  {
    id: 'holiday-protection',
    label: 'Holiday protection',
    goal: 'Protect key holiday dates while still giving PBS a realistic path to complete a line.',
    recommendedStructure: [
      'Prefer Off holiday dates in true priority order',
      'Avoid Pairings that touch protected windows if needed',
      'Award Pairings around the protected dates',
      'Conditional fallback group for less ideal but acceptable lines',
      'Reserve fallback if the pilot prefers reserve over losing the dates',
    ],
    warnings: [
      'Coverage risk is higher around holidays.',
      'Junior bidders should expect some preferences may be denied without guarded fallback logic.',
    ],
  },
];

export function buildBiddingCoachKnowledgeContext(): string {
  const conceptLines = BIDDING_COACH_CONCEPTS.map(
    concept => `- ${concept.label}: ${concept.summary}`
  ).join('\n');

  const templateLines = BID_PREFERENCE_TEMPLATES.map(template => {
    const guidance = template.coachGuidance.join(' ');
    return `- ${template.label}: ${template.draftPattern}. ${guidance}`;
  }).join('\n');

  const strategyLines = STRATEGY_ARCHETYPES.map(strategy => {
    return `- ${strategy.label}: ${strategy.goal} Structure: ${strategy.recommendedStructure.join(' > ')}`;
  }).join('\n');

  return `AI BIDDING COACH KNOWLEDGE BASE
Use this only for bid-strategy and NAVBLUE bid-drafting questions. Keep recommendations grounded in the loaded bid package and the pilot's seniority.

Core PBS/NAVBLUE concepts:
${conceptLines}

Bid preference patterns:
${templateLines}

Strategy archetypes:
${strategyLines}

Coach operating rules:
- Interview first when goals are ambiguous: ask about pay vs quality of life, must-have days off, avoidances, layovers/routes, commute constraints, and reserve tolerance.
- Draft bid text as a starting point for pilot review, not as a guaranteed award.
- Never call an award, day off, or pairing result guaranteed.
- Do not call Phase 0 drafts copy-and-paste-ready; label them as review-ready starting drafts until the exporter exists.
- Never add waivers unless the pilot explicitly asks for that tradeoff.
- Prefer a narrow ideal group followed by broader fallback groups over one over-constrained group.
- Call out where a future simulator is needed before making award predictions.`;
}
