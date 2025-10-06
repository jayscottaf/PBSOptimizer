import 'dotenv/config';
import express from 'express';
import { registerRoutes } from '../server/routes';
import { serveStatic } from '../server/vite';

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Initialize routes (wrap in async IIFE to avoid top-level await)
let routesInitialized = false;
const initPromise = (async () => {
  await registerRoutes(app);
  serveStatic(app);
  routesInitialized = true;
})();

// Export handler that waits for initialization
export default async (req: any, res: any) => {
  if (!routesInitialized) {
    await initPromise;
  }
  return app(req, res);
};
