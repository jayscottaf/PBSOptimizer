import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { request } from 'node:http';
import {
  accessControl,
  hashPin,
  verifyPin,
  publicUser,
} from '../lib/access-control';

test('all routes require access, fail closed, and reject cross-site writes', async () => {
  const env = {
    NODE_ENV: 'production',
    APP_ACCESS_PASSWORD: 'a-test-only-password-with-enough-entropy',
    APP_ORIGIN: 'https://pbs.example',
  };
  const app = express();
  app.use(accessControl(env));
  app.all('*', (_req, res) => res.json({ allowed: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const authorization = `Basic ${Buffer.from(`pilot:${env.APP_ACCESS_PASSWORD}`).toString('base64')}`;
  try {
    for (const path of [
      '/',
      '/api/upload',
      '/api/analyze-pairings',
      '/api/user/pin',
      '/api/clear-data',
    ]) {
      const response = await fetch(url + path, {
        headers: { accept: 'text/html' },
      });
      assert.equal(response.status, 401);
      assert.match(response.headers.get('www-authenticate') ?? '', /Basic/);
    }
    assert.equal(
      (await fetch(url, { headers: { authorization } })).status,
      200
    );
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: { authorization, origin: 'https://attacker.example' },
        })
      ).status,
      403
    );
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: { authorization, origin: env.APP_ORIGIN },
        })
      ).status,
      200
    );
    env.APP_ACCESS_PASSWORD = '';
    assert.equal(
      (await fetch(url, { headers: { authorization } })).status,
      503
    );
    env.NODE_ENV = 'development';
    assert.equal(
      await new Promise<number | undefined>((resolve, reject) => {
        request(url, { headers: { Host: 'attacker.example' } }, response => {
          response.resume();
          resolve(response.statusCode);
        })
          .on('error', reject)
          .end();
      }),
      503
    );
    assert.equal((await fetch(url)).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  }
});

test('PINs are salted, verified, and never returned with a profile', async () => {
  const first = await hashPin('123456');
  const second = await hashPin('123456');
  assert.notEqual(first, second);
  assert.equal(await verifyPin('123456', first), true);
  assert.equal(await verifyPin('654321', first), false);
  assert.equal(await verifyPin('123456', 'scrypt:invalid'), false);
  assert.deepEqual(publicUser({ id: 1, syncPin: first }), {
    id: 1,
    hasSyncPin: true,
  });
});
