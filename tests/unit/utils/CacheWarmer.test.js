// tests/unit/utils/CacheWarmer.test.js
const CacheWarmer = require('../../../src/utils/CacheWarmer');

describe('CacheWarmer', () => {
  let cacheWarmer;
  let mockCacheService;
  let mockLogger;

  beforeEach(() => {
    mockCacheService = {
      set: jest.fn().mockResolvedValue(true),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(true)
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };

    cacheWarmer = new CacheWarmer(mockCacheService, mockLogger);
  });

  describe('Startup Warmup', () => {
    test('should warm up data successfully', async () => {
      // 注册测试任务
      const mockData = { id: 1, name: 'test' };
      const dataFetcher = jest.fn().mockResolvedValue(mockData);
      
      cacheWarmer.registerTask('test-key', dataFetcher, { priority: 1 });
      
      const result = await cacheWarmer.warmupOnStartup();
      
      expect(result.successful).toContain('test-key');
      expect(result.failed).toHaveLength(0);
      expect(dataFetcher).toHaveBeenCalled();
      expect(mockCacheService.set).toHaveBeenCalledWith('test-key', mockData, expect.any(Number));
    });

    test('should handle concurrent warmup tasks', async () => {
      const mockData = { id: 1, name: 'test' };
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      
      // 创建一个延迟的数据获取函数
      const dataFetcher = jest.fn().mockImplementation(async () => {
        await delay(100);
        return mockData;
      });

      // 注册多个任务
      cacheWarmer.registerTask('task1', dataFetcher, { priority: 1 });
      cacheWarmer.registerTask('task2', dataFetcher, { priority: 2 });
      cacheWarmer.registerTask('task3', dataFetcher, { priority: 3 });

      const result = await cacheWarmer.warmupOnStartup({ concurrency: 2 });

      expect(result.successful).toContain('task1');
      expect(result.successful).toContain('task2');
      expect(result.successful).toContain('task3');
      expect(dataFetcher).toHaveBeenCalledTimes(3);
    });
  });

  describe('Scheduled Warmup', () => {
    test('should execute scheduled warmup successfully', async () => {
      const mockData = { id: 1, name: 'test' };
      const dataFetcher = jest.fn().mockResolvedValue(mockData);

      cacheWarmer.registerTask('scheduled-key', dataFetcher, {
        priority: 1,
        isScheduled: true
      });

      const result = await cacheWarmer.executeScheduledWarmup();

      expect(result.successful).toContain('scheduled-key');
      expect(result.failed).toHaveLength(0);
      expect(dataFetcher).toHaveBeenCalled();
    });

    test('should handle retry on failure', async () => {
      const mockData = { id: 1, name: 'test' };
      const dataFetcher = jest.fn()
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockResolvedValueOnce(mockData);

      cacheWarmer.registerTask('retry-key', dataFetcher, {
        priority: 1,
        isScheduled: true
      });

      const result = await cacheWarmer.executeScheduledWarmup({
        maxRetries: 1,
        retryDelay: 100
      });

      expect(result.successful).toContain('retry-key');
      expect(dataFetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('On-demand Warmup', () => {
    beforeEach(() => {
      cacheWarmer.initAccessStats();
    });

    test('should trigger warmup when threshold is reached', async () => {
      const mockData = { id: 1, name: 'test' };
      const dataFetcher = jest.fn().mockResolvedValue(mockData);

      cacheWarmer.registerTask('hot-key', dataFetcher, { priority: 1 });

      // 模拟频繁访问
      for (let i = 0; i < 100; i++) {
        cacheWarmer.recordAccess('hot-key', false);
      }

      // 等待异步操作完成
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(dataFetcher).toHaveBeenCalled();
      expect(mockCacheService.set).toHaveBeenCalledWith('hot-key', mockData, expect.any(Number));
    });

    test('should respect cooldown period', async () => {
      const mockData = { id: 1, name: 'test' };
      const dataFetcher = jest.fn().mockResolvedValue(mockData);

      cacheWarmer.registerTask('cooldown-key', dataFetcher, { priority: 1 });

      // 第一次触发预热
      for (let i = 0; i < 100; i++) {
        cacheWarmer.recordAccess('cooldown-key', false);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      dataFetcher.mockClear();

      // 立即尝试再次触发
      for (let i = 0; i < 100; i++) {
        cacheWarmer.recordAccess('cooldown-key', false);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(dataFetcher).not.toHaveBeenCalled();
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});
