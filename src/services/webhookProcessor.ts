import { logger } from '../utils/logger';
import { prisma } from '../utils/database';
import { broadcastBuildUpdate, broadcastPipelineUpdate } from './websocket';

interface WebhookData {
  source: string;
  event: string;
  [key: string]: any;
}

export const processWebhook = async (webhookData: WebhookData): Promise<void> => {
  try {
    logger.info('Processing webhook', {
      source: webhookData.source,
      event: webhookData.event
    });

    switch (webhookData.source) {
      case 'github':
        await processGitHubWebhook(webhookData);
        break;
      case 'gitlab':
        await processGitLabWebhook(webhookData);
        break;
      case 'jenkins':
        await processJenkinsWebhook(webhookData);
        break;
      default:
        logger.warn(`Unknown webhook source: ${webhookData.source}`);
    }
  } catch (error) {
    logger.error('Error processing webhook:', error);
  }
};

const processGitHubWebhook = async (webhookData: WebhookData): Promise<void> => {
  try {
    const { event, data } = webhookData;

    switch (event) {
      case 'workflow_run':
        await processGitHubWorkflowRun(data);
        break;
      case 'check_run':
        await processGitHubCheckRun(data);
        break;
      case 'push':
        await processGitHubPush(data);
        break;
      case 'pull_request':
        await processGitHubPullRequest(data);
        break;
      default:
        logger.info(`Unhandled GitHub event: ${event}`);
    }
  } catch (error) {
    logger.error('Error processing GitHub webhook:', error);
  }
};

const processGitHubWorkflowRun = async (data: any): Promise<void> => {
  try {
    const { workflow_run, repository } = data;
    
    // Find pipeline by repository
    const pipeline = await prisma.pipeline.findFirst({
      where: {
        repository: repository.full_name,
        type: 'GITHUB_ACTIONS'
      }
    });

    if (!pipeline) {
      logger.warn(`Pipeline not found for repository: ${repository.full_name}`);
      return;
    }

    // Create or update build
    const buildData = {
      pipelineId: pipeline.id,
      externalId: workflow_run.id.toString(),
      status: mapGitHubStatus(workflow_run.conclusion || workflow_run.status),
      startTime: new Date(workflow_run.run_started_at),
      endTime: workflow_run.conclusion ? new Date(workflow_run.updated_at) : null,
      duration: workflow_run.conclusion ? 
        Math.floor((new Date(workflow_run.updated_at).getTime() - new Date(workflow_run.run_started_at).getTime()) / 1000) : null,
      commitHash: workflow_run.head_sha,
      branch: workflow_run.head_branch,
      triggerType: workflow_run.event === 'push' ? 'PUSH' : 
                   workflow_run.event === 'pull_request' ? 'PULL_REQUEST' : 'WEBHOOK',
      metadata: {
        workflowName: workflow_run.name,
        workflowId: workflow_run.workflow_id,
        runNumber: workflow_run.run_number,
        actor: workflow_run.actor?.login,
        event: workflow_run.event
      }
    };

    let build = await prisma.build.findFirst({
      where: {
        pipelineId: pipeline.id,
        externalId: buildData.externalId
      }
    });

    if (build) {
      // Update existing build
      build = await prisma.build.update({
        where: { id: build.id },
        data: buildData
      });
    } else {
      // Create new build
      build = await prisma.build.create({
        data: buildData
      });
    }

    // Update pipeline status
    await prisma.pipeline.update({
      where: { id: pipeline.id },
      data: {
        status: buildData.status,
        lastBuildId: build.id,
        updatedAt: new Date()
      }
    });

    // Broadcast updates
    broadcastBuildUpdate(build);
    broadcastPipelineUpdate(pipeline);

    logger.info(`GitHub workflow run processed: ${workflow_run.id}`);

  } catch (error) {
    logger.error('Error processing GitHub workflow run:', error);
  }
};

