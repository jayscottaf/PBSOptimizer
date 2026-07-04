import { simulateBid } from '../server/lib/bidSimulator';
import { exportBid } from '../server/lib/bidExporter';
import { executeCoachTool } from '../server/ai/coachTools';
import { ReasonsReportParser } from '../server/reasonsReportParser';
import {
  computeEmpiricalHold,
  percentileWithin,
  normalizeMonth3,
} from '../server/lib/empiricalHold';
import { extractBaseAndAircraft } from '../server/lib/packageHeader';
import type { DraftBid } from '../shared/bidTypes';

let failures = 0;
function assert(cond: boolean, label: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures++;
}

// Synthetic package: 3-day MIA trips, 4-day BOS trips, a redeye-ish 2-day
const pairings = [
  { pairingNumber: '7601', creditHours: '18.50', blockHours: '15.00', pairingDays: 3, holdProbability: 80, deadheads: 0, checkInTime: '09.30', layovers: [{ city: 'MIA', duration: '14' }], effectiveDates: 'AUG03-AUG20' },
  { pairingNumber: '7602', creditHours: '19.00', blockHours: '16.00', pairingDays: 3, holdProbability: 60, deadheads: 0, checkInTime: '10.00', layovers: [{ city: 'MIA', duration: '15' }], effectiveDates: 'AUG05-AUG25' },
  { pairingNumber: '7603', creditHours: '24.00', blockHours: '20.00', pairingDays: 4, holdProbability: 90, deadheads: 1, checkInTime: '06.00', layovers: [{ city: 'BOS', duration: '12' }], effectiveDates: 'AUG10 ONLY' },
  { pairingNumber: '7604', creditHours: '25.00', blockHours: '21.00', pairingDays: 4, holdProbability: 40, deadheads: 0, checkInTime: '13.45', layovers: [{ city: 'BOS', duration: '13' }], effectiveDates: 'AUG12-AUG28' },
  { pairingNumber: '7605', creditHours: '12.00', blockHours: '11.00', pairingDays: 2, holdProbability: 95, deadheads: 2, checkInTime: '22.00', layovers: [{ city: 'CVG', duration: '10' }], effectiveDates: 'AUG01-AUG30' },
];

// 1) Avoid removes MIA from a later generic Award (negatives scope everything after)
const bid1: DraftBid = {
  groups: [
    {
      type: 'pairings',
      preferences: [
        { type: 'avoid', filter: { layoverCities: ['MIA'] } },
        { type: 'award' },
      ],
    },
  ],
};
const r1 = simulateBid(bid1, pairings, { alv: 40, threshold: 30 });
assert(!r1.awards.some(a => ['7601', '7602'].includes(a.pairingNumber)), 'Avoid MIA removes MIA pairings from later Award');
assert(r1.awards.length > 0, 'generic Award still takes non-MIA pairings');

// 2) Limit caps a single preference
const bid2: DraftBid = {
  groups: [
    {
      type: 'pairings',
      preferences: [
        { type: 'award', filter: { pairingDaysMin: 3, pairingDaysMax: 4 }, limit: 1 },
      ],
    },
  ],
};
const r2 = simulateBid(bid2, pairings, { alv: 60, threshold: 55 });
assert(r2.awards.length === 1, 'Limit 1 caps awards from the preference');
assert(r2.awards[0].pairingNumber === '7603', 'highest hold probability taken first');

// 3) Threshold stops awarding (award until credit > threshold)
const bid3: DraftBid = {
  groups: [
    { type: 'pairings', preferences: [{ type: 'award' }] },
  ],
};
const r3 = simulateBid(bid3, pairings, { alv: 30, threshold: 20 });
assert(r3.totalCredit > 20, 'awards until threshold passed');
assert(r3.totalCredit < 60, 'stops after threshold instead of taking everything');

// 4) Prefer Off removes trips touching the date
const bid4: DraftBid = {
  groups: [
    {
      type: 'pairings',
      preferences: [
        { type: 'preferOff', preferOffDates: ['2026-08-10'] },
        { type: 'award' },
      ],
    },
  ],
};
const r4 = simulateBid(bid4, pairings, { alv: 90, threshold: 85 });
assert(!r4.awards.some(a => a.pairingNumber === '7603'), 'Prefer Off Aug 10 removes the AUG10-only trip');

