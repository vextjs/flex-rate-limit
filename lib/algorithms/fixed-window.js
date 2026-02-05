/**
 * 固定窗口算法
 * 简单的计数器，在固定时间间隔重置
 */

/**
 * 使用固定窗口算法检查速率限制
 * @param {Object} store - 存储后端
 * @param {string} key - 速率限制键
 * @param {Object} options - 算法选项
 * @returns {Promise<Object>} 包含计数和重置时间的结果
 */
async function check(store, key, options) {
  const { windowMs } = options;
  const now = Date.now();
  const windowKey = Math.floor(now / windowMs);
  const fullKey = `${key}:${windowKey}`;

  // 增加当前窗口的计数器
  const result = await store.increment(fullKey, { windowMs });

  // 计算重置时间（当前窗口结束时间）
  const resetTime = (windowKey + 1) * windowMs;

  return {
    count: result.count,
    resetTime,
  };
}

module.exports = {
  check,
};
