import * as cheerio from 'cheerio';
import * as fs from 'fs/promises';

export interface TripFingerprint {
  pairingDays: number;
  layoverCities: string[];
  layoverPattern: string;
  checkInTimeOfDay: string;
  checkOutTimeOfDay: string;
  checkInMonth: number;
  creditBucket: number;
  creditHours?: number; // Actual credit hours for more accurate matching
  includesWeekend: boolean;
  efficiencyBucket: number;
  // Only derivable when a concrete check-in date is known (Reasons Report
  // awards). Bid-package pairings run on many effective dates, so their
  // fingerprints omit these instead of carrying made-up values.
  checkInDayOfWeek?: number;
  isCommutable?: boolean;
  isWeekendTrip?: boolean;
}

export interface PairingAward {
  pairingNumber: string;
  pilotName: string;
  seniorityNumber: number;
  employeeNumber: string;
  awardType: string;
  pairingDays: number;
  monthCredit: string;
  totalCredit: string;
  layoverCities: string;
  checkInDate: string;
  checkOutDate: string;
}

export interface ReasonsReportMetadata {
  base: string;
  aircraft: string;
  month: string;
  year: number;
}

/** One bid preference and its outcome from the Reasons pane. */
export interface ParsedPreferenceReason {
  preferenceNumber: number;
  preferenceText: string;
  outcome: string;
  outcomeDetail: string | null;
  awardedPairingNumbers: string[];
  // Composite reports contain one Reasons section per pilot; these carry the
  // section's identity so outcomes can be attributed. Null for single-pilot
  // exports that have no section headers.
  pilotSeniorityNumber: number | null;
  pilotEmployeeNumber: string | null;
  pilotName: string | null;
  // The pilot's credit-window header line ("Window 062:00-082:00, Threshold
  // 082:00") — real per-pilot threshold data the simulator otherwise guesses.
  windowInfo: string | null;
}

export interface ParsedReasonsPane {
  banners: string[];
  preferences: ParsedPreferenceReason[];
}

/**
 * NAVBLUE per-preference reason vocabulary (docs/ai-bidding-coach/
 * navblue-rules.md section 5). Ordered longest-first so the most specific
 * phrase wins.
 */
const REASON_PHRASES = [
  'Awarded for coverage under a different bid',
  'Awarded to senior shadow bidder',
  'Awarded to senior bidder',
  'Awarded by previous bids',
  'Below Reduced Lower Limit Cutoff',
  'Beyond bid limit',
  'Bid denied',
  'Block is complete',
  'Buddy cannot take pairing',
  'Could Not Build Complete Line with Pairing',
  // Real composite exports say "Filtered by bid number 2: 494" rather than
  // the documented "Filtered by higher bid" — keep both.
  'Filtered by bid number',
  'Filtered by higher bid',
  'Followed By sequence not found',
  'Forgotten',
  'Honored',
  'Item overlaps with another',
  'Needed for Legality',
  'No pairings available',
  'Not considered',
  'Not honored',
  'Not used',
  'Over maximum credits for period',
  'Partially honored',
  'Prevents assignment of minimum GDO',
  'Restricted location',
  // Real exports use "Schedule is complete" where the guides document
  // "Block is complete".
  'Schedule is complete',
  'Too many above',
  'Violates green on green',
] as const;

const PREFERENCE_LINE = new RegExp(
  String.raw`^\s*(\d{1,3})[.):]?\s+((?:Award Pairings|Avoid Pairings|Prefer Off|Set Condition|Start Pairings|Start Reserve|Clear Schedule|Else Start Next|Waive|Slide Vacation|Vacation GDO|Reserve GDO).*)$`,
  'i'
);

const BANNER_PATTERNS = [
  /Affected\s+by\s+Denial\s+Mode/i,
  /Affected\s+by\s+SLG/i,
  /Affected\s+by\s+Coverage/i,
];

