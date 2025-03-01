// 文件路径: tests/unit/utils/monitoring/monitoring.test.js

const request = require('supertest');
const httpStatus = require('http-status');
const express = require('express');
const MonitoringService = require('../../../../src/utils/monitoring/MonitoringService');

// 模拟认证中间件
jest.mock('../../../../src/middlewares/auth', () => {
  return function mockAuth(requiredRight) {
    return (req, res, next) => {
      req.user = { role: 'admin' };
      next();
    };
  };
});

describe('监控系统集成测试', () => {
  let app;
  let monitoringService;
  let server;

  beforeAll(async () => {
    // 创建Express应用
    app = express();
    app.use(express.json());
    
    // 初始化监控服务
    monitoringService = new MonitoringService({
      enableOptimizer: false // 禁用优化器以简化测试
    });
    
    // 手动创建并挂载路由
    const createMonitoringRoutes = require('../../../../src/routes/v1/monitoring.route');
    app.use('/v1/monitoring', createMonitoringRoutes(monitoringService));
    
    // 添加请求监控中间件
    app.use(monitoringService.requestMonitoringMiddleware());
    
    // 添加错误处理中间件
    app.use((err, req, res, next) => {
      console.error('Test error:', err);
      res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
        error: err.message || '服务器内部错误'
      });
    });
    
    // 启动服务器
    server = app.listen(0); // 随机端口
    
    // 等待监控系统初始化完成
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    // 关闭服务器
    if (server) {
      server.close();
    }
    
    // 关闭监控系统
    if (monitoringService) {
      monitoringService.shutdown();
    }
    
    // 确保完全清理
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('健康检查接口', () => {
    test('应该返回系统健康状态', async () => {
      const res = await request(app)
        .get('/v1/monitoring/health')
        .expect(httpStatus.OK);
      
      expect(res.body).toBeDefined();
      expect(res.body.status).toBeDefined();
      expect(res.body.components).toBeDefined();
    });
  });

  describe('系统指标接口', () => {
    test('应该返回Prometheus格式的指标', async () => {
      const res = await request(app)
        .get('/v1/monitoring/metrics/prometheus')
        .expect(httpStatus.OK);
      
      expect(res.text).toBeDefined();
      expect(res.text).toContain('# HELP');
      expect(res.text).toContain('# TYPE');
    });

    test('应该返回JSON格式的指标', async () => {
      const res = await request(app)
        .get('/v1/monitoring/metrics')
        .expect(httpStatus.OK);
      
      expect(Array.isArray(res.body)).toBe(true);
      
      // 应该至少包含系统指标
      const systemMetrics = res.body.filter(m => m.name.includes('system_'));
      expect(systemMetrics.length).toBeGreaterThan(0);
    });
  });

  describe('告警系统接口', () => {
    test('应该返回当前告警', async () => {
      const res = await request(app)
        .get('/v1/monitoring/alerts')
        .expect(httpStatus.OK);
      
      expect(res.body).toBeDefined();
      expect(res.body.active).toBeDefined();
      expect(res.body.history).toBeDefined();
      expect(Array.isArray(res.body.active)).toBe(true);
      expect(Array.isArray(res.body.history)).toBe(true);
    });

    test('应该能手动触发和解决告警', async () => {
      // 手动触发一个测试告警
      const testAlertName = `test_alert_${Date.now()}`;
      monitoringService.alertManager.alert(
        testAlertName,
        'Integration test alert',
        'warning',
        ['test', 'integration']
      );
      
      // 检查告警是否存在
      // 检查告警是否存在
      const res1 = await request(app)
        .get('/v1/monitoring/alerts')
        .expect(httpStatus.OK);
      
      const alert = res1.body.active.find(a => a.name === testAlertName);
      expect(alert).toBeDefined();
      
      // 解决告警
      const res2 = await request(app)
        .post(`/v1/monitoring/alerts/${testAlertName}/resolve`)
        .send({ message: 'Resolved in integration test' })
        .expect(httpStatus.OK);
      
      expect(res2.body.success).toBe(true);
      
      // 检查告警是否已解决
      const res3 = await request(app)
        .get('/v1/monitoring/alerts')
        .expect(httpStatus.OK);
      
      const activeAlert = res3.body.active.find(a => a.name === testAlertName);
      expect(activeAlert).toBeUndefined();
      
      // 检查历史记录中是否包含已解决的告警
      const historyAlert = res3.body.history.find(a => a.name === testAlertName);
      expect(historyAlert).toBeDefined();
      expect(historyAlert.status).toBe('resolved');
    });
  });

  describe('状态摘要接口', () => {
    test('应该返回系统状态摘要', async () => {
      const res = await request(app)
        .get('/v1/monitoring/status')
        .expect(httpStatus.OK);
      
      expect(res.body).toBeDefined();
      expect(res.body.health).toBeDefined();
      expect(res.body.alerts).toBeDefined();
      expect(res.body.metrics).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('中间件功能', () => {
    test('应该记录请求指标', async () => {
      // 确保指标已初始化
      monitoringService.metricsCollector.registerMetric('app_requests_total', 'counter', 'Total requests');
      monitoringService.metricsCollector.registerMetric('app_request_duration', 'histogram', 'Request duration');
      
      // 创建测试应用
      const app = express();
      app.use(monitoringService.requestMonitoringMiddleware());
      app.get('/test', (req, res) => {
        res.json({ success: true });
      });
      
      // 手动设置一些初始值
      monitoringService.metricsCollector.setMetric('app_requests_total', 0);
      
      // 发送请求
      await request(app).get('/test').expect(200);
      
      // 获取指标 - 给点时间让指标更新
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const metrics = monitoringService.getMetrics();
      
      // 验证请求指标
      const requestsTotal = metrics.find(m => m.name.includes('requests_total'));
      expect(requestsTotal).toBeDefined();
      
      // 直接检查计数器的实际值
      const actualValue = monitoringService.metricsCollector.getMetric('app_requests_total');
      console.log('Actual requests_total value:', actualValue);
      
      expect(requestsTotal.value).toBeGreaterThan(0);
      
      const requestDuration = metrics.find(m => m.name.includes('request_duration'));
      expect(requestDuration).toBeDefined();
    });
  });
});