// 5) Expected credit is probability-weighted and below total
assert(r3.expectedCredit < r3.totalCredit, 'expectedCredit discounts by hold probability');

// 6) Caveats always present
assert(r1.caveats.some(c => c.includes('Denial Mode')), 'caveats mention unmodeled Denial Mode');

// 7) Exporter renders and validates
const bid5: DraftBid = {
  groups: [
    {
      type: 'pairings',
      preferences: [
        { type: 'setConditionCredit', creditWindow: 'max' },
        { type: 'preferOff', preferOffDates: ['2026-08-24', '2026-08-25'] },
        { type: 'avoid', filter: { layoverCities: ['MIA'] }, elseStartNext: true },
        { type: 'award', filter: { pairingDaysMin: 3, pairingDaysMax: 3, layoverCities: ['BOS'] }, limit: 2 },
        { type: 'award' },
      ],
    },
    { type: 'reserve', preferences: [] },
  ],
};
const e1 = exportBid(bid5);
console.log('--- exported bid ---');
console.log(e1.text);
console.log('--- warnings ---');
console.log(e1.warnings.join('\n') || '(none)');
assert(e1.lines[0] === 'Start Pairings', 'export starts pairing group');
assert(e1.lines.includes('Set Condition Maximum Credit'), 'set condition rendered');
assert(e1.lines.some(l => l === 'Avoid Pairings If Layovers In MIA Else Start Next Bid Group'), 'avoid with ESN rendered');
assert(e1.lines.some(l => l.startsWith('Award Pairings If Pairing Length = 3 Days If Layovers In BOS Limit 2')), 'award with conditions and limit rendered');
assert(e1.lines.includes('Start Reserve'), 'reserve group rendered');
assert(e1.warnings.length === 0, 'well-formed bid has no warnings');

// 8) Validation catches structure mistakes
const bad: DraftBid = {
  groups: [
    { type: 'pairings', preferences: [{ type: 'award' }] }, // no exit, not last
    { type: 'pairings', preferences: [{ type: 'clearScheduleStartNext' }, { type: 'award' }] }, // CSSN not last within group + Start Next in last group
  ],
};
const e2 = exportBid(bad);
assert(e2.warnings.some(w => w.includes('Else Start Next or Clear Schedule')), 'warns on missing exit in non-last group');
assert(e2.warnings.some(w => w.includes('never place a Start Next in the last bid group')), 'warns on Start Next in last group');
assert(e2.warnings.some(w => w.includes('forced to the bottom')), 'warns on CSSN not last in its group');
assert(e2.warnings.some(w => w.includes('No reserve bid group')), 'warns on missing reserve group');

// 9) Coach tool executor: valid call, bad JSON, malformed bid
const toolCtx = { pairings, alv: 40 };
const sim = (await executeCoachTool(
  'simulate_bid',
  JSON.stringify({ bid: bid1, alv: 40 }),
  toolCtx
)) as any;
assert(
  typeof sim.totalCredit === 'number' && Array.isArray(sim.caveats),
  'executeCoachTool simulate_bid returns compact result'
);
const exp = (await executeCoachTool('export_bid', JSON.stringify({ bid: bid5 }), toolCtx)) as any;
assert(
  typeof exp.text === 'string' && exp.text.includes('Start Pairings'),
  'executeCoachTool export_bid returns text'
);
const badJson = (await executeCoachTool('simulate_bid', '{not json', toolCtx)) as any;
assert(!!badJson.error, 'executeCoachTool reports bad JSON as error, not throw');
const badBid = (await executeCoachTool('simulate_bid', '{"bid": {"nope": true}}', toolCtx)) as any;
assert(!!badBid.error, 'executeCoachTool reports malformed bid as error');
const unknownTool = (await executeCoachTool('do_magic', '{"bid":{"groups":[]}}', toolCtx)) as any;
assert(!!unknownTool.error, 'executeCoachTool rejects unknown tool names');

