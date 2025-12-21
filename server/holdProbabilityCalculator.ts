import { db } from './db';
import { bidHistory } from '../shared/schema';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { ReasonsReportParser, type TripFingerprint } from './reasonsReportParser';
import { TripMatcher } from './tripMatcher';
import {
  calculateLayoverDesirability,
  getLocationCompetitionAdjustment,
  getMonthFromBidPackage,
  getHolidayCompetitionPenalty,
  isHolidayPeriod,
  getSeason,
} from './locationDesirability';

interface HoldProbabilityParams {
  seniorityPercentile: number; // 0-100 (lower is more senior)
  desirabilityScore: number; // 0-100
  pairingFrequency: number; // number of times trip appears
  startsOnWeekend: boolean;
  includesDeadheads: number;
  includesWeekendOff: boolean;
  bidMonth?: string; // Optional bid package month for seasonal adjustments
  layoverCities?: string[]; // Optional layover cities for location-based adjustments
}

interface HoldProbabilityResult {
  probability: number;
  label: string;
  reasoning: string[];
}

interface HistoricalMatch {
  seniorityNumber: number;
  month: string;
  year: number;
  similarity: number;
  confidence: string;
}

export class HoldProbabilityCalculator {
  /**
   * Normalize various time formats to hour (0-23)
   * Handles: "5.00" (decimal hours), "0500" (HHMM), "05:00" (HH:MM), "5" (hour only)
   */
  private static normalizeTimeToHour(timeStr: string): number {
    if (!timeStr) return NaN;
    
    const str = timeStr.toString().trim();
    
    // Format: "HH:MM" (e.g., "05:00", "17:30")
    if (str.includes(':')) {
      const [hours] = str.split(':');
      return parseInt(hours, 10);
    }
    
    // Format: "H.MM" or "HH.MM" (decimal hours, e.g., "5.00", "17.30")
    if (str.includes('.')) {
      const hour = parseFloat(str);
      // If it's a reasonable hour (0-24), it's decimal format
      if (hour >= 0 && hour <= 24) {
        return Math.floor(hour);
      }
    }
    
    // Format: "HHMM" (4 digits, e.g., "0500", "1730")
    if (/^\d{4}$/.test(str)) {
      return parseInt(str.substring(0, 2), 10);
    }
    
    // Format: "HMM" (3 digits, e.g., "500" for 5:00)
    if (/^\d{3}$/.test(str)) {
      return parseInt(str.substring(0, 1), 10);
    }
    
    // Format: "H" or "HH" (hour only, e.g., "5", "17")
    if (/^\d{1,2}$/.test(str)) {
      const hour = parseInt(str, 10);
      if (hour >= 0 && hour <= 24) {
        return hour;
      }
    }
    
    // Fallback: try parseFloat for any numeric string
    const fallback = parseFloat(str);
    return (fallback >= 0 && fallback <= 24) ? Math.floor(fallback) : NaN;
  }

  /**
   * Calculate hold probability using historical data when available
   * Now includes bid month for seasonal adjustments
   */
  static async calculateHoldProbabilityWithHistory(
    pairing: any,
    seniorityNumber: number,
    seniorityPercentile: number,
    base: string,
    aircraft: string,
    bidMonth?: string
  ): Promise<HoldProbabilityResult> {
    // Try to find historical matches
    const historicalMatches = await this.findHistoricalMatches(
      pairing,
      base,
      aircraft
    );

    // Extract layover cities for location-based adjustments
    const layoverCities = pairing.layovers?.map((l: any) => l.city).filter((c: string) => c) || [];

    if (historicalMatches.length > 0) {
      // Use historical data
      return this.calculateFromHistoricalData(
        seniorityNumber,
        seniorityPercentile,
        historicalMatches,
        pairing
      );
    } else {
      // Fall back to estimate-based calculation with location data
      const desirabilityScore = this.calculateDesirabilityScore(pairing, bidMonth);
      const pairingFrequency = 1; // Can't determine without all pairings
      const startsOnWeekend = this.startsOnWeekend(pairing);
      const includesWeekendOff = this.includesWeekendOff(pairing);

      return this.calculateHoldProbability({
        seniorityPercentile,
        desirabilityScore,
        pairingFrequency,
        startsOnWeekend,
        includesDeadheads: pairing.deadheads || 0,
        includesWeekendOff,
        bidMonth,
        layoverCities,
      });
    }
  }

