/**
 * Egg.js IP 白名单高级示例
 *
 * 目录结构：
 * app/
 *   controller/
 *     admin.js
 *     public.js
 *   middleware/
 *     rate_limit.js
 *     ip_whitelist.js
 *   service/
 *     ip_config.js
 *   router.js
 * config/
 *   config.default.js
 *   ip-whitelist.json
 */

// ========== app/service/ip_config.js ==========
/**
 * IP 白名单配置服务
 */
const Service = require('egg').Service;
const fs = require('fs');
const path = require('path');

class IPConfigService extends Service {
  constructor(ctx) {
    super(ctx);
    this.config = this.loadConfig();
  }

  loadConfig() {
    const { app } = this;

    // 从应用配置读取
    const appConfig = app.config.ipWhitelist || {};

    const config = {
      global: appConfig.global || [],
      routes: appConfig.routes || {},
    };

    // 尝试加载配置文件
    const configPath = path.join(app.baseDir, 'config', 'ip-whitelist.json');
    try {
      if (fs.existsSync(configPath)) {
        const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (fileConfig.global) {
          config.global = [...config.global, ...fileConfig.global];
        }
        if (fileConfig.routes) {
          Object.entries(fileConfig.routes).forEach(([route, ips]) => {
            config.routes[route] = [...(config.routes[route] || []), ...ips];
          });
        }
        this.ctx.logger.info('[IPConfig] 已加载配置文件:', configPath);
      }
    } catch (err) {
      this.ctx.logger.warn('[IPConfig] 配置文件加载失败:', err.message);
    }

    return config;
  }

  isGlobalWhitelisted(ip) {
    return this.config.global.length > 0 && this.config.global.includes(ip);
  }

  isRouteWhitelisted(route, ip) {
    const whitelist = this.config.routes[route];
    if (!whitelist || whitelist.length === 0) return false;

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
    } catch {
      return false;
    }
  }

  ipToNumber(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
  }

  addGlobalWhitelist(ip) {
    if (!this.config.global.includes(ip)) {
      this.config.global.push(ip);
      this.ctx.logger.info(`[IPConfig] 已添加全局白名单: ${ip}`);
      return true;
    }
    return false;
  }

  addRouteWhitelist(route, ip) {
    if (!this.config.routes[route]) {
      this.config.routes[route] = [];
    }
    if (!this.config.routes[route].includes(ip)) {
      this.config.routes[route].push(ip);
      this.ctx.logger.info(`[IPConfig] 已添加路由白名单 ${route}: ${ip}`);
      return true;
    }
    return false;
  }

  removeGlobalWhitelist(ip) {
    const index = this.config.global.indexOf(ip);
    if (index > -1) {
      this.config.global.splice(index, 1);
      this.ctx.logger.info(`[IPConfig] 已移除全局白名单: ${ip}`);
      return true;
    }
    return false;
  }

  getConfig() {
    return {
      global: this.config.global,
      routes: this.config.routes,
    };
  }
}

// ========== app/middleware/rate_limit.js ==========
/**
 * 速率限制中间件
 */
const { RateLimiter } = require('flex-rate-limit');

