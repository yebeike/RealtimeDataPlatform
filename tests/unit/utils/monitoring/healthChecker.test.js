// 文件位置: tests/unit/utils/monitoring/healthChecker.test.js

const HealthChecker = require('../../../../src/utils/monitoring/HealthChecker');

describe('HealthChecker', () => {
  let healthChecker;

  beforeEach(() => {
    // 创建一个禁用自动检查的测试实例
    healthChecker = new HealthChecker({
      interval: 60000,
      enabled: false
    });
  });

  afterEach(() => {
    // 确保清理定时器
    healthChecker.stopChecking();
  });

  test('应该正确初始化健康检查器', () => {
    expect(healthChecker).toBeDefined();
    expect(healthChecker.checks instanceof Map).toBe(true);
    expect(healthChecker.status.status).toBe(HealthChecker.HealthStatus.UNKNOWN);
  });

  test('应该能注册健康检查', async () => {
    const checkFn = jest.fn().mockResolvedValue({ ok: true });
    
    healthChecker.registerCheck('test', checkFn, {
      timeout: 1000,
      critical: true
    });

    expect(healthChecker.checks.has('test')).toBe(true);
    expect(healthChecker.status.components.test).toBeDefined();
    expect(healthChecker.status.components.test.status).toBe(HealthChecker.HealthStatus.UNKNOWN);
    expect(healthChecker.status.components.test.critical).toBe(true);
  });

  test('应该能执行健康检查并更新状态', async () => {
    // 注册一个总是健康的检查
    healthChecker.registerCheck('healthy', () => Promise.resolve({ ok: true }));
    
    // 注册一个总是不健康的检查
    healthChecker.registerCheck('unhealthy', () => Promise.reject(new Error('Test error')));
    
    // 执行所有健康检查
    await healthChecker.checkAll();
    
    // 验证组件状态
    expect(healthChecker.status.components.healthy.status).toBe(HealthChecker.HealthStatus.HEALTHY);
    expect(healthChecker.status.components.unhealthy.status).toBe(HealthChecker.HealthStatus.UNHEALTHY);
    expect(healthChecker.status.components.unhealthy.error).toBe('Test error');
    
    // 由于有不健康的组件，整体状态应该是不健康的
    expect(healthChecker.status.status).toBe(HealthChecker.HealthStatus.UNHEALTHY);
  });

  test('应该正确处理降级状态', async () => {
    // 注册一个健康的关键组件
    healthChecker.registerCheck('critical', () => Promise.resolve({ ok: true }), {
      critical: true
    });
    
    // 注册一个不健康的非关键组件
    healthChecker.registerCheck('non-critical', () => Promise.reject(new Error('Test error')), {
      critical: false
    });
    
    // 执行所有健康检查
    await healthChecker.checkAll();
    
    // 因为只有非关键组件不健康，整体状态应该是降级
    expect(healthChecker.status.status).toBe(HealthChecker.HealthStatus.DEGRADED);
  });

  test('应该处理检查超时', async () => {
    // 注册一个会超时的检查
    healthChecker.registerCheck('timeout', () => new Promise(resolve => setTimeout(resolve, 200)), {
      timeout: 100 // 100ms超时
    });
    
    // 执行所有健康检查
    await healthChecker.checkAll();
    
    // 超时的检查应该被标记为不健康
    expect(healthChecker.status.components.timeout.status).toBe(HealthChecker.HealthStatus.UNHEALTHY);
    expect(healthChecker.status.components.timeout.error).toContain('timeout');
  });

  test('应该执行不健康回调', async () => {
    const onUnhealthyMock = jest.fn();
    
    // 注册一个不健康的检查并带有回调
    healthChecker.registerCheck('with-callback', () => Promise.reject(new Error('Test error')), {
      critical: true,
      onUnhealthy: onUnhealthyMock
    });
    
    // 执行所有健康检查
    await healthChecker.checkAll();
    
    // 不健康回调应该被调用
    expect(onUnhealthyMock).toHaveBeenCalled();
    expect(onUnhealthyMock.mock.calls[0][0].message).toBe('Test error');
  });

  test('应该能正确判断系统可用性', async () => {
    // 注册各种状态的组件
    healthChecker.registerCheck('healthy', () => Promise.resolve({ ok: true }));
    healthChecker.registerCheck('degraded-component', () => Promise.reject(new Error('Degraded')), {
      critical: false
    });
    
    // 执行所有健康检查
    await healthChecker.checkAll();
    
    // 系统处于降级状态，但应该可用
    expect(healthChecker.status.status).toBe(HealthChecker.HealthStatus.DEGRADED);
    expect(healthChecker.isHealthy()).toBe(false);
    expect(healthChecker.isAvailable()).toBe(true);
    
    // 添加不健康的关键组件
    healthChecker.registerCheck('unhealthy-critical', () => Promise.reject(new Error('Critical error')), {
      critical: true
    });
    
    // 再次执行所有健康检查
    await healthChecker.checkAll();
    
    // 现在系统应该不可用
    expect(healthChecker.status.status).toBe(HealthChecker.HealthStatus.UNHEALTHY);
    expect(healthChecker.isHealthy()).toBe(false);
    expect(healthChecker.isAvailable()).toBe(false);
  });

  test('应该能注册系统检查', async () => {
    // 注册系统资源检查
    healthChecker.registerSystemCheck({
      memoryThreshold: 90,
      cpuThreshold: 90
    });
    
    expect(healthChecker.checks.has('system')).toBe(true);
    
    // 执行系统检查
    await healthChecker.checkAll();
    
    // 验证系统检查结果
    const systemStatus = healthChecker.status.components.system;
    expect(systemStatus).toBeDefined();
    expect(systemStatus.details).toBeDefined();
    expect(systemStatus.details.memory).toBeDefined();
    expect(systemStatus.details.cpu).toBeDefined();
  });
});