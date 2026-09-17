import { assessCommuteFit } from '../client/src/lib/commute-fit';

let failures = 0;

function assert(condition: boolean, label: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${label}`);
  if (!condition) {
    failures += 1;
  }
}

const thresholds = {
  earliestAcceptableReportMinutes: 7 * 60,
  latestAcceptableReleaseMinutes: 21 * 60,
};

const both = assessCommuteFit(
  [
    { date: 'A', departureTime: '0830', arrivalTime: '1000' },
    { date: 'B', departureTime: '16:00', arrivalTime: '19.30' },
  ],
  thresholds
);
assert(both.status === 'both', 'normal trip supports both commutes');
assert(both.reportLabel === '07:30 · day 1', 'report uses one-hour lead');
assert(both.releaseLabel === '20:00 · day 2', 'release uses 30-minute trail');

const commuteInOnly = assessCommuteFit(
  [
    { date: 'A', departureTime: '1000', arrivalTime: '1200' },
    { date: 'C', departureTime: '1900', arrivalTime: '2200' },
  ],
  thresholds
);
assert(
  commuteInOnly.status === 'commute-in-only',
  'late release preserves commute in only'
);

const commuteHomeOnly = assessCommuteFit(
  [{ day: 1, departureTime: '0630', arrivalTime: '1800' }],
  thresholds
);
assert(
  commuteHomeOnly.status === 'commute-home-only',
  'early report preserves commute home only'
);

const overnightNeeded = assessCommuteFit(
  [{ day: 'A', departureTime: '0600', arrivalTime: '2230' }],
  thresholds
);
assert(
  overnightNeeded.status === 'overnight-needed',
  'early report and late release need overnights'
);

const reportCrossesMidnight = assessCommuteFit(
  [{ date: 'A', departureTime: '0030', arrivalTime: '0700' }],
  thresholds
);
assert(
  reportCrossesMidnight.reportLabel === '23:30 · prior day',
  'report crossing midnight is labeled as the prior day'
);
assert(
  reportCrossesMidnight.canCommuteIn === false,
  'prior-day report does not pass a day-one morning cutoff'
);

const releaseCrossesMidnight = assessCommuteFit(
  [{ date: 'A', departureTime: '2100', arrivalTime: '2350' }],
  {
    earliestAcceptableReportMinutes: 12 * 60,
    latestAcceptableReleaseMinutes: 23 * 60 + 59,
  }
);
assert(
  releaseCrossesMidnight.releaseLabel === '00:20 · day 2',
  'release crossing midnight is labeled on the next day'
);
assert(
  releaseCrossesMidnight.canCommuteHome === false,
  'post-midnight release remains later than a final-day cutoff'
);

const overnightFlight = assessCommuteFit(
  [{ date: 'A', departureTime: '2200', arrivalTime: '0100' }],
  {
    earliestAcceptableReportMinutes: 20 * 60,
    latestAcceptableReleaseMinutes: 6 * 60,
  }
);
assert(
  overnightFlight.releaseLabel === '01:30 · day 2',
  'overnight flight arrival advances to the next day'
);
assert(
  overnightFlight.status === 'both',
  'overnight arrival compares with the arrival-day home cutoff'
);

const buffered = assessCommuteFit(
  [{ date: 'A', departureTime: '0830', arrivalTime: '2000' }],
  {
    ...thresholds,
    inboundBufferMinutes: 45,
    outboundBufferMinutes: 45,
  }
);
assert(
  buffered.status === 'overnight-needed',
  'inbound and outbound buffers tighten both cutoffs'
);

const jsonSegments = assessCommuteFit(
  JSON.stringify([
    { date: '01OCT', departureTime: '08.30', arrivalTime: '1030' },
    { date: '02OCT', departureTime: '1800', arrivalTime: '2000' },
  ]),
  thresholds
);
assert(
  jsonSegments.status === 'both',
  'JSON segment data and named dates work'
);
assert(
  jsonSegments.releaseLabel === '20:30 · day 2',
  'named dates retain their day sequence'
);

const missingTimes = assessCommuteFit(
  [{ date: 'A', departureTime: 'not-a-time' }],
  thresholds
);
assert(
  missingTimes.status === 'unknown',
  'missing or invalid times are unknown'
);
assert(
  missingTimes.reasons[0].includes('missing'),
  'unknown result explains the missing times'
);

const invalidThresholds = assessCommuteFit([], {
  earliestAcceptableReportMinutes: -1,
  latestAcceptableReleaseMinutes: 2000,
});
assert(
  invalidThresholds.status === 'unknown',
  'invalid thresholds are unknown'
);

if (failures > 0) {
  console.error(`${failures} commute-fit check(s) failed.`);
  process.exit(1);
}

console.log('All commute-fit checks passed.');
