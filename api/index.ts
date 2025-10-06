import type { VercelRequest, VercelResponse } from '@vercel/node';
import 'dotenv/config';
import express from 'express';
import { registerRoutes } from '../server/routes';

// Create Express app
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Initialize routes
let initialized = false;
const initPromise = registerRoutes(app).then(() => {
  initialized = true;
});

// Vercel serverless function handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Ensure routes are initialized
  if (!initialized) {
    await initPromise;
  }

  // Delegate to Express
  app(req as any, res as any);
}