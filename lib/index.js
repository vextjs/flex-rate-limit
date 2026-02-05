/**
 * rate-limit - Node.js 通用速率限制模块
 * @module rate-limit
 */

const RateLimiter = require('./rate-limiter');
const MemoryStore = require('./stores/memory-store');
const RedisStore = require('./stores/redis-store');
const algorithms = require('./algorithms');

module.exports = {
  RateLimiter,
  MemoryStore,
  RedisStore,
  algorithms,
  // 预定义的键生成器（可选导出）
  keyGenerators: {
    ip: (req) => req.ip || req.socket?.remoteAddress || 'unknown',
    userId: (req) => `user:${req.user?.id || req.ip || 'unknown'}`,
    routeAndIp: (req, context) => {
      const route = context?.route || 'unknown';
      const ip = req.ip || req.socket?.remoteAddress || 'unknown';
      return `${route}:${ip}`;
    },
    apiEndpoint: (req, context) => {
      const route = context?.route || 'unknown';
      const ip = req.ip || req.socket?.remoteAddress || 'unknown';
      return `api:${route}:${ip}`;
    },
    userAndRoute: (req, context) => {
      const userId = req.user?.id || req.ip || 'unknown';
      const route = context?.route || 'unknown';
      return `user:${userId}:${route}`;
    },
  },
};
