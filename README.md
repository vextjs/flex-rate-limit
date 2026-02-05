# flex-rate-limit

> Node.js 通用速率限制模块 - 框架无关、灵活且生产就绪

[![npm version](https://img.shields.io/npm/v/flex-rate-limit.svg)](https://www.npmjs.com/package/flex-rate-limit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/flex-rate-limit.svg)](https://nodejs.org)

## ✨ 特性

- 🚀 **框架无关** - 支持 Express、Koa、Egg.js、Hapi、Fastify 等所有主流框架
- 🎯 **多种算法** - 滑动窗口、令牌桶、漏桶、固定窗口
- 💾 **多种存储后端** - 内存、Redis、自定义适配器
- 🔧 **高度可配置** - 根据需求微调速率限制
- 🌐 **分布式就绪** - 内置 Redis 支持分布式系统
- 📊 **详细指标** - 跟踪速率限制命中、重置和剩余配额
- 🛡️ **生产就绪** - 经过实战检验，具有全面的测试覆盖
- 💡 **简单 API** - 易于集成，直观易用

## 📦 安装

```bash
npm install flex-rate-limit
```

Redis 支持：
```bash
npm install flex-rate-limit ioredis
```

## 🚀 快速开始

### 最简单的例子

```javascript
const { RateLimiter } = require('flex-rate-limit');

const limiter = new RateLimiter({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 最多100个请求
});

// 使用中间件（Express/Koa/Egg.js 等）
app.use(limiter.middleware());

// 或者手动检查
const result = await limiter.check('user-123');
if (!result.allowed) {
  return res.status(429).json({ error: '请求过于频繁' });
}
```

### Express 示例

```javascript
const express = require('express');
const { RateLimiter } = require('flex-rate-limit');

const app = express();

// 全局限流：每15分钟100个请求
const globalLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(globalLimiter.middleware());

// 路由级限流：登录接口每15分钟5次
const loginLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
});
app.post('/api/login', loginLimiter.middleware(), (req, res) => {
  res.json({ message: '登录成功' });
});

app.listen(3000);
```

### 其他框架

支持所有主流 Node.js 框架：

- **Koa** - 异步中间件模式
- **Egg.js** - 中间件工厂模式
- **Hapi** - 预检查函数模式
- **Fastify** - 钩子函数模式

查看完整的框架集成示例：[docs/getting-started/quickstart.md](./docs/getting-started/quickstart.md)

## 📚 文档

👉 **[📚 完整文档导航](./docs/README.md)** - 查看所有文档、学习路径、场景查找

### 快速入口

| 文档 | 说明 | 难度 |
|------|------|------|
| [快速开始](./docs/getting-started/quickstart.md) | 5分钟上手所有框架 | ⭐ 新手 |
| [配置详解](./docs/guides/config.md) | 完整的配置选项说明 | ⭐⭐ 进阶 |
| [业务锁指南](./docs/guides/business-lock-guide.md) | 用户ID+路由的精细化限流 | ⭐⭐⭐ 进阶 |
| [算法对比指南](./docs/algorithms/comparison.md) | 4种算法对比与选择决策 | ⭐⭐⭐ 进阶 |

### 更多文档

- 📖 [高级用法](./docs/guides/advanced.md) - 路由级限制、动态配置等
- 📖 [存储后端](./docs/guides/storage.md) - Memory vs Redis性能对比
- 📖 [算法深度分析](./docs/algorithms/deep-analysis.md) - 源码分析与瞬时超频
- 📖 [API参考](./docs/reference/api-reference.md) - 完整API文档

## 🎯 核心概念

### 业务锁 - 用户级别精细化限流 ⭐⭐⭐

支持基于 **用户ID + 路由** 的限流，每个用户在每个接口独立计数：

```javascript
const { RateLimiter } = require('flex-rate-limit');

const limiter = new RateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  // 核心：从 ctx 中提取用户ID和路由
  keyGenerator: (ctx) => {
    const userId = ctx.user?.id || ctx.ip;
    return `user:${userId}:${ctx.path}`;
  },
});

// 使用效果：
// - 用户A对 /api/login 的限流不影响用户B
// - 用户A对 /api/login 的限流不影响 /api/posts
// - 完美适配公司网络、校园网等场景
```

**使用场景**:
- ✅ 防止用户恶意刷接口
- ✅ 公平分配API配额
- ✅ 公司网络/校园网用户互不影响
- ✅ 精确控制每个用户的行为

详见：[业务锁完整指南](./docs/business-lock-guide.md)

### IP 白名单与访问控制 ⭐⭐

支持 **IP 白名单/黑名单**，可指定路由只允许特定 IP 访问：

```javascript
const { RateLimiter } = require('flex-rate-limit');

// 示例 1: 简单白名单 - 跳过限流
const limiter = new RateLimiter({
  windowMs: 60 * 1000,
  max: 100,
  skip: (req) => ['127.0.0.1', '192.168.1.100'].includes(req.ip),
});

// 示例 2: 管理接口 - 只允许特定 IP 访问（403 拒绝）
const adminLimiter = new RateLimiter({
  skip: (req) => !['192.168.1.10', '192.168.1.11'].includes(req.ip),
  handler: (req, res) => {
    res.status(403).json({ error: '只有授权 IP 可以访问' });
  },
});
app.use('/api/admin', adminLimiter.middleware());

// 示例 3: IP 段白名单（CIDR 支持）
// 支持 10.0.0.0/8、192.168.0.0/16 等内网 IP 段

// 示例 4: 黑名单 - 限制恶意 IP
const limiter = new RateLimiter({
  max: (req) => ['1.2.3.4'].includes(req.ip) ? 1 : 100,
});
```

**完整文档**: [高级用法 - IP 白名单章节](./docs/guides/advanced.md#ip-白名单与黑名单-)

### 动态 IP 白名单配置 ⭐⭐⭐

支持 **全局 + 路由级 IP 白名单**、**动态配置**和**多种配置方式**：

**配置示例**:
```javascript
// 全局白名单（所有路由生效）
const globalWhitelist = ['127.0.0.1', '192.168.1.100'];

// 路由级白名单（独立配置）
const routeWhitelists = {
  '/api/admin': ['192.168.1.10', '192.168.1.11'],
  '/api/internal': ['10.0.0.0/8', '192.168.0.0/16'],  // 支持 IP 段
};
```

**动态管理 API**:
```bash
POST /api/whitelist/global/add      # 添加全局白名单
POST /api/whitelist/global/remove   # 移除全局白名单
POST /api/whitelist/route/add       # 添加路由白名单
GET  /api/whitelist/config           # 查看配置
```

**环境变量配置**（生产环境推荐）:
```bash
GLOBAL_IP_WHITELIST=127.0.0.1,192.168.1.1 \
ADMIN_IP_WHITELIST=192.168.1.10,192.168.1.11 \
node app.js
```

**完整示例**:
- Express: `express-ip-whitelist-independent.js` ⭐（推荐：独立版本）
- Koa: `koa-ip-whitelist-independent.js` ⭐
- Egg.js: `egg-ip-whitelist-advanced.js`

**⚠️ 重要说明 - 白名单与限流的关系**:

有两种实现方式，根据你的需求选择：

| 实现方式 | 白名单 IP 是否限流 | 适用场景 | 示例文件 |
|---------|-------------------|---------|---------|
| **耦合版本** | ❌ 不限流（跳过） | 白名单 = 特权用户 | `express-ip-whitelist-advanced.js` |
| **独立版本** ⭐ | ✅ 限流（独立） | 白名单 = 访问控制 | `express-ip-whitelist-independent.js` |

**独立版本示例**（推荐）:
```javascript
// 白名单和限流完全独立
app.get('/api/admin/users',
  ipWhitelistMiddleware('/api/admin'),  // 第一层：白名单验证（403）
  createRateLimiter({ max: 200 }),      // 第二层：限流控制（429）
  handler
);

// 效果：
// - 非白名单 IP → 403 Forbidden（立即拒绝）
// - 白名单 IP → 继续到限流检查
//   - 未超限 → 200 OK
//   - 超限 → 429 Too Many Requests
```

**详细说明**: [白名单与限流独立性文档](./docs/whitelist-ratelimit-independence.md)

**配置文件**: `config/ip-whitelist.json`

---

### ⚠️ 重要：配置场景说明

在使用 IP 白名单功能前，请了解以下配置场景：

| 配置情况 | 处理结果 | 说明 |
|---------|---------|------|
| **只配置限流** | 所有 IP 可访问 + 限流 | 未配置白名单 = 允许所有 |
| **只配置白名单** | 白名单 IP 无限制访问 | ⚠️ 不推荐（无限流保护）|
| **白名单 + 限流** | 白名单验证 → 限流检查 | ✅ 最推荐（双重保护）|
| **全局白名单** | 所有路由通用 + 各自限流 | ✅ 适合办公室网络 |

**关键要点**：
1. ✅ 未配置白名单 = 允许所有 IP（不是拒绝所有）
2. ✅ 白名单 IP 也会被限流（独立版本）
3. ✅ 全局白名单优先级更高（但仍需限流）
4. ✅ 推荐配置：白名单 + 限流一起使用

**详细配置场景**: [配置场景完整文档](./docs/whitelist-ratelimit-config-scenarios.md)

---

### 预定义限制级别

根据不同场景快速配置限流级别：

```javascript
const limit = {
  strict: 5,      // 15分钟5次（登录、注册等敏感操作）
  normal: 50,     // 1小时50次（数据修改等）
  relaxed: 200,   // 1分钟200次（数据查询等）
};

// 使用示例
app.post('/api/login', limiter.middleware({ max: limit.strict }), handler);
app.get('/api/data', limiter.middleware({ max: limit.relaxed }), handler);
```

### 路由级配置

```javascript
const limiter = new RateLimiter({
  perRoute: {
    '/api/login': { max: 5, windowMs: 15 * 60 * 1000 },
    '/api/users': { max: 100, windowMs: 60 * 1000 },
  },
});
```

### 支持所有框架

```javascript
// Express
app.post('/api/login', limit.strict, controller.login);

// Koa
router.post('/api/login', limit.strict, controller.login);

// Egg.js
router.post('/api/login', limit.strict, controller.auth.login);
```

## 📝 示例文件

查看 `examples/` 目录获取完整的可运行示例：

### 按框架分类

- **Express**: 
  - `quickstart-express.js` - 快速开始
  - `express-router-example.js` - 路由级限流
  - `express-ip-whitelist-independent.js` ⭐ - IP白名单（独立版本，推荐）
  - `express-ip-whitelist-advanced.js` - IP白名单（耦合版本）

- **Koa**: 
  - `quickstart-koa.js` - 快速开始
  - `koa-router-example.js` - 路由级限流
  - `koa-ip-whitelist-independent.js` ⭐ - IP白名单（独立版本）
  
- **Egg.js**: 
  - `quickstart-egg.js` - 快速开始
  - `egg-router-example.js` - 路由级限流
  - `egg-business-lock-example.js` ⭐ - 业务锁（用户+路由）
  - `egg-ip-whitelist-advanced.js` - IP白名单

- **其他框架**:
  - Hapi: `quickstart-hapi.js`, `hapi-example.js`
  - Fastify: `quickstart-fastify.js`, `fastify-router-example.js`

### 按功能分类

- 🚀 **快速开始**: `quickstart-*.js`
- 🔒 **IP 白名单**: `*-ip-whitelist-*.js` （推荐使用 `independent` 版本）
- 👤 **业务锁**: `egg-business-lock-example.js`
- 🔧 **独立使用**: `standalone-example.js`

## 🧪 测试

```bash
# 运行所有测试
npm test

# 仅运行单元测试
npm run test:unit

# 运行集成测试
npm run test:integration

# 生成覆盖率报告
npm run coverage
```

## 🔗 相关项目

- [monSQLize](https://github.com/vextjs/monSQLize) - 带缓存的 MongoDB ORM
- [schema-dsl](https://github.com/vextjs/schema-dsl) - JSON Schema 验证
- [jrpc](https://github.com/vextjs/jrpc) - JSON-RPC 2.0 实现

## 💬 支持

- 📫 问题：[GitHub Issues](https://github.com/vextjs/rate-limit/issues)
- 💡 功能请求：[GitHub Discussions](https://github.com/vextjs/rate-limit/discussions)

## 📄 许可证

[MIT](./LICENSE)

---

由 vext.js 团队用 ❤️ 制作