// 9b) query_historic_trends: requires an injected fetcher, passes month arg through
const noFetcherCtx = { pairings, alv: 40 };
const noFetcherResult = (await executeCoachTool(
  'query_historic_trends',
  '{}',
  noFetcherCtx
)) as any;
assert(
  !!noFetcherResult.error,
  'query_historic_trends without an injected fetcher reports an error, not a crash'
);
let capturedMonth: string | undefined;
const fetcherCtx = {
  pairings,
  alv: 40,
  fetchHistoricTrends: async (month?: string) => {
    capturedMonth = month;
    return { periodsCovered: 18, avgPctPreferencesLostToSeniorBidders: 19 };
  },
};
const trendsResult = (await executeCoachTool(
  'query_historic_trends',
  JSON.stringify({ month: 'AUG' }),
  fetcherCtx
)) as any;
assert(
  capturedMonth === 'AUG' && trendsResult.periodsCovered === 18,
  'query_historic_trends threads the month argument into the injected fetcher and returns its digest'
);

// 10) Reasons pane parser against the real composite export format
// (NYC-220-B JUL 2026): NBSP spacing, per-pilot sections, real vocabulary.
const NB = '\u00A0';
const pad = (s: string) => s.replace(/ /g, NB);
const compositeFixture = `<html><head><title>NYC-220-B JUL${NB}2026 Composite Report</title></head><body>
${pad('Seniority            05105      Category NYC-220-B            GRENIER  084785700')}<br />
${pad('Minimum window ')}&lt;062:00&gt;${pad('   Threshold ')}&lt;082:00&gt;${pad('             Maximum window ')}&lt;082:00&gt;<br />
${pad('Category:1/176 Regular:1/139 Reserve:0(above)/37')}<br />
Pre-Awards<br />
<SPAN Class="PBSEvent">${pad('  7781       2026-06-21 15:40    2026-06-25 15:01 (000:00)  ')}</SPAN><br />
&lt;&lt;${pad(' Current Bid ')}&gt;&gt;<br />
${pad('   1.   Pairing Bid Group')}<br />
${pad('   2.     Avoid Pairings If Pairing Total Credit ')}&gt;${pad(' 000:00')}<br />
${pad('   Honored')}<br />
${pad('   3.     Prefer Off Jul 2, 2026, Jul 3, 2026')}<br />
${pad('   Honored')}<br />
${pad('          Award Pairings')}<br />
${pad('   Filtered by bid number 2: 494')}<br />
${pad('  (0 Awarded, 494 Matching, Running total: 064:10)')}<br />
--------------------------------------------------------------------------------<br />
${pad('Seniority            07014      Category NYC-220-B            LIGOCKI  061806300')}<br />
${pad('Minimum window ')}&lt;062:00&gt;${pad('   Threshold ')}&lt;062:00&gt;${pad('             Maximum window ')}&lt;072:00&gt;<br />
${pad('   6.     Award Pairings If Pairing Number 7773 Departing On Jul 7, 2026')}<br />
<SPAN Class="PBSEvent">${pad('  7773       2026-07-07 14:45    2026-07-07 23:29 (006:23)   (B)')}</SPAN><br />
${pad('   Schedule is complete')}<br />
${pad('  (1 Awarded, 1 Matching, Running total: 065:58)')}<br />
</body></html>`;

const pane = ReasonsReportParser.parseReasonsPane(compositeFixture);
const grenierAvoid = pane.preferences.find(
  p => p.pilotSeniorityNumber === 5105 && p.preferenceNumber === 2
);
const ligockiAward = pane.preferences.find(
  p => p.pilotSeniorityNumber === 7014 && p.preferenceNumber === 6
);
assert(pane.preferences.length >= 3, 'composite fixture yields preferences');
assert(
  !!grenierAvoid && grenierAvoid.outcome === 'Honored',
  'NBSP-padded Avoid preference attributed to pilot 05105 and Honored'
);
assert(
  grenierAvoid?.pilotEmployeeNumber === '084785700' &&
    grenierAvoid?.pilotName === 'GRENIER',
  'pilot employee number and name captured from section header'
);
assert(
  grenierAvoid?.windowInfo === 'Window 062:00-082:00, Threshold 082:00',
  'per-pilot credit window and threshold captured'
);
assert(
  !!ligockiAward &&
    ligockiAward.outcome === 'Schedule is complete' &&
    ligockiAward.awardedPairingNumbers.length === 1 &&
    ligockiAward.awardedPairingNumbers[0] === '7773',
  'award event line yields pairing 7773 (and not date fragments like 2026)'
);
assert(
  !!ligockiAward?.outcomeDetail?.includes('(1 Awarded, 1 Matching'),
  'running-total stats line attached as outcome detail'
);
assert(
  pane.preferences.every(
    p =>
      !p.awardedPairingNumbers.includes('2026') &&
      !p.awardedPairingNumbers.includes('7781')
  ),
  'pre-award events and date years never leak into awarded pairings'
);
const metadata = ReasonsReportParser.extractMetadata(compositeFixture);
assert(
  metadata?.base === 'NYC' &&
    metadata?.aircraft === '220-B' &&
    metadata?.month === 'JUL' &&
    metadata?.year === 2026,
  'metadata extracted from NBSP-containing title'
);

