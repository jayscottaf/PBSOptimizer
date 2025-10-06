import 'dotenv/config';
import express from 'express';
import { registerRoutes } from '../server/routes';
import { serveStatic } from '../server/vite';

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Register all API routes
await registerRoutes(app);

// Serve static files in production
serveStatic(app);

// Export for Vercel serverless
export default app;
