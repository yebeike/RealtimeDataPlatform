// 文件位置: tests/unit/utils/monitoring/metricsCollector.test.js

const MetricsCollector = require('../../../../src/utils/monitoring/MetricsCollector');

describe('MetricsCollector', () => {
  let metricsCollector;

  beforeEach(() => {
    // 创建一个禁用自动收集的测试实例
    metricsCollector = new MetricsCollector({
      interval: 60000,
      enabled: false,
      prefix: 'test_'
    });
  });

  afterEach(() => {
    // 确保清理定时器
    metricsCollector.stopCollection();
  });

  test('应该正确初始化指标收集器', () => {
    expect(metricsCollector).toBeDefined();
    expect(metricsCollector.metrics instanceof Map).toBe(true);
    expect(metricsCollector.prefix).toBe('test_');
  });

  test('应该能注册新指标', () => {
    const metric = metricsCollector.registerMetric(
      'test_counter',
      MetricsCollector.MetricType.COUNTER,
      'Test counter metric'
    );

    expect(metric).toBeDefined();
    expect(metric.name).toBe('test_test_counter');
    expect(metric.type).toBe(MetricsCollector.MetricType.COUNTER);
    expect(metric.help).toBe('Test counter metric');
    expect(metricsCollector.metrics.has('test_counter')).toBe(true);
  });

  test('应该能设置计数器类型指标', () => {
    metricsCollector.registerMetric(
      'requests',
      MetricsCollector.MetricType.COUNTER,
      'Total requests'
    );

    metricsCollector.setMetric('requests', 5);
    expect(metricsCollector.getMetric('requests')).toBe(5);

    metricsCollector.setMetric('requests', 3);
    expect(metricsCollector.getMetric('requests')).toBe(8);

    // 计数器不能减少
    metricsCollector.setMetric('requests', -1);
    expect(metricsCollector.getMetric('requests')).toBe(8);
  });

  test('应该能设置仪表盘类型指标', () => {
    metricsCollector.registerMetric(
      'memory',
      MetricsCollector.MetricType.GAUGE,
      'Memory usage'
    );

    metricsCollector.setMetric('memory', 50);
    expect(metricsCollector.getMetric('memory')).toBe(50);

    metricsCollector.setMetric('memory', 75);
    expect(metricsCollector.getMetric('memory')).toBe(75);

    // 仪表盘可以减少
    metricsCollector.setMetric('memory', 25);
    expect(metricsCollector.getMetric('memory')).toBe(25);
  });

  test('应该能观察直方图类型指标', () => {
    metricsCollector.registerMetric(
      'response_time',
      MetricsCollector.MetricType.HISTOGRAM,
      'Response time'
    );

    metricsCollector.setMetric('response_time', 100);
    metricsCollector.setMetric('response_time', 200);
    metricsCollector.setMetric('response_time', 300);

    const histogram = metricsCollector.getMetric('response_time');
    expect(histogram.sum).toBe(600);
    expect(histogram.count).toBe(3);
    // 应该有分布桶
    expect(Object.keys(histogram.buckets).length).toBeGreaterThan(0);
  });

  test('应该能处理带标签的指标', () => {
    metricsCollector.registerMetric(
      'http_requests',
      MetricsCollector.MetricType.COUNTER,
      'HTTP requests',
      ['method', 'status']
    );

    metricsCollector.setMetric('http_requests', 1, { method: 'GET', status: '200' });
    metricsCollector.setMetric('http_requests', 1, { method: 'GET', status: '200' });
    metricsCollector.setMetric('http_requests', 1, { method: 'POST', status: '201' });
    metricsCollector.setMetric('http_requests', 1, { method: 'GET', status: '404' });

    const metrics = metricsCollector.getMetrics();
    const httpRequestsMetric = metrics.find(m => m.name === 'test_http_requests');

    expect(httpRequestsMetric).toBeDefined();
    expect(httpRequestsMetric.values.length).toBe(3);

    // 验证标签值正确
    const getOkRequests = httpRequestsMetric.values.find(
      v => v.labels.method === 'GET' && v.labels.status === '200'
    );
    expect(getOkRequests.value).toBe(2);
  });

  test('应该能增加计数器', () => {
    metricsCollector.registerMetric(
      'errors',
      MetricsCollector.MetricType.COUNTER,
      'Error count'
    );

    metricsCollector.incrementCounter('errors');
    expect(metricsCollector.getMetric('errors')).toBe(1);

    metricsCollector.incrementCounter('errors', 5);
    expect(metricsCollector.getMetric('errors')).toBe(6);
  });

  test('应该能导出Prometheus格式指标', () => {
    metricsCollector.registerMetric(
      'api_requests',
      MetricsCollector.MetricType.COUNTER,
      'API request count'
    );
    metricsCollector.setMetric('api_requests', 42);

    metricsCollector.registerMetric(
      'cpu_usage',
      MetricsCollector.MetricType.GAUGE,
      'CPU usage percent'
    );
    metricsCollector.setMetric('cpu_usage', 75.5);

    const prometheusOutput = metricsCollector.exportPrometheusMetrics();
    
    expect(prometheusOutput).toContain('# HELP test_api_requests API request count');
    expect(prometheusOutput).toContain('# TYPE test_api_requests counter');
    expect(prometheusOutput).toContain('test_api_requests 42');
    
    expect(prometheusOutput).toContain('# HELP test_cpu_usage CPU usage percent');
    expect(prometheusOutput).toContain('# TYPE test_cpu_usage gauge');
    expect(prometheusOutput).toContain('test_cpu_usage 75.5');
  });

  test('应该能手动收集系统指标', () => {
    // 初始化基础指标
    metricsCollector.initialize();
    
    // 收集系统指标
    metricsCollector.collectSystemMetrics();
    
    // 验证是否收集了系统指标
    expect(metricsCollector.getMetric('system_cpu_usage')).not.toBeNull();
    expect(metricsCollector.getMetric('system_memory_total')).toBeGreaterThan(0);
    expect(metricsCollector.getMetric('system_memory_free')).toBeGreaterThan(0);
    expect(metricsCollector.getMetric('system_memory_usage')).toBeLessThanOrEqual(100);
    expect(metricsCollector.getMetric('system_load_average')).not.toBeNull();
  });
});