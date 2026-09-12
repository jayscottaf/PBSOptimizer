import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test, mock } from 'node:test';
import express from 'express';
import { db, cleanup } from '../db';
import { storage } from '../storage';
import { pdfParser } from '../pdfParser';
import { registerRoutes } from '../routes';

after(cleanup);

test('uploading a second version preserves the old package and saved references', async () => {
  const old = {
    id: 1,
    name: 'Old',
    month: 'August',
    year: 2026,
    base: 'NYC',
    aircraft: '220-B',
  };
  const next = { ...old, id: 2, name: 'New' };
  const saved = { favorites: [1], calendar: [1], chat: [1], packages: [old] };
  mock.method(storage, 'createBidPackage', async () => next);
  mock.method(pdfParser, 'parseFile', async () => {});
  mock.method(storage, 'getBidPackage', async () => next);
  mock.method(storage, 'getPairings', async () => [
    { id: 20, pairingNumber: '1001' },
  ]);
  mock.method(db, 'select', () => ({
    from: () => ({ where: async () => [] }),
  }));
  mock.method(storage, 'getBidPackages', async () => [old, next]);
  const deletion = mock.method(storage, 'deleteBidPackage', async () => {
    saved.favorites = [];
    saved.calendar = [];
    saved.chat = [];
    saved.packages = [];
  });
  try {
    const app = express();
    await registerRoutes(app);
    const route = app._router.stack.find(
      (layer: any) => layer.route?.path === '/api/upload'
    ).route;
    let status = 200;
    let body: any;
    await route.stack.at(-1).handle(
      {
        file: { mimetype: 'text/plain', buffer: Buffer.from('synthetic') },
        body: next,
      },
      {
        status(code: number) {
          status = code;
          return this;
        },
        json(value: unknown) {
          body = value;
          return this;
        },
      }
    );
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(deletion.mock.callCount(), 0);
    assert.deepEqual(saved, {
      favorites: [1],
      calendar: [1],
      chat: [1],
      packages: [old],
    });
  } finally {
    mock.restoreAll();
  }
});
