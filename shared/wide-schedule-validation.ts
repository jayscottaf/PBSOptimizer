export interface AwardedLineSummary {
  seniority: number;
  totalCreditHours: number;
  daysOff: number | null;
  lineType: string;
  pairingNumbers: string[];
}

export interface NearbyLineBenchmarks {
  sampleSize: number;
  seniorityMin: number;
  seniorityMax: number;
  medianCreditHours: number;
  medianDaysOff: number | null;
  regularLines: number;
  reserveLines: number;
  averagePairings: number;
}

export interface PairingAwardOutcome {
  pairingNumber: string;
  lineAwards: number;
  mostSeniorSeniority: number;
  mostJuniorSeniority: number;
  awardedAtOrJuniorToUser: boolean;
}

export interface WideScheduleValidation {
  available: true;
  month: string;
  year: number;
  category: string;
  userSeniority: number;
  periodMatchesPackage: boolean;
  exactLine: AwardedLineSummary | null;
  nearby: NearbyLineBenchmarks;
  pairingOutcomes: PairingAwardOutcome[];
}

export interface UnavailableWideScheduleValidation {
  available: false;
  month: string;
  year: number;
  category: string;
}

export type WideScheduleValidationResult =
  | WideScheduleValidation
  | UnavailableWideScheduleValidation;