const processGitHubCheckRun = async (data: any): Promise<void> => {
  try {
    const { check_run, repository } = data;
    
    // Find pipeline by repository
    const pipeline = await prisma.pipeline.findFirst({
      where: {
        repository: repository.full_name,
        type: 'GITHUB_ACTIONS'
      }
    });

    if (!pipeline) {
      return;
    }

    // Find or create build
    let build = await prisma.build.findFirst({
      where: {
        pipelineId: pipeline.id,
        externalId: check_run.check_suite_id.toString()
      }
    });

    if (!build) {
      build = await prisma.build.create({
        data: {
          pipelineId: pipeline.id,
          externalId: check_run.check_suite_id.toString(),
          status: mapGitHubStatus(check_run.conclusion || check_run.status),
          commitHash: check_run.head_sha,
          branch: check_run.check_suite.head_branch,
          triggerType: 'WEBHOOK',
          metadata: {
            checkRunName: check_run.name,
            checkSuiteId: check_run.check_suite_id,
            appName: check_run.app?.name
          }
        }
      });
    }

    // Create or update build stage
    const stageData = {
      buildId: build.id,
      name: check_run.name,
      status: mapGitHubStatus(check_run.conclusion || check_run.status),
      startTime: check_run.started_at ? new Date(check_run.started_at) : null,
      endTime: check_run.conclusion ? new Date(check_run.completed_at) : null,
      duration: check_run.conclusion && check_run.started_at ? 
        Math.floor((new Date(check_run.completed_at).getTime() - new Date(check_run.started_at).getTime()) / 1000) : null,
      logs: check_run.output?.summary || null
    };

    let stage = await prisma.buildStage.findFirst({
      where: {
        buildId: build.id,
        name: check_run.name
      }
    });

    if (stage) {
      await prisma.buildStage.update({
        where: { id: stage.id },
        data: stageData
      });
    } else {
      await prisma.buildStage.create({
        data: stageData
      });
    }

    // Update build status based on all stages
    const stages = await prisma.buildStage.findMany({
      where: { buildId: build.id }
    });

    const overallStatus = determineOverallStatus(stages.map(s => s.status));
    
    if (overallStatus !== build.status) {
      build = await prisma.build.update({
        where: { id: build.id },
        data: { status: overallStatus }
      });
    }

    // Broadcast updates
    broadcastBuildUpdate(build);

    logger.info(`GitHub check run processed: ${check_run.id}`);

  } catch (error) {
    logger.error('Error processing GitHub check run:', error);
  }
};

const processGitHubPush = async (data: any): Promise<void> => {
  try {
    const { ref, repository, commits } = data;
    
    // Find pipeline by repository
    const pipeline = await prisma.pipeline.findFirst({
      where: {
        repository: repository.full_name,
        type: 'GITHUB_ACTIONS'
      }
    });

    if (!pipeline) {
      return;
    }

    // Create build for push event
    const build = await prisma.build.create({
      data: {
        pipelineId: pipeline.id,
        externalId: `push-${Date.now()}`,
        status: 'PENDING',
        commitHash: commits[0]?.id,
        branch: ref.replace('refs/heads/', ''),
        triggerType: 'PUSH',
        metadata: {
          event: 'push',
          commitCount: commits.length,
          commitMessages: commits.map((c: any) => c.message)
        }
      }
    });

    // Broadcast updates
    broadcastBuildUpdate(build);

    logger.info(`GitHub push processed for branch: ${ref}`);

  } catch (error) {
    logger.error('Error processing GitHub push:', error);
  }
};

const processGitHubPullRequest = async (data: any): Promise<void> => {
  try {
    const { action, pull_request, repository } = data;
    
    // Find pipeline by repository
    const pipeline = await prisma.pipeline.findFirst({
      where: {
        repository: repository.full_name,
        type: 'GITHUB_ACTIONS'
      }
    });

    if (!pipeline) {
      return;
    }

    // Create build for pull request
    const build = await prisma.build.create({
      data: {
        pipelineId: pipeline.id,
        externalId: `pr-${pull_request.id}`,
        status: 'PENDING',
        commitHash: pull_request.head.sha,
        branch: pull_request.head.ref,
        triggerType: 'PULL_REQUEST',
        metadata: {
          event: 'pull_request',
          action,
          prNumber: pull_request.number,
          prTitle: pull_request.title,
          baseBranch: pull_request.base.ref
        }
      }
    });

    // Broadcast updates
    broadcastBuildUpdate(build);

    logger.info(`GitHub pull request processed: #${pull_request.number}`);

  } catch (error) {
    logger.error('Error processing GitHub pull request:', error);
  }
};

