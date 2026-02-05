// Type definitions for flex-rate-limit v1.0.0
// Project: https://github.com/vextjs/rate-limit
// Definitions by: rate-limit Team

// ========== 核心类型 ==========

/**
 * 速率限制检查结果
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
  resetTime: number;
  retryAfter: number;
  error?: string;
}

/**
 * 速率限制器配置选项
 */
export interface RateLimiterOptions {
  /**
   * 时间窗口大小（毫秒）
   * @default 60000 (1分钟)
   */
  windowMs?: number;

  /**
   * 每个时间窗口的最大请求数
   * @default 100
   */
  max?: number | ((req: any) => number | Promise<number>);

  /**
   * 限流算法：'sliding-window', 'fixed-window', 'token-bucket', 'leaky-bucket'
   * @default 'sliding-window'
   */
  algorithm?: 'sliding-window' | 'fixed-window' | 'token-bucket' | 'leaky-bucket';

  /**
   * 存储后端
   * @default 'memory'
   */
  store?: Store | 'memory' | string;

  /**
   * 从请求对象生成限流键的函数
   * @default (req) => req.ip
   */
  keyGenerator?: (req: any) => string | Promise<string>;

  /**
   * 确定是否跳过速率限制的函数
   * @default () => false
   */
  skip?: (req: any) => boolean | Promise<boolean>;

  /**
   * 超过速率限制时的自定义处理器
   */
  handler?: (req: any, res: any, next?: Function) => void | Promise<void>;

  /**
   * 是否在响应中包含速率限制头
   * @default true
   */
  headers?: boolean;

  /**
   * 跳过计数成功的请求
   * @default false
   */
  skipSuccessfulRequests?: boolean;

  /**
   * 跳过计数失败的请求
   * @default false
   */
  skipFailedRequests?: boolean;

  /**
   * 令牌桶容量（用于 token-bucket 算法）
   */
  capacity?: number;

  /**
   * 每秒令牌补充率（用于 token-bucket 算法）
   */
  refillRate?: number;

  /**
   * 每秒泄漏率（用于 leaky-bucket 算法）
   */
  leakRate?: number;

  /**
   * 路由级别配置：为不同路由设置不同的限制
   */
  perRoute?: {
    [route: string]: {
      windowMs?: number;
      max?: number;
    };
  };
}

/**
 * 存储后端接口
 */
export interface Store {
  get(key: string): Promise<any>;
  set(key: string, value: any, ttl?: number): Promise<void>;
  increment(key: string, options?: any): Promise<{ count: number; resetTime: number }>;
  decrement?(key: string): Promise<void>;
  reset(key: string): Promise<void>;
  resetAll?(): Promise<void>;
}

/**
 * Redis 存储选项
 */
export interface RedisStoreOptions {
  /**
   * Redis 客户端实例（ioredis）
   */
  client: any;

  /**
   * 键前缀
   * @default 'rl:'
   */
  prefix?: string;

  /**
   * 默认过期时间（秒）
   * @default 3600
   */
  expiry?: number;
}

/**
 * 限流算法接口
 */
export interface Algorithm {
  check(store: Store, key: string, options: any): Promise<{ count: number; resetTime: number }>;
}

/**
 * 预定义的键生成器接口
 */
export interface KeyGenerators {
  /**
   * 按 IP 地址生成键
   */
  ip(req: any, context?: any): string;

  /**
   * 按用户 ID 生成键（需要 req.user.id）
   */
  userId(req: any, context?: any): string;

  /**
   * 按路由和 IP 组合生成键
   */
  routeAndIp(req: any, context?: any): string;

  /**
   * 按 API 端点生成键
   */
  apiEndpoint(req: any, context?: any): string;

  /**
   * 按用户和路由组合生成键
   */
  userAndRoute(req: any, context?: any): string;
}

// ========== 导出的类 ==========

/**
 * RateLimiter 主类
 */
export class RateLimiter {
  constructor(options?: RateLimiterOptions);

  /**
   * 检查请求是否被允许
   * @param key - 限流键
   * @param options - 选项对象，包含 req 和路由上下文
   * @returns 检查结果
   */
  check(key: string, options?: { req?: any; route?: string }): Promise<RateLimitResult>;

  /**
   * 重置特定键的速率限制
   * @param key - 要重置的键
   */
  reset(key: string): Promise<void>;

  /**
   * 重置所有速率限制（仅限内存存储）
   */
  resetAll(): Promise<void>;

  /**
   * 为 Web 框架创建中间件
   * @param options - 中间件选项
   * @returns Express/Koa 中间件函数
   */
  middleware(options?: any): (req: any, res: any, next?: Function) => Promise<void>;
}

/**
 * 内存存储后端
 */
export class MemoryStore implements Store {
  constructor();
  get(key: string): Promise<any>;
  set(key: string, value: any, ttl?: number): Promise<void>;
  increment(key: string, options?: any): Promise<{ count: number; resetTime: number }>;
  decrement(key: string): Promise<void>;
  reset(key: string): Promise<void>;
  resetAll(): Promise<void>;
  size(): number;
}

/**
 * Redis 存储后端
 */
export class RedisStore implements Store {
  constructor(options: RedisStoreOptions);
  get(key: string): Promise<any>;
  set(key: string, value: any, ttl?: number): Promise<void>;
  increment(key: string, options?: any): Promise<{ count: number; resetTime: number }>;
  decrement(key: string): Promise<void>;
  reset(key: string): Promise<void>;
  resetAll(): Promise<void>;
}

// ========== 导出的常量 ==========

/**
 * 可用的限流算法
 */
export const algorithms: {
  'sliding-window': Algorithm;
  'fixed-window': Algorithm;
  'token-bucket': Algorithm;
  'leaky-bucket': Algorithm;
};

/**
 * 预定义的键生成器集合
 */
export const keyGenerators: KeyGenerators;



