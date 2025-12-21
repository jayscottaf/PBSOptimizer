import { TripFingerprint } from './reasonsReportParser';

export interface SimilarityResult {
  score: number; // 0-100
  confidence: 'exact' | 'high' | 'medium' | 'low';
  breakdown: {
    layoverMatch: number;
    daysMatch: number;
    timeMatch: number;
    creditMatch: number;
    efficiencyMatch: number;
    seasonMatch: number;
  };
}

type Season = 'winter' | 'spring' | 'summer' | 'fall';

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  'jan': 1, 'january': 1,
  'feb': 2, 'february': 2,
  'mar': 3, 'march': 3,
  'apr': 4, 'april': 4,
  'may': 5,
  'jun': 6, 'june': 6,
  'jul': 7, 'july': 7,
  'aug': 8, 'august': 8,
  'sep': 9, 'sept': 9, 'september': 9,
  'oct': 10, 'october': 10,
  'nov': 11, 'november': 11,
  'dec': 12, 'december': 12,
};

export class TripMatcher {
  /**
   * Get season from month (supports numeric 1-12 or string month names)
   */
  private static getSeason(month: number | string | undefined): Season {
    let numericMonth: number;
    
    if (typeof month === 'string') {
      // Try to parse as string month name
      numericMonth = MONTH_NAME_TO_NUMBER[month.toLowerCase()] || parseInt(month) || new Date().getMonth() + 1;
    } else if (typeof month === 'number') {
      numericMonth = month;
    } else {
      // Default to current month
      numericMonth = new Date().getMonth() + 1;
    }
    
    if (numericMonth === 12 || numericMonth === 1 || numericMonth === 2) return 'winter';
    if (numericMonth >= 3 && numericMonth <= 5) return 'spring';
    if (numericMonth >= 6 && numericMonth <= 8) return 'summer';
    return 'fall'; // 9, 10, 11
  }

