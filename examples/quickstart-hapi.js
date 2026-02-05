/**
 * Hapi 快速开始示例
 *
 * 完整的路由级限流配置示例
 * 包含：限流配置 + 路由定义
 */

const Hapi = require('@hapi/hapi');
const { RateLimiter } = require('../lib');

// ============================================
// 第 1 步：创建限流预检查函数
// ============================================

const createRateLimitPreReqs = () => {
  return {
    // 严格限制：15分钟5次（登录、注册等）
    strict: {
      assign: 'rateLimit',
      method: async (request, h) => {
        const limiter = new RateLimiter({
          windowMs: 15 * 60 * 1000,
          max: 5,
        });
        const result = await limiter.check(request.ip, { route: request.path });

        if (!result.allowed) {
          return h.response({
            code: 429,
            message: '请求过于频繁，请稍后再试',
          }).code(429).takeover();
        }
        return result;
      },
    },

    // 中等限制：1小时50次（文件操作、数据修改）
    normal: {
      assign: 'rateLimit',
      method: async (request, h) => {
        const limiter = new RateLimiter({
          windowMs: 60 * 60 * 1000,
          max: 50,
        });
        const result = await limiter.check(request.ip, { route: request.path });

        if (!result.allowed) {
          return h.response({
            code: 429,
            message: '请求过于频繁',
          }).code(429).takeover();
        }
        return result;
      },
    },

    // 宽松限制：1分钟200次（数据查询、读操作）
    relaxed: {
      assign: 'rateLimit',
      method: async (request, h) => {
        const limiter = new RateLimiter({
          windowMs: 60 * 1000,
          max: 200,
        });
        const result = await limiter.check(request.ip, { route: request.path });

        if (!result.allowed) {
          return h.response({
            code: 429,
            message: '请求过于频繁',
          }).code(429).takeover();
        }
        return result;
      },
    },

    // 自定义工厂函数：创建指定参数的限流中间件
    custom: (windowMs, max) => ({
      assign: 'rateLimit',
      method: async (request, h) => {
        const limiter = new RateLimiter({ windowMs, max });
        const result = await limiter.check(request.ip, { route: request.path });

        if (!result.allowed) {
          return h.response({
            code: 429,
            message: '请求过于频繁',
          }).code(429).takeover();
        }
        return result;
      },
    }),
  };
};

// ============================================
// 第 2 步：定义路由
// ============================================

const init = async () => {
  const server = Hapi.server({
    port: 3000,
    host: 'localhost',
  });

  const preReqs = createRateLimitPreReqs();

  // 认证相关 - 严格限制
  server.route({
    method: 'POST',
    path: '/api/login',
    options: {
      pre: [preReqs.strict],
    },
    handler: async (request, h) => {
      return { message: '登录成功' };
    },
  });

  server.route({
    method: 'POST',
    path: '/api/register',
    options: {
      pre: [preReqs.strict],
    },
    handler: async (request, h) => {
      return { message: '注册成功' };
    },
  });

  // 用户相关 - 宽松限制
  server.route({
    method: 'GET',
    path: '/api/users',
    options: {
      pre: [preReqs.relaxed],
    },
    handler: async (request, h) => {
      return { users: [] };
    },
  });

  server.route({
    method: 'GET',
    path: '/api/users/{id}',
    options: {
      pre: [preReqs.relaxed],
    },
    handler: async (request, h) => {
      return { user: {} };
    },
  });

  // 用户修改 - 中等限制
  server.route({
    method: 'PUT',
    path: '/api/users/{id}',
    options: {
      pre: [preReqs.normal],
    },
    handler: async (request, h) => {
      return { message: '更新成功' };
    },
  });

  // 文件上传 - 中等限制
  server.route({
    method: 'POST',
    path: '/api/upload',
    options: {
      pre: [preReqs.normal],
    },
    handler: async (request, h) => {
      return { message: '上传成功' };
    },
  });

  // SSE 实时流 - 自定义限制（1分钟20个连接）
  server.route({
    method: 'GET',
    path: '/sse',
    options: {
      pre: [preReqs.custom(60 * 1000, 20)],
    },
    handler: async (request, h) => {
      return { message: 'SSE连接成功' };
    },
  });

  await server.start();
  console.log(`✓ Hapi 服务器运行在 ${server.info.uri}`);
  console.log(`✓ 所有路由都已应用限流中间件`);
  console.log(`✓ 使用方式：在路由的 pre 选项中添加限流预检查`);
};

init().catch((err) => {
  console.error(err);
  process.exit(1);
});

module.exports = { init };

// ============================================
// 使用说明
// ============================================

/**
 * Hapi 框架使用 pre hooks 来实现限流
 *
 * 基本模式：
 *
 *   server.route({
 *     method: 'POST',
 *     path: '/api/login',
 *     options: {
 *       pre: [preReqs.strict],  // 添加严格限流
 *     },
 *     handler: async (request, h) => {
 *       return { message: '登录成功' };
 *     },
 *   });
 *
 * 支持的预定义限流：
 *   - preReqs.strict: 15分钟5次
 *   - preReqs.normal: 1小时50次
 *   - preReqs.relaxed: 1分钟200次
 *   - preReqs.custom(windowMs, max): 自定义
 */
