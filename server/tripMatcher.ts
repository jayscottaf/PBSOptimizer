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
  };
}

export class TripMatcher {
  /**
   * Calculate similarity between two trip fingerprints
   * Returns a score from 0-100 with confidence level
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
    };

    // 1. Layover pattern match (40% weight) - most important
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

    // 4. Credit hours bucket match (10% weight)
    if (trip1.creditBucket === trip2.creditBucket) {
      breakdown.creditMatch = 100;
    } else {
      const creditDiff = Math.abs(trip1.creditBucket - trip2.creditBucket);
      breakdown.creditMatch = Math.max(0, 100 - creditDiff * 10);
    }

    // 5. Efficiency bucket match (10% weight)
    if (trip1.efficiencyBucket === trip2.efficiencyBucket) {
      breakdown.efficiencyMatch = 100;
    } else {
      const effDiff = Math.abs(trip1.efficiencyBucket - trip2.efficiencyBucket);
      breakdown.efficiencyMatch = Math.max(0, 100 - effDiff * 20);
    }

    // Calculate weighted score
    const score =
      breakdown.layoverMatch * 0.4 +
      breakdown.daysMatch * 0.25 +
      breakdown.timeMatch * 0.15 +
      breakdown.creditMatch * 0.1 +
      breakdown.efficiencyMatch * 0.1;

    // Determine confidence level
    let confidence: 'exact' | 'high' | 'medium' | 'low';
    if (score >= 95) {
      confidence = 'exact';
    } else if (score >= 80) {
      confidence = 'high';
    } else if (score >= 60) {
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
