import { Router, Request, Response } from 'express';
import { body, validationResult, query } from 'express-validator';
import { prisma } from '../utils/database';
import { authenticateToken, requireUser, AuthenticatedRequest } from '../middleware/auth';
import { createError, validationError, notFoundError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

// Validation middleware
const validatePipeline = [
  body('name').isLength({ min: 1, max: 255 }),
  body('type').isIn(['GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS', 'AZURE_DEVOPS', 'CIRCLE_CI', 'TRAVIS_CI']),
  body('repository').isLength({ min: 1, max: 500 }),
  body('config').isObject()
];

// Get all pipelines with pagination and filtering
router.get('/', authenticateToken, [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('type').optional().isIn(['GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS', 'AZURE_DEVOPS', 'CIRCLE_CI', 'TRAVIS_CI']),
  query('status').optional().isIn(['SUCCESS', 'FAILED', 'RUNNING', 'PENDING', 'UNKNOWN', 'DISABLED']),
  query('search').optional().isString()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw validationError(errors.array()[0].msg);
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const type = req.query.type as string;
    const status = req.query.status as string;
    const search = req.query.search as string;

    // Build where clause
    const where: any = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { repository: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get pipelines with metrics
    const [pipelines, total] = await Promise.all([
      prisma.pipeline.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: {
            select: { builds: true }
          },
          builds: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              status: true,
              duration: true,
              createdAt: true
            }
          }
        }
      }),
      prisma.pipeline.count({ where })
    ]);

    // Calculate metrics for each pipeline
    const pipelinesWithMetrics = await Promise.all(
      pipelines.map(async (pipeline) => {
        const metrics = await prisma.metric.findMany({
          where: { pipelineId: pipeline.id },
          orderBy: { timestamp: 'desc' },
          take: 1
        });

        const successRate = metrics.find(m => m.metricType === 'SUCCESS_RATE')?.value || 0;
        const avgBuildTime = metrics.find(m => m.metricType === 'BUILD_TIME')?.value || 0;

        return {
          id: pipeline.id,
          name: pipeline.name,
          type: pipeline.type,
          repository: pipeline.repository,
          status: pipeline.status,
          lastBuild: pipeline.builds[0] || null,
          metrics: {
            successRate: Number(successRate),
            avgBuildTime: Number(avgBuildTime),
            totalBuilds: pipeline._count.builds
          },
          createdAt: pipeline.createdAt,
          updatedAt: pipeline.updatedAt
        };
      })
    );

    res.json({
      success: true,
      data: {
        pipelines: pipelinesWithMetrics,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Get pipeline by ID
router.get('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const pipeline = await prisma.pipeline.findUnique({
      where: { id },
      include: {
        builds: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            duration: true,
            commitHash: true,
            branch: true,
            triggerType: true,
            startTime: true,
            endTime: true,
            createdAt: true
          }
        },
        metrics: {
          orderBy: { timestamp: 'desc' },
          take: 100
        }
      }
    });

    if (!pipeline) {
      throw notFoundError('Pipeline');
    }

    res.json({
      success: true,
      data: pipeline
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Create new pipeline
router.post('/', authenticateToken, requireUser, validatePipeline, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw validationError(errors.array()[0].msg);
    }

    const { name, type, repository, config } = req.body;

    // Check if pipeline with same name already exists
    const existingPipeline = await prisma.pipeline.findFirst({
      where: { name }
    });

    if (existingPipeline) {
      throw createError('Pipeline with this name already exists', 409);
    }

    const pipeline = await prisma.pipeline.create({
      data: {
        name,
        type,
        repository,
        config,
        status: 'UNKNOWN'
      }
    });

    logger.info(`New pipeline created: ${pipeline.name} by user ${req.user?.email}`);

    res.status(201).json({
      success: true,
      message: 'Pipeline created successfully',
      data: pipeline
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Update pipeline
router.put('/:id', authenticateToken, requireUser, validatePipeline, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw validationError(errors.array()[0].msg);
    }

    const { id } = req.params;
    const { name, type, repository, config } = req.body;

    // Check if pipeline exists
    const existingPipeline = await prisma.pipeline.findUnique({
      where: { id }
    });

    if (!existingPipeline) {
      throw notFoundError('Pipeline');
    }

    // Check if name is being changed and if it conflicts
    if (name !== existingPipeline.name) {
      const nameConflict = await prisma.pipeline.findFirst({
        where: { name, id: { not: id } }
      });

      if (nameConflict) {
        throw createError('Pipeline with this name already exists', 409);
      }
    }

    const updatedPipeline = await prisma.pipeline.update({
      where: { id },
      data: {
        name,
        type,
        repository,
        config,
        updatedAt: new Date()
      }
    });

    logger.info(`Pipeline updated: ${updatedPipeline.name} by user ${req.user?.email}`);

    res.json({
      success: true,
      message: 'Pipeline updated successfully',
      data: updatedPipeline
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Delete pipeline
router.delete('/:id', authenticateToken, requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const pipeline = await prisma.pipeline.findUnique({
      where: { id }
    });

    if (!pipeline) {
      throw notFoundError('Pipeline');
    }

    // Delete pipeline (cascades to builds, stages, metrics, and alerts)
    await prisma.pipeline.delete({
      where: { id }
    });

    logger.info(`Pipeline deleted: ${pipeline.name} by user ${req.user?.email}`);

    res.json({
      success: true,
      message: 'Pipeline deleted successfully'
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Get pipeline metrics
router.get('/:id/metrics', authenticateToken, [
  query('period').optional().isIn(['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']),
  query('limit').optional().isInt({ min: 1, max: 1000 }).toInt()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw validationError(errors.array()[0].msg);
    }

    const { id } = req.params;
    const period = req.query.period as string || 'DAILY';
    const limit = parseInt(req.query.limit as string) || 30;

    // Check if pipeline exists
    const pipeline = await prisma.pipeline.findUnique({
      where: { id }
    });

    if (!pipeline) {
      throw notFoundError('Pipeline');
    }

    const metrics = await prisma.metric.findMany({
      where: {
        pipelineId: id,
        period
      },
      orderBy: { timestamp: 'desc' },
      take: limit
    });

    res.json({
      success: true,
      data: {
        pipelineId: id,
        period,
        metrics
      }
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Test pipeline connection
router.post('/:id/test', authenticateToken, requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const pipeline = await prisma.pipeline.findUnique({
      where: { id }
    });

    if (!pipeline) {
      throw notFoundError('Pipeline');
    }

    // This would typically test the connection to the external CI/CD system
    // For now, we'll simulate a successful test
    logger.info(`Pipeline connection tested: ${pipeline.name} by user ${req.user?.email}`);

    res.json({
      success: true,
      message: 'Pipeline connection test successful',
      data: {
        status: 'connected',
        lastChecked: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

export { router as pipelineRoutes };
