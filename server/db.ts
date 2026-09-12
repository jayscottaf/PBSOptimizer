import { config } from 'dotenv';
config();

import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from '../shared/schema';

// Configure for serverless environment
if (process.env.VERCEL) {
  // In Vercel, use native fetch instead of WebSocket
  neonConfig.fetchConnectionCache = true;
} else {
  // In local development, use WebSocket
  import('ws').then(ws => {
    neonConfig.webSocketConstructor = ws.default;
  });
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
  neonConfig.useSecureWebSocket = true;
}

if (!process.env.DATABASE_URL) {
  console.error('Environment variables:', {
    NODE_ENV: process.env.NODE_ENV,
    hasDbUrl: !!process.env.DATABASE_URL,
    envKeys: Object.keys(process.env).filter(
      k => k.includes('DB') || k.includes('URL')
    ),
  });
  throw new Error(
    'DATABASE_URL must be set. Did you forget to provision a database?'
  );
}
// Circuit breaker pattern for database connections
class DatabaseCircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private readonly failureThreshold = 5;
  private readonly recoveryTimeout = 30000; // 30 seconds
  private readonly resetTimeout = 60000; // 1 minute

  canExecute(): boolean {
    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }

    return this.state === 'HALF_OPEN';
  }

  onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      console.log(
        `Database circuit breaker OPEN - too many failures (${this.failures})`
      );

      // Auto-reset after timeout
      setTimeout(() => {
        if (this.state === 'OPEN') {
          this.state = 'HALF_OPEN';
          console.log('Database circuit breaker transitioning to HALF_OPEN');
        }
      }, this.resetTimeout);
    }
  }

  getState(): string {
    return this.state;
  }
}

const circuitBreaker = new DatabaseCircuitBreaker();

// Every replacement pool needs the same error handling as the initial one.
const createPool = () => {
  const next = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    min: 0,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 8000,
    maxUses: 5000,
    allowExitOnIdle: true,
  });
  next.on('error', err => {
    if (next !== pool || shuttingDown) return;
    console.error('Database pool error:', err);
    circuitBreaker.onFailure();
    if (
      /Connection terminated|WebSocket|ECONNREFUSED|connection closed/i.test(
        err.message
      )
    ) {
      void reconnectDatabase().catch(error =>
        console.error('Automatic reconnection failed:', error)
      );
    }
  });
  return next;
};

let shuttingDown = false;
let pool = createPool();
// ES module imports are live bindings. Existing storage closures now see the
// replacement client when executeWithRetry invokes the operation again.
export let db = drizzle({ client: pool, schema });
let reconnectPromise: Promise<typeof db> | undefined;

async function recoverDatabase(): Promise<typeof db> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (shuttingDown) throw new Error('Database is shutting down');
    if (attempt > 1)
      await new Promise(resolve =>
        setTimeout(resolve, Math.min(1000 * 2 ** (attempt - 2), 10000))
      );
    const replacement = createPool();
    try {
      await replacement.query('SELECT 1 as test');
      if (shuttingDown) throw new Error('Database is shutting down');
      const previous = pool;
      const nextDb = drizzle({ client: replacement, schema });
      pool = replacement;
      db = nextDb;
      // Publish a tested client before draining the old pool. Failed attempts
      // never replace the current client or leak their candidate pools.
      try {
        await previous.end();
      } catch (error) {
        console.warn('Error draining old pool:', error);
      }
      circuitBreaker.onSuccess();
      return db;
    } catch (error) {
      lastError = error;
      await replacement.end().catch(() => {});
      circuitBreaker.onFailure();
    }
  }
  throw new Error(
    `Database reconnection failed after 5 attempts: ${lastError}`
  );
}

export function reconnectDatabase(): Promise<typeof db> {
  if (!reconnectPromise) {
    reconnectPromise = recoverDatabase().finally(() => {
      reconnectPromise = undefined;
    });
  }
  return reconnectPromise;
}

// Database operation wrapper with circuit breaker
export const executeWithRetry = async <T>(
  operation: () => Promise<T>,
  operationName = 'database operation'
): Promise<T> => {
  if (!circuitBreaker.canExecute()) {
    throw new Error(
      `Database circuit breaker is ${circuitBreaker.getState()} - operation blocked`
    );
  }

  try {
    const result = await operation();
    circuitBreaker.onSuccess();
    return result;
  } catch (error) {
    console.error(`${operationName} failed:`, error);
    circuitBreaker.onFailure();

    const isConnectionError =
      error instanceof Error &&
      (error.message.includes('Connection terminated') ||
        error.message.includes('connection closed') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('WebSocket') ||
        error.message.includes('Pool is ending'));

    if (isConnectionError && circuitBreaker.canExecute()) {
      console.log(`Attempting recovery for ${operationName}...`);
      try {
        await reconnectDatabase();
        // Retry once after reconnection
        const result = await operation();
        circuitBreaker.onSuccess();
        return result;
      } catch (retryError) {
        console.error(
          `${operationName} retry after reconnection failed:`,
          retryError
        );
        circuitBreaker.onFailure();
        throw retryError;
      }
    }

    throw error;
  }
};

// Health check with circuit breaker status
export const getDatabaseHealth = async (): Promise<{
  connected: boolean;
  circuitBreakerState: string;
  poolInfo: any;
}> => {
  try {
    if (!circuitBreaker.canExecute()) {
      return {
        connected: false,
        circuitBreakerState: circuitBreaker.getState(),
        poolInfo: { status: 'blocked by circuit breaker' },
      };
    }

    await pool.query('SELECT 1');
    return {
      connected: true,
      circuitBreakerState: circuitBreaker.getState(),
      poolInfo: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
      },
    };
  } catch (error) {
    return {
      connected: false,
      circuitBreakerState: circuitBreaker.getState(),
      poolInfo: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
};

// Graceful shutdown with better cleanup
const gracefulShutdown = async (signal: string) => {
  console.log(`${signal} received, shutting down database connections...`);
  try {
    await cleanup();
    console.log('Database connections closed successfully');
  } catch (error) {
    console.error('Error during database shutdown:', error);
  }
  process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Keep-alive mechanism to prevent connection drops
let keepAliveInterval: NodeJS.Timeout;

const startKeepAlive = () => {
  keepAliveInterval = setInterval(async () => {
    // Only ping when the pool actually holds a connection worth keeping
    // alive. The pool is configured to drain when idle (min: 0,
    // allowExitOnIdle, 20s idle timeout), so an unconditional ping did the
    // opposite of what that config wants: it opened a brand-new connection
    // every 45s on an idle instance purely to close it again. On serverless
    // that is pure recurring cost across every warm instance, and it works
    // against the drain-when-idle design. When traffic is actually flowing
    // there are connections open and this behaves exactly as before.
    if (pool.totalCount === 0) {
      return;
    }
    if (circuitBreaker.canExecute()) {
      try {
        await pool.query('SELECT 1');
      } catch (error) {
        console.warn('Keep-alive query failed:', error);
      }
    }
  }, 45000); // Every 45 seconds
  keepAliveInterval.unref();
};

const stopKeepAlive = () => {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
};

// Start keep-alive
startKeepAlive();

// Export cleanup function
export const cleanup = async () => {
  shuttingDown = true;
  stopKeepAlive();
  await reconnectPromise?.catch(() => {});
  await pool.end();
};
