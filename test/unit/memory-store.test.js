const { expect } = require('chai');
const { MemoryStore } = require('../../lib');

describe('MemoryStore', () => {
  let store;

  beforeEach(() => {
    store = new MemoryStore();
  });

  afterEach(async () => {
    await store.resetAll();
  });

  describe('get() and set()', () => {
    it('should store and retrieve values', async () => {
      await store.set('key1', { count: 5 });
      const value = await store.get('key1');
      expect(value).to.deep.equal({ count: 5 });
    });

    it('should return undefined for non-existent keys', async () => {
      const value = await store.get('non-existent');
      expect(value).to.be.undefined;
    });

    it('should expire keys after TTL', async function() {
      this.timeout(5000);

      await store.set('ttl-key', { count: 1 }, 1000); // 1 second TTL

      let value = await store.get('ttl-key');
      expect(value).to.exist;

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      value = await store.get('ttl-key');
      expect(value).to.be.undefined;
    });
  });

  describe('increment()', () => {
    it('should increment counter', async () => {
      let result = await store.increment('counter', { windowMs: 60000 });
      expect(result.count).to.equal(1);

      result = await store.increment('counter', { windowMs: 60000 });
      expect(result.count).to.equal(2);

      result = await store.increment('counter', { windowMs: 60000 });
      expect(result.count).to.equal(3);
    });

    it('should store timestamps for sliding window', async () => {
      const now = Date.now();

      await store.increment('sliding', { timestamp: now, windowMs: 60000 });
      await store.increment('sliding', { timestamp: now + 1000, windowMs: 60000 });

      const data = await store.get('sliding');
      expect(data.requests).to.be.an('array');
      expect(data.requests).to.have.lengthOf(2);
    });
  });

  describe('decrement()', () => {
    it('should decrement counter', async () => {
      await store.increment('dec-key', { windowMs: 60000 });
      await store.increment('dec-key', { windowMs: 60000 });
      await store.increment('dec-key', { windowMs: 60000 });

      await store.decrement('dec-key');

      const data = await store.get('dec-key');
      expect(data.count).to.equal(2);
    });

    it('should not go below zero', async () => {
      await store.increment('zero-key', { windowMs: 60000 });
      await store.decrement('zero-key');
      await store.decrement('zero-key');

      const data = await store.get('zero-key');
      expect(data.count).to.equal(0);
    });
  });

  describe('reset()', () => {
    it('should reset specific key', async () => {
      await store.set('reset-key', { count: 10 });
      await store.reset('reset-key');

      const value = await store.get('reset-key');
      expect(value).to.be.undefined;
    });

    it('should clear expiration timer', async () => {
      await store.set('timer-key', { count: 1 }, 5000);
      await store.reset('timer-key');

      expect(store.timers.has('timer-key')).to.be.false;
    });
  });

  describe('resetAll()', () => {
    it('should reset all keys', async () => {
      await store.set('key1', { count: 1 });
      await store.set('key2', { count: 2 });
      await store.set('key3', { count: 3 });

      expect(store.size()).to.equal(3);

      await store.resetAll();

      expect(store.size()).to.equal(0);
    });

    it('should clear all timers', async () => {
      await store.set('timer1', { count: 1 }, 10000);
      await store.set('timer2', { count: 2 }, 10000);

      await store.resetAll();

      expect(store.timers.size).to.equal(0);
    });
  });

  describe('size()', () => {
    it('should return number of keys', async () => {
      expect(store.size()).to.equal(0);

      await store.set('key1', { count: 1 });
      expect(store.size()).to.equal(1);

      await store.set('key2', { count: 2 });
      expect(store.size()).to.equal(2);

      await store.reset('key1');
      expect(store.size()).to.equal(1);
    });
  });
});
