/**
 * Fastify 路由限流统一示例
 *
 * 模式：路由定义时直接添加限流处理
 * 无需配置 perRoute，避免重复配置
 */

const Fastify = require('fastify');
const { RateLimiter } = require('../lib');

// ============================================
// 第 1 步：创建限流处理器工厂
// ============================================

const createLimiters = () => {
  return {
    // 严格限制：15分钟5次
    strict: async (request, reply) => {
      const limiter = new RateLimiter({
        windowMs: 15 * 60 * 1000,
        max: 5,
      });
      const result = await limiter.check(request.ip, { route: request.url });

      if (!result.allowed) {
        return reply.code(429).send({
          code: 429,
          message: '请求过于频繁',
        });
      }
    },

    // 中等限制：1小时50次
    normal: async (request, reply) => {
      const limiter = new RateLimiter({
        windowMs: 60 * 60 * 1000,
        max: 50,
      });
      const result = await limiter.check(request.ip, { route: request.url });

      if (!result.allowed) {
        return reply.code(429).send({
          code: 429,
          message: '请求过于频繁',
        });
      }
    },

    // 宽松限制：1分钟200次
    relaxed: async (request, reply) => {
      const limiter = new RateLimiter({
        windowMs: 60 * 1000,
        max: 200,
      });
      const result = await limiter.check(request.ip, { route: request.url });

      if (!result.allowed) {
        return reply.code(429).send({
          code: 429,
          message: '请求过于频繁',
        });
      }
    },

    // 自定义工厂函数
    custom: (windowMs, max) => {
      return async (request, reply) => {
        const limiter = new RateLimiter({ windowMs, max });
        const result = await limiter.check(request.ip, { route: request.url });

        if (!result.allowed) {
          return reply.code(429).send({
            code: 429,
            message: '请求过于频繁',
          });
        }
      };
    },
  };
};

const limit = createLimiters();

// ============================================
// 第 2 步：定义路由
// ============================================

const routes = async (app) => {
  // 认证相关 - 严格限制
  app.post('/api/login', limit.strict, async (request, reply) => {
    return { message: '登录成功' };
  });

  app.post('/api/register', limit.strict, async (request, reply) => {
    return { message: '注册成功' };
  });

  // 用户相关 - 宽松限制
  app.get('/api/users', limit.relaxed, async (request, reply) => {
    return { users: [] };
  });

  app.get('/api/users/:id', limit.relaxed, async (request, reply) => {
    return { user: {} };
  });

  // 用户修改 - 中等限制
  app.put('/api/users/:id', limit.normal, async (request, reply) => {
    return { message: '更新成功' };
  });

  // 文件上传 - 中等限制
  app.post('/api/upload', limit.normal, async (request, reply) => {
    return { message: '上传成功' };
  });

  // SSE - 自定义限制
  app.get('/sse', limit.custom(60 * 1000, 20), async (request, reply) => {
    reply.header('Content-Type', 'text/event-stream');
    return reply.send('data: connected\n\n');
  });
};

// ============================================
// 启动应用
// ============================================

const app = Fastify({ logger: true });

app.register(routes);

const start = async () => {
  try {
    await app.listen({ port: 3000 });
    console.log(`✓ Fastify 服务器运行在 http://localhost:3000`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

module.exports = app;
