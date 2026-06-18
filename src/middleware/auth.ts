import * as jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
  userId?: number;
  role?: string;
  firstName?: string;
  lastName?: string;
  user?: any; // This can be more specific based on your user model
}

// Generate JWT token
export const generateToken = (userId: number, role: string): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not defined in environment variables');
  }
  
  return jwt.sign(
    { userId, role },
    secret!,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as jwt.SignOptions
  );
};

// Verify JWT token middleware
export const verifyToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      res.status(401).json({ message: 'Access denied. No token provided.' });
      return; // Explicitly return to satisfy TypeScript
    }
    
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET is not defined in environment variables');
    }
    
    const decoded = jwt.verify(token, secret) as { userId: number; role: string };
    req.userId = decoded.userId;
    req.role = decoded.role;
    
    // Verify user still exists in database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });
    
    if (!user) {
      res.status(401).json({ message: 'Invalid token. User not found.' });
      return; // Explicitly return to satisfy TypeScript
    }
    
    next();
    return; // Explicitly return to satisfy TypeScript
  } catch (error) {
    res.status(401).json({ message: 'Invalid token.' });
    return; // Explicitly return to satisfy TypeScript
  }
};

// Attach user when a valid token is present; continue as guest otherwise
export const optionalVerifyToken = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      next();
      return;
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      next();
      return;
    }

    const decoded = jwt.verify(token, secret) as { userId: number; role: string };
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (user) {
      req.userId = decoded.userId;
      req.role = decoded.role;
    }
  } catch {
    // Invalid token — treat as guest
  }
  next();
};

// Middleware to check user role
export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.role) {
      res.status(401).json({ message: 'Access denied. No token provided.' });
      return; // Explicitly return to satisfy TypeScript
    }
    
    if (!roles.includes(req.role)) {
      res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
      return; // Explicitly return to satisfy TypeScript
    }
    
    next();
    return; // Explicitly return to satisfy TypeScript
  };
};