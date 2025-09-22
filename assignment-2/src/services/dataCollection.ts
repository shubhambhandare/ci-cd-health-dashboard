import cron from 'node-cron';
import { logger } from '../utils/logger';
import { prisma } from '../utils/database';
import { broadcastMetricsUpdate } from './websocket';

export const setupDataCollection = (): void => {
  logger.info('Setting up data collection service');

  // Schedule metrics calculation every hour
  cron.schedule('0 * * * *', async () => {
    try {
      await calculateAndStoreMetrics();
      logger.info('Hourly metrics calculation completed');
    } catch (error) {
      logger.error('Error in hourly metrics calculation:', error);
    }
  });

  // Schedule daily metrics calculation at midnight
  cron.schedule('0 0 * * *', async () => {
    try {
      await calculateDailyMetrics();
      logger.info('Daily metrics calculation completed');
    } catch (error) {
      logger.error('Error in daily metrics calculation:', error);
    }
  });

  // Schedule weekly metrics calculation on Sunday at 1 AM
  cron.schedule('0 1 * * 0', async () => {
    try {
      await calculateWeeklyMetrics();
      logger.info('Weekly metrics calculation completed');
    } catch (error) {
      logger.error('Error in weekly metrics calculation:', error);
    }
  });

  // Schedule monthly metrics calculation on the 1st at 2 AM
  cron.schedule('0 2 1 * *', async () => {
    try {
      await calculateMonthlyMetrics();
      logger.info('Monthly metrics calculation completed');
    } catch (error) {
      logger.error('Error in monthly metrics calculation:', error);
    }
  });

  // Schedule pipeline health checks every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      await checkPipelineHealth();
      logger.debug('Pipeline health check completed');
    } catch (error) {
      logger.error('Error in pipeline health check:', error);
    }
  });

  logger.info('Data collection service initialized');
};

const calculateAndStoreMetrics = async (): Promise<void> => {
  try {
    const pipelines = await prisma.pipeline.findMany();

    for (const pipeline of pipelines) {
      await calculatePipelineMetrics(pipeline.id, 'HOURLY');
    }
  } catch (error) {
    logger.error('Error calculating hourly metrics:', error);
  }
};

const calculateDailyMetrics = async (): Promise<void> => {
  try {
    const pipelines = await prisma.pipeline.findMany();

    for (const pipeline of pipelines) {
      await calculatePipelineMetrics(pipeline.id, 'DAILY');
    }
  } catch (error) {
    logger.error('Error calculating daily metrics:', error);
  }
};

const calculateWeeklyMetrics = async (): Promise<void> => {
  try {
    const pipelines = await prisma.pipeline.findMany();

    for (const pipeline of pipelines) {
      await calculatePipelineMetrics(pipeline.id, 'WEEKLY');
    }
  } catch (error) {
    logger.error('Error calculating weekly metrics:', error);
  }
};

const calculateMonthlyMetrics = async (): Promise<void> => {
  try {
    const pipelines = await prisma.pipeline.findMany();

    for (const pipeline of pipelines) {
      await calculatePipelineMetrics(pipeline.id, 'MONTHLY');
    }
  } catch (error) {
    logger.error('Error calculating monthly metrics:', error);
  }
};

