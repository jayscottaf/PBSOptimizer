// Vercel serverless entry point
import 'dotenv/config';
import express from 'express';
import { registerRoutes } from '../server/routes';

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Initialize routes once
let routesInitialized = false;
const initPromise = registerRoutes(app).then(() => {
  routesInitialized = true;
});

// Wait for routes to be ready before handling requests
app.use(async (req, res, next) => {
  if (!routesInitialized) {
    await initPromise;
  }
  next();
});

export default app;