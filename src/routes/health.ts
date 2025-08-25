import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';

const router = Router();

// Basic health check
router.get('/', async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: { message: 'Health check failed' }
    });
  }
});

// Detailed health check
router.get('/detailed', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    
    // Check database connectivity
    let dbStatus = 'unknown';
    let dbResponseTime = 0;
    
    try {
      const dbStartTime = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      dbResponseTime = Date.now() - dbStartTime;
      dbStatus = 'healthy';
    } catch (error) {
      dbStatus = 'unhealthy';
      logger.error('Database health check failed:', error);
    }

    // Check memory usage
    const memoryUsage = process.memoryUsage();
    const memoryStatus = memoryUsage.heapUsed / memoryUsage.heapTotal < 0.9 ? 'healthy' : 'warning';

    // Check CPU usage (basic)
    const cpuUsage = process.cpuUsage();
    const cpuStatus = 'healthy'; // Simplified for now

    const totalResponseTime = Date.now() - startTime;

    const healthStatus = {
      overall: dbStatus === 'healthy' && memoryStatus === 'healthy' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      responseTime: totalResponseTime,
      components: {
        database: {
          status: dbStatus,
          responseTime: dbResponseTime
        },
        memory: {
          status: memoryStatus,
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          external: Math.round(memoryUsage.external / 1024 / 1024)
        },
        cpu: {
          status: cpuStatus,
          user: Math.round(cpuUsage.user / 1000),
          system: Math.round(cpuUsage.system / 1000)
        }
      }
    };

    // Set appropriate status code
    const statusCode = healthStatus.overall === 'healthy' ? 200 : 503;

    res.status(statusCode).json({
      success: true,
      data: healthStatus
    });
  } catch (error) {
    logger.error('Detailed health check failed:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: { message: 'Detailed health check failed' }
    });
  }
});

// Database health check
router.get('/database', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    
    // Test basic query
    await prisma.$queryRaw`SELECT 1`;
    
    // Test connection pool
    const connectionTest = await prisma.$queryRaw`SELECT version()`;
    
    const responseTime = Date.now() - startTime;

    res.json({
      success: true,
      status: 'healthy',
      responseTime,
      timestamp: new Date().toISOString(),
      database: {
        type: 'PostgreSQL',
        version: connectionTest[0]?.version || 'unknown',
        connectionPool: 'active'
      }
    });
  } catch (error) {
    logger.error('Database health check failed:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: { message: 'Database connection failed' }
    });
  }
});

// System resources health check
router.get('/resources', async (req: Request, res: Response) => {
  try {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Calculate memory percentages
    const heapUsedPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    const externalPercent = (memoryUsage.external / memoryUsage.heapTotal) * 100;

    const resourceStatus = {
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
        heapUsedPercent: Math.round(heapUsedPercent * 100) / 100,
        externalPercent: Math.round(externalPercent * 100) / 100,
        status: heapUsedPercent < 80 ? 'healthy' : heapUsedPercent < 90 ? 'warning' : 'critical'
      },
      cpu: {
        user: Math.round(cpuUsage.user / 1000),
        system: Math.round(cpuUsage.system / 1000),
        status: 'healthy' // Simplified for now
      },
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        version: process.version,
        platform: process.platform,
        arch: process.arch
      }
    };

    // Determine overall status
    const overallStatus = resourceStatus.memory.status === 'critical' ? 'critical' : 
                         resourceStatus.memory.status === 'warning' ? 'warning' : 'healthy';

    const statusCode = overallStatus === 'healthy' ? 200 : 
                      overallStatus === 'warning' ? 200 : 503;

    res.status(statusCode).json({
      success: true,
      status: overallStatus,
      timestamp: new Date().toISOString(),
      data: resourceStatus
    });
  } catch (error) {
    logger.error('Resource health check failed:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: { message: 'Resource health check failed' }
    });
  }
});

// Readiness check (for Kubernetes)
router.get('/ready', async (req: Request, res: Response) => {
  try {
    // Check if the application is ready to serve traffic
    const checks = {
      database: false,
      memory: false,
      startup: true // Assuming if this endpoint is reachable, startup is complete
    };

    // Check database
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch (error) {
      logger.error('Database readiness check failed:', error);
    }

    // Check memory
    const memoryUsage = process.memoryUsage();
    const heapUsedPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    checks.memory = heapUsedPercent < 95; // Allow up to 95% memory usage

    const isReady = Object.values(checks).every(check => check === true);

    if (isReady) {
      res.json({
        success: true,
        status: 'ready',
        timestamp: new Date().toISOString(),
        checks
      });
    } else {
      res.status(503).json({
        success: false,
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        checks
      });
    }
  } catch (error) {
    logger.error('Readiness check failed:', error);
    res.status(500).json({
      success: false,
      status: 'not_ready',
      error: { message: 'Readiness check failed' }
    });
  }
});

// Liveness check (for Kubernetes)
router.get('/live', async (req: Request, res: Response) => {
  try {
    // Simple check to see if the process is alive
    res.json({
      success: true,
      status: 'alive',
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime()
    });
  } catch (error) {
    logger.error('Liveness check failed:', error);
    res.status(500).json({
      success: false,
      status: 'not_alive',
      error: { message: 'Liveness check failed' }
    });
  }
});

export { router as healthRoutes };
