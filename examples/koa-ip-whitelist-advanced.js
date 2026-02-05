/**
 * Koa IP 白名单高级示例
 * 支持：
 * 1. 全局 IP 白名单
 * 2. 路由级 IP 白名单
 * 3. 动态配置（环境变量 + 配置文件）
 */

const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const { RateLimiter } = require('../lib');
const fs = require('fs');
const path = require('path');

const app = new Koa();
const router = new Router();

app.use(bodyParser());

// ========== 配置管理器（同 Express）==========

class IPWhitelistConfig {
  constructor() {
    this.globalWhitelist = (process.env.GLOBAL_IP_WHITELIST || '')
      .split(',')
      .filter(Boolean)
      .map(ip => ip.trim());

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
    return envValue ? envValue.split(',').filter(Boolean).map(ip => ip.trim()) : defaultValue;
  }

  loadConfigFile() {
    const configPath = path.join(__dirname, '../config/ip-whitelist.json');
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.global) this.globalWhitelist.push(...config.global);
        if (config.routes) {
          Object.entries(config.routes).forEach(([route, ips]) => {
            this.routeWhitelists[route] = [...(this.routeWhitelists[route] || []), ...ips];
          });
        }
        console.log('   ✅ 已加载配置文件:', configPath);
      }
    } catch (err) {
      console.log('   ⚠️  配置文件加载失败（使用默认配置）');
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
    return this.globalWhitelist.length > 0 && this.globalWhitelist.includes(ip);
  }

  isRouteWhitelisted(route, ip) {
    const whitelist = this.routeWhitelists[route];
    if (!whitelist || whitelist.length === 0) return false;
    return whitelist.some(entry => {
      if (entry.includes('/')) return this.isIPInRange(ip, entry);
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
    } catch {
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
    if (!this.routeWhitelists[route]) this.routeWhitelists[route] = [];
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

// ========== Koa 限流中间件适配器 ==========

function koaRateLimiter(limiter) {
  return async (ctx, next) => {
    const clientIP = ctx.ip || ctx.request.ip;
    const route = ctx.path;

    const result = await limiter.check(clientIP, { req: ctx.request, route });

    // 设置响应头
    ctx.set('X-RateLimit-Limit', result.limit.toString());
    ctx.set('X-RateLimit-Remaining', result.remaining.toString());
    ctx.set('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000).toString());

    if (!result.allowed) {
      ctx.set('Retry-After', Math.ceil(result.retryAfter / 1000).toString());
      ctx.status = 429;
      ctx.body = {
        error: '请求过多',
        message: '超过速率限制',
        retryAfter: Math.ceil(result.retryAfter / 1000),
      };
      return;
    }

    await next();
  };
}

function koaStrictWhitelist(route, limiter) {
  return async (ctx, next) => {
    const clientIP = ctx.ip || ctx.request.ip;

    // 检查白名单
    if (ipConfig.isGlobalWhitelisted(clientIP) || ipConfig.isRouteWhitelisted(route, clientIP)) {
      return await next();
    }

    // 非白名单 IP，拒绝访问
    ctx.status = 403;
    ctx.body = {
      error: '访问被拒绝',
      message: '只有授权的 IP 地址可以访问此资源',
      ip: clientIP,
    };
  };
}

// ========== 限流器创建 ==========

function createGlobalLimiter() {
  return new RateLimiter({
    windowMs: 60 * 1000,
    max: 100,
    keyGenerator: (req) => req.ip || 'unknown',
  });
}

function createRouteLimiter(route, options = {}) {
  return new RateLimiter({
    windowMs: options.windowMs || 60 * 1000,
    max: options.max || 50,
    keyGenerator: (req) => {
      const ip = req.ip || 'unknown';
      return `${route}:${ip}`;
    },
  });
}

// ========== 路由定义 ==========

// 1. 全局限流
const globalLimiter = createGlobalLimiter();
app.use(koaRateLimiter(globalLimiter));

// 2. 公开 API
const publicLimiter = createRouteLimiter('/api/public', { max: 100 });

router.get('/api/public/data', koaRateLimiter(publicLimiter), async (ctx) => {
  ctx.body = {
    message: '公开 API',
    ip: ctx.ip,
    limit: ctx.get('X-RateLimit-Limit'),
    remaining: ctx.get('X-RateLimit-Remaining'),
  };
});

// 3. 管理后台 - 严格白名单
const adminLimiter = createRouteLimiter('/api/admin', { max: 1000 });

router.get('/api/admin/users',
  koaStrictWhitelist('/api/admin', adminLimiter),
  koaRateLimiter(adminLimiter),
  async (ctx) => {
    ctx.body = {
      message: '管理后台 API',
      users: ['user1', 'user2', 'user3'],
      ip: ctx.ip,
    };
  }
);

router.get('/api/admin/settings',
  koaStrictWhitelist('/api/admin', adminLimiter),
  koaRateLimiter(adminLimiter),
  async (ctx) => {
    ctx.body = {
      message: '系统设置',
      settings: { debug: true, env: 'production' },
    };
  }
);

// 4. 内部 API - IP 段白名单
const internalLimiter = createRouteLimiter('/api/internal', { max: 200 });

router.get('/api/internal/stats',
  koaStrictWhitelist('/api/internal', internalLimiter),
  koaRateLimiter(internalLimiter),
  async (ctx) => {
    ctx.body = {
      message: '内部统计 API',
      stats: { requests: 12345, errors: 23 },
    };
  }
);

// 5. VIP API
const vipLimiter = createRouteLimiter('/api/vip', { max: 500 });

router.get('/api/vip/features', koaRateLimiter(vipLimiter), async (ctx) => {
  const clientIP = ctx.ip;
  const isWhitelisted = ipConfig.isGlobalWhitelisted(clientIP) ||
                        ipConfig.isRouteWhitelisted('/api/vip', clientIP);

  ctx.body = {
    message: 'VIP 功能 API',
    features: ['feature1', 'feature2', 'feature3'],
    whitelisted: isWhitelisted,
  };
});

// ========== 动态管理 API ==========

router.get('/api/whitelist/config', async (ctx) => {
  ctx.body = {
    global: ipConfig.globalWhitelist,
    routes: ipConfig.routeWhitelists,
  };
});

router.post('/api/whitelist/global/add', async (ctx) => {
  const { ip } = ctx.request.body;
  if (!ip) {
    ctx.status = 400;
    ctx.body = { error: 'IP 地址不能为空' };
    return;
  }
  ipConfig.addGlobalWhitelist(ip);
  ctx.body = { message: '添加成功', ip };
});

router.post('/api/whitelist/global/remove', async (ctx) => {
  const { ip } = ctx.request.body;
  if (!ip) {
    ctx.status = 400;
    ctx.body = { error: 'IP 地址不能为空' };
    return;
  }
  ipConfig.removeGlobalWhitelist(ip);
  ctx.body = { message: '移除成功', ip };
});

router.post('/api/whitelist/route/add', async (ctx) => {
  const { route, ip } = ctx.request.body;
  if (!route || !ip) {
    ctx.status = 400;
    ctx.body = { error: '路由和 IP 地址不能为空' };
    return;
  }
  ipConfig.addRouteWhitelist(route, ip);
  ctx.body = { message: '添加成功', route, ip };
});

// 健康检查
router.get('/health', async (ctx) => {
  ctx.body = { status: 'ok', timestamp: Date.now() };
});

// ========== 应用路由 ==========

app.use(router.routes());
app.use(router.allowedMethods());

// ========== 启动服务器 ==========

const PORT = process.env.PORT || 3401;

app.listen(PORT, () => {
  console.log(`\n🚀 Koa IP 白名单高级示例运行在端口 ${PORT}\n`);
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
  console.log(`   node examples/koa-ip-whitelist-advanced.js\n`);
  console.log(`\n📝 测试命令：`);
  console.log(`   curl http://localhost:${PORT}/api/whitelist/config`);
  console.log(`   curl -X POST http://localhost:${PORT}/api/whitelist/global/add -H "Content-Type: application/json" -d "{\\"ip\\":\\"192.168.1.100\\"}"`);
});
