import type { VercelRequest, VercelResponse } from '@vercel/node';
import 'dotenv/config';
import express from 'express';
import { registerRoutes } from '../server/routes.js';

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
  try {
    // Ensure routes are initialized
    if (!initialized) {
      await initPromise;
    }

    // Delegate to Express and wait for response
    return new Promise((resolve, reject) => {
      // Wrap response to capture when it's finished
      const originalEnd = res.end.bind(res);
      res.end = function(...args: any[]) {
        originalEnd(...args);
        resolve(undefined);
        return res;
      } as any;

      // Handle the request
      app(req as any, res as any);
    });
  } catch (error) {
    console.error('Error in serverless handler:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}