import { simulateBid } from '../server/lib/bidSimulator';
import { exportBid } from '../server/lib/bidExporter';
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

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
