// Vercel serverless entry point
import 'dotenv/config';
import express from 'express';
import { registerRoutes } from '../server/routes';
import { serveStatic } from '../server/vite';

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Initialize server and export
let serverInitialized = false;
const initPromise = (async () => {
  await registerRoutes(app);
  serveStatic(app);
  serverInitialized = true;
})();

// Wait for initialization before handling requests
app.use(async (req, res, next) => {
  if (!serverInitialized) {
    await initPromise;
  }
  next();
});

export default app;