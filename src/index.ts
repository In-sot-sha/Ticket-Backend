import express, { Request, Response } from 'express';
import * as dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

// Load env before other app modules read process.env
dotenv.config();

import router from './routes';

// Initialize Prisma Client


const app = express();
const PORT = process.env.PORT || 33312;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve locally stored uploads (fallback when Cloudinary is unavailable)
app.use('/uploads', express.static(uploadsDir));

// Routes
app.use('/api/', router);


// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Error handling middleware
app.use((err: any, _req: Request, res: Response, _next: any) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

// 404 handler
app.use('*', (_req: Request, res: Response) => {
  res.status(404).json({ message: 'Route not found' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
});

export default app;