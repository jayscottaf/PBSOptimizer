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

test('four-digit access uses protected sessions and limits PIN attempts', async () => {
  const env = {
    NODE_ENV: 'production',
    APP_ACCESS_PIN: '0123',
    APP_ORIGIN: 'https://pbs.example',
  };
  let attempts = 0;
  const saved = new Map<string, string>();
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    accessControl(env, {
      async attempt() {
        return ++attempts <= 5;
      },
      async save(token, credential) {
        saved.set(token, credential);
      },
      async valid(token, credential) {
        return saved.get(token) === credential;
      },
    })
  );
  app.get('*', (_req, res) => res.send('Allowed'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const login = (pin: string, origin = env.APP_ORIGIN) =>
    fetch(url + '/api/access', {
      method: 'POST',
      redirect: 'manual',
      headers: { origin },
      body: new URLSearchParams({ pin }),
    });
  try {
    const page = await fetch(url + '/api/access');
    assert.equal(page.status, 401);
    assert.match(await page.text(), /inputmode="numeric"/);
    assert.equal(page.headers.get('www-authenticate'), null);
    assert.equal((await login('0123', 'https://attacker.example')).status, 403);
    assert.equal(attempts, 0);
    assert.equal((await login('9999')).status, 401);
    const response = await login('0123');
    assert.equal(response.status, 303);
    const cookie = response.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
    assert.equal(saved.size, 1);
    const headers = { cookie: cookie.split(';')[0] };
    assert.equal((await fetch(url, { headers })).status, 200);
    env.APP_ACCESS_PIN = '4567';
    assert.equal((await fetch(url, { headers })).status, 401);
    env.APP_ACCESS_PIN = '0123';
    for (let i = 0; i < 3; i++) assert.equal((await login('9999')).status, 401);
    const locked = await login('0123');
    assert.equal(locked.status, 429);
    assert.equal(locked.headers.get('retry-after'), '900');
    assert.equal((await fetch(url, { headers })).status, 200);
    saved.clear();
    assert.equal((await fetch(url, { headers })).status, 401);
    env.APP_ACCESS_PIN = '123';
    assert.equal((await fetch(url)).status, 503);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('first visit creates a PIN once and subsequent visits verify it', async () => {
  let stored: string | undefined;
  const tokens = new Map<string, string>();
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    accessControl(
      { NODE_ENV: 'production' },
      {
        async getPin() {
          return stored;
        },
        async createPin(hash) {
          if (stored) return false;
          stored = hash;
          return true;
        },
        async attempt() {
          return true;
        },
        async save(token, credential) {
          tokens.set(token, credential);
        },
        async valid(token, credential) {
          return tokens.get(token) === credential;
        },
      }
    )
  );
  app.get('*', (_req, res) => res.send('Allowed'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const submit = (pin: string, confirmPin?: string) =>
    fetch(url + '/api/access', {
      method: 'POST',
      redirect: 'manual',
      body: new URLSearchParams({ pin, ...(confirmPin ? { confirmPin } : {}) }),
    });
  try {
    assert.match(await (await fetch(url + '/api/access')).text(), /Create PIN/);
    assert.equal((await submit('0123', '4567')).status, 400);
    assert.equal(stored, undefined);
    const responses = await Promise.all([
      submit('0123', '0123'),
      submit('0123', '0123'),
    ]);
    assert.deepEqual(responses.map(r => r.status).sort(), [303, 409]);
    assert.match(stored!, /^scrypt:/);
    assert.equal(await verifyPin('0123', stored!), true);
    const cookie = responses
      .find(r => r.status === 303)!
      .headers.get('set-cookie')!
      .split(';')[0];
    assert.equal((await fetch(url, { headers: { cookie } })).status, 200);
    assert.doesNotMatch(
      await (await fetch(url + '/api/access')).text(),
      /Create PIN/
    );
    assert.equal((await submit('9999', '9999')).status, 401);
    assert.equal((await submit('0123')).status, 303);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
