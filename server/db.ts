import { config } from 'dotenv';
config();

import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from '@shared/schema';

neonConfig.webSocketConstructor = ws;
neonConfig.pipelineTLS = false;
neonConfig.pipelineConnect = false;
neonConfig.useSecureWebSocket = true;

if (!process.env.DATABASE_URL) {
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
    if (this.state === 'CLOSED') return true;

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
      console.log(`Database circuit breaker OPEN - too many failures (${this.failures})`);

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

// Enhanced pool configuration with connection management
const createPool = () => {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3, // Further reduced to prevent overload
    min: 0, // Allow pool to completely drain
    idleTimeoutMillis: 20000, // Faster cleanup of idle connections
    connectionTimeoutMillis: 8000, // Faster timeout
    maxUses: 5000, // More aggressive connection recycling
    allowExitOnIdle: true, // Allow pool to exit when no connections
  });
};

let pool = createPool();
export const db = drizzle({ client: pool, schema });

// Connection recovery with exponential backoff
export const reconnectDatabase = async (attempt = 1): Promise<typeof db> => {
  const maxAttempts = 5;
  const baseDelay = 1000;

  try {
    console.log(`Database reconnection attempt ${attempt}/${maxAttempts}...`);

    // Close existing pool gracefully
    try {
      await pool.end();
    } catch (endError) {
      console.warn('Error ending existing pool:', endError);
    }

    // Wait before creating new pool
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 10000);
    await new Promise(resolve => setTimeout(resolve, delay));

    // Create new pool
    pool = createPool();
    const newDb = drizzle({ client: pool, schema });

    // Test the connection with a simple query
    await pool.query('SELECT 1 as test');

    console.log(`✅ Database reconnection successful on attempt ${attempt}`);
    circuitBreaker.onSuccess();
    return newDb;

  } catch (error) {
    console.error(`Database reconnection attempt ${attempt} failed:`, error);
    circuitBreaker.onFailure();

    if (attempt < maxAttempts) {
      return await reconnectDatabase(attempt + 1);
    } else {
      throw new Error(`Database reconnection failed after ${maxAttempts} attempts: ${error}`);
    }
  }
};

// Enhanced error handling for pool
pool.on('error', async (err) => {
  console.error('Database pool error:', err);
  circuitBreaker.onFailure();

  // Auto-reconnect on specific errors
  const shouldReconnect =
    err.message.includes('Connection terminated') ||
    err.message.includes('WebSocket') ||
    err.message.includes('ECONNREFUSED') ||
    err.message.includes('connection closed');

  if (shouldReconnect) {
    console.log('Triggering automatic reconnection due to pool error');
    setTimeout(async () => {
      try {
        await reconnectDatabase();
      } catch (reconnectError) {
        console.error('Automatic reconnection failed:', reconnectError);
      }
    }, 2000);
  }
});

// Database operation wrapper with circuit breaker
export const executeWithRetry = async <T>(
  operation: () => Promise<T>,
  operationName = 'database operation'
): Promise<T> => {
  if (!circuitBreaker.canExecute()) {
    throw new Error(`Database circuit breaker is ${circuitBreaker.getState()} - operation blocked`);
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
        console.error(`${operationName} retry after reconnection failed:`, retryError);
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
        poolInfo: { status: 'blocked by circuit breaker' }
      };
    }

    await pool.query('SELECT 1');
    return {
      connected: true,
      circuitBreakerState: circuitBreaker.getState(),
      poolInfo: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      }
    };
  } catch (error) {
    return {
      connected: false,
      circuitBreakerState: circuitBreaker.getState(),
      poolInfo: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
};

// Graceful shutdown with better cleanup
const gracefulShutdown = async (signal: string) => {
  console.log(`${signal} received, shutting down database connections...`);
  try {
    await pool.end();
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
    if (circuitBreaker.canExecute()) {
      try {
        await pool.query('SELECT 1');
      } catch (error) {
        console.warn('Keep-alive query failed:', error);
      }
    }
  }, 45000); // Every 45 seconds
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
  stopKeepAlive();
  await pool.end();
};