import { Router, Request, Response } from 'express';
import { query, validationResult } from 'express-validator';
import { prisma } from '../utils/database';
import { authenticateToken } from '../middleware/auth';
import { validationError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

// Get dashboard overview metrics
router.get('/overview', authenticateToken, async (req: Request, res: Response) => {
  try {
    // Get overall statistics
    const [
      totalPipelines,
      totalBuilds,
      runningBuilds,
      failedBuilds,
      successBuilds
    ] = await Promise.all([
      prisma.pipeline.count(),
      prisma.build.count(),
      prisma.build.count({ where: { status: 'RUNNING' } }),
      prisma.build.count({ where: { status: 'FAILED' } }),
      prisma.build.count({ where: { status: 'SUCCESS' } })
    ]);

    // Calculate success rate
    const successRate = totalBuilds > 0 ? (successBuilds / totalBuilds) * 100 : 0;

    // Get recent builds for timeline
    const recentBuilds = await prisma.build.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        pipeline: {
          select: {
            id: true,
            name: true,
            type: true
          }
        }
      }
    });

    // Get pipeline status distribution
    const pipelineStatuses = await prisma.pipeline.groupBy({
      by: ['status'],
      _count: {
        status: true
      }
    });

    // Get build time statistics
    const buildTimeStats = await prisma.build.aggregate({
      where: {
        duration: { not: null },
        status: { in: ['SUCCESS', 'FAILED'] }
      },
      _avg: {
        duration: true
      },
      _min: {
        duration: true
      },
      _max: {
        duration: true
      }
    });

    res.json({
      success: true,
      data: {
        summary: {
          totalPipelines,
          totalBuilds,
          runningBuilds,
          failedBuilds,
          successBuilds,
          successRate: Math.round(successRate * 100) / 100
        },
        pipelineStatuses: pipelineStatuses.map(ps => ({
          status: ps.status,
          count: ps._count.status
        })),
        buildTimeStats: {
          average: Math.round(buildTimeStats._avg.duration || 0),
          minimum: buildTimeStats._min.duration || 0,
          maximum: buildTimeStats._max.duration || 0
        },
        recentBuilds
      }
    });
  } catch (error) {
    logger.error('Error getting overview metrics:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get overview metrics' }
    });
  }
});

