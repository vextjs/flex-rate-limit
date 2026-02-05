/**
 * Koa 路由限流统一示例
 *
 * 模式：路由定义时直接添加预定义的中间件
 * 无需配置 perRoute，避免重复配置
 */

const Koa = require('koa');
const Router = require('koa-router');
const { RateLimiter } = require('../lib');

// ============================================
// 第 1 步：创建限流中间件
// ============================================

const createLimiters = () => {
  return {
    // 严格限制：15分钟5次
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
        ctx.body = { code: 429, message: '请求过于频繁' };
        return;
      }
      await next();
    },

    // 中等限制：1小时50次
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

    // 宽松限制：1分钟200次
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

    // 自定义工厂函数
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
// 第 2 步：定义应用和路由
// ============================================

const app = new Koa();
const router = new Router();
const limit = createLimiters();

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

// SSE - 自定义限制
router.get('/sse', limit.custom(60 * 1000, 20), async (ctx) => {
  ctx.type = 'text/event-stream';
  ctx.body = 'data: connected\n\n';
});

// ============================================
// 应用路由并启动
// ============================================

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✓ Koa 服务器运行在 http://localhost:${PORT}`);
  console.log(`✓ 所有路由都已应用限流中间件`);
});

module.exports = app;

// 其他中间件
const baseAuth = require('./middleware/auth').baseAuth;

// ========== 认证相关 - 严格限制 ==========

// 登录：15分钟5次
router.post('/api/login', limit.strict, async (ctx) => {
  ctx.body = { message: '登录成功' };
});

// 注册：15分钟5次
router.post('/api/register', limit.strict, async (ctx) => {
  ctx.body = { message: '注册成功' };
});

// ========== 用户相关 - 宽松限制 ==========

// 列表：1分钟200次
router.get('/api/users', limit.relaxed, async (ctx) => {
  ctx.body = { users: [] };
});

// 详情：1分钟200次
router.get('/api/users/:id', limit.relaxed, async (ctx) => {
  ctx.body = { user: {} };
});

// 修改：1小时50次
router.put('/api/users/:id', baseAuth, limit.normal, async (ctx) => {
  ctx.body = { message: '更新成功' };
});

// ========== 文件相关 - 中等限制 ==========

// 上传：1小时10次
router.post('/api/upload',
  baseAuth,
  limit.custom(60 * 60 * 1000, 10),
  async (ctx) => {
    ctx.body = { message: '上传成功' };
  }
);

// ========== 特殊端点 ==========

// SSE 实时流：1分钟20个连接
router.get('/sse',
  baseAuth,
  limit.custom(60 * 1000, 20),
  async (ctx) => {
    ctx.type = 'text/event-stream';
    ctx.body = 'data: connected\n\n';
  }
);

// 应用路由
app.use(router.routes());
app.use(router.allowedMethods());

module.exports = app;



