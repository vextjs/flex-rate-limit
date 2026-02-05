/**
 * Egg.js 路由限流完整示例
 *
 * 核心模式：
 * - 路由定义时直接添加限流中间件
 * - 无需配置 perRoute
 * - 避免重复配置
 */

const { RateLimiter } = require('../lib');

// ============================================
// 第 1 步：创建限流中间件工厂
// ============================================

const createLimiters = () => {
  return {
    /**
     * 严格限制：15分钟最多5次
     * 用于：登录、注册、关键操作
     */
    strict: async (ctx, next) => {
      const limiter = new RateLimiter({
        windowMs: 15 * 60 * 1000,
        max: 5,
      });

      const key = ctx.ip;
      const result = await limiter.check(key, { route: ctx.path });

      ctx.set('X-RateLimit-Limit', result.limit);
      ctx.set('X-RateLimit-Remaining', result.remaining);
      ctx.set('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

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
    },

    /**
     * 中等限制：1小时最多50次
     * 用于：文件操作、数据修改
     */
    normal: async (ctx, next) => {
      const limiter = new RateLimiter({
        windowMs: 60 * 60 * 1000,
        max: 50,
      });

      const key = ctx.ip;
      const result = await limiter.check(key, { route: ctx.path });

      ctx.set('X-RateLimit-Limit', result.limit);
      ctx.set('X-RateLimit-Remaining', result.remaining);

      if (!result.allowed) {
        ctx.status = 429;
        ctx.body = {
          code: 429,
          message: '请求过于频繁',
        };
        return;
      }

      await next();
    },

    /**
     * 宽松限制：1分钟最多200次
     * 用于：数据查询、读操作
     */
    relaxed: async (ctx, next) => {
      const limiter = new RateLimiter({
        windowMs: 60 * 1000,
        max: 200,
      });

      const key = ctx.ip;
      const result = await limiter.check(key, { route: ctx.path });

      if (!result.allowed) {
        ctx.status = 429;
        ctx.body = {
          code: 429,
          message: '请求过于频繁',
        };
        return;
      }

      await next();
    },

    /**
     * 自定义工厂函数
     * 创建特定限制配置的中间件
     */
    custom: (windowMs, max) => {
      return async (ctx, next) => {
        const limiter = new RateLimiter({ windowMs, max });

        const key = ctx.ip;
        const result = await limiter.check(key, { route: ctx.path });

        if (!result.allowed) {
          ctx.status = 429;
          ctx.body = {
            code: 429,
            message: '请求过于频繁',
          };
          return;
        }

        await next();
      };
    },
  };
};

// ============================================
// 第 2 步：在路由中使用
// ============================================

module.exports = (app) => {
  const { router, controller } = app;
  const limit = createLimiters();

  // 认证相关 - 严格限制
  router.post('/api/login', limit.strict, controller.auth.login);
  router.post('/api/register', limit.strict, controller.auth.register);

  // 用户相关 - 宽松限制
  router.get('/api/users', limit.relaxed, controller.user.list);
  router.get('/api/users/:id', limit.relaxed, controller.user.detail);

  // 用户修改 - 中等限制
  router.put('/api/users/:id', limit.normal, controller.user.update);

  // 文件上传 - 中等限制
  router.post('/api/upload', limit.normal, controller.file.upload);

  // SSE 实时流 - 自定义限制
  router.get('/sse',
    limit.custom(60 * 1000, 20),
    controller.stream.sse
  );
};
