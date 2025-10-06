import 'dotenv/config';
import express from 'express';
import { registerRoutes } from './server/routes';
import { serveStatic } from './server/vite';

const app = express();

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Initialize routes synchronously
const initPromise = registerRoutes(app).then(() => {
  // Serve static files in production
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    serveStatic(app);
  }

  // Error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    res.status(status).json({ message });
  });
});

// Wait for initialization on first request
let initialized = false;
app.use(async (req, res, next) => {
  if (!initialized) {
    await initPromise;
    initialized = true;
  }
  next();
});

// Export for Vercel
export default app;
