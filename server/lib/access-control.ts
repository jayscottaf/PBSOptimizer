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

/** One deployment belongs to one pilot. Gate the document as well as all APIs
 * so the browser's native HTTP authentication prompt works before React loads.
 */
export function accessControl(
  env: NodeJS.ProcessEnv = process.env
): RequestHandler {
  return (req, res, next) => {
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
      const expected = env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
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
    const password = env.APP_ACCESS_PASSWORD;
    if (!password || password.length < 24) {
      res.status(503).json({ message: 'Application access is not configured' });
      return;
    }
    const authorization = req.get('authorization') ?? '';
    const provided = /^Basic /i.test(authorization)
      ? Buffer.from(authorization.slice(6), 'base64').toString('utf8')
      : '';
    if (!equalSecret(provided, `pilot:${password}`)) {
      if (
        req.path === '/api/access' ||
        req.get('accept')?.includes('text/html')
      ) {
        res.set(
          'WWW-Authenticate',
          'Basic realm="PBS Optimizer", charset="UTF-8"'
        );
      }
      res.status(401).json({ message: 'Sign in to access PBS Optimizer' });
      return;
    }
    next();
  };
}

export function publicUser<T extends { syncPin?: string | null }>(user: T) {
  const { syncPin, ...profile } = user;
  return { ...profile, hasSyncPin: Boolean(syncPin) };
}
