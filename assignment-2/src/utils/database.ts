import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

declare global {
  var __prisma: PrismaClient | undefined;
}

// Create a single instance of Prisma Client
export const prisma = globalThis.__prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  errorFormat: 'pretty',
});

// Store the instance globally in development to prevent multiple instances
if (process.env.NODE_ENV === 'development') {
  globalThis.__prisma = prisma;
}

// Database connection and health check
export const connectDatabase = async (): Promise<void> => {
  try {
    await prisma.$connect();
    logger.info('✅ Database connected successfully');
  } catch (error) {
    logger.error('❌ Database connection failed:', error);
    throw error;
  }
};

// Graceful database disconnection
export const disconnectDatabase = async (): Promise<void> => {
  try {
    await prisma.$disconnect();
    logger.info('✅ Database disconnected successfully');
  } catch (error) {
    logger.error('❌ Database disconnection failed:', error);
  }
};

// Database health check
export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error('Database health check failed:', error);
    return false;
  }
};

// Handle database errors
export const handleDatabaseError = (error: any): never => {
  logger.error('Database operation failed:', error);
  
  if (error.code === 'P2002') {
    throw new Error('A record with this unique field already exists');
  }
  
  if (error.code === 'P2025') {
    throw new Error('Record not found');
  }
  
  if (error.code === 'P2003') {
    throw new Error('Foreign key constraint failed');
  }
  
  throw new Error('Database operation failed');
};

// Transaction wrapper
export const withTransaction = async <T>(
  operation: () => Promise<T>
): Promise<T> => {
  return await prisma.$transaction(operation);
};

// Export default prisma client
export default prisma;
