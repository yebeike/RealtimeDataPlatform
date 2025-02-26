// tests/unit/utils/cache.test.js
const cache = require('../../../src/utils/cache');
const CacheLock = require('../../../src/utils/CacheLock');

describe('CacheLock', () => {
  describe('acquire', () => {
    test('should acquire lock successfully', async () => {
      const result = await CacheLock.acquire('test-key');
      expect(result).toBe(true);
    });

    test('should fail to acquire existing lock', async () => {
      await CacheLock.acquire('test-key');
      const result = await CacheLock.acquire('test-key');
      expect(result).toBe(false);
    });
  });

  describe('release', () => {
    test('should release lock successfully', async () => {
      await CacheLock.acquire('test-key');
      await CacheLock.release('test-key');
      const result = await CacheLock.acquire('test-key');
      expect(result).toBe(true);
    });
  });
});

describe('CacheService', () => {
  // 每个测试前清理数据
  beforeEach(async () => {
    // 清理测试用的缓存数据
    await cache.del('user', 'profile', '123');
  });

  describe('getWithProtection', () => {
    test('should get data from cache if exists', async () => {
      const mockData = { id: 1, name: 'test' };
      await cache.set('user', 'profile', '123', mockData);
      
      const result = await cache.getWithProtection(
        'user',
        'profile',
        '123',
        async () => ({ id: 1, name: 'different' })
      );
      
      expect(result).toEqual(mockData);
    });

    test('should call fallback if cache miss', async () => {
      const mockData = { id: 1, name: 'test' };
      const fallback = jest.fn().mockResolvedValue(mockData);
      
      const result = await cache.getWithProtection(
        'user',
        'profile',
        '123',
        fallback
      );
      
      expect(fallback).toHaveBeenCalled();
      expect(result).toEqual(mockData);
    });

    test('should prevent multiple fallback calls under concurrent access', async () => {
      const mockData = { id: 1, name: 'test' };
      const fallback = jest.fn().mockResolvedValue(mockData);
      
      // 并发测试需要一个小延迟确保锁竞争
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      fallback.mockImplementation(async () => {
        await delay(100); // 模拟数据库查询延迟
        return mockData;
      });
      
      await Promise.all([
        cache.getWithProtection('user', 'profile', '123', fallback),
        cache.getWithProtection('user', 'profile', '123', fallback),
        cache.getWithProtection('user', 'profile', '123', fallback)
      ]);
      
      expect(fallback).toHaveBeenCalledTimes(1);
    });
  });

  // 清理所有测试数据
  afterAll(async () => {
    await cache.del('user', 'profile', '123');
  });
});