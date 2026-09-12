/** Isolated browser fixture: npm run build, then npx tsx scripts/browser-review-fixture.ts.
 * Serves the real built app with synthetic API data. Never connects to a database.
 */
import express from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const app = express();
app.use(express.json());
const root = path.resolve('dist/public');
const requests: Record<string, number> = {};
let datasetUnavailable = false;
let simulateOffline = false;
const packages = [9001, 9002].map((id, index) => ({
  id,
  name: `Synthetic package ${index + 1}`,
  month: index ? 'September' : 'August',
  year: 2026,
  base: 'NYC',
  aircraft: '220-B',
  status: 'completed',
  uploadedAt: `2026-08-0${2 - index}T00:00:00Z`,
}));
const rows = (id: number) =>
  Array.from({ length: id === 9001 ? 236 : 3 }, (_, i) => ({
    id: id * 1000 + i,
    bidPackageId: id,
    pairingNumber: String(1000 + i),
    effectiveDates: id === 9001 ? 'AUG01-AUG31' : 'SEP01-SEP30',
    route: i % 2 ? 'LGA-MIA-LGA' : 'LGA-BOS-LGA',
    creditHours: i % 2 ? '15.00' : '18.50',
    blockHours: '10.00',
    tafb: '48.30',
    checkInTime: '08.00',
    operatingDows: [1, 3, 5],
    exceptDates: [],
    deadheads: 0,
    layovers: [{ city: i % 2 ? 'MIA' : 'BOS', duration: '12.00' }],
    flightSegments: [
      {
        day: 'A',
        flightNumber: '1234',
        departure: 'LGA',
        arrival: 'BOS',
        departureTime: '08:00',
        arrivalTime: '10:00',
        blockTime: '2.00',
      },
    ],
    holdProbability: i % 2 ? 20 : 90,
    holdProbabilityReasoning: ['Synthetic test evidence'],
    pairingDays: (i % 3) + 1,
  }));
app.get('/fixture/requests', (_req, res) => res.json(requests));
app.post('/fixture/network', (req, res) => {
  datasetUnavailable = Boolean(req.body.unavailable);
  res.json({ datasetUnavailable });
});
app.use('/api', (req, _res, next) => {
  if (simulateOffline) {
    req.socket.destroy();
    return;
  }
  requests[req.path] = (requests[req.path] ?? 0) + 1;
  next();
});
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', database: 'connected' })
);
app.get('/api/bid-packages', (_req, res) => res.json(packages));
app.get('/api/bid-packages/:id/dataset', (req, res) => {
  if (datasetUnavailable)
    return res.status(503).json({ message: 'Synthetic network failure' });
  const pairings = rows(Number(req.params.id));
  res.json({
    schema: 1,
    complete: true,
    total: pairings.length,
    pairings,
    statistics: {},
  });
});
app.get('/api/pairings/:id', (req, res) => {
  const id = Number(req.params.id);
  const pairing = rows(Math.floor(id / 1000)).find(p => p.id === id);
  res.json({
    ...pairing,
    fullTextBlock: 'SYNTHETIC RAW PDF DETAIL — loaded on demand.',
  });
});
app.get('/api/bid-packages/:id/stats', (req, res) =>
  res.json({
    totalPairings: rows(Number(req.params.id)).length,
    creditBlockRatios: { min: 1.5, max: 1.85, average: 1.675 },
    creditHours: { min: 15, max: 18.5, average: 16.75 },
    blockHours: { min: 10, max: 10, average: 10 },
    avgByDays: {},
    pairingTypeBreakdown: {},
    ratioBreakdown: { excellent: 118, good: 0, average: 0, poor: 118 },
    layoverCities: [],
    checkInStations: [],
  })
);
app.get('/api/*', (_req, res) => res.json([]));
app.use('/api', (_req, res) =>
  res.status(405).json({ message: 'Fixture mutations are disabled' })
);
app.get('/', async (req, res) => {
  simulateOffline = req.query.offline === '1';
  const seed = {
    name: 'Synthetic pilot',
    seniorityNumber: '100',
    seniorityPercentile: '50',
    base: 'NYC',
    aircraft: 'A220',
    position: 'B',
    userId: '42',
    profileUpdatedAt: 'fixture-v1',
    historyRevision: '0',
    app_version: '1.3.0',
  };
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const script = `<script>${simulateOffline ? `Object.defineProperty(navigator, 'onLine', { get: () => false });` : ''}if(!localStorage.getItem('pbs:fixture')){for(const [k,v] of Object.entries(${JSON.stringify(seed)}))localStorage.setItem(k,v);localStorage.setItem('pbs:fixture','true');}</script>`;
  res.type('html').send(html.replace('<head>', `<head>${script}`));
});
app.use(express.static(root));
app.listen(5058, '127.0.0.1', () =>
  console.log('Synthetic browser fixture: http://127.0.0.1:5058')
);
