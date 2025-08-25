import { Router, Request, Response } from 'express';
import { query, validationResult } from 'express-validator';
import { prisma } from '../utils/database';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { createError, validationError, notFoundError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { processWebhook } from '../services/webhookProcessor';

const router = Router();

// Get all builds with pagination and filtering
router.get('/', authenticateToken, [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('pipelineId').optional().isString(),
  query('status').optional().isIn(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED']),
  query('branch').optional().isString(),
  query('triggerType').optional().isIn(['PUSH', 'PULL_REQUEST', 'MANUAL', 'SCHEDULED', 'WEBHOOK'])
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw validationError(errors.array()[0].msg);
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const pipelineId = req.query.pipelineId as string;
    const status = req.query.status as string;
    const branch = req.query.branch as string;
    const triggerType = req.query.triggerType as string;

    // Build where clause
    const where: any = {};
    if (pipelineId) where.pipelineId = pipelineId;
    if (status) where.status = status;
    if (branch) where.branch = { contains: branch, mode: 'insensitive' };
    if (triggerType) where.triggerType = triggerType;

    // Get builds with pipeline info
    const [builds, total] = await Promise.all([
      prisma.build.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          pipeline: {
            select: {
              id: true,
              name: true,
              type: true,
              repository: true
            }
          },
          stages: {
            select: {
              id: true,
              name: true,
              status: true,
              duration: true
            }
          }
        }
      }),
      prisma.build.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        builds,
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

// Get build by ID
router.get('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const build = await prisma.build.findUnique({
      where: { id },
      include: {
        pipeline: {
          select: {
            id: true,
            name: true,
            type: true,
            repository: true
          }
        },
        stages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!build) {
      throw notFoundError('Build');
    }

    res.json({
      success: true,
      data: build
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Get build logs
router.get('/:id/logs', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const build = await prisma.build.findUnique({
      where: { id },
      include: {
        stages: {
          select: {
            name: true,
            logs: true,
            status: true,
            duration: true
          }
        }
      }
    });

    if (!build) {
      throw notFoundError('Build');
    }

    res.json({
      success: true,
      data: {
        buildId: id,
        stages: build.stages
      }
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Webhook endpoint for receiving build updates
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const webhookData = req.body;
    
    logger.info('Webhook received', {
      source: webhookData.source || 'unknown',
      event: webhookData.event || 'unknown'
    });

    // Process the webhook asynchronously
    processWebhook(webhookData).catch(error => {
      logger.error('Error processing webhook:', error);
    });

    // Always respond quickly to webhook sender
    res.status(200).json({
      success: true,
      message: 'Webhook received and queued for processing'
    });
  } catch (error) {
    logger.error('Error handling webhook:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Internal server error' }
    });
  }
});

// Manual build trigger
router.post('/:pipelineId/trigger', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { pipelineId } = req.params;
    const { branch = 'main', commitHash, triggerType = 'MANUAL' } = req.body;

    // Check if pipeline exists
    const pipeline = await prisma.pipeline.findUnique({
      where: { id: pipelineId }
    });

    if (!pipeline) {
      throw notFoundError('Pipeline');
    }

    // Create a new build record
    const build = await prisma.build.create({
      data: {
        pipelineId,
        externalId: `manual-${Date.now()}`,
        status: 'PENDING',
        branch,
        commitHash,
        triggerType,
        metadata: {
          triggeredBy: req.user?.email,
          triggerReason: 'Manual trigger'
        }
      }
    });

    logger.info(`Manual build triggered: ${build.id} for pipeline ${pipeline.name} by user ${req.user?.email}`);

    // In a real implementation, this would trigger the actual CI/CD pipeline
    // For now, we'll simulate the build process
    setTimeout(async () => {
      try {
        await prisma.build.update({
          where: { id: build.id },
          data: {
            status: 'RUNNING',
            startTime: new Date()
          }
        });

        // Simulate build completion after 30 seconds
        setTimeout(async () => {
          try {
            await prisma.build.update({
              where: { id: build.id },
              data: {
                status: 'SUCCESS',
                endTime: new Date(),
                duration: 30
              }
            });

            // Update pipeline status
            await prisma.pipeline.update({
              where: { id: pipelineId },
              data: {
                status: 'SUCCESS',
                lastBuildId: build.id
              }
            });

            logger.info(`Build completed: ${build.id} - SUCCESS`);
          } catch (error) {
            logger.error('Error updating build status:', error);
          }
        }, 30000);
      } catch (error) {
        logger.error('Error starting build:', error);
      }
    }, 2000);

    res.status(201).json({
      success: true,
      message: 'Build triggered successfully',
      data: {
        buildId: build.id,
        status: 'PENDING'
      }
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Cancel build
router.post('/:id/cancel', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const build = await prisma.build.findUnique({
      where: { id },
      include: {
        pipeline: {
          select: { name: true }
        }
      }
    });

    if (!build) {
      throw notFoundError('Build');
    }

    if (build.status !== 'RUNNING' && build.status !== 'PENDING') {
      throw createError('Only running or pending builds can be cancelled', 400);
    }

    // Update build status
    const updatedBuild = await prisma.build.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        endTime: new Date()
      }
    });

    logger.info(`Build cancelled: ${id} by user ${req.user?.email}`);

    res.json({
      success: true,
      message: 'Build cancelled successfully',
      data: updatedBuild
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

export { router as buildRoutes };
