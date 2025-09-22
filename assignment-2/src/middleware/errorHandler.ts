import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export const errorHandler = (
  error: AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const statusCode = error.statusCode || 500;
  const message = error.message || 'Internal Server Error';

  // Log the error
  logger.error(`Error ${statusCode}: ${message}`, {
    error: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  // Don't leak error details in production
  const responseMessage = process.env.NODE_ENV === 'production' && statusCode === 500
    ? 'Internal Server Error'
    : message;

  res.status(statusCode).json({
    success: false,
    error: {
      message: responseMessage,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
    },
  });
};

export const createError = (message: string, statusCode: number = 500): AppError => {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.isOperational = true;
  return error;
};

export const notFoundError = (resource: string = 'Resource'): AppError => {
  return createError(`${resource} not found`, 404);
};

export const validationError = (message: string): AppError => {
  return createError(message, 400);
};

export const unauthorizedError = (message: string = 'Unauthorized'): AppError => {
  return createError(message, 401);
};

export const forbiddenError = (message: string = 'Forbidden'): AppError => {
  return createError(message, 403);
};

export const conflictError = (message: string): AppError => {
  return createError(message, 409);
};
