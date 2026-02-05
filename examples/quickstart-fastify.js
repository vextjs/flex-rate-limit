/**
 * Fastify 快速开始示例
 *
 * 完整的路由级限流配置示例
 * 包含：插件工厂 + 路由定义
 */

const Fastify = require('fastify');
const { RateLimiter } = require('../lib');

const app = Fastify({ logger: true });

// ============================================
// 第 1 步：创建限流插件工厂
// ============================================

const createLimiters = () => {
  return {
    // 严格限制：15分钟5次（登录、注册等）
    strict: async (request, reply) => {
      const limiter = new RateLimiter({
        windowMs: 15 * 60 * 1000,
        max: 5,
      });
      const result = await limiter.check(request.ip, { route: request.url });

      reply.header('X-RateLimit-Limit', result.limit);
      reply.header('X-RateLimit-Remaining', result.remaining);

      if (!result.allowed) {
        return reply.code(429).send({
          code: 429,
          message: '请求过于频繁，请稍后再试',
        });
      }
    },

    // 中等限制：1小时50次（文件操作、数据修改）
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

    // 宽松限制：1分钟200次（数据查询、读操作）
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

    // 自定义工厂函数：创建指定参数的限流中间件
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
// 第 2 步：在路由中直接使用限流
// ============================================

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

// SSE 实时流 - 自定义限制（1分钟20个连接）
app.get('/sse', limit.custom(60 * 1000, 20), async (request, reply) => {
  reply.header('Content-Type', 'text/event-stream');
  reply.header('Cache-Control', 'no-cache');
  reply.header('Connection', 'keep-alive');

  return reply.send('data: connected\n\n');
});

// ============================================
// 启动服务器
// ============================================

const start = async () => {
  try {
    await app.listen({ port: 3000 });
    console.log(`✓ Fastify 服务器运行在 http://localhost:3000`);
    console.log(`✓ 所有路由都已应用限流中间件`);
    console.log(`✓ 使用方式：直接在路由处理器中使用 limit.strict/normal/relaxed`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

module.exports = app;