// 11) Empirical hold probability: percentile math and period-curve logic
const roster = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
assert(percentileWithin(roster, 100) === 10, 'most senior roster member is 10th percentile');
assert(percentileWithin(roster, 1000) === 100, 'most junior roster member is 100th percentile');
assert(percentileWithin(roster, 550) === 50, 'mid-roster seniority is 50th percentile');
assert(normalizeMonth3('February') === 'FEB' && normalizeMonth3('NOV ') === 'NOV', 'month normalization handles full names and padding');

const rosters = new Map<string, number[]>([
  ['JUL-2024', roster],
  ['JUL-2025', roster],
  ['JAN-2026', roster],
  ['JUL-2026', roster],
]);
// Junior-most holders at 80th percentile (800) in three periods, 40th in one
const empMatches = [
  { seniorityNumber: 800, month: 'JUL', year: 2024, similarity: 90 },
  { seniorityNumber: 300, month: 'JUL', year: 2024, similarity: 90 },
  { seniorityNumber: 800, month: 'JUL', year: 2025, similarity: 85 },
  { seniorityNumber: 400, month: 'JAN', year: 2026, similarity: 80 },
  { seniorityNumber: 800, month: 'JUL', year: 2026, similarity: 95 },
];
const empSenior = computeEmpiricalHold({
  userPercentile: 50,
  matches: empMatches,
  rosters,
  bidMonth: 'July',
});
// 50th percentile beats the boundary in 3 of 4 periods → (3+1)/(4+2) = 67%
assert(empSenior !== null && empSenior.probability === 67, 'senior-enough pilot gets smoothed 3-of-4-period probability');
assert(!!empSenior?.reasoning.some(r => r.includes('JUL specifically')), 'seasonal same-month evidence noted in reasoning');
const empJunior = computeEmpiricalHold({
  userPercentile: 95,
  matches: empMatches,
  rosters,
  bidMonth: 'July',
});
// 95th percentile beats no boundary → (0+1)/(4+2) = 17%
assert(empJunior !== null && empJunior.probability === 17, 'too-junior pilot gets smoothed 0-of-4-period probability');
const empSparse = computeEmpiricalHold({
  userPercentile: 50,
  matches: empMatches.slice(0, 2), // one period only
  rosters,
});
assert(empSparse === null, 'fewer than 3 periods of evidence returns null (fall back to legacy model)');
const empLowSim = computeEmpiricalHold({
  userPercentile: 50,
  matches: empMatches.map(m => ({ ...m, similarity: 40 })),
  rosters,
});
assert(empLowSim === null, 'low-similarity evidence is ignored entirely');

// 10) Package header extraction - both real-world shapes
// Shape 1: pairings-section header (TXT extracts of the pairings section)
const txtShape = extractBaseAndAircraft(
  'NYC BASE               220 PILOT PAIRINGS \n#7652  SU  EFFECTIVE AUG03'
);
assert(
  txtShape?.base === 'NYC' && txtShape?.aircraft === '220',
  'extracts base/aircraft from pairings-section header (TXT shape)'
);
// Shape 2: PDF cover page (verbatim line layout from a real NYC 220 JUL 2026
// bid package PDF, where pdf-parse splits city/aircraft/title across lines)
const pdfShape = extractBaseAndAircraft(
  [
    '',
    ' 1 ',
    ' ',
    'NEW YORK CITY                      ',
    '220                                      July  ',
    'PILOT BID PACKAGE  2026 ',
    'July 02, 2026 – July 31, 2026 (30 days) ',
  ].join('\n')
);
assert(
  pdfShape?.base === 'NYC' && pdfShape?.aircraft === '220',
  'extracts base/aircraft from PDF cover page (real July 2026 layout)'
);
assert(
  extractBaseAndAircraft('hello world\nnothing here') === null,
  'returns null instead of guessing when no header is recognized'
);

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
