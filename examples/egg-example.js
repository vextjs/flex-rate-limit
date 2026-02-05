/**
 * Egg.js 集成示例
 */

const { RateLimiter } = require('../lib');

// Egg.js 中间件工厂函数
module.exports = (options = {}) => {
  // 创建速率限制器
  const limiter = new RateLimiter({
    windowMs: options.windowMs || 60 * 1000, // 默认 1 分钟
    max: options.max || 100, // 默认 100 个请求
    algorithm: options.algorithm || 'sliding-window',
    keyGenerator: (ctx) => {
      // 从 Egg.js 上下文中提取 IP
      return ctx.ip || ctx.request.ip;
    },
    skip: (ctx) => {
      // 可选：跳过某些路径
      return options.skip ? options.skip(ctx) : false;
    },
    handler: (ctx) => {
      // Egg.js 风格的错误处理
      ctx.status = 429;
      ctx.body = {
        code: 429,
        message: '请求过多，请稍后再试',
        retryAfter: ctx.get('Retry-After'),
      };
    },
  });

  // 返回 Egg.js 中间件
  return async function rateLimitMiddleware(ctx, next) {
    const middleware = limiter.middleware();

    // 包装为 Promise
    await new Promise((resolve, reject) => {
      // 创建兼容的 req/res 对象
      const req = {
        ip: ctx.ip,
        path: ctx.path,
        ...ctx.request,
      };

      const res = {
        status: (code) => {
          ctx.status = code;
          return res;
        },
        json: (data) => {
          ctx.body = data;
        },
        setHeader: (key, value) => {
          ctx.set(key, value);
        },
        getHeader: (key) => {
          return ctx.get(key);
        },
      };

      middleware(req, res, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // 如果没有被限制，继续执行
    if (ctx.status !== 429) {
      await next();
    }
  };
};

// 使用示例（在 app/middleware/rate_limit.js 中）
/*
// config/config.default.js
config.rateLimit = {
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100,
  algorithm: 'sliding-window',
};

// config/plugin.js
exports.rateLimit = {
  enable: true,
  package: 'rate-limit',
};

// app.js 或 app/middleware/rate_limit.js
module.exports = app => {
  const rateLimitMiddleware = require('rate-limit/examples/egg-example');

  app.middleware.rateLimit = rateLimitMiddleware(app.config.rateLimit);

  // 应用到所有路由
  app.config.coreMiddleware.push('rateLimit');

  // 或者在 router 中选择性应用
  // app.router.get('/api/data', app.middleware.rateLimit(), controller.data.index);
};

// 在控制器中使用
// app/controller/home.js
class HomeController extends Controller {
  async index() {
    const { ctx } = this;
    ctx.body = {
      message: '成功',
      rateLimit: {
        limit: ctx.get('X-RateLimit-Limit'),
        remaining: ctx.get('X-RateLimit-Remaining'),
        reset: ctx.get('X-RateLimit-Reset'),
      },
    };
  }
}

// 不同路由不同限制
// app/router.js
module.exports = app => {
  const { router, controller } = app;

  // 严格限制的登录接口
  const strictRateLimit = require('rate-limit/examples/egg-example')({
    windowMs: 15 * 60 * 1000,
    max: 5,
  });

  // 普通接口
  const normalRateLimit = require('rate-limit/examples/egg-example')({
    windowMs: 60 * 1000,
    max: 100,
  });

  router.post('/api/login', strictRateLimit, controller.auth.login);
  router.get('/api/data', normalRateLimit, controller.data.index);
  router.get('/health', controller.health.index); // 不应用速率限制
};
*/
