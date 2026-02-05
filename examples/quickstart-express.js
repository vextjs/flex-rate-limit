/**
 * Express 快速开始示例
 *
 * 完整的路由级限流配置示例
 * 包含：中间件工厂 + 路由定义
 */

const express = require('express');
const { RateLimiter } = require('../lib');

const app = express();

// ============================================
// 第 1 步：创建限流中间件工厂
// ============================================

const createLimiters = () => {
  return {
    // 严格限制：15分钟5次（登录、注册等）
    strict: (req, res, next) => {
      const limiter = new RateLimiter({
        windowMs: 15 * 60 * 1000,
        max: 5,
      });
      limiter.middleware()(req, res, next);
    },

    // 中等限制：1小时50次（文件操作、数据修改）
    normal: (req, res, next) => {
      const limiter = new RateLimiter({
        windowMs: 60 * 60 * 1000,
        max: 50,
      });
      limiter.middleware()(req, res, next);
    },

    // 宽松限制：1分钟200次（数据查询、读操作）
    relaxed: (req, res, next) => {
      const limiter = new RateLimiter({
        windowMs: 60 * 1000,
        max: 200,
      });
      limiter.middleware()(req, res, next);
    },

    // 自定义工厂函数：创建指定参数的限流中间件
    custom: (windowMs, max) => {
      const limiter = new RateLimiter({ windowMs, max });
      return limiter.middleware();
    },
  };
};

const limit = createLimiters();

// ============================================
// 第 2 步：在路由中直接使用限流中间件
// ============================================

// 认证相关 - 严格限制
app.post('/api/login', limit.strict, (req, res) => {
  res.json({ message: '登录成功' });
});

app.post('/api/register', limit.strict, (req, res) => {
  res.json({ message: '注册成功' });
});

// 用户相关 - 宽松限制
app.get('/api/users', limit.relaxed, (req, res) => {
  res.json({ users: [] });
});

app.get('/api/users/:id', limit.relaxed, (req, res) => {
  res.json({ user: {} });
});

// 用户修改 - 需要认证 + 中等限制
app.put('/api/users/:id', (req, res, next) => {
  // 身份验证逻辑
  req.user = { id: 1 };
  next();
}, limit.normal, (req, res) => {
  res.json({ message: '更新成功' });
});

// 文件上传 - 中等限制
app.post('/api/upload', limit.normal, (req, res) => {
  res.json({ message: '上传成功' });
});

// SSE 实时流 - 自定义限制（1分钟20个连接）
app.get('/sse',
  limit.custom(60 * 1000, 20),
  (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write('data: connected\n\n');
  }
);

// ============================================
// 启动服务器
// ============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✓ Express 服务器运行在 http://localhost:${PORT}`);
  console.log(`✓ 所有路由都已应用限流中间件`);
  console.log(`✓ 使用方式：直接在 app.get/post/put/delete 中添加 limit.strict/normal/relaxed`);
});

module.exports = app;