// Get success rate trends
router.get('/success-rate', authenticateToken, [
  query('pipelineId').optional().isString(),
  query('period').optional().isIn(['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']),
  query('limit').optional().isInt({ min: 1, max: 1000 }).toInt()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw validationError(errors.array()[0].msg);
    }

    const pipelineId = req.query.pipelineId as string;
    const period = req.query.period as string || 'DAILY';
    const limit = parseInt(req.query.limit as string) || 30;

    const where: any = {
      metricType: 'SUCCESS_RATE'
    };
    if (pipelineId) where.pipelineId = pipelineId;

    const metrics = await prisma.metric.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        pipeline: {
          select: {
            name: true,
            type: true
          }
        }
      }
    });

    res.json({
      success: true,
      data: {
        period,
        metrics: metrics.reverse() // Return in chronological order
      }
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Get build time analytics
router.get('/build-times', authenticateToken, [
  query('pipelineId').optional().isString(),
  query('period').optional().isIn(['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']),
  query('limit').optional().isInt({ min: 1, max: 1000 }).toInt()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw validationError(errors.array()[0].msg);
    }

    const pipelineId = req.query.pipelineId as string;
    const period = req.query.period as string || 'DAILY';
    const limit = parseInt(req.query.limit as string) || 30;

    const where: any = {
      metricType: 'BUILD_TIME'
    };
    if (pipelineId) where.pipelineId = pipelineId;

    const metrics = await prisma.metric.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        pipeline: {
          select: {
            name: true,
            type: true
          }
        }
      }
    });

    // Also get actual build duration data for comparison
    const buildWhere: any = {
      duration: { not: null },
      status: { in: ['SUCCESS', 'FAILED'] }
    };
    if (pipelineId) buildWhere.pipelineId = pipelineId;

    const buildDurations = await prisma.build.findMany({
      where: buildWhere,
      select: {
        duration: true,
        createdAt: true,
        status: true
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    res.json({
      success: true,
      data: {
        period,
        metrics: metrics.reverse(),
        buildDurations
      }
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Get failure analysis
router.get('/failures', authenticateToken, [
  query('pipelineId').optional().isString(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw validationError(errors.array()[0].msg);
    }

    const pipelineId = req.query.pipelineId as string;
    const limit = parseInt(req.query.limit as string) || 20;

    const where: any = {
      status: 'FAILED'
    };
    if (pipelineId) where.pipelineId = pipelineId;

    const failedBuilds = await prisma.build.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        pipeline: {
          select: {
            name: true,
            type: true
          }
        },
        stages: {
          where: { status: 'FAILED' },
          select: {
            name: true,
            logs: true
          }
        }
      }
    });

    // Get failure patterns by stage
    const stageFailures = await prisma.buildStage.groupBy({
      by: ['name'],
      where: { status: 'FAILED' },
      _count: {
        name: true
      },
      orderBy: {
        _count: {
          name: 'desc'
        }
      },
      take: 10
    });

    res.json({
      success: true,
      data: {
        failedBuilds,
        stageFailures: stageFailures.map(sf => ({
          stageName: sf.name,
          failureCount: sf._count.name
        }))
      }
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Get pipeline performance comparison
router.get('/pipeline-comparison', authenticateToken, async (req: Request, res: Response) => {
  try {
    const pipelines = await prisma.pipeline.findMany({
      include: {
        _count: {
          select: { builds: true }
        },
        builds: {
          where: {
            status: { in: ['SUCCESS', 'FAILED'] },
            duration: { not: null }
          },
          select: {
            status: true,
            duration: true
          }
        }
      }
    });

    const comparison = pipelines.map(pipeline => {
      const totalBuilds = pipeline._count.builds;
      const successfulBuilds = pipeline.builds.filter(b => b.status === 'SUCCESS').length;
      const successRate = totalBuilds > 0 ? (successfulBuilds / totalBuilds) * 100 : 0;
      
      const durations = pipeline.builds.map(b => b.duration!).filter(d => d > 0);
      const avgDuration = durations.length > 0 
        ? durations.reduce((sum, d) => sum + d, 0) / durations.length 
        : 0;

      return {
        id: pipeline.id,
        name: pipeline.name,
        type: pipeline.type,
        repository: pipeline.repository,
        totalBuilds,
        successRate: Math.round(successRate * 100) / 100,
        averageBuildTime: Math.round(avgDuration),
        lastStatus: pipeline.status
      };
    });

    // Sort by success rate descending
    comparison.sort((a, b) => b.successRate - a.successRate);

    res.json({
      success: true,
      data: comparison
    });
  } catch (error) {
    logger.error('Error getting pipeline comparison:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get pipeline comparison' }
    });
  }
});

// Get real-time metrics
router.get('/realtime', authenticateToken, async (req: Request, res: Response) => {
  try {
    // Get current running builds
    const runningBuilds = await prisma.build.findMany({
      where: { status: 'RUNNING' },
      include: {
        pipeline: {
          select: {
            name: true,
            type: true
          }
        }
      },
      orderBy: { startTime: 'asc' }
    });

    // Get recent activity (last 10 builds)
    const recentActivity = await prisma.build.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        pipeline: {
          select: {
            name: true,
            type: true
          }
        }
      }
    });

    // Get queue length (pending builds)
    const queueLength = await prisma.build.count({
      where: { status: 'PENDING' }
    });

    res.json({
      success: true,
      data: {
        runningBuilds,
        recentActivity,
        queueLength,
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error getting real-time metrics:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get real-time metrics' }
    });
  }
});

export { router as metricsRoutes };
