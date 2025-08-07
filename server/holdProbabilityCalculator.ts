
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

export class HoldProbabilityCalculator {
  
  /**
   * Calculate hold probability using tiered logic based on seniority and desirability
   */
  static calculateHoldProbability(params: HoldProbabilityParams): HoldProbabilityResult {
    const {
      seniorityPercentile,
      desirabilityScore,
      pairingFrequency,
      startsOnWeekend,
      includesDeadheads,
      includesWeekendOff
    } = params;

    const reasoning: string[] = [];
    let probability = 50; // Default to middle tier
    let label = "Unlikely";

    // Very Likely (100%) - Undesirable trips that junior pilots can hold
    if (
      desirabilityScore < 40 &&
      pairingFrequency >= 3 &&
      startsOnWeekend === true &&
      includesDeadheads <= 1 &&
      includesWeekendOff === false &&
      seniorityPercentile <= 75
    ) {
      probability = 100;
      label = "Very Likely";
      reasoning.push("✅ Very Likely: Low desirability, frequent pairing, weekend start, few deadheads, no weekend off, junior seniority");
    }
    // Likely (75%)
    else if (
      (desirabilityScore < 60 &&
       pairingFrequency >= 2 &&
       includesDeadheads <= 2) ||
      seniorityPercentile > 50
    ) {
      probability = 75;
      label = "Likely";
      if (desirabilityScore < 60) reasoning.push("✅ Likely: Mid-low desirability, available multiple times, manageable deadheads");
      if (seniorityPercentile > 50) reasoning.push("✅ Likely: Junior seniority position (bottom 50%)");
    }
    // Very Unlikely (25%) - Highly desirable trips for senior pilots
    else if (
      desirabilityScore > 80 ||
      (pairingFrequency === 1 &&
       includesDeadheads >= 2 &&
       includesWeekendOff === true &&
       startsOnWeekend === false) ||
      seniorityPercentile <= 25
    ) {
      probability = 25;
      label = "Very Unlikely";
      if (desirabilityScore > 80) reasoning.push("❌ Very Unlikely: Highly desirable pairing");
      if (pairingFrequency === 1) reasoning.push("❌ Very Unlikely: Rare pairing with multiple deadheads and weekend off");
      if (seniorityPercentile <= 25) reasoning.push("❌ Very Unlikely: Senior pilot position (top 25%)");
    }
    // Unlikely (50%) - Default middle tier
    else {
      probability = 50;
      label = "Unlikely";
      reasoning.push("⚖️ Unlikely: Moderate desirability and mixed characteristics");
      
      if (desirabilityScore >= 60 && desirabilityScore <= 80) {
        reasoning.push("• Mid-high desirability score");
      }
      if (pairingFrequency <= 2) {
        reasoning.push("• Limited availability in bid package");
      }
      if (includesDeadheads >= 2) {
        reasoning.push("• Multiple deadhead legs");
      }
      if (includesWeekendOff) {
        reasoning.push("• Includes weekend off time");
      }
    }

    // Add small randomization (±5%) for realism
    const randomAdjustment = (Math.random() - 0.5) * 10; // -5 to +5
    const finalProbability = Math.max(0, Math.min(100, probability + randomAdjustment));
    
    // Round to nearest 25% tier
    const roundedProbability = Math.round(finalProbability / 25) * 25;

    console.log(`Hold Probability Calculation for pairing:`);
    console.log(`  Seniority Percentile: ${seniorityPercentile}%`);
    console.log(`  Desirability Score: ${desirabilityScore}`);
    console.log(`  Pairing Frequency: ${pairingFrequency}`);
    console.log(`  Starts on Weekend: ${startsOnWeekend}`);
    console.log(`  Deadheads: ${includesDeadheads}`);
    console.log(`  Weekend Off: ${includesWeekendOff}`);
    console.log(`  Result: ${roundedProbability}% - ${label}`);
    reasoning.forEach(reason => console.log(`  ${reason}`));

    return {
      probability: roundedProbability,
      label,
      reasoning
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
    if (creditHours >= 25) score += 30;
    else if (creditHours >= 20) score += 20;
    else if (creditHours >= 15) score += 10;
    else if (creditHours < 10) score -= 15;

    // Better credit/block ratio = more desirable
    const efficiency = creditHours / blockHours;
    if (efficiency >= 1.5) score += 20;
    else if (efficiency >= 1.3) score += 10;
    else if (efficiency < 1.1) score -= 10;

    // Shorter trips often more desirable for turns
    if (pairingDays === 1 && creditHours >= 5) score += 15;
    if (pairingDays >= 4) score -= 5;

    // Deadheads reduce desirability
    score -= (deadheads * 8);

    // Weekend starts reduce desirability for most pilots
    if (pairing.startsOnWeekend) score -= 10;

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
  static calculatePairingFrequency(pairingNumber: string, allPairings: any[]): number {
    return allPairings.filter(p => p.pairingNumber === pairingNumber).length;
  }
}
