/**
 * Pattern-aware line construction.
 *
 * Real NAVBLUE PBS does not pick trips first and check the Set Condition
 * Pattern afterwards — it builds the line WITH the Pattern as a constraint,
 * choosing trips and operating dates so work stretches land inside the
 * requested days-on band with the requested days off between them. This
 * module does the same for the simulator: a deterministic depth-first
 * search over (trip, operating-instance) placements.
 *
 * Guarantees and bounds:
 * - Deterministic: candidate order is a stable rank
 *   (preference index asc, hold probability desc, credit desc, pairing
 *   number asc — the last key breaks all ties), no randomness, no clocks.
 *   The same input always produces the same line, regardless of the order
 *   pairings arrive in.
 * - Bounded: at most BRANCH_WIDTH branches per decision and NODE_BUDGET
 *   node expansions per call. First accepted solution wins, so the search
 *   behaves like "greedy in PBS priority order, plus backtracking".
 * - Honest: a denial means this bounded search could not assemble a legal
 *   line — not a proof that the real engine couldn't. Notes say what was
 *   tried and where it got stuck.
 *
 * Approximation: a new stretch is seeded from a trip's earliest legal
 * operating instance. Later instances of the same trip remain reachable as
 * extensions of other stretches, but a line that requires seeding a
 * stretch from a trip's *later* instance can be missed.
 *
 * Not modeled here (same as the rest of the static pass): substitution,
 * vertical swapping, shuffling, Denial Mode, other pilots' bids.
 */

export interface ConstructionInstance {
  startDay: number;
  endDay: number;
}

export interface ConstructionCandidate {
  pairingNumber: string;
  creditHours: number;
  pairingDays: number;
  holdProbability: number | null;
  /** 0-based index of the award preference this trip matched first. */
  prefIndex: number;
  /** Award-preference limit, shared across trips of the same prefIndex. */
  limit?: number;
  instances: ConstructionInstance[];
}

export interface PlacedTrip {
  pairingNumber: string;
  creditHours: number;
  pairingDays: number;
  holdProbability: number | null;
  prefIndex: number;
  startDay: number;
  endDay: number;
  /**
   * True when this trip was used out of preference order to legalize a
   * stretch (forced extension by a later-preference trip than the seed).
   */
  pulledForward: boolean;
}

export interface ConstructionResult {
  feasible: boolean;
  placed: PlacedTrip[];
  /** Lengths of the work stretches of the accepted (or best) line. */
  stretches: number[];
  notes: string[];
  /** Best credit over legal partial lines seen (denial detail). */
  bestCredit: number;
}

/**
 * Branches tried per decision. Measured on the real Feb 2026 package with
 * a Fri/Sat/Sun-off bid: width 3 and 6 both stalled at a 4-trip, 55.4-credit
 * partial and reported the group unbuildable, while width 12 found a legal
 * 5-trip, 71.0-credit line. Results were identical at 12, 16, 24 and 32
 * (~40ms throughout), so 12 is where the search stops missing lines rather
 * than where it stops improving.
 */
const BRANCH_WIDTH = 12;
const NODE_BUDGET = 8000;

interface IndexedInstance {
  cand: ConstructionCandidate;
  inst: ConstructionInstance;
}

function rank(a: ConstructionCandidate, b: ConstructionCandidate): number {
  if (a.prefIndex !== b.prefIndex) return a.prefIndex - b.prefIndex;
  const ha = a.holdProbability ?? 50;
  const hb = b.holdProbability ?? 50;
  if (hb !== ha) return hb - ha;
  if (b.creditHours !== a.creditHours) return b.creditHours - a.creditHours;
  return a.pairingNumber.localeCompare(b.pairingNumber);
}

