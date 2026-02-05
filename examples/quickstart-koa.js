/**
 * Koa 快速开始示例
 *
 * 完整的路由级限流配置示例
 * 包含：中间件工厂 + 路由定义
 */

const Koa = require('koa');
const Router = require('koa-router');
const { RateLimiter } = require('../lib');

const app = new Koa();
const router = new Router();

// ============================================
// 第 1 步：创建限流中间件工厂
// ============================================

const createLimiters = () => {
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

const limit = createLimiters();

// ============================================
// 第 2 步：在路由中直接使用限流中间件
// ============================================

// 认证相关 - 严格限制
router.post('/api/login', limit.strict, async (ctx) => {
  ctx.body = { message: '登录成功' };
});

router.post('/api/register', limit.strict, async (ctx) => {
  ctx.body = { message: '注册成功' };
});

// 用户相关 - 宽松限制
router.get('/api/users', limit.relaxed, async (ctx) => {
  ctx.body = { users: [] };
});

router.get('/api/users/:id', limit.relaxed, async (ctx) => {
  ctx.body = { user: {} };
});

// 用户修改 - 中等限制
router.put('/api/users/:id', limit.normal, async (ctx) => {
  ctx.body = { message: '更新成功' };
});

// 文件上传 - 中等限制
router.post('/api/upload', limit.normal, async (ctx) => {
  ctx.body = { message: '上传成功' };
});

// SSE 实时流 - 自定义限制（1分钟20个连接）
router.get('/sse',
  limit.custom(60 * 1000, 20),
  async (ctx) => {
    ctx.type = 'text/event-stream';
    ctx.body = 'data: connected\n\n';
  }
);

// ============================================
// 应用路由并启动服务器
// ============================================

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✓ Koa 服务器运行在 http://localhost:${PORT}`);
  console.log(`✓ 所有路由都已应用限流中间件`);
  console.log(`✓ 使用方式：直接在 router.get/post/put/delete 中添加 limit.strict/normal/relaxed`);
});

module.exports = app;
