import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

interface EmailData {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private fromEmail: string;

  constructor() {
    this.fromEmail = process.env.SMTP_USER || '';

    const config: EmailConfig = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
      }
    };

    if (config.auth.user && config.auth.pass) {
      this.transporter = nodemailer.createTransport(config);
    }
  }

  async sendEmail(emailData: EmailData): Promise<boolean> {
    try {
      if (!this.transporter || !this.fromEmail) {
        console.log('Email not configured: missing SMTP_USER/SMTP_PASS');
        return false;
      }

      const mailOptions = {
        from: this.fromEmail,
        to: emailData.to,
        subject: emailData.subject,
        text: emailData.text,
        html: emailData.html
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('Email sent:', info.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send email:', error);
      return false;
    }
  }

  async sendPipelineFailureNotification(
    pipelineName: string,
    buildNumber: string,
    failureReason: string = 'Pipeline execution failed'
  ): Promise<boolean> {
    const subject = `🚨 Pipeline Failure: ${pipelineName} #${buildNumber}`;
    const text = `Pipeline: ${pipelineName}\nBuild: #${buildNumber}\nStatus: Failed\nReason: ${failureReason}\nTime: ${new Date().toLocaleString()}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d32f2f;">🚨 Pipeline Failure Alert</h2>
        <p><strong>Pipeline:</strong> ${pipelineName}</p>
        <p><strong>Build:</strong> #${buildNumber}</p>
        <p><strong>Status:</strong> Failed</p>
        <p><strong>Reason:</strong> ${failureReason}</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      </div>`;

    const to = process.env.NOTIFICATION_EMAIL || this.fromEmail;
    if (!to) return false;

    return this.sendEmail({ to, subject, text, html });
  }

  isConfigured(): boolean {
    return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
  }
}

export const emailService = new EmailService();
