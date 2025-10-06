import { db } from './db';
import { bidHistory } from '../shared/schema';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { ReasonsReportParser, type TripFingerprint } from './reasonsReportParser';
import { TripMatcher } from './tripMatcher';

interface HoldProbabilityParams {
  seniorityPercentile: number; // 0-100 (lower is more senior)
  desirabilityScore: number; // 0-100
  pairingFrequency: number; // number of times trip appears
  startsOnWeekend: boolean;
  includesDeadheads: number;
  includesWeekendOff: boolean;
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
   * Calculate hold probability using historical data when available
   */
  static async calculateHoldProbabilityWithHistory(
    pairing: any,
    seniorityNumber: number,
    seniorityPercentile: number,
    base: string,
    aircraft: string
  ): Promise<HoldProbabilityResult> {
    // Try to find historical matches
    const historicalMatches = await this.findHistoricalMatches(
      pairing,
      base,
      aircraft
    );

    if (historicalMatches.length > 0) {
      // Use historical data
      return this.calculateFromHistoricalData(
        seniorityNumber,
        seniorityPercentile,
        historicalMatches,
        pairing
      );
    } else {
      // Fall back to estimate-based calculation
      const desirabilityScore = this.calculateDesirabilityScore(pairing);
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
   */
  private static createFingerprintFromPairing(pairing: any): TripFingerprint {
    // Extract layover cities from pairing data
    const layoverCities =
      pairing.layovers?.map((l: any) => l.city).sort() || [];

    // Parse check-in date if available
    const firstSegment = pairing.flightSegments?.[0];
    const checkInMonth = firstSegment?.departureDate
      ? new Date(firstSegment.departureDate).getMonth() + 1
      : new Date().getMonth() + 1;

    return {
      pairingDays: pairing.pairingDays || 1,
      layoverCities,
      layoverPattern: layoverCities.join('-'),
      checkInDayOfWeek: 0, // Can be enhanced if we parse effectiveDates
      checkInTimeOfDay: 'morning', // Default
      checkOutTimeOfDay: 'afternoon', // Default
      checkInMonth,
      creditBucket: Math.floor(parseFloat(pairing.creditHours || 0) / 2) * 2,
      isCommutable: false, // Can be enhanced
      isWeekendTrip: false,
      includesWeekend: pairing.pairingDays >= 3,
      efficiencyBucket:
        Math.floor(
          (parseFloat(pairing.creditHours || 0) / (pairing.pairingDays || 1)) *
            2
        ) / 2,
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

    // Add small randomization for realism only for non-senior cases
    const randomAdjustment =
      seniorityPercentile <= 10 ? 0 : (Math.random() - 0.5) * 6; // -3 to +3
    let finalProbability = Math.max(
      0,
      Math.min(100, baseProbability + randomAdjustment)
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
   */
  static calculateDesirabilityScore(pairing: any): number {
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
    const efficiency = creditHours / blockHours;
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

    // Clamp to 0-100 range
    return Math.max(0, Math.min(100, score));
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
