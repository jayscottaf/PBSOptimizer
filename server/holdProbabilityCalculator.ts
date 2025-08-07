
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
   * Calculate hold probability using seniority-based logic
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
    let baseProbability = 50;
    let label = "Unlikely";

    // SENIORITY IS THE PRIMARY FACTOR
    // Senior pilots (top 10%) - Very high hold probability for most pairings
    if (seniorityPercentile <= 10) {
      baseProbability = 90;
      label = "Very Likely";
      reasoning.push(`✅ Very senior pilot (top ${seniorityPercentile.toFixed(1)}%) - high hold probability`);
      
      // Only reduce for extremely desirable trips
      if (desirabilityScore > 90) {
        baseProbability = 75;
        label = "Likely";
        reasoning.push("⚠️ Extremely desirable pairing may go to even more senior pilots");
      }
    }
    // Mid-senior pilots (10-25%) - High hold probability for most pairings
    else if (seniorityPercentile <= 25) {
      baseProbability = 75;
      label = "Likely";
      reasoning.push(`✅ Senior pilot (top ${seniorityPercentile.toFixed(1)}%) - good hold probability`);
      
      // Reduce for very desirable trips
      if (desirabilityScore > 85) {
        baseProbability = 50;
        label = "Unlikely";
        reasoning.push("⚠️ Very desirable pairing - competition from more senior pilots");
      }
    }
    // Mid-seniority pilots (25-50%) - Moderate hold probability
    else if (seniorityPercentile <= 50) {
      baseProbability = 50;
      label = "Unlikely";
      reasoning.push(`⚖️ Mid-seniority pilot (${seniorityPercentile.toFixed(1)}th percentile)`);
      
      // Higher chance for less desirable trips
      if (desirabilityScore < 50) {
        baseProbability = 75;
        label = "Likely";
        reasoning.push("✅ Less desirable pairing - better chance to hold");
      }
      // Lower chance for desirable trips
      else if (desirabilityScore > 75) {
        baseProbability = 25;
        label = "Very Unlikely";
        reasoning.push("❌ Desirable pairing - senior pilots will take it");
      }
    }
    // Junior-mid pilots (50-75%) - Lower hold probability
    else if (seniorityPercentile <= 75) {
      baseProbability = 25;
      label = "Very Unlikely";
      reasoning.push(`❌ Junior-mid pilot (${seniorityPercentile.toFixed(1)}th percentile) - tough competition`);
      
      // Only good chance for undesirable trips
      if (desirabilityScore < 40 && pairingFrequency >= 3) {
        baseProbability = 75;
        label = "Likely";
        reasoning.push("✅ Undesirable pairing with multiple instances - good chance");
      }
      else if (desirabilityScore < 55) {
        baseProbability = 50;
        label = "Unlikely";
        reasoning.push("⚖️ Moderately undesirable pairing - some chance");
      }
    }
    // Very junior pilots (75%+) - Very low hold probability
    else {
      baseProbability = 10;
      label = "Very Unlikely";
      reasoning.push(`❌ Very junior pilot (${seniorityPercentile.toFixed(1)}th percentile) - extremely tough competition`);
      
      // Only decent chance for very undesirable, frequent trips
      if (desirabilityScore < 30 && pairingFrequency >= 4 && startsOnWeekend && includesDeadheads >= 2) {
        baseProbability = 50;
        label = "Unlikely";
        reasoning.push("⚖️ Very undesirable frequent pairing - some hope");
      }
      else if (desirabilityScore < 40 && pairingFrequency >= 3) {
        baseProbability = 25;
        label = "Very Unlikely";
        reasoning.push("⚠️ Undesirable frequent pairing - slight chance");
      }
    }

    // Minor adjustments for pairing characteristics
    if (pairingFrequency >= 4) {
      reasoning.push("• Frequent pairing (+5% boost)");
    }
    if (includesDeadheads >= 3) {
      reasoning.push("• Many deadheads - less competition");
    }
    if (startsOnWeekend && seniorityPercentile > 50) {
      reasoning.push("• Weekend start - less popular with senior pilots");
    }

    // Add small randomization (±3%) for realism
    const randomAdjustment = (Math.random() - 0.5) * 6; // -3 to +3
    const finalProbability = Math.max(0, Math.min(100, baseProbability + randomAdjustment));
    
    // Round to nearest 5% for more granular display
    const roundedProbability = Math.round(finalProbability / 5) * 5;

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
