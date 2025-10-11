import { db } from './db.js';
import { pairings } from '../shared/schema.js';

/**
 * Recalculate pairing days for all pairings based on their full text blocks
 */
async function recalculatePairingDays() {
  console.log('Starting pairing days recalculation...');

  try {
    // Get all pairings
    const allPairings = await db.select().from(pairings);
    console.log(`Found ${allPairings.length} pairings to process`);

    let updatedCount = 0;
    let errorCount = 0;

    for (const pairing of allPairings) {
      try {
        // Calculate correct pairing days from full text block
        const correctDays = calculatePairingDaysFromText(pairing.fullTextBlock);

        if (correctDays !== pairing.pairingDays) {
          console.log(
            `Updating pairing ${pairing.pairingNumber}: ${pairing.pairingDays} → ${correctDays} days`
          );

          await db
            .update(pairings)
            .set({ pairingDays: correctDays })
            .where(eq(pairings.id, pairing.id));

          updatedCount++;
        }
      } catch (error) {
        console.error(
          `Error processing pairing ${pairing.pairingNumber}:`,
          error
        );
        errorCount++;
      }
    }

    console.log(`Recalculation complete:`);
    console.log(`  - Total processed: ${allPairings.length}`);
    console.log(`  - Updated: ${updatedCount}`);
    console.log(`  - Errors: ${errorCount}`);
    console.log(
      `  - Unchanged: ${allPairings.length - updatedCount - errorCount}`
    );
  } catch (error) {
    console.error('Error during recalculation:', error);
  }
}

function calculatePairingDaysFromText(fullTextBlock: string): number {
  if (!fullTextBlock) {
    return 1;
  }
  // Calculate pairing days based on the last (highest) day letter
  // This handles cases where there are long overnight layovers without flights
  let pairingDays = 1; // Default to 1 day minimum

  // Find all day letters mentioned in the full text block
  const dayPatternMatches = fullTextBlock.match(/^([A-E])\s/gm);
  if (dayPatternMatches) {
    const allDayLetters = dayPatternMatches.map(match =>
      match.trim().charAt(0)
    );
    const uniqueDayLetters = Array.from(new Set(allDayLetters)).sort();

    if (uniqueDayLetters.length > 0) {
      // Get the last (highest) day letter
      const lastDayLetter = uniqueDayLetters[uniqueDayLetters.length - 1];

      // Convert letter to number (A=1, B=2, C=3, D=4, E=5)
      pairingDays = lastDayLetter.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
    }
  }

  // Ensure minimum of 1 day
  return Math.max(pairingDays, 1);
}

// Add missing import
import { eq } from 'drizzle-orm';

// Run the recalculation
recalculatePairingDays().catch(console.error);
