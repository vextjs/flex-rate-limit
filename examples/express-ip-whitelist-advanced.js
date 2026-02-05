/**
 * Express IP 白名单高级示例
 * 支持：
 * 1. 全局 IP 白名单
 * 2. 路由级 IP 白名单
 * 3. 动态配置（环境变量 + 配置文件）
 */

const express = require('express');
const { RateLimiter } = require('../lib');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ========== 配置管理器 ==========

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

    // 尝试加载配置文件（可选）
    this.loadConfigFile();

    console.log('📋 IP 白名单配置已加载：');
    console.log('   全局白名单:', this.globalWhitelist.length > 0 ? this.globalWhitelist.join(', ') : '未配置');
    Object.entries(this.routeWhitelists).forEach(([route, ips]) => {
      console.log(`   ${route}:`, ips.length > 0 ? ips.join(', ') : '未配置');
    });
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

  isGlobalWhitelisted(ip) {
    if (this.globalWhitelist.length === 0) return false;
    return this.globalWhitelist.includes(ip);
  }

  isRouteWhitelisted(route, ip) {
    const whitelist = this.routeWhitelists[route];
    if (!whitelist || whitelist.length === 0) return false;

    // 支持 CIDR 格式（简单实现）
    return whitelist.some(entry => {
      if (entry.includes('/')) {
        return this.isIPInRange(ip, entry);
      }
      return entry === ip;
    });
  }

  isIPInRange(ip, cidr) {
    // 简单的 CIDR 匹配（生产环境建议使用 ipaddr.js）
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

  // 动态添加白名单
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

  // 移除白名单
  removeGlobalWhitelist(ip) {
    const index = this.globalWhitelist.indexOf(ip);
    if (index > -1) {
      this.globalWhitelist.splice(index, 1);
      console.log(`✅ 已移除全局白名单: ${ip}`);
    }
  }
}

// 初始化配置
const ipConfig = new IPWhitelistConfig();

// ========== 限流器工厂 ==========

function createGlobalLimiter() {
  return new RateLimiter({
    windowMs: 60 * 1000,
    max: 100,
    skip: (req) => {
      const clientIP = req.ip || req.socket?.remoteAddress;
      return ipConfig.isGlobalWhitelisted(clientIP);
    },
  });
}

function createRouteLimiter(route, options = {}) {
  return new RateLimiter({
    windowMs: options.windowMs || 60 * 1000,
    max: options.max || 50,
    skip: (req) => {
      const clientIP = req.ip || req.socket?.remoteAddress;

      // 检查全局白名单
      if (ipConfig.isGlobalWhitelisted(clientIP)) {
        return true;
      }

      // 检查路由白名单
      if (ipConfig.isRouteWhitelisted(route, clientIP)) {
        return true;
      }

      return false;
    },
    handler: options.handler || ((req, res) => {
      res.status(options.strictMode ? 403 : 429).json({
        error: options.strictMode ? '访问被拒绝' : '请求过多',
        message: options.strictMode
          ? '只有授权的 IP 地址可以访问此资源'
          : '超过速率限制，请稍后重试',
      });
    }),
  });
}

function createStrictRouteLimiter(route, options = {}) {
  return new RateLimiter({
    windowMs: options.windowMs || 60 * 1000,
    max: options.max || 1000, // 白名单内限额较高
    skip: (req) => {
      const clientIP = req.ip || req.socket?.remoteAddress;

      // 全局白名单跳过
      if (ipConfig.isGlobalWhitelisted(clientIP)) {
        return true;
      }

      // 只允许路由白名单访问（严格模式）
      const isWhitelisted = ipConfig.isRouteWhitelisted(route, clientIP);

      // 非白名单 = 不跳过 = 应用限流（实际上会被拒绝）
      return !isWhitelisted;
    },
    max: 1, // 非白名单IP限额为1，配合handler实现403拒绝
    handler: (req, res) => {
      const clientIP = req.ip || req.socket?.remoteAddress;
      res.status(403).json({
        error: '访问被拒绝',
        message: '只有授权的 IP 地址可以访问此资源',
        ip: clientIP,
      });
    },
  });
}

// ========== 应用限流器 ==========

// 1. 全局限流（所有路由）
const globalLimiter = createGlobalLimiter();
app.use(globalLimiter.middleware());

// 2. 公开 API - 普通限流
const publicLimiter = createRouteLimiter('/api/public', {
  windowMs: 60 * 1000,
  max: 100,
});

app.get('/api/public/data', publicLimiter.middleware(), (req, res) => {
  res.json({
    message: '公开 API',
    ip: req.ip,
    limit: res.getHeader('X-RateLimit-Limit'),
    remaining: res.getHeader('X-RateLimit-Remaining'),
  });
});

