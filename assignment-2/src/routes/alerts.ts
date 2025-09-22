import { Router, Request, Response } from 'express';
import { body, validationResult, query } from 'express-validator';
import { prisma } from '../utils/database';
import { authenticateToken, requireUser, AuthenticatedRequest } from '../middleware/auth';
import { createError, validationError, notFoundError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { sendNotification } from '../services/notificationService';

const router = Router();

// Validation middleware
const validateAlert = [
  body('name').isLength({ min: 1, max: 255 }),
  body('conditionType').isIn(['FAILURE', 'BUILD_TIME', 'SUCCESS_RATE', 'QUEUE_LENGTH', 'PIPELINE_DOWN']),
  body('threshold').isNumeric(),
  body('notificationChannels').isObject(),
  body('pipelineId').optional().isString()
];

// Get all alerts
router.get('/', authenticateToken, [
  query('pipelineId').optional().isString(),
  query('isActive').optional().isBoolean()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw validationError(errors.array()[0].msg);
    }

    const pipelineId = req.query.pipelineId as string;
    const isActive = req.query.isActive as string;

    const where: any = {};
    if (pipelineId) where.pipelineId = pipelineId;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const alerts = await prisma.alert.findMany({
      where,
      include: {
        pipeline: {
          select: {
            id: true,
            name: true,
            type: true
          }
        },
        user: {
          select: {
            username: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: alerts
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Get alert by ID
router.get('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const alert = await prisma.alert.findUnique({
      where: { id },
      include: {
        pipeline: {
          select: {
            id: true,
            name: true,
            type: true
          }
        },
        user: {
          select: {
            username: true,
            email: true
          }
        },
        alertHistory: {
          take: 10,
          orderBy: { sentAt: 'desc' }
        }
      }
    });

    if (!alert) {
      throw notFoundError('Alert');
    }

    res.json({
      success: true,
      data: alert
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Create new alert
router.post('/', authenticateToken, requireUser, validateAlert, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw validationError(errors.array()[0].msg);
    }

    const { name, conditionType, threshold, notificationChannels, pipelineId } = req.body;

    // Check if pipeline exists if specified
    if (pipelineId) {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: pipelineId }
      });

      if (!pipeline) {
        throw notFoundError('Pipeline');
      }
    }

    const alert = await prisma.alert.create({
      data: {
        name,
        conditionType,
        threshold,
        notificationChannels,
        pipelineId,
        createdBy: req.user!.id
      },
      include: {
        pipeline: {
          select: {
            name: true
          }
        }
      }
    });

    logger.info(`New alert created: ${alert.name} by user ${req.user?.email}`);

    res.status(201).json({
      success: true,
      message: 'Alert created successfully',
      data: alert
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Update alert
router.put('/:id', authenticateToken, requireUser, validateAlert, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw validationError(errors.array()[0].msg);
    }

    const { id } = req.params;
    const { name, conditionType, threshold, notificationChannels, pipelineId, isActive } = req.body;

    // Check if alert exists
    const existingAlert = await prisma.alert.findUnique({
      where: { id }
    });

    if (!existingAlert) {
      throw notFoundError('Alert');
    }

    // Check if pipeline exists if specified
    if (pipelineId) {
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: pipelineId }
      });

      if (!pipeline) {
        throw notFoundError('Pipeline');
      }
    }

    const updatedAlert = await prisma.alert.update({
      where: { id },
      data: {
        name,
        conditionType,
        threshold,
        notificationChannels,
        pipelineId,
        isActive,
        updatedAt: new Date()
      },
      include: {
        pipeline: {
          select: {
            name: true
          }
        }
      }
    });

    logger.info(`Alert updated: ${updatedAlert.name} by user ${req.user?.email}`);

    res.json({
      success: true,
      message: 'Alert updated successfully',
      data: updatedAlert
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Delete alert
router.delete('/:id', authenticateToken, requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const alert = await prisma.alert.findUnique({
      where: { id }
    });

    if (!alert) {
      throw notFoundError('Alert');
    }

    // Delete alert (cascades to alert history)
    await prisma.alert.delete({
      where: { id }
    });

    logger.info(`Alert deleted: ${alert.name} by user ${req.user?.email}`);

    res.json({
      success: true,
      message: 'Alert deleted successfully'
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Test notification
router.post('/test', authenticateToken, requireUser, [
  body('notificationChannels').isObject()
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw validationError(errors.array()[0].msg);
    }

    const { notificationChannels } = req.body;

    // Send test notification
    const result = await sendNotification({
      message: 'This is a test notification from the CI/CD Pipeline Health Dashboard',
      severity: 'INFO',
      channels: notificationChannels,
      metadata: {
        test: true,
        timestamp: new Date().toISOString()
      }
    });

    logger.info(`Test notification sent by user ${req.user?.email}`);

    res.json({
      success: true,
      message: 'Test notification sent successfully',
      data: result
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Toggle alert status
router.patch('/:id/toggle', authenticateToken, requireUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const alert = await prisma.alert.findUnique({
      where: { id }
    });

    if (!alert) {
      throw notFoundError('Alert');
    }

    const updatedAlert = await prisma.alert.update({
      where: { id },
      data: {
        isActive: !alert.isActive,
        updatedAt: new Date()
      }
    });

    const status = updatedAlert.isActive ? 'enabled' : 'disabled';
    logger.info(`Alert ${status}: ${updatedAlert.name} by user ${req.user?.email}`);

    res.json({
      success: true,
      message: `Alert ${status} successfully`,
      data: updatedAlert
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Get alert history
router.get('/:id/history', authenticateToken, [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw validationError(errors.array()[0].msg);
    }

    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Check if alert exists
    const alert = await prisma.alert.findUnique({
      where: { id }
    });

    if (!alert) {
      throw notFoundError('Alert');
    }

    const [history, total] = await Promise.all([
      prisma.alertHistory.findMany({
        where: { alertId: id },
        skip,
        take: limit,
        orderBy: { sentAt: 'desc' },
        include: {
          build: {
            select: {
              id: true,
              status: true,
              pipeline: {
                select: {
                  name: true
                }
              }
            }
          }
        }
      }),
      prisma.alertHistory.count({
        where: { alertId: id }
      })
    ]);

    res.json({
      success: true,
      data: {
        alertId: id,
        history,
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

export { router as alertRoutes };
