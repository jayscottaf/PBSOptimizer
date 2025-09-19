import 'dotenv/config';
import express, { type Request, Response, NextFunction } from 'express';
import { registerRoutes } from './routes';
import { setupVite, serveStatic, log } from './vite';

// Simple logging utility
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_HTTP = process.env.LOG_HTTP !== '0'; // Default to true unless explicitly set to 0

function logger(level: string, message: string) {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  const currentLevel = levels[level as keyof typeof levels] || 2;
  const maxLevel = levels[LOG_LEVEL as keyof typeof levels] || 2;

  if (currentLevel <= maxLevel) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${timestamp} [${level.toUpperCase()}] ${message}`);
  }
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on('finish', () => {
    if (LOG_HTTP && path.startsWith('/api')) {
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;

      if (capturedJsonResponse) {
        // Only log response size and type, not the full content
        const responseSize = JSON.stringify(capturedJsonResponse).length;
        const responseType = Array.isArray(capturedJsonResponse)
          ? `array[${capturedJsonResponse.length}]`
          : typeof capturedJsonResponse;
        logLine += ` :: ${responseType} (${responseSize} bytes)`;
      }

      logger('info', logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get('env') === 'development') {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen(port, '0.0.0.0', () => {
    logger('info', `Server started on port ${port}`);
    logger('info', `Environment: ${process.env.NODE_ENV || 'development'}`);
    logger('info', `Database URL configured: ${!!process.env.DATABASE_URL}`);
  });
})();
