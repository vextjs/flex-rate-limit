# 高级用法

## 📚 目录

- [不同路由的不同限制](#不同路由的不同限制)
  - [Express 示例](#express-示例)
  - [Koa 示例](#koa-示例)
  - [路由参数说明](#路由参数说明)
- [动态限制（按用户等级）](#动态限制按用户等级)
- [自定义键生成器](#自定义键生成器)
  - [按IP限制](#按ip限制)
  - [按用户ID限制](#按用户id限制)
  - [按用户和路由限制（业务锁）](#按用户和路由限制业务锁)
  - [按API密钥限制](#按api密钥限制)
- [跳过某些请求](#跳过某些请求)
- [自定义限流响应](#自定义限流响应)
- [Redis 分布式存储](#redis-分布式存储)
- [自定义存储后端](#自定义存储后端)

---

## 不同路由的不同限制

### Express 示例

```javascript
const limiter = new RateLimiter({
  windowMs: 60 * 1000,
  max: 100, // 默认限制
  
  perRoute: {
    // 登录端点：15分钟最多5次尝试
    '/api/login': {
      windowMs: 15 * 60 * 1000,
      max: 5,
    },
    
    // 带路由参数的登录：每个用户ID单独限制
    // 路由参数 :id 会被匹配为正则表达式 [^/]+
    // 支持 /api/login/123, /api/login/abc 等
    '/api/login/:id': {
      windowMs: 15 * 60 * 1000,
      max: 5, // 每个用户ID的15分钟限制为5次
    },
    
    // 注册端点：24小时最多3次注册
    '/api/register': {
      windowMs: 24 * 60 * 60 * 1000,
      max: 3,
    },
    
    // 用户详情：多个路由参数
    // 支持 /api/users/123, /api/users/abc 等
    '/api/users/:id': {
      windowMs: 60000,
      max: 50,
    },
    
    // 更复杂的路由参数
    // 支持 /api/posts/123/comments/456
    '/api/posts/:postId/comments/:commentId': {
      windowMs: 60000,
      max: 30,
    },
    
    // 文件上传：1小时最多10次上传
    '/api/upload': {
      windowMs: 60 * 60 * 1000,
      max: 10,
    },
  },
});

app.use(limiter.middleware());
```

### Egg.js 路由级别应用（最实用方案）

这是最推荐的方式 - 在路由定义时直接添加限流中间件，就像添加身份验证中间件一样！

#### 第 1 步：创建限流中间件工厂

**文件**: `app/middleware/rate-limit.js`

```javascript
const { RateLimiter } = require('rate-limit');

module.exports = (app) => {
  return {
    strict: async (ctx, next) => {
      const limiter = new RateLimiter({
        windowMs: 15 * 60 * 1000,
        max: 5,
      });
      const result = await limiter.check(ctx.ip, { route: ctx.path });
      
      ctx.set('X-RateLimit-Limit', result.limit);
      ctx.set('X-RateLimit-Remaining', result.remaining);
      
      if (!result.allowed) {
        ctx.status = 429;
        ctx.body = { code: 429, message: '请求过于频繁' };
        return;
      }
      await next();
    },
    
    normal: async (ctx, next) => {
      const limiter = new RateLimiter({
        windowMs: 60 * 60 * 1000,
        max: 50,
      });
      const result = await limiter.check(ctx.ip, { route: ctx.path });
      
      if (!result.allowed) {
        ctx.status = 429;
        ctx.body = { code: 429, message: '请求过于频繁' };
        return;
      }
      await next();
    },
    
    relaxed: async (ctx, next) => {
      const limiter = new RateLimiter({
        windowMs: 60 * 1000,
        max: 200,
      });
      const result = await limiter.check(ctx.ip, { route: ctx.path });
      
      if (!result.allowed) {
        ctx.status = 429;
        ctx.body = { code: 429, message: '请求过于频繁' };
        return;
      }
      await next();
    },
    
    custom: (windowMs, max) => {
      return async (ctx, next) => {
        const limiter = new RateLimiter({ windowMs, max });
        const result = await limiter.check(ctx.ip, { route: ctx.path });
        
        if (!result.allowed) {
          ctx.status = 429;
          ctx.body = { code: 429, message: '请求过于频繁' };
          return;
        }
        await next();
      };
    },
  };
};
```

#### 第 2 步：在路由中使用

**文件**: `app/router.js`

```javascript
module.exports = (app) => {
  const { router, controller, middleware } = app;
  const limit = middleware.rateLimit(app);
  const baseAuth = middleware.baseAuth;

  // 认证相关 - 严格限制
  router.post('/api/login', limit.strict, controller.auth.login);
  router.post('/api/register', limit.strict, controller.auth.register);

  // 用户相关 - 宽松限制
  router.get('/api/users', limit.relaxed, controller.user.list);
  router.get('/api/users/:id', limit.relaxed, controller.user.detail);

  // 文件相关 - 中等限制
  router.post('/api/upload', baseAuth, limit.normal, controller.file.upload);

  // 特殊端点 - 自定义限制
  router.get('/sse',
    baseAuth,
    limit.custom(60 * 1000, 20),
    controller.stream.sse
  );
};
```

#### 第 3 步：app.js 注册

```javascript
module.exports = (app) => {
  const rateLimitFactory = require('./app/middleware/rate-limit');
  app.middleware.rateLimit = rateLimitFactory(app);
};
```

## 自定义键生成器

### 为什么需要键生成器？

**键生成器决定"按什么维度限流"**，不同的维度有不同的效果。

### 键生成器对比

| 键生成器 | 生成的Key示例 | 实际效果 | 适用场景 | 优缺点 |
|---------|-------------|---------|---------|--------|
| **按IP** | `192.168.1.1` | 同一IP下所有用户共享限额 | 公开API | ❌ 公司/网吧所有人共享 |
| **按用户** | `user:123` | 每个用户独立限额 | 登录后API | ✅ 公平；❌ 未登录用户不限制 |
| **按路由+IP** | `192.168.1.1:/api/login` | 同一IP在每个路由上独立限额 | 混合场景 | ✅ 路由隔离；❌ 同IP用户共享 |
| **按用户+路由** | `user:123:/api/login` | 每个用户在每个路由上独立限额 | 业务系统 ⭐ | ✅ 最精细；✅ 完全隔离 |

### 实际场景对比

#### 场景：公司网络（50个员工共享同一IP）

**情况1：按IP限制**
```javascript
keyGenerator: 'ip'  // Key: 192.168.1.1

// 配置：1分钟100次
// 实际效果：
// - 50个员工共享100次配额
// - 员工A用了50次，其他49个人只剩50次
// ❌ 问题：互相影响，不公平
```

**情况2：按用户限制**
```javascript
keyGenerator: 'userId'  // Key: user:1, user:2, user:3, ...

// 配置：1分钟100次
// 实际效果：
// - 每个员工独立100次配额
// - 员工A用了100次，不影响员工B
// ✅ 优势：公平，互不影响
```

**情况3：按用户+路由限制（业务锁）**
```javascript
keyGenerator: 'userAndRoute'  
// Key: user:1:/api/login, user:1:/api/data, user:2:/api/login, ...

// 配置：1分钟100次
// 实际效果：
// - 每个员工在每个接口上独立100次配额
// - 员工A在/api/login用了100次，不影响他在/api/data的配额
// - 也不影响员工B的任何配额
// ✅ 优势：最精细的控制，完全隔离
```

---

### 预定义键生成器详解

```javascript
const { RateLimiter } = require('@vextjs/rate-limit');

// 1. 按 IP 限制（默认）
const limiter1 = new RateLimiter({
  keyGenerator: 'ip',  // 生成Key: 192.168.1.1
});
// ✅ 适用：公开API，无需登录
// ❌ 问题：同一IP的所有用户共享限额

// 2. 按用户 ID 限制
const limiter2 = new RateLimiter({
  keyGenerator: 'userId',  // 生成Key: user:123
});
// ✅ 适用：需要登录的API
// ⚠️ 注意：未登录用户会回退到IP限制

// 3. 按路由+IP 限制
const limiter3 = new RateLimiter({
  keyGenerator: 'routeAndIp',  // 生成Key: 192.168.1.1:/api/login
});
// ✅ 适用：不同接口需要不同限制
// ❌ 问题：同一IP的用户仍然共享

// 4. 按API端点限制
const limiter4 = new RateLimiter({
  keyGenerator: 'apiEndpoint',  // 生成Key: /api/v1/data:192.168.1.1
});
// ✅ 适用：RESTful API，按端点独立限制

// 5. 按用户+路由限制（业务锁，推荐）⭐
const limiter5 = new RateLimiter({
  keyGenerator: 'userAndRoute',  // 生成Key: user:123:/api/login
});
// ✅ 适用：业务系统（推荐）
// ✅ 优势：最精细的控制，完全隔离
```

---

### 自定义键生成器

#### 示例1：按IP限制

```javascript
const limiter = new RateLimiter({
  keyGenerator: (req) => req.ip,
  // 生成Key: 192.168.1.1
  // 实际效果：同一IP的所有请求共享限额
});
```

#### 示例2：按用户ID限制

```javascript
const limiter = new RateLimiter({
  keyGenerator: (req) => {
    const userId = req.user?.id || req.ip;
    return `user:${userId}`;
    // 登录用户: user:123
    // 未登录用户: user:192.168.1.1
    // 实际效果：每个用户独立限额，未登录按IP
  },
});
```

#### 示例3：按用户+路由限制（业务锁）⭐

```javascript
const limiter = new RateLimiter({
  keyGenerator: (req, context) => {
    const userId = req.user?.id || req.ip;
    const route = context?.route || req.path;
    return `user:${userId}:${route}`;
    // 生成Key: user:123:/api/login
    // 实际效果：每个用户在每个路由上独立限额
  },
});

// 为什么推荐这种方式？
// ✅ 完全隔离：用户A在登录接口的限流不影响查询接口
// ✅ 公平性：不同用户互不影响
// ✅ 精确控制：可以为每个接口设置不同限制
```

#### 示例4：按API密钥限制

```javascript
const limiter = new RateLimiter({
  keyGenerator: (req) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    return `apikey:${apiKey || req.ip}`;
    // 有API Key: apikey:sk_1234567890
    // 无API Key: apikey:192.168.1.1
    // 实际效果：按API Key限流，适合开放平台
  },
});
```

---

### 键生成器选择决策树

```
开始
│
├─ 是否有用户登录系统？
│  ├─ 否 → 按IP限制（ip）
│  └─ 是 ↓
│
├─ 是否需要区分不同接口？
│  ├─ 否 → 按用户限制（userId）
│  └─ 是 ↓
│
└─ 每个用户在每个接口是否需要独立限额？
   ├─ 是 → 按用户+路由限制（userAndRoute）⭐ 推荐
   └─ 否 → 按路由+IP限制（routeAndIp）
```

---

## 动态限制（按用户等级）

```javascript
// 根据用户等级设置不同的限制
const limiter = new RateLimiter({
  max: async (req) => {
    const user = await getUserFromRequest(req);
    
    // 不同用户等级有不同的限制
    const limits = {
      free: 100,      // 免费用户：100次/分钟
      basic: 500,     // 基础用户：500次/分钟
      premium: 5000,  // 高级用户：5000次/分钟
      enterprise: Infinity, // 企业用户：无限制
    };
    
    return limits[user?.tier || 'free'];
  },
});
```

## 自定义键生成器

```javascript
const limiter = new RateLimiter({
  keyGenerator: (req) => {
    // 根据用户 ID 而不是 IP 限制速率
    // 如果未登录，使用 IP 作为备用
    if (req.user?.id) {
      return `user:${req.user.id}`;
    }
    return `ip:${req.ip}`;
  },
});
```

## 跳过条件

```javascript
const limiter = new RateLimiter({
  skip: (req) => {
    // 跳过管理员用户的速率限制
    if (req.user?.role === 'admin') {
      return true;
    }
    
    // 跳过健康检查端点
    if (req.path === '/health' || req.path === '/metrics') {
      return true;
    }
    
    // 跳过内部请求（例如来自本地IP）
    if (req.ip === '127.0.0.1' || req.ip === '::1') {
      return true;
    }
    
    return false;
  },
});
```

## 手动速率限制检查

```javascript
const result = await limiter.check('user-123');

if (result.allowed) {
  console.log(`请求被允许`);
  console.log(`剩余：${result.remaining}/${result.limit}`);
  console.log(`重置时间：${new Date(result.resetTime)}`);
} else {
  console.log(`超过限制`);
  console.log(`重试间隔：${result.retryAfter}ms`);
}
```

## 重置速率限制

```javascript
// 重置特定键的限制计数
await limiter.reset('user-123');

// 重置所有键（仅限内存存储）
await limiter.resetAll();
```

---

## 📚 相关文档

**深入学习**：
- 📖 [业务锁指南](./business-lock-guide.md) - 业务系统最佳实践
- 📖 [存储后端](./storage.md) - Redis集群配置和性能优化

**基础知识**：
- 📖 [配置详解](./config.md) - 配置选项详细说明
- 📖 [快速开始](./quickstart.md) - 基础用法和快速集成

**返回**：
- 📖 [文档中心](./README.md) - 查看所有文档和学习路径

