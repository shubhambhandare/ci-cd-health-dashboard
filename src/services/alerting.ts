import cron from 'node-cron';
import { logger } from '../utils/logger';
import { prisma } from '../utils/database';
import { sendAlertNotification } from './notificationService';
import { broadcastAlert } from './websocket';

export const setupAlerting = (): void => {
  logger.info('Setting up alerting service');

  // Check alerts every minute
  cron.schedule('* * * * *', async () => {
    try {
      await evaluateAlerts();
    } catch (error) {
      logger.error('Error evaluating alerts:', error);
    }
  });

  // Clean up old alert history every day at 2 AM
  cron.schedule('0 2 * * *', async () => {
    try {
      await cleanupAlertHistory();
      logger.info('Alert history cleanup completed');
    } catch (error) {
      logger.error('Error cleaning up alert history:', error);
    }
  });

  logger.info('Alerting service initialized');
};

const evaluateAlerts = async (): Promise<void> => {
  try {
    const activeAlerts = await prisma.alert.findMany({
      where: { isActive: true },
      include: {
        pipeline: {
          select: {
            id: true,
            name: true,
            status: true
          }
        }
      }
    });

    for (const alert of activeAlerts) {
      await evaluateAlert(alert);
    }
  } catch (error) {
    logger.error('Error evaluating alerts:', error);
  }
};

const evaluateAlert = async (alert: any): Promise<void> => {
  try {
    let shouldTrigger = false;
    let message = '';
    let severity = 'INFO';

    switch (alert.conditionType) {
      case 'FAILURE':
        shouldTrigger = await evaluateFailureCondition(alert);
        if (shouldTrigger) {
          message = 'Build failure detected';
          severity = 'ERROR';
        }
        break;

      case 'BUILD_TIME':
        shouldTrigger = await evaluateBuildTimeCondition(alert);
        if (shouldTrigger) {
          message = `Build time exceeded threshold: ${alert.threshold} seconds`;
          severity = 'WARNING';
        }
        break;

      case 'SUCCESS_RATE':
        shouldTrigger = await evaluateSuccessRateCondition(alert);
        if (shouldTrigger) {
          message = `Success rate dropped below threshold: ${alert.threshold}%`;
          severity = 'WARNING';
        }
        break;

      case 'QUEUE_LENGTH':
        shouldTrigger = await evaluateQueueLengthCondition(alert);
        if (shouldTrigger) {
          message = `Queue length exceeded threshold: ${alert.threshold} builds`;
          severity = 'WARNING';
        }
        break;

      case 'PIPELINE_DOWN':
        shouldTrigger = await evaluatePipelineDownCondition(alert);
        if (shouldTrigger) {
          message = 'Pipeline appears to be down or inactive';
          severity = 'CRITICAL';
        }
        break;

      default:
        logger.warn(`Unknown alert condition type: ${alert.conditionType}`);
        return;
    }

    if (shouldTrigger) {
      await triggerAlert(alert, message, severity);
    }

  } catch (error) {
    logger.error(`Error evaluating alert ${alert.id}:`, error);
  }
};

const evaluateFailureCondition = async (alert: any): Promise<boolean> => {
  try {
    if (!alert.pipelineId) {
      // Global failure alert - check all pipelines
      const recentFailedBuilds = await prisma.build.findMany({
        where: {
          status: 'FAILED',
          createdAt: {
            gte: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
          }
        }
      });

      return recentFailedBuilds.length > 0;
    } else {
      // Pipeline-specific failure alert
      const recentFailedBuilds = await prisma.build.findMany({
        where: {
          pipelineId: alert.pipelineId,
          status: 'FAILED',
          createdAt: {
            gte: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
          }
        }
      });

      return recentFailedBuilds.length > 0;
    }
  } catch (error) {
    logger.error('Error evaluating failure condition:', error);
    return false;
  }
};

