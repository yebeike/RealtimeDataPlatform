// 文件位置: tests/unit/utils/monitoring/performanceOptimizer.test.js

const PerformanceOptimizer = require('../../../../src/utils/monitoring/PerformanceOptimizer');
const MetricsCollector = require('../../../../src/utils/monitoring/MetricsCollector');

describe('PerformanceOptimizer', () => {
  let performanceOptimizer;
  let metricsCollector;

  beforeEach(() => {
    // 创建指标收集器
    metricsCollector = new MetricsCollector({ enabled: false });
    
    // 创建性能优化器，禁用自动分析
    performanceOptimizer = new PerformanceOptimizer({
      metricsCollector,
      analysisInterval: 60000,
      automaticOptimization: false
    });
  });

  afterEach(() => {
    // 停止优化器
    performanceOptimizer.stopAnalysis();
  });

  test('应该正确初始化性能优化器', () => {
    expect(performanceOptimizer).toBeDefined();
    expect(performanceOptimizer.metricsCollector).toBe(metricsCollector);
    expect(performanceOptimizer.status).toBe(PerformanceOptimizer.OptimizationStatus.IDLE);
    expect(performanceOptimizer.optimizers instanceof Map).toBe(true);
    expect(performanceOptimizer.optimizationHistory).toEqual([]);
  });

  test('应该能添加优化器', () => {
    // 添加测试优化器
    performanceOptimizer.addOptimizer('test_optimizer', {
      analyze: jest.fn().mockResolvedValue({ optimizable: true }),
      optimize: jest.fn().mockResolvedValue({ optimizations: [] }),
      verify: jest.fn().mockResolvedValue({ success: true }),
      isApplicable: jest.fn().mockResolvedValue(true)
    });
    
    expect(performanceOptimizer.optimizers.has('test_optimizer')).toBe(true);
    
    const optimizer = performanceOptimizer.optimizers.get('test_optimizer');
    expect(typeof optimizer.analyze).toBe('function');
    expect(typeof optimizer.optimize).toBe('function');
    expect(typeof optimizer.verify).toBe('function');
    expect(typeof optimizer.isApplicable).toBe('function');
  });

  test('应该能执行性能分析', async () => {
    // 添加测试优化器
    const analyzeMock = jest.fn().mockResolvedValue({
      optimizable: true,
      metrics: { testValue: 95 }
    });
    
    performanceOptimizer.addOptimizer('test_optimizer', {
      analyze: analyzeMock,
      optimize: jest.fn().mockResolvedValue({ optimizations: [] }),
      isApplicable: jest.fn().mockResolvedValue(true)
    });
    
    // 执行分析
    const analysisResult = await performanceOptimizer.analyze();
    
    // 验证分析函数被调用
    expect(analyzeMock).toHaveBeenCalled();
    
    // 验证分析结果
    expect(analysisResult).toBeDefined();
    expect(analysisResult.timestamp).toBeDefined();
    expect(analysisResult.optimizersToRun).toContain('test_optimizer');
    expect(analysisResult.analysis.test_optimizer.optimizable).toBe(true);
    
    // 状态应该回到空闲
    expect(performanceOptimizer.status).toBe(PerformanceOptimizer.OptimizationStatus.IDLE);
  });

  test('应该能执行性能优化', async () => {
    // 添加测试优化器
    const optimizeMock = jest.fn().mockResolvedValue({
      optimizations: [
        { type: 'test', description: 'Test optimization' }
      ]
    });
    
    performanceOptimizer.addOptimizer('test_optimizer', {
      analyze: jest.fn().mockResolvedValue({
        optimizable: true,
        metrics: { testValue: 95 }
      }),
      optimize: optimizeMock,
      verify: jest.fn().mockResolvedValue({ success: true }),
      isApplicable: jest.fn().mockResolvedValue(true)
    });
    
    // 先执行分析填充基准数据
    await performanceOptimizer.analyze();
    
    // 执行优化
    const optimizationResult = await performanceOptimizer.optimize(['test_optimizer']);
    
    // 验证优化函数被调用
    expect(optimizeMock).toHaveBeenCalled();
    
    // 验证优化结果
    expect(optimizationResult).toBeDefined();
    expect(optimizationResult.timestamp).toBeDefined();
    expect(optimizationResult.results.test_optimizer).toBeDefined();
    expect(optimizationResult.results.test_optimizer.optimization.optimizations.length).toBe(1);
    
    // 应该添加到优化历史
    expect(performanceOptimizer.optimizationHistory.length).toBe(1);
    
    // 状态应该回到空闲
    expect(performanceOptimizer.status).toBe(PerformanceOptimizer.OptimizationStatus.IDLE);
  });

  test('应该能验证优化效果', async () => {
    // 添加测试优化器
    const verifyMock = jest.fn().mockResolvedValue({
      before: { testValue: 95 },
      after: { testValue: 85 },
      improvement: { testValue: 10 },
      overallImprovement: 0.1,
      success: true
    });
    
    performanceOptimizer.addOptimizer('test_optimizer', {
      analyze: jest.fn().mockResolvedValue({
        optimizable: true,
        metrics: { testValue: 95 }
      }),
      optimize: jest.fn().mockResolvedValue({
        optimizations: [
          { type: 'test', description: 'Test optimization' }
        ]
      }),
      verify: verifyMock,
      isApplicable: jest.fn().mockResolvedValue(true)
    });
    
    // 执行分析和优化
    await performanceOptimizer.analyze();
    const optimizationResult = await performanceOptimizer.optimize(['test_optimizer']);
    
    // 验证验证函数被调用
    expect(verifyMock).toHaveBeenCalled();
    
    // 验证结果应该包含验证信息
    expect(optimizationResult.verification).toBeDefined();
    expect(optimizationResult.verification.results.test_optimizer).toBeDefined();
    expect(optimizationResult.verification.results.test_optimizer.success).toBe(true);
    expect(optimizationResult.verification.results.test_optimizer.overallImprovement).toBe(0.1);
  });

  test('应该能处理优化器错误', async () => {
    // 添加一个会失败的优化器
    performanceOptimizer.addOptimizer('failing_optimizer', {
      analyze: jest.fn().mockRejectedValue(new Error('Analysis failed')),
      optimize: jest.fn().mockResolvedValue({ optimizations: [] }),
      isApplicable: jest.fn().mockResolvedValue(true)
    });
    
    // 添加一个正常的优化器
    performanceOptimizer.addOptimizer('working_optimizer', {
      analyze: jest.fn().mockResolvedValue({
        optimizable: true,
        metrics: { testValue: 95 }
      }),
      optimize: jest.fn().mockResolvedValue({
        optimizations: [
          { type: 'test', description: 'Test optimization' }
        ]
      }),
      isApplicable: jest.fn().mockResolvedValue(true)
    });
    
    // 执行分析
    const analysisResult = await performanceOptimizer.analyze();
    
    // 分析仍应该成功完成
    expect(analysisResult).toBeDefined();
    expect(analysisResult.optimizersToRun).toContain('working_optimizer');
    expect(analysisResult.optimizersToRun).not.toContain('failing_optimizer');
    
    // 状态应该回到空闲
    expect(performanceOptimizer.status).toBe(PerformanceOptimizer.OptimizationStatus.IDLE);
  });

  test('应该能切换自动优化', () => {
    // 初始状态应该是禁用
    expect(performanceOptimizer.automaticOptimization).toBe(false);
    
    // 启用自动优化
    performanceOptimizer.enableAutomaticOptimization();
    expect(performanceOptimizer.automaticOptimization).toBe(true);
    
    // 禁用自动优化
    performanceOptimizer.disableAutomaticOptimization();
    expect(performanceOptimizer.automaticOptimization).toBe(false);
  });

  test('应该能获取状态和历史', async () => {
    // 添加测试优化器
    performanceOptimizer.addOptimizer('test_optimizer', {
      analyze: jest.fn().mockResolvedValue({
        optimizable: true,
        metrics: { testValue: 95 }
      }),
      optimize: jest.fn().mockResolvedValue({
        optimizations: [
          { type: 'test', description: 'Test optimization' }
        ]
      }),
      verify: jest.fn().mockResolvedValue({ success: true }),
      isApplicable: jest.fn().mockResolvedValue(true)
    });
    
    // 执行分析和优化
    await performanceOptimizer.analyze();
    await performanceOptimizer.optimize(['test_optimizer']);
    
    // 获取状态
    const status = performanceOptimizer.getStatus();
    
    expect(status).toBeDefined();
    expect(status.status).toBe(PerformanceOptimizer.OptimizationStatus.IDLE);
    expect(status.lastAnalysis).toBeDefined();
    expect(status.lastOptimization).toBeDefined();
    expect(status.automaticOptimization).toBe(false);
    
    // 获取历史
    const history = performanceOptimizer.getOptimizationHistory();
    
    expect(history).toBeDefined();
    expect(history.length).toBe(1);
    expect(history[0].results.test_optimizer).toBeDefined();
  });

  test('应该能添加数据库优化器', () => {
    // 模拟数据库对象
    const mockDb = {
      getSlowQueries: jest.fn().mockResolvedValue([]),
      suggestIndexes: jest.fn().mockResolvedValue([]),
      createIndex: jest.fn().mockResolvedValue(true),
      setMaxConnections: jest.fn().mockResolvedValue(true)
    };
    
    // 添加数据库优化器
    performanceOptimizer.addDatabaseOptimizer(mockDb, {
      maxConnections: 100,
      slowQueryThreshold: 200
    });
    
    expect(performanceOptimizer.optimizers.has('database')).toBe(true);
    
    const optimizer = performanceOptimizer.optimizers.get('database');
    expect(typeof optimizer.analyze).toBe('function');
    expect(typeof optimizer.optimize).toBe('function');
    expect(typeof optimizer.verify).toBe('function');
    expect(typeof optimizer.isApplicable).toBe('function');
  });

  test('应该能添加缓存优化器', () => {
    // 模拟缓存服务
    const mockCacheService = {
      getHotKeys: jest.fn().mockResolvedValue([]),
      getStats: jest.fn().mockResolvedValue({
        evictions: 50,
        expired: 30
      }),
      setMaxSize: jest.fn().mockResolvedValue(true),
      setDefaultTTL: jest.fn().mockResolvedValue(true),
      prewarm: jest.fn().mockResolvedValue(true)
    };
    
    // 添加缓存优化器
    performanceOptimizer.addCacheOptimizer(mockCacheService, {
      maxSize: 1000,
      ttl: 3600,
      minHitRate: 80
    });
    
    expect(performanceOptimizer.optimizers.has('cache')).toBe(true);
    
    const optimizer = performanceOptimizer.optimizers.get('cache');
    expect(typeof optimizer.analyze).toBe('function');
    expect(typeof optimizer.optimize).toBe('function');
    expect(typeof optimizer.verify).toBe('function');
    expect(typeof optimizer.isApplicable).toBe('function');
  });

  test('应该能添加队列优化器', () => {
    // 模拟队列管理器
    const mockQueueManager = {
      getQueues: jest.fn().mockResolvedValue([
        {
          name: 'test-queue',
          concurrency: 1,
          batchEnabled: false
        }
      ]),
      setConcurrency: jest.fn().mockResolvedValue(true),
      enableBatch: jest.fn().mockResolvedValue(true)
    };
    
    // 添加队列优化器
    performanceOptimizer.addQueueOptimizer(mockQueueManager, {
      maxConcurrency: 20,
      maxBatchSize: 100,
      batchThreshold: 500
    });
    
    expect(performanceOptimizer.optimizers.has('queue')).toBe(true);
    
    const optimizer = performanceOptimizer.optimizers.get('queue');
    expect(typeof optimizer.analyze).toBe('function');
    expect(typeof optimizer.optimize).toBe('function');
    expect(typeof optimizer.verify).toBe('function');
    expect(typeof optimizer.isApplicable).toBe('function');
  });
});