// Composite reports contain one Reasons section per pilot, each opened by a
// header like "Seniority  05105  Category NYC-220-B  GRENIER  084785700".
// Names can contain spaces and hyphens (DIAZ GOMEZ, SCOTT-BENNETT).
const PILOT_HEADER = /^Seniority\s+(\d{3,5})\s+Category\s+(\S+)\s+(.+?)\s+(\d{6,9})$/;

// "Minimum window <062:00>  Threshold <082:00>  Maximum window <082:00>"
const WINDOW_LINE =
  /Minimum\s+window\s+<(\d{1,3}:\d{2})>\s+Threshold\s+<(\d{1,3}:\d{2})>\s+Maximum\s+window\s+<(\d{1,3}:\d{2})>/;

// An award event under a preference: pairing number followed by check-in and
// check-out timestamps, e.g. "7773  2026-07-07 14:45  2026-07-07 23:29 (006:23) (B)".
// Anchored to this shape so date fragments like "2026" are never mistaken for
// pairing numbers.
const AWARD_EVENT_LINE =
  /^(\d{4,5})\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+\d{4}-\d{2}-\d{2}/;

// "(1 Awarded, 1 Matching, Running total: 065:58)"
const STATS_LINE = /^\((\d+)\s+Awarded,\s+(\d+)\s+Matching,\s+Running\s+total:/;

export class ReasonsReportParser {
  /**
   * Parse a Delta Airlines Reasons Report HTML file
   */
  static async parseReasonsReport(filePath: string): Promise<PairingAward[]> {
    const htmlContent = await fs.readFile(filePath, 'utf-8');
    return this.parseReasonsReportFromContent(htmlContent);
  }

  static async parseReasonsReportFromContent(htmlContent: string): Promise<PairingAward[]> {
    const $ = cheerio.load(htmlContent);
    const awards: PairingAward[] = [];

    // Find the table with award data (looking for table with id="PairingsTable" or similar)
    $('table tbody tr').each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td');

      if (cells.length >= 11) {
        // Extract data from table cells based on the column structure:
        // Pair | Check In | Check Out | Len | Month Credit | Total Credit | Layovers | Sen | EmpNum | Name | Type
        const pairingNumber = $(cells[0]).text().trim();
        const checkInDate = $(cells[1]).text().trim();
        const checkOutDate = $(cells[2]).text().trim();
        const pairingDaysText = $(cells[3]).text().trim();
        const monthCredit = $(cells[4]).text().trim();
        const totalCredit = $(cells[5]).text().trim();
        const layoverCities = $(cells[6]).text().trim();
        const seniorityText = $(cells[7]).text().trim();
        const employeeNumber = $(cells[8]).text().trim();
        const pilotName = $(cells[9]).text().trim();
        const awardType = $(cells[10]).text().trim();

        // Skip header rows and invalid data
        if (
          pairingNumber &&
          !pairingNumber.includes('Pair') &&
          seniorityText &&
          !isNaN(parseInt(seniorityText))
        ) {
          awards.push({
            pairingNumber,
            pilotName,
            seniorityNumber: parseInt(seniorityText),
            employeeNumber,
            awardType: awardType || 'Regular',
            pairingDays: parseInt(pairingDaysText) || 1,
            monthCredit,
            totalCredit,
            layoverCities,
            checkInDate,
            checkOutDate,
          });
        }
      }
    });

    return awards;
  }

  /**
   * Parse the Reasons pane: per-preference outcomes plus top-of-report
   * banners. Validated against a real NAVBLUE composite export (NYC-220-B
   * JUL 2026): sections per pilot, NBSP-as-spacing, and outcome vocabulary
   * that differs from the documented phrases in places. Returns empty
   * results rather than guessing when the document has no recognizable
   * Reasons content.
   */
  static parseReasonsPane(htmlContent: string): ParsedReasonsPane {
    const $ = cheerio.load(htmlContent);
    // Real exports pad with non-breaking spaces (\xA0) instead of spaces;
    // normalize so every regex and phrase match below sees plain spaces.
    const text = $('body').text().replace(/\u00A0/g, ' ');
    const lines = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);

    const banners: string[] = [];
    for (const pattern of BANNER_PATTERNS) {
      const hit = lines.find(line => pattern.test(line));
      if (hit) {
        const match = hit.match(pattern);
        if (match) banners.push(match[0]);
      }
    }

    const preferences: ParsedPreferenceReason[] = [];
    let current: ParsedPreferenceReason | null = null;
    // Identity of the pilot section we're inside (composite reports); stays
    // null for single-pilot exports with no section headers.
    let pilotSeniorityNumber: number | null = null;
    let pilotEmployeeNumber: string | null = null;
    let pilotName: string | null = null;
    let windowInfo: string | null = null;

    const finalize = () => {
      if (current) {
        preferences.push(current);
        current = null;
      }
    };

    for (const line of lines) {
      const headerMatch = line.match(PILOT_HEADER);
      if (headerMatch) {
        finalize();
        pilotSeniorityNumber = parseInt(headerMatch[1], 10);
        pilotName = headerMatch[3].trim();
        pilotEmployeeNumber = headerMatch[4];
        windowInfo = null;
        continue;
      }

      const windowMatch = line.match(WINDOW_LINE);
      if (windowMatch) {
        windowInfo = `Window ${windowMatch[1]}-${windowMatch[3]}, Threshold ${windowMatch[2]}`;
        continue;
      }

      const prefMatch = line.match(PREFERENCE_LINE);
      if (prefMatch) {
        finalize();
        current = {
          preferenceNumber: parseInt(prefMatch[1], 10),
          preferenceText: prefMatch[2].trim(),
          outcome: 'Unknown',
          outcomeDetail: null,
          awardedPairingNumbers: [],
          pilotSeniorityNumber,
          pilotEmployeeNumber,
          pilotName,
          windowInfo,
        };
        continue;
      }
      if (!current) continue;

      // Award events produced by this preference (PBSEvent lines)
      const awardMatch = line.match(AWARD_EVENT_LINE);
      if (awardMatch) {
        current.awardedPairingNumbers.push(awardMatch[1]);
        continue;
      }

      // "(N Awarded, M Matching, Running total: ...)" — attach as detail
      if (STATS_LINE.test(line)) {
        current.outcomeDetail = current.outcomeDetail
          ? `${current.outcomeDetail}; ${line}`
          : line;
        continue;
      }

      const reason = REASON_PHRASES.find(phrase =>
        line.toLowerCase().includes(phrase.toLowerCase())
      );
      if (reason && current.outcome === 'Unknown') {
        current.outcome = reason;
        const idx = line.toLowerCase().indexOf(reason.toLowerCase());
        const detail = line.slice(idx + reason.length).replace(/^[:\s-]+/, '');
        current.outcomeDetail = detail.length > 0 ? detail : null;
      }
    }
    finalize();

    // Dedupe pairing numbers per preference
    for (const pref of preferences) {
      pref.awardedPairingNumbers = [...new Set(pref.awardedPairingNumbers)];
    }

    return { banners, preferences };
  }

  /**
   * Extract metadata (base, aircraft, month, year) from HTML content
   */
  static extractMetadata(htmlContent: string): ReasonsReportMetadata | null {
    const $ = cheerio.load(htmlContent);

    // Look for metadata in title tag
    // Format: "NYC-220-B OCT 2025 Composite Report" (may have special chars instead of spaces)
    const title = $('title').text();

    // Extract base (e.g., NYC, ATL, DTW)
    const baseMatch = title.match(/([A-Z]{3})-/);
    const base = baseMatch ? baseMatch[1] : '';

    // Extract aircraft (e.g., 220-B, 350B)
    const aircraftMatch = title.match(/-(\d{3}[-]?[A-Z]?)/);
    const aircraft = aircraftMatch ? aircraftMatch[1] : '';

    // Extract month (e.g., OCT, NOV, DEC) - simple pattern that works with special chars
    const monthMatch = title.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i);
    const month = monthMatch ? monthMatch[1].toUpperCase() : '';

    // Extract year (e.g., 2024, 2025) - more flexible matching
    const yearMatch = title.match(/(20\d{2})/);
    const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();

    if (base && aircraft && month) {
      return { base, aircraft, month, year };
    }

    return null;
  }

  /**
   * Create a trip fingerprint from an award for similarity matching
   */
  static createTripFingerprint(award: PairingAward): TripFingerprint {
    // Parse layover cities from format like "SAT-15 BOS-11 BOS-15"
    let layoverCities = award.layoverCities
      .split(/\s+/)
      .filter((city) => city.length > 0)
      .map((city) => city.replace(/-\d+$/, '')) // Remove hours like "BOS-14"
      .filter((city) => city.toLowerCase() !== 'none') // Remove literal "none"
      .sort();
    
    // Canonicalize empty layovers to ['none'] ONLY for single-day trips (pairingDays === 1)
    // This is expected for turn trips; multi-day trips keep empty to distinguish missing data
    if (layoverCities.length === 0 && award.pairingDays === 1) {
      layoverCities = ['none'];
    }

    // Parse check-in date to get day of week and time
    // Format: "10/12 Sun 13:24"
    const checkInMatch = award.checkInDate.match(
      /(\d{2})\/(\d{2})\s+(\w{3})\s+(\d{2}):(\d{2})/
    );
    const checkInMonth = checkInMatch ? parseInt(checkInMatch[1]) : 1;
    const checkInDay = checkInMatch ? parseInt(checkInMatch[2]) : 1;
    const checkInHour = checkInMatch ? parseInt(checkInMatch[4]) : 6;

    // Determine time of day
    let checkInTimeOfDay = 'morning';
    if (checkInHour >= 12 && checkInHour < 17) checkInTimeOfDay = 'afternoon';
    else if (checkInHour >= 17) checkInTimeOfDay = 'evening';

    // Parse check-out time
    // Format: "10/15 Wed 15:28"
    const checkOutMatch = award.checkOutDate.match(/(\d{2}):(\d{2})/);
    const checkOutHour = checkOutMatch ? parseInt(checkOutMatch[1]) : 12;
    let checkOutTimeOfDay = 'morning';
    if (checkOutHour >= 12 && checkOutHour < 17)
      checkOutTimeOfDay = 'afternoon';
    else if (checkOutHour >= 17) checkOutTimeOfDay = 'evening';

    // The check-in string carries the weekday name ("10/12 Sun 13:24");
    // use it directly instead of deriving from the day number.
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayName = checkInMatch ? checkInMatch[3].toLowerCase() : '';
    const namedDay = dayNames.indexOf(dayName);
    const checkInDayOfWeek = namedDay !== -1 ? namedDay : checkInDay % 7;

    // Parse credit hours - format is "21:20" meaning 21 hours 20 minutes
    const creditHours = parseFloat(
      award.monthCredit.replace(':', '.')
    );

    // Calculate efficiency (credit per day)
    const efficiency = creditHours / award.pairingDays;

    return {
      pairingDays: award.pairingDays,
      layoverCities,
      layoverPattern: layoverCities.join('-'),
      checkInDayOfWeek,
      checkInTimeOfDay,
      checkOutTimeOfDay,
      checkInMonth,
      creditBucket: Math.floor(creditHours / 2) * 2, // Bucket by 2-hour increments
      isCommutable: false, // Could be enhanced based on check-in time
      isWeekendTrip: checkInDayOfWeek === 0 || checkInDayOfWeek === 6,
      includesWeekend: award.pairingDays >= 3,
      efficiencyBucket: Math.floor(efficiency * 2) / 2, // Bucket by 0.5 increments
    };
  }
}
