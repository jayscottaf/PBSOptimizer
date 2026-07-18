/**
 * Structured draft-bid model shared by the bid simulator, the NAVBLUE
 * exporter, and the /api/bid/* endpoints.
 *
 * This models the subset of NAVBLUE preference grammar the app can evaluate
 * against parsed bid-package data (see docs/ai-bidding-coach/
 * navblue-rules.md for the full grammar). Fields the parser does not yet
 * extract (day-of-week duty, redeyes, positions) are intentionally absent -
 * add them here only once pairings carry the data.
 */

export type CreditWindowType = 'normal' | 'min' | 'max' | 'mid';

/**
 * Attribute filter applied to pairings. All present fields must match
 * (logical AND, mirroring NAVBLUE's multiple-conditions-in-one-preference
 * semantics); array fields match if any element matches (OR within a
 * condition).
 */
export interface PairingFilter {
  pairingNumbers?: string[];
  pairingDaysMin?: number;
  pairingDaysMax?: number;
  /** Match if the pairing has a layover in any of these cities (NAVBLUE
   * "Layover · Stations · If Any"). */
  layoverCities?: string[];
  /** Exclude if the pairing has a layover in ANY of these cities (NAVBLUE
   * "Layover · Stations · If Not Any"). */
  excludeLayoverCities?: string[];
  /** Number of layover (overnight) stops. NAVBLUE "Number Of Layovers". */
  layoverCountMin?: number;
  layoverCountMax?: number;
  /** Sum of all layover durations, in decimal hours. NAVBLUE "Total
   * Layover Time". */
  totalLayoverHoursMin?: number;
  totalLayoverHoursMax?: number;
  creditMin?: number;
  creditMax?: number;
  blockMin?: number;
  blockMax?: number;
  /** Check-in hour of day, 0-23 inclusive bounds. */
  checkInHourMin?: number;
  checkInHourMax?: number;
  /** Cap on deadhead legs (NAVBLUE "Deadhead Legs <"). */
  deadheadsMax?: number;
  /** Require at least this many deadhead legs (NAVBLUE "Deadhead Legs >",
   * or "Deadhead Day" when >= 1). */
  deadheadsMin?: number;
  /** Average daily credit = creditHours / pairingDays. */
  averageDailyCreditMin?: number;
  averageDailyCreditMax?: number;
  /** Average daily block = blockHours / pairingDays. NAVBLUE "Average
   * Daily Block Time". */
  averageDailyBlockMin?: number;
  averageDailyBlockMax?: number;
  /** Match pairings that check in at any of these stations (NAVBLUE
   * "Pairing Check-In Station"; derived from the first flight segment's
   * departure airport). Use inside an Avoid preference to steer away from
   * a co-terminal (e.g. a pilot avoiding EWR check-ins). */
  checkInStations?: string[];
  /** true = require at least one redeye leg; false = require none.
   * Redeye = any leg departing 22:00-04:59 local. NAVBLUE "Duty Is
   * Redeye" with Any / Not Any. */
  hasRedeye?: boolean;
  /** Days the pairing operates past the end of the bid period (NAVBLUE
   * "Carry Out"). carryOutMin: 1 inside an Avoid renders the common
   * "Avoid ... If Carry Out > 0 Days". */
  carryOutMin?: number;
  carryOutMax?: number;
}

export interface BidPreference {
  type:
    | 'award'
    | 'avoid'
    | 'preferOff'
    | 'setConditionCredit'
    | 'setConditionPattern'
    | 'clearScheduleStartNext';
  /** For award/avoid. */
  filter?: PairingFilter;
  /**
   * For preferOff: ISO dates (YYYY-MM-DD), listed most-important FIRST
   * (Denial Mode drops items from the end of the list).
   */
  preferOffDates?: string[];
  /** For setConditionCredit. */
  creditWindow?: CreditWindowType;
  /**
   * For setConditionPattern (NAVBLUE "Set Condition Pattern Between X And
   * Y Days On ,With Z Days Off (Minimum)"). Constrains the whole line's
   * shape: work stretches between patternDaysOnMin and patternDaysOnMax
   * days, separated by at least patternDaysOffMin days off. NOT scored by
   * the simulator yet (line-shape placement is not modeled) — exported
   * verbatim and surfaced as a caveat.
   */
  patternDaysOnMin?: number;
  patternDaysOnMax?: number;
  patternDaysOffMin?: number;
  /** Award only: cap on pairings awarded by this preference. */
  limit?: number;
  /** Attachable to avoid/preferOff/setConditionCredit. */
  elseStartNext?: boolean;
}

export interface BidGroup {
  type: 'pairings' | 'reserve';
  preferences: BidPreference[];
}

export interface DraftBid {
  groups: BidGroup[];
}

/** One pairing the simulator predicts could land on the line. */
export interface SimulatedAward {
  pairingNumber: string;
  creditHours: number;
  pairingDays: number;
  holdProbability: number | null;
  /** 1-based index of the Award preference (within its group) that took it. */
  awardedByPreference: number;
  groupIndex: number;
}

export interface SimulationGroupResult {
  groupIndex: number;
  type: 'pairings' | 'reserve';
  poolAfterNegatives: number;
  awards: SimulatedAward[];
  creditFromAwards: number;
  /** Preferences that matched nothing, with the reason. */
  inertPreferences: Array<{ preferenceIndex: number; reason: string }>;
}

export interface SimulationResult {
  /** Awards from the first group that completes, or the best attempt. */
  awards: SimulatedAward[];
  totalCredit: number;
  /** Sum of credit weighted by hold probability - the realistic expectation. */
  expectedCredit: number;
  lineComplete: boolean;
  window: { min: number; max: number; threshold: number; alv: number };
  groupResults: SimulationGroupResult[];
  /** Engine behaviors this static pass does NOT model. Always read these. */
  caveats: string[];
}
