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
    prefs.push({ type: 'preferOff', preferOffDates: [...preferOffDates] });
    notes.push(`Prefer Off ${preferOffDates.length} requested dates`);
  }
  if (profile.checkInStationAvoids.length > 0) {
    prefs.push({
      type: 'avoid',
      filter: { checkInStations: [...profile.checkInStationAvoids] },
    });
    notes.push(
      `avoid check-in at ${profile.checkInStationAvoids.join('/')} (recurring in your history)`
    );
  }
  if (profile.avoidsCarryOut) {
    prefs.push({ type: 'avoid', filter: { carryOutMin: 1 } });
    notes.push('avoid carry-out trips');
  }
  if (profile.avoidsRedeyes) {
    prefs.push({ type: 'avoid', filter: { hasRedeye: true } });
    notes.push('avoid redeyes');
  }
  // Soft avoid: disliked layovers — first thing to give up when the
  // cascade needs a wider pool.
  if (softness < 1 && profile.layoverDislikes.length > 0) {
    prefs.push({
      type: 'avoid',
      filter: { excludeLayoverCities: [...profile.layoverDislikes] },
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
      });
    }
    prefs.push({
      type: 'award',
      filter: { pairingDaysMin: len, pairingDaysMax: len },
    });
  }
  // Generic catch-all so the group can always complete from the pool.
  prefs.push({ type: 'award' });
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
  // stepping down toward the contractual-ish floor of 2.
  const ladders: (BidProfileWeights['preferredPattern'] | null)[] = [];
  if (profile.preferredPattern) {
    for (
      let off = profile.preferredPattern.daysOffMin;
      off >= Math.max(2, profile.preferredPattern.daysOffMin - 2);
      off--
    ) {
      ladders.push({ ...profile.preferredPattern, daysOffMin: off });
    }
  } else {
    ladders.push(null);
  }

  const completion = estimateCompletion(
    scored,
    threshold,
    options.seniorityPercentile,
    options.holdBoundaries
  );
  // How many cascade groups: comfortable completion → wishes only + one
  // fallback; poor completion → full ladder + soft-avoid-free fallback.
  const groupCount =
    completion >= 0.95
      ? Math.min(2, ladders.length + 1)
      : completion >= 0.7
        ? Math.min(3, ladders.length + 1)
        : ladders.length + 1;
  rationale.push(
    `Estimated line-completion likelihood at this seniority: ${(completion * 100).toFixed(0)}% → ${groupCount} bid group${groupCount > 1 ? 's' : ''} in the cascade`
  );

  const groups: BidGroup[] = [];
  for (let g = 0; g < groupCount; g++) {
    const isLast = g === groupCount - 1;
    const pattern = ladders[Math.min(g, ladders.length - 1)];
    const softness = isLast ? 1 : 0;
    const prefs: BidPreference[] = [];

    if (pattern) {
      prefs.push({
        type: 'setConditionPattern',
        patternDaysOnMin: pattern.daysOnMin,
        patternDaysOnMax: pattern.daysOnMax,
        patternDaysOffMin: pattern.daysOffMin,
        elseStartNext: !isLast ? true : undefined,
      });
    }
    if (creditWindow) {
      prefs.push({ type: 'setConditionCredit', creditWindow });
    }
    const negatives = negativesFromProfile(
      profile,
      options.overrides?.preferOffDates,
      softness
    );
    prefs.push(...negatives.prefs);
    if (g === 0) {
      for (const n of negatives.notes) rationale.push(n);
    }
    prefs.push(...awardCascade(scored, profile, topPicks));
    if (!isLast && !pattern) {
      // Group needs an exit; without a pattern carrying ESN, put it on
      // the last negative, else fall back to CSSN.
      const lastNegative = [...prefs]
        .reverse()
        .find(p => p.type === 'avoid' || p.type === 'preferOff');
      if (lastNegative) lastNegative.elseStartNext = true;
      else prefs.push({ type: 'clearScheduleStartNext' });
    }
    groups.push({ type: 'pairings', preferences: prefs });
  }
  groups.push({ type: 'reserve', preferences: [] });

  if (profile.preferredPattern && groupCount > 1) {
    rationale.push(
      `Days-off ladder across groups: ${ladders
        .slice(0, groupCount - 1)
        .map(l => l?.daysOffMin)
        .filter(Boolean)
        .join(' → ')} (last group drops soft avoids entirely)`
    );
  }
  rationale.push(
    `Top-scored pairings named explicitly per preferred trip length (${(profile.preferredTripLengths.length ? profile.preferredTripLengths : ['auto']).join(', ')}), then attribute tiers, then a generic fallback.`
  );

  return { bid: { groups }, rationale, scored, group1Completion: completion };
}