  /**
   * Calculate similarity between two trip fingerprints
   * Returns a score from 0-100 with confidence level
   * 
   * Weights:
   * - Layovers: 35% (most important - which cities you visit)
   * - Days: 25% (trip length preference)
   * - Times: 15% (check-in/check-out time preferences)
   * - Season: 10% (seasonal patterns - pilots may prefer different trips by season)
   * - Credit: 10% (pay hours preference)
   * - Efficiency: 5% (credit per day preference)
   */
  static calculateSimilarity(
    trip1: TripFingerprint,
    trip2: TripFingerprint
  ): SimilarityResult {
    const breakdown = {
      layoverMatch: 0,
      daysMatch: 0,
      timeMatch: 0,
      creditMatch: 0,
      efficiencyMatch: 0,
      seasonMatch: 0,
    };

    // 1. Layover pattern match (35% weight) - most important
    if (trip1.layoverPattern === trip2.layoverPattern) {
      breakdown.layoverMatch = 100; // Exact match
    } else {
      // Calculate partial match based on common cities
      const cities1 = new Set(trip1.layoverCities);
      const cities2 = new Set(trip2.layoverCities);
      const intersection = new Set(
        [...cities1].filter((city) => cities2.has(city))
      );
      const union = new Set([...cities1, ...cities2]);

      if (union.size > 0) {
        breakdown.layoverMatch = (intersection.size / union.size) * 100;
      }
    }

    // 2. Pairing days match (25% weight)
    if (trip1.pairingDays === trip2.pairingDays) {
      breakdown.daysMatch = 100;
    } else {
      // Closer days = higher score
      const daysDiff = Math.abs(trip1.pairingDays - trip2.pairingDays);
      breakdown.daysMatch = Math.max(0, 100 - daysDiff * 25); // -25% per day difference
    }

    // 3. Check-in/check-out time similarity (15% weight)
    let timeScore = 0;

    // Check-in time of day match
    if (trip1.checkInTimeOfDay === trip2.checkInTimeOfDay) {
      timeScore += 50;
    } else {
      // Adjacent times get partial credit
      const timeOrder = ['morning', 'afternoon', 'evening'];
      const idx1 = timeOrder.indexOf(trip1.checkInTimeOfDay);
      const idx2 = timeOrder.indexOf(trip2.checkInTimeOfDay);
      if (Math.abs(idx1 - idx2) === 1) {
        timeScore += 25;
      }
    }

    // Check-out time of day match
    if (trip1.checkOutTimeOfDay === trip2.checkOutTimeOfDay) {
      timeScore += 50;
    } else {
      const timeOrder = ['morning', 'afternoon', 'evening'];
      const idx1 = timeOrder.indexOf(trip1.checkOutTimeOfDay);
      const idx2 = timeOrder.indexOf(trip2.checkOutTimeOfDay);
      if (Math.abs(idx1 - idx2) === 1) {
        timeScore += 25;
      }
    }

    breakdown.timeMatch = timeScore;

    // 4. Season match (10% weight) - compare seasons for seasonal preference patterns
    const season1 = this.getSeason(trip1.checkInMonth);
    const season2 = this.getSeason(trip2.checkInMonth);
    
    if (season1 === season2) {
      breakdown.seasonMatch = 100; // Same season = full match
    } else {
      // Adjacent seasons get partial credit
      const seasonOrder: Season[] = ['winter', 'spring', 'summer', 'fall'];
      const idx1 = seasonOrder.indexOf(season1);
      const idx2 = seasonOrder.indexOf(season2);
      const diff = Math.abs(idx1 - idx2);
      
      // Handle wrap-around (winter-fall are adjacent)
      if (diff === 1 || diff === 3) {
        breakdown.seasonMatch = 50; // Adjacent season
      } else {
        breakdown.seasonMatch = 0; // Opposite season (e.g., winter vs summer)
      }
    }

    // 5. Credit hours bucket match (10% weight)
    if (trip1.creditBucket === trip2.creditBucket) {
      breakdown.creditMatch = 100;
    } else {
      const creditDiff = Math.abs(trip1.creditBucket - trip2.creditBucket);
      breakdown.creditMatch = Math.max(0, 100 - creditDiff * 10);
    }

    // 6. Efficiency bucket match (5% weight)
    if (trip1.efficiencyBucket === trip2.efficiencyBucket) {
      breakdown.efficiencyMatch = 100;
    } else {
      const effDiff = Math.abs(trip1.efficiencyBucket - trip2.efficiencyBucket);
      breakdown.efficiencyMatch = Math.max(0, 100 - effDiff * 20);
    }

    // Calculate weighted score
    // Layovers 35%, Days 25%, Times 15%, Season 10%, Credit 10%, Efficiency 5%
    const score =
      breakdown.layoverMatch * 0.35 +
      breakdown.daysMatch * 0.25 +
      breakdown.timeMatch * 0.15 +
      breakdown.seasonMatch * 0.10 +
      breakdown.creditMatch * 0.10 +
      breakdown.efficiencyMatch * 0.05;

    // Determine confidence level
    // "exact" is reserved for true 100% matches only
    let confidence: 'exact' | 'high' | 'medium' | 'low';
    if (score >= 100) {
      confidence = 'exact';
    } else if (score >= 90) {
      confidence = 'high';
    } else if (score >= 70) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    return {
      score: Math.round(score),
      confidence,
      breakdown,
    };
  }

  /**
   * Find best matches from a list of historical trips
   */
  static findBestMatches(
    currentTrip: TripFingerprint,
    historicalTrips: TripFingerprint[],
    minScore: number = 50
  ): Array<{ trip: TripFingerprint; similarity: SimilarityResult }> {
    const matches = historicalTrips
      .map((historicalTrip) => ({
        trip: historicalTrip,
        similarity: this.calculateSimilarity(currentTrip, historicalTrip),
      }))
      .filter((match) => match.similarity.score >= minScore)
      .sort((a, b) => b.similarity.score - a.similarity.score);

    return matches;
  }
}
