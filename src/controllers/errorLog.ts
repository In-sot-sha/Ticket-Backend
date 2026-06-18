import { Request, Response } from 'express';
import { prisma } from '../prisma';

/**
 * Report a frontend error
 * POST /api/errors/report
 */
export const reportError = async (req: Request, res: Response) => {
  try {
    const { message, stack, type = 'ERROR', severity = 'MEDIUM', userAgent, url, context } = req.body;
    
    // Validate required fields
    if (!message) {
      return res.status(400).json({ message: 'Error message is required' });
    }

    // Get user ID from auth header if available
    const userId = (req as any).user?.id || null;

    // Create error log
    const errorLog = await prisma.errorLog.create({
      data: {
        message: message.substring(0, 500), // Limit message length
        stack: stack ? stack.substring(0, 10000) : null, // Limit stack trace
        type: type.toUpperCase(),
        severity: severity.toUpperCase(),
        userId,
        userAgent: userAgent ? userAgent.substring(0, 500) : null,
        url: url ? url.substring(0, 500) : null,
        context: context || null,
        resolved: false,
      },
    });

    // Log to console in development
    if (process.env.NODE_ENV !== 'production') {
      console.error('[Frontend Error]', {
        message,
        severity,
        url,
        userId,
      });
    }

    return res.status(201).json({
      success: true,
      errorId: errorLog.id,
      message: 'Error logged successfully',
    });
  } catch (error) {
    console.error('[Error Report Failed]', error);
    return res.status(500).json({ message: 'Failed to log error' });
  }
};

/**
 * Get all unresolved errors (admin only)
 * GET /api/errors
 */
export const getErrors = async (req: Request, res: Response) => {
  try {
    const { resolved = false, severity, limit = 50, offset = 0 } = req.query;

    const where: any = {
      resolved: resolved === 'true' ? true : resolved === 'false' ? false : undefined,
    };

    if (severity) {
      where.severity = (severity as string).toUpperCase();
    }

    const [errors, total] = await Promise.all([
      prisma.errorLog.findMany({
        where,
        include: { user: { select: { id: true, email: true, firstName: true } } },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit as string) || 50,
        skip: parseInt(offset as string) || 0,
      }),
      prisma.errorLog.count({ where }),
    ]);

    return res.json({
      errors,
      pagination: {
        total,
        limit: parseInt(limit as string) || 50,
        offset: parseInt(offset as string) || 0,
        pages: Math.ceil(total / (parseInt(limit as string) || 50)),
      },
    });
  } catch (error) {
    console.error('[Get Errors Failed]', error);
    return res.status(500).json({ message: 'Failed to fetch errors' });
  }
};

/**
 * Mark error as resolved
 * PATCH /api/errors/:id/resolve
 */
export const resolveError = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const errorLog = await prisma.errorLog.update({
      where: { id: parseInt(id) },
      data: { resolved: true },
    });

    return res.json({
      success: true,
      message: 'Error marked as resolved',
      errorLog,
    });
  } catch (error) {
    console.error('[Resolve Error Failed]', error);
    return res.status(500).json({ message: 'Failed to resolve error' });
  }
};

/**
 * Get error statistics
 * GET /api/errors/stats
 */
export const getErrorStats = async (req: Request, res: Response) => {
  try {
    const stats = await prisma.errorLog.groupBy({
      by: ['severity'],
      _count: true,
      where: { resolved: false },
    });

    const byType = await prisma.errorLog.groupBy({
      by: ['type'],
      _count: true,
      where: { resolved: false },
    });

    const total = await prisma.errorLog.count({ where: { resolved: false } });

    return res.json({
      total,
      bySeverity: stats,
      byType,
    });
  } catch (error) {
    console.error('[Get Error Stats Failed]', error);
    return res.status(500).json({ message: 'Failed to fetch error stats' });
  }
};
