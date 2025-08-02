const express = require('express');
const router = express.Router();
const CacheService = require('../services/cache');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

// Get cache status and statistics
router.get('/status', async (req, res) => {
  try {
    const stats = CacheService.getStats();
    
    res.json({
      success: true,
      status: 'active',
      stats: {
        keys: stats.keys,
        hits: stats.hits,
        misses: stats.misses,
        hitRate: stats.hitRate,
        sets: stats.sets,
        deletes: stats.deletes,
        errors: stats.errors,
        memoryUsage: {
          keys: stats.ksize,
          values: stats.vsize,
          total: stats.ksize + stats.vsize
        },
        uptime: stats.uptime
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Cache status error:', error);
    res.status(500).json({
      success: false,
      error: 'Cache Status Error',
      message: error.message
    });
  }
});

// Clear all cache entries
router.post('/clear', async (req, res) => {
  try {
    const success = await CacheService.clear();
    
    if (success) {
      logger.info('Cache cleared successfully');
      res.json({
        success: true,
        message: 'Cache cleared successfully',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Cache Clear Failed',
        message: 'Failed to clear cache'
      });
    }

  } catch (error) {
    logger.error('Cache clear error:', error);
    res.status(500).json({
      success: false,
      error: 'Cache Clear Error',
      message: error.message
    });
  }
});

// Get specific cache entry
router.get('/entry/:key', async (req, res) => {
  try {
    const { key } = req.params;
    
    if (!key) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Cache key is required'
      });
    }

    const value = await CacheService.get(key);
    const exists = value !== null;
    const ttl = exists ? CacheService.getTtl(key) : null;

    res.json({
      success: true,
      key,
      exists,
      value: exists ? value : undefined,
      ttl: ttl ? Math.floor((ttl - Date.now()) / 1000) : null,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Cache get entry error:', error);
    res.status(500).json({
      success: false,
      error: 'Cache Get Error',
      message: error.message
    });
  }
});

// Set cache entry
router.post('/entry', async (req, res) => {
  try {
    const { key, value, ttl } = req.body;

    if (!key) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Cache key is required'
      });
    }

    if (value === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Cache value is required'
      });
    }

    const success = await CacheService.set(key, value, ttl);

    if (success) {
      res.json({
        success: true,
        message: 'Cache entry set successfully',
        key,
        ttl: ttl || 'default',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Cache Set Failed',
        message: 'Failed to set cache entry'
      });
    }

  } catch (error) {
    logger.error('Cache set entry error:', error);
    res.status(500).json({
      success: false,
      error: 'Cache Set Error',
      message: error.message
    });
  }
});

// Delete cache entry
router.delete('/entry/:key', async (req, res) => {
  try {
    const { key } = req.params;

    if (!key) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Cache key is required'
      });
    }

    const success = await CacheService.delete(key);

    res.json({
      success: true,
      message: success ? 'Cache entry deleted successfully' : 'Cache entry not found',
      key,
      deleted: success,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Cache delete entry error:', error);
    res.status(500).json({
      success: false,
      error: 'Cache Delete Error',
      message: error.message
    });
  }
});

// List cache keys (for debugging)
router.get('/keys', async (req, res) => {
  try {
    const { limit = 100, pattern } = req.query;
    
    let keys = CacheService.getKeys();
    
    // Filter by pattern if provided
    if (pattern) {
      keys = keys.filter(key => key.includes(pattern));
    }

    // Limit results
    keys = keys.slice(0, parseInt(limit));

    res.json({
      success: true,
      keys,
      total: keys.length,
      limit: parseInt(limit),
      pattern: pattern || null,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Cache keys error:', error);
    res.status(500).json({
      success: false,
      error: 'Cache Keys Error',
      message: error.message
    });
  }
});

// Invalidate cache entries by pattern
router.post('/invalidate', async (req, res) => {
  try {
    const { pattern } = req.body;

    if (!pattern) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Pattern is required for cache invalidation'
      });
    }

    const deleted = await CacheService.invalidateByPattern(pattern);

    logger.info('Cache invalidation completed', { pattern, deleted });

    res.json({
      success: true,
      message: `Invalidated ${deleted} cache entries`,
      pattern,
      deleted,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Cache invalidation error:', error);
    res.status(500).json({
      success: false,
      error: 'Cache Invalidation Error',
      message: error.message
    });
  }
});

// Cache warming endpoint
router.post('/warm', async (req, res) => {
  try {
    const { operations = [] } = req.body;

    if (!Array.isArray(operations) || operations.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Operations array is required for cache warming'
      });
    }

    let warmed = 0;
    const results = [];

    for (const operation of operations) {
      try {
        const key = CacheService.generateKey(operation.type || 'warm', operation.data || {});
        
        if (key && !CacheService.has(key)) {
          // This would typically involve pre-computing the result
          // For now, we'll just set a placeholder
          await CacheService.set(key, { 
            warmed: true, 
            data: operation.data,
            timestamp: new Date().toISOString() 
          });
          warmed++;
        }

        results.push({
          operation,
          key,
          success: true
        });

      } catch (error) {
        results.push({
          operation,
          success: false,
          error: error.message
        });
      }
    }

    logger.info('Cache warming completed', { 
      requested: operations.length, 
      warmed,
      successful: results.filter(r => r.success).length
    });

    res.json({
      success: true,
      message: `Cache warming completed: ${warmed} entries warmed`,
      results,
      summary: {
        requested: operations.length,
        warmed,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Cache warming error:', error);
    res.status(500).json({
      success: false,
      error: 'Cache Warming Error',
      message: error.message
    });
  }
});

// Cache health check
router.get('/health', async (req, res) => {
  try {
    const stats = CacheService.getStats();
    const testKey = 'health-check-' + Date.now();
    const testValue = 'test';

    // Test write
    const writeSuccess = await CacheService.set(testKey, testValue, 5);
    
    // Test read
    const readValue = await CacheService.get(testKey);
    const readSuccess = readValue === testValue;

    // Test delete
    const deleteSuccess = await CacheService.delete(testKey);

    const isHealthy = writeSuccess && readSuccess && deleteSuccess;

    res.json({
      success: true,
      healthy: isHealthy,
      checks: {
        write: writeSuccess,
        read: readSuccess,
        delete: deleteSuccess
      },
      stats: {
        hitRate: stats.hitRate,
        errors: stats.errors,
        uptime: stats.uptime
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Cache health check error:', error);
    res.status(500).json({
      success: false,
      healthy: false,
      error: 'Cache Health Check Error',
      message: error.message
    });
  }
});

// Cache configuration
router.get('/config', (req, res) => {
  try {
    // Return cache configuration (non-sensitive parts)
    res.json({
      success: true,
      config: {
        defaultTTL: 3600, // seconds
        checkPeriod: 120, // seconds
        maxKeys: 1000,
        useClones: false,
        deleteOnExpire: true
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Cache config error:', error);
    res.status(500).json({
      success: false,
      error: 'Cache Config Error',
      message: error.message
    });
  }
});

module.exports = router;