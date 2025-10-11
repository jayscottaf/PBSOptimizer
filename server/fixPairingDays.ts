import { eq } from 'drizzle-orm';
import { db } from './db.js';
import { pairings } from '../shared/schema.js';

/**
 * Fix incorrect pairing days for specific pairings that were misclassified
 */
async function fixPairingDays() {
  console.log('Fixing pairing days for misclassified pairings...');

  // List of pairings that should be 4-day but are incorrectly marked as 3-day
  const pairingsToFix = [
    { pairingNumber: '8083', correctDays: 4 },
    { pairingNumber: '8161', correctDays: 4 },
  ];

  for (const pairing of pairingsToFix) {
    try {
      const result = await db
        .update(pairings)
        .set({ pairingDays: pairing.correctDays })
        .where(eq(pairings.pairingNumber, pairing.pairingNumber));

      console.log(
        `✅ Updated pairing ${pairing.pairingNumber} to ${pairing.correctDays} days`
      );
    } catch (error) {
      console.error(
        `❌ Failed to update pairing ${pairing.pairingNumber}:`,
        error
      );
    }
  }

  console.log('Pairing days correction complete!');
}

// Run the fix
fixPairingDays().catch(console.error);
