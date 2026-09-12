import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import express from 'express';
import { cleanup } from '../db';
import { storage } from '../storage';
import { registerRoutes } from '../routes';

after(cleanup);

test('dataset endpoint returns complete compact data and refuses processing packages', async () => {
  let packageStatus = 'completed';
  let rows: any[] = [
    {
      id: 1,
      fullTextBlock: 'Raw PDF text',
      operatingDows: [1],
      exceptDates: ['2026-08-03'],
      flightSegments: [{ departure: 'LGA' }],
    },
  ];
  mock.method(storage, 'getBidPackage', async () => ({
    id: 61,
    status: packageStatus,
  }));
  const read = mock.method(
    storage,
    'getAllPairingsForBidPackage',
    async (options: any) => {
      assert.equal(options.compact, true);
      assert.equal(options.seniorityPercentile, 0);
      return { pairings: rows, statistics: {} };
    }
  );
  try {
    const app = express();
    await registerRoutes(app);
    const route = app._router.stack.find(
      (layer: any) => layer.route?.path === '/api/bid-packages/:id/dataset'
    ).route;
    let status = 200;
    let body: any;
    const response = {
      status(value: number) {
        status = value;
        return this;
      },
      json(value: unknown) {
        body = value;
        return this;
      },
    };
    const request = {
      params: { id: '61' },
      query: { seniorityPercentile: '0' },
    };
    await route.stack.at(-1).handle(request, response);
    assert.equal(status, 200);
    assert.equal(body.complete, true);
    assert.equal(body.total, 1);
    assert.equal('fullTextBlock' in body.pairings[0], false);
    assert.deepEqual(body.pairings[0].operatingDows, [1]);
    assert.deepEqual(body.pairings[0].flightSegments, [{ departure: 'LGA' }]);
    rows = [];
    await route.stack.at(-1).handle(request, response);
    assert.equal(body.total, 0);
    assert.equal(body.complete, true);
    packageStatus = 'processing';
    await route.stack.at(-1).handle(request, response);
    assert.equal(status, 409);
    assert.equal(read.mock.callCount(), 2);
  } finally {
    mock.restoreAll();
  }
});
