/**
 * Koa.js 集成示例
 */

const Koa = require('koa');
const { RateLimiter } = require('../lib');

const app = new Koa();

// 创建速率限制器
const limiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 分钟
  max: 10,
  algorithm: 'sliding-window',
  keyGenerator: (ctx) => {
    // 从 Koa 上下文中提取 IP
    return ctx.ip || ctx.request.ip;
  },
});

// 应用速率限制中间件
app.use(async (ctx, next) => {
  const middleware = limiter.middleware();

  // 包装 Koa 上下文以兼容
  await new Promise((resolve, reject) => {
    middleware(ctx.request, ctx.response, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

  await next();
});

// 路由
app.use(async (ctx) => {
  if (ctx.path === '/api/data') {
    ctx.body = {
      message: '数据检索成功',
      rateLimit: {
        limit: ctx.response.get('X-RateLimit-Limit'),
        remaining: ctx.response.get('X-RateLimit-Remaining'),
        reset: ctx.response.get('X-RateLimit-Reset'),
      },
    };
  } else {
    ctx.body = { message: '来自 Koa 的问候' };
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Koa 服务器运行在端口 ${PORT}`);
  console.log('尝试：');
  console.log(`  curl http://localhost:${PORT}/api/data`);
});
