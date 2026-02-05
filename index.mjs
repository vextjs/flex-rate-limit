/**
 * rate-limit - Node.js 通用速率限制模块
 * ESM 入口文件
 */

import RateLimiterCJS from './lib/rate-limiter.js';
import MemoryStoreCJS from './lib/stores/memory-store.js';
import RedisStoreCJS from './lib/stores/redis-store.js';
import algorithmsCJS from './lib/algorithms/index.js';

export const RateLimiter = RateLimiterCJS;
export const MemoryStore = MemoryStoreCJS;
export const RedisStore = RedisStoreCJS;
export const algorithms = algorithmsCJS;

// 预定义的键生成器
export const keyGenerators = {
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
};

export default {
  RateLimiter,
  MemoryStore,
  RedisStore,
  algorithms,
  keyGenerators,
};
