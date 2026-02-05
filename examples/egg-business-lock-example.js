/**
 * Egg.js 业务锁示例 - 基于用户ID + 路由的限流
 *
 * 核心特性：
 * 1. 从 ctx 中获取用户ID（支持多种认证方式）
 * 2. 结合路由路径进行精确限流
 * 3. 支持不同业务场景的差异化配置
 */

const { RateLimiter, keyGenerators } = require('../lib');

// ============================================
// 方案一：使用预定义的 keyGenerator
// ============================================

/**
 * 预定义方案：userAndRoute
 * 自动组合用户ID和路由
 */
module.exports.preDefinedLimiter = (options = {}) => {
  const limiter = new RateLimiter({
    windowMs: options.windowMs || 60 * 1000,
    max: options.max || 100,
    algorithm: options.algorithm || 'sliding-window',

    // 使用预定义的 userAndRoute 生成器
    keyGenerator: keyGenerators.userAndRoute,
  });

  return async function rateLimitMiddleware(ctx, next) {
    // 确保 req.user 存在（Egg.js 需要适配）
    const req = {
      ...ctx.request,
      user: ctx.user || ctx.state.user, // 兼容不同的用户存储位置
      ip: ctx.ip,
      path: ctx.path,
    };

    const result = await limiter.check(
      await limiter.options.keyGenerator(req, { route: ctx.path })
    );

    ctx.set('X-RateLimit-Limit', result.limit);
    ctx.set('X-RateLimit-Remaining', result.remaining);

    if (!result.allowed) {
      ctx.status = 429;
      ctx.body = {
        code: 429,
        message: '请求过于频繁，请稍后再试',
        retryAfter: Math.ceil(result.retryAfter / 1000),
      };
      return;
    }

    await next();
  };
};

// ============================================
// 方案二：自定义 keyGenerator（最灵活）
// ============================================

/**
 * 自定义业务锁配置
 * 支持多种用户ID提取方式
 */
