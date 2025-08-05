
import { db } from './db';
import { pairings } from '../shared/schema';

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
          console.log(`Updating pairing ${pairing.pairingNumber}: ${pairing.pairingDays} → ${correctDays} days`);
          
          await db
            .update(pairings)
            .set({ pairingDays: correctDays })
            .where(eq(pairings.id, pairing.id));
          
          updatedCount++;
        }
      } catch (error) {
        console.error(`Error processing pairing ${pairing.pairingNumber}:`, error);
        errorCount++;
      }
    }

    console.log(`Recalculation complete:`);
    console.log(`  - Total processed: ${allPairings.length}`);
    console.log(`  - Updated: ${updatedCount}`);
    console.log(`  - Errors: ${errorCount}`);
    console.log(`  - Unchanged: ${allPairings.length - updatedCount - errorCount}`);

  } catch (error) {
    console.error('Error during recalculation:', error);
  }
}

function calculatePairingDaysFromText(fullTextBlock: string): number {
  if (!fullTextBlock) return 1;

  // Extract flight segments to get unique days
  const flightSegments: string[] = [];
  const lines = fullTextBlock.split('\n');
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Match day patterns: "A    417    LGA 1300  BOS 1944  1.44"
    const dayFlightMatch = trimmedLine.match(/^([A-E])\s*(?:DH\s+)?(\d{3,4})\s+([A-Z]{3})\s+(\d{4})\s+([A-Z]{3})\s+(\d{4})(?:\*)?\s+(\d{1,2}\.\d{2})/);
    if (dayFlightMatch) {
      flightSegments.push(dayFlightMatch[1]); // Day letter
    }
  }

  // Get unique days from flight segments
  const uniqueDaysFromSegments = [...new Set(flightSegments)].sort();
  let calculatedDays = uniqueDaysFromSegments.length;

  // Also check for day patterns in the full text (some days might not have flights)
  const dayPatternMatches = fullTextBlock.match(/^([A-E])\s/gm);
  if (dayPatternMatches) {
    const textDays = [...new Set(dayPatternMatches.map(match => match.trim().charAt(0)))];
    const textDayCount = textDays.length;
    
    // Use the higher count
    if (textDayCount > calculatedDays) {
      calculatedDays = textDayCount;
    }
  }

  // Ensure minimum of 1 day
  return Math.max(calculatedDays, 1);
}

// Add missing import
import { eq } from 'drizzle-orm';

// Run the recalculation
recalculatePairingDays().catch(console.error);
