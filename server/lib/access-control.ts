import {
  createHash,
  timingSafeEqual,
  randomBytes,
  scrypt as scryptCallback,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { RequestHandler } from 'express';

const scrypt = promisify(scryptCallback);
const digest = (value: string) => createHash('sha256').update(value).digest();
export function equalSecret(a: string, b: string) {
  return timingSafeEqual(digest(a), digest(b));
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(pin, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (!stored.startsWith('scrypt:')) return equalSecret(pin, stored);
  const [, salt, encoded] = stored.split(':');
  if (
    !/^[a-f0-9]{32}$/.test(salt ?? '') ||
    !/^[a-f0-9]{128}$/.test(encoded ?? '')
  )
    return false;
  const actual = (await scrypt(pin, salt, 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(encoded, 'hex'));
}

/** Gate the document and APIs for a single-pilot deployment. PIN sessions
 * use a durable attempt budget; loopback development remains login-free.
 */
export function accessControl(
  env: NodeJS.ProcessEnv = process.env,
  sessions?: {
    getPin?(): Promise<string | undefined>;
    createPin?(hash: string): Promise<boolean>;
    attempt(): Promise<boolean>;
    save(token: string, credential: string): Promise<void>;
    valid(token: string, credential: string): Promise<boolean>;
  }
): RequestHandler {
  return async (req, res, next) => {
    try {
      const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        req.socket.remoteAddress ?? ''
      );
      const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(
        req.hostname
      );
      const localDevelopment =
        env.NODE_ENV === 'development' && loopback && localHost;
      res.set('Cache-Control', 'private, no-store');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.get('origin');
        const expected =
          env.APP_ORIGIN ||
          `${env.VERCEL ? 'https' : req.protocol}://${req.get('host')}`;
        if (
          req.get('sec-fetch-site') === 'cross-site' ||
          (origin && origin !== expected)
        ) {
          res
            .status(403)
            .json({ message: 'Cross-origin requests are not allowed' });
          return;
        }
      }
      if (localDevelopment) return next();
      const pin = env.APP_ACCESS_PIN;
      const password = env.APP_ACCESS_PASSWORD;
      if (
        pin !== undefined
          ? !/^\d{4}$/.test(pin)
          : password !== undefined && password.length < 24
      ) {
        res
          .status(503)
          .json({ message: 'Application access is not configured' });
        return;
      }
      if (pin !== undefined || password === undefined) {
        const store =
          sessions ?? (await import('./access-sessions')).accessSessions;
        let stored = pin === undefined ? await store.getPin?.() : undefined;
        const setup = pin === undefined && !stored;
        let credential = digest(pin ?? stored ?? '').toString('hex');
        const token = req
          .get('cookie')
          ?.split(';')
          .map(part => part.trim())
          .find(part => part.startsWith('__Host-pbs-access='))
          ?.slice('__Host-pbs-access='.length);
        if (
          !setup &&
          token &&
          /^[a-f0-9]{64}$/.test(token) &&
          (await store.valid(digest(token).toString('hex'), credential))
        )
          return next();
        if (req.path === '/api/access' && req.method === 'POST') {
          if (!(await store.attempt())) {
            res
              .set('Retry-After', '900')
              .status(429)
              .send('Too many attempts. Try again in 15 minutes.');
            return;
          }
          const submitted = req.body?.pin;
          if (setup) {
            if (
              typeof submitted !== 'string' ||
              !/^\d{4}$/.test(submitted) ||
              submitted !== req.body?.confirmPin
            ) {
              res
                .status(400)
                .type('html')
                .send(
                  pinPage('Enter four matching digits in both fields.', true)
                );
              return;
            }
            stored = await hashPin(submitted);
            if (!(await store.createPin?.(stored))) {
              res
                .status(409)
                .type('html')
                .send(
                  pinPage(
                    'A PIN has already been created. Sign in with that PIN.'
                  )
                );
              return;
            }
            credential = digest(stored).toString('hex');
          } else if (
            typeof submitted !== 'string' ||
            !(pin !== undefined
              ? equalSecret(submitted, pin)
              : await verifyPin(submitted, stored!))
          ) {
            res
              .status(401)
              .type('html')
              .send(pinPage('Incorrect PIN. Try again.'));
            return;
          }
          const session = randomBytes(32).toString('hex');
          await store.save(digest(session).toString('hex'), credential);
          res.set(
            'Set-Cookie',
            `__Host-pbs-access=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`
          );
          res.redirect(303, '/');
          return;
        }
        if (
          req.path === '/api/access' ||
          req.get('accept')?.includes('text/html')
        ) {
          res.status(401).type('html').send(pinPage(undefined, setup));
        } else res.status(401).json({ message: 'Enter your app PIN' });
        return;
      }
      // Existing deployments can retain their password until PIN rollout.
      const authorization = req.get('authorization') ?? '';
      const provided = /^Basic /i.test(authorization)
        ? Buffer.from(authorization.slice(6), 'base64').toString('utf8')
        : '';
      if (!equalSecret(provided, `pilot:${password}`)) {
        if (
          req.path === '/api/access' ||
          req.get('accept')?.includes('text/html')
        )
          res.set(
            'WWW-Authenticate',
            'Basic realm="PBS Optimizer", charset="UTF-8"'
          );
        res.status(401).json({ message: 'Sign in to access PBS Optimizer' });
        return;
      }
      next();
    } catch {
      res
        .status(503)
        .json({ message: 'Access is temporarily unavailable. Please retry.' });
    }
  };
}

export function publicUser<T extends { syncPin?: string | null }>(user: T) {
  const { syncPin, ...profile } = user;
  return { ...profile, hasSyncPin: Boolean(syncPin) };
}

function pinPage(message?: string, setup = false) {
  message ??= setup
    ? 'Choose a four-digit PIN to get started.'
    : 'Enter your four-digit app PIN.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PBS Optimizer</title></head><body style="font-family:system-ui;max-width:24rem;margin:15vh auto;padding:24px"><h1>PBS Optimizer</h1><p>${message}</p><form method="post" action="/api/access"><label for="pin">PIN</label><input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="${setup ? 'new-password' : 'current-password'}" required autofocus style="display:block;font-size:24px;margin:16px 0;padding:8px;width:8rem">${setup ? '<label for="confirmPin">Confirm PIN</label><input id="confirmPin" name="confirmPin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="new-password" required style="display:block;font-size:24px;margin:16px 0;padding:8px;width:8rem">' : ''}<button type="submit" style="padding:10px 24px">${setup ? 'Create PIN' : 'Unlock'}</button></form></body></html>`;
}
