import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { db } from '../database/db';
import { emailService } from '../services/emailService';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root API endpoint - shows available endpoints
app.get('/api', (req: Request, res: Response) => {
    res.json({
        message: 'CI/CD Dashboard API',
        version: '1.0.0',
        endpoints: {
            'GET /api/health': 'Health check',
            'GET /api/pipelines': 'List all pipelines',
            'POST /api/pipelines': 'Create new pipeline',
            'GET /api/pipelines/:id': 'Get pipeline by ID',
            'GET /api/pipelines/:id/builds': 'Get builds for a pipeline',
            'GET /api/builds': 'List all builds',
            'POST /api/webhooks': 'CI/CD webhook endpoint',
            'GET /api/metrics': 'Dashboard metrics',
            'POST /api/test-email': 'Test email notifications'
        },
        usage: 'Use the specific endpoint paths above to interact with the API'
    });
});

// Get all pipelines
app.get('/api/pipelines', async (req: Request, res: Response) => {
    try {
        const pipelines = await db.all('SELECT * FROM pipelines ORDER BY updated_at DESC');
        res.json(pipelines);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch pipelines' });
    }
});

// Get pipeline by ID
app.get('/api/pipelines/:id', async (req: Request, res: Response) => {
    try {
        const pipeline = await db.get('SELECT * FROM pipelines WHERE id = ?', [req.params.id]);
        if (!pipeline) {
            return res.status(404).json({ error: 'Pipeline not found' });
        }
        res.json(pipeline);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch pipeline' });
    }
});

// Create pipeline
app.post('/api/pipelines', async (req: Request, res: Response) => {
    try {
        const { name, type } = req.body;
        if (!name || !type) {
            return res.status(400).json({ error: 'Name and type are required' });
        }

        const result = await db.run(
            'INSERT INTO pipelines (name, type, created_at, updated_at) VALUES (?, ?, strftime("%s", "now"), strftime("%s", "now"))',
            [name, type]
        );

        const pipeline = await db.get('SELECT * FROM pipelines WHERE id = ?', [result.lastID]);
        res.status(201).json(pipeline);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create pipeline' });
    }
});

// Get builds for a pipeline
app.get('/api/pipelines/:id/builds', async (req: Request, res: Response) => {
    try {
        const builds = await db.all(
            'SELECT * FROM builds WHERE pipeline_id = ? ORDER BY created_at DESC LIMIT 50',
            [req.params.id]
        );
        res.json(builds);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch builds' });
    }
});

// Get all builds
app.get('/api/builds', async (req: Request, res: Response) => {
    try {
        const builds = await db.all(`
            SELECT b.*, p.name as pipeline_name 
            FROM builds b 
            JOIN pipelines p ON b.pipeline_id = p.id 
            ORDER BY b.created_at DESC 
            LIMIT 100
        `);
        res.json(builds);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch builds' });
    }
});

// Webhook endpoint for CI/CD tools
app.post('/api/webhooks', async (req: Request, res: Response) => {
    try {
        const { pipeline_id, build_number, status, start_time, end_time } = req.body;
        
        if (!pipeline_id || !build_number || !status) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const duration = start_time && end_time ? end_time - start_time : null;
        
        await db.run(
            'INSERT INTO builds (pipeline_id, build_number, status, start_time, end_time, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, strftime("%s", "now"))',
            [pipeline_id, build_number, status, start_time, end_time, duration]
        );

        // Update pipeline status
        await db.run(
            'UPDATE pipelines SET status = ?, last_build_time = ?, updated_at = strftime("%s", "now") WHERE id = ?',
            [status, end_time || start_time, pipeline_id]
        );

        // Send email notification if the build failed
        if (status === 'failed') {
            try {
                // Get pipeline name for the email
                const pipeline = await db.get('SELECT name FROM pipelines WHERE id = ?', [pipeline_id]);
                if (pipeline) {
                    await emailService.sendPipelineFailureNotification(
                        pipeline.name,
                        build_number,
                        'Build execution failed'
                    );
                }
            } catch (emailError) {
                console.error('Failed to send email notification:', emailError);
                // Don't fail the webhook if email fails
            }
        }

        res.json({ message: 'Build recorded successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to process webhook' });
    }
});

// Dashboard metrics
app.get('/api/metrics', async (req: Request, res: Response) => {
    try {
        const [totalPipelines, totalBuilds, successBuilds, failedBuilds] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM pipelines'),
            db.get('SELECT COUNT(*) as count FROM builds'),
            db.get('SELECT COUNT(*) as count FROM builds WHERE status = "success"'),
            db.get('SELECT COUNT(*) as count FROM builds WHERE status = "failed"')
        ]);

        const successRate = totalBuilds.count > 0 ? (successBuilds.count / totalBuilds.count * 100).toFixed(1) : '0';

        res.json({
            totalPipelines: totalPipelines.count,
            totalBuilds: totalBuilds.count,
            successBuilds: successBuilds.count,
            failedBuilds: failedBuilds.count,
            successRate: parseFloat(successRate)
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch metrics' });
    }
});

// Test email endpoint
app.post('/api/test-email', async (req: Request, res: Response) => {
    try {
        if (!emailService.isConfigured()) {
            return res.status(400).json({ 
                error: 'Email not configured. Please set SMTP_USER and SMTP_PASS in .env file.' 
            });
        }

        const { to } = req.body;
        const testEmail = to || process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER;
        
        if (!testEmail) {
            return res.status(400).json({ error: 'No email address provided' });
        }

        const success = await emailService.sendPipelineFailureNotification(
            'Test Pipeline',
            'TEST-001',
            'This is a test email notification'
        );

        if (success) {
            res.json({ 
                message: 'Test email sent successfully', 
                to: testEmail,
                note: 'Check your inbox for the test notification'
            });
        } else {
            res.status(500).json({ error: 'Failed to send test email' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to send test email' });
    }
});

// Email diagnostics endpoint
app.get('/api/email-config', async (req: Request, res: Response) => {
    try {
        const hasUser = Boolean(process.env.SMTP_USER);
        const hasPass = Boolean(process.env.SMTP_PASS);
        const host = process.env.SMTP_HOST || 'smtp.gmail.com';
        const port = parseInt(process.env.SMTP_PORT || '587');
        const configured = emailService.isConfigured();

        res.json({
            configured,
            hasUser,
            hasPass,
            host,
            port
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to read email configuration' });
    }
});

// Catch-all route for debugging
app.get('*', (req: Request, res: Response) => {
    res.json({ 
        message: 'Route not found', 
        requestedUrl: req.url,
        availableRoutes: [
            'GET /api/health',
            'GET /api/pipelines',
            'POST /api/pipelines',
            'GET /api/builds',
            'POST /api/webhooks',
            'GET /api/metrics'
        ]
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Simple CI/CD Dashboard running on port ${PORT}`);
    console.log(`📊 API available at http://localhost:${PORT}/api`);
    console.log(`🔍 Available routes:`);
    console.log(`   GET  /api/health`);
    console.log(`   GET  /api/pipelines`);
    console.log(`   POST /api/pipelines`);
    console.log(`   GET  /api/builds`);
    console.log(`   POST /api/webhooks`);
    console.log(`   GET  /api/metrics`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    db.close();
    process.exit(0);
});
