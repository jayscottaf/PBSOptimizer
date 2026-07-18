/** Single source of truth for PBS jargon shown to newer bidders.
 *  Rendered via <Term> (dotted-underline tooltip). */
export const GLOSSARY: Record<string, string> = {
  pairing:
    'A sequence of flights flown as one trip, from base check-in to release back at base.',
  rotation:
    'Delta’s name for a pairing — the 4-digit number you bid on in PBS.',
  'hold probability':
    'Estimated chance the pairing is still available at your seniority when PBS reaches your bid.',
  credit:
    'Hours you are paid for the trip, in HH.MM (15.45 = 15h 45m). Usually more than block time.',
  block:
    'Scheduled flying time (brake release to parking), in HH.MM.',
  TAFB:
    'Time Away From Base — check-in to release, the full time you are away on the trip.',
  'C/B ratio':
    'Credit ÷ block. Higher means more pay per hour actually flown.',
  layover:
    'An overnight stay away from base between duty days of a pairing.',
  deadhead:
    'A repositioning flight you ride as a passenger — still on duty and paid.',
  seniority:
    'Your rank in the bidding category. Lower percentile = more senior = better odds.',
  ALV:
    'Average Line Value — the credit target PBS builds each pilot’s month toward.',
  'credit window':
    'The min–max credit range a legal monthly line must land inside.',
  'carry-out':
    'A trip that ends in the next bid period — some pilots avoid these to protect days off.',
  'prefer off':
    'A PBS preference asking for specific dates off. In Denial Mode PBS drops dates from the end of your list first.',
  'denial mode':
    'What PBS does when your bid can’t complete a legal line: it relaxes your preferences step by step until one fits.',
};

export function defineTerm(term: string): string | undefined {
  return GLOSSARY[term] ?? GLOSSARY[term.toLowerCase()];
}
