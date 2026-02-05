/**
 *
 * Hapi.js 集成示例
 */

const { RateLimiter } = require('../lib');

// Hapi.js 插件
const rateLimitPlugin = {
  name: 'hapi-rate-limit',
  version: '1.0.0',

  register: async function (server, options) {
    // 创建速率限制器
    const limiter = new RateLimiter({
      windowMs: options.windowMs || 60 * 1000, // 默认 1 分钟
      max: options.max || 100, // 默认 100 个请求
      algorithm: options.algorithm || 'sliding-window',
      keyGenerator: (request) => {
        // 从 Hapi 请求中提取 IP
        return request.info.remoteAddress;
      },
      skip: (request) => {
        // 可选：跳过某些路径
        if (options.pathExcludes && options.pathExcludes.includes(request.path)) {
          return true;
        }
        return false;
      },
    });

    // 注册 onPreAuth 扩展点
    server.ext('onPreAuth', async (request, h) => {
      const key = request.info.remoteAddress;
      const result = await limiter.check(key, { req: request });

      // 设置响应头
      if (options.headers !== false) {
        request.plugins['hapi-rate-limit'] = {
          limit: result.limit,
          remaining: result.remaining,
          reset: result.resetTime,
        };
      }

      // 检查是否超过限制
      if (!result.allowed) {
        const response = h.response({
          statusCode: 429,
          error: 'Too Many Requests',
          message: '请求过多，请稍后再试',
          retryAfter: Math.ceil(result.retryAfter / 1000),
        }).code(429);

        response.header('X-RateLimit-Limit', result.limit);
        response.header('X-RateLimit-Remaining', result.remaining);
        response.header('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));
        response.header('Retry-After', Math.ceil(result.retryAfter / 1000));

        return response.takeover();
      }

      return h.continue;
    });

    // 注册 onPreResponse 扩展点以添加响应头
    server.ext('onPreResponse', (request, h) => {
      const rateLimit = request.plugins['hapi-rate-limit'];

      if (rateLimit && request.response.isBoom === false) {
        request.response.header('X-RateLimit-Limit', rateLimit.limit);
        request.response.header('X-RateLimit-Remaining', rateLimit.remaining);
        request.response.header('X-RateLimit-Reset', Math.ceil(rateLimit.reset / 1000));
      }

      return h.continue;
    });

    // 提供路由级别的速率限制装饰器
    server.decorate('toolkit', 'rateLimit', function (routeOptions = {}) {
      const routeLimiter = new RateLimiter({
        windowMs: routeOptions.windowMs || options.windowMs || 60 * 1000,
        max: routeOptions.max || options.max || 100,
        algorithm: routeOptions.algorithm || options.algorithm || 'sliding-window',
      });

      return {
        handler: async (request, h) => {
          const key = `route:${request.path}:${request.info.remoteAddress}`;
          const result = await routeLimiter.check(key);

          if (!result.allowed) {
            return h.response({
              statusCode: 429,
              error: 'Too Many Requests',
              message: '请求过多，请稍后再试',
              retryAfter: Math.ceil(result.retryAfter / 1000),
            })
            .code(429)
            .header('Retry-After', Math.ceil(result.retryAfter / 1000));
          }

          return h.continue;
        },
      };
    });
  },
};

module.exports = rateLimitPlugin;

// 使用示例
/*
const Hapi = require('@hapi/hapi');
const rateLimitPlugin = require('./hapi-example');

const init = async () => {
  const server = Hapi.server({
    port: 3000,
    host: 'localhost',
  });

  // 注册全局速率限制插件
  await server.register({
    plugin: rateLimitPlugin,
    options: {
      windowMs: 15 * 60 * 1000, // 15 分钟
      max: 100, // 100 个请求
      algorithm: 'sliding-window',
      headers: true,
      pathExcludes: ['/health', '/metrics'], // 排除的路径
    },
  });

  // 普通路由
  server.route({
    method: 'GET',
    path: '/api/data',
    handler: (request, h) => {
      return {
        message: '成功',
        rateLimit: request.plugins['hapi-rate-limit'],
      };
    },
  });

  // 使用路由级别的速率限制（更严格的限制）
  server.route({
    method: 'POST',
    path: '/api/login',
    options: {
      pre: [
        {
          method: async (request, h) => {
            const limiter = new RateLimiter({
              windowMs: 15 * 60 * 1000,
              max: 5, // 15 分钟只允许 5 次登录尝试
            });

            const key = `login:${request.info.remoteAddress}`;
            const result = await limiter.check(key);

            if (!result.allowed) {
              throw Boom.tooManyRequests('登录尝试次数过多');
            }

            return h.continue;
          },
        },
      ],
    },
    handler: (request, h) => {
      return { message: '登录成功' };
    },
  });

  // 健康检查（不受速率限制影响）
  server.route({
    method: 'GET',
    path: '/health',
    handler: (request, h) => {
      return { status: 'ok' };
    },
  });

  await server.start();
  console.log(`Hapi 服务器运行在 ${server.info.uri}`);
};

init();

// 使用 Redis 存储的示例
const Redis = require('ioredis');
const { RedisStore } = require('rate-limit');

const initWithRedis = async () => {
  const server = Hapi.server({
    port: 3000,
    host: 'localhost',
  });

  const redis = new Redis({
    host: 'localhost',
    port: 6379,
  });

  await server.register({
    plugin: rateLimitPlugin,
    options: {
      windowMs: 15 * 60 * 1000,
      max: 100,
      store: new RedisStore({
        client: redis,
        prefix: 'hapi-rl:',
      }),
    },
  });

  // ... 路由配置

  await server.start();
};
*/



