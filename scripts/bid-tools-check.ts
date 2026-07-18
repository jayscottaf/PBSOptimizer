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
  rp.groupResults[0].inertPreferences.some(p => p.reason.includes('not simulated')),
  'Pattern preference marked not-simulated in group results'
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
    ds.groupResults[0].inertPreferences.some(p => p.reason.includes('Day-of-week')),
    'DOW Prefer Off marked not-simulated in group results'
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

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