const processGitLabWebhook = async (webhookData: WebhookData): Promise<void> => {
  try {
    const { event, data } = webhookData;

    switch (event) {
      case 'pipeline':
        await processGitLabPipeline(data);
        break;
      case 'job':
        await processGitLabJob(data);
        break;
      default:
        logger.info(`Unhandled GitLab event: ${event}`);
    }
  } catch (error) {
    logger.error('Error processing GitLab webhook:', error);
  }
};

const processGitLabPipeline = async (data: any): Promise<void> => {
  try {
    const { pipeline, project } = data;
    
    // Find pipeline by repository
    const dbPipeline = await prisma.pipeline.findFirst({
      where: {
        repository: project.path_with_namespace,
        type: 'GITLAB_CI'
      }
    });

    if (!dbPipeline) {
      logger.warn(`Pipeline not found for repository: ${project.path_with_namespace}`);
      return;
    }

    // Create or update build
    const buildData = {
      pipelineId: dbPipeline.id,
      externalId: pipeline.id.toString(),
      status: mapGitLabStatus(pipeline.status),
      startTime: new Date(pipeline.created_at),
      endTime: pipeline.finished_at ? new Date(pipeline.finished_at) : null,
      duration: pipeline.duration || null,
      commitHash: pipeline.sha,
      branch: pipeline.ref,
      triggerType: pipeline.source === 'push' ? 'PUSH' : 
                   pipeline.source === 'merge_request_event' ? 'PULL_REQUEST' : 'WEBHOOK',
      metadata: {
        pipelineId: pipeline.id,
        projectId: project.id,
        source: pipeline.source,
        user: pipeline.user?.name
      }
    };

    let build = await prisma.build.findFirst({
      where: {
        pipelineId: dbPipeline.id,
        externalId: buildData.externalId
      }
    });

    if (build) {
      build = await prisma.build.update({
        where: { id: build.id },
        data: buildData
      });
    } else {
      build = await prisma.build.create({
        data: buildData
      });
    }

    // Update pipeline status
    await prisma.pipeline.update({
      where: { id: dbPipeline.id },
      data: {
        status: buildData.status,
        lastBuildId: build.id,
        updatedAt: new Date()
      }
    });

    // Broadcast updates
    broadcastBuildUpdate(build);
    broadcastPipelineUpdate(dbPipeline);

    logger.info(`GitLab pipeline processed: ${pipeline.id}`);

  } catch (error) {
    logger.error('Error processing GitLab pipeline:', error);
  }
};

const processGitLabJob = async (data: any): Promise<void> => {
  try {
    const { job, project } = data;
    
    // Find pipeline by repository
    const dbPipeline = await prisma.pipeline.findFirst({
      where: {
        repository: project.path_with_namespace,
        type: 'GITLAB_CI'
      }
    });

    if (!dbPipeline) {
      return;
    }

    // Find build
    const build = await prisma.build.findFirst({
      where: {
        pipelineId: dbPipeline.id,
        externalId: job.pipeline.id.toString()
      }
    });

    if (!build) {
      return;
    }

    // Create or update build stage
    const stageData = {
      buildId: build.id,
      name: job.stage,
      status: mapGitLabStatus(job.status),
      startTime: job.started_at ? new Date(job.started_at) : null,
      endTime: job.finished_at ? new Date(job.finished_at) : null,
      duration: job.duration || null,
      logs: job.trace || null
    };

    let stage = await prisma.buildStage.findFirst({
      where: {
        buildId: build.id,
        name: job.stage
      }
    });

    if (stage) {
      await prisma.buildStage.update({
        where: { id: stage.id },
        data: stageData
      });
    } else {
      await prisma.buildStage.create({
        data: stageData
      });
    }

    logger.info(`GitLab job processed: ${job.id}`);

  } catch (error) {
    logger.error('Error processing GitLab job:', error);
  }
};