export function constructPatternLine(input: {
  candidates: ConstructionCandidate[];
  pattern: { minOn: number; maxOn: number; gap: number };
  window: { min: number; max: number };
  threshold: number;
}): ConstructionResult {
  const { pattern, window, threshold } = input;
  const minOn = Math.max(1, pattern.minOn);
  const maxOn = Math.max(minOn, pattern.maxOn);
  const gap = Math.max(0, pattern.gap);
  // A permissive band (any length, no gap) is how a group with no Set
  // Condition Pattern is expressed: the only real constraint is that
  // awards not overlap. Messages must not invoke a Pattern that the
  // pilot never asked for.
  const shaped = minOn > 1 || maxOn < 31 || gap > 0;

  const candidates = [...input.candidates].sort(rank);

  // Every (candidate, instance) keyed by start day, buckets in rank order.
  const startIndex = new Map<number, IndexedInstance[]>();
  for (const cand of candidates) {
    for (const inst of cand.instances) {
      let bucket = startIndex.get(inst.startDay);
      if (!bucket) {
        bucket = [];
        startIndex.set(inst.startDay, bucket);
      }
      bucket.push({ cand, inst });
    }
  }
  // Seeds in (rank, earliest legal instance) order: each candidate's
  // earliest instance, list sorted by candidate rank.
  const seeds: IndexedInstance[] = candidates
    .filter(c => c.instances.length > 0)
    .map(c => ({
      cand: c,
      inst: c.instances.reduce((a, b) => (b.startDay < a.startDay ? b : a)),
    }));

  // Mutable search state, undone on backtrack.
  const used = new Set<string>();
  const takenPerPref = new Map<number, number>();
  const placed: PlacedTrip[] = [];
  const closedStretches: number[] = [];
  let credit = 0;
  let nodes = 0;
  let budgetExhausted = false;

  let bestCredit = 0;
  let bestPlaced: PlacedTrip[] = [];
  let bestStretches: number[] = [];
  const deadEnds: { depth: number; reason: string }[] = [];

  const overLimit = (c: ConstructionCandidate): boolean =>
    c.limit !== undefined && (takenPerPref.get(c.prefIndex) ?? 0) >= c.limit;

  const place = (x: IndexedInstance, pulledForward: boolean): void => {
    used.add(x.cand.pairingNumber);
    takenPerPref.set(
      x.cand.prefIndex,
      (takenPerPref.get(x.cand.prefIndex) ?? 0) + 1
    );
    credit += x.cand.creditHours;
    placed.push({
      pairingNumber: x.cand.pairingNumber,
      creditHours: x.cand.creditHours,
      pairingDays: x.cand.pairingDays,
      holdProbability: x.cand.holdProbability,
      prefIndex: x.cand.prefIndex,
      startDay: x.inst.startDay,
      endDay: x.inst.endDay,
      pulledForward,
    });
  };
  const unplace = (x: IndexedInstance): void => {
    used.delete(x.cand.pairingNumber);
    takenPerPref.set(
      x.cand.prefIndex,
      (takenPerPref.get(x.cand.prefIndex) ?? 0) - 1
    );
    credit -= x.cand.creditHours;
    placed.pop();
  };

  const recordDeadEnd = (reason: string): void => {
    deadEnds.push({ depth: placed.length, reason });
    if (deadEnds.length > 24) {
      deadEnds.sort((a, b) => b.depth - a.depth).length = 12;
    }
  };
  const recordLegalPartial = (): void => {
    if (credit > bestCredit) {
      bestCredit = credit;
      bestPlaced = [...placed];
      bestStretches = [...closedStretches];
    }
  };

  /**
   * @param lastEnd end day of the previous (closed) stretch, -Infinity at
   *   line start.
   * @param open the currently open stretch, or null between stretches.
   * @returns true when an acceptable line was found (state holds it).
   */
  const search = (
    lastEnd: number,
    open: { start: number; end: number; seedPref: number } | null
  ): boolean => {
    if (nodes++ > NODE_BUDGET) {
      budgetExhausted = true;
      return false;
    }

    if (open === null) {
      recordLegalPartial();
      // Accept: credit floor met and past the threshold stop rule.
      if (credit >= window.min && credit > threshold) {
        return true;
      }
      // Try seeding another stretch (only worthwhile while at or below
      // threshold — the award loop's stop rule).
      if (credit <= threshold) {
        let branches = 0;
        for (const seed of seeds) {
          if (branches >= BRANCH_WIDTH) break;
          if (used.has(seed.cand.pairingNumber)) continue;
          if (overLimit(seed.cand)) continue;
          if (credit + seed.cand.creditHours > window.max) continue;
          // Earliest legal instance for this candidate after the gap.
          const inst = seed.cand.instances
            .filter(i => i.startDay > lastEnd + gap)
            .reduce<ConstructionInstance | null>(
              (a, b) => (a === null || b.startDay < a.startDay ? b : a),
              null
            );
          if (!inst) continue;
          // A single trip longer than the whole band can never legalize.
          if (seed.cand.pairingDays > maxOn) continue;
          branches++;
          const x = { cand: seed.cand, inst };
          place(x, false);
          if (
            search(lastEnd, {
              start: inst.startDay,
              end: inst.endDay,
              seedPref: seed.cand.prefIndex,
            })
          ) {
            return true;
          }
          unplace(x);
        }
        if (branches === 0 && credit < window.min) {
          recordDeadEnd(
            shaped
              ? 'no unused trip can start a new work stretch after the required days off without exceeding the credit window'
              : 'no unused trip can be placed after the previous award without overlapping it or exceeding the credit window'
          );
        }
      }
      // Stop here if the floor is already met (accept even if we could
      // not push past the threshold — matches "line complete" semantics).
      if (credit >= window.min) {
        return true;
      }
      return false;
    }

    const len = open.end - open.start + 1;
    if (len > maxOn) {
      recordDeadEnd(
        `a ${len}-day work stretch exceeds the Pattern's ${maxOn}-day maximum`
      );
      return false;
    }

    const tryExtensions = (): boolean => {
      const bucket = startIndex.get(open.end + 1) ?? [];
      let branches = 0;
      for (const x of bucket) {
        if (branches >= BRANCH_WIDTH) break;
        if (used.has(x.cand.pairingNumber)) continue;
        if (overLimit(x.cand)) continue;
        if (credit + x.cand.creditHours > window.max) continue;
        if (len + x.cand.pairingDays > maxOn) continue;
        branches++;
        const pulledForward = x.cand.prefIndex > open.seedPref;
        place(x, pulledForward);
        if (
          search(lastEnd, {
            start: open.start,
            end: x.inst.endDay,
            seedPref: open.seedPref,
          })
        ) {
          return true;
        }
        unplace(x);
      }
      return false;
    };

    if (len < minOn) {
      // Must extend to reach the minimum stretch.
      if (tryExtensions()) return true;
      recordDeadEnd(
        `a ${len}-day work stretch is shorter than the Pattern's ${minOn}-day minimum and no unused trip starts on the next day to extend it`
      );
      return false;
    }

    // Legal length: prefer extending while below threshold, then close.
    if (credit <= threshold && len < maxOn) {
      if (tryExtensions()) return true;
    }
    closedStretches.push(len);
    if (search(open.end, null)) return true;
    closedStretches.pop();
    return false;
  };

  const ok = search(-Infinity, null);

  const notes: string[] = [];
  const zeroInstance = input.candidates.filter(
    c => c.instances.length === 0
  ).length;
  if (zeroInstance > 0) {
    notes.push(
      `${zeroInstance} matching pairing(s) had no parseable operating dates and could not be considered.`
    );
  }

  if (ok) {
    recordLegalPartial();
    notes.unshift(
      shaped
        ? `Constructed ${closedStretches.length} work stretch(es) of ${closedStretches.join(', ')} day(s) within the Pattern (${minOn}-${maxOn} on${gap > 0 ? `, ≥${gap} days off between` : ''}); ${credit.toFixed(2)} credit.`
        : `All ${placed.length} award(s) place on the calendar without overlapping; ${credit.toFixed(2)} credit.`
    );
    return {
      feasible: true,
      placed: [...placed],
      stretches: [...closedStretches],
      notes,
      bestCredit: credit,
    };
  }

  const blocking = deadEnds
    .sort((a, b) => b.depth - a.depth)
    .slice(0, 3)
    .map(d => d.reason)
    .filter((r, i, arr) => arr.indexOf(r) === i);
  notes.unshift(
    (shaped
      ? `Could not assemble work stretches of ${minOn}-${maxOn} days${gap > 0 ? ` (≥${gap} days off between)` : ''} reaching ${window.min.toFixed(1)} credit`
      : `Could not reach ${window.min.toFixed(1)} credit with awards that fit the calendar without overlapping`) +
      ` from the ${candidates.length} pairing(s) this group's preferences allow` +
      (bestCredit > 0
        ? `; best legal construction reached ${bestCredit.toFixed(2)}.`
        : '.') +
      (budgetExhausted ? ' Search budget exhausted before all arrangements were tried.' : '')
  );
  for (const b of blocking) {
    notes.push(`Blocking: ${b}.`);
  }
  return {
    feasible: false,
    placed: bestPlaced,
    stretches: bestStretches,
    notes,
    bestCredit,
  };
}
