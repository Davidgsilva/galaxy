const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

/**
 * Validate chat request data
 */
const validateChatRequest = (req, res, next) => {
  const { message, context, model, temperature, maxTokens, streaming, extendedThinking } = req.body;

  // Required fields
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'Message is required and must be a non-empty string'
    });
  }

  // Message length validation
  if (message.length > 50000) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'Message exceeds maximum length of 50,000 characters'
    });
  }

  // Context validation
  if (context && !Array.isArray(context)) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'Context must be an array'
    });
  }

  if (context && context.length > 100) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'Context cannot exceed 100 messages'
    });
  }

  // Validate context message format
  if (context) {
    for (let i = 0; i < context.length; i++) {
      const msg = context[i];
      if (!msg || typeof msg !== 'object' || !msg.role || !msg.content) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: `Context message at index ${i} must have 'role' and 'content' properties`
        });
      }

      if (!['user', 'assistant'].includes(msg.role)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: `Context message at index ${i} has invalid role. Must be 'user' or 'assistant'`
        });
      }

      if (typeof msg.content !== 'string' || msg.content.length > 20000) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: `Context message at index ${i} content must be a string under 20,000 characters`
        });
      }
    }
  }

  // Model validation
  const validModels = ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'];
  if (model && !validModels.includes(model)) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: `Invalid model. Must be one of: ${validModels.join(', ')}`
    });
  }

  // Temperature validation
  if (temperature !== undefined) {
    if (typeof temperature !== 'number' || temperature < 0 || temperature > 1) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Temperature must be a number between 0 and 1'
      });
    }
  }

  // Max tokens validation
  if (maxTokens !== undefined) {
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 32000) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'maxTokens must be an integer between 1 and 32000'
      });
    }
  }

  // Boolean validations
  if (streaming !== undefined && typeof streaming !== 'boolean') {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'streaming must be a boolean'
    });
  }

  if (extendedThinking !== undefined && typeof extendedThinking !== 'boolean') {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'extendedThinking must be a boolean'
    });
  }

  next();
};

/**
 * Validate file operation request
 */
const validateFileRequest = (req, res, next) => {
  const { filePath, operation, content } = req.body;

  // Required fields
  if (!filePath || typeof filePath !== 'string' || filePath.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'filePath is required and must be a non-empty string'
    });
  }

  if (!operation || !['create', 'read', 'update', 'delete'].includes(operation)) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'operation must be one of: create, read, update, delete'
    });
  }

  // Path traversal protection
  if (filePath.includes('..') || filePath.includes('~') || filePath.startsWith('/etc') || filePath.startsWith('/root')) {
    return res.status(400).json({
      success: false,
      error: 'Security Error',
      message: 'Invalid file path. Path traversal and system directories are not allowed'
    });
  }

  // Content validation for create/update operations
  if (['create', 'update'].includes(operation)) {
    if (content === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'content is required for create and update operations'
      });
    }

    if (typeof content !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'content must be a string'
      });
    }

    // File size limit (10MB)
    if (content.length > 10 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'File content exceeds maximum size of 10MB'
      });
    }
  }

  next();
};

/**
 * Validate batch operation request
 */
const validateBatchRequest = (req, res, next) => {
  const { operations } = req.body;

  if (!operations || !Array.isArray(operations)) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'operations must be an array'
    });
  }

  if (operations.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'operations array cannot be empty'
    });
  }

  if (operations.length > 50) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'Batch operations limited to 50 operations per request'
    });
  }

  // Validate each operation
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    
    if (!op || typeof op !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: `Operation at index ${i} must be an object`
      });
    }

    if (!op.type || !['chat', 'file'].includes(op.type)) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: `Operation at index ${i} must have type 'chat' or 'file'`
      });
    }

    if (!op.id || typeof op.id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: `Operation at index ${i} must have a string 'id' field`
      });
    }

    // Validate based on operation type
    if (op.type === 'chat') {
      if (!op.message || typeof op.message !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: `Chat operation at index ${i} must have a 'message' field`
        });
      }
    } else if (op.type === 'file') {
      if (!op.filePath || typeof op.filePath !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: `File operation at index ${i} must have a 'filePath' field`
        });
      }

      if (!op.operation || !['create', 'read', 'update', 'delete'].includes(op.operation)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: `File operation at index ${i} must have a valid 'operation' field`
        });
      }
    }
  }

  next();
};

/**
 * Generic request size validation
 */
const validateRequestSize = (maxSize = 10 * 1024 * 1024) => {
  return (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0');
    
    if (contentLength > maxSize) {
      return res.status(413).json({
        success: false,
        error: 'Request Too Large',
        message: `Request size exceeds maximum allowed size of ${maxSize / (1024 * 1024)}MB`
      });
    }

    next();
  };
};

/**
 * Sanitize input strings
 */
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  
  // Remove null bytes and control characters except newlines and tabs
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};

/**
 * Sanitization middleware
 */
const sanitizeRequest = (req, res, next) => {
  try {
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }
    next();
  } catch (error) {
    logger.error('Sanitization error:', error);
    res.status(400).json({
      success: false,
      error: 'Invalid Request',
      message: 'Request contains invalid data'
    });
  }
};

/**
 * Recursively sanitize object properties
 */
const sanitizeObject = (obj) => {
  if (typeof obj === 'string') {
    return sanitizeInput(obj);
  } else if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  } else if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }
  return obj;
};

module.exports = {
  validateChatRequest,
  validateFileRequest,
  validateBatchRequest,
  validateRequestSize,
  sanitizeRequest,
  sanitizeInput
};