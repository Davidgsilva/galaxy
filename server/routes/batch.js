const express = require('express');
const router = express.Router();
const AnthropicService = require('../services/anthropic');
const CacheService = require('../services/cache');
const { validateBatchRequest } = require('../middleware/validation');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

// Execute batch operations
router.post('/', validateBatchRequest, async (req, res) => {
  try {
    const { operations, parallel = false, maxConcurrency = 5 } = req.body;

    logger.info('Starting batch execution', {
      operationCount: operations.length,
      parallel,
      maxConcurrency
    });

    const results = [];
    const startTime = Date.now();

    if (parallel) {
      // Execute operations in parallel with concurrency limit
      results.push(...await executeOperationsInParallel(operations, maxConcurrency));
    } else {
      // Execute operations sequentially
      for (let i = 0; i < operations.length; i++) {
        const operation = operations[i];
        const result = await executeOperation(operation, i);
        results.push(result);
        
        // If an operation fails and has stopOnError flag, halt execution
        if (!result.success && operation.stopOnError) {
          logger.warn('Stopping batch execution due to error', { operationId: operation.id });
          break;
        }
      }
    }

    const duration = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    logger.info('Batch execution completed', {
      duration,
      totalOperations: operations.length,
      executed: results.length,
      successful: successCount,
      failed: failureCount
    });

    res.json({
      success: true,
      results,
      summary: {
        totalOperations: operations.length,
        executed: results.length,
        successful: successCount,
        failed: failureCount,
        duration,
        parallel
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Batch execution error:', error);
    res.status(500).json({
      success: false,
      error: 'Batch Execution Error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get batch operation status (for long-running batches)
router.get('/status/:batchId', async (req, res) => {
  try {
    const { batchId } = req.params;
    
    // In a real implementation, you'd store batch status in a database or cache
    // For now, return a placeholder response
    res.json({
      success: true,
      batchId,
      status: 'completed', // pending, running, completed, failed
      progress: {
        total: 0,
        completed: 0,
        failed: 0,
        percentage: 100
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Batch status error:', error);
    res.status(500).json({
      success: false,
      error: 'Batch Status Error',
      message: error.message
    });
  }
});

// Cancel batch operation
router.post('/cancel/:batchId', async (req, res) => {
  try {
    const { batchId } = req.params;
    
    // In a real implementation, you'd cancel the running batch
    logger.info('Batch cancellation requested', { batchId });

    res.json({
      success: true,
      message: 'Batch cancellation requested',
      batchId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Batch cancellation error:', error);
    res.status(500).json({
      success: false,
      error: 'Batch Cancellation Error',
      message: error.message
    });
  }
});

// Helper functions
async function executeOperationsInParallel(operations, maxConcurrency) {
  const results = [];
  const executing = [];

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    
    // Create promise for this operation
    const operationPromise = executeOperation(operation, i)
      .then(result => {
        results[i] = result;
        return result;
      })
      .catch(error => {
        const errorResult = {
          id: operation.id,
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        };
        results[i] = errorResult;
        return errorResult;
      });

    executing.push(operationPromise);

    // If we've reached max concurrency, wait for one to complete
    if (executing.length >= maxConcurrency) {
      await Promise.race(executing);
      // Remove completed promises
      for (let j = executing.length - 1; j >= 0; j--) {
        if (results[j] !== undefined) {
          executing.splice(j, 1);
        }
      }
    }
  }

  // Wait for all remaining operations to complete
  await Promise.all(executing);

  return results;
}

async function executeOperation(operation, index) {
  const startTime = Date.now();
  
  try {
    logger.info('Executing operation', { 
      id: operation.id, 
      type: operation.type, 
      index 
    });

    let result;

    switch (operation.type) {
      case 'chat':
        result = await executeChatOperation(operation);
        break;
      
      case 'file':
        result = await executeFileOperation(operation);
        break;
      
      case 'web_search':
        result = await executeWebSearchOperation(operation);
        break;
      
      case 'computer':
        result = await executeComputerOperation(operation);
        break;
      
      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }

    const duration = Date.now() - startTime;

    return {
      id: operation.id,
      success: true,
      result,
      duration,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error('Operation failed', {
      id: operation.id,
      type: operation.type,
      error: error.message,
      duration
    });

    return {
      id: operation.id,
      success: false,
      error: error.message,
      duration,
      timestamp: new Date().toISOString()
    };
  }
}

async function executeChatOperation(operation) {
  const {
    message,
    context = [],
    model = 'claude-sonnet-4-20250514',
    temperature = 0.1,
    maxTokens = 4096,
    tools = []
  } = operation;

  const response = await AnthropicService.createMessage({
    model,
    max_tokens: maxTokens,
    temperature,
    system: 'You are a helpful AI assistant executing a batch operation.',
    messages: [
      ...context,
      { role: 'user', content: message }
    ]
  });

  return {
    response: response.content[0].text,
    usage: response.usage,
    model: response.model
  };
}

async function executeFileOperation(operation) {
  const axios = require('axios');
  const { filePath, fileOperation, content, instruction } = operation;

  // Make internal API call to file routes
  const baseUrl = process.env.INTERNAL_API_URL || 'http://localhost:3001';
  
  switch (fileOperation) {
    case 'create':
      const createResponse = await axios.post(`${baseUrl}/api/files/create`, {
        filePath,
        content,
        operation: 'create'
      });
      return createResponse.data;

    case 'read':
      const readResponse = await axios.get(`${baseUrl}/api/files/read`, {
        params: { filePath }
      });
      return readResponse.data;

    case 'update':
      const updateResponse = await axios.put(`${baseUrl}/api/files/update`, {
        filePath,
        instruction,
        content,
        operation: 'update'
      });
      return updateResponse.data;

    case 'delete':
      const deleteResponse = await axios.delete(`${baseUrl}/api/files/delete`, {
        data: { filePath, operation: 'delete' }
      });
      return deleteResponse.data;

    default:
      throw new Error(`Unknown file operation: ${fileOperation}`);
  }
}

async function executeWebSearchOperation(operation) {
  const { query, maxResults = 5, allowedDomains, blockedDomains } = operation;

  // Build web search tool configuration
  const webSearchTool = {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: maxResults
  };

  if (allowedDomains) {
    webSearchTool.allowed_domains = allowedDomains;
  }

  if (blockedDomains) {
    webSearchTool.blocked_domains = blockedDomains;
  }

  const response = await AnthropicService.createMessage({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    temperature: 0.1,
    system: 'You are a web search assistant. Provide concise, accurate information based on search results.',
    messages: [{
      role: 'user',
      content: `Search for: ${query}`
    }],
    tools: [webSearchTool]
  });

  return {
    query,
    response: response.content[0].text,
    usage: response.usage
  };
}

async function executeComputerOperation(operation) {
  const { action, params = {} } = operation;

  // Build computer use tool
  const computerTool = {
    type: 'computer_20250124',
    name: 'computer',
    display_width_px: params.displayWidth || 1024,
    display_height_px: params.displayHeight || 768
  };

  const response = await AnthropicService.createMessage({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    temperature: 0.1,
    system: 'You are a computer automation assistant. Execute the requested action safely and efficiently.',
    messages: [{
      role: 'user',
      content: `Execute computer action: ${action} with parameters: ${JSON.stringify(params)}`
    }],
    tools: [computerTool]
  });

  return {
    action,
    params,
    response: response.content[0].text,
    usage: response.usage
  };
}

// Batch operation templates
router.get('/templates', (req, res) => {
  const templates = {
    'code-review': {
      name: 'Code Review Batch',
      description: 'Review multiple code files for quality, security, and best practices',
      operations: [
        {
          id: 'read-files',
          type: 'file',
          fileOperation: 'read',
          filePath: '**/*.js',
          analyze: 'security'
        },
        {
          id: 'analyze-structure',
          type: 'chat',
          message: 'Analyze the overall code structure and suggest improvements'
        }
      ]
    },
    'documentation-generation': {
      name: 'Documentation Generation',
      description: 'Generate documentation for code files',
      operations: [
        {
          id: 'read-source',
          type: 'file',
          fileOperation: 'read',
          filePath: 'src/**/*.js'
        },
        {
          id: 'generate-docs',
          type: 'chat',
          message: 'Generate comprehensive documentation for the analyzed code'
        },
        {
          id: 'create-readme',
          type: 'file',
          fileOperation: 'create',
          filePath: 'README.md'
        }
      ]
    },
    'web-research': {
      name: 'Web Research Batch',
      description: 'Perform multiple web searches and compile results',
      operations: [
        {
          id: 'search-trends',
          type: 'web_search',
          query: 'latest web development trends 2025'
        },
        {
          id: 'search-tools',
          type: 'web_search',
          query: 'best development tools 2025'
        },
        {
          id: 'compile-report',
          type: 'chat',
          message: 'Compile the search results into a comprehensive report'
        }
      ]
    }
  };

  res.json({
    success: true,
    templates,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;