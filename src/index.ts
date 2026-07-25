import express, { Request, Response, NextFunction } from 'express';
import * as dotenv from 'dotenv';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import fs from 'fs';

// Load env before other app modules read process.env
dotenv.config();

import router from './routes';


const app = express();

// ── CORS ─────────────────────────────────────────────────────────────────────
// Load CORS origins from environment or use defaults
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : process.env.NODE_ENV === 'production'
    ? ['https://partystorm.vercel.app', 'https://api.partystorm.ng', 'https://partystorm.ng']
    : ['http://localhost:5173', 'http://localhost:5181', 'http://localhost:3000', 'https://partystorm.vercel.app'];

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

// ── Compression ───────────────────────────────────────────────────────────────
// Gzip compress responses larger than 1KB (70-80% size reduction)
app.use(compression({
  level: 6, // Balanced compression level (0-9, 6 is default)
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    // Skip compression for requests with x-no-compression header
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

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

// ── HTTP Caching Headers ──────────────────────────────────────────────────────
// Smart cache headers based on endpoint and HTTP method
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET') {
    // Honor hard-refresh: browser sends Cache-Control: no-cache on hard refresh
    const clientNoCache = req.headers['cache-control'] === 'no-cache' || req.query['nocache'] === '1';

    // Static/rarely-changing endpoints: 1-day cache
    if (req.path.includes('/events/categories') || req.path.includes('/vendor-types')) {
      res.set('Cache-Control', clientNoCache ? 'no-cache, no-store, must-revalidate' : 'public, max-age=86400');
    }
    // Organizer-specific event routes and ticket attendance: always fresh (private)
    else if (
      req.path.includes('/events/organizer') ||
      req.path.includes('/tickets/event/') ||
      req.path.includes('/tickets/') ||
      req.path.includes('/vendors/applications')
    ) {
      res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    }
    // Public event detail/listing: short cache, bypass on hard refresh or ?nocache=1
    else if (req.path.match(/\/events\/[^/]+$/)) {
      // Single event detail — 1-minute cache (updated as tickets are bought)
      res.set('Cache-Control', clientNoCache ? 'no-cache, no-store, must-revalidate' : 'public, max-age=60');
    }
    else if (req.path.includes('/events')) {
      res.set('Cache-Control', clientNoCache ? 'no-cache, no-store, must-revalidate' : 'public, max-age=120'); // 2 min for listing
    }
    // User-specific / admin data: never cache
    else if (
      req.path.includes('/profile') ||
      req.path.includes('/user-roles') ||
      req.path.includes('/admin') ||
      req.path.includes('/support')
    ) {
      res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    }
    // Default: 1-minute cache for other GET requests
    else {
      res.set('Cache-Control', clientNoCache ? 'no-cache, no-store, must-revalidate' : 'public, max-age=60');
    }
  } else {
    // POST/PUT/DELETE: no cache
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/', router);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    message: 'PartyStorm API is running',
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
// if (process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1') {
  const PORT = process.env.PORT ?? 33312;
  
  app.listen(PORT, () => {
    console.log(`✅  Server running on http://localhost:${PORT}`);
    console.log(`    Health: http://localhost:${PORT}/health`);
  });
// }

// ── Vercel serverless export ──────────────────────────────────────────────────
export default app;