/**
 * Express 路由限流统一示例
 *
 * 模式：路由定义时直接添加预定义的中间件
 * 无需配置 perRoute，避免重复配置
 */

const express = require('express');
const { RateLimiter } = require('../lib');

// ============================================
// 第 1 步：创建限流中间件
// ============================================

const createLimiters = () => {
  return {
    // 严格限制：15分钟5次
    strict: (req, res, next) => {
      const limiter = new RateLimiter({
        windowMs: 15 * 60 * 1000,
        max: 5,
      });
      limiter.middleware()(req, res, next);
    },

    // 中等限制：1小时50次
    normal: (req, res, next) => {
      const limiter = new RateLimiter({
        windowMs: 60 * 60 * 1000,
        max: 50,
      });
      limiter.middleware()(req, res, next);
    },

    // 宽松限制：1分钟200次
    relaxed: (req, res, next) => {
      const limiter = new RateLimiter({
        windowMs: 60 * 1000,
        max: 200,
      });
      limiter.middleware()(req, res, next);
    },

    // 自定义工厂函数
    custom: (windowMs, max) => {
      const limiter = new RateLimiter({ windowMs, max });
      return limiter.middleware();
    },
  };
};

const app = express();
const limit = createLimiters();

// ============================================
// 第 2 步：在路由中使用
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

// 用户修改 - 中等限制
app.put('/api/users/:id', limit.normal, (req, res) => {
  res.json({ message: '更新成功' });
});

// 文件上传 - 中等限制
app.post('/api/upload', limit.normal, (req, res) => {
  res.json({ message: '上传成功' });
});

// SSE 实时流 - 自定义限制
app.get('/sse', limit.custom(60 * 1000, 20), (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.write('data: connected\n\n');
});

// ============================================
// 启动服务器
// ============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✓ Express 服务器运行在 http://localhost:${PORT}`);
  console.log(`✓ 所有路由都已应用限流中间件`);
});

module.exports = app;



