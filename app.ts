import 'dotenv/config';
import express from 'express';
import http from 'http';
import { registerRoutes } from './server/routes';
import { serveStatic } from './server/vite';

const app = express();

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Create HTTP server
const server = http.createServer(app);

// Initialize routes
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

// Start server if not in Vercel serverless
if (!process.env.VERCEL) {
  initPromise.then(() => {
    const port = parseInt(process.env.PORT || '5000', 10);
    server.listen(port, '0.0.0.0', () => {
      console.log(`Server started on port ${port}`);
    });
  });
}

// Export for Vercel
export default app;
