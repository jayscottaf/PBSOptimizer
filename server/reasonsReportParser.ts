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
   * banners. This is vocabulary-driven (see navblue-rules.md section 5) and
   * defensive - it returns empty results rather than guessing when the
   * document does not contain a recognizable Reasons section.
   *
   * NOTE: written against the documented report structure; validate against
   * a real composite report export and tighten the patterns when one is
   * available. Pilot identity attachment (which pilot a preference block
   * belongs to in a composite report) also needs a real sample.
   */
  static parseReasonsPane(htmlContent: string): ParsedReasonsPane {
    const $ = cheerio.load(htmlContent);
    const text = $('body').text();
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

    const finalize = () => {
      if (current) {
        preferences.push(current);
        current = null;
      }
    };

    for (const line of lines) {
      const prefMatch = line.match(PREFERENCE_LINE);
      if (prefMatch) {
        finalize();
        current = {
          preferenceNumber: parseInt(prefMatch[1], 10),
          preferenceText: prefMatch[2].trim(),
          outcome: 'Unknown',
          outcomeDetail: null,
          awardedPairingNumbers: [],
        };
        continue;
      }
      if (!current) continue;

      const reason = REASON_PHRASES.find(phrase =>
        line.toLowerCase().includes(phrase.toLowerCase())
      );
      if (reason && current.outcome === 'Unknown') {
        current.outcome = reason;
        const idx = line.toLowerCase().indexOf(reason.toLowerCase());
        const detail = line.slice(idx + reason.length).replace(/^[:\s-]+/, '');
        current.outcomeDetail = detail.length > 0 ? detail : null;
      }
      // Pairing numbers listed under a preference (awards it produced)
      const pairingTokens = line.match(/\b\d{4,5}\b/g);
      if (pairingTokens && (reason === 'Honored' || /award/i.test(line))) {
        current.awardedPairingNumbers.push(...pairingTokens);
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
