/**
 * RateLimiter 类 - 速率限制的主入口
 * @class
 */
class RateLimiter {
  /**
   * 创建 RateLimiter 实例
   * @param {Object} options - 配置选项
   * @param {number} options.windowMs - 时间窗口（毫秒）
   * @param {number|Function} options.max - 每个窗口的最大请求数
   * @param {string} options.algorithm - 算法：'sliding-window'、'fixed-window'、'token-bucket'、'leaky-bucket'
   * @param {Object|string} options.store - 存储后端实例或 'memory'
   * @param {Function} options.keyGenerator - 从请求生成速率限制键的函数
   * @param {Function} options.skip - 确定是否跳过速率限制的函数
   * @param {Function} options.handler - 超过速率限制时的自定义处理器
   * @param {boolean} options.headers - 是否在响应中包含速率限制头
   * @param {boolean} options.skipSuccessfulRequests - 跳过计数成功请求
   * @param {boolean} options.skipFailedRequests - 跳过计数失败请求
   */
  constructor(options = {}) {
    this.options = this._validateOptions(options);
    this.store = this._initializeStore(this.options.store);
    this.algorithm = this._initializeAlgorithm(this.options.algorithm);
  }

  /**
   * 验证和规范化选项
   * @private
   * @param {Object} options - 原始选项
   * @returns {Object} 验证后的选项
   */
  _validateOptions(options) {
    const defaults = {
      windowMs: 60000, // 1 分钟
      max: 100,
      algorithm: 'sliding-window',
      store: 'memory',
      keyGenerator: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
      skip: () => false,
      handler: null,
      headers: true,
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
    };

    const config = { ...defaults, ...options };

    // 验证 windowMs
    if (typeof config.windowMs !== 'number' || config.windowMs <= 0) {
      throw new Error('windowMs 必须是正数');
    }

    // 验证 max
    if (typeof config.max !== 'number' && typeof config.max !== 'function') {
      throw new Error('max 必须是数字或函数');
    }

    if (typeof config.max === 'number' && config.max <= 0) {
      throw new Error('max 必须是正数');
    }

    // 验证 algorithm
    const validAlgorithms = ['sliding-window', 'fixed-window', 'token-bucket', 'leaky-bucket'];
    if (!validAlgorithms.includes(config.algorithm)) {
      throw new Error(`algorithm 必须是以下之一：${validAlgorithms.join('、')}`);
    }

    return config;
  }

  /**
   * 初始化存储后端
   * @private
   * @param {Object|string} store - 存储实例或类型
   * @returns {Object} 存储实例
   */
  _initializeStore(store) {
    // 默认使用内存存储
    if (!store || (typeof store === 'string' && store === 'memory')) {
      const MemoryStore = require('./stores/memory-store');
      return new MemoryStore();
    }

    // 支持 Redis 连接字符串
    if (typeof store === 'string' && store.startsWith('redis://')) {
      const Redis = require('ioredis');
      const RedisStore = require('./stores/redis-store');
      const client = new Redis(store);
      return new RedisStore({ client });
    }

    if (typeof store === 'object' && store !== null) {
      // 验证存储是否具有所需方法
      const requiredMethods = ['increment', 'get', 'reset'];
      for (const method of requiredMethods) {
        if (typeof store[method] !== 'function') {
          throw new Error(`存储必须实现 ${method} 方法`);
        }
      }
      return store;
    }

    throw new Error('无效的存储配置');
  }

  /**
   * 初始化算法处理器
   * @private
   * @param {string} algorithmName - 算法名称
   * @returns {Object} 算法实现
   */
  _initializeAlgorithm(algorithmName) {
    const algorithms = require('./algorithms');

    const algo = algorithms[algorithmName];

    if (!algo) {
      throw new Error(`未知算法：${algorithmName}`);
    }

    return algo;
  }

  /**
   * 检查请求是否被允许
   * @param {string} key - 速率限制键
   * @param {Object} options - 检查选项
   * @returns {Promise<Object>} 包含 allowed、remaining、resetTime、retryAfter 的结果
   */
  async check(key, options = {}) {
    if (!key || typeof key !== 'string') {
      throw new Error('键必须是非空字符串');
    }

    try {
      const max = typeof this.options.max === 'function'
        ? await this.options.max(options.req)
        : this.options.max;

      const result = await this.algorithm.check(
        this.store,
        key,
        {
          windowMs: this.options.windowMs,
          max,
          ...options,
        },
      );

      return {
        allowed: result.count <= max,
        limit: max,
        current: result.count,
        remaining: Math.max(0, max - result.count),
        resetTime: result.resetTime,
        retryAfter: result.count > max ? result.resetTime - Date.now() : 0,
      };
    } catch (error) {
      // 出错时，允许请求但记录错误
      console.error('[RateLimiter] 检查速率限制时出错:', error);
      return {
        allowed: true,
        limit: this.options.max,
        current: 0,
        remaining: this.options.max,
        resetTime: Date.now() + this.options.windowMs,
        retryAfter: 0,
        error: error.message,
      };
    }
  }

  /**
   * 重置特定键的速率限制
   * @param {string} key - 速率限制键
   * @returns {Promise<void>}
   */
  async reset(key) {
    if (!key || typeof key !== 'string') {
      throw new Error('键必须是非空字符串');
    }

    await this.store.reset(key);
  }

  /**
   * 重置所有速率限制（仅限内存存储）
   * @returns {Promise<void>}
   */
  async resetAll() {
    if (typeof this.store.resetAll === 'function') {
      await this.store.resetAll();
    } else {
      throw new Error('存储不支持 resetAll 操作');
    }
  }

  /**
   * 为 Web 框架创建中间件
   * @param {Object} _options - 中间件选项
   * @returns {Function} 中间件函数
   */
  middleware(_options = {}) {
    return async (req, res, next) => {
      try {
        // 检查是否应跳过速率限制
        if (await this.options.skip(req)) {
          return next ? next() : undefined;
        }

        // 获取路由信息
        const route = req.route?.path || req.path || req.url;

        // 生成速率限制键（传递路由上下文）
        const key = await this.options.keyGenerator(req, { route });

        // 检查速率限制（传递路由信息）
        const result = await this.check(key, { req, route });

        // 如果启用，添加响应头
        if (this.options.headers && res) {
          this._setHeaders(res, result);
        }

        // 处理超过速率限制的情况
        if (!result.allowed) {
          if (this.options.handler) {
            return this.options.handler(req, res, next);
          }

          // 默认处理器
          if (res) {
            res.status(429).json({
              error: '请求过多',
              message: '超过速率限制',
              retryAfter: Math.ceil(result.retryAfter / 1000),
            });
          }

          return next ? next(new Error('超过速率限制')) : undefined;
        }

        // 继续下一个中间件
        return next ? next() : undefined;
      } catch (error) {
        console.error('[RateLimiter] 中间件错误:', error);
        // 出错时，允许请求
        return next ? next() : undefined;
      }
    };
  }

  /**
   * 设置速率限制响应头
   * @private
   * @param {Object} res - 响应对象
   * @param {Object} result - 检查结果
   */
  _setHeaders(res, result) {
    if (!res || typeof res.setHeader !== 'function') {
      return;
    }

    res.setHeader('X-RateLimit-Limit', result.limit.toString());
    res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000).toString());

    if (!result.allowed) {
      res.setHeader('Retry-After', Math.ceil(result.retryAfter / 1000).toString());
    }
  }
}

module.exports = RateLimiter;
