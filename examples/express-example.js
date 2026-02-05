/**
 * Express.js 集成示例
 */

const express = require('express');
const { RateLimiter } = require('../lib');

const app = express();

// 基础速率限制器：每分钟 10 个请求
const basicLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 分钟
  max: 10,
  algorithm: 'sliding-window',
});

// 严格的速率限制器用于身份验证：每 15 分钟 5 个请求
const authLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  handler: (req, res) => {
    res.status(429).json({
      error: '身份验证尝试次数过多',
      retryAfter: res.getHeader('Retry-After'),
    });
  },
});

// 应用到所有路由
app.use(basicLimiter.middleware());

// 对身份验证路由应用严格限制
app.post('/api/login', authLimiter.middleware(), (req, res) => {
  res.json({ message: '登录成功' });
});

app.post('/api/register', authLimiter.middleware(), (req, res) => {
  res.json({ message: '注册成功' });
});

// 常规路由
app.get('/api/data', (req, res) => {
  res.json({
    message: '数据检索成功',
    rateLimit: {
      limit: res.getHeader('X-RateLimit-Limit'),
      remaining: res.getHeader('X-RateLimit-Remaining'),
      reset: res.getHeader('X-RateLimit-Reset'),
    },
  });
});

// 健康检查（跳过速率限制）
const healthLimiter = new RateLimiter({
  skip: (req) => req.path === '/health',
});

app.get('/health', healthLimiter.middleware(), (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Express 服务器运行在端口 ${PORT}`);
  console.log('尝试：');
  console.log(`  curl http://localhost:${PORT}/api/data`);
  console.log(`  curl -X POST http://localhost:${PORT}/api/login`);
});