  /**
   * Find historical matches for a pairing
   */
  private static async findHistoricalMatches(
    pairing: any,
    base: string,
    aircraft: string
  ): Promise<HistoricalMatch[]> {
    try {
      // Create trip fingerprint from current pairing
      const currentFingerprint = this.createFingerprintFromPairing(pairing);

      // Get all historical data for this base/aircraft
      const historicalData = await db
        .select()
        .from(bidHistory)
        .where(and(eq(bidHistory.base, base), eq(bidHistory.aircraft, aircraft)));

      const matches: HistoricalMatch[] = [];

      for (const history of historicalData) {
        if (history.tripFingerprint) {
          const similarity = TripMatcher.calculateSimilarity(
            currentFingerprint,
            history.tripFingerprint as TripFingerprint
          );

          // Only include matches with >50% similarity
          if (similarity.score >= 50) {
            matches.push({
              seniorityNumber: history.juniorHolderSeniority,
              month: history.month,
              year: history.year,
              similarity: similarity.score,
              confidence: similarity.confidence,
            });
          }
        }
      }

      // Sort by similarity (highest first)
      matches.sort((a, b) => b.similarity - a.similarity);

      return matches.slice(0, 10); // Return top 10 matches
    } catch (error) {
      console.error('Error finding historical matches:', error);
      return [];
    }
  }

  /**
   * Create trip fingerprint from a pairing object
   * Made public so it can be reused by the similar history API endpoint
   */
  public static createFingerprintFromPairing(pairing: any): TripFingerprint {
    // Extract layover cities from pairing data
    // Handle case where layovers might be a JSON string (from database) or already parsed array
    let layoversData = pairing.layovers;
    if (typeof layoversData === 'string') {
      try {
        layoversData = JSON.parse(layoversData);
      } catch {
        layoversData = [];
      }
    }
    
    const layoverCities = Array.isArray(layoversData)
      ? layoversData.map((l: any) => l.city).filter(Boolean).sort()
      : [];

    // Parse check-in time to determine time of day
    // Normalize different formats: "5.00" (decimal hours), "0500" (HHMM), "05:00" (HH:MM)
    let checkInTimeOfDay = 'morning';
    if (pairing.checkInTime) {
      const hour = this.normalizeTimeToHour(pairing.checkInTime);
      if (!isNaN(hour)) {
        if (hour >= 12 && hour < 17) checkInTimeOfDay = 'afternoon';
        else if (hour >= 17) checkInTimeOfDay = 'evening';
      }
    }

    // Handle flight segments that might also be a string
    let flightSegmentsData = pairing.flightSegments;
    if (typeof flightSegmentsData === 'string') {
      try {
        flightSegmentsData = JSON.parse(flightSegmentsData);
      } catch {
        flightSegmentsData = [];
      }
    }
    
    const firstSegment = Array.isArray(flightSegmentsData) ? flightSegmentsData[0] : null;
    const lastSegment = Array.isArray(flightSegmentsData) && flightSegmentsData.length > 0
      ? flightSegmentsData[flightSegmentsData.length - 1]
      : null;
    
    const checkInMonth = firstSegment?.departureDate
      ? new Date(firstSegment.departureDate).getMonth() + 1
      : new Date().getMonth() + 1;
    
    // Calculate checkout time from last flight segment's arrival time
    // This is more accurate than TAFB estimation
    // Fallback to TAFB-based estimation if arrival time not available
    let checkOutTimeOfDay = 'afternoon'; // Default
    let checkOutDetermined = false;
    
    // First, try to use last flight segment's arrival time
    if (lastSegment?.arrivalTime) {
      const checkOutHour = this.normalizeTimeToHour(lastSegment.arrivalTime);
      if (!isNaN(checkOutHour)) {
        if (checkOutHour < 12) checkOutTimeOfDay = 'morning';
        else if (checkOutHour >= 12 && checkOutHour < 17) checkOutTimeOfDay = 'afternoon';
        else checkOutTimeOfDay = 'evening';
        checkOutDetermined = true;
      }
    }
    
    // Fallback: TAFB-based heuristic (proven legacy approach)
    if (!checkOutDetermined && pairing.tafb && pairing.pairingDays) {
      const tafbHours = parseFloat(pairing.tafb);
      const days = pairing.pairingDays;
      if (!isNaN(tafbHours) && days > 0) {
        const avgHoursPerDay = tafbHours / days;
        if (avgHoursPerDay > 14) checkOutTimeOfDay = 'evening';
        else if (avgHoursPerDay < 10) checkOutTimeOfDay = 'morning';
        // else stays 'afternoon' (default)
        checkOutDetermined = true;
      }
    }

    const creditHours = parseFloat(pairing.creditHours || 0);
    const pairingDays = pairing.pairingDays || 1;

    return {
      pairingDays,
      layoverCities,
      layoverPattern: layoverCities.join('-'),
      checkInDayOfWeek: 0, // Can be enhanced if we parse effectiveDates
      checkInTimeOfDay,
      checkOutTimeOfDay,
      checkInMonth,
      creditBucket: Math.floor(creditHours / 2) * 2,
      isCommutable: false, // Can be enhanced
      isWeekendTrip: false,
      includesWeekend: pairingDays >= 3,
      efficiencyBucket: Math.floor((creditHours / pairingDays) * 2) / 2,
    };
  }

