/**
 * Express IP 白名单与限流完全独立示例
 *
 * 核心原则：
 * 1. 白名单 = 访问控制（403 拒绝非授权 IP）
 * 2. 限流 = 速率控制（429 超过限额）
 * 3. 两者完全独立，白名单内的 IP 也会被限流
 */

const express = require('express');
const { RateLimiter } = require('../lib');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ========== IP 白名单配置管理 ==========

class IPWhitelistConfig {
  constructor() {
    // 从环境变量加载全局白名单
    this.globalWhitelist = (process.env.GLOBAL_IP_WHITELIST || '')
      .split(',')
      .filter(Boolean)
      .map(ip => ip.trim());

    // 路由级白名单配置
    this.routeWhitelists = {
      '/api/admin': this.loadFromEnv('ADMIN_IP_WHITELIST', ['192.168.1.10', '192.168.1.11']),
      '/api/internal': this.loadFromEnv('INTERNAL_IP_WHITELIST', ['10.0.0.0/8', '192.168.0.0/16']),
      '/api/vip': this.loadFromEnv('VIP_IP_WHITELIST', []),
    };

    this.loadConfigFile();
    this.printConfig();
  }

  loadFromEnv(envKey, defaultValue = []) {
    const envValue = process.env[envKey];
    if (envValue) {
      return envValue.split(',').filter(Boolean).map(ip => ip.trim());
    }
    return defaultValue;
  }

  loadConfigFile() {
    const configPath = path.join(__dirname, '../config/ip-whitelist.json');
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.global) {
          this.globalWhitelist = [...this.globalWhitelist, ...config.global];
        }
        if (config.routes) {
          Object.entries(config.routes).forEach(([route, ips]) => {
            this.routeWhitelists[route] = [
              ...(this.routeWhitelists[route] || []),
              ...ips,
            ];
          });
        }
        console.log('   ✅ 已加载配置文件:', configPath);
      }
    } catch (err) {
      console.log('   ⚠️  配置文件加载失败（使用默认配置）:', err.message);
    }
  }

  printConfig() {
    console.log('📋 IP 白名单配置已加载：');
    console.log('   全局白名单:', this.globalWhitelist.length > 0 ? this.globalWhitelist.join(', ') : '未配置');
    Object.entries(this.routeWhitelists).forEach(([route, ips]) => {
      console.log(`   ${route}:`, ips.length > 0 ? ips.join(', ') : '未配置');
    });
  }

  isGlobalWhitelisted(ip) {
    if (this.globalWhitelist.length === 0) return true; // 未配置白名单 = 允许所有
    return this.globalWhitelist.includes(ip);
  }

  isRouteWhitelisted(route, ip) {
    const whitelist = this.routeWhitelists[route];
    if (!whitelist || whitelist.length === 0) return true; // 未配置白名单 = 允许所有

    return whitelist.some(entry => {
      if (entry.includes('/')) {
        return this.isIPInRange(ip, entry);
      }
      return entry === ip;
    });
  }

  isIPInRange(ip, cidr) {
    try {
      const [subnet, bits] = cidr.split('/');
      const mask = -1 << (32 - parseInt(bits));
      const ipNum = this.ipToNumber(ip);
      const subnetNum = this.ipToNumber(subnet);
      return (ipNum & mask) === (subnetNum & mask);
    } catch (err) {
      return false;
    }
  }

  ipToNumber(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
  }

  addGlobalWhitelist(ip) {
    if (!this.globalWhitelist.includes(ip)) {
      this.globalWhitelist.push(ip);
      console.log(`✅ 已添加全局白名单: ${ip}`);
    }
  }

  addRouteWhitelist(route, ip) {
    if (!this.routeWhitelists[route]) {
      this.routeWhitelists[route] = [];
    }
    if (!this.routeWhitelists[route].includes(ip)) {
      this.routeWhitelists[route].push(ip);
      console.log(`✅ 已添加路由白名单 ${route}: ${ip}`);
    }
  }

  removeGlobalWhitelist(ip) {
    const index = this.globalWhitelist.indexOf(ip);
    if (index > -1) {
      this.globalWhitelist.splice(index, 1);
      console.log(`✅ 已移除全局白名单: ${ip}`);
    }
  }
}

const ipConfig = new IPWhitelistConfig();

// ========== 1. IP 白名单中间件（独立的访问控制）==========

/**
 * IP 白名单验证中间件
 * - 只负责验证 IP 是否在白名单
 * - 不在白名单 → 403 Forbidden
 * - 在白名单 → 继续执行（包括限流检查）
 */
function ipWhitelistMiddleware(route) {
  return (req, res, next) => {
    const clientIP = req.ip || req.socket?.remoteAddress;

    // 检查全局白名单
    if (ipConfig.isGlobalWhitelisted(clientIP)) {
      return next(); // 通过白名单验证，继续到限流检查
    }

    // 检查路由白名单
    if (ipConfig.isRouteWhitelisted(route, clientIP)) {
      return next(); // 通过白名单验证，继续到限流检查
    }

    // 不在白名单，拒绝访问
    res.status(403).json({
      error: '访问被拒绝',
      message: '只有授权的 IP 地址可以访问此资源',
      ip: clientIP,
      hint: '请联系管理员将您的 IP 添加到白名单',
    });
  };
}

