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
   * NOTE: Days is now a HARD FILTER (handled in findBestMatches) - only trips
   * with the same number of days are compared. daysMatch is always 100 here.
   * 
   * Weights (after days filter):
   * - Layovers: 45% (most important - which cities you visit)
   * - Times: 20% (check-in/check-out time preferences for commutability)
   * - Season: 15% (seasonal patterns - pilots may prefer different trips by season)
   * - Credit: 15% (pay hours preference)
   * - Efficiency: 5% (credit per day preference)
   */
  static calculateSimilarity(
    trip1: TripFingerprint,
    trip2: TripFingerprint
  ): SimilarityResult {
    const breakdown = {
      layoverMatch: 0,
      daysMatch: 100, // Always 100 since days is a hard filter now
      timeMatch: 0,
      creditMatch: 0,
      efficiencyMatch: 0,
      seasonMatch: 0,
    };

    // 1. Layover pattern match (45% weight) - most important
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

    // 2. Days match - now a hard filter, so always 100% if we get here
    // (Filtering happens in findBestMatches)

    // 3. Check-in/check-out time similarity (20% weight)
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

    // 4. Season match (15% weight) - compare seasons for seasonal preference patterns
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

    // 5. Credit hours match (15% weight) - use actual credit if available, else bucket
    // Strict matching: credit must be very close for high scores
    if (trip1.creditHours !== undefined && trip2.creditHours !== undefined) {
      const creditDiff = Math.abs(trip1.creditHours - trip2.creditHours);
      // Only exact or near-exact credit gets 100%
      if (creditDiff <= 0.02) {
        breakdown.creditMatch = 100; // Essentially identical (within 1 minute)
      } else if (creditDiff <= 0.1) {
        breakdown.creditMatch = 90; // Very close (within 6 minutes)
      } else if (creditDiff <= 0.25) {
        breakdown.creditMatch = 80; // Close (within 15 minutes)
      } else if (creditDiff <= 0.5) {
        breakdown.creditMatch = 70; // Similar (within 30 minutes)
      } else if (creditDiff <= 1.0) {
        breakdown.creditMatch = 50;
      } else {
        breakdown.creditMatch = Math.max(0, 30 - (creditDiff - 1) * 10);
      }
    } else if (trip1.creditBucket === trip2.creditBucket) {
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
    // Days is a hard filter (not weighted) - only same-day trips are compared
    // Layovers 45%, Times 20%, Season 15%, Credit 15%, Efficiency 5%
    const score =
      breakdown.layoverMatch * 0.45 +
      breakdown.timeMatch * 0.20 +
      breakdown.seasonMatch * 0.15 +
      breakdown.creditMatch * 0.15 +
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
   * Days is a HARD FILTER - only trips with the same number of days are compared
   */
  static findBestMatches(
    currentTrip: TripFingerprint,
    historicalTrips: TripFingerprint[],
    minScore: number = 50
  ): Array<{ trip: TripFingerprint; similarity: SimilarityResult }> {
    // First, filter to only trips with the same number of days (hard filter)
    const sameDayTrips = historicalTrips.filter(
      (trip) => trip.pairingDays === currentTrip.pairingDays
    );

    const matches = sameDayTrips
      .map((historicalTrip) => ({
        trip: historicalTrip,
        similarity: this.calculateSimilarity(currentTrip, historicalTrip),
      }))
      .filter((match) => match.similarity.score >= minScore)
      .sort((a, b) => b.similarity.score - a.similarity.score);

    return matches;
  }
}