const evaluateBuildTimeCondition = async (alert: any): Promise<boolean> => {
  try {
    if (!alert.pipelineId) {
      // Global build time alert
      const recentBuilds = await prisma.build.findMany({
        where: {
          status: { in: ['SUCCESS', 'FAILED'] },
          duration: { not: null },
          createdAt: {
            gte: new Date(Date.now() - 60 * 60 * 1000) // Last hour
          }
        }
      });

      if (recentBuilds.length === 0) return false;

      const avgBuildTime = recentBuilds.reduce((sum, build) => sum + build.duration!, 0) / recentBuilds.length;
      return avgBuildTime > alert.threshold;
    } else {
      // Pipeline-specific build time alert
      const recentBuilds = await prisma.build.findMany({
        where: {
          pipelineId: alert.pipelineId,
          status: { in: ['SUCCESS', 'FAILED'] },
          duration: { not: null },
          createdAt: {
            gte: new Date(Date.now() - 60 * 60 * 1000) // Last hour
          }
        }
      });

      if (recentBuilds.length === 0) return false;

      const avgBuildTime = recentBuilds.reduce((sum, build) => sum + build.duration!, 0) / recentBuilds.length;
      return avgBuildTime > alert.threshold;
    }
  } catch (error) {
    logger.error('Error evaluating build time condition:', error);
    return false;
  }
};

const evaluateSuccessRateCondition = async (alert: any): Promise<boolean> => {
  try {
    if (!alert.pipelineId) {
      // Global success rate alert
      const recentBuilds = await prisma.build.findMany({
        where: {
          status: { in: ['SUCCESS', 'FAILED'] },
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        }
      });

      if (recentBuilds.length === 0) return false;

      const successfulBuilds = recentBuilds.filter(build => build.status === 'SUCCESS').length;
      const successRate = (successfulBuilds / recentBuilds.length) * 100;

      return successRate < alert.threshold;
    } else {
      // Pipeline-specific success rate alert
      const recentBuilds = await prisma.build.findMany({
        where: {
          pipelineId: alert.pipelineId,
          status: { in: ['SUCCESS', 'FAILED'] },
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
          }
        }
      });

      if (recentBuilds.length === 0) return false;

      const successfulBuilds = recentBuilds.filter(build => build.status === 'SUCCESS').length;
      const successRate = (successfulBuilds / recentBuilds.length) * 100;

      return successRate < alert.threshold;
    }
  } catch (error) {
    logger.error('Error evaluating success rate condition:', error);
    return false;
  }
};

const evaluateQueueLengthCondition = async (alert: any): Promise<boolean> => {
  try {
    if (!alert.pipelineId) {
      // Global queue length alert
      const queueLength = await prisma.build.count({
        where: {
          status: 'PENDING'
        }
      });

      return queueLength > alert.threshold;
    } else {
      // Pipeline-specific queue length alert
      const queueLength = await prisma.build.count({
        where: {
          pipelineId: alert.pipelineId,
          status: 'PENDING'
        }
      });

      return queueLength > alert.threshold;
    }
  } catch (error) {
    logger.error('Error evaluating queue length condition:', error);
    return false;
  }
};

const evaluatePipelineDownCondition = async (alert: any): Promise<boolean> => {
  try {
    if (!alert.pipelineId) {
      // Global pipeline down alert - check all pipelines
      const pipelines = await prisma.pipeline.findMany();
      
      for (const pipeline of pipelines) {
        const lastBuild = await prisma.build.findFirst({
          where: { pipelineId: pipeline.id },
          orderBy: { createdAt: 'desc' }
        });

        if (lastBuild) {
          const hoursSinceLastBuild = (Date.now() - lastBuild.createdAt.getTime()) / (1000 * 60 * 60);
          if (hoursSinceLastBuild > 24) {
            return true; // At least one pipeline is down
          }
        }
      }

      return false;
    } else {
      // Pipeline-specific down alert
      const lastBuild = await prisma.build.findFirst({
        where: { pipelineId: alert.pipelineId },
        orderBy: { createdAt: 'desc' }
      });

      if (!lastBuild) return true; // No builds ever

      const hoursSinceLastBuild = (Date.now() - lastBuild.createdAt.getTime()) / (1000 * 60 * 60);
      return hoursSinceLastBuild > 24;
    }
  } catch (error) {
    logger.error('Error evaluating pipeline down condition:', error);
    return false;
  }
};

