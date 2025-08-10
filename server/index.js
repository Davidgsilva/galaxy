#!/usr/bin/env node

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const winston = require('winston');

const chatRoutes = require('./routes/chat');
const fileRoutes = require('./routes/files');
const batchRoutes = require('./routes/batch');
const cacheRoutes = require('./routes/cache');
const WebSocketFileOperationHandler = require('./websocket-handler');

const app = express();
const PORT = process.env.PORT || 3001;

// Configure logging with usage tracking
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'yocto-beacon-proxy' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.File({ filename: 'usage.log', level: 'info' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Rate limiting
const rateLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip,
  points: 100, // Number of requests
  duration: 60, // Per 60 seconds
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting middleware
app.use(async (req, res, next) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch (rejRes) {
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.round(rejRes.msBeforeNext) || 1000
    });
  }
});

// Request logging with usage tracking
app.use((req, res, next) => {
  const startTime = Date.now();

  // Override res.json to capture response data for usage tracking
  const originalJson = res.json;
  res.json = function(body) {
    const duration = Date.now() - startTime;

    // Log usage metrics for Claude API calls
    if (req.path.includes('/api/chat') || req.path.includes('/api/batch')) {
      logger.info('API_USAGE', {
        endpoint: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        duration,
        timestamp: new Date().toISOString(),
        success: res.statusCode < 400,
        // Token usage if available in response
        tokenUsage: body?.usage || body?.results?.[0]?.result?.usage,
        // Model used
        model: body?.model || body?.results?.[0]?.result?.model,
        // Session tracking
        sessionId: req.headers['x-session-id'] || 'anonymous'
      });
    }

    // Regular request logging
    logger.info(`${req.method} ${req.path}`, {
      ip: req.ip,
      status: res.statusCode,
      duration,
      timestamp: new Date().toISOString()
    });

    return originalJson.call(this, body);
  };

  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// API Routes
app.use('/api/chat', chatRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/batch', batchRoutes);
app.use('/api/cache', cacheRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

const server = app.listen(PORT, () => {
  logger.info(`Beacon proxy server running on port ${PORT}`);
  console.log(`🚀 Beacon proxy server started on http://localhost:${PORT}`);
  console.log(`📊 Health check available at http://localhost:${PORT}/health`);
});

// Initialize WebSocket handler for file operations
const wsHandler = new WebSocketFileOperationHandler();
wsHandler.initialize(server);

// Make WebSocket handler available globally for routes
global.wsFileHandler = wsHandler;

// Cleanup inactive connections every minute
setInterval(() => {
  wsHandler.cleanup();
}, 60000);

module.exports = app;