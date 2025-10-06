// Vercel serverless entry point
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerRoutes } from '../server/routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Serve static files from dist/public
app.use(express.static(path.join(__dirname, '../dist/public')));

// Initialize routes (wrapped to handle async)
let initialized = false;
const initPromise = registerRoutes(app).then(() => {
  initialized = true;
});

// Wait for initialization before handling requests
app.use(async (req, res, next) => {
  if (!initialized) {
    await initPromise;
  }
  next();
});

// Fallback to index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/public/index.html'));
});

export default app;