// ========== 2. 限流中间件（独立的速率控制）==========

/**
 * 限流中间件
 * - 只负责速率限制
 * - 不检查白名单（白名单由独立中间件处理）
 * - 超过限额 → 429 Too Many Requests
 */
function createRateLimiter(options = {}) {
  const limiter = new RateLimiter({
    windowMs: options.windowMs || 60 * 1000,
    max: options.max || 100,
    keyGenerator: (req, context) => {
      const ip = req.ip || req.socket?.remoteAddress || 'unknown';
      const route = context?.route || 'global';
      return `${route}:${ip}`;
    },
    // ⚠️ 注意：不使用 skip，所有请求都要限流
  });

  return limiter.middleware();
}

// ========== 应用示例 ==========

// 示例 1: 公开 API（无白名单 + 普通限流）
const publicLimiter = createRateLimiter({ max: 100 });

app.get('/api/public/data', publicLimiter, (req, res) => {
  res.json({
    message: '公开 API',
    ip: req.ip,
    whitelist: '无需白名单',
    rateLimit: {
      limit: res.getHeader('X-RateLimit-Limit'),
      remaining: res.getHeader('X-RateLimit-Remaining'),
    },
  });
});

// 示例 2: 管理后台（白名单 + 限流，完全独立）
const adminWhitelist = ipWhitelistMiddleware('/api/admin');
const adminLimiter = createRateLimiter({ max: 200 }); // 白名单内的 IP 也限流

app.get('/api/admin/users',
  adminWhitelist,  // 第一层：白名单验证（403）
  adminLimiter,    // 第二层：限流控制（429）
  (req, res) => {
    res.json({
      message: '管理后台 API',
      users: ['user1', 'user2', 'user3'],
      ip: req.ip,
      security: {
        whitelist: '✅ 已验证',
        rateLimit: {
          limit: res.getHeader('X-RateLimit-Limit'),
          remaining: res.getHeader('X-RateLimit-Remaining'),
        },
      },
    });
  }
);

app.get('/api/admin/settings',
  adminWhitelist,
  adminLimiter,
  (req, res) => {
    res.json({
      message: '系统设置',
      settings: { debug: true, env: 'production' },
    });
  }
);

// 示例 3: 内部 API（IP 段白名单 + 高限流）
const internalWhitelist = ipWhitelistMiddleware('/api/internal');
const internalLimiter = createRateLimiter({ max: 500 }); // 内网也有限流

app.get('/api/internal/stats',
  internalWhitelist,  // 第一层：IP 段白名单验证
  internalLimiter,    // 第二层：高限流（500次/分钟）
  (req, res) => {
    res.json({
      message: '内部统计 API',
      stats: { requests: 12345, errors: 23 },
      security: {
        whitelist: '✅ 内网验证通过',
        rateLimit: {
          limit: res.getHeader('X-RateLimit-Limit'),
          remaining: res.getHeader('X-RateLimit-Remaining'),
        },
      },
    });
  }
);

// 示例 4: VIP API（VIP 白名单 + VIP 高限流）
const vipWhitelist = ipWhitelistMiddleware('/api/vip');
const vipLimiter = createRateLimiter({ max: 1000 }); // VIP 高限流

app.get('/api/vip/features',
  vipWhitelist,  // 第一层：VIP 白名单
  vipLimiter,    // 第二层：VIP 限流（1000次/分钟）
  (req, res) => {
    res.json({
      message: 'VIP 功能 API',
      features: ['feature1', 'feature2', 'feature3'],
      security: {
        whitelist: '✅ VIP 验证通过',
        rateLimit: {
          limit: res.getHeader('X-RateLimit-Limit'),
          remaining: res.getHeader('X-RateLimit-Remaining'),
        },
      },
    });
  }
);

// 示例 5: 不同级别的组合（公共白名单 + 不同限流）
const secureWhitelist = ipWhitelistMiddleware('/api/secure');
const secureLowLimiter = createRateLimiter({ max: 10 });    // 低限流
const secureHighLimiter = createRateLimiter({ max: 1000 }); // 高限流

app.get('/api/secure/sensitive',
  secureWhitelist,      // 白名单验证
  secureLowLimiter,     // 低限流（敏感操作）
  (req, res) => {
    res.json({
      message: '敏感操作 API',
      operation: '删除数据',
      security: '白名单 + 严格限流（10次/分钟）',
    });
  }
);

app.get('/api/secure/query',
  secureWhitelist,      // 白名单验证（同样的）
  secureHighLimiter,    // 高限流（查询操作）
  (req, res) => {
    res.json({
      message: '查询 API',
      operation: '读取数据',
      security: '白名单 + 宽松限流（1000次/分钟）',
    });
  }
);

// ========== 动态管理 API ==========

app.get('/api/whitelist/config', (req, res) => {
  res.json({
    global: ipConfig.globalWhitelist,
    routes: ipConfig.routeWhitelists,
  });
});

