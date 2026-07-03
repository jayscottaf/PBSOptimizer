/**
 * Knowledge base for the AI Bidding Coach.
 *
 * Compact and source-linked. Every entry is verified against the extracted
 * rule references in docs/ai-bidding-coach/navblue-rules.md and
 * docs/ai-bidding-coach/delta-rules.md (page-cited from the NAVBLUE N-PBS
 * Bidder's Guide 21-3 and the Delta MEC PBS Reference Handbook v4). Do not
 * edit rule content here without checking those references first.
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

function navblue(pages: string): CoachSourceRef {
  return {
    sourceId: 'navblue-bidder-guide',
    title: 'NAVBLUE N-PBS Bidder Guide 21-3',
    file: 'docs/ai-bidding-coach/navblue-rules.md',
    pages,
  };
}

function delta(pages: string): CoachSourceRef {
  return {
    sourceId: 'delta-pbs-handbook',
    title: "Delta Pilots' PBS Reference Handbook v4",
    file: 'docs/ai-bidding-coach/delta-rules.md',
    pages,
  };
}

export const BIDDING_COACH_CONCEPTS: CoachConcept[] = [
  {
    id: 'top-down-seniority-processing',
    label: 'Top-down seniority processing',
    summary:
      'PBS processes pilots in seniority order. By the time it reaches a pilot, more senior awards have reduced the available pairing pool. Frame recommendations around what remains likely at the pilot seniority.',
    sourceRefs: [navblue('134'), delta('147')],
  },
  {
    id: 'step-by-step-not-priority',
    label: 'Step-by-step, not weighted priority',
    summary:
      'PBS executes preferences sequentially top-down; it is NOT a weighted-priority system. The most common serious bidding mistake is layering Award Pairings expecting AND/priority behavior. Within one preference, multiple conditions are logical AND and lists inside a condition are OR. Comma lists have equal priority — to rank items, split them into separate bids. Only Prefer Off and Ordered Pairing Number Departing On honor left-to-right priority.',
    sourceRefs: [delta('147-149'), navblue('173')],
  },
  {
    id: 'bid-group-independence',
    label: 'Bid groups are independent attempts',
    summary:
      'Each bid group is independent; preferences only apply inside their own group. PBS will not accept multiple pairing (or reserve) groups unless all but the last contain Else Start Next or Clear Schedule and Start Next. Never place a Start Next in the last bid group.',
    sourceRefs: [navblue('64-66, 180'), delta('148, 152')],
  },
  {
    id: 'negative-scope',
    label: 'Negatives remove from the pool and scope everything after them',
    summary:
      'Prefer Off and Avoid Pairings remove matching pairings from the pool; one matching leg excludes the whole pairing. An Avoid affects every Award preference placed after it, so negatives silently kill later positives (e.g. an Avoid on early departures removes MIA layover pairings a later Award wanted). Set Condition, Prefer Off, and Avoid are honored 100% unless a Forget instruction fires or Denial Mode is entered.',
    sourceRefs: [navblue('171-172, 175, 183')],
  },
  {
    id: 'optimization-pipeline',
    label: 'Substitution, vertical swapping, and shuffling',
    summary:
      'Before denying anything, PBS optimizes: Substitution swaps an awarded pairing for a different one matching the same higher preference to make room for a lower one. Vertical Swapping can pull pairings off more-senior blocks if it can replace them with equally desirable ones matching that senior bid. Shuffling (the last step before Denial Mode) recombines only Award pairings placed after the last negative preference — so preference order controls shuffling scope. Followed By pairings are never shuffled.',
    sourceRefs: [navblue('184, 190-194')],
  },
  {
    id: 'denial-mode-ordering',
    label: 'Denial Mode removes preferences in a specific order',
    summary:
      'If shuffling fails, Denial Mode rebuilds top-down denying preferences: Set Condition and Avoid Pairings are removed entirely (whole preference, even multi-option lists); Prefer Off items are removed one at a time from the END of the list leftward, so list the most important dates first; Vacation/Reserve GDO and Slide Vacation are denied only after all Avoid and Prefer Off preferences. Each denial clears all previously awarded pairings and reprocesses. If everything deniable is removed and the block is still incomplete, Secondary Line Generation ignores all preferences and does an exhaustive search.',
    sourceRefs: [navblue('181, 184, 194-196')],
  },
  {
    id: 'credit-windows-delta',
    label: 'Delta credit windows (ALV, LCW, thresholds)',
    summary:
      'ALV is 72:00-84:00 (narrowbody/7ER) or 71:00-85:00 (widebody). The Line Construction Window is ALV plus/minus 10 hrs, capped at 91.5 (NB) / 92.5 (WB). Min Credit window = bottom of LCW to ALV; Max Credit = ALV to top; Mid Credit = ALV plus/minus 5. Admin can cap the number of Min or Max Credit bidders by seniority (Mid Credit cannot be restricted); if capped and no ESN/CSSN is attached, PBS ignores the Set Condition and uses the full LCW. PBS stops awarding once credit passes the threshold, and will NOT deny preferences solely to reach threshold — but a Min/Max Credit Set Condition WILL trigger Denial Mode if the block is below the window minimum, and if that Set Condition is itself denied the window reverts to Normal while previously denied negatives stay denied. Vacation/training/sick credit (VTS) counts toward the line value.',
    sourceRefs: [delta('46, 50-52, 93-94'), navblue('187-189, 195')],
  },
  {
    id: 'slide-vacation-pvpp',
    label: 'Slide Vacation and PVPP',
    summary:
      'Slide Vacation is a global Set Condition (top of the group, cannot be forgotten) that moves pre-awarded vacation; one direction per bid group; it cannot split a vacation block, and PVPP+PVAC slide as one block. Coverage processing ignores Slide Vacation, so always back a slide up with Prefer Off on the target dates. Slides cannot land vacation on Blackout Dates (around New Year, July 4, Thanksgiving, Christmas) except in narrow extra-X-day cases.',
    sourceRefs: [delta('68, 99-101, 124')],
  },
  {
    id: 'redeye-definition',
    label: 'Redeye is a defined term',
    summary:
      'At Delta, a redeye is any eastbound unaugmented flight segment that intrudes on the pilot WOCL (0200-0559 acclimated) or touches 0200-0359 in the time zone flown over. Avoid If Every Leg Redeye only removes pairings where every leg qualifies — mixed pairings survive.',
    sourceRefs: [delta('125'), navblue('174-178')],
  },
  {
    id: 'coverage-precedence',
    label: 'Coverage awards take precedence over ALL preferences',
    summary:
      'Coverage (unstacking) assigns leftover mutually exclusive pairings to junior crew below a computed seniority point as unmovable pre-awards before their bid is processed; it can appear to violate seniority. The scheduler picks the stack pairing that conflicts with the fewest Avoid/Prefer Off preferences and best matches Awards. If the coverage pairing violates a Prefer Off/Avoid that carries Else Start Next, the ESN is attempted first (except language coverage). Warn junior and holiday-month bidders.',
    sourceRefs: [navblue('196-201')],
  },
  {
    id: 'reserve-no-optimization',
    label: 'Reserve lines get no optimization and no Denial Mode',
    summary:
      'Reserve block selection honors reserve preferences top-to-bottom cumulatively: it keeps already-honored preferences, skips one that conflicts, and moves on — no substitution, shuffling, or Denial Mode (coverage can still apply). Admin caps reserve lines by seniority (Max Reserves), so always assume reserve is limited. A reserve bid group does not hurt regular-line chances unless a Start Next precedes it — the handbook rule of thumb is to bid both a pairing group and a reserve group.',
    sourceRefs: [navblue('186'), delta('129, 135-136, 148')],
  },
  {
    id: 'system-generated-awards',
    label: 'System-generated award fallback',
    summary:
      'If a bid group reaches its last preference with an incomplete block, a system-generated Award Pairings fills the line with any pool-legal pairings that honor the negatives. Tell pilots when a draft is thin enough that the line will mostly be built by this fallback rather than their own Award lines.',
    sourceRefs: [navblue('183-185')],
  },
  {
    id: 'ordered-specific-pairings',
    label: 'Pairing Number Departing On with ordering',
    summary:
      'Specific pairing/date bids can be prioritized left to right with the ordered option — one of only two places order inside a preference matters. Useful for an explicit wish list, but brittle if the pairings are gone by the pilot seniority; back it with attribute-based Awards.',
    sourceRefs: [navblue('173'), delta('148')],
  },
  {
    id: 'reasons-report-vocabulary',
    label: 'Reasons Report vocabulary',
    summary:
      'Key outcomes: Honored; Not honored (denied, contradicting activity on the line) vs Not considered (denied, nothing contradicts); Partially honored (part of a Prefer Off list); Filtered by higher bid (removed by an earlier negative); Beyond bid limit (Limit hit); Awarded to senior bidder; Block is complete. Top banners Affected by Denial Mode / SLG / Coverage signal the whole line was affected. Use these exact meanings when interpreting a report.',
    sourceRefs: [navblue('132-139'), delta('143-146')],
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
      'Bid from specific to general: narrow high-value Awards first, broader fallback Awards after.',
      'Items in one Award (comma lists) have equal priority - split into separate bids to rank them.',
      'Multiple conditions in one Award are logical AND; use that to narrow, not to list alternatives.',
      'Use Limit N when the pilot wants only a certain number from a class of trips; Limit applies only to the preference it is attached to.',
      'Provide enough Award material to complete a line, or the system-generated fallback will fill it.',
    ],
    draftPattern:
      'Award Pairings If [pairing property/date/route/layover/credit condition] [optional Limit N]',
    sourceRefs: [navblue('173-175'), delta('148, 151')],
  },
  {
    id: 'avoid-pairings',
    label: 'Avoid Pairings',
    category: 'avoid',
    useWhen: [
      'Pilot wants to exclude redeyes, deadheads, undesirable report times, routes, layovers, or trip lengths.',
      'The exclusion matters more than any single Award below it.',
    ],
    coachGuidance: [
      'An Avoid affects every Award placed after it - position it deliberately.',
      'In Denial Mode an Avoid is removed entirely (the whole preference, even multi-option lists), so keep separate concerns in separate Avoids.',
      'One matching leg excludes the whole pairing.',
      'Avoid placement also sets the shuffling boundary: only Awards after the last negative can be shuffled.',
      'Attach Else Start Next to a must-have Avoid instead of letting it be silently denied.',
    ],
    draftPattern: 'Avoid Pairings If [undesired pairing property]',
    sourceRefs: [navblue('175, 184, 192-195'), delta('151')],
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
      'List dates in true priority order with the most important FIRST: Denial Mode drops Prefer Off items one at a time from the END of the list.',
      'Prefer Off is one of only two preference types where left-to-right order matters.',
      'It removes many pairings from the pool - watch for over-constraining at junior seniority.',
      'Attach Else Start Next when the pilot would rather fall back to another strategy than have the dates denied.',
    ],
    draftPattern: 'Prefer Off [date/day/date range, most important first]',
    sourceRefs: [navblue('173, 184, 195'), delta('148')],
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
      'Global line-construction conditions, forced above Award lines; they cannot be forgotten.',
      'Min Credit = bottom of LCW to ALV; Max Credit = ALV to top; Mid Credit = ALV plus/minus 5 hrs.',
      'Admin can cap Min/Max Credit bidders by seniority (Mid Credit cannot be capped). If capped without ESN/CSSN, PBS ignores the bid and uses the full LCW.',
      'A Min/Max Credit bid WILL trigger Denial Mode if the block cannot reach the window minimum; if the Set Condition is denied, the window reverts to Normal and previously denied negatives stay denied.',
    ],
    draftPattern:
      'Set Condition [Minimum Credit | Maximum Credit | Mid Credit]',
    sourceRefs: [delta('93-94'), navblue('181-182, 189, 195')],
  },
  {
    id: 'else-start-next',
    label: 'Else Start Next Bid Group',
    category: 'instruction',
    useWhen: [
      'Pilot wants to abandon the current group if a specific preference cannot be honored.',
      'A must-have Avoid, Prefer Off, or Set Condition should not simply be denied.',
    ],
    coachGuidance: [
      'Attachable to Prefer Off, Avoid Pairings, and certain Set Condition bids.',
      'Coverage tries an attached ESN before forcing a violating coverage pairing (except language coverage) - it is the only preference-level protection against coverage.',
      'Required (or CSSN) in every bid group except the last for PBS to accept multiple groups.',
      'Use sparingly; too many exits skip otherwise workable lines.',
    ],
    draftPattern: '[Preference] Else Start Next Bid Group',
    sourceRefs: [navblue('92, 198'), delta('148')],
  },
  {
    id: 'clear-schedule-start-next',
    label: 'Clear Schedule and Start Next Bid Group',
    category: 'instruction',
    useWhen: [
      'Pilot is testing a narrow premium strategy and wants a clean fallback group if it cannot fully work.',
      'Pilot would rather restart from scratch than accept system-generated fill or denied negatives.',
    ],
    coachGuidance: [
      'CSSN is forced to the bottom of its pairing group; triggering it REMOVES all pairings already awarded in the group and starts the next group fresh.',
      'PBS attempts substitution and shuffling before executing CSSN.',
      'CSSN moves on without processing the system-generated Award Pairings and without denying restrictions.',
      'Never in the last bid group: there, system-generated Award Pairings then Start Reserve complete the block anyway.',
    ],
    draftPattern: 'Clear Schedule and Start Next Bid Group',
    sourceRefs: [navblue('180'), delta('148, 152')],
  },
  {
    id: 'waive',
    label: 'Waive',
    category: 'waive',
    useWhen: [
      'Pilot is willing to relax a specific waivable protection (e.g. the 48-hr break between different-direction ocean-crossing rotations down to 24 hrs).',
      'The waiver is intentional and tied to a clear goal.',
    ],
    coachGuidance: [
      'Never add a waiver casually; ask for explicit pilot confirmation first.',
      'Only rules PBS exposes as waivable can be waived; some are only adjustable, not removable. WOCL-intrusion rest protections cannot be waived.',
      'Describe the practical tradeoff in plain language.',
    ],
    draftPattern: 'Waive [allowed waiver type]',
    sourceRefs: [navblue('179'), delta('47-48')],
  },
  {
    id: 'reserve-fallback',
    label: 'Reserve bid group',
    category: 'reserve',
    useWhen: [
      'Pilot may not hold a regular line or wants a reserve strategy if regular goals fail.',
      'Holiday or junior-lineholder risk makes reserve fallback worth planning.',
    ],
    coachGuidance: [
      'Handbook rule of thumb: bid BOTH a pairing group and a reserve group - the reserve group does not hurt regular-line chances unless a Start Next precedes it.',
      'Reserve preferences are honored top-to-bottom cumulatively with no optimization and no Denial Mode; order them by true priority.',
      'Reserve line rules run Min Days On - Max Days On - Max X-day Blocks (e.g. 3-99-5) and Max Reserves caps reserve lines by seniority - always assume reserve is limited.',
      'To prefer any regular line over reserve, place the Start Next before the Reserve group.',
    ],
    draftPattern:
      'Start Reserve, then reserve preferences (days off / X-day blocks) in priority order',
    sourceRefs: [navblue('186'), delta('129, 135-136, 148')],
  },
];

export const STRATEGY_ARCHETYPES: StrategyArchetype[] = [
  {
    id: 'quality-of-life',
    label: 'Quality of life first',
    goal: 'Protect days off and avoid fatigue drivers before chasing pay.',
    recommendedStructure: [
      'Pairing Bid Group',
      'Prefer Off must-have dates, most important FIRST (denial drops from the end)',
      'Avoid Pairings for fatigue or lifestyle exclusions, placed before Awards',
      'Award Pairings from specific to general',
      'Else Start Next on the true must-haves so they exit instead of being denied',
      'Broader fallback Pairing Bid Group, then a Reserve group last',
    ],
    warnings: [
      'Negatives remove pairings from every Award below them - an over-broad Avoid silently kills good trips.',
      'Can become too restrictive at junior seniority; needs enough fallback Award material to avoid system-generated fill.',
    ],
  },
  {
    id: 'maximize-credit',
    label: 'Maximize credit',
    goal: 'Target high-credit trips and upper credit line construction while preserving legal/rest constraints.',
    recommendedStructure: [
      'Set Condition Maximum Credit (know it can be capped by seniority and can force Denial Mode)',
      'Award Pairings for high credit and efficient trips, specific to general',
      'Only the truly unacceptable Avoids, placed before the Awards',
      'Conditional exit, then a broader fallback group without the Max Credit condition',
    ],
    warnings: [
      'Admin may cap Max Credit bidders; without ESN/CSSN the condition is silently ignored.',
      'If the Max Credit condition is denied in Denial Mode, the window reverts to Normal and already-denied negatives stay denied.',
      'High-credit desirable trips go senior; check hold probability before anchoring on them.',
    ],
  },
  {
    id: 'specific-wishlist',
    label: 'Specific pairing wishlist',
    goal: 'Prioritize named pairings/dates from the app shortlist.',
    recommendedStructure: [
      'Award Pairings using Ordered Pairing Number Departing On in desired order (order matters here)',
      'Optional Limit to avoid over-awarding from the list',
      'Secondary Award Pairings for similar trips by attributes',
      'Fallback group for broader acceptable pairings',
    ],
    warnings: [
      'A specific-pairing list is brittle if the pairings are gone by seniority - check hold probability per pairing.',
      'Followed By sequences are never shuffled, which reduces optimization room.',
      'Needs broader fallback lines to prevent poor system-generated completion.',
    ],
  },
  {
    id: 'holiday-protection',
    label: 'Holiday protection',
    goal: 'Protect key holiday dates while still giving PBS a realistic path to complete a line.',
    recommendedStructure: [
      'Prefer Off holiday dates in true priority order, most important first',
      'Avoid Pairings that touch the protected window if needed, before Awards',
      'Award Pairings around the protected dates',
      'Else Start Next on the protected dates so coverage tries the exit before forcing a violating pairing',
      'Reserve group if the pilot prefers reserve over losing the dates',
    ],
    warnings: [
      'Coverage takes precedence over ALL preferences and is most likely around holidays; an attached Else Start Next is the only preference-level protection.',
      'Junior bidders should expect denials without guarded fallback logic.',
      'If vacation touches the month, remember coverage ignores Slide Vacation - back slides with Prefer Off.',
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
Use this only for bid-strategy and NAVBLUE bid-drafting questions. Keep recommendations grounded in the loaded bid package and the pilot's seniority. Rules below are verified against the NAVBLUE Bidder's Guide 21-3 and the Delta MEC PBS Reference Handbook v4.

Core PBS/NAVBLUE concepts:
${conceptLines}

Bid preference patterns:
${templateLines}

Strategy archetypes:
${strategyLines}

Coach operating rules:
- Interview first when goals are ambiguous: ask about pay vs quality of life, must-have days off, avoidances, layovers/routes, commute constraints, and reserve tolerance.
- Draft bid text as a starting point for pilot review, not as a guaranteed award.
- Never call an award, day off, or pairing result guaranteed. Avoid guarantee-adjacent phrasing such as "ensures", "will get", "locks in", or "will hold"; use "gives PBS a path to" or "improves the chance of" instead.
- Do not call drafts copy-and-paste-ready; label them as review-ready starting drafts until the exporter exists.
- If the pilot asks to fall back rather than have must-have dates or avoids denied, attach Else Start Next to those preferences (or use Clear Schedule and Start Next for a clean restart) before broader fallback groups - and never place a Start Next in the last bid group.
- Default to recommending both a pairing bid group and a final reserve bid group.
- Never add waivers unless the pilot explicitly asks for that tradeoff.
- Prefer a narrow ideal group followed by broader fallback groups over one over-constrained group.
- Remind pilots that PBS is step-by-step, not priority-weighted, when their stated plan assumes ranking.
- Call out where a future simulator is needed before making award predictions.`;
}
