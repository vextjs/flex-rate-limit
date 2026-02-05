/**
 * 漏桶算法
 * 平滑、恒定速率的限流
 */

/**
 * 使用漏桶算法检查速率限制
 * @param {Object} store - 存储后端
 * @param {string} key - 速率限制键
 * @param {Object} options - 算法选项
 * @returns {Promise<Object>} 包含计数和重置时间的结果
 */
async function check(store, key, options) {
  const { capacity = 10, leakRate = 1, windowMs = 1000 } = options;
  const now = Date.now();

  // 获取当前桶的状态
  const data = await store.get(key);

  let water = 0;
  let _lastLeak = now;

  if (data) {
    // 计算自上次检查以来泄漏的水量
    const timePassed = now - data.lastLeak;
    const waterLeaked = (timePassed / windowMs) * leakRate;

    water = Math.max(0, data.water - waterLeaked);
    _lastLeak = data.lastLeak;
  }

  // 尝试添加水（请求）
  if (water < capacity) {
    water += 1;
    await store.set(key, { water, lastLeak: now }, windowMs * capacity);

    return {
      count: water,
      resetTime: now + (water / leakRate) * windowMs,
    };
  }

  // 桶已满
  const timeToLeak = ((water - capacity + 1) / leakRate) * windowMs;

  return {
    count: capacity + 1, // 超过限制
    resetTime: now + timeToLeak,
  };
}

module.exports = {
  check,
};
