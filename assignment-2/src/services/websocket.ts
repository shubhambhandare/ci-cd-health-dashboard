import { Server } from 'socket.io';
import { logger } from '../utils/logger';

interface WebSocketClient {
  id: string;
  userId?: string;
  userRole?: string;
  pipelines?: string[];
}

let io: Server;
const connectedClients = new Map<string, WebSocketClient>();

export const setupWebSocket = (socketIO: Server): void => {
  io = socketIO;
  
  io.on('connection', (socket) => {
    logger.info(`WebSocket client connected: ${socket.id}`);
    
    // Store client information
    connectedClients.set(socket.id, {
      id: socket.id
    });

    // Handle authentication
    socket.on('authenticate', (data: { token: string }) => {
      try {
        // In a real implementation, you would verify the JWT token here
        // For now, we'll accept any token
        const client = connectedClients.get(socket.id);
        if (client) {
          client.userId = 'user-' + socket.id; // Simplified for demo
          client.userRole = 'USER';
          logger.info(`WebSocket client authenticated: ${socket.id}`);
        }
      } catch (error) {
        logger.error('WebSocket authentication failed:', error);
      }
    });

    // Handle pipeline subscription
    socket.on('subscribe', (data: { pipelineIds: string[] }) => {
      const client = connectedClients.get(socket.id);
      if (client) {
        client.pipelines = data.pipelineIds;
        socket.join(data.pipelineIds.map(id => `pipeline-${id}`));
        logger.info(`Client ${socket.id} subscribed to pipelines: ${data.pipelineIds.join(', ')}`);
      }
    });

    // Handle pipeline unsubscription
    socket.on('unsubscribe', (data: { pipelineIds: string[] }) => {
      const client = connectedClients.get(socket.id);
      if (client) {
        data.pipelineIds.forEach(id => {
          socket.leave(`pipeline-${id}`);
        });
        logger.info(`Client ${socket.id} unsubscribed from pipelines: ${data.pipelineIds.join(', ')}`);
      }
    });

    // Handle dashboard subscription
    socket.on('subscribe-dashboard', () => {
      socket.join('dashboard');
      logger.info(`Client ${socket.id} subscribed to dashboard updates`);
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      connectedClients.delete(socket.id);
      logger.info(`WebSocket client disconnected: ${socket.id}`);
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error(`WebSocket error for client ${socket.id}:`, error);
    });
  });

  logger.info('WebSocket service initialized');
};

// Broadcast to all connected clients
export const broadcastToAll = (event: string, data: any): void => {
  if (io) {
    io.emit(event, data);
    logger.debug(`Broadcasted ${event} to all clients`);
  }
};

// Broadcast to specific pipeline subscribers
export const broadcastToPipeline = (pipelineId: string, event: string, data: any): void => {
  if (io) {
    io.to(`pipeline-${pipelineId}`).emit(event, data);
    logger.debug(`Broadcasted ${event} to pipeline ${pipelineId} subscribers`);
  }
};

// Broadcast to dashboard subscribers
export const broadcastToDashboard = (event: string, data: any): void => {
  if (io) {
    io.to('dashboard').emit(event, data);
    logger.debug(`Broadcasted ${event} to dashboard subscribers`);
  }
};

// Send to specific client
export const sendToClient = (clientId: string, event: string, data: any): void => {
  if (io) {
    io.to(clientId).emit(event, data);
    logger.debug(`Sent ${event} to client ${clientId}`);
  }
};

// Broadcast build status update
export const broadcastBuildUpdate = (buildData: any): void => {
  if (io) {
    // Broadcast to dashboard
    broadcastToDashboard('build-update', buildData);
    
    // Broadcast to specific pipeline
    if (buildData.pipelineId) {
      broadcastToPipeline(buildData.pipelineId, 'build-update', buildData);
    }
  }
};

// Broadcast pipeline status update
export const broadcastPipelineUpdate = (pipelineData: any): void => {
  if (io) {
    // Broadcast to dashboard
    broadcastToDashboard('pipeline-update', pipelineData);
    
    // Broadcast to specific pipeline
    if (pipelineData.id) {
      broadcastToPipeline(pipelineData.id, 'pipeline-update', pipelineData);
    }
  }
};

// Broadcast metrics update
export const broadcastMetricsUpdate = (metricsData: any): void => {
  if (io) {
    broadcastToDashboard('metrics-update', metricsData);
  }
};

// Broadcast alert
export const broadcastAlert = (alertData: any): void => {
  if (io) {
    broadcastToDashboard('alert', alertData);
    
    // If alert is pipeline-specific, broadcast to pipeline subscribers
    if (alertData.pipelineId) {
      broadcastToPipeline(alertData.pipelineId, 'alert', alertData);
    }
  }
};

// Get connected clients count
export const getConnectedClientsCount = (): number => {
  return connectedClients.size;
};

// Get connected clients info
export const getConnectedClientsInfo = (): WebSocketClient[] => {
  return Array.from(connectedClients.values());
};

// Check if client is connected
export const isClientConnected = (clientId: string): boolean => {
  return connectedClients.has(clientId);
};
