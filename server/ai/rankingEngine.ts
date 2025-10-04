/**
 * Stage 2: Deterministic Ranking Engine
 * Computes pairing rankings using backend logic (no AI variability)
 * AI explains rankings but doesn't decide them
 */

/**
 * Ranking score metadata added to pairings
 */
export interface RankingMetadata {
  score: number;
  scoreBreakdown: {
    credit?: number;
    efficiency?: number;
    holdProbability?: number;
    weights?: {
      creditWeight: number;
      efficiencyWeight: number;
      holdWeight: number;
    };
    normalizedScores?: {
      credit: string;
      efficiency: string;
      hold: number;
    };
  };
}

/**
 * Pairing with computed ranking score
 * Preserves all original pairing fields and adds ranking metadata
 */
export type RankedPairing = any & RankingMetadata;

/**
 * Ranking criteria types
 */
export type RankingCriteria = 'credit' | 'efficiency' | 'hold_probability' | 'overall';

/**
 * Pairing Ranking Engine
 * Provides deterministic, explainable rankings
 */
export class PairingRankingEngine {
  /**
   * Rank pairings by specified criteria
   *
   * @param pairings - Array of pairings to rank
   * @param criteria - Ranking criteria
   * @param seniorityPercentile - User's seniority percentile (optional, affects overall weighting)
   * @returns Ranked pairings with scores and breakdown
   */
  static rankPairings(
    pairings: any[],
    criteria: RankingCriteria,
    seniorityPercentile?: number
  ): RankedPairing[] {
    const rankedPairings = pairings.map(p => {
      const credit = this.parseNumber(p.creditHours);
      const block = this.parseNumber(p.blockHours);
      const efficiency = block > 0 ? credit / block : 0;
      const hold = p.holdProbability || 0;

      let score = 0;
      let scoreBreakdown: any = {};

      switch (criteria) {
        case 'credit':
          score = credit;
          scoreBreakdown = { credit };
          break;

        case 'efficiency':
          score = efficiency;
          scoreBreakdown = { efficiency: parseFloat(efficiency.toFixed(3)) };
          break;

        case 'hold_probability':
          score = hold;
          scoreBreakdown = { holdProbability: hold };
          break;

        case 'overall':
          // Weighted composite score
          const holdWeight = this.calculateHoldWeight(seniorityPercentile);
          const creditWeight = 0.4;
          const efficiencyWeight = 1 - creditWeight - holdWeight;

          // Normalize metrics to 0-100 scale
          const normalizedCredit = this.normalizeCredit(credit);
          const normalizedEfficiency = this.normalizeEfficiency(efficiency);
          const normalizedHold = hold; // Already 0-100

          score =
            normalizedCredit * creditWeight +
            normalizedEfficiency * efficiencyWeight +
            normalizedHold * holdWeight;

          scoreBreakdown = {
            credit,
            efficiency: parseFloat(efficiency.toFixed(3)),
            holdProbability: hold,
            weights: {
              creditWeight,
              efficiencyWeight,
              holdWeight,
            },
            normalizedScores: {
              credit: normalizedCredit.toFixed(1),
              efficiency: normalizedEfficiency.toFixed(1),
              hold: normalizedHold,
            },
          };
          break;
      }

      return {
        ...p,
        score,
        scoreBreakdown,
      };
    });

    // Sort by score (highest first)
    return rankedPairings.sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate hold weight based on seniority
   * Junior pilots (high percentile) care more about hold probability
   * Senior pilots (low percentile) can focus more on credit/efficiency
   */
  private static calculateHoldWeight(seniorityPercentile?: number): number {
    if (!seniorityPercentile) {
      return 0.3; // Default 30% weight
    }

    // Junior pilots (> 50%) = higher hold weight (up to 40%)
    // Senior pilots (< 50%) = lower hold weight (down to 20%)
    if (seniorityPercentile > 50) {
      return 0.4; // Junior: 40% weight on hold
    } else {
      return 0.2; // Senior: 20% weight on hold
    }
  }

  /**
   * Normalize credit hours to 0-100 scale
   * Assumes max credit is ~30 hours
   */
  private static normalizeCredit(credit: number): number {
    const MAX_CREDIT = 30;
    return Math.min((credit / MAX_CREDIT) * 100, 100);
  }

  /**
   * Normalize efficiency to 0-100 scale
   * Assumes typical range is 1.0-1.5
   */
  private static normalizeEfficiency(efficiency: number): number {
    const MIN_EFFICIENCY = 1.0;
    const MAX_EFFICIENCY = 1.5;
    return Math.min(
      Math.max(((efficiency - MIN_EFFICIENCY) / (MAX_EFFICIENCY - MIN_EFFICIENCY)) * 100, 0),
      100
    );
  }

  /**
   * Parse number from string or number
   */
  private static parseNumber(value: string | number | undefined): number {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      return parseFloat(value) || 0;
    }
    return 0;
  }

  /**
   * Generate ranking explanation for AI to use
   */
  static generateRankingExplanation(
    rankedPairings: RankedPairing[],
    criteria: RankingCriteria,
    limit: number = 10
  ): string {
    const topPairings = rankedPairings.slice(0, limit);

    let explanation = `Ranking Criteria: ${criteria}\n\n`;
    explanation += `Top ${topPairings.length} pairings by score:\n\n`;

    topPairings.forEach((p, index) => {
      explanation += `${index + 1}. Pairing ${p.pairingNumber}\n`;
      explanation += `   Score: ${p.score.toFixed(2)}\n`;
      explanation += `   Breakdown: ${JSON.stringify(p.scoreBreakdown, null, 2)}\n\n`;
    });

    // Add explanation of ranking logic
    switch (criteria) {
      case 'credit':
        explanation += '\nRanked by credit hours (highest pay first).\n';
        break;
      case 'efficiency':
        explanation += '\nRanked by credit/block ratio (most efficient use of flight time).\n';
        break;
      case 'hold_probability':
        explanation += '\nRanked by hold probability (most likely to be awarded first).\n';
        break;
      case 'overall':
        explanation += '\nRanked by weighted composite score considering credit, efficiency, and hold probability.\n';
        explanation += 'Weights are adjusted based on seniority level.\n';
        break;
    }

    return explanation;
  }

  /**
   * Find best layovers (longest duration)
   */
  static findBestLayovers(pairings: any[], limit: number = 10): any[] {
    return pairings
      .map(p => ({
        ...p,
        maxLayoverHours: this.calculateMaxLayoverDuration(p),
      }))
      .sort((a, b) => b.maxLayoverHours - a.maxLayoverHours)
      .slice(0, limit);
  }

  /**
   * Calculate maximum layover duration for a pairing
   */
  private static calculateMaxLayoverDuration(pairing: any): number {
    if (!pairing.layovers || pairing.layovers.length === 0) {
      return 0;
    }

    return Math.max(
      ...pairing.layovers.map((l: any) => this.parseLayoverDuration(l.duration || '0'))
    );
  }

  /**
   * Parse layover duration to hours
   */
  private static parseLayoverDuration(duration: string): number {
    if (!duration) return 0;

    // Handle "HH:MM" format
    if (duration.includes(':')) {
      const [hours, minutes] = duration.split(':').map(Number);
      return hours + (minutes || 0) / 60;
    }

    // Handle decimal hours
    return parseFloat(duration) || 0;
  }
}
