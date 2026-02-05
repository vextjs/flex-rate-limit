/**
 * Egg.js 快速开始示例
 *
 * 完整的路由级限流配置示例
 * 包含：中间件工厂 + 路由定义
 */

const { RateLimiter } = require('../lib');

// ============================================
// 第 1 步：创建限流中间件工厂
// ============================================
// 文件: app/middleware/rate-limit.js

module.exports = (app) => {
  return {
    // 严格限制：15分钟5次（登录、注册等）
    strict: async (ctx, next) => {
      const limiter = new RateLimiter({
        windowMs: 15 * 60 * 1000,
        max: 5,
      });
      const result = await limiter.check(ctx.ip, { route: ctx.path });

      ctx.set('X-RateLimit-Limit', result.limit);
      ctx.set('X-RateLimit-Remaining', result.remaining);

      if (!result.allowed) {
        ctx.status = 429;
        ctx.body = { code: 429, message: '请求过于频繁，请稍后再试' };
        return;
      }
      await next();
    },

    // 中等限制：1小时50次（文件操作、数据修改）
    normal: async (ctx, next) => {
      const limiter = new RateLimiter({
        windowMs: 60 * 60 * 1000,
        max: 50,
      });
      const result = await limiter.check(ctx.ip, { route: ctx.path });

      if (!result.allowed) {
        ctx.status = 429;
        ctx.body = { code: 429, message: '请求过于频繁' };
        return;
      }
      await next();
    },

    // 宽松限制：1分钟200次（数据查询、读操作）
    relaxed: async (ctx, next) => {
      const limiter = new RateLimiter({
        windowMs: 60 * 1000,
        max: 200,
      });
      const result = await limiter.check(ctx.ip, { route: ctx.path });

      if (!result.allowed) {
        ctx.status = 429;
        ctx.body = { code: 429, message: '请求过于频繁' };
        return;
      }
      await next();
    },

    // 自定义工厂函数：创建指定参数的限流中间件
    custom: (windowMs, max) => {
      return async (ctx, next) => {
        const limiter = new RateLimiter({ windowMs, max });
        const result = await limiter.check(ctx.ip, { route: ctx.path });

        if (!result.allowed) {
          ctx.status = 429;
          ctx.body = { code: 429, message: '请求过于频繁' };
          return;
        }
        await next();
      };
    },
  };
};

// ============================================
// 第 2 步：在路由中直接使用限流中间件
// ============================================
// 文件: app/router.js

module.exports = (app) => {
  const { router, controller, middleware } = app;

  // 获取限流中间件
  const limit = middleware.rateLimit(app);

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

  // SSE 实时流 - 自定义限制（1分钟20个连接）
  router.get('/sse',
    limit.custom(60 * 1000, 20),
    controller.stream.sse
  );
};

// ============================================
// 第 3 步：在 app.js 中注册中间件
// ============================================
// 文件: app.js

module.exports = (app) => {
  // 注册限流中间件
  const rateLimitFactory = require('./app/middleware/rate-limit');
  app.middleware.rateLimit = rateLimitFactory(app);

  console.log('✓ Egg.js 应用已启动');
  console.log('✓ 所有路由都已应用限流中间件');
  console.log('✓ 使用方式：直接在路由中添加 limit.strict/normal/relaxed');
};

// ============================================
// 完整路由示例
// ============================================

/**
 * 这个文件展示了一个完整的 Egg.js 限流配置
 *
 * 步骤：
 * 1. 创建中间件工厂（上面的第1部分）
 * 2. 在路由中使用中间件（上面的第2部分）
 * 3. 在 app.js 中注册（上面的第3部分）
 *
 * 使用方式非常简单：
 *
 *   router.post('/api/login', limit.strict, controller.auth.login);
 *   router.get('/api/users', limit.relaxed, controller.user.list);
 *   router.post('/api/upload', limit.normal, controller.file.upload);
 *
 * 支持的预定义中间件：
 *   - limit.strict: 15分钟5次
 *   - limit.normal: 1小时50次
 *   - limit.relaxed: 1分钟200次
 *   - limit.custom(windowMs, max): 自定义
 */