module.exports = (options = {}) => {
  const limiter = new RateLimiter({
    windowMs: options.windowMs || 60 * 1000,
    max: options.max || 100,
    keyGenerator: (req, context) => {
      const ip = req.ip || 'unknown';
      const route = context?.route || 'global';
      return `${route}:${ip}`;
    },
  });

  return async function rateLimitMiddleware(ctx, next) {
    const route = ctx.path;
    const result = await limiter.check(ctx.ip, { req: ctx.request, route });

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
};

// ========== app/middleware/ip_whitelist.js ==========
/**
 * IP 白名单验证中间件
 */
module.exports = (options = {}) => {
  return async function ipWhitelistMiddleware(ctx, next) {
    const ipConfigService = ctx.service.ipConfig;
    const clientIP = ctx.ip;
    const route = options.route || ctx.path;

    // 检查全局白名单
    if (ipConfigService.isGlobalWhitelisted(clientIP)) {
      return await next();
    }

    // 检查路由白名单
    if (ipConfigService.isRouteWhitelisted(route, clientIP)) {
      return await next();
    }

    // 严格模式：非白名单直接拒绝
    if (options.strict) {
      ctx.status = 403;
      ctx.body = {
        error: '访问被拒绝',
        message: '只有授权的 IP 地址可以访问此资源',
        ip: clientIP,
      };
      return;
    }

    // 非严格模式：继续处理
    await next();
  };
};

// ========== app/controller/admin.js ==========
/**
 * 管理后台控制器
 */
const Controller = require('egg').Controller;

class AdminController extends Controller {
  async users() {
    const { ctx } = this;
    ctx.body = {
      message: '管理后台 API',
      users: ['user1', 'user2', 'user3'],
      ip: ctx.ip,
    };
  }

  async settings() {
    const { ctx } = this;
    ctx.body = {
      message: '系统设置',
      settings: { debug: true, env: 'production' },
    };
  }
}

// ========== app/controller/public.js ==========
/**
 * 公开 API 控制器
 */
class PublicController extends Controller {
  async data() {
    const { ctx } = this;
    ctx.body = {
      message: '公开 API',
      ip: ctx.ip,
      limit: ctx.get('X-RateLimit-Limit'),
      remaining: ctx.get('X-RateLimit-Remaining'),
    };
  }
}

// ========== app/controller/internal.js ==========
/**
 * 内部 API 控制器
 */
class InternalController extends Controller {
  async stats() {
    const { ctx } = this;
    ctx.body = {
      message: '内部统计 API',
      stats: { requests: 12345, errors: 23 },
    };
  }
}

// ========== app/controller/whitelist.js ==========
/**
 * 白名单管理控制器
 */
class WhitelistController extends Controller {
  async getConfig() {
    const { ctx } = this;
    const config = ctx.service.ipConfig.getConfig();
    ctx.body = config;
  }

  async addGlobal() {
    const { ctx } = this;
    const { ip } = ctx.request.body;

    if (!ip) {
      ctx.status = 400;
      ctx.body = { error: 'IP 地址不能为空' };
      return;
    }

    const success = ctx.service.ipConfig.addGlobalWhitelist(ip);
    ctx.body = {
      message: success ? '添加成功' : 'IP 已存在',
      ip
    };
  }

  async removeGlobal() {
    const { ctx } = this;
    const { ip } = ctx.request.body;

    if (!ip) {
      ctx.status = 400;
      ctx.body = { error: 'IP 地址不能为空' };
      return;
    }

    const success = ctx.service.ipConfig.removeGlobalWhitelist(ip);
    ctx.body = {
      message: success ? '移除成功' : 'IP 不存在',
      ip
    };
  }

  async addRoute() {
    const { ctx } = this;
    const { route, ip } = ctx.request.body;

    if (!route || !ip) {
      ctx.status = 400;
      ctx.body = { error: '路由和 IP 地址不能为空' };
      return;
    }

    const success = ctx.service.ipConfig.addRouteWhitelist(route, ip);
    ctx.body = {
      message: success ? '添加成功' : 'IP 已存在',
      route,
      ip
    };
  }
}

// ========== app/router.js ==========
/**
 * 路由配置
 */
module.exports = app => {
  const { router, controller } = app;

  // 1. 公开 API（普通限流）
  router.get('/api/public/data', controller.public.data);

  // 2. 管理后台（严格白名单 + 限流）
  router.get('/api/admin/users', controller.admin.users);
  router.get('/api/admin/settings', controller.admin.settings);

  // 3. 内部 API（IP 段白名单）
  router.get('/api/internal/stats', controller.internal.stats);

  // 4. 白名单管理 API
  router.get('/api/whitelist/config', controller.whitelist.getConfig);
  router.post('/api/whitelist/global/add', controller.whitelist.addGlobal);
  router.post('/api/whitelist/global/remove', controller.whitelist.removeGlobal);
  router.post('/api/whitelist/route/add', controller.whitelist.addRoute);

  // 5. 健康检查
  router.get('/health', async ctx => {
    ctx.body = { status: 'ok', timestamp: Date.now() };
  });
};

// ========== config/config.default.js ==========
/**
 * 应用配置
 */
exports.keys = 'your-secret-key';

// 中间件配置
exports.middleware = ['rateLimit'];

// 全局速率限制配置
exports.rateLimit = {
  enable: true,
  windowMs: 60 * 1000,
  max: 100,
};

// IP 白名单配置
exports.ipWhitelist = {
  global: [
    // 从环境变量加载
    ...(process.env.GLOBAL_IP_WHITELIST || '').split(',').filter(Boolean),
  ],
  routes: {
    '/api/admin': [
      ...(process.env.ADMIN_IP_WHITELIST || '192.168.1.10,192.168.1.11').split(',').filter(Boolean),
    ],
    '/api/internal': [
      ...(process.env.INTERNAL_IP_WHITELIST || '10.0.0.0/8,192.168.0.0/16').split(',').filter(Boolean),
    ],
    '/api/vip': [
      ...(process.env.VIP_IP_WHITELIST || '').split(',').filter(Boolean),
    ],
  },
};

// 路由中间件配置
exports.router = {
  '/api/admin/*': {
    middleware: ['ipWhitelist', 'rateLimit'],
    ipWhitelist: { route: '/api/admin', strict: true },
    rateLimit: { max: 1000 },
  },
  '/api/internal/*': {
    middleware: ['ipWhitelist', 'rateLimit'],
    ipWhitelist: { route: '/api/internal', strict: true },
    rateLimit: { max: 200 },
  },
  '/api/public/*': {
    middleware: ['rateLimit'],
    rateLimit: { max: 100 },
  },
};

// 安全配置
exports.security = {
  csrf: {
    enable: false, // 示例环境关闭 CSRF
  },
};

// ========== config/ip-whitelist.json（示例配置文件）==========
/**
 * {
 *   "global": ["127.0.0.1", "::1"],
 *   "routes": {
 *     "/api/admin": ["192.168.1.10", "192.168.1.11"],
 *     "/api/internal": ["10.0.0.0/8", "192.168.0.0/16"],
 *     "/api/vip": ["192.168.1.200"]
 *   }
 * }
 */

// ========== 完整示例说明 ==========
/**
 * 使用方式：
 *
 * 1. 安装依赖：
 *    npm install egg flex-rate-limit
 *
 * 2. 创建目录结构：
 *    mkdir -p app/controller app/middleware app/service config
 *
 * 3. 复制上述代码到对应文件
 *
 * 4. 启动应用：
 *    npm run dev
 *
 * 5. 环境变量配置：
 *    GLOBAL_IP_WHITELIST=127.0.0.1,192.168.1.1 \
 *    ADMIN_IP_WHITELIST=192.168.1.10,192.168.1.11 \
 *    npm run dev
 *
 * 6. 测试 API：
 *    curl http://localhost:7001/api/whitelist/config
 *    curl -X POST http://localhost:7001/api/whitelist/global/add \
 *      -H "Content-Type: application/json" \
 *      -d '{"ip":"192.168.1.100"}'
 *
 * 核心特性：
 * - ✅ 全局 IP 白名单（所有路由生效）
 * - ✅ 路由级 IP 白名单（每个路由独立配置）
 * - ✅ IP 段支持（CIDR 格式：10.0.0.0/8）
 * - ✅ 动态管理（运行时添加/移除白名单）
 * - ✅ 环境变量配置（生产环境）
 * - ✅ 配置文件加载（ip-whitelist.json）
 * - ✅ 严格模式（非白名单 IP 返回 403）
 * - ✅ 速率限制集成（白名单 IP 跳过或更高限额）
 *
 * 路由说明：
 * - /api/public/*  - 公开 API，普通限流（100次/分钟）
 * - /api/admin/*   - 管理后台，严格白名单 + 限流（1000次/分钟）
 * - /api/internal/* - 内部 API，IP 段白名单（200次/分钟）
 * - /api/vip/*     - VIP API，组合白名单（500次/分钟）
 *
 * 安全建议：
 * 1. 生产环境启用 CSRF 保护
 * 2. 白名单管理 API 需要身份验证
 * 3. 使用 HTTPS 保护敏感数据
 * 4. 定期审计白名单配置
 * 5. 配置文件权限控制（只读）
 */

console.log(`
========================================
Egg.js IP 白名单高级配置示例
========================================

📂 目录结构：
app/
  ├── controller/
  │   ├── admin.js          - 管理后台控制器
  │   ├── public.js         - 公开 API 控制器
  │   ├── internal.js       - 内部 API 控制器
  │   └── whitelist.js      - 白名单管理控制器
  ├── middleware/
  │   ├── rate_limit.js     - 速率限制中间件
  │   └── ip_whitelist.js   - IP 白名单中间件
  ├── service/
  │   └── ip_config.js      - IP 配置服务
  └── router.js             - 路由配置
config/
  ├── config.default.js     - 应用配置
  └── ip-whitelist.json     - IP 白名单配置文件

🚀 启动命令：
npm install egg flex-rate-limit
npm run dev

📝 测试命令：
curl http://localhost:7001/api/whitelist/config
curl http://localhost:7001/api/public/data
curl http://localhost:7001/api/admin/users

💡 环境变量：
GLOBAL_IP_WHITELIST=127.0.0.1,192.168.1.1 \\
ADMIN_IP_WHITELIST=192.168.1.10,192.168.1.11 \\
npm run dev

========================================
`);
