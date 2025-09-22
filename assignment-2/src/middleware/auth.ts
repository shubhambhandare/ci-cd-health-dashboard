import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/database';
import { unauthorizedError, forbiddenError } from './errorHandler';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    username: string;
    role: string;
  };
}

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      throw unauthorizedError('Access token required');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    // Check if user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        isActive: true
      }
    });

    if (!user || !user.isActive) {
      throw unauthorizedError('User not found or inactive');
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof Error && error.name === 'JsonWebTokenError') {
      next(unauthorizedError('Invalid token'));
    } else if (error instanceof Error && error.name === 'TokenExpiredError') {
      next(unauthorizedError('Token expired'));
    } else {
      next(error);
    }
  }
};

export const requireRole = (roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(unauthorizedError('Authentication required'));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(forbiddenError('Insufficient permissions'));
      return;
    }

    next();
  };
};

export const requireAdmin = requireRole(['ADMIN']);
export const requireUser = requireRole(['ADMIN', 'USER']);
export const requireViewer = requireRole(['ADMIN', 'USER', 'VIEWER']);
