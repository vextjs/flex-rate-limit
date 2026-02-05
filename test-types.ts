/**
 * TypeScript 类型定义测试文件
 * 用于验证 index.d.ts 的完整性和正确性
 */

// 测试 1: 命名导出
import {
  RateLimiter,
  MemoryStore,
  RedisStore,
  algorithms,
  keyGenerators,
  RateLimitResult,
  RateLimiterOptions,
  Store,
  RedisStoreOptions,
  RedisClient,
  Algorithm,
  KeyGenerators,
  MiddlewareOptions,
} from './index';

// 测试 2: 默认导出
import rateLimitModule from './index';

// 测试 3: 创建 RateLimiter 实例
const limiter1 = new RateLimiter();
const limiter2 = new RateLimiter({
  windowMs: 60000,
  max: 100,
  algorithm: 'sliding-window',
});

// 测试 4: 使用 MemoryStore
const memStore = new MemoryStore();

// 测试 5: 使用 RedisStore (需要 Redis 客户端)
const mockRedisClient: RedisClient = {
  get: async (key: string) => null,
  set: async (key: string, value: string) => 'OK',
  setex: async (key: string, seconds: number, value: string) => 'OK',
  incr: async (key: string) => 1,
  decr: async (key: string) => 0,
  del: async (...keys: string[]) => keys.length,
  keys: async (pattern: string) => [],
  expire: async (key: string, seconds: number) => 1,
  zadd: async (key: string, score: number, member: string) => 1,
  zcard: async (key: string) => 0,
  zremrangebyscore: async (key: string, min: string | number, max: string | number) => 0,
  zpopmax: async (key: string) => [],
  type: async (key: string) => 'string',
};

const redisStore = new RedisStore({
  client: mockRedisClient,
  prefix: 'test:',
  expiry: 3600,
});

// 测试 6: check 方法
async function testCheck() {
  const result: RateLimitResult = await limiter1.check('test-key', {
    req: {},
    route: '/api/test',
  });

  console.log(result.allowed);
  console.log(result.limit);
  console.log(result.current);
  console.log(result.remaining);
  console.log(result.resetTime);
  console.log(result.retryAfter);
  console.log(result.error);
}

// 测试 7: reset 方法
async function testReset() {
  await limiter1.reset('test-key');
  await limiter1.resetAll();
}

// 测试 8: middleware 方法
const middleware1 = limiter1.middleware();
const middleware2 = limiter1.middleware({});
const middleware3 = limiter1.middleware({ customOption: true });

// 测试 9: 使用 keyGenerators
const key1 = keyGenerators.ip({ ip: '127.0.0.1' });
const key2 = keyGenerators.userId({ user: { id: '123' } });
const key3 = keyGenerators.routeAndIp({ ip: '127.0.0.1' }, { route: '/api/test' });
const key4 = keyGenerators.apiEndpoint({ ip: '127.0.0.1' }, { route: '/api/test' });
const key5 = keyGenerators.userAndRoute({ user: { id: '123' } }, { route: '/api/test' });

// 测试 10: 使用 algorithms
const algo1 = algorithms['sliding-window'];
const algo2 = algorithms['fixed-window'];
const algo3 = algorithms['token-bucket'];
const algo4 = algorithms['leaky-bucket'];

// 测试 11: 默认导出
const limiter3 = new rateLimitModule.RateLimiter();
const memStore2 = new rateLimitModule.MemoryStore();
const key6 = rateLimitModule.keyGenerators.ip({ ip: '127.0.0.1' });

// 测试 12: 函数式 max
const limiterWithFunctionMax = new RateLimiter({
  max: async (req: any) => {
    return req.user?.premium ? 1000 : 100;
  },
});

// 测试 13: 自定义 handler
const limiterWithHandler = new RateLimiter({
  handler: async (req, res, next) => {
    if (res) {
      res.status(429).json({ error: 'Too many requests' });
    }
  },
});

// 测试 14: 自定义 keyGenerator
const limiterWithKeyGen = new RateLimiter({
  keyGenerator: async (req, context) => {
    return `custom:${req.ip}:${context?.route || 'unknown'}`;
  },
});

// 测试 15: skip 函数
const limiterWithSkip = new RateLimiter({
  skip: async (req) => {
    return req.path === '/health';
  },
});

// 测试 16: perRoute 配置
const limiterWithPerRoute = new RateLimiter({
  perRoute: {
    '/api/auth/login': {
      windowMs: 900000,
      max: 5,
    },
    '/api/data': {
      windowMs: 60000,
      max: 100,
    },
  },
});

// 测试 17: 令牌桶算法配置
const tokenBucketLimiter = new RateLimiter({
  algorithm: 'token-bucket',
  capacity: 100,
  refillRate: 10,
});

// 测试 18: 漏桶算法配置
const leakyBucketLimiter = new RateLimiter({
  algorithm: 'leaky-bucket',
  leakRate: 5,
});

// 测试 19: Store 接口实现
const customStore: Store = {
  get: async (key: string) => null,
  set: async (key: string, value: any, ttl?: number) => {},
  increment: async (key: string, options?: any) => ({
    count: 1,
    resetTime: Date.now() + 60000,
  }),
  decrement: async (key: string) => {},
  reset: async (key: string) => {},
  resetAll: async () => {},
};

const limiterWithCustomStore = new RateLimiter({
  store: customStore,
});

console.log('✅ 所有类型定义测试通过！');
