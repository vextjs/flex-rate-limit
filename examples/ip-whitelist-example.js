/**
 * IP 白名单示例
 * 展示如何使用 skip 选项实现 IP 白名单功能
 */

const express = require('express');
const { RateLimiter } = require('../lib');

const app = express();

// ========== 示例 1: 简单 IP 白名单 ==========

const whitelistIPs = ['127.0.0.1', '::1', '192.168.1.100'];

const limiterWithWhitelist = new RateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  skip: (req) => {
    const clientIP = req.ip || req.socket?.remoteAddress || 'unknown';
    // 白名单内的 IP 跳过限流
    return whitelistIPs.includes(clientIP);
  },
});

app.use('/api/basic', limiterWithWhitelist.middleware());

app.get('/api/basic/data', (req, res) => {
  res.json({
    message: '基础 API',
    ip: req.ip,
    whitelisted: whitelistIPs.includes(req.ip),
  });
});

// ========== 示例 2: 路由级白名单 ==========

// 管理员接口：只允许特定 IP 访问
const adminWhitelist = ['192.168.1.10', '192.168.1.11'];

const adminLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  max: 100,
  skip: (req) => {
    const clientIP = req.ip || req.socket?.remoteAddress;
    // 如果不在白名单，直接拒绝（返回 false 表示不跳过限流）
    return adminWhitelist.includes(clientIP);
  },
  handler: (req, res) => {
    res.status(403).json({
      error: '访问被拒绝',
      message: '只有授权的 IP 地址可以访问此资源',
    });
  },
});

app.use('/api/admin', adminLimiter.middleware());

app.get('/api/admin/users', (req, res) => {
  res.json({
    message: '管理员 API',
    users: ['user1', 'user2'],
  });
});

// ========== 示例 3: IP 段白名单 ==========

function isIPInRange(ip, range) {
  // 简单的 CIDR 匹配实现
  // 实际生产环境建议使用 ip-range-check 或 ipaddr.js 库
  if (range.includes('/')) {
    // CIDR 格式：192.168.1.0/24
    const [subnet, bits] = range.split('/');
    const mask = -1 << (32 - parseInt(bits));
    const ipNum = ipToNumber(ip);
    const subnetNum = ipToNumber(subnet);
    return (ipNum & mask) === (subnetNum & mask);
  }
  return ip === range;
}

function ipToNumber(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0);
}

const ipRanges = ['192.168.1.0/24', '10.0.0.0/8'];

const limiterWithIPRange = new RateLimiter({
  windowMs: 60 * 1000,
  max: 50,
  skip: (req) => {
    const clientIP = req.ip || req.socket?.remoteAddress;
    // 检查 IP 是否在白名单范围内
    return ipRanges.some((range) => isIPInRange(clientIP, range));
  },
});

app.use('/api/internal', limiterWithIPRange.middleware());

app.get('/api/internal/stats', (req, res) => {
  res.json({
    message: '内部 API',
    stats: { requests: 1234, errors: 5 },
  });
});

// ========== 示例 4: 组合白名单（IP + 用户角色） ==========

const vipIPs = ['192.168.1.200', '192.168.1.201'];

const smartLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  max: async (req) => {
    // VIP IP 或高级用户获得更高限额
    const clientIP = req.ip || req.socket?.remoteAddress;
    const isVIPIP = vipIPs.includes(clientIP);
    const isVIPUser = req.user?.tier === 'premium';

    if (isVIPIP || isVIPUser) {
      return 1000; // VIP 限额
    }
    return 100; // 普通限额
  },
  skip: (req) => {
    // 管理员完全跳过限流
    return req.user?.role === 'admin';
  },
});

app.use('/api/smart', smartLimiter.middleware());

app.get('/api/smart/data', (req, res) => {
  res.json({
    message: '智能限流 API',
    ip: req.ip,
    limit: res.getHeader('X-RateLimit-Limit'),
  });
});

// ========== 示例 5: 环境变量配置白名单 ==========

// 从环境变量读取白名单（生产环境推荐做法）
const envWhitelist = (process.env.IP_WHITELIST || '').split(',').filter(Boolean);

const productionLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  max: 100,
  skip: (req) => {
    if (envWhitelist.length === 0) {
      return false; // 未配置白名单，不跳过
    }
    const clientIP = req.ip || req.socket?.remoteAddress;
    return envWhitelist.includes(clientIP);
  },
});

app.use('/api/production', productionLimiter.middleware());

app.get('/api/production/data', (req, res) => {
  res.json({
    message: '生产环境 API',
    whitelistEnabled: envWhitelist.length > 0,
  });
});

// ========== 示例 6: 黑名单模式（相反的逻辑） ==========

const blacklistIPs = ['1.2.3.4', '5.6.7.8'];

const blacklistLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  max: 100,
  skip: (req) => {
    const clientIP = req.ip || req.socket?.remoteAddress;
    // 黑名单内的 IP 不跳过（即仍然限流）
    // 可以配合更严格的 max 值使用
    return false; // 所有人都受限
  },
  max: (req) => {
    const clientIP = req.ip || req.socket?.remoteAddress;
    // 黑名单 IP 获得极低的限额
    if (blacklistIPs.includes(clientIP)) {
      return 1; // 每分钟只能 1 次
    }
    return 100; // 正常限额
  },
});

app.use('/api/blacklist', blacklistLimiter.middleware());

app.get('/api/blacklist/data', (req, res) => {
  res.json({
    message: '黑名单限流 API',
    ip: req.ip,
  });
});

// ========== 启动服务器 ==========

const PORT = process.env.PORT || 3333;

app.listen(PORT, () => {
  console.log(`\n🚀 IP 白名单示例服务器运行在端口 ${PORT}\n`);
  console.log('示例端点：');
  console.log(`  1. 基础白名单: http://localhost:${PORT}/api/basic/data`);
  console.log(`     - 白名单 IP: ${whitelistIPs.join(', ')}`);
  console.log(`  2. 管理员白名单: http://localhost:${PORT}/api/admin/users`);
  console.log(`     - 白名单 IP: ${adminWhitelist.join(', ')}`);
  console.log(`  3. IP 段白名单: http://localhost:${PORT}/api/internal/stats`);
  console.log(`     - IP 段: ${ipRanges.join(', ')}`);
  console.log(`  4. 智能限流: http://localhost:${PORT}/api/smart/data`);
  console.log(`     - VIP IP: ${vipIPs.join(', ')}`);
  console.log(`  5. 生产环境: http://localhost:${PORT}/api/production/data`);
  console.log(`     - 环境变量: IP_WHITELIST=${envWhitelist.join(',') || '(未配置)'}`);
  console.log(`  6. 黑名单模式: http://localhost:${PORT}/api/blacklist/data`);
  console.log(`     - 黑名单 IP: ${blacklistIPs.join(', ')}\n`);
  console.log('测试命令：');
  console.log(`  curl http://localhost:${PORT}/api/basic/data`);
  console.log(`  IP_WHITELIST=127.0.0.1,192.168.1.100 node examples/ip-whitelist-example.js\n`);
});
