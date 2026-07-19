/**
 * Bid optimizer: turns a pilot's preference profile + a bid package into
 * a ready-to-review DraftBid (cascaded groups with fallbacks), scored by
 * that pilot's own objective.
 *
 * Pure function over plain data — no DB/OpenAI imports (testable in
 * scripts/bid-tools-check.ts). The pilot's style arrives entirely via
 * BidProfileWeights + overrides; nothing here favors any particular
 * station, city, or pattern (multi-pilot constraint).
 *
 * Strategy (mirrors how strong human bidders structure bids, without
 * copying any one pilot's choices):
 *   1. Merge profile + monthly overrides into an effective objective.
 *   2. Score every pairing 0..1 = blend of normalized credit-per-day and
 *      QoL fit (liked/disliked layovers, station avoids, redeye,
 *      carry-out, trip-length appetite), weighted by creditLeaning.
 *   3. Emit profile-driven negatives (avoids) + Prefer Off dates.
 *   4. Award cascade inside each group: named top picks first (specific
 *      pairing numbers, ranked), then attribute tiers per preferred trip
 *      length, then a generic fallback.
 *   5. Multi-group cascade: strictest line-shape first; relax stepwise
 *      (days-off minimum ladder, then drop soft avoids) until the
 *      completion estimator says the group can plausibly fill a line at
 *      this seniority. Each non-final group exits with Else Start Next.
 */

import type {
  BidGroup,
  BidPreference,
  BidProfileWeights,
  DraftBid,
  PairingFilter,
} from '../../shared/bidTypes';

export interface OptimizerOptions {
  /** 0 (most senior) .. 100 (most junior) within category. */
  seniorityPercentile?: number;
  /** Per-trip-length junior-most percentile evidence (from Reasons
   * history): if the pilot's percentile is above boundary, that length
   * rarely reaches them. */
  holdBoundaries?: { pairingDays: number; juniorMostPercentile: number }[];
  /** Line-credit threshold (defaults 78). */
  threshold?: number;
  /** Monthly overrides layered on the learned profile. */
  overrides?: Partial<BidProfileWeights> & {
    preferOffDates?: string[];
    creditWindow?: 'min' | 'max' | 'mid' | null;
  };
  /** Cap on named pairing numbers per award tier. */
  topPicksPerLength?: number;
  /**
   * Cascade depth. 'auto' (default) matches depth to the completion
   * estimate — comfortable seniors get 2-3 groups, pilots whose Group 1
   * will never complete get the full extended relaxation ladder.
   * 'compact' caps at 3 groups; 'deep' always builds the full ladder.
   */
  depth?: 'auto' | 'compact' | 'deep';
}

export interface ScoredPairing {
  pairingNumber: string;
  score: number;
  creditNorm: number;
  qolNorm: number;
  holdProbability: number | null;
  pairingDays: number;
  creditHours: number;
  reasons: string[];
}

export interface OptimizedBid {
  bid: DraftBid;
  rationale: string[];
  scored: ScoredPairing[];
  /** 0..1 estimate that group 1 completes at this seniority. */
  group1Completion: number;
}

interface OptPairing {
  pairingNumber: string;
  creditHours: number;
  blockHours: number;
  pairingDays: number;
  holdProbability: number | null;
  layoverCities: string[];
  checkInStation: string | null;
  hasRedeye: boolean;
  carryOutDays: number;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  const p = parseFloat(String(v ?? ''));
  return Number.isNaN(p) ? 0 : p;
}

function toOptPairing(p: any): OptPairing {
  let layovers = p.layovers;
  if (typeof layovers === 'string') {
    try {
      layovers = JSON.parse(layovers);
    } catch {
      layovers = [];
    }
  }
  let segments = p.flightSegments;
  if (typeof segments === 'string') {
    try {
      segments = JSON.parse(segments);
    } catch {
      segments = [];
    }
  }
  const segArr = Array.isArray(segments) ? segments : [];
  const hasRedeye = segArr.some((s: any) => {
    const m = String(s?.departureTime ?? '').match(/^(\d{2})/);
    if (!m) return false;
    const h = parseInt(m[1], 10);
    return h >= 22 || h < 5;
  });
  return {
    pairingNumber: String(p.pairingNumber ?? ''),
    creditHours: toNumber(p.creditHours),
    blockHours: toNumber(p.blockHours),
    pairingDays: p.pairingDays || 1,
    holdProbability:
      p.holdProbability === null || p.holdProbability === undefined
        ? null
        : Number(p.holdProbability),
    layoverCities: (Array.isArray(layovers) ? layovers : [])
      .map((l: any) => String(l?.city ?? '').toUpperCase())
      .filter(Boolean),
    checkInStation: segArr.length
      ? String(segArr[0]?.departure ?? '').toUpperCase() || null
      : null,
    hasRedeye,
    carryOutDays: 0, // shape-level; carry-out negatives use the filter
  };
}

