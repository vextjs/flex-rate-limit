/**
 * 速率限制算法
 */

const slidingWindow = require('./sliding-window');
const fixedWindow = require('./fixed-window');
const tokenBucket = require('./token-bucket');
const leakyBucket = require('./leaky-bucket');

module.exports = {
  'sliding-window': slidingWindow,
  'fixed-window': fixedWindow,
  'token-bucket': tokenBucket,
  'leaky-bucket': leakyBucket,
};