  /**
   * Calculate hold probability from historical award data
   */
  private static calculateFromHistoricalData(
    seniorityNumber: number,
    seniorityPercentile: number,
    matches: HistoricalMatch[],
    pairing: any
  ): HoldProbabilityResult {
    const reasoning: string[] = [];

    // Get the best matches (highest similarity)
    const bestMatches = matches.filter(m => m.similarity >= 70);
    const allMatches = matches;

    if (bestMatches.length > 0) {
      // Use best matches
      const avgJuniorHolder =
        bestMatches.reduce((sum, m) => sum + m.seniorityNumber, 0) /
        bestMatches.length;
      const mostJuniorHolder = Math.max(
        ...bestMatches.map(m => m.seniorityNumber)
      );
      const mostSeniorHolder = Math.min(
        ...bestMatches.map(m => m.seniorityNumber)
      );

      reasoning.push(
        `📊 Found ${bestMatches.length} similar trip(s) from past months (${bestMatches[0].similarity}% match)`
      );
      reasoning.push(
        `   Historical range: ${mostSeniorHolder} - ${mostJuniorHolder} (avg: ${Math.round(avgJuniorHolder)})`
      );

      // Calculate probability based on where user's seniority falls
      let probability = 0;

      if (seniorityNumber < mostSeniorHolder) {
        // More senior than anyone who's gotten it before
        probability = 95;
        reasoning.push(
          `✅ You're MORE SENIOR than historical holders - excellent chance!`
        );
      } else if (seniorityNumber <= avgJuniorHolder) {
        // Within the average range
        probability = 75;
        reasoning.push(
          `✅ You're within the typical holder range - good chance`
        );
      } else if (seniorityNumber <= mostJuniorHolder) {
        // More junior than average but still within range
        probability = 50;
        reasoning.push(
          `⚖️ You're more junior than average holders - moderate chance`
        );
      } else if (seniorityNumber <= mostJuniorHolder + 500) {
        // Slightly outside the range
        probability = 25;
        reasoning.push(
          `⚠️ You're slightly more junior than past holders - tough but possible`
        );
      } else {
        // Way outside the range
        probability = 10;
        reasoning.push(
          `❌ You're significantly more junior than past holders - unlikely`
        );
      }

      // Adjust for confidence
      if (bestMatches[0].confidence === 'exact') {
        reasoning.push(
          `   🎯 Exact match confidence: prediction is highly accurate`
        );
      } else if (bestMatches[0].confidence === 'high') {
        reasoning.push(`   ✓ High confidence: prediction is reliable`);
      }

      const label = this.getProbabilityLabel(probability);
      return { probability, label, reasoning };
    } else if (allMatches.length > 0) {
      // Use all matches with lower confidence
      const avgJuniorHolder =
        allMatches.reduce((sum, m) => sum + m.seniorityNumber, 0) /
        allMatches.length;

      reasoning.push(
        `📊 Found ${allMatches.length} somewhat similar trip(s) (${allMatches[0].similarity}% match)`
      );
      reasoning.push(
        `   Average junior holder: ${Math.round(avgJuniorHolder)}`
      );

      let probability = 50;
      if (seniorityNumber < avgJuniorHolder - 1000) {
        probability = 75;
        reasoning.push(
          `✅ You're notably more senior - good chance based on trends`
        );
      } else if (seniorityNumber > avgJuniorHolder + 1000) {
        probability = 25;
        reasoning.push(
          `⚠️ You're notably more junior - lower chance based on trends`
        );
      } else {
        reasoning.push(
          `⚖️ You're near the average - moderate chance based on trends`
        );
      }

      reasoning.push(
        `   ⚠️ Medium confidence: less certain due to lower similarity`
      );

      const label = this.getProbabilityLabel(probability);
      return { probability, label, reasoning };
    }

    // Should not reach here, but fall back to estimate
    return this.calculateHoldProbability({
      seniorityPercentile,
      desirabilityScore: this.calculateDesirabilityScore(pairing),
      pairingFrequency: 1,
      startsOnWeekend: false,
      includesDeadheads: pairing.deadheads || 0,
      includesWeekendOff: false,
    });
  }

