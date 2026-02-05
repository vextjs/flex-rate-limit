/**
 * Egg.js 路由限流 - 智能自动配置方案
 *
 * 核心思想：
 * 不需要单独配置 perRoute，路由定义时直接添加中间件
 * 所有框架统一的模式，避免重复配置
 *
 * 使用方式：
 * 1. 创建限流中间件工厂函数
 * 2. 在路由定义时直接添加预定义的中间件
 * 3. 无需在任何地方重复配置
 */

const { RateLimiter } = require('../lib');

// ============================================
// 第 1 步：创建预定义的限流中间件
// ============================================

const createLimiters = () => {
  return {
    /**
     * 严格限制：15分钟5次
     * 用于：登录、注册、关键操作
     */
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

    /**
     * 中等限制：1小时50次
     * 用于：文件操作、数据修改
     */
    normal: async (ctx, next) => {
      const limiter = new RateLimiter({
        windowMs: 60 * 60 * 1000,
        max: 50,
      });
      const result = await limiter.check(ctx.ip, { route: ctx.path });

      ctx.set('X-RateLimit-Limit', result.limit);
      ctx.set('X-RateLimit-Remaining', result.remaining);

      if (!result.allowed) {
        ctx.status = 429;
        ctx.body = { code: 429, message: '请求过于频繁' };
        return;
      }

      await next();
    },

    /**
     * 宽松限制：1分钟200次
     * 用于：数据查询、读操作
     */
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

    /**
     * 自定义工厂函数
     * 创建特定限制配置的中间件
     */
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
// 第 2 步：在路由中使用
// ============================================

module.exports = (app) => {
  const { router, controller } = app;
  const limit = createLimiters();

  // ========== 认证相关 - 严格限制 ==========
  router.post('/api/login', limit.strict, controller.auth.login);
  router.post('/api/register', limit.strict, controller.auth.register);

  // ========== 用户相关 - 宽松限制 ==========
  router.get('/api/users', limit.relaxed, controller.user.list);
  router.get('/api/users/:id', limit.relaxed, controller.user.detail);

  // ========== 用户修改 - 中等限制 ==========
  router.put('/api/users/:id', limit.normal, controller.user.update);

  // ========== 文件操作 - 中等限制 ==========
  router.post('/api/upload', limit.normal, controller.file.upload);

  // ========== 特殊端点 - 自定义限制 ==========
  // SSE 实时流：1分钟20个连接
  router.get('/sse',
    limit.custom(60 * 1000, 20),
    controller.stream.sse
  );
};

// ============================================
// 核心优势说明
// ============================================

/**
 * 这种模式相比传统的 perRoute 配置有以下优势：
 *
 * 1️⃣  无需重复配置
 *    ❌ 传统方式：需要在两个地方配置（perRoute + 路由中间件）
 *    ✅ 新方式：只在路由中添加中间件，一处搞定
 *
 * 2️⃣  统一的模式
 *    ❌ 传统方式：Express、Koa、Egg.js 都不一样
 *    ✅ 新方式：所有框架都使用统一的中间件模式
 *
 * 3️⃣  清晰易维护
 *    ❌ 传统方式：修改某个路由的限制需要改多个地方
 *    ✅ 新方式：路由和限流配置在一起，一目了然
 *
 * 4️⃣  灵活性高
 *    ❌ 传统方式：只能预定义的配置，难以扩展
 *    ✅ 新方式：预定义中间件快速使用，自定义工厂函数创建特殊限制
 *
 * 5️⃣  符合框架习惯
 *    ✅ 就像添加其他中间件（如身份验证）一样简单
 */