const calculatePipelineMetrics = async (pipelineId: string, period: string): Promise<void> => {
  try {
    const now = new Date();
    let startDate: Date;

    // Calculate start date based on period
    switch (period) {
      case 'HOURLY':
        startDate = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case 'DAILY':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'WEEKLY':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'MONTHLY':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    // Get builds for the period
    const builds = await prisma.build.findMany({
      where: {
        pipelineId,
        createdAt: {
          gte: startDate,
          lte: now
        }
      }
    });

    if (builds.length === 0) {
      return;
    }

    // Calculate success rate
    const successfulBuilds = builds.filter(build => build.status === 'SUCCESS').length;
    const successRate = (successfulBuilds / builds.length) * 100;

    // Calculate average build time
    const buildsWithDuration = builds.filter(build => build.duration && build.duration > 0);
    const averageBuildTime = buildsWithDuration.length > 0 
      ? buildsWithDuration.reduce((sum, build) => sum + build.duration!, 0) / buildsWithDuration.length
      : 0;

    // Calculate failure count
    const failureCount = builds.filter(build => build.status === 'FAILED').length;

    // Calculate queue length (pending builds)
    const queueLength = await prisma.build.count({
      where: {
        pipelineId,
        status: 'PENDING'
      }
    });

    // Store metrics
    const metricsToCreate = [
      {
        pipelineId,
        metricType: 'SUCCESS_RATE',
        value: successRate,
        period,
        timestamp: now
      },
      {
        pipelineId,
        metricType: 'BUILD_TIME',
        value: averageBuildTime,
        period,
        timestamp: now
      },
      {
        pipelineId,
        metricType: 'FAILURE_COUNT',
        value: failureCount,
        period,
        timestamp: now
      },
      {
        pipelineId,
        metricType: 'QUEUE_LENGTH',
        value: queueLength,
        period,
        timestamp: now
      }
    ];

    // Use transaction to ensure all metrics are created together
    await prisma.$transaction(async (tx) => {
      for (const metric of metricsToCreate) {
        await tx.metric.create({
          data: metric
        });
      }
    });

    // Broadcast metrics update
    broadcastMetricsUpdate({
      pipelineId,
      period,
      metrics: metricsToCreate,
      timestamp: now.toISOString()
    });

    logger.debug(`Metrics calculated for pipeline ${pipelineId} (${period})`, {
      successRate: Math.round(successRate * 100) / 100,
      averageBuildTime: Math.round(averageBuildTime),
      failureCount,
      queueLength
    });

  } catch (error) {
    logger.error(`Error calculating metrics for pipeline ${pipelineId}:`, error);
  }
};

const checkPipelineHealth = async (): Promise<void> => {
  try {
    const pipelines = await prisma.pipeline.findMany({
      include: {
        builds: {
          take: 1,
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    for (const pipeline of pipelines) {
      await updatePipelineHealth(pipeline);
    }
  } catch (error) {
    logger.error('Error checking pipeline health:', error);
  }
};

const updatePipelineHealth = async (pipeline: any): Promise<void> => {
  try {
    let newStatus = 'UNKNOWN';

    if (pipeline.builds.length === 0) {
      newStatus = 'UNKNOWN';
    } else {
      const lastBuild = pipeline.builds[0];
      newStatus = lastBuild.status;
    }

    // Check if pipeline has been inactive for too long (more than 24 hours)
    if (pipeline.builds.length > 0) {
      const lastBuildTime = pipeline.builds[0].createdAt;
      const hoursSinceLastBuild = (Date.now() - lastBuildTime.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceLastBuild > 24) {
        newStatus = 'DISABLED';
      }
    }

    // Only update if status has changed
    if (newStatus !== pipeline.status) {
      await prisma.pipeline.update({
        where: { id: pipeline.id },
        data: {
          status: newStatus,
          updatedAt: new Date()
        }
      });

      logger.info(`Pipeline ${pipeline.name} status updated to ${newStatus}`);
    }
  } catch (error) {
    logger.error(`Error updating pipeline health for ${pipeline.name}:`, error);
  }
};

// Manual metrics calculation for a specific pipeline
export const calculatePipelineMetricsManually = async (pipelineId: string, period: string): Promise<void> => {
  try {
    await calculatePipelineMetrics(pipelineId, period);
    logger.info(`Manual metrics calculation completed for pipeline ${pipelineId} (${period})`);
  } catch (error) {
    logger.error(`Error in manual metrics calculation for pipeline ${pipelineId}:`, error);
    throw error;
  }
};

// Get metrics summary for dashboard
export const getMetricsSummary = async (): Promise<any> => {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get overall success rate for the last 24 hours
    const recentBuilds = await prisma.build.findMany({
      where: {
        createdAt: {
          gte: oneDayAgo
        }
      }
    });

    const totalBuilds = recentBuilds.length;
    const successfulBuilds = recentBuilds.filter(build => build.status === 'SUCCESS').length;
    const overallSuccessRate = totalBuilds > 0 ? (successfulBuilds / totalBuilds) * 100 : 0;

    // Get average build time for the last 24 hours
    const buildsWithDuration = recentBuilds.filter(build => build.duration && build.duration > 0);
    const averageBuildTime = buildsWithDuration.length > 0 
      ? buildsWithDuration.reduce((sum, build) => sum + build.duration!, 0) / buildsWithDuration.length
      : 0;

    // Get pipeline count by status
    const pipelineStatuses = await prisma.pipeline.groupBy({
      by: ['status'],
      _count: {
        status: true
      }
    });

    return {
      overallSuccessRate: Math.round(overallSuccessRate * 100) / 100,
      averageBuildTime: Math.round(averageBuildTime),
      totalBuilds,
      successfulBuilds,
      pipelineStatuses: pipelineStatuses.map(ps => ({
        status: ps.status,
        count: ps._count.status
      }))
    };
  } catch (error) {
    logger.error('Error getting metrics summary:', error);
    throw error;
  }
};