  /**
   * Get probability label from percentage
   */
  private static getProbabilityLabel(probability: number): string {
    if (probability >= 75) return 'Very Likely';
    if (probability >= 50) return 'Likely';
    if (probability >= 25) return 'Unlikely';
    return 'Very Unlikely';
  }

  /**
   * Calculate hold probability using seniority-based logic
   */
  static calculateHoldProbability(
    params: HoldProbabilityParams
  ): HoldProbabilityResult {
    const {
      seniorityPercentile,
      desirabilityScore,
      pairingFrequency,
      startsOnWeekend,
      includesDeadheads,
      includesWeekendOff,
      bidMonth,
      layoverCities,
    } = params;

    const reasoning: string[] = [];
    let baseProbability = 50;
    let label = 'Unlikely';
    // Floors ensure senior pilots never drop below a minimum threshold
    // e.g., 1-2% => ~100%, 3-5% => >=95%, 6-10% => >=90%
    let seniorityFloor = 0;

    // SENIORITY IS THE PRIMARY FACTOR
    // Senior pilots (top 10%) - Very high hold probability for most pairings
    if (seniorityPercentile <= 10) {
      // Define floors for very senior pilots
      if (seniorityPercentile <= 2) {
        seniorityFloor = 98;
      } // rounds to 100
      else if (seniorityPercentile <= 5) {
        seniorityFloor = 95;
      } else {
        seniorityFloor = 90;
      }

      baseProbability = Math.max(90, seniorityFloor);
      label = 'Very Likely';
      reasoning.push(
        `✅ Very senior pilot (top ${seniorityPercentile.toFixed(1)}%) - high hold probability`
      );

      // Only reduce for extremely desirable trips
      if (desirabilityScore > 90) {
        // Even for extremely desirable trips, do not go below the senior floor
        baseProbability = Math.max(seniorityFloor, 90);
        reasoning.push('⚠️ Extremely desirable pairing (senior floor applied)');
      }
    }
    // Mid-senior pilots (10-25%) - High hold probability for most pairings
    else if (seniorityPercentile <= 25) {
      baseProbability = 75;
      label = 'Likely';
      reasoning.push(
        `✅ Senior pilot (top ${seniorityPercentile.toFixed(1)}%) - good hold probability`
      );

      // Reduce for very desirable trips
      if (desirabilityScore > 85) {
        baseProbability = 50;
        label = 'Unlikely';
        reasoning.push(
          '⚠️ Very desirable pairing - competition from more senior pilots'
        );
      }
    }
    // Mid-seniority pilots (25-50%) - Moderate hold probability
    else if (seniorityPercentile <= 50) {
      baseProbability = 50;
      label = 'Unlikely';
      reasoning.push(
        `⚖️ Mid-seniority pilot (${seniorityPercentile.toFixed(1)}th percentile)`
      );

      // Higher chance for less desirable trips
      if (desirabilityScore < 50) {
        baseProbability = 75;
        label = 'Likely';
        reasoning.push('✅ Less desirable pairing - better chance to hold');
      }
      // Lower chance for desirable trips
      else if (desirabilityScore > 75) {
        baseProbability = 25;
        label = 'Very Unlikely';
        reasoning.push('❌ Desirable pairing - senior pilots will take it');
      }
    }
    // Junior-mid pilots (50-75%) - Lower hold probability
    else if (seniorityPercentile <= 75) {
      baseProbability = 25;
      label = 'Very Unlikely';
      reasoning.push(
        `❌ Junior-mid pilot (${seniorityPercentile.toFixed(1)}th percentile) - tough competition`
      );

      // Only good chance for undesirable trips
      if (desirabilityScore < 40 && pairingFrequency >= 3) {
        baseProbability = 75;
        label = 'Likely';
        reasoning.push(
          '✅ Undesirable pairing with multiple instances - good chance'
        );
      } else if (desirabilityScore < 55) {
        baseProbability = 50;
        label = 'Unlikely';
        reasoning.push('⚖️ Moderately undesirable pairing - some chance');
      }
    }
    // Very junior pilots (75%+) - Very low hold probability
    else {
      baseProbability = 10;
      label = 'Very Unlikely';
      reasoning.push(
        `❌ Very junior pilot (${seniorityPercentile.toFixed(1)}th percentile) - extremely tough competition`
      );

      // Only decent chance for very undesirable, frequent trips
      if (
        desirabilityScore < 30 &&
        pairingFrequency >= 4 &&
        startsOnWeekend &&
        includesDeadheads >= 2
      ) {
        baseProbability = 50;
        label = 'Unlikely';
        reasoning.push('⚖️ Very undesirable frequent pairing - some hope');
      } else if (desirabilityScore < 40 && pairingFrequency >= 3) {
        baseProbability = 25;
        label = 'Very Unlikely';
        reasoning.push('⚠️ Undesirable frequent pairing - slight chance');
      }
    }

    // Minor adjustments for pairing characteristics (informational only for now)
    if (pairingFrequency >= 4) {
      reasoning.push('• Frequent pairing (+5% boost)');
    }
    if (includesDeadheads >= 3) {
      reasoning.push('• Many deadheads - less competition');
    }
    if (startsOnWeekend && seniorityPercentile > 50) {
      reasoning.push('• Weekend start - less popular with senior pilots');
    }

    // Location-based adjustments (seasonal layover desirability)
    let locationAdjustment = 0;
    if (bidMonth && layoverCities && layoverCities.length > 0) {
      const { score: layoverScore, reasoning: layoverReasoning } = 
        calculateLayoverDesirability(layoverCities, bidMonth);
      
      locationAdjustment = getLocationCompetitionAdjustment(layoverCities, bidMonth);
      
      const monthNumber = getMonthFromBidPackage(bidMonth);
      const season = getSeason(monthNumber);
      
      if (layoverScore >= 80) {
        reasoning.push(`🌴 High-demand layover(s) in ${season} - more competition`);
      } else if (layoverScore <= 40) {
        reasoning.push(`❄️ Less desirable layover(s) in ${season} - less competition`);
      }
      
      // Holiday period penalty
      if (isHolidayPeriod(monthNumber)) {
        const holidayPenalty = getHolidayCompetitionPenalty(monthNumber);
        locationAdjustment += holidayPenalty;
        if (holidayPenalty < 0) {
          reasoning.push('🎄 Holiday period - increased competition for good trips');
        }
      }
    }

    // Add small randomization for realism only for non-senior cases
    const randomAdjustment =
      seniorityPercentile <= 10 ? 0 : (Math.random() - 0.5) * 6; // -3 to +3
    let finalProbability = Math.max(
      0,
      Math.min(100, baseProbability + randomAdjustment + locationAdjustment)
    );

    // Enforce seniority floor if applicable
    if (seniorityFloor > 0) {
      finalProbability = Math.max(finalProbability, seniorityFloor);
    }

    // Round to nearest 5% for more granular display
    const roundedProbability = Math.round(finalProbability / 5) * 5;

    if (
      process.env.NODE_ENV === 'development' &&
      process.env.LOG_HOLD_DEBUG === '1'
    ) {
      console.log(`Hold Probability Calculation for pairing:`);
      console.log(`  Seniority Percentile: ${seniorityPercentile}%`);
      console.log(`  Desirability Score: ${desirabilityScore}`);
      console.log(`  Pairing Frequency: ${pairingFrequency}`);
      console.log(`  Starts on Weekend: ${startsOnWeekend}`);
      console.log(`  Deadheads: ${includesDeadheads}`);
      console.log(`  Weekend Off: ${includesWeekendOff}`);
      console.log(`  Result: ${roundedProbability}% - ${label}`);
      reasoning.forEach(reason => console.log(`  ${reason}`));
    }

    return {
      probability: roundedProbability,
      label,
      reasoning,
    };
  }

