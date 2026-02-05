/**
 * Koa IP 白名单与限流完全独立示例
 *
 * 核心原则：
 * 1. 白名单 = 访问控制（403 拒绝非授权 IP）
 * 2. 限流 = 速率控制（429 超过限额）
 * 3. 两者完全独立，白名单内的 IP 也会被限流
 */

const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const { RateLimiter } = require('../lib');

const app = new Koa();
const router = new Router();

app.use(bodyParser());

// ========== IP 白名单配置（同 Express）==========

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

    console.log('📋 IP 白名单配置已加载');
  }

  loadFromEnv(envKey, defaultValue = []) {
    const envValue = process.env[envKey];
    return envValue ? envValue.split(',').filter(Boolean).map(ip => ip.trim()) : defaultValue;
  }

  isGlobalWhitelisted(ip) {
    if (this.globalWhitelist.length === 0) return true;
    return this.globalWhitelist.includes(ip);
  }

  isRouteWhitelisted(route, ip) {
    const whitelist = this.routeWhitelists[route];
    if (!whitelist || whitelist.length === 0) return true;
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
}

const ipConfig = new IPWhitelistConfig();

// ========== 1. IP 白名单中间件（独立）==========

/**
 * Koa IP 白名单验证中间件
 * - 只负责验证 IP 是否在白名单
 * - 不在白名单 → 403 Forbidden
 * - 在白名单 → 继续执行（包括限流检查）
 */
function ipWhitelistMiddleware(route) {
  return async (ctx, next) => {
    const clientIP = ctx.ip || ctx.request.ip;

    // 检查全局白名单
    if (ipConfig.isGlobalWhitelisted(clientIP)) {
      return await next(); // 通过验证，继续到限流
    }

    // 检查路由白名单
    if (ipConfig.isRouteWhitelisted(route, clientIP)) {
      return await next(); // 通过验证，继续到限流
    }

    // 不在白名单，拒绝访问
    ctx.status = 403;
    ctx.body = {
      error: '访问被拒绝',
      message: '只有授权的 IP 地址可以访问此资源',
      ip: clientIP,
      hint: '请联系管理员将您的 IP 添加到白名单',
    };
  };
}

// ========== 2. 限流中间件（独立）==========

/**
 * Koa 限流中间件
 * - 只负责速率限制
 * - 不检查白名单（白名单由独立中间件处理）
 * - 超过限额 → 429 Too Many Requests
 */
function createRateLimiter(options = {}) {
  const limiter = new RateLimiter({
    windowMs: options.windowMs || 60 * 1000,
    max: options.max || 100,
    keyGenerator: (req, context) => {
      const ip = req.ip || 'unknown';
      const route = context?.route || 'global';
      return `${route}:${ip}`;
    },
    // ⚠️ 注意：不使用 skip，所有请求都要限流
  });

  return async (ctx, next) => {
    const clientIP = ctx.ip;
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

// ========== 路由定义 ==========

// 1. 公开 API（无白名单 + 限流）
router.get('/api/public/data', createRateLimiter({ max: 100 }), async (ctx) => {
  ctx.body = {
    message: '公开 API',
    ip: ctx.ip,
    whitelist: '无需白名单',
    rateLimit: {
      limit: ctx.get('X-RateLimit-Limit'),
      remaining: ctx.get('X-RateLimit-Remaining'),
    },
  };
});

// 2. 管理后台（白名单 + 限流，完全独立）
router.get('/api/admin/users',
  ipWhitelistMiddleware('/api/admin'),  // 第一层：白名单验证
  createRateLimiter({ max: 200 }),      // 第二层：限流控制
  async (ctx) => {
    ctx.body = {
      message: '管理后台 API',
      users: ['user1', 'user2', 'user3'],
      ip: ctx.ip,
      security: {
        whitelist: '✅ 已验证',
        rateLimit: {
          limit: ctx.get('X-RateLimit-Limit'),
          remaining: ctx.get('X-RateLimit-Remaining'),
        },
      },
    };
  }
);

// 3. 内部 API（IP 段白名单 + 高限流）
router.get('/api/internal/stats',
  ipWhitelistMiddleware('/api/internal'),
  createRateLimiter({ max: 500 }),
  async (ctx) => {
    ctx.body = {
      message: '内部统计 API',
      stats: { requests: 12345, errors: 23 },
      security: {
        whitelist: '✅ 内网验证通过',
        rateLimit: {
          limit: ctx.get('X-RateLimit-Limit'),
          remaining: ctx.get('X-RateLimit-Remaining'),
        },
      },
    };
  }
);

// 4. 测试独立性
router.get('/api/test/independence',
  ipWhitelistMiddleware('/api/test'),
  createRateLimiter({ max: 5 }),
  async (ctx) => {
    ctx.body = {
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
      },
      yourStatus: {
        ip: ctx.ip,
        whitelist: '✅ 已通过',
        rateLimit: {
          limit: ctx.get('X-RateLimit-Limit'),
          remaining: ctx.get('X-RateLimit-Remaining'),
        },
      },
    };
  }
);

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

router.get('/health', async (ctx) => {
  ctx.body = { status: 'ok', timestamp: Date.now() };
});

// ========== 应用路由 ==========

app.use(router.routes());
app.use(router.allowedMethods());

// ========== 启动服务器 ==========

const PORT = process.env.PORT || 3501;

app.listen(PORT, () => {
  console.log(`\n🚀 Koa IP 白名单与限流独立示例运行在端口 ${PORT}\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('核心原则：白名单 ≠ 限流，两者完全独立');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('📚 API 端点：\n');
  console.log(`1. 公开 API: http://localhost:${PORT}/api/public/data`);
  console.log(`2. 管理后台: http://localhost:${PORT}/api/admin/users`);
  console.log(`   - 白名单验证 → 限流检查 → 业务处理`);
  console.log(`3. 测试独立性: http://localhost:${PORT}/api/test/independence\n`);

  console.log('测试命令：');
  console.log(`for i in {1..6}; do curl http://localhost:${PORT}/api/test/independence; echo ""; done\n`);
});
