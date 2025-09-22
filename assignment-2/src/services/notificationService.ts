import { WebClient } from '@slack/web-api';
import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';
import { prisma } from '../utils/database';

interface NotificationChannels {
  slack?: {
    channel: string;
    webhook?: string;
  };
  email?: string[];
  webhook?: string;
}

interface NotificationData {
  message: string;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  channels: NotificationChannels;
  metadata?: any;
}

interface NotificationResult {
  success: boolean;
  sentChannels: string[];
  failedChannels: string[];
  errors: string[];
}

// Initialize Slack client
const slackClient = process.env.SLACK_BOT_TOKEN ? new WebClient(process.env.SLACK_BOT_TOKEN) : null;

// Initialize email transporter
let emailTransporter: nodemailer.Transporter | null = null;

const initializeEmailTransporter = (): void => {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    emailTransporter = nodemailer.createTransporter({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    logger.info('Email transporter initialized');
  } else {
    logger.warn('Email configuration incomplete, email notifications disabled');
  }
};

// Initialize on module load
initializeEmailTransporter();

export const sendNotification = async (data: NotificationData): Promise<NotificationResult> => {
  const result: NotificationResult = {
    success: false,
    sentChannels: [],
    failedChannels: [],
    errors: []
  };

  try {
    const promises: Promise<void>[] = [];

    // Send Slack notification
    if (data.channels.slack && slackClient) {
      promises.push(sendSlackNotification(data, result));
    } else if (data.channels.slack) {
      result.failedChannels.push('slack');
      result.errors.push('Slack client not configured');
    }

    // Send email notification
    if (data.channels.email && emailTransporter) {
      promises.push(sendEmailNotification(data, result));
    } else if (data.channels.email) {
      result.failedChannels.push('email');
      result.errors.push('Email transporter not configured');
    }

    // Send webhook notification
    if (data.channels.webhook) {
      promises.push(sendWebhookNotification(data, result));
    }

    // Wait for all notifications to complete
    await Promise.allSettled(promises);

    // Determine overall success
    result.success = result.sentChannels.length > 0;

    logger.info(`Notification sent: ${result.sentChannels.join(', ')}`, {
      message: data.message,
      severity: data.severity,
      sentChannels: result.sentChannels,
      failedChannels: result.failedChannels
    });

  } catch (error) {
    logger.error('Error sending notification:', error);
    result.errors.push(`General error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return result;
};

const sendSlackNotification = async (data: NotificationData, result: NotificationResult): Promise<void> => {
  try {
    if (!data.channels.slack || !slackClient) return;

    const channel = data.channels.slack.channel;
    const color = getSeverityColor(data.severity);
    const emoji = getSeverityEmoji(data.severity);

    const message = {
      channel,
      text: `${emoji} ${data.message}`,
      attachments: [
        {
          color,
          fields: [
            {
              title: 'Severity',
              value: data.severity,
              short: true
            },
            {
              title: 'Timestamp',
              value: new Date().toLocaleString(),
              short: true
            }
          ],
          footer: 'CI/CD Pipeline Health Dashboard'
        }
      ]
    };

    if (data.metadata) {
      message.attachments[0].fields.push({
        title: 'Details',
        value: JSON.stringify(data.metadata, null, 2),
        short: false
      });
    }

    await slackClient.chat.postMessage(message);
    result.sentChannels.push('slack');

  } catch (error) {
    logger.error('Slack notification failed:', error);
    result.failedChannels.push('slack');
    result.errors.push(`Slack error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

const sendEmailNotification = async (data: NotificationData, result: NotificationResult): Promise<void> => {
  try {
    if (!data.channels.email || !emailTransporter) return;

    const subject = `[${data.severity}] CI/CD Pipeline Alert`;
    const htmlContent = `
      <h2>${data.severity} Alert</h2>
      <p><strong>Message:</strong> ${data.message}</p>
      <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
      ${data.metadata ? `<p><strong>Details:</strong> <pre>${JSON.stringify(data.metadata, null, 2)}</pre></p>` : ''}
      <hr>
      <p><em>This is an automated message from the CI/CD Pipeline Health Dashboard</em></p>
    `;

    const mailOptions = {
      from: process.env.SMTP_FROM || 'noreply@cicd-dashboard.com',
      to: data.channels.email.join(', '),
      subject,
      html: htmlContent
    };

    await emailTransporter.sendMail(mailOptions);
    result.sentChannels.push('email');

  } catch (error) {
    logger.error('Email notification failed:', error);
    result.failedChannels.push('email');
    result.errors.push(`Email error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

const sendWebhookNotification = async (data: NotificationData, result: NotificationResult): Promise<void> => {
  try {
    if (!data.channels.webhook) return;

    const webhookData = {
      message: data.message,
      severity: data.severity,
      timestamp: new Date().toISOString(),
      metadata: data.metadata || {}
    };

    const response = await fetch(data.channels.webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(webhookData)
    });

    if (response.ok) {
      result.sentChannels.push('webhook');
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

  } catch (error) {
    logger.error('Webhook notification failed:', error);
    result.failedChannels.push('webhook');
    result.errors.push(`Webhook error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

const getSeverityColor = (severity: string): string => {
  switch (severity) {
    case 'CRITICAL': return '#FF0000';
    case 'ERROR': return '#FF6B6B';
    case 'WARNING': return '#FFA500';
    case 'INFO': return '#4CAF50';
    default: return '#808080';
  }
};

const getSeverityEmoji = (severity: string): string => {
  switch (severity) {
    case 'CRITICAL': return '🚨';
    case 'ERROR': return '❌';
    case 'WARNING': return '⚠️';
    case 'INFO': return 'ℹ️';
    default: return '📝';
  }
};

// Send alert notification and log to database
export const sendAlertNotification = async (
  alertId: string,
  message: string,
  severity: string,
  buildId?: string
): Promise<void> => {
  try {
    // Get alert details
    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
      include: {
        pipeline: {
          select: { name: true }
        }
      }
    });

    if (!alert) {
      logger.error(`Alert not found: ${alertId}`);
      return;
    }

    // Send notification
    const notificationData: NotificationData = {
      message: `${alert.name}: ${message}`,
      severity: severity as any,
      channels: alert.notificationChannels as NotificationChannels,
      metadata: {
        alertId,
        alertName: alert.name,
        pipelineName: alert.pipeline?.name,
        buildId,
        timestamp: new Date().toISOString()
      }
    };

    const result = await sendNotification(notificationData);

    // Log to database
    await prisma.alertHistory.create({
      data: {
        alertId,
        buildId,
        message,
        severity: severity as any,
        notificationStatus: result.success ? 'SENT' : 'FAILED'
      }
    });

    logger.info(`Alert notification processed: ${alert.name}`, {
      alertId,
      success: result.success,
      sentChannels: result.sentChannels,
      failedChannels: result.failedChannels
    });

  } catch (error) {
    logger.error('Error sending alert notification:', error);
    
    // Log failed attempt to database
    try {
      await prisma.alertHistory.create({
        data: {
          alertId,
          buildId,
          message,
          severity: severity as any,
          notificationStatus: 'FAILED'
        }
      });
    } catch (dbError) {
      logger.error('Failed to log alert history:', dbError);
    }
  }
};

// Test notification service
export const testNotificationService = async (channels: NotificationChannels): Promise<NotificationResult> => {
  const testData: NotificationData = {
    message: 'This is a test notification from the CI/CD Pipeline Health Dashboard',
    severity: 'INFO',
    channels,
    metadata: {
      test: true,
      timestamp: new Date().toISOString()
    }
  };

  return await sendNotification(testData);
};
