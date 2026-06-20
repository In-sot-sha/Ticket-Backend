import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  [key: string]: { count: number; resetTime: number };
}

// In-memory store for rate limits (in production, use Redis)
const rateLimitStore: RateLimitStore = {};

/**
 * Rate limiter middleware
 * @param maxRequests Maximum number of requests allowed
 * @param windowMs Time window in milliseconds
 * @param keyGenerator Function to generate unique key per request (default: IP address)
 */
export const rateLimit = (
  maxRequests: number = 100,
  windowMs: number = 60 * 1000, // 1 minute default
  keyGenerator?: (req: Request) => string
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Generate unique key (IP + optional user ID)
    const key = keyGenerator
      ? keyGenerator(req)
      : `${req.ip}-${req.path}`;

    const now = Date.now();
    const rateLimitData = rateLimitStore[key];

    // Initialize or reset if window has passed
    if (!rateLimitData || now > rateLimitData.resetTime) {
      rateLimitStore[key] = {
        count: 1,
        resetTime: now + windowMs
      };
      next();
      return;
    }

    // Increment count
    rateLimitData.count++;

    // Check if limit exceeded
    if (rateLimitData.count > maxRequests) {
      const retryAfter = Math.ceil((rateLimitData.resetTime - now) / 1000);
      res.set('Retry-After', retryAfter.toString());
      return res.status(429).json({
        message: 'Too many requests. Please try again later.',
        retryAfter
      });
    }

    // Add remaining requests to response headers
    res.set('X-RateLimit-Limit', maxRequests.toString());
    res.set('X-RateLimit-Remaining', (maxRequests - rateLimitData.count).toString());
    res.set('X-RateLimit-Reset', rateLimitData.resetTime.toString());

    next();
  };
};

/**
 * Stricter rate limiter for auth endpoints (login, register, OTP)
 * 5 requests per minute per IP
 */
export const authRateLimit = rateLimit(5, 60 * 1000);

/**
 * PIN verification rate limiter - very strict
 * 10 requests per 5 minutes per IP
 */
export const pinVerifyRateLimit = rateLimit(10, 5 * 60 * 1000);

/**
 * OTP request rate limiter
 * 3 requests per 10 minutes per contact (email/phone)
 */
export const otpRequestRateLimit = (
  maxRequests: number = 3,
  windowMs: number = 10 * 60 * 1000
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { contact } = req.body;
    if (!contact) {
      return res.status(400).json({ message: 'Contact is required' });
    }

    const key = `otp-${contact}`;
    const now = Date.now();
    const rateLimitData = rateLimitStore[key];

    // Initialize or reset if window has passed
    if (!rateLimitData || now > rateLimitData.resetTime) {
      rateLimitStore[key] = {
        count: 1,
        resetTime: now + windowMs
      };
      next();
      return;
    }

    // Increment count
    rateLimitData.count++;

    // Check if limit exceeded
    if (rateLimitData.count > maxRequests) {
      const retryAfter = Math.ceil((rateLimitData.resetTime - now) / 1000);
      res.set('Retry-After', retryAfter.toString());
      return res.status(429).json({
        message: `Too many OTP requests for this contact. Please try again in ${retryAfter} seconds.`,
        retryAfter
      });
    }

    next();
  };
};

/**
 * Cleanup expired rate limit entries (call periodically)
 */
export const cleanupRateLimitStore = () => {
  const now = Date.now();
  Object.keys(rateLimitStore).forEach(key => {
    if (now > rateLimitStore[key].resetTime) {
      delete rateLimitStore[key];
    }
  });
};

// Run cleanup every 5 minutes
setInterval(cleanupRateLimitStore, 5 * 60 * 1000);