module.exports.customBusinessLock = (options = {}) => {
  const limiter = new RateLimiter({
    windowMs: options.windowMs || 60 * 1000,
    max: options.max || 100,
    algorithm: options.algorithm || 'sliding-window',

    // 自定义键生成器：用户ID + 路由 + 可选的额外标识
    keyGenerator: (ctx, context) => {
      // 1. 获取用户ID（支持多种认证方式）
      const userId =
        ctx.user?.id ||              // JWT 认证
        ctx.state?.user?.id ||       // Session 认证
        ctx.session?.userId ||       // Session 存储
        ctx.headers['x-user-id'] ||  // 自定义 Header
        ctx.ip;                      // 降级到IP

      // 2. 获取路由（支持动态路由）
      const route = context?.route || ctx.path || ctx.url;

      // 3. 可选：添加租户ID、组织ID等业务维度
      const tenantId = ctx.headers['x-tenant-id'] || 'default';

      // 4. 组合键：租户:用户:路由
      return `${tenantId}:user:${userId}:${route}`;
    },
  });

  return async function businessLockMiddleware(ctx, next) {
    // 生成限流键
    const key = await limiter.options.keyGenerator(ctx, { route: ctx.path });

    // 检查限流
    const result = await limiter.check(key, { req: ctx, route: ctx.path });

    // 设置响应头
    ctx.set('X-RateLimit-Limit', result.limit);
    ctx.set('X-RateLimit-Remaining', result.remaining);
    ctx.set('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

    if (!result.allowed) {
      ctx.status = 429;
      ctx.body = {
        code: 429,
        message: '请求过于频繁，请稍后再试',
        userId: ctx.user?.id || 'guest',
        route: ctx.path,
        retryAfter: Math.ceil(result.retryAfter / 1000),
      };
      return;
    }

    await next();
  };
};

// ============================================
// 方案三：路由级别业务锁（最实用）
// ============================================

/**
 * 创建不同业务场景的限流中间件
 * 每个中间件都是 "用户ID + 路由" 维度的限流
 */
module.exports.createBusinessLimiters = (app) => {
  return {
    /**
     * 严格限制：用于登录、注册等敏感操作
     * 每个用户每个接口 15分钟最多 5 次
     */
    strict: async (ctx, next) => {
      const limiter = new RateLimiter({
        windowMs: 15 * 60 * 1000,
        max: 5,
        keyGenerator: (ctx) => {
          const userId = ctx.user?.id || ctx.session?.userId || ctx.ip;
          return `strict:user:${userId}:${ctx.path}`;
        },
      });

      const key = await limiter.options.keyGenerator(ctx);
      const result = await limiter.check(key);

      ctx.set('X-RateLimit-Limit', result.limit);
      ctx.set('X-RateLimit-Remaining', result.remaining);

      if (!result.allowed) {
        ctx.status = 429;
        ctx.body = {
          code: 429,
          message: '操作过于频繁，请15分钟后再试',
          userId: ctx.user?.id || 'guest',
          route: ctx.path,
        };
        return;
      }

      await next();
    },

    /**
     * 中等限制：用于数据修改操作
     * 每个用户每个接口 1小时最多 50 次
     */
    normal: async (ctx, next) => {
      const limiter = new RateLimiter({
        windowMs: 60 * 60 * 1000,
        max: 50,
        keyGenerator: (ctx) => {
          const userId = ctx.user?.id || ctx.session?.userId || ctx.ip;
          return `normal:user:${userId}:${ctx.path}`;
        },
      });

      const key = await limiter.options.keyGenerator(ctx);
      const result = await limiter.check(key);

      if (!result.allowed) {
        ctx.status = 429;
        ctx.body = { code: 429, message: '请求过于频繁' };
        return;
      }

      await next();
    },

    /**
     * 宽松限制：用于查询操作
     * 每个用户每个接口 1分钟最多 200 次
     */
    relaxed: async (ctx, next) => {
      const limiter = new RateLimiter({
        windowMs: 60 * 1000,
        max: 200,
        keyGenerator: (ctx) => {
          const userId = ctx.user?.id || ctx.session?.userId || ctx.ip;
          return `relaxed:user:${userId}:${ctx.path}`;
        },
      });

      const key = await limiter.options.keyGenerator(ctx);
      const result = await limiter.check(key);

      if (!result.allowed) {
        ctx.status = 429;
        ctx.body = { code: 429, message: '请求过于频繁' };
        return;
      }

      await next();
    },

    /**
     * 按用户分级限流
     * VIP用户和普通用户不同的限制
     */
    userLevel: async (ctx, next) => {
      // 根据用户等级动态调整限制
      const isVIP = ctx.user?.vip === true;
      const limiter = new RateLimiter({
        windowMs: 60 * 1000,
        max: isVIP ? 500 : 100, // VIP 5倍限额
        keyGenerator: (ctx) => {
          const userId = ctx.user?.id || ctx.ip;
          const level = ctx.user?.vip ? 'vip' : 'normal';
          return `${level}:user:${userId}:${ctx.path}`;
        },
      });

      const key = await limiter.options.keyGenerator(ctx);
      const result = await limiter.check(key);

      if (!result.allowed) {
        ctx.status = 429;
        ctx.body = {
          code: 429,
          message: isVIP ? 'VIP请求过于频繁' : '请求过于频繁，升级VIP可提升限额',
          userLevel: isVIP ? 'vip' : 'normal',
        };
        return;
      }

      await next();
    },

    /**
     * 多维度业务锁
     * 用户ID + 路由 + 资源ID
     */
    resourceLock: (resourceIdField = 'id') => {
      return async (ctx, next) => {
        const limiter = new RateLimiter({
          windowMs: 60 * 1000,
          max: 10,
          keyGenerator: (ctx) => {
            const userId = ctx.user?.id || ctx.ip;
            const resourceId = ctx.params[resourceIdField] || ctx.query[resourceIdField];
            return `resource:user:${userId}:${ctx.path}:${resourceId}`;
          },
        });

        const key = await limiter.options.keyGenerator(ctx);
        const result = await limiter.check(key);

        if (!result.allowed) {
          ctx.status = 429;
          ctx.body = {
            code: 429,
            message: '对该资源的操作过于频繁',
          };
          return;
        }

        await next();
      };
    },
  };
};

// ============================================
// 使用示例
// ============================================

/*
// ========== app/router.js ==========

module.exports = (app) => {
  const { router, controller } = app;
  const businessLock = require('./middleware/business-lock')(app);

  // 方案一：预定义
  const preDefinedLimit = require('rate-limit/examples/egg-business-lock-example').preDefinedLimiter({
    windowMs: 60 * 1000,
    max: 100,
  });

  // 方案二：自定义
  const customLimit = require('rate-limit/examples/egg-business-lock-example').customBusinessLock({
    windowMs: 60 * 1000,
    max: 50,
  });

  // 方案三：路由级业务锁（推荐）
  const limit = require('rate-limit/examples/egg-business-lock-example').createBusinessLimiters(app);

  // 登录：每个用户15分钟最多5次
  router.post('/api/login', limit.strict, controller.auth.login);

  // 注册：每个用户15分钟最多5次
  router.post('/api/register', limit.strict, controller.auth.register);

  // 修改密码：每个用户每个接口1小时最多3次
  router.post('/api/user/change-password', limit.strict, controller.user.changePassword);

  // 数据修改：每个用户每个接口1小时最多50次
  router.post('/api/posts', limit.normal, controller.post.create);
  router.put('/api/posts/:id', limit.normal, controller.post.update);
  router.delete('/api/posts/:id', limit.normal, controller.post.delete);

  // 查询接口：每个用户每个接口1分钟最多200次
  router.get('/api/posts', limit.relaxed, controller.post.list);
  router.get('/api/posts/:id', limit.relaxed, controller.post.detail);

  // VIP分级：根据用户等级自动调整
  router.get('/api/data/export', limit.userLevel, controller.data.export);

  // 资源锁：对特定资源ID的操作限流
  router.post('/api/posts/:id/like', limit.resourceLock('id'), controller.post.like);
  router.post('/api/posts/:id/comment', limit.resourceLock('id'), controller.post.comment);
};

// ========== app/middleware/business-lock.js ==========

module.exports = (app) => {
  return require('rate-limit/examples/egg-business-lock-example').createBusinessLimiters(app);
};

// ========== config/config.default.js ==========

config.middleware = ['businessLock'];

// 或者全局应用自定义业务锁
config.businessLock = {
  enable: true,
  match: '/api', // 只对 /api 路径生效
};
*/

// ============================================
// 高级场景：分布式业务锁（Redis）
// ============================================

/**
 * 使用 Redis 实现分布式业务锁
 * 适用于多服务器部署
 */
module.exports.distributedBusinessLock = (redisClient, options = {}) => {
  const { RedisStore } = require('../lib');

  const limiter = new RateLimiter({
    windowMs: options.windowMs || 60 * 1000,
    max: options.max || 100,
    algorithm: 'sliding-window',
    store: new RedisStore({
      client: redisClient,
      prefix: 'business-lock:',
    }),
    keyGenerator: (ctx) => {
      const userId = ctx.user?.id || ctx.ip;
      const route = ctx.path;
      return `user:${userId}:${route}`;
    },
  });

  return async function distributedLockMiddleware(ctx, next) {
    const key = await limiter.options.keyGenerator(ctx);
    const result = await limiter.check(key);

    if (!result.allowed) {
      ctx.status = 429;
      ctx.body = { code: 429, message: '请求过于频繁' };
      return;
    }

    await next();
  };
};

/*
// Redis 分布式锁使用示例
const Redis = require('ioredis');
const redis = new Redis({
  host: '127.0.0.1',
  port: 6379,
});

const distributedLock = require('./middleware/business-lock').distributedBusinessLock(redis, {
  windowMs: 60 * 1000,
  max: 100,
});

router.post('/api/critical-operation', distributedLock, controller.critical.operation);
*/



