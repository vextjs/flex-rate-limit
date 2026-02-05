/**
 * Token Bucket algorithm
 * Allows bursts while maintaining average rate
 */

/**
 * Check rate limit using token bucket algorithm
 * @param {Object} store - Storage backend
 * @param {string} key - Rate limit key
 * @param {Object} options - Algorithm options
 * @returns {Promise<Object>} Result with count and resetTime
 */
async function check(store, key, options) {
  const { capacity = 10, refillRate = 1, windowMs = 1000 } = options;
  const now = Date.now();

  // 获取当前桶的状态
  const data = await store.get(key);

  let tokens = capacity;
  let _lastRefill = now;

  if (data) {
    // 根据经过的时间计算要添加的令牌数
    const timePassed = now - data.lastRefill;
    const tokensToAdd = (timePassed / windowMs) * refillRate;

    tokens = Math.min(capacity, data.tokens + tokensToAdd);
    _lastRefill = data.lastRefill;
  }

  // 尝试消耗一个令牌
  if (tokens >= 1) {
    tokens -= 1;
    await store.set(key, { tokens, lastRefill: now }, windowMs * capacity);

    return {
      count: capacity - tokens,
      resetTime: now + (1 / refillRate) * windowMs,
    };
  }

  // 没有可用令牌
  const timeToNextToken = ((1 - tokens) / refillRate) * windowMs;

  return {
    count: capacity + 1, // 超过限制
    resetTime: now + timeToNextToken,
  };
}

module.exports = {
  check,
};
