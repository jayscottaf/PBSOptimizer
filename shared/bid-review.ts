export interface ReviewFinding {
  tone: 'success' | 'warning' | 'info';
  title: string;
  detail: string;
  preferences?: number[];
}
export interface BidDocumentLine {
  number: number | null;
  text: string;
  group: number;
  automatic?: boolean;
}
export interface BidDocument {
  period: string | null;
  modified: boolean;
  lines: BidDocumentLine[];
}
export interface BidReviewResult {
  mode: 'results' | 'before';
  period: string | null;
  pilot?: { name: string; seniorityNumber: number };
  summary: { label: string; value: string }[];
  findings: ReviewFinding[];
  groups: { number: number; label: string; status: string }[];
  comparisons: {
    number: number;
    snapshot: string | null;
    processed: string | null;
  }[];
  awards: {
    pairingNumber: string;
    start: string;
    end: string;
    credit: string;
    source: string;
  }[];
  limitations: string[];
}

export interface SavedReasonsReport {
  id: string;
  month: string;
  year: number;
  base: string;
  aircraft: string;
  awardCount: number;
  preferenceCount: number;
}
