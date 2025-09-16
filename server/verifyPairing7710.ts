
import { db } from './db';
import { pairings } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function verifyPairing7710() {
  try {
    const pairing = await db
      .select()
      .from(pairings)
      .where(eq(pairings.pairingNumber, '7710'))
      .limit(1);

    if (pairing.length > 0) {
      console.log('Pairing 7710 details:');
      console.log(`- Pairing Number: ${pairing[0].pairingNumber}`);
      console.log(`- Pairing Days: ${pairing[0].pairingDays}`);
      console.log(`- Credit Hours: ${pairing[0].creditHours}`);
      console.log(`- Block Hours: ${pairing[0].blockHours}`);
      console.log(`- Route: ${pairing[0].route}`);
      console.log(`- Full Text Block (first 200 chars): ${pairing[0].fullTextBlock?.substring(0, 200)}...`);
      
      // Check for day patterns in the full text
      const dayPatternMatches = pairing[0].fullTextBlock?.match(/^([A-E])\s/gm);
      if (dayPatternMatches) {
        const allDayLetters = dayPatternMatches.map(match => match.trim().charAt(0));
        const uniqueDayLetters = Array.from(new Set(allDayLetters)).sort();
        console.log(`- Day letters found: ${uniqueDayLetters.join(', ')}`);
        console.log(`- Last day letter: ${uniqueDayLetters[uniqueDayLetters.length - 1]}`);
        console.log(`- Calculated days: ${uniqueDayLetters[uniqueDayLetters.length - 1].charCodeAt(0) - 'A'.charCodeAt(0) + 1}`);
      }
    } else {
      console.log('Pairing 7710 not found in database');
    }
  } catch (error) {
    console.error('Error verifying pairing:', error);
  }
}

verifyPairing7710();