app.post('/api/whitelist/global/add', (req, res) => {
  const { ip } = req.body;
  if (!ip) {
    return res.status(400).json({ error: 'IP 地址不能为空' });
  }
  ipConfig.addGlobalWhitelist(ip);
  res.json({ message: '添加成功', ip });
});

app.post('/api/whitelist/global/remove', (req, res) => {
  const { ip } = req.body;
  if (!ip) {
    return res.status(400).json({ error: 'IP 地址不能为空' });
  }
  ipConfig.removeGlobalWhitelist(ip);
  res.json({ message: '移除成功', ip });
});

app.post('/api/whitelist/route/add', (req, res) => {
  const { route, ip } = req.body;
  if (!route || !ip) {
    return res.status(400).json({ error: '路由和 IP 地址不能为空' });
  }
  ipConfig.addRouteWhitelist(route, ip);
  res.json({ message: '添加成功', route, ip });
});

// 健康检查（无限制）
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ========== 测试端点 ==========

// 测试端点：展示独立性
app.get('/api/test/independence',
  ipWhitelistMiddleware('/api/test'),
  createRateLimiter({ max: 5 }), // 极低限流，方便测试
  (req, res) => {
    res.json({
      message: '测试 API - 白名单与限流完全独立',
      explanation: {
        whitelist: '先检查白名单（403 如果不在）',
        rateLimit: '再检查限流（429 如果超限）',
        independence: '白名单内的 IP 也会被限流',
      },
      test: {
        step1: '快速请求 6 次此接口',
        step2: '前 5 次：200 OK（白名单通过 + 未超限）',
        step3: '第 6 次：429 Too Many Requests（白名单通过 + 超限）',
        step4: '使用非白名单 IP：立即 403 Forbidden',
      },
      yourStatus: {
        ip: req.ip,
        whitelist: '✅ 已通过',
        rateLimit: {
          limit: res.getHeader('X-RateLimit-Limit'),
          remaining: res.getHeader('X-RateLimit-Remaining'),
        },
      },
    });
  }
);

// ========== 启动服务器 ==========

const PORT = process.env.PORT || 3500;

app.listen(PORT, () => {
  console.log(`\n🚀 Express IP 白名单与限流独立示例运行在端口 ${PORT}\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('核心原则：白名单 ≠ 限流，两者完全独立');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('📚 API 端点：\n');

  console.log('1. 公开 API（无白名单 + 限流 100）');
  console.log(`   GET http://localhost:${PORT}/api/public/data`);
  console.log('   ✅ 任何 IP 都可访问');
  console.log('   ✅ 限流：100次/分钟\n');

  console.log('2. 管理后台（白名单 + 限流 200）');
  console.log(`   GET http://localhost:${PORT}/api/admin/users`);
  console.log(`   🔒 白名单：${ipConfig.routeWhitelists['/api/admin'].join(', ')}`);
  console.log('   ✅ 非白名单 → 403 Forbidden');
  console.log('   ✅ 白名单内 → 200 OK（但仍受限流）');
  console.log('   ✅ 限流：200次/分钟（白名单内也限流）\n');

  console.log('3. 内部 API（IP 段白名单 + 限流 500）');
  console.log(`   GET http://localhost:${PORT}/api/internal/stats`);
  console.log(`   🔒 白名单：${ipConfig.routeWhitelists['/api/internal'].join(', ')}`);
  console.log('   ✅ 限流：500次/分钟\n');

  console.log('4. VIP API（VIP 白名单 + 限流 1000）');
  console.log(`   GET http://localhost:${PORT}/api/vip/features`);
  console.log('   🔒 白名单：VIP IP');
  console.log('   ✅ 限流：1000次/分钟\n');

  console.log('5. 测试独立性');
  console.log(`   GET http://localhost:${PORT}/api/test/independence`);
  console.log('   🔒 白名单验证');
  console.log('   ✅ 限流：5次/分钟（方便测试）\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('测试场景：');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('场景 1: 白名单内 IP 被限流');
  console.log('  步骤 1: 快速请求测试接口 6 次');
  console.log('  步骤 2: 前 5 次返回 200（白名单通过 + 未超限）');
  console.log('  步骤 3: 第 6 次返回 429（白名单通过 + 超限）');
  console.log('  结论：✅ 白名单内的 IP 也会被限流\n');

  console.log('场景 2: 非白名单 IP 直接 403');
  console.log('  步骤 1: 使用非白名单 IP 访问管理接口');
  console.log('  步骤 2: 立即返回 403 Forbidden');
  console.log('  结论：✅ 白名单验证在限流之前\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('执行流程：');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('请求 → 白名单中间件 → 限流中间件 → 业务处理');
  console.log('         ↓ 不在白名单            ↓ 超限');
  console.log('       403 Forbidden          429 Too Many\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('测试命令：');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`# 测试白名单 + 限流独立性`);
  console.log(`for i in {1..6}; do`);
  console.log(`  curl http://localhost:${PORT}/api/test/independence`);
  console.log(`  echo ""`);
  console.log(`done\n`);

  console.log(`# 查看配置`);
  console.log(`curl http://localhost:${PORT}/api/whitelist/config\n`);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});
