import 'dotenv/config';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import express from 'express';
import { registerRoutes } from '../routes';
import { storage } from '../storage';
import { cleanup } from '../db';
import { neutralProfile } from '../lib/profileLearner';

after(cleanup);
test('manual priorities preserve learned preferences and are returned by the profile API', async () => {
  const get = storage.getBidProfile,
    upsert = storage.upsertBidProfile;
  let saved: any = {
    userId: 1,
    employeeNumber: '000000100',
    weights: { ...neutralProfile(), layoverLikes: ['BOS'] },
    source: 'learned',
    learnedFromPeriods: 4,
  };
  try {
    storage.getBidProfile = async () => saved;
    storage.upsertBidProfile = async (userId, input) => {
      saved = { ...saved, userId, ...input };
      return saved;
    };
    const app = express();
    await registerRoutes(app);
    const put = app._router.stack.find(
      (layer: any) =>
        layer.route?.path === '/api/bid-profile/:userId' &&
        layer.route.methods.put
    ).route.stack[0].handle;
    let status = 200,
      body: any;
    const res: any = {
      status(code: number) {
        status = code;
        return this;
      },
      json(value: any) {
        body = value;
        return this;
      },
    };
    await put(
      {
        params: { userId: '1' },
        body: {
          weights: {
            ...saved.weights,
            rankingGoal: 'efficiency',
            preferredTripLengths: [2, 3],
          },
        },
      },
      res
    );
    assert.equal(status, 200);
    assert.equal(body.weights.rankingGoal, 'efficiency');
    assert.deepEqual(body.weights.layoverLikes, ['BOS']);
    assert.equal(body.employeeNumber, '000000100');
    assert.equal(body.source, 'mixed');
    const read = app._router.stack.find(
      (layer: any) =>
        layer.route?.path === '/api/bid-profile/:userId' &&
        layer.route.methods.get
    ).route.stack[0].handle;
    await read({ params: { userId: '1' } }, res);
    assert.deepEqual(body.weights.preferredTripLengths, [2, 3]);
    assert.equal(body.weights.rankingGoal, 'efficiency');
  } finally {
    storage.getBidProfile = get;
    storage.upsertBidProfile = upsert;
  }
});