function mergeProfile(
  base: BidProfileWeights,
  overrides?: OptimizerOptions['overrides']
): BidProfileWeights {
  if (!overrides) return base;
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        ([k, v]) =>
          v !== undefined && !['preferOffDates', 'creditWindow'].includes(k)
      )
    ),
  } as BidProfileWeights;
}

export function scorePairings(
  rawPairings: any[],
  profile: BidProfileWeights
): ScoredPairing[] {
  const ps = rawPairings.map(toOptPairing).filter(p => p.creditHours > 0);
  if (ps.length === 0) return [];
  const cpds = ps.map(p => p.creditHours / Math.max(1, p.pairingDays));
  const cMin = Math.min(...cpds);
  const cMax = Math.max(...cpds);
  const span = cMax - cMin || 1;
  const lengthRank = new Map<number, number>();
  profile.preferredTripLengths.forEach((len, i) =>
    lengthRank.set(len, profile.preferredTripLengths.length - i)
  );
  const maxRank = profile.preferredTripLengths.length || 1;

  return ps
    .map(p => {
      const reasons: string[] = [];
      const creditNorm = (p.creditHours / Math.max(1, p.pairingDays) - cMin) / span;

      let qol = 0.5;
      const liked = p.layoverCities.filter(c =>
        profile.layoverLikes.includes(c)
      );
      const disliked = p.layoverCities.filter(c =>
        profile.layoverDislikes.includes(c)
      );
      if (liked.length) {
        qol += 0.25;
        reasons.push(`layover in liked ${liked.join('/')}`);
      }
      if (disliked.length) {
        qol -= 0.3;
        reasons.push(`layover in disliked ${disliked.join('/')}`);
      }
      if (
        p.checkInStation &&
        profile.checkInStationAvoids.includes(p.checkInStation)
      ) {
        qol -= 0.35;
        reasons.push(`checks in at avoided ${p.checkInStation}`);
      }
      if (profile.avoidsRedeyes && p.hasRedeye) {
        qol -= 0.25;
        reasons.push('has redeye leg');
      }
      const rank = lengthRank.get(p.pairingDays) ?? 0;
      if (rank > 0) {
        qol += 0.2 * (rank / maxRank);
        reasons.push(`${p.pairingDays}-day matches trip-length appetite`);
      }
      const qolNorm = Math.max(0, Math.min(1, qol));

      // creditLeaning -1..1 → credit weight 0..1
      const w = (profile.creditLeaning + 1) / 2;
      const score = w * creditNorm + (1 - w) * qolNorm;
      return {
        pairingNumber: p.pairingNumber,
        score,
        creditNorm,
        qolNorm,
        holdProbability: p.holdProbability,
        pairingDays: p.pairingDays,
        creditHours: p.creditHours,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * B3: estimate whether a group can plausibly complete a line at this
 * seniority: expected achievable credit = sum(credit x holdProb) over the
 * group's reachable pool, capped at threshold; completion = achievable /
 * threshold. Hold boundaries kill trip lengths that historically never
 * reach this percentile.
 */
export function estimateCompletion(
  scored: ScoredPairing[],
  threshold: number,
  seniorityPercentile?: number,
  holdBoundaries?: OptimizerOptions['holdBoundaries']
): number {
  const unreachable = new Set(
    (holdBoundaries ?? [])
      .filter(
        b =>
          seniorityPercentile !== undefined &&
          seniorityPercentile > b.juniorMostPercentile + 5
      )
      .map(b => b.pairingDays)
  );
  let expected = 0;
  for (const s of scored) {
    if (unreachable.has(s.pairingDays)) continue;
    const hold = (s.holdProbability ?? 50) / 100;
    expected += s.creditHours * hold;
    if (expected >= threshold * 1.5) break;
  }
  return Math.max(0, Math.min(1, expected / threshold));
}

function negativesFromProfile(
  profile: BidProfileWeights,
  preferOffDates: string[] | undefined,
  softness: number // 0 = strictest (all avoids), 1+ = drop soft avoids
): { prefs: BidPreference[]; notes: string[] } {
  const prefs: BidPreference[] = [];
  const notes: string[] = [];
  if (preferOffDates && preferOffDates.length > 0) {
    prefs.push({
      type: 'preferOff',
      preferOffDates: [...preferOffDates],
      why: 'Your requested days off this month, most important first — in Denial Mode PBS drops dates from the end of the list.',
    });
    notes.push(`Prefer Off ${preferOffDates.length} requested dates`);
  }
  if (profile.preferOffDOWs && profile.preferOffDOWs.length > 0) {
    prefs.push({
      type: 'preferOff',
      preferOffDOWs: [...profile.preferOffDOWs],
      why: `You ask for ${profile.preferOffDOWs.join('/')} off month after month in your own bid history.`,
    });
    notes.push(
      `Prefer Off ${profile.preferOffDOWs.join('/')} every week (recurring in your history)`
    );
  }
  if (profile.checkInStationAvoids.length > 0) {
    prefs.push({
      type: 'avoid',
      filter: { checkInStations: [...profile.checkInStationAvoids] },
      why: `You avoid ${profile.checkInStationAvoids.join('/')} check-ins recurrently in your own bid history.`,
    });
    notes.push(
      `avoid check-in at ${profile.checkInStationAvoids.join('/')} (recurring in your history)`
    );
  }
  if (profile.avoidsCarryOut) {
    prefs.push({
      type: 'avoid',
      filter: { carryOutMin: 1 },
      why: 'You consistently avoid trips that spill into the next bid period.',
    });
    notes.push('avoid carry-out trips');
  }
  if (profile.avoidsRedeyes) {
    prefs.push({
      type: 'avoid',
      filter: { hasRedeye: true },
      why: 'You consistently avoid redeye flying in your own bid history.',
    });
    notes.push('avoid redeyes');
  }
  // Soft avoid: disliked layovers — first thing to give up when the
  // cascade needs a wider pool.
  if (softness < 1 && profile.layoverDislikes.length > 0) {
    prefs.push({
      type: 'avoid',
      filter: { excludeLayoverCities: [...profile.layoverDislikes] },
      why: `Soft avoid: layovers you dislike (${profile.layoverDislikes.join('/')}). Later bid groups drop this first to widen the pool.`,
    });
    notes.push(`avoid layovers in ${profile.layoverDislikes.join('/')}`);
  }
  return { prefs, notes };
}

function awardCascade(
  scored: ScoredPairing[],
  profile: BidProfileWeights,
  topPicksPerLength: number
): BidPreference[] {
  const prefs: BidPreference[] = [];
  const lengths =
    profile.preferredTripLengths.length > 0
      ? profile.preferredTripLengths
      : [...new Set(scored.map(s => s.pairingDays))].sort(
          (a, b) =>
            scored.filter(s => s.pairingDays === b).length -
            scored.filter(s => s.pairingDays === a).length
        );
  for (const len of lengths) {
    const ofLength = scored.filter(s => s.pairingDays === len);
    if (ofLength.length === 0) continue;
    const top = ofLength.slice(0, topPicksPerLength);
    if (top.length > 0) {
      prefs.push({
        type: 'award',
        filter: { pairingNumbers: top.map(t => t.pairingNumber) },
        why: `Your top ${top.length} ${len}-day trips this month, ranked by fit with your profile and your odds of holding them.`,
      });
    }
    prefs.push({
      type: 'award',
      filter: { pairingDaysMin: len, pairingDaysMax: len },
      why: `Backup tier: any ${len}-day trip, in case the named ones above are already taken.`,
    });
  }
  // Generic catch-all so the group can always complete from the pool.
  prefs.push({
    type: 'award',
    why: 'Safety net: lets PBS finish your line from whatever remains instead of assigning one for you.',
  });
  return prefs;
}

export function optimizeBid(
  rawPairings: any[],
  baseProfile: BidProfileWeights,
  options: OptimizerOptions = {}
): OptimizedBid {
  const profile = mergeProfile(baseProfile, options.overrides);
  const threshold = options.threshold ?? 78;
  const topPicks = options.topPicksPerLength ?? 8;
  const rationale: string[] = [];
  const scored = scorePairings(rawPairings, profile);

  const creditWindow =
    options.overrides?.creditWindow === null
      ? null
      : (options.overrides?.creditWindow ??
        (profile.creditLeaning <= -0.33
          ? 'min'
          : profile.creditLeaning >= 0.33
            ? 'max'
            : null));
  if (creditWindow) {
    rationale.push(
      `Set Condition ${creditWindow === 'min' ? 'Minimum' : creditWindow === 'max' ? 'Maximum' : 'Mid'} Credit Window (creditLeaning ${profile.creditLeaning.toFixed(2)})`
    );
  }

  // Relaxation ladder for the days-off pattern: strictest wish first,
  // stepping down. The short ladder (used by the legacy/auto bands) stops
  // 2 below the wish; the deep ladder runs to the contractual-ish floor
  // of 2 days off.
  const shortLadder: (BidProfileWeights['preferredPattern'] | null)[] = [];
  const fullLadder: (BidProfileWeights['preferredPattern'] | null)[] = [];
  if (profile.preferredPattern) {
    for (let off = profile.preferredPattern.daysOffMin; off >= 2; off--) {
      const step = { ...profile.preferredPattern, daysOffMin: off };
      fullLadder.push(step);
      if (off >= Math.max(2, profile.preferredPattern.daysOffMin - 2)) {
        shortLadder.push(step);
      }
    }
  } else {
    shortLadder.push(null);
    fullLadder.push(null);
  }

  const completion = estimateCompletion(
    scored,
    threshold,
    options.seniorityPercentile,
    options.holdBoundaries
  );
  const depth = options.depth ?? 'auto';

  // Each group is a complete restatement; the invariant is that every
  // group is strictly looser than the one before it, so the pilot — not
  // Denial Mode — chooses the order their standards degrade in.
  interface GroupSpec {
    pattern: BidProfileWeights['preferredPattern'] | null;
    includeCreditWindow: boolean;
    softness: number;
    /** Bare `Award: any pairing` terminal group — no conditions at all. */
    bare?: boolean;
  }

  // Legacy shape (unchanged behavior for comfortable completion): N-1
  // ladder steps then a soft-avoid-free fallback repeating the loosest
  // pattern.
  const legacySpecs = (count: number): GroupSpec[] =>
    Array.from({ length: count }, (_, g) => ({
      pattern: shortLadder[Math.min(g, shortLadder.length - 1)],
      includeCreditWindow: true,
      softness: g === count - 1 ? 1 : 0,
    }));

  // Extended ladder for pilots whose Group 1 will essentially never
  // complete: relax one dimension at a time — days off, then the
  // pattern itself, then the credit window, then soft avoids, ending in
  // a bare any-pairing group (completion beats preference at the
  // bottom of the cascade).
  const deepSpecs = (): GroupSpec[] => {
    const specs: GroupSpec[] = fullLadder
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map(pattern => ({ pattern, includeCreditWindow: true, softness: 0 }));
    specs.push({ pattern: null, includeCreditWindow: true, softness: 0 });
    if (creditWindow) {
      specs.push({ pattern: null, includeCreditWindow: false, softness: 0 });
    }
    specs.push({ pattern: null, includeCreditWindow: false, softness: 1 });
    specs.push({
      pattern: null,
      includeCreditWindow: false,
      softness: 1,
      bare: true,
    });
    return specs;
  };

  const specs: GroupSpec[] =
    depth === 'deep'
      ? deepSpecs()
      : depth === 'compact'
        ? legacySpecs(Math.min(3, shortLadder.length + 1))
        : completion >= 0.95
          ? legacySpecs(Math.min(2, shortLadder.length + 1))
          : completion >= 0.7
            ? legacySpecs(Math.min(3, shortLadder.length + 1))
            : completion >= 0.3
              ? legacySpecs(shortLadder.length + 1)
              : deepSpecs();

  const usedDeep =
    depth === 'deep' || (depth === 'auto' && completion < 0.3);
  rationale.push(
    `Estimated line-completion likelihood at this seniority: ${(completion * 100).toFixed(0)}% → ${specs.length} bid group${specs.length > 1 ? 's' : ''} in the cascade (depth: ${depth}${usedDeep ? ', extended relaxation ladder' : ''})`
  );
  if (usedDeep) {
    rationale.push(
      'Deep cascade: your line will likely be built in the fallbacks, so each group relaxes one dimension at a time — days off, then the pattern, then the credit window, then soft avoids — ending in a bare any-pairing group so PBS never assigns for you.'
    );
  }

  // Junior named picks: at poor completion, ranking picks purely by
  // profile score names trips that will be gone long before PBS reaches
  // this pilot. Re-rank by score × hold and drop the unreachable ones —
  // a junior pilot's edge is naming the well-fitting pairings nobody
  // senior bids.
  let cascadeSource = scored;
  let namedPicks = topPicks;
  if (completion < 0.5) {
    const HOLD_FLOOR = 20;
    cascadeSource = scored
      .filter(s => (s.holdProbability ?? 50) >= HOLD_FLOOR)
      .sort(
        (a, b) =>
          b.score * (Math.max(5, b.holdProbability ?? 50) / 100) -
          a.score * (Math.max(5, a.holdProbability ?? 50) / 100)
      );
    if (cascadeSource.length === 0) cascadeSource = scored;
    namedPicks = Math.max(topPicks, 15);
    rationale.push(
      `Named picks re-ranked by fit × hold probability and capped to reachable pairings (hold ≥ ${HOLD_FLOOR}%) — at this seniority the win is claiming well-fitting trips others skip, not the package's most popular ones.`
    );
  }

  const groups: BidGroup[] = [];
  specs.forEach((spec, g) => {
    const isLast = g === specs.length - 1;
    const prefs: BidPreference[] = [];

    if (spec.bare) {
      prefs.push({
        type: 'award',
        why: 'Last resort before reserve: award anything still open so PBS never assigns a line for you.',
      });
      groups.push({ type: 'pairings', preferences: prefs });
      return;
    }

    if (spec.pattern) {
      prefs.push({
        type: 'setConditionPattern',
        patternDaysOnMin: spec.pattern.daysOnMin,
        patternDaysOnMax: spec.pattern.daysOnMax,
        patternDaysOffMin: spec.pattern.daysOffMin,
        elseStartNext: !isLast ? true : undefined,
        why:
          g === 0
            ? `Your learned line shape: ${spec.pattern.daysOnMin}–${spec.pattern.daysOnMax} days on with ${spec.pattern.daysOffMin}+ off between trips. If PBS can't build it, Else Start Next jumps to the next (looser) group.`
            : `Same shape, relaxed to ${spec.pattern.daysOffMin}+ days off so this group can complete where the stricter one couldn't.`,
      });
    }
    if (creditWindow && spec.includeCreditWindow) {
      prefs.push({
        type: 'setConditionCredit',
        creditWindow,
        why:
          creditWindow === 'min'
            ? 'You bid minimum-credit windows in your history — fewer hours, more days off.'
            : creditWindow === 'max'
              ? 'You chase credit — this asks PBS for the top of the credit window.'
              : 'Mid-credit window: balanced hours that cannot be capped by seniority.',
      });
    }
    const negatives = negativesFromProfile(
      profile,
      options.overrides?.preferOffDates,
      spec.softness
    );
    prefs.push(...negatives.prefs);
    if (g === 0) {
      for (const n of negatives.notes) rationale.push(n);
    }
    prefs.push(...awardCascade(cascadeSource, profile, namedPicks));
    if (!isLast && !spec.pattern) {
      // Group needs an exit; without a pattern carrying ESN, put it on
      // the last negative, else fall back to CSSN.
      const lastNegative = [...prefs]
        .reverse()
        .find(p => p.type === 'avoid' || p.type === 'preferOff');
      if (lastNegative) lastNegative.elseStartNext = true;
      else
        prefs.push({
          type: 'clearScheduleStartNext',
          why: 'Exit hatch: if this group cannot build a full line, wipe it and try the next (looser) group.',
        });
    }
    groups.push({ type: 'pairings', preferences: prefs });
  });
  groups.push({ type: 'reserve', preferences: [] });

  if (profile.preferredPattern && specs.length > 1) {
    const offSteps = specs
      .map(s => s.pattern?.daysOffMin)
      .filter((v): v is number => v !== undefined && v !== null);
    if (offSteps.length > 1) {
      rationale.push(
        `Days-off ladder across groups: ${offSteps.join(' → ')} (later groups drop soft avoids${usedDeep ? ', then the pattern and credit window' : ' entirely'})`
      );
    }
  }
  rationale.push(
    `Top-scored pairings named explicitly per preferred trip length (${(profile.preferredTripLengths.length ? profile.preferredTripLengths : ['auto']).join(', ')}), then attribute tiers, then a generic fallback.`
  );

  return { bid: { groups }, rationale, scored, group1Completion: completion };
}
