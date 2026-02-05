/**
 * 内存存储 - 内存中的存储后端
 * 快速、简单、仅限单服务器
 * @class
 */
class MemoryStore {
  constructor() {
    this.store = new Map();
    this.timers = new Map();
  }

  /**
   * 从存储中获取值
   * @param {string} key - 存储键
   * @returns {Promise<any>} 存储的值
   */
  async get(key) {
    return this.store.get(key);
  }

  /**
   * 在存储中设置值，可选 TTL
   * @param {string} key - 存储键
   * @param {any} value - 要存储的值
   * @param {number} ttl - 生存时间（毫秒）
   * @returns {Promise<void>}
   */
  async set(key, value, ttl) {
    this.store.set(key, value);

    // 清除现有定时器
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    // 如果提供了 TTL，设置过期定时器
    if (ttl) {
      const timer = setTimeout(() => {
        this.store.delete(key);
        this.timers.delete(key);
      }, ttl);

      this.timers.set(key, timer);
    }
  }

  /**
   * 增加计数器
   * @param {string} key - 存储键
   * @param {Object} options - 增量选项
   * @returns {Promise<Object>} 包含计数的结果
   */
  async increment(key, options = {}) {
    const { windowMs, timestamp } = options;
    const data = this.store.get(key);

    if (!data) {
      // 第一个请求
      const value = timestamp ? { requests: [timestamp] } : { count: 1 };
      await this.set(key, value, windowMs);
      return { count: 1 };
    }

    if (timestamp) {
      // 滑动窗口：存储时间戳
      data.requests = data.requests || [];
      data.requests.push(timestamp);
      await this.set(key, data, windowMs);
      return { count: data.requests.length };
    }

    // 固定窗口：增加计数器
    data.count = (data.count || 0) + 1;
    await this.set(key, data, windowMs);
    return { count: data.count };
  }

  /**
   * 减少计数器（用于 skipFailedRequests）
   * @param {string} key - 存储键
   * @returns {Promise<void>}
   */
  async decrement(key) {
    const data = this.store.get(key);

    if (!data) {
      return;
    }

    if (data.count !== undefined) {
      data.count = Math.max(0, data.count - 1);
      this.store.set(key, data);
    } else if (data.requests && data.requests.length > 0) {
      data.requests.pop();
      this.store.set(key, data);
    }
  }

  /**
   * 重置特定键
   * @param {string} key - 存储键
   * @returns {Promise<void>}
   */
  async reset(key) {
    this.store.delete(key);

    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
  }

  /**
   * 重置所有键
   * @returns {Promise<void>}
   */
  async resetAll() {
    // 清除所有定时器
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.store.clear();
    this.timers.clear();
  }

  /**
   * 获取存储中的键数量
   * @returns {number} 键数量
   */
  size() {
    return this.store.size;
  }
}

module.exports = MemoryStore;
