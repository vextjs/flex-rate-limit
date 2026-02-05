/**
 * Redis Store - Redis-based storage backend
 * Distributed, persistent, multi-server support
 * @class
 */
class RedisStore {
  /**
   * Create RedisStore instance
   * @param {Object} options - Configuration options
   * @param {Object} options.client - Redis client instance (ioredis)
   * @param {string} options.prefix - Key prefix (default: 'rl:')
   * @param {number} options.expiry - Default expiry in seconds
   */
  constructor(options = {}) {
    if (!options.client) {
      throw new Error('Redis client is required');
    }

    this.client = options.client;
    this.prefix = options.prefix || 'rl:';
    this.defaultExpiry = options.expiry || 3600;

    // Validate Redis client
    if (typeof this.client.get !== 'function' || typeof this.client.set !== 'function') {
      throw new Error('Invalid Redis client: must implement get/set methods');
    }
  }

  /**
   * Get full key with prefix
   * @private
   * @param {string} key - Base key
   * @returns {string} Prefixed key
   */
  _getKey(key) {
    return `${this.prefix}${key}`;
  }

  /**
   * Get value from Redis
   * @param {string} key - Storage key
   * @returns {Promise<any>} Stored value
   */
  async get(key) {
    try {
      const fullKey = this._getKey(key);
      const value = await this.client.get(fullKey);

      if (!value) {
        return null;
      }

      return JSON.parse(value);
    } catch (error) {
      console.error('[RedisStore] Get error:', error);
      return null;
    }
  }

  /**
   * Set value in Redis with optional TTL
   * @param {string} key - Storage key
   * @param {any} value - Value to store
   * @param {number} ttl - Time to live in milliseconds
   * @returns {Promise<void>}
   */
  async set(key, value, ttl) {
    try {
      const fullKey = this._getKey(key);
      const serialized = JSON.stringify(value);
      const expiry = ttl ? Math.ceil(ttl / 1000) : this.defaultExpiry;

      await this.client.setex(fullKey, expiry, serialized);
    } catch (error) {
      console.error('[RedisStore] Set error:', error);
      throw error;
    }
  }

  /**
   * 使用 Redis 原子操作增加计数器
   * @param {string} key - 存储键
   * @param {Object} options - 增量选项
   * @returns {Promise<Object>} 包含计数的结果
   */
  async increment(key, options = {}) {
    try {
      const { windowMs, timestamp } = options;
      const fullKey = this._getKey(key);

      if (timestamp) {
        // 滑动窗口：使用带时间戳的有序集合
        const scoreKey = `${fullKey}:scores`;
        const now = Date.now();
        const windowStart = now - windowMs;

        // 删除旧条目
        await this.client.zremrangebyscore(scoreKey, '-inf', windowStart);

        // 添加新条目
        await this.client.zadd(scoreKey, timestamp, `${timestamp}-${Math.random()}`);

        // 设置过期时间
        await this.client.expire(scoreKey, Math.ceil(windowMs / 1000) + 1);

        // 获取计数
        const count = await this.client.zcard(scoreKey);

        return { count };
      }

      // 固定窗口：使用原子递增的简单计数器
      const count = await this.client.incr(fullKey);

      if (count === 1 && windowMs) {
        // 第一个请求，设置过期时间
        await this.client.expire(fullKey, Math.ceil(windowMs / 1000));
      }

      return { count };
    } catch (error) {
      console.error('[RedisStore] 增量错误:', error);
      throw error;
    }
  }

  /**
   * 减少计数器（用于 skipFailedRequests）
   * @param {string} key - 存储键
   * @returns {Promise<void>}
   */
  async decrement(key) {
    try {
      const fullKey = this._getKey(key);

      // 检查是否为有序集合（滑动窗口）
      const type = await this.client.type(fullKey);

      if (type === 'zset') {
        // 删除最近的条目
        await this.client.zpopmax(`${fullKey}:scores`);
      } else {
        // 减少计数器
        const value = await this.client.get(fullKey);
        if (value && parseInt(value) > 0) {
          await this.client.decr(fullKey);
        }
      }
    } catch (error) {
      console.error('[RedisStore] 减量错误:', error);
    }
  }

  /**
   * 重置特定键
   * @param {string} key - 存储键
   * @returns {Promise<void>}
   */
  async reset(key) {
    try {
      const fullKey = this._getKey(key);
      await this.client.del(fullKey);
      await this.client.del(`${fullKey}:scores`);
    } catch (error) {
      console.error('[RedisStore] 重置错误:', error);
      throw error;
    }
  }

  /**
   * 重置所有带前缀的键
   * @returns {Promise<void>}
   */
  async resetAll() {
    try {
      const keys = await this.client.keys(`${this.prefix}*`);

      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (error) {
      console.error('[RedisStore] 重置所有错误:', error);
      throw error;
    }
  }
}

module.exports = RedisStore;
