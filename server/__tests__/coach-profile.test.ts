import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import express from 'express';
import { cleanup } from '../db';
import { storage } from '../storage';
import { SimpleAI, type SimpleAIQuery } from '../ai/simpleAI';
import { registerRoutes } from '../routes';

after(cleanup);

test('coach requests without userId receive the canonical profile and current seniority', async () => {
  mock.method(storage, 'getPrimaryUser', async () => ({
    id: 7,
    seniorityPercentile: 0,
  }));
  let received: SimpleAIQuery | undefined;
  mock.method(SimpleAI.prototype, 'query', async (query: SimpleAIQuery) => {
    received = query;
    return { response: 'Synthetic answer' };
  });
  try {
    const app = express();
    await registerRoutes(app);
    const route = app._router.stack.find(
      (layer: any) => layer.route?.path === '/api/askAssistant'
    ).route;
    let response: unknown;
    await route.stack.at(-1).handle(
      {
        body: {
          question: 'Optimize my bid',
          bidPackageId: 61,
          seniorityPercentile: 99,
        },
      },
      {
        json(value: unknown) {
          response = value;
        },
      }
    );
    assert.equal(received?.userId, 7);
    assert.equal(received?.seniorityPercentile, 0);
    assert.deepEqual(response, {
      reply: 'Synthetic answer',
      pairingNumbers: undefined,
    });
  } finally {
    mock.restoreAll();
  }
});
