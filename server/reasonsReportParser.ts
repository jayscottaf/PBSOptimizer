import * as cheerio from 'cheerio';
import * as fs from 'fs/promises';

export interface TripFingerprint {
  pairingDays: number;
  layoverCities: string[];
  layoverPattern: string;
  checkInDayOfWeek: number;
  checkInTimeOfDay: string;
  checkOutTimeOfDay: string;
  checkInMonth: number;
  creditBucket: number;
  isCommutable: boolean;
  isWeekendTrip: boolean;
  includesWeekend: boolean;
  efficiencyBucket: number;
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

export class ReasonsReportParser {
  /**
   * Parse a Delta Airlines Reasons Report HTML file
   */
  static async parseReasonsReport(filePath: string): Promise<PairingAward[]> {
    const htmlContent = await fs.readFile(filePath, 'utf-8');
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
    const layoverCities = award.layoverCities
      .split(/\s+/)
      .filter((city) => city.length > 0)
      .map((city) => city.replace(/-\d+$/, '')) // Remove hours like "BOS-14"
      .sort();

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

    // Calculate day of week (simplified - would need actual date calculation)
    const checkInDayOfWeek = checkInDay % 7;

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
