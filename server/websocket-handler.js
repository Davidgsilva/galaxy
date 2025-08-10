const WebSocketServer = require('websocket').server;
const http = require('http');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

class WebSocketFileOperationHandler {
  constructor() {
    this.connections = new Map(); // sessionId -> connection
    this.pendingOperations = new Map(); // operationId -> Promise resolver
    this.server = null;
  }

  initialize(httpServer) {
    this.server = new WebSocketServer({
      httpServer: httpServer,
      autoAcceptConnections: false
    });

    this.server.on('request', (request) => {
      logger.info('WebSocket connection request received', {
        origin: request.origin,
        protocols: request.requestedProtocols,
        resource: request.resourceURL.pathname
      });

      if (!this.originIsAllowed(request.origin)) {
        request.reject();
        logger.warn('WebSocket connection rejected from origin:', request.origin);
        return;
      }

      const connection = request.accept('file-operations', request.origin);
      logger.info('WebSocket connection accepted from:', request.origin);

      connection.on('message', (message) => {
        this.handleMessage(connection, message);
      });

      connection.on('close', (reasonCode, description) => {
        this.handleClose(connection, reasonCode, description);
      });

      connection.on('error', (error) => {
        logger.error('WebSocket connection error:', error);
      });
    });
  }

  originIsAllowed(origin) {
    // For CLI connections, origin might be null or undefined
    if (!origin || origin === null || origin === 'null') {
      return true; // Allow CLI connections
    }
    
    // In production, validate against allowed origins
    const allowedOrigins = process.env.ALLOWED_WS_ORIGINS?.split(',') || [
      'http://localhost:3001', 
      'http://127.0.0.1:3001',
      'ws://localhost:3001',
      'ws://127.0.0.1:3001'
    ];
    return allowedOrigins.includes(origin);
  }

  handleMessage(connection, message) {
    try {
      if (message.type === 'utf8') {
        const data = JSON.parse(message.utf8Data);
        
        switch (data.type) {
          case 'register':
            this.handleRegistration(connection, data);
            break;
          case 'operation_result':
            this.handleOperationResult(data);
            break;
          case 'operation_error':
            this.handleOperationError(data);
            break;
          case 'heartbeat':
            this.handleHeartbeat(connection);
            break;
          default:
            logger.warn('Unknown message type:', data.type);
        }
      }
    } catch (error) {
      logger.error('Error handling WebSocket message:', error);
      connection.sendUTF(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  }

  handleRegistration(connection, data) {
    const { sessionId, clientId } = data;
    
    if (!sessionId || !clientId) {
      connection.sendUTF(JSON.stringify({
        type: 'registration_error',
        message: 'sessionId and clientId are required'
      }));
      return;
    }

    // Store connection with metadata
    connection.sessionId = sessionId;
    connection.clientId = clientId;
    connection.registeredAt = new Date();
    connection.lastSeen = new Date();

    this.connections.set(sessionId, connection);

    logger.info('Client registered via WebSocket', { sessionId, clientId });

    connection.sendUTF(JSON.stringify({
      type: 'registration_success',
      sessionId,
      message: 'Client registered successfully'
    }));

    // Start heartbeat
    this.startHeartbeat(connection);
  }

  handleOperationResult(data) {
    const { operationId, result } = data;
    const resolver = this.pendingOperations.get(operationId);
    
    if (resolver) {
      resolver.resolve(result);
      this.pendingOperations.delete(operationId);
    }
  }

  handleOperationError(data) {
    const { operationId, error } = data;
    const resolver = this.pendingOperations.get(operationId);
    
    if (resolver) {
      resolver.reject(new Error(error.message || 'File operation failed'));
      this.pendingOperations.delete(operationId);
    }
  }

  handleHeartbeat(connection) {
    connection.lastSeen = new Date();
    connection.sendUTF(JSON.stringify({
      type: 'heartbeat_ack'
    }));
  }

  startHeartbeat(connection) {
    const heartbeatInterval = setInterval(() => {
      if (connection.connected) {
        connection.sendUTF(JSON.stringify({
          type: 'ping'
        }));
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 30000); // 30 seconds

    connection.heartbeatInterval = heartbeatInterval;
  }

  handleClose(connection, reasonCode, description) {
    if (connection.sessionId) {
      this.connections.delete(connection.sessionId);
      logger.info('WebSocket connection closed', {
        sessionId: connection.sessionId,
        reasonCode,
        description
      });
    }

    if (connection.heartbeatInterval) {
      clearInterval(connection.heartbeatInterval);
    }
  }

  // Main method for delegating file operations
  async delegateFileOperation(sessionId, operation, params, timeout = 30000) {
    const connection = this.connections.get(sessionId);
    
    if (!connection || !connection.connected) {
      throw new Error('Client not connected. Please ensure the CLI is running and registered.');
    }

    const operationId = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingOperations.delete(operationId);
        reject(new Error('File operation timed out'));
      }, timeout);

      // Store resolver
      this.pendingOperations.set(operationId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });

      // Send operation request
      const message = {
        type: 'file_operation',
        operationId,
        operation,
        params,
        timestamp: new Date().toISOString()
      };

      connection.sendUTF(JSON.stringify(message));

      logger.info('File operation delegated', {
        sessionId,
        operationId,
        operation,
        params: { ...params, content: params.content ? '[content]' : undefined }
      });
    });
  }

  // Get client status
  getClientStatus(sessionId) {
    const connection = this.connections.get(sessionId);
    
    if (!connection) {
      return { connected: false };
    }

    return {
      connected: connection.connected,
      sessionId: connection.sessionId,
      clientId: connection.clientId,
      registeredAt: connection.registeredAt,
      lastSeen: connection.lastSeen,
      isActive: (Date.now() - connection.lastSeen.getTime()) < 60000 // 1 minute
    };
  }

  // Get all connected clients
  getAllClients() {
    const clients = [];
    for (const [sessionId, connection] of this.connections) {
      clients.push(this.getClientStatus(sessionId));
    }
    return clients;
  }

  // Cleanup inactive connections
  cleanup() {
    const cutoff = Date.now() - (5 * 60 * 1000); // 5 minutes
    
    for (const [sessionId, connection] of this.connections) {
      if (connection.lastSeen.getTime() < cutoff) {
        logger.info('Cleaning up inactive WebSocket connection', { sessionId });
        connection.close();
        this.connections.delete(sessionId);
      }
    }
  }
}

module.exports = WebSocketFileOperationHandler;