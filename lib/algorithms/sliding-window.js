/**
 * 滑动窗口算法
 * 最精确的速率限制，跨时间窗口平滑
 */

/**
 * 使用滑动窗口算法检查速率限制
 * @param {Object} store - 存储后端
 * @param {string} key - 速率限制键
 * @param {Object} options - 算法选项
 * @returns {Promise<Object>} 包含计数和重置时间的结果
 */
async function check(store, key, options) {
  const { windowMs } = options;
  const now = Date.now();
  const windowStart = now - windowMs;

  // 获取当前窗口数据
  const data = await store.get(key);

  if (!data || !data.requests) {
    // 第一个请求
    await store.increment(key, { timestamp: now, windowMs });
    return {
      count: 1,
      resetTime: now + windowMs,
    };
  }

  // 过滤当前窗口内的请求
  const validRequests = data.requests.filter(
    (timestamp) => timestamp > windowStart,
  );

  // 使用加权滑动窗口计算计数
  const count = validRequests.length;

  // 添加新请求
  validRequests.push(now);
  await store.set(key, { requests: validRequests }, windowMs);

  // 计算重置时间（最早请求过期的时间）
  const oldestRequest = validRequests[0] || now;
  const resetTime = oldestRequest + windowMs;

  return {
    count: count + 1,
    resetTime,
  };
}

module.exports = {
  check,
};