// 3. 管理后台 - 严格白名单（只允许白名单IP访问）
const adminLimiter = createStrictRouteLimiter('/api/admin', {
  windowMs: 60 * 1000,
  max: 1000,
});

app.get('/api/admin/users', adminLimiter.middleware(), (req, res) => {
  res.json({
    message: '管理后台 API',
    users: ['user1', 'user2', 'user3'],
    ip: req.ip,
  });
});

app.get('/api/admin/settings', adminLimiter.middleware(), (req, res) => {
  res.json({
    message: '系统设置',
    settings: { debug: true, env: 'production' },
  });
});

// 4. 内部 API - IP 段白名单
const internalLimiter = createRouteLimiter('/api/internal', {
  windowMs: 60 * 1000,
  max: 200,
  strictMode: true,
});

app.get('/api/internal/stats', internalLimiter.middleware(), (req, res) => {
  res.json({
    message: '内部统计 API',
    stats: { requests: 12345, errors: 23 },
  });
});

// 5. VIP API - 组合白名单
const vipLimiter = createRouteLimiter('/api/vip', {
  windowMs: 60 * 1000,
  max: 500,
});

app.get('/api/vip/features', vipLimiter.middleware(), (req, res) => {
  res.json({
    message: 'VIP 功能 API',
    features: ['feature1', 'feature2', 'feature3'],
  });
});

// ========== 动态管理 API ==========

// 查看当前配置
app.get('/api/whitelist/config', (req, res) => {
  res.json({
    global: ipConfig.globalWhitelist,
    routes: ipConfig.routeWhitelists,
  });
});

// 添加全局白名单（需要管理员权限）
app.post('/api/whitelist/global/add', (req, res) => {
  const { ip } = req.body;
  if (!ip) {
    return res.status(400).json({ error: 'IP 地址不能为空' });
  }
  ipConfig.addGlobalWhitelist(ip);
  res.json({ message: '添加成功', ip });
});

// 移除全局白名单
app.post('/api/whitelist/global/remove', (req, res) => {
  const { ip } = req.body;
  if (!ip) {
    return res.status(400).json({ error: 'IP 地址不能为空' });
  }
  ipConfig.removeGlobalWhitelist(ip);
  res.json({ message: '移除成功', ip });
});

// 添加路由白名单
app.post('/api/whitelist/route/add', (req, res) => {
  const { route, ip } = req.body;
  if (!route || !ip) {
    return res.status(400).json({ error: '路由和 IP 地址不能为空' });
  }
  ipConfig.addRouteWhitelist(route, ip);
  res.json({ message: '添加成功', route, ip });
});

// 健康检查（不限流）
const healthLimiter = new RateLimiter({
  skip: () => true, // 完全跳过
});

app.get('/health', healthLimiter.middleware(), (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ========== 启动服务器 ==========

const PORT = process.env.PORT || 3400;

app.listen(PORT, () => {
  console.log(`\n🚀 Express IP 白名单高级示例运行在端口 ${PORT}\n`);
  console.log('📚 API 端点：');
  console.log(`   1. 公开 API: http://localhost:${PORT}/api/public/data`);
  console.log(`   2. 管理后台: http://localhost:${PORT}/api/admin/users`);
  console.log(`      - 白名单: ${ipConfig.routeWhitelists['/api/admin'].join(', ')}`);
  console.log(`   3. 内部 API: http://localhost:${PORT}/api/internal/stats`);
  console.log(`      - IP 段: ${ipConfig.routeWhitelists['/api/internal'].join(', ')}`);
  console.log(`   4. VIP API: http://localhost:${PORT}/api/vip/features`);
  console.log(`   5. 健康检查: http://localhost:${PORT}/health`);
  console.log(`\n🔧 管理 API：`);
  console.log(`   - 查看配置: GET http://localhost:${PORT}/api/whitelist/config`);
  console.log(`   - 添加全局: POST http://localhost:${PORT}/api/whitelist/global/add`);
  console.log(`   - 移除全局: POST http://localhost:${PORT}/api/whitelist/global/remove`);
  console.log(`   - 添加路由: POST http://localhost:${PORT}/api/whitelist/route/add`);
  console.log(`\n💡 环境变量示例：`);
  console.log(`   GLOBAL_IP_WHITELIST=127.0.0.1,192.168.1.1 \\`);
  console.log(`   ADMIN_IP_WHITELIST=192.168.1.10,192.168.1.11 \\`);
  console.log(`   node examples/express-ip-whitelist-advanced.js\n`);
  console.log(`\n📝 测试命令：`);
  console.log(`   curl http://localhost:${PORT}/api/whitelist/config`);
  console.log(`   curl -X POST http://localhost:${PORT}/api/whitelist/global/add -H "Content-Type: application/json" -d "{\\"ip\\":\\"192.168.1.100\\"}"`);
});
