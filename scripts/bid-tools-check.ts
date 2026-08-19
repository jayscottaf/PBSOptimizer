import { simulateBid } from '../server/lib/bidSimulator';
import { exportBid } from '../server/lib/bidExporter';
import { learnProfile, neutralProfile } from '../server/lib/profileLearner';
import {
  optimizeBid,
  scorePairings,
  estimateCompletion,
} from '../server/lib/bidOptimizer';
import { bidToXml } from '../server/lib/bidXmlWriter';
import { executeCoachTool } from '../server/ai/coachTools';
import { ReasonsReportParser } from '../server/reasonsReportParser';
import {
  computeEmpiricalHold,
  percentileWithin,
  normalizeMonth3,
} from '../server/lib/empiricalHold';
import { extractBaseAndAircraft } from '../server/lib/packageHeader';
import { PDFParser } from '../server/pdfParser';
import { parseAircraftCode } from '../server/lib/aircraft';
import {
  parseEffectiveRangeText,
  parseOperatingDays,
} from '../shared/operatingDays';
import type { DraftBid } from '../shared/bidTypes';

let failures = 0;
function assert(cond: boolean, label: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures++;
}

// Synthetic package: 3-day MIA trips, 4-day BOS trips, a redeye-ish 2-day.
// flightSegments give each trip a check-in station (first departure) and
// departure times (7605 departs 22:30 = redeye). 7606 departs AUG30 for 3
// days = 1 carry-out day.
const pairings = [
  { pairingNumber: '7601', creditHours: '18.50', blockHours: '15.00', pairingDays: 3, holdProbability: 80, deadheads: 0, checkInTime: '09.30', layovers: [{ city: 'MIA', duration: '14' }], effectiveDates: 'AUG03-AUG20', flightSegments: [{ departure: 'JFK', departureTime: '0930' }] },
  { pairingNumber: '7602', creditHours: '19.00', blockHours: '16.00', pairingDays: 3, holdProbability: 60, deadheads: 0, checkInTime: '10.00', layovers: [{ city: 'MIA', duration: '15' }], effectiveDates: 'AUG05-AUG25', flightSegments: [{ departure: 'LGA', departureTime: '1000' }] },
  { pairingNumber: '7603', creditHours: '24.00', blockHours: '20.00', pairingDays: 4, holdProbability: 90, deadheads: 1, checkInTime: '06.00', layovers: [{ city: 'BOS', duration: '12' }], effectiveDates: 'AUG10 ONLY', flightSegments: [{ departure: 'EWR', departureTime: '0600' }] },
  { pairingNumber: '7604', creditHours: '25.00', blockHours: '21.00', pairingDays: 4, holdProbability: 40, deadheads: 0, checkInTime: '13.45', layovers: [{ city: 'BOS', duration: '13' }], effectiveDates: 'AUG12-AUG28', flightSegments: [{ departure: 'JFK', departureTime: '1345' }] },
  { pairingNumber: '7605', creditHours: '12.00', blockHours: '11.00', pairingDays: 2, holdProbability: 95, deadheads: 2, checkInTime: '22.00', layovers: [{ city: 'CVG', duration: '10' }], effectiveDates: 'AUG01-AUG30', flightSegments: [{ departure: 'LGA', departureTime: '2230' }] },
  { pairingNumber: '7606', creditHours: '17.00', blockHours: '14.00', pairingDays: 3, holdProbability: 30, deadheads: 0, checkInTime: '08.00', layovers: [{ city: 'SLC', duration: '20' }], effectiveDates: 'AUG30 ONLY', flightSegments: [{ departure: 'JFK', departureTime: '0800' }] },
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

// 8b) Tier-1 grammar: new simulator filters. High threshold so every
// matching pairing is awarded (no early stop), then check the set.
const awardedWith = (filter: any): string[] => {
  const b: DraftBid = {
    groups: [{ type: 'pairings', preferences: [{ type: 'award', filter }] }],
  };
  return simulateBid(b, pairings, { alv: 999, threshold: 999 }).awards
    .map(a => a.pairingNumber)
    .sort();
};
// 7605 has ADB 11/2=5.5, the only one >=5.4 (others 5.0-5.33)
assert(awardedWith({ averageDailyBlockMin: 5.4 }).join() === '7605', 'averageDailyBlockMin filters');
// exclude MIA drops 7601/7602
assert(!awardedWith({ excludeLayoverCities: ['MIA'] }).some(n => ['7601', '7602'].includes(n)), 'excludeLayoverCities removes MIA trips');
// only 7605 has 2 deadheads
assert(awardedWith({ deadheadsMin: 2 }).join() === '7605', 'deadheadsMin requires >= 2 DH');
// layover totals: 7601=14h, 7602=15h, 7606=20h → >=14
assert(awardedWith({ totalLayoverHoursMin: 14 }).join() === '7601,7602,7606', 'totalLayoverHoursMin filters');
// every fixture has exactly one layover
assert(awardedWith({ layoverCountMax: 0 }).length === 0, 'layoverCountMax 0 excludes all one-layover trips');

// 8c) Tier-1 exporter: real NAVBLUE conditions, no [app-only] notes
const e3 = exportBid({
  groups: [
    {
      type: 'pairings',
      preferences: [
        {
          type: 'award',
          filter: {
            averageDailyBlockMin: 5,
            blockMin: 12,
            deadheadsMin: 1,
            deadheadsMax: 2,
            excludeLayoverCities: ['ORD'],
            totalLayoverHoursMin: 10,
            layoverCountMax: 2,
          },
        },
      ],
    },
    { type: 'reserve', preferences: [] },
  ],
});
const e3text = e3.text;
assert(!e3text.includes('[app-only'), 'exporter emits no [app-only] notes for Tier-1 fields');
assert(e3text.includes('Average Daily Block Time > 5:00'), 'exports Average Daily Block Time');
assert(e3text.includes('Block Time > 12:00'), 'exports real Block Time condition');
assert(e3text.includes('Deadhead Day'), 'exports Deadhead Day for deadheadsMin 1');
assert(e3text.includes('Not Any Layover In ORD'), 'exports Not Any Layover In');
assert(e3text.includes('Total Layover Time > 10:00'), 'exports Total Layover Time');
assert(e3text.includes('Number Of Layovers < 2'), 'exports Number Of Layovers');

// 8d) Derived properties: check-in station, redeye, carry-out
assert(awardedWith({ checkInStations: ['EWR'] }).join() === '7603', 'checkInStations matches first-segment departure');
assert(awardedWith({ hasRedeye: true }).join() === '7605', 'hasRedeye true requires a 22:00-04:59 departure');
assert(!awardedWith({ hasRedeye: false }).includes('7605'), 'hasRedeye false excludes redeye trips');
assert(awardedWith({ carryOutMin: 1 }).join() === '7606', 'carryOutMin finds the AUG30 3-day trip (1 day into SEP)');
assert(!awardedWith({ carryOutMax: 0 }).includes('7606'), 'carryOutMax 0 excludes carry-out trips');

// 8e) Set Condition Pattern: exact export text + not-simulated caveat
const patternBid: DraftBid = {
  groups: [
    {
      type: 'pairings',
      preferences: [
        {
          type: 'setConditionPattern',
          patternDaysOnMin: 3,
          patternDaysOnMax: 6,
          patternDaysOffMin: 5,
          elseStartNext: true,
        },
        { type: 'award' },
      ],
    },
    { type: 'reserve', preferences: [] },
  ],
};
const ep = exportBid(patternBid);
assert(
  ep.lines.includes(
    'Set Condition Pattern Between 3 And 6 Days On ,With 5 Days Off (Minimum) Else Start Next Bid Group'
  ),
  'Pattern exports verbatim NAVBLUE text (including " ,With" spacing)'
);
const rp = simulateBid(patternBid, pairings, { alv: 40, threshold: 30 });
assert(
  rp.caveats.some(c => c.includes('Pattern')),
  'Pattern adds a not-scored caveat to simulation'
);
assert(
  rp.groupResults[0].preferenceOutcomes.some(
    o => o.status === 'notScored' && o.detail.includes('bid-period')
  ),
  'Pattern preference marked notScored without a bid-period anchor'
);
// Set Condition after an Award warns
const latePattern = exportBid({
  groups: [
    {
      type: 'pairings',
      preferences: [
        { type: 'award' },
        { type: 'setConditionPattern', patternDaysOnMin: 3, patternDaysOnMax: 6, patternDaysOffMin: 4 },
      ],
    },
    { type: 'reserve', preferences: [] },
  ],
});
assert(
  latePattern.warnings.some(w => w.includes('forced above Award')),
  'Pattern after Award triggers placement warning'
);

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

// 12) Profile learner: pure, neutral without history, learns recurring
// signals only from the given pilot's own rows.
{
  const empty = learnProfile([], 0);
  assert(
    JSON.stringify(empty.weights) === JSON.stringify(neutralProfile()),
    'learner returns neutral profile with zero history'
  );

  // Synthetic pilot across 6 periods: always avoids ORD check-in and
  // carry-out, max credit window, pattern 3-6/5, awards SEA layovers in
  // 4 periods, avoids MSP in 3, prefers off weekends. A one-off avoid of
  // BUF (single period) must NOT become a learned dislike.
  const mkPeriod = (month: string) => [
    { preferenceText: 'Avoid Pairings If Pairing Check-In Station ORD', outcome: 'Honored', month, year: 2026 },
    { preferenceText: 'Avoid Pairings If Carry Out > 0 Days', outcome: 'Honored', month, year: 2026 },
    { preferenceText: 'Set Condition Maximum Credit Window', outcome: 'Honored', month, year: 2026 },
    { preferenceText: 'Set Condition Pattern Between 3 And 6 Days On ,With 5 Days Off (Minimum)', outcome: 'Honored', month, year: 2026 },
    { preferenceText: 'Award Pairings If Pairing Length = 3 Days', outcome: 'Honored', month, year: 2026 },
  ];
  const rows = [
    ...['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN'].flatMap(mkPeriod),
    ...['JAN', 'FEB', 'MAR', 'APR'].map(month => ({
      preferenceText: 'Award Pairings If Layovers In SEA, SAN',
      outcome: 'Honored', month, year: 2026,
    })),
    ...['JAN', 'FEB', 'MAR'].map(month => ({
      preferenceText: 'Avoid Pairings If Layovers In MSP',
      outcome: 'Honored', month, year: 2026,
    })),
    { preferenceText: 'Avoid Pairings If Layovers In BUF', outcome: 'Honored', month: 'JUN', year: 2026 },
    // Prefer Off: Feb 7/8 2026 = Sat/Sun; Feb 10 = Tue
    { preferenceText: 'Prefer Off Feb 7, 2026, Feb 8, 2026, Feb 10, 2026', outcome: 'Honored', month: 'FEB', year: 2026 },
  ];
  const { weights } = learnProfile(rows, 6);
  assert(weights.checkInStationAvoids.join() === 'ORD', 'learner finds recurring check-in station avoid');
  assert(weights.avoidsCarryOut === true, 'learner flags carry-out avoidance');
  assert(weights.creditLeaning > 0.5, 'max-credit windows push creditLeaning positive');
  assert(
    JSON.stringify(weights.preferredPattern) === JSON.stringify({ daysOnMin: 3, daysOnMax: 6, daysOffMin: 5 }),
    'learner extracts the recurring pattern'
  );
  assert(weights.layoverLikes.includes('SEA') && weights.layoverLikes.includes('SAN'), 'learner finds liked layovers');
  assert(weights.layoverDislikes.includes('MSP'), 'learner finds disliked layovers');
  assert(!weights.layoverDislikes.includes('BUF'), 'one-off avoid does not become a learned dislike');
  assert(weights.preferredTripLengths[0] === 3, 'learner ranks preferred trip length');
  assert(Math.abs(weights.preferOffWeekendShare - 2 / 3) < 0.01, 'weekend share of Prefer Off dates computed');
}

// 13) Optimizer: profile-driven, structurally valid, cascades on risk
{
  const profile = {
    ...neutralProfile(),
    creditLeaning: -0.8, // QoL bidder
    layoverLikes: ['BOS'],
    layoverDislikes: ['CVG'],
    checkInStationAvoids: ['EWR'],
    avoidsCarryOut: true,
    preferredPattern: { daysOnMin: 3, daysOnMax: 6, daysOffMin: 5 },
    preferredTripLengths: [4, 3],
  };

  // Scoring: BOS 4-day trips should outrank the CVG redeye 2-day for
  // this QoL profile even though credit/day differs.
  const scored = scorePairings(pairings, profile);
  assert(scored[0].pairingDays === 4 && scored[0].pairingNumber !== '7605', 'QoL profile ranks liked 4-day BOS trips first');
  const cvg = scored.find(s => s.pairingNumber === '7605');
  assert(!!cvg && cvg.score < scored[0].score, 'disliked-layover trip scores lower');

  // Completion estimator: tiny pool vs huge threshold → low; boundaries
  // kill unreachable lengths.
  const full = estimateCompletion(scored, 40);
  const starved = estimateCompletion(scored, 400);
  assert(full > starved, 'completion estimate falls as threshold rises');
  const boundaried = estimateCompletion(scored, 40, 90, [
    { pairingDays: 4, juniorMostPercentile: 50 },
    { pairingDays: 3, juniorMostPercentile: 50 },
  ]);
  assert(boundaried < full, 'hold boundaries reduce completion for junior pilots');

  // Full optimize: senior pilot → short cascade; junior → longer ladder.
  const senior = optimizeBid(pairings, profile, {
    seniorityPercentile: 10,
    threshold: 40,
  });
  const junior = optimizeBid(pairings, profile, {
    seniorityPercentile: 95,
    threshold: 400,
    holdBoundaries: [{ pairingDays: 4, juniorMostPercentile: 50 }],
  });
  const seniorPairingGroups = senior.bid.groups.filter(g => g.type === 'pairings').length;
  const juniorPairingGroups = junior.bid.groups.filter(g => g.type === 'pairings').length;
  assert(juniorPairingGroups > seniorPairingGroups, 'junior/starved pilot gets a deeper cascade');
  assert(senior.bid.groups[senior.bid.groups.length - 1].type === 'reserve', 'optimizer appends reserve fallback group');

  // Structure: every non-last pairing group has an exit; exported bid
  // passes the validator with no warnings.
  const exportedOpt = exportBid(junior.bid);
  assert(exportedOpt.warnings.length === 0, 'optimized cascade passes exporter validation with zero warnings');
  assert(
    exportedOpt.lines.some(l => l.startsWith('Set Condition Pattern Between 3 And 6')),
    'optimized bid carries the pattern set-condition'
  );
  assert(
    exportedOpt.lines.some(l => l === 'Avoid Pairings If Pairing Check-In Station EWR'),
    'profile station avoid rendered as real NAVBLUE line'
  );
  assert(
    exportedOpt.lines.includes('Set Condition Minimum Credit Window') ||
      exportedOpt.lines.includes('Set Condition Minimum Credit'),
    'QoL leaning selects minimum credit window'
  );
  // Named top picks come before generic length tiers
  const firstAwardIdx = exportedOpt.lines.findIndex(l => l.startsWith('Award Pairings If Pairing Numbers'));
  const firstLengthIdx = exportedOpt.lines.findIndex(l => /^Award Pairings If Pairing Length = \d Days$/.test(l));
  assert(firstAwardIdx !== -1 && firstLengthIdx !== -1 && firstAwardIdx < firstLengthIdx, 'named top picks precede attribute tiers');

  // Simulation of the optimized bid runs clean end-to-end
  const simOpt = simulateBid(senior.bid, pairings, { alv: 40, threshold: 35 });
  assert(simOpt.awards.length > 0, 'optimized bid simulates with awards');

  // Neutral profile (new pilot, no history) still yields a valid bid
  const neutral = optimizeBid(pairings, neutralProfile(), { threshold: 40 });
  const neutralExport = exportBid(neutral.bid);
  assert(neutralExport.warnings.length === 0, 'neutral-profile bid is structurally valid (no hardcoded style leaks)');
  assert(
    !neutralExport.text.includes('EWR') && !neutralExport.text.includes('Pattern'),
    'neutral profile produces no station avoids or patterns — nothing hardcoded'
  );

  // --- Depth engine (seniority-adaptive cascade) ---

  // Fixture A: comfortable senior on auto keeps the legacy short cascade.
  assert(seniorPairingGroups <= 3, 'comfortable senior on auto keeps a short cascade (no regression)');

  // Explicit depth overrides.
  const compact = optimizeBid(pairings, profile, {
    seniorityPercentile: 95,
    threshold: 400,
    holdBoundaries: [{ pairingDays: 4, juniorMostPercentile: 50 }],
    depth: 'compact',
  });
  assert(
    compact.bid.groups.filter(g => g.type === 'pairings').length <= 3,
    'depth: compact caps the cascade at 3 pairing groups even for a starved pilot'
  );

  // Fixture B: the plug — 100% seniority, starved threshold → extended ladder.
  const plug = optimizeBid(pairings, profile, {
    seniorityPercentile: 100,
    threshold: 400,
    holdBoundaries: [{ pairingDays: 4, juniorMostPercentile: 50 }],
  });
  const plugGroups = plug.bid.groups.filter(g => g.type === 'pairings');
  assert(plugGroups.length >= 6, 'plug (100%, starved) gets the extended relaxation ladder on auto');
  assert(plug.bid.groups[plug.bid.groups.length - 1].type === 'reserve', 'plug cascade still ends in reserve');

  // Monotone looseness: pattern daysOffMin non-increasing then absent,
  // credit window present then dropped, avoid count non-increasing,
  // final pairings group is a bare any-pairing award.
  let sawNoPattern = false;
  let lastOffMin = Infinity;
  let sawNoCredit = false;
  let lastAvoids = Infinity;
  for (const g of plugGroups) {
    const pat = g.preferences.find(p => p.type === 'setConditionPattern');
    if (pat) {
      assert(!sawNoPattern, 'plug ladder never re-adds a pattern after dropping it');
      assert((pat.patternDaysOffMin ?? 0) <= lastOffMin, 'plug days-off ladder is non-increasing');
      lastOffMin = pat.patternDaysOffMin ?? 0;
    } else {
      sawNoPattern = true;
    }
    const credit = g.preferences.find(p => p.type === 'setConditionCredit');
    if (credit) {
      assert(!sawNoCredit, 'plug ladder never re-adds the credit window after dropping it');
    } else {
      sawNoCredit = true;
    }
    const avoids = g.preferences.filter(p => p.type === 'avoid').length;
    assert(avoids <= lastAvoids, 'plug avoid count is non-increasing down the ladder');
    lastAvoids = avoids;
  }
  assert(sawNoPattern && sawNoCredit, 'plug ladder eventually drops both the pattern and the credit window');
  const lastPlugGroup = plugGroups[plugGroups.length - 1];
  assert(
    lastPlugGroup.preferences.length === 1 &&
      lastPlugGroup.preferences[0].type === 'award' &&
      !lastPlugGroup.preferences[0].filter,
    'plug cascade ends in a bare any-pairing group'
  );
  assert(
    exportBid(plug.bid).warnings.length === 0,
    'plug extended cascade passes exporter validation with zero warnings'
  );

  // depth: deep forces the full ladder even for a comfortable senior.
  const deepSenior = optimizeBid(pairings, profile, {
    seniorityPercentile: 10,
    threshold: 40,
    depth: 'deep',
  });
  assert(
    deepSenior.bid.groups.filter(g => g.type === 'pairings').length >= 6,
    'depth: deep forces the extended ladder regardless of completion'
  );

  // Reachability floor: a great-fit pairing with hold < 20% is not named
  // for a starved pilot but is named for a comfortable senior.
  const withGhost = [
    ...pairings,
    { pairingNumber: '7699', creditHours: '24.50', blockHours: '20.00', pairingDays: 4, holdProbability: 5, deadheads: 0, checkInTime: '12.00', layovers: [{ city: 'BOS', duration: '30' }], effectiveDates: 'AUG15-AUG28', flightSegments: [{ departure: 'JFK', departureTime: '1200' }] },
  ];
  const namedNumbers = (bid: typeof plug.bid): string[] =>
    bid.groups
      .flatMap(g => g.preferences)
      .filter(p => p.type === 'award' && p.filter?.pairingNumbers)
      .flatMap(p => p.filter!.pairingNumbers!);
  const ghostJunior = optimizeBid(withGhost, profile, {
    seniorityPercentile: 100,
    threshold: 400,
  });
  const ghostSenior = optimizeBid(withGhost, profile, {
    seniorityPercentile: 10,
    threshold: 40,
  });
  assert(!namedNumbers(ghostJunior.bid).includes('7699'), 'junior named picks exclude unreachable (hold < 20%) pairings');
  assert(namedNumbers(ghostSenior.bid).includes('7699'), 'senior named picks still include the popular low-hold pairing');
  assert(
    ghostJunior.rationale.some(r => r.includes('hold')),
    'junior rationale explains the reachability re-rank'
  );

  // --- PBS Entry Assistant (guided transcription steps) ---
  {
    const assistBid: DraftBid = {
      groups: [
        {
          type: 'pairings',
          preferences: [
            {
              type: 'setConditionPattern',
              patternDaysOnMin: 3,
              patternDaysOnMax: 6,
              patternDaysOffMin: 4,
              elseStartNext: true,
            },
            { type: 'setConditionCredit', creditWindow: 'min' },
            {
              type: 'preferOff',
              preferOffDates: ['2026-08-15'],
              preferOffDOWs: [],
            },
            { type: 'preferOff', preferOffDOWs: ['Saturday', 'Sunday'] },
            {
              type: 'avoid',
              filter: {
                checkInStations: ['EWR'],
                hasRedeye: true,
                carryOutMin: 1,
              },
              elseStartNext: true,
            },
            {
              type: 'award',
              filter: { pairingNumbers: ['7601', '7603'] },
              limit: 2,
            },
            {
              type: 'award',
              filter: {
                pairingDaysMin: 3,
                pairingDaysMax: 3,
                layoverCities: ['BOS'],
                creditMin: 15,
                creditMax: 22,
                totalLayoverHoursMin: 20,
                departOnDOWs: ['Monday'],
              },
            },
            { type: 'award' },
          ],
        },
        {
          type: 'pairings',
          preferences: [
            { type: 'award' },
            { type: 'clearScheduleStartNext' },
          ],
        },
        { type: 'reserve', preferences: [] },
      ],
    };
    const assistExport = exportBid(assistBid);
    // One entry group per bid group, one step per rendered preference.
    assert(assistExport.entrySteps.length === assistBid.groups.length, 'entry assistant: one entry group per bid group');
    const prefCount = assistBid.groups.reduce((s, g) => s + g.preferences.length, 0);
    const stepCount = assistExport.entrySteps.reduce((s, g) => s + g.steps.length, 0);
    assert(stepCount === prefCount, 'entry assistant: one step per preference');
    // expectText is byte-identical to the exported lines, in order.
    const flatExpect = assistExport.entrySteps.flatMap(g => g.steps.map(s => s.expectText));
    const nonHeaderLines = assistExport.lines.filter(l => l !== 'Start Pairings' && l !== 'Start Reserve');
    assert(
      JSON.stringify(flatExpect) === JSON.stringify(nonHeaderLines),
      'entry assistant: step texts are byte-identical to exported lines, in order'
    );
    // Group actions carry the NAVBLUE group-start vocabulary.
    assert(assistExport.entrySteps[0].groupAction.includes('Start Pairings'), 'entry assistant: pairings group action');
    assert(assistExport.entrySteps[2].groupAction.includes('Start Reserve'), 'entry assistant: reserve group action');
    // Every step has actions, ending with the save-and-verify step, and
    // each preference type leads with its NAVBLUE label.
    for (const g of assistExport.entrySteps) {
      for (const s of g.steps) {
        assert(s.actions.length >= 2, 'entry assistant: every step has actions');
        assert(s.actions[s.actions.length - 1].startsWith('Save the line'), 'entry assistant: steps end with save-and-verify');
      }
    }
    const firstActions = assistExport.entrySteps[0].steps.map(s => s.actions[0]);
    assert(firstActions[0] === 'Preference type → Set Condition', 'entry assistant: set condition label');
    assert(firstActions[2] === 'Preference type → Prefer Off', 'entry assistant: prefer off label');
    assert(firstActions[4] === 'Preference type → Avoid Pairings', 'entry assistant: avoid label');
    assert(firstActions[5] === 'Preference type → Award Pairings', 'entry assistant: award label');
    // ESN toggles become explicit actions.
    assert(
      assistExport.entrySteps[0].steps[4].actions.some(a => a.includes('Else Start Next')),
      'entry assistant: ESN toggle action present'
    );

    // Optimizer-generated bids carry why notes; why never leaks into text.
    const whyBid = optimizeBid(pairings, profile, { seniorityPercentile: 10, threshold: 40 });
    const allPrefs = whyBid.bid.groups.flatMap(g => g.preferences);
    assert(allPrefs.some(p => p.why), 'optimizer annotates preferences with why notes');
    const strippedBid: DraftBid = {
      groups: whyBid.bid.groups.map(g => ({
        type: g.type,
        preferences: g.preferences.map(p => {
          const { why: _why, ...rest } = p;
          return rest as typeof p;
        }),
      })),
    };
    assert(
      exportBid(whyBid.bid).text === exportBid(strippedBid).text,
      'why notes never change the exported NAVBLUE text'
    );
    const whySteps = exportBid(whyBid.bid).entrySteps.flatMap(g => g.steps);
    assert(whySteps.some(s => s.why && s.why.length > 0), 'why notes flow into entry steps');
  }
}

// 14) Day-of-week constructs (from the live-bid XML capture)
{
  // Learner extracts recurring Prefer Off DOWs
  const dowRows = ['JAN', 'FEB', 'MAR', 'APR'].map(month => ({
    preferenceText: 'Prefer Off  Friday, Saturday, Sunday',
    outcome: 'Honored', month, year: 2026,
  }));
  const { weights: dw } = learnProfile(dowRows, 4);
  assert(
    JSON.stringify(dw.preferOffDOWs) === JSON.stringify(['Friday', 'Saturday', 'Sunday']),
    'learner extracts recurring Prefer Off day-of-week pattern'
  );

  // Exporter renders both DOW constructs with live-verified text
  const dowBid: DraftBid = {
    groups: [
      {
        type: 'pairings',
        preferences: [
          { type: 'preferOff', preferOffDOWs: ['Friday', 'Saturday', 'Sunday'] },
          {
            type: 'award',
            filter: { departOnDOWs: ['Monday', 'Tuesday'], pairingDaysMin: 3, pairingDaysMax: 3 },
          },
        ],
      },
      { type: 'reserve', preferences: [] },
    ],
  };
  const de = exportBid(dowBid);
  assert(
    de.lines.includes('Prefer Off  Friday, Saturday, Sunday'),
    'Prefer Off DOWs exported with live-verified double-space text'
  );
  assert(
    de.lines.some(l => l === 'Award Pairings If Pairing Length = 3 Days If Departing On Monday, Tuesday'),
    'Departing On weekdays exported inside award conditions'
  );

  // Simulator: DOW constructs surfaced as not-scored, never crash
  const ds = simulateBid(dowBid, pairings, { alv: 40, threshold: 30 });
  assert(
    ds.caveats.some(c => c.includes('Day-of-week')),
    'simulation carries a day-of-week not-scored caveat'
  );
  assert(
    ds.groupResults[0].preferenceOutcomes.some(
      o => o.status === 'notScored' && o.detail.includes('Weekday Prefer Off')
    ),
    'DOW Prefer Off marked notScored without a bid-period anchor'
  );

  // Optimizer emits the learned DOW prefer-off
  const dowProfile = { ...neutralProfile(), preferOffDOWs: ['Friday', 'Saturday', 'Sunday'] as any };
  const dopt = optimizeBid(pairings, dowProfile, { threshold: 40 });
  const doptLines = exportBid(dopt.bid).lines;
  assert(
    doptLines.includes('Prefer Off  Friday, Saturday, Sunday'),
    'optimizer emits recurring DOW prefer-off from profile'
  );
}

// 15) XML writer matches the captured live schema
{
  const xmlBid: DraftBid = {
    groups: [
      {
        type: 'pairings',
        preferences: [
          { type: 'setConditionPattern', patternDaysOnMin: 3, patternDaysOnMax: 6, patternDaysOffMin: 5 },
          { type: 'setConditionCredit', creditWindow: 'min' },
          { type: 'preferOff', preferOffDOWs: ['Friday', 'Saturday'] },
          { type: 'avoid', filter: { checkInStations: ['EWR'] }, elseStartNext: true },
          { type: 'avoid', filter: { carryOutMin: 1 } },
          {
            type: 'award',
            filter: {
              averageDailyBlockMin: 6.5,
              departOnDOWs: ['Monday', 'Tuesday'],
              pairingDaysMin: 1,
              pairingDaysMax: 1,
            },
          },
        ],
      },
      { type: 'reserve', preferences: [] },
    ],
  };
  const xml = bidToXml(xmlBid);
  const has = (frag: string, label: string) => assert(xml.includes(frag), label);
  has('<BidGroupType>StartPairings</BidGroupType>', 'XML: StartPairings group start');
  has('<BidGroupType>StartReserve</BidGroupType>', 'XML: StartReserve group start');
  has('<LineConditionType>Pattern</LineConditionType>', 'XML: Pattern line condition');
  has('<Pattern><NumberDays>5</NumberDays><NumberDaysRange><Start>3</Start><End>6</End></NumberDaysRange></Pattern>', 'XML: Pattern days-off + range encoded like live bid');
  has('<LineConditionType>MinimumCredit</LineConditionType>', 'XML: MinimumCredit window');
  has('<PreferOffType>PreferOffDOWs</PreferOffType>', 'XML: PreferOffDOWs type');
  has('<DOW>Friday</DOW>', 'XML: DOW element');
  has('<ElseStartNext><boolean>true</boolean></ElseStartNext>', 'XML: ElseStartNext boolean shape');
  has('<PairingPropertyType>CheckInBase</PairingPropertyType>', 'XML: CheckInBase property');
  has('<Station>EWR</Station>', 'XML: station element');
  has('<PairingPropertyType>CarryOut</PairingPropertyType>', 'XML: CarryOut property');
  has('<NumberDaysCondition><Operator>GT</Operator><Value>0</Value></NumberDaysCondition>', 'XML: carry-out GT 0 like live bid');
  has('<PairingPropertyType>AverageDailyBlockTime</PairingPropertyType>', 'XML: ADB property');
  has('<TimeIntervalCondition><Operator>GT</Operator><Time><Hour>006</Hour><Minute>30</Minute></Time></TimeIntervalCondition>', 'XML: time condition with zero-padded hour like live bid');
  has('<PairingPropertyType>StartOnDOWs</PairingPropertyType>', 'XML: StartOnDOWs property');
  has('<NumberDaysCondition><Operator>EQ</Operator><Value>1</Value></NumberDaysCondition>', 'XML: pairing length EQ');
}

// 16) optimize_bid coach tool dispatch (DI like the trends tool)
{
  const noCtx = (await executeCoachTool('optimize_bid', '{}', { pairings } as any)) as any;
  assert(typeof noCtx.error === 'string', 'optimize_bid without injected optimizer returns error, not crash');
  const fake = { called: null as any };
  const ctx = {
    pairings,
    optimizeDraft: async (ov?: any) => { fake.called = ov ?? null; return { ok: true, got: ov ?? null }; },
  } as any;
  const withOv = (await executeCoachTool('optimize_bid', JSON.stringify({ overrides: { creditLeaning: 1 } }), ctx)) as any;
  assert(withOv.ok === true && withOv.got?.creditLeaning === 1, 'optimize_bid threads overrides into injected optimizer');
}

// 17) Calendar-aware simulation (period anchor AUG 2026; Aug 1 = Saturday)
{
  const CAL = { periodMonth: 8, periodYear: 2026, alv: 999, threshold: 999 };
  const calAwards = (prefs: any[]): string[] =>
    simulateBid(
      { groups: [{ type: 'pairings', preferences: prefs }] } as DraftBid,
      pairings,
      CAL as any
    ).awards
      .map(a => a.pairingNumber)
      .sort();

  // departOnDOWs now scoreable: 7603 departs Mon Aug 10 ONLY; 7606 departs
  // Sun Aug 30 ONLY; range trips include Fridays so they survive a Friday
  // filter while both single-date trips are excluded.
  const fri = calAwards([{ type: 'award', filter: { departOnDOWs: ['Friday'] } }]);
  assert(!fri.includes('7603') && !fri.includes('7606'), 'departOnDOWs excludes single-date trips departing other weekdays');
  assert(fri.includes('7601') && fri.includes('7605'), 'departOnDOWs keeps range trips that include a Friday departure');
  const mon = calAwards([{ type: 'award', filter: { departOnDOWs: ['Monday'] } }]);
  assert(mon.includes('7603'), 'departOnDOWs matches the Monday-only trip');

  // Exact Prefer Off dates: old approx removed ANY-touching pairing; now a
  // range pairing survives if another operating date avoids the day off.
  // 7603 (AUG10 ONLY, 4d, Aug10-13) dies on a Aug 12 day off; 7601
  // (AUG03-AUG20 range) survives via other departures.
  const off12 = calAwards([
    { type: 'preferOff', preferOffDates: ['2026-08-12'] },
    { type: 'award' },
  ]);
  assert(!off12.includes('7603'), 'exact Prefer Off kills the single-date trip touching the day off');
  assert(off12.includes('7601'), 'exact Prefer Off keeps range trips with clear alternate dates');

  // DOW Prefer Off now scored: weekends off kills 7606 (Sun-only departure
  // spans Sun-Tue) but keeps 7603 (Mon-Thu) and range trips with midweek
  // instances.
  const wkndOff = calAwards([
    { type: 'preferOff', preferOffDOWs: ['Saturday', 'Sunday'] },
    { type: 'award' },
  ]);
  assert(!wkndOff.includes('7606'), 'weekend Prefer Off excludes the Sunday-departing trip');
  assert(wkndOff.includes('7603'), 'weekend Prefer Off keeps the Mon-Thu trip');
  assert(wkndOff.includes('7601'), 'weekend Prefer Off keeps range trips with midweek instances');

  // Placement check: single-date awards that collide are flagged; awards
  // that fit report feasible.
  const okPlace = simulateBid(
    {
      groups: [
        {
          type: 'pairings',
          preferences: [
            { type: 'award', filter: { pairingNumbers: ['7603', '7606'] } },
          ],
        },
      ],
    } as DraftBid,
    pairings,
    { periodMonth: 8, periodYear: 2026, alv: 45, threshold: 40 } as any
  );
  assert(okPlace.placement !== undefined, 'placement check present when period anchor given');
  assert(okPlace.placement!.feasible === true, 'non-overlapping single-date awards are placeable (Aug10-13 then Aug30+)');

  const noAnchor = simulateBid(
    { groups: [{ type: 'pairings', preferences: [{ type: 'award' }] }] } as DraftBid,
    pairings,
    { alv: 45, threshold: 40 }
  );
  assert(noAnchor.placement === undefined, 'no placement check without a period anchor');
  assert(
    noAnchor.caveats.some(c => c.includes('not checked')),
    'caveats stay conservative without the period anchor'
  );
  assert(
    okPlace.caveats.some(c => c.includes('calendar placement')),
    'caveats reflect calendar placement when anchored'
  );
}

// --- Set Condition Pattern: honor-or-cascade ------------------------------
// PBS reads top-down and must honor a Set Condition or fail the group. A
// calendar-aware group whose awards cannot place under its own Pattern must
// NOT complete — the cascade moves to the next group.
{
  const mkTrip = (n: string, days: number, eff: string, credit = '6.00') => ({
    pairingNumber: n,
    pairingDays: days,
    creditHours: credit,
    blockHours: '5.00',
    tafb: '30.00',
    holdProbability: '95',
    effectiveDates: eff,
    layovers: [],
    deadheads: 0,
    route: 'LGA-BOS',
    flightSegments: [
      { departure: 'LGA', arrival: 'BOS', departureTime: '0900' },
    ],
    checkInTime: '08.00',
  });
  // Widely spaced 1-day trips: none adjacent, so no stretch can reach a
  // 3-day minimum.
  const sparse = [
    mkTrip('9001', 1, 'SEP02', '15.00'),
    mkTrip('9002', 1, 'SEP10', '15.00'),
    mkTrip('9003', 1, 'SEP20', '15.00'),
  ];
  const cascadeBid = {
    groups: [
      {
        type: 'pairings',
        preferences: [
          {
            type: 'setConditionPattern',
            patternDaysOnMin: 3,
            patternDaysOnMax: 5,
            patternDaysOffMin: 2,
          },
          { type: 'award' },
        ],
      },
      { type: 'pairings', preferences: [{ type: 'award' }] },
    ],
  } as any;
  const cr = simulateBid(cascadeBid, sparse, {
    periodMonth: 9,
    periodYear: 2026,
    alv: 45,
    threshold: 40,
  });
  assert(
    cr.groupResults[0].placement?.feasible === false,
    'group 1 placement infeasible when no stretch can reach the Pattern minimum'
  );
  assert(
    cr.awards.length > 0 && cr.awards.every(a => a.groupIndex === 1),
    'cascade moves to group 2 when group 1 cannot honor its Pattern'
  );
  assert(
    cr.groupResults[0].preferenceOutcomes.some(
      o => o.status === 'denied' && o.detail.includes('minimum')
    ),
    'Pattern preference reported as denied with the stretch reason'
  );
  assert(
    cr.caveats.some(c => c.includes('cascade moved to the next group')),
    'cascade fallthrough is explained in caveats'
  );

  // Back-to-back trips CAN combine into a legal stretch: two adjacent 2-day
  // trips form one 4-day stretch, satisfying a 3-5 day Pattern.
  const adjacent = [
    mkTrip('9101', 2, 'SEP02', '20.00'), // Sep 2-3
    mkTrip('9102', 2, 'SEP04', '20.00'), // Sep 4-5 -> extends the stretch
  ];
  const okBid = {
    groups: [
      {
        type: 'pairings',
        preferences: [
          {
            type: 'setConditionPattern',
            patternDaysOnMin: 3,
            patternDaysOnMax: 5,
            patternDaysOffMin: 2,
          },
          { type: 'award' },
        ],
      },
    ],
  } as any;
  const ok = simulateBid(okBid, adjacent, {
    periodMonth: 9,
    periodYear: 2026,
    alv: 45,
    threshold: 35,
  });
  assert(
    ok.placement?.feasible === true,
    'adjacent short trips combine into one stretch that satisfies the Pattern'
  );
  assert(
    ok.groupResults[0].preferenceOutcomes.some(
      o => o.status === 'honored' && o.detail.includes('stretch')
    ),
    'Pattern preference reported as honored with the stretch breakdown'
  );

  // Reasons-Report-style outcomes: every preference gets a disposition.
  assert(
    ok.groupResults[0].preferenceOutcomes.length ===
      okBid.groups[0].preferences.length,
    'every preference in the group gets an outcome entry'
  );
  assert(
    ok.groupResults[0].preferenceOutcomes.some(
      o => o.status === 'honored' && o.detail.includes('Awarded')
    ),
    'award preference reports an honored outcome with counts'
  );
}

// --- Pattern-aware line construction --------------------------------------
// PBS constructs the line WITH the Set Condition as a constraint. The
// simulator must find combinations a pattern-blind pick would miss: e.g. a
// 4-day trip extended by an adjacent 1-day trip forms one legal 5-day
// stretch under a 5-18 day Pattern.
{
  const mkTrip = (n: string, days: number, eff: string, credit = '6.00') => ({
    pairingNumber: n,
    pairingDays: days,
    creditHours: credit,
    blockHours: '5.00',
    tafb: '30.00',
    holdProbability: '95',
    effectiveDates: eff,
    layovers: [],
    deadheads: 0,
    route: 'LGA-BOS',
    flightSegments: [
      { departure: 'LGA', arrival: 'BOS', departureTime: '0900' },
    ],
    checkInTime: '08.00',
  });
  const pattern518 = {
    type: 'setConditionPattern',
    patternDaysOnMin: 5,
    patternDaysOnMax: 18,
    patternDaysOffMin: 3,
  };

  // (a) The user's exact scenario: 4-day Sep 2-5 + 1-day Sep 6 = one 5-day
  // stretch; another pair later in the month. Both awards come from a
  // single broad preference.
  const comboTrips = [
    mkTrip('9201', 4, 'SEP02', '24.00'), // Sep 2-5
    mkTrip('9202', 1, 'SEP06', '8.00'), // Sep 6 -> extends to 5 days
    mkTrip('9203', 4, 'SEP12', '24.00'), // Sep 12-15
    mkTrip('9204', 1, 'SEP16', '8.00'), // Sep 16 -> extends to 5 days
  ];
  const comboBid = {
    groups: [
      { type: 'pairings', preferences: [pattern518, { type: 'award' }] },
    ],
  } as any;
  const combo = simulateBid(comboBid, comboTrips, {
    periodMonth: 9,
    periodYear: 2026,
    alv: 45,
    threshold: 40,
    windowMin: 60,
    windowMax: 70,
  });
  assert(
    combo.placement?.feasible === true,
    'construction combines 4-day + adjacent 1-day into a legal 5-day stretch'
  );
  assert(
    (combo.placement?.stretches ?? []).every(s => s >= 5 && s <= 18),
    'every constructed stretch is within the Pattern band'
  );
  assert(
    combo.awards.length === 4 && combo.totalCredit === 64,
    'construction uses all four trips to reach the window'
  );

  // Pulled-forward attribution: the 1-day extenders match only a LATER
  // preference, and the notes say they were added to complete a stretch.
  const tieredBid = {
    groups: [
      {
        type: 'pairings',
        preferences: [
          pattern518,
          { type: 'award', filter: { pairingDaysMin: 4 } },
          { type: 'award', filter: { pairingDaysMax: 1 } },
        ],
      },
    ],
  } as any;
  const tiered = simulateBid(tieredBid, comboTrips, {
    periodMonth: 9,
    periodYear: 2026,
    alv: 45,
    threshold: 40,
    windowMin: 60,
    windowMax: 70,
  });
  assert(
    tiered.placement?.feasible === true,
    'tiered preferences still construct legal stretches'
  );
  assert(
    tiered.groupResults[0].preferenceOutcomes.some(
      o => o.status === 'honored' && o.detail.includes('complete a work stretch')
    ),
    'later-preference trips used to legalize a stretch are called out'
  );
  assert(
    tiered.awards.some(
      a => a.pairingNumber === '9202' && a.awardedByPreference === 3
    ),
    'pulled-forward trip is attributed to its own preference'
  );

  // (b) Genuinely unbuildable: isolated 4-day trips, nothing adjacent.
  const sparse4 = [
    mkTrip('9301', 4, 'SEP02', '24.00'),
    mkTrip('9302', 4, 'SEP12', '24.00'),
    mkTrip('9303', 4, 'SEP22', '24.00'),
  ];
  const denied = simulateBid(
    {
      groups: [
        { type: 'pairings', preferences: [pattern518, { type: 'award' }] },
        { type: 'pairings', preferences: [{ type: 'award' }] },
      ],
    } as any,
    sparse4,
    { periodMonth: 9, periodYear: 2026, alv: 45, threshold: 40, windowMin: 60, windowMax: 70 }
  );
  assert(
    denied.groupResults[0].placement?.feasible === false,
    'isolated short trips cannot be constructed into the Pattern'
  );
  assert(
    (denied.groupResults[0].placement?.notes ?? []).some(n =>
      n.includes('Could not assemble')
    ),
    'denial says "could not assemble", never "impossible"'
  );
  assert(
    denied.awards.length > 0 && denied.awards.every(a => a.groupIndex === 1),
    'construction failure cascades to the next group'
  );

  // (e) Determinism: identical output on repeat and on shuffled input.
  const again = simulateBid(comboBid, comboTrips, {
    periodMonth: 9,
    periodYear: 2026,
    alv: 45,
    threshold: 40,
    windowMin: 60,
    windowMax: 70,
  });
  assert(
    JSON.stringify(again) === JSON.stringify(combo),
    'construction is deterministic across runs'
  );
  const shuffled = simulateBid(
    comboBid,
    [...comboTrips].reverse(),
    { periodMonth: 9, periodYear: 2026, alv: 45, threshold: 40, windowMin: 60, windowMax: 70 }
  );
  assert(
    JSON.stringify(shuffled.awards) === JSON.stringify(combo.awards),
    'construction is insensitive to input pairing order'
  );

  // A group WITHOUT a Set Condition Pattern must not be described as
  // failing one, and a date collision must cost the colliding trip rather
  // than the whole group: PBS awards what fits.
  const collide = [
    mkTrip('9501', 3, 'SEP02', '20.00'), // Sep 2-4
    mkTrip('9502', 3, 'SEP03', '20.00'), // Sep 3-5, overlaps 9501
    mkTrip('9503', 3, 'SEP10', '20.00'), // Sep 10-12, clear
    mkTrip('9504', 3, 'SEP20', '20.00'), // Sep 20-22, clear
  ];
  const noPat = simulateBid(
    { groups: [{ type: 'pairings', preferences: [{ type: 'award' }] }] } as any,
    collide,
    { periodMonth: 9, periodYear: 2026, alv: 45, threshold: 55, windowMin: 55, windowMax: 70 }
  );
  assert(
    noPat.placement?.feasible === true,
    'a date collision drops the colliding trip instead of failing the group'
  );
  assert(
    noPat.awards.length === 3 && noPat.totalCredit === 60,
    'the three non-overlapping trips are awarded (60 credit), the collider is not'
  );
  assert(
    (noPat.placement?.notes ?? []).some(n => n.includes('without overlapping')) &&
      !(noPat.placement?.notes ?? []).some(n => n.includes('Pattern')),
    'a group with no Set Condition Pattern is never described in Pattern terms'
  );

  // Same, when the group genuinely cannot be built: the caveat must name
  // the real constraint rather than a Pattern that was never bid.
  const tooThin = simulateBid(
    {
      groups: [
        { type: 'pairings', preferences: [{ type: 'award' }] },
        { type: 'pairings', preferences: [{ type: 'award' }] },
      ],
    } as any,
    [mkTrip('9601', 3, 'SEP02', '10.00')],
    { periodMonth: 9, periodYear: 2026, alv: 45, threshold: 60, windowMin: 60, windowMax: 70 }
  );
  assert(
    tooThin.caveats.some(
      c => c.includes('could not build a line from its awards') && !c.includes('Pattern')
    ),
    'cascade caveat names the real reason when the group has no Pattern'
  );

  // (d) No-Pattern groups keep the exact pre-construction behavior:
  // hold desc then credit desc greedy.
  const noPattern = simulateBid(
    { groups: [{ type: 'pairings', preferences: [{ type: 'award' }] }] } as any,
    [
      mkTrip('9401', 3, 'SEP02', '20.00'),
      mkTrip('9402', 3, 'SEP10', '22.00'),
      mkTrip('9403', 3, 'SEP20', '21.00'),
    ],
    { periodMonth: 9, periodYear: 2026, alv: 45, threshold: 40, windowMin: 40, windowMax: 70 }
  );
  // Equal hold -> credit desc; stops once credit (43) passes threshold (40)
  // before taking the third trip. Pins the untouched greedy path.
  assert(
    noPattern.awards.map(a => a.pairingNumber).join(',') === '9402,9403',
    'no-Pattern groups keep the hold-then-credit greedy order and stop rule'
  );
}

// --- Real operating days (weekday clause + EXCEPT dates) ------------------
// A pairing operates on a SUBSET of its effective range: the header names the
// weekdays it flies and a separate clause lists dates it skips. Treating the
// whole range as operable made Prefer Off falsely survive and let the line
// constructor place trips on dates they never fly.
{
  const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // The real #A227 header: TU TH SA, Aug 11-29, minus four dates.
  const a227 = [
    '#A227  TU TH SA        EFFECTIVE AUG11-AUG. 29               CHECK-IN AT 20.59  POS - B',
    '       EXCEPT AUG 13 AUG 15 AUG 20 AUG 22',
  ].join('\n');
  assert(
    parseEffectiveRangeText(a227) === 'AUG11-AUG. 29',
    'the "MON. DD" end day survives effective-range parsing'
  );
  const a227Days = parseOperatingDays(a227);
  assert(
    (a227Days.operatingDows ?? []).map(d => NAMES[d]).join(',') === 'Tue,Thu,Sat',
    'positive weekday clause "TU TH SA" resolves to exactly those days'
  );
  assert(
    a227Days.exceptDates.join('|') === 'AUG 13|AUG 15|AUG 20|AUG 22',
    'EXCEPT dates are parsed off the continuation line'
  );

  // End to end. Aug 2026 starts on a Saturday, so Tue/Thu/Sat between the
  // 11th and 29th are 11,13,15,18,20,22,25,27,29; the four EXCEPT dates
  // leave exactly five real operating starts: 11, 18, 25, 27, 29.
  const a227Pairing = {
    pairingNumber: 'A227',
    pairingDays: 2,
    creditHours: '16.00',
    blockHours: '16.00',
    tafb: '40.00',
    holdProbability: '95',
    effectiveDates: 'AUG11-AUG. 29',
    operatingDows: a227Days.operatingDows,
    exceptDates: a227Days.exceptDates,
    layovers: [{ city: 'AMS', duration: '20.00' }],
    deadheads: 0,
    route: 'JFK-AMS-JFK',
    flightSegments: [
      { departure: 'JFK', arrival: 'AMS', departureTime: '2229' },
    ],
    checkInTime: '20.59',
  };
  const runA227 = (prefs: any[]) =>
    simulateBid(
      { groups: [{ type: 'pairings', preferences: prefs }] } as any,
      [a227Pairing],
      {
        periodMonth: 8,
        periodYear: 2026,
        alv: 45,
        threshold: 10,
        windowMin: 10,
        windowMax: 60,
      }
    );

  assert(
    runA227([{ type: 'award' }]).awards.length === 1,
    '#A227 is awarded when nothing conflicts'
  );

  // Prefer Off every day the trip really flies (each 2-day instance spans
  // start..start+1) leaves it nowhere to go, so it must be excluded. This is
  // the discriminating case: before operating days were honored, phantom
  // starts on Aug 14/16/17/21/23/24 gave it an escape date and it survived.
  const realDaysOff = [
    '2026-08-11', '2026-08-12',
    '2026-08-18', '2026-08-19',
    '2026-08-25', '2026-08-26',
    '2026-08-27', '2026-08-28',
    '2026-08-29', '2026-08-30',
  ];
  assert(
    runA227([
      { type: 'preferOff', preferOffDates: realDaysOff },
      { type: 'award' },
    ]).awards.length === 0,
    'Prefer Off covering every real operating date excludes the trip'
  );

  // Preferring off only its FIRST operating date must leave it awardable via
  // a later one. This needs the range end ("AUG. 29" — month, period, space,
  // day) to parse: without that the range collapses to its start date, the
  // trip has exactly one instance, and blocking that date wrongly kills it.
  assert(
    runA227([
      { type: 'preferOff', preferOffDates: ['2026-08-11', '2026-08-12'] },
      { type: 'award' },
    ]).awards.length === 1,
    'a later operating date is still available when the first is blocked'
  );

  // Conversely, Prefer Off on the EXCEPT dates alone must not exclude it —
  // the trip never operates on those days in the first place.
  assert(
    runA227([
      {
        type: 'preferOff',
        preferOffDates: ['2026-08-13', '2026-08-15', '2026-08-20', '2026-08-22'],
      },
      { type: 'award' },
    ]).awards.length === 1,
    'Prefer Off on skipped dates does not affect a trip that never flies them'
  );

  // The negative dialect: "EXCPT FR SA SU" means all days BUT those.
  const f7831 = [
    '#7831 EXCPT FR SA SU EFFECTIVE FEB12-FEB. 26 CHECK-IN AT 5.15',
    ' EXCEPT FEB 16',
  ].join('\n');
  const d7831 = parseOperatingDays(f7831);
  assert(
    (d7831.operatingDows ?? []).map(d => NAMES[d]).join(',') ===
      'Mon,Tue,Wed,Thu',
    'negative weekday clause "EXCPT FR SA SU" resolves to the complement'
  );
  assert(
    d7831.exceptDates.join('|') === 'FEB 16',
    'EXCPT weekdays and EXCEPT dates are told apart in the same pairing'
  );

  // No weekday clause -> unrestricted, so behavior is unchanged.
  const plain = '#7652  EFFECTIVE JAN10 ONLY  CHECK-IN AT  5.00';
  assert(
    parseOperatingDays(plain).operatingDows === null,
    'a header with no weekday clause stays unrestricted'
  );
}

// --- Upload integrity: parsed count must equal persisted count -------------
// A package is only "completed" once its pairings are actually in the
// database. Parsing N and storing N are different claims; the second is what
// the pilot sees. A completed-but-empty package looks healthy and reads as
// empty everywhere, with nothing pointing back at the upload.
{
  // Mirrors the guard in pdfParser: any shortfall must fail, exact match
  // must pass. Kept as a pure predicate so the rule is testable without a
  // PDF or a database round trip.
  const uploadIsComplete = (parsed: number, persisted: number) =>
    parsed > 0 && persisted === parsed;

  assert(uploadIsComplete(236, 236), 'a fully persisted package completes');
  assert(
    !uploadIsComplete(236, 0),
    'zero persisted rows fails even though parsing succeeded'
  );
  assert(
    !uploadIsComplete(236, 235),
    'a single dropped row fails rather than silently completing'
  );
  assert(
    !uploadIsComplete(0, 0),
    'a zero-pairing parse never completes'
  );
}

// --- Fleet category normalization ------------------------------------------
// Award history is per category. The same fleet is spelled three ways across
// sources ("A220" in a bid package, "220-B" in a Reasons Report, "330"
// bare) and every cross-source comparison must normalize first. The SQL
// mirror (normalizedAircraftSqlExpr) was verified row-for-row against these
// same shapes on Postgres; if parseAircraftCode changes, re-verify both.
{
  const eq = (a: string, b: string) =>
    parseAircraftCode(a).baseType === parseAircraftCode(b).baseType;
  assert(eq('A220', '220-B'), 'package "A220" matches report "220-B"');
  assert(eq('220', '220B'), 'bare "220" matches suffixed "220B"');
  assert(eq('330', '330-B'), 'bare "330" matches suffixed "330-B"');
  assert(!eq('A220', '330'), 'the 220 category never matches the 330');
  assert(!eq('220-B', '330-B'), 'position suffixes do not blur fleets');
  assert(
    parseAircraftCode('220 B').baseType === '220',
    'stray whitespace in the code is tolerated'
  );
}

// --- Bid package month labeling -------------------------------------------
// A package is named for the month owning most of its bid period, which is
// not always the period's start month. Delta uses both shapes:
//   May 2 – Jun 1   -> "May" package (30 of 31 days in May)
//   Aug 31 – Sep 30 -> "September" package (1 day in August)
// Labeling by start month mislabeled the second shape by a month, which is
// what shipped a September package to users as "August 2026".
{
  const parser: any = new (PDFParser as any)();
  const monthCases: Array<[string, string]> = [
    ['May 2, 2026 – June 1, 2026', 'May 2026'],
    ['August 31, 2026 – September 30, 2026', 'September 2026'],
    ['July 2, 2026 – August 1, 2026', 'July 2026'],
    ['November 30, 2025 – December 30, 2025', 'December 2025'],
    ['December 2, 2025 – January 1, 2026', 'December 2025'],
    ['March 1, 2026 – March 31, 2026', 'March 2026'],
  ];
  for (const [range, expected] of monthCases) {
    assert(
      parser.extractBidPackageDate(`\n\n${range} (31 days)\n`) === expected,
      `package month from period "${range}" is ${expected}`
    );
  }

  // The cover wraps the month and year onto separate lines; the header must
  // still win over the period-range fallback.
  const wrappedCover = [
    'NEW YORK CITY                      ',
    '220                                      September  ',
    'PILOT BID PACKAGE  2026 ',
    '  ',
    'August 31, 2026 – September 30, 2026 (31 days) ',
  ].join('\n');
  assert(
    parser.extractBidPackageDate(wrappedCover) === 'September 2026',
    'wrapped cover header (month and year on separate lines) resolves the month'
  );
  const period = parser.extractBidPeriod(wrappedCover);
  assert(
    period?.startDate === '2026-08-31' && period?.endDate === '2026-09-30',
    'bid period start/end parsed alongside the package month'
  );
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
