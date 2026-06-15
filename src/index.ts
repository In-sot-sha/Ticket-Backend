import express, { Request, Response, NextFunction } from 'express';
import * as dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

// Load env before other app modules read process.env
dotenv.config();

import router from './routes';

const app = express();

// ── CORS ─────────────────────────────────────────────────────────────────────
// Allow requests from any origin in dev; restrict to your domain in production.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:5181', 'http://localhost:3000',`https://eventgo-frontend.vercel.app`];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
      callback(new Error(`CORS policy: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Local uploads (dev only — Cloudinary is used in production) ──────────────
// Vercel's filesystem is read-only so we only set this up when a writable
// uploads directory actually exists (i.e., local dev).
const uploadsDir = path.join(__dirname, '..', 'uploads');
try {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', express.static(uploadsDir));
} catch {
  // Silently skip on read-only filesystems (Vercel, etc.)
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/', router);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    message: 'Eventify API is running',
    environment: process.env.NODE_ENV ?? 'development',
    timestamp: new Date().toISOString(),
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use('*', (_req: Request, res: Response) => {
  res.status(404).json({ message: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err.stack ?? err.message ?? err);
  const status  = err.status ?? err.statusCode ?? 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : (err.message ?? 'Something went wrong');
  res.status(status).json({ message });
});

// ── Local dev server ──────────────────────────────────────────────────────────
// On Vercel this block is never reached — the `export default app` below is
// what Vercel uses.  Locally, we still call listen() so `npm run dev` works.
if (process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1') {
  const PORT = process.env.PORT ?? 33312;
  app.listen(PORT, () => {
    console.log(`✅  Server running on http://localhost:${PORT}`);
    console.log(`    Health: http://localhost:${PORT}/health`);
  });
}

// ── Vercel serverless export ──────────────────────────────────────────────────
export default app;