  /**
   * Calculate desirability score based on pairing characteristics
   * Now includes location and seasonal factors when bid month is provided
   */
  static calculateDesirabilityScore(pairing: any, bidMonth?: string): number {
    let score = 50; // Base score

    const creditHours = parseFloat(pairing.creditHours) || 0;
    const blockHours = parseFloat(pairing.blockHours) || 0;
    const pairingDays = pairing.pairingDays || 1;
    const deadheads = pairing.deadheads || 0;

    // Higher credit hours = more desirable
    if (creditHours >= 25) {
      score += 30;
    } else if (creditHours >= 20) {
      score += 20;
    } else if (creditHours >= 15) {
      score += 10;
    } else if (creditHours < 10) {
      score -= 15;
    }

    // Better credit/block ratio = more desirable
    const efficiency = blockHours > 0 ? creditHours / blockHours : 1;
    if (efficiency >= 1.5) {
      score += 20;
    } else if (efficiency >= 1.3) {
      score += 10;
    } else if (efficiency < 1.1) {
      score -= 10;
    }

    // Shorter trips often more desirable for turns
    if (pairingDays === 1 && creditHours >= 5) {
      score += 15;
    }
    if (pairingDays >= 4) {
      score -= 5;
    }

    // Deadheads reduce desirability
    score -= deadheads * 8;

    // Weekend starts reduce desirability for most pilots
    if (pairing.startsOnWeekend) {
      score -= 10;
    }

    // Location-based desirability (seasonal adjustment)
    if (bidMonth && pairing.layovers && Array.isArray(pairing.layovers)) {
      const layoverCities = pairing.layovers
        .map((l: any) => l.city)
        .filter((c: string) => c);
      
      if (layoverCities.length > 0) {
        const { score: locationScore } = calculateLayoverDesirability(layoverCities, bidMonth);
        // Blend location score with base score (weighted average)
        // Location accounts for ~30% of the desirability calculation
        score = score * 0.7 + locationScore * 0.3;
      }
    }

    // Clamp to 0-100 range
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Determine if pairing starts on weekend
   */
  static startsOnWeekend(pairing: any): boolean {
    // This would need to be implemented based on your pairing data structure
    // For now, return false as a placeholder
    return false;
  }

  /**
   * Determine if pairing includes weekend off
   */
  static includesWeekendOff(pairing: any): boolean {
    // This would need to be implemented based on your pairing data structure
    // For now, return false as a placeholder
    return false;
  }

  /**
   * Calculate pairing frequency in bid package
   */
  static calculatePairingFrequency(
    pairingNumber: string,
    allPairings: any[]
  ): number {
    return allPairings.filter(p => p.pairingNumber === pairingNumber).length;
  }
}