const processJenkinsWebhook = async (webhookData: WebhookData): Promise<void> => {
  try {
    const { event, data } = webhookData;

    switch (event) {
      case 'build':
        await processJenkinsBuild(data);
        break;
      case 'job':
        await processJenkinsJob(data);
        break;
      default:
        logger.info(`Unhandled Jenkins event: ${event}`);
    }
  } catch (error) {
    logger.error('Error processing Jenkins webhook:', error);
  }
};

const processJenkinsBuild = async (data: any): Promise<void> => {
  try {
    const { build, job } = data;
    
    // Find pipeline by job name (simplified mapping)
    const dbPipeline = await prisma.pipeline.findFirst({
      where: {
        name: { contains: job.name },
        type: 'JENKINS'
      }
    });

    if (!dbPipeline) {
      logger.warn(`Pipeline not found for Jenkins job: ${job.name}`);
      return;
    }

    // Create or update build
    const buildData = {
      pipelineId: dbPipeline.id,
      externalId: build.number.toString(),
      status: mapJenkinsStatus(build.status),
      startTime: build.timestamp ? new Date(build.timestamp) : null,
      endTime: build.duration ? new Date(build.timestamp + build.duration) : null,
      duration: build.duration ? Math.floor(build.duration / 1000) : null,
      commitHash: build.commit_id,
      branch: build.branch,
      triggerType: 'WEBHOOK',
      metadata: {
        buildNumber: build.number,
        jobName: job.name,
        result: build.result,
        url: build.url
      }
    };

    let dbBuild = await prisma.build.findFirst({
      where: {
        pipelineId: dbPipeline.id,
        externalId: buildData.externalId
      }
    });

    if (dbBuild) {
      dbBuild = await prisma.build.update({
        where: { id: dbBuild.id },
        data: buildData
      });
    } else {
      dbBuild = await prisma.build.create({
        data: buildData
      });
    }

    // Update pipeline status
    await prisma.pipeline.update({
      where: { id: dbPipeline.id },
      data: {
        status: buildData.status,
        lastBuildId: dbBuild.id,
        updatedAt: new Date()
      }
    });

    // Broadcast updates
    broadcastBuildUpdate(dbBuild);
    broadcastPipelineUpdate(dbPipeline);

    logger.info(`Jenkins build processed: ${build.number}`);

  } catch (error) {
    logger.error('Error processing Jenkins build:', error);
  }
};

const processJenkinsJob = async (data: any): Promise<void> => {
  // Similar to GitLab job processing
  logger.info('Jenkins job processing not yet implemented');
};

// Status mapping functions
const mapGitHubStatus = (status: string): string => {
  switch (status) {
    case 'success': return 'SUCCESS';
    case 'failure': return 'FAILED';
    case 'cancelled': return 'CANCELLED';
    case 'in_progress': return 'RUNNING';
    case 'queued': return 'PENDING';
    case 'waiting': return 'PENDING';
    default: return 'UNKNOWN';
  }
};

const mapGitLabStatus = (status: string): string => {
  switch (status) {
    case 'success': return 'SUCCESS';
    case 'failed': return 'FAILED';
    case 'canceled': return 'CANCELLED';
    case 'running': return 'RUNNING';
    case 'pending': return 'PENDING';
    case 'skipped': return 'SKIPPED';
    default: return 'UNKNOWN';
  }
};

const mapJenkinsStatus = (status: string): string => {
  switch (status) {
    case 'SUCCESS': return 'SUCCESS';
    case 'FAILURE': return 'FAILED';
    case 'ABORTED': return 'CANCELLED';
    case 'IN_PROGRESS': return 'RUNNING';
    case 'QUEUED': return 'PENDING';
    default: return 'UNKNOWN';
  }
};

const determineOverallStatus = (statuses: string[]): string => {
  if (statuses.includes('FAILED')) return 'FAILED';
  if (statuses.includes('RUNNING')) return 'RUNNING';
  if (statuses.includes('PENDING')) return 'PENDING';
  if (statuses.every(s => s === 'SUCCESS')) return 'SUCCESS';
  return 'UNKNOWN';
};
