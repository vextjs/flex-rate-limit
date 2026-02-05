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

### 预定义限制级别

```javascript
const limit = {
  strict: 5,      // 15分钟5次（登录、注册等）
  normal: 50,     // 1小时50次（数据修改等）
  relaxed: 200,   // 1分钟200次（数据查询等）
};
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

- **Express**: quickstart-express.js, express-example.js, express-router-example.js
- **Koa**: quickstart-koa.js, koa-example.js, koa-router-example.js
- **Egg.js**: quickstart-egg.js, egg-example.js, egg-router-example.js, **egg-business-lock-example.js** ⭐
- **Hapi**: quickstart-hapi.js, hapi-example.js
- **Fastify**: quickstart-fastify.js, fastify-router-example.js
- **独立使用**: standalone-example.js

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