const triggerAlert = async (alert: any, message: string, severity: string): Promise<void> => {
  try {
    // Check if we've already sent this alert recently (within the last 15 minutes)
    const recentAlert = await prisma.alertHistory.findFirst({
      where: {
        alertId: alert.id,
        message: message,
        sentAt: {
          gte: new Date(Date.now() - 15 * 60 * 1000) // Last 15 minutes
        }
      }
    });

    if (recentAlert) {
      logger.debug(`Alert ${alert.id} already sent recently, skipping`);
      return;
    }

    // Get the most recent build for context
    let buildId: string | undefined;
    if (alert.pipelineId) {
      const lastBuild = await prisma.build.findFirst({
        where: { pipelineId: alert.pipelineId },
        orderBy: { createdAt: 'desc' }
      });
      if (lastBuild) {
        buildId = lastBuild.id;
      }
    }

    // Send notification
    await sendAlertNotification(alert.id, message, severity, buildId);

    // Broadcast to WebSocket clients
    broadcastAlert({
      id: alert.id,
      name: alert.name,
      message,
      severity,
      pipelineId: alert.pipelineId,
      pipelineName: alert.pipeline?.name,
      timestamp: new Date().toISOString()
    });

    logger.info(`Alert triggered: ${alert.name} - ${message}`);

  } catch (error) {
    logger.error(`Error triggering alert ${alert.id}:`, error);
  }
};

const cleanupAlertHistory = async (): Promise<void> => {
  try {
    // Keep alert history for 90 days
    const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const deletedCount = await prisma.alertHistory.deleteMany({
      where: {
        sentAt: {
          lt: cutoffDate
        }
      }
    });

    logger.info(`Cleaned up ${deletedCount.count} old alert history records`);
  } catch (error) {
    logger.error('Error cleaning up alert history:', error);
  }
};

// Manual alert evaluation for testing
export const evaluateAlertManually = async (alertId: string): Promise<void> => {
  try {
    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
      include: {
        pipeline: {
          select: {
            id: true,
            name: true,
            status: true
          }
        }
      }
    });

    if (!alert) {
      throw new Error('Alert not found');
    }

    await evaluateAlert(alert);
    logger.info(`Manual alert evaluation completed for: ${alert.name}`);
  } catch (error) {
    logger.error(`Error in manual alert evaluation:`, error);
    throw error;
  }
};

// Get alert statistics
export const getAlertStatistics = async (): Promise<any> => {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get alert counts by severity for the last 24 hours
    const recentAlerts = await prisma.alertHistory.findMany({
      where: {
        sentAt: {
          gte: oneDayAgo
        }
      }
    });

    const alertCounts = {
      total: recentAlerts.length,
      bySeverity: {
        INFO: recentAlerts.filter(a => a.severity === 'INFO').length,
        WARNING: recentAlerts.filter(a => a.severity === 'WARNING').length,
        ERROR: recentAlerts.filter(a => a.severity === 'ERROR').length,
        CRITICAL: recentAlerts.filter(a => a.severity === 'CRITICAL').length
      }
    };

    // Get active alert count
    const activeAlertCount = await prisma.alert.count({
      where: { isActive: true }
    });

    // Get alert success rate
    const successfulAlerts = recentAlerts.filter(a => a.notificationStatus === 'SENT').length;
    const alertSuccessRate = recentAlerts.length > 0 ? (successfulAlerts / recentAlerts.length) * 100 : 0;

    return {
      alertCounts,
      activeAlertCount,
      alertSuccessRate: Math.round(alertSuccessRate * 100) / 100,
      period: '24h'
    };
  } catch (error) {
    logger.error('Error getting alert statistics:', error);
    throw error;
  }
};
