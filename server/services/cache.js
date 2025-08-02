const NodeCache = require('node-cache');
const crypto = require('crypto');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

class CacheService {
  constructor() {
    // Initialize cache with default TTL of 1 hour (3600 seconds)
    this.cache = new NodeCache({
      stdTTL: 3600,
      checkperiod: 120, // Check for expired keys every 2 minutes
      useClones: false,
      deleteOnExpire: true,
      maxKeys: 1000 // Limit cache size
    });

    // Cache statistics
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0
    };

    // Setup event listeners for cache statistics
    this.cache.on('set', (key, value) => {
      this.stats.sets++;
      logger.debug('Cache set:', { key: this.obscureKey(key) });
    });

    this.cache.on('del', (key, value) => {
      this.stats.deletes++;
      logger.debug('Cache delete:', { key: this.obscureKey(key) });
    });

    this.cache.on('expired', (key, value) => {
      logger.debug('Cache expired:', { key: this.obscureKey(key) });
    });

    logger.info('Cache service initialized');
  }

  /**
   * Generate a cache key from request parameters
   */
  generateKey(prefix, data) {
    try {
      const serialized = JSON.stringify(data, Object.keys(data).sort());
      const hash = crypto.createHash('sha256').update(serialized).digest('hex');
      return `${prefix}:${hash.substring(0, 16)}`;
    } catch (error) {
      logger.error('Error generating cache key:', error);
      this.stats.errors++;
      return null;
    }
  }

  /**
   * Get value from cache
   */
  async get(key) {
    try {
      if (!key) return null;

      const value = this.cache.get(key);
      
      if (value !== undefined) {
        this.stats.hits++;
        logger.debug('Cache hit:', { key: this.obscureKey(key) });
        return value;
      } else {
        this.stats.misses++;
        logger.debug('Cache miss:', { key: this.obscureKey(key) });
        return null;
      }
    } catch (error) {
      logger.error('Cache get error:', error);
      this.stats.errors++;
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set(key, value, ttl = null) {
    try {
      if (!key || value === undefined) return false;

      const result = ttl 
        ? this.cache.set(key, value, ttl)
        : this.cache.set(key, value);

      if (result) {
        logger.debug('Cache set successful:', { 
          key: this.obscureKey(key),
          ttl: ttl || 'default',
          size: JSON.stringify(value).length
        });
      }

      return result;
    } catch (error) {
      logger.error('Cache set error:', error);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key) {
    try {
      if (!key) return false;

      const result = this.cache.del(key);
      logger.debug('Cache delete:', { 
        key: this.obscureKey(key),
        success: result > 0
      });

      return result > 0;
    } catch (error) {
      logger.error('Cache delete error:', error);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Clear all cache entries
   */
  async clear() {
    try {
      this.cache.flushAll();
      logger.info('Cache cleared successfully');
      return true;
    } catch (error) {
      logger.error('Cache clear error:', error);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const cacheStats = this.cache.getStats();
    
    return {
      ...this.stats,
      keys: cacheStats.keys,
      ksize: cacheStats.ksize,
      vsize: cacheStats.vsize,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
      uptime: process.uptime()
    };
  }

  /**
   * Get cache keys (for debugging)
   */
  getKeys() {
    try {
      return this.cache.keys().map(key => this.obscureKey(key));
    } catch (error) {
      logger.error('Error getting cache keys:', error);
      return [];
    }
  }

  /**
   * Check if cache has key
   */
  has(key) {
    try {
      return this.cache.has(key);
    } catch (error) {
      logger.error('Cache has error:', error);
      return false;
    }
  }

  /**
   * Get cache TTL for a key
   */
  getTtl(key) {
    try {
      return this.cache.getTtl(key);
    } catch (error) {
      logger.error('Cache getTtl error:', error);
      return null;
    }
  }

  /**
   * Set cache TTL for a key
   */
  setTtl(key, ttl) {
    try {
      return this.cache.ttl(key, ttl);
    } catch (error) {
      logger.error('Cache setTtl error:', error);
      return false;
    }
  }

  /**
   * Obscure cache key for logging (security)
   */
  obscureKey(key) {
    if (!key || key.length < 8) return key;
    return key.substring(0, 4) + '***' + key.substring(key.length - 4);
  }

  /**
   * Smart caching for file operations
   */
  async cacheFileOperation(operation, filePath, content = null, ttl = 300) {
    const key = this.generateKey('file', { operation, filePath, timestamp: Date.now() });
    
    if (operation === 'read' && content) {
      await this.set(key, content, ttl);
    }
    
    return key;
  }

  /**
   * Invalidate cache entries by pattern
   */
  async invalidateByPattern(pattern) {
    try {
      const keys = this.cache.keys();
      const matchingKeys = keys.filter(key => key.includes(pattern));
      
      let deleted = 0;
      for (const key of matchingKeys) {
        if (this.cache.del(key)) {
          deleted++;
        }
      }

      logger.info(`Invalidated ${deleted} cache entries matching pattern: ${pattern}`);
      return deleted;
    } catch (error) {
      logger.error('Cache invalidation error:', error);
      return 0;
    }
  }
}

module.exports = new CacheService();