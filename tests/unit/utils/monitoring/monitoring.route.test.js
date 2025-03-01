// 文件路径: tests/unit/utils/monitoring/monitoring.route.test.js

const express = require('express');
const httpStatus = require('http-status');
const request = require('supertest');

// 模拟认证中间件
jest.mock('../../../../src/middlewares/auth', () => {
  return function mockAuth(requiredRight) {
    return (req, res, next) => {
      req.user = { role: 'admin' };
      next();
    };
  };
});

describe('Monitoring Routes', () => {
  let app;
  let mockMonitoringService;
  let createMonitoringRoutes;

  beforeEach(() => {
    // 清除之前的所有模拟调用
    jest.clearAllMocks();
    
    // 创建Express应用
    app = express();
    app.use(express.json());

    // 创建模拟监控服务
    mockMonitoringService = {
      metricsCollector: {
        getMetric: jest.fn(),
        getMetrics: jest.fn().mockReturnValue([
          { name: 'test_metric', type: 'gauge', value: 42 }
        ]),
        exportPrometheusMetrics: jest.fn().mockReturnValue('# Test metrics')
      },
      healthChecker: {
        getStatus: jest.fn().mockReturnValue({
          status: 'healthy',
          lastCheck: new Date(),
          components: {}
        })
      },
      alertManager: {
        getActiveAlerts: jest.fn().mockReturnValue([
          { name: 'test_alert', severity: 'warning', status: 'active' }
        ]),
        getAlertHistory: jest.fn().mockReturnValue([
          { name: 'test_alert', severity: 'warning', status: 'active' },
          { name: 'resolved_alert', severity: 'info', status: 'resolved' }
        ]),
        acknowledge: jest.fn().mockReturnValue(true),
        resolve: jest.fn().mockReturnValue(true),
        silence: jest.fn().mockReturnValue('silence-123'),
        unsilence: jest.fn().mockReturnValue(true)
      },
      performanceOptimizer: {
        analyze: jest.fn().mockResolvedValue({ optimizersToRun: [] }),
        optimize: jest.fn().mockResolvedValue({ results: {} }),
        getStatus: jest.fn().mockReturnValue({ status: 'idle' }),
        enableAutomaticOptimization: jest.fn(),
        disableAutomaticOptimization: jest.fn()
      },
      getStatusSummary: jest.fn().mockReturnValue({
        health: { status: 'healthy' },
        alerts: { active: 1 },
        metrics: {}
      }),
      getHealth: jest.fn().mockReturnValue({
        status: 'healthy',
        components: {}
      }),
      getMetrics: jest.fn().mockReturnValue([
        { name: 'test_metric', type: 'gauge', value: 42 }
      ]),
      getAlerts: jest.fn().mockReturnValue({
        active: [{ name: 'test_alert', severity: 'warning', status: 'active' }],
        history: [
          { name: 'test_alert', severity: 'warning', status: 'active' },
          { name: 'resolved_alert', severity: 'info', status: 'resolved' }
        ]
      }),
      getOptimizationData: jest.fn().mockReturnValue({
        enabled: true,
        status: { status: 'idle' },
        history: []
      }),
      exportPrometheusMetrics: jest.fn().mockReturnValue('# Test metrics')
    };

    // 重要：先清除路由模块缓存，确保每次测试都使用新的路由实例
    jest.resetModules();
    
    // 导入路由创建函数
    createMonitoringRoutes = require('../../../../src/routes/v1/monitoring.route');
    
    // 创建监控路由并挂载 - 确保传递正确的模拟服务对象
    const router = createMonitoringRoutes(mockMonitoringService);
    app.use('/v1/monitoring', router);
    
    // 添加通用错误处理中间件
    app.use((err, req, res, next) => {
      console.error('Test error:', err);
      res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
        message: err.message || '服务器内部错误'
      });
    });
  });

  describe('GET /status', () => {
    test('应该返回监控状态摘要', async () => {
      const res = await request(app)
        .get('/v1/monitoring/status')
        .expect(httpStatus.OK);
      
      expect(res.body).toBeDefined();
      expect(mockMonitoringService.getStatusSummary).toHaveBeenCalled();
      expect(res.body).toEqual(mockMonitoringService.getStatusSummary());
    });
  });

  describe('GET /health', () => {
    test('应该返回健康状态', async () => {
      const res = await request(app)
        .get('/v1/monitoring/health')
        .expect(httpStatus.OK);
      
      expect(res.body).toBeDefined();
      expect(mockMonitoringService.getHealth).toHaveBeenCalled();
      expect(res.body.status).toBe('healthy');
    });
    
    test('应该根据健康状态返回适当的HTTP状态码', async () => {
      // 模拟不健康状态
      mockMonitoringService.getHealth.mockReturnValueOnce({
        status: 'unhealthy',
        components: {}
      });
      
      const res = await request(app)
        .get('/v1/monitoring/health')
        .expect(httpStatus.INTERNAL_SERVER_ERROR);
      
      expect(res.body.status).toBe('unhealthy');
      
      // 模拟降级状态
      mockMonitoringService.getHealth.mockReturnValueOnce({
        status: 'degraded',
        components: {}
      });
      
      const res2 = await request(app)
        .get('/v1/monitoring/health')
        .expect(httpStatus.SERVICE_UNAVAILABLE);
      
      expect(res2.body.status).toBe('degraded');
    });
  });

  describe('GET /metrics', () => {
    test('应该返回系统指标', async () => {
      const res = await request(app)
        .get('/v1/monitoring/metrics')
        .expect(httpStatus.OK);
      
      expect(res.body).toBeDefined();
      expect(Array.isArray(res.body)).toBe(true);
      expect(mockMonitoringService.getMetrics).toHaveBeenCalled();
      expect(res.body[0].name).toBe('test_metric');
    });
  });

  describe('GET /metrics/prometheus', () => {
    test('应该返回Prometheus格式的指标', async () => {
      const res = await request(app)
        .get('/v1/monitoring/metrics/prometheus')
        .expect(httpStatus.OK);
      
      expect(mockMonitoringService.exportPrometheusMetrics).toHaveBeenCalled();
      expect(res.text).toBe('# Test metrics');
      expect(res.header['content-type']).toBe('text/plain; charset=utf-8');
    });
  });

  describe('GET /alerts', () => {
    test('应该返回告警数据', async () => {
      const res = await request(app)
        .get('/v1/monitoring/alerts')
        .expect(httpStatus.OK);
      
      expect(res.body).toBeDefined();
      expect(mockMonitoringService.getAlerts).toHaveBeenCalled();
      expect(res.body.active).toBeDefined();
      expect(res.body.history).toBeDefined();
      expect(res.body.active.length).toBe(1);
      expect(res.body.history.length).toBe(2);
    });
    
    test('应该支持查询参数', async () => {
      await request(app)
        .get('/v1/monitoring/alerts?limit=10&severity=warning&status=active')
        .expect(httpStatus.OK);
      
      expect(mockMonitoringService.getAlerts).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          severity: 'warning',
          status: 'active'
        })
      );
    });
  });

  describe('POST /alerts/:name/acknowledge', () => {
    test('应该确认告警', async () => {
      mockMonitoringService.alertManager.acknowledge.mockReturnValue(true);
      
      const res = await request(app)
        .post('/v1/monitoring/alerts/test_alert/acknowledge')
        .send({ acknowledgedBy: 'test_user', message: 'Working on it' })
        .expect(httpStatus.OK);
      
      expect(mockMonitoringService.alertManager.acknowledge).toHaveBeenCalledWith(
        'test_alert', 'test_user', 'Working on it'
      );
      expect(res.body.success).toBe(true);
    });
    
    test('应该验证必要的参数', async () => {
      await request(app)
        .post('/v1/monitoring/alerts/test_alert/acknowledge')
        .send({})
        .expect(httpStatus.BAD_REQUEST);
    });
    
    test('应该处理不存在的告警', async () => {
      mockMonitoringService.alertManager.acknowledge.mockReturnValue(false);
      
      await request(app)
        .post('/v1/monitoring/alerts/non_existent/acknowledge')
        .send({ acknowledgedBy: 'test_user' })
        .expect(httpStatus.NOT_FOUND);
    });
  });

  describe('POST /alerts/:name/resolve', () => {
    test('应该解决告警', async () => {
      mockMonitoringService.alertManager.resolve.mockReturnValue(true);
      
      const res = await request(app)
        .post('/v1/monitoring/alerts/test_alert/resolve')
        .send({ message: 'Fixed issue' })
        .expect(httpStatus.OK);
      
      expect(mockMonitoringService.alertManager.resolve).toHaveBeenCalledWith(
        'test_alert', 'Fixed issue'
      );
      expect(res.body.success).toBe(true);
    });
    
    test('应该处理不存在的告警', async () => {
      mockMonitoringService.alertManager.resolve.mockReturnValue(false);
      
      await request(app)
        .post('/v1/monitoring/alerts/non_existent/resolve')
        .send({})
        .expect(httpStatus.NOT_FOUND);
    });
  });

  describe('POST /alerts/:name/silence', () => {
    test('应该静默告警', async () => {
      mockMonitoringService.alertManager.silence.mockReturnValue('silence-123');
      
      const res = await request(app)
        .post('/v1/monitoring/alerts/test_alert/silence')
        .send({ 
          duration: 3600000, 
          labels: ['test'], 
          silencedBy: 'test_user', 
          message: 'Maintenance'
        })
        .expect(httpStatus.OK);
      
      expect(mockMonitoringService.alertManager.silence).toHaveBeenCalledWith(
        'test_alert', 3600000, ['test'], 'test_user', 'Maintenance'
      );
      expect(res.body.silenceId).toBe('silence-123');
    });
    
    test('应该验证必要的参数', async () => {
      await request(app)
        .post('/v1/monitoring/alerts/test_alert/silence')
        .send({})
        .expect(httpStatus.BAD_REQUEST);
    });
  });

  describe('DELETE /alerts/silence/:id', () => {
    test('应该取消静默', async () => {
      mockMonitoringService.alertManager.unsilence.mockReturnValue(true);
      
      const res = await request(app)
        .delete('/v1/monitoring/alerts/silence/silence-123')
        .expect(httpStatus.OK);
      
      expect(mockMonitoringService.alertManager.unsilence).toHaveBeenCalledWith('silence-123');
      expect(res.body.success).toBe(true);
    });
    
    test('应该处理不存在的静默', async () => {
      mockMonitoringService.alertManager.unsilence.mockReturnValue(false);
      
      await request(app)
        .delete('/v1/monitoring/alerts/silence/non_existent')
        .expect(httpStatus.NOT_FOUND);
    });
  });

  describe('GET /optimization', () => {
    test('应该返回性能优化数据', async () => {
      const res = await request(app)
        .get('/v1/monitoring/optimization')
        .expect(httpStatus.OK);
      
      expect(res.body).toBeDefined();
      expect(mockMonitoringService.getOptimizationData).toHaveBeenCalled();
      expect(res.body.enabled).toBe(true);
      expect(res.body.status).toBeDefined();
      expect(res.body.history).toBeDefined();
    });
    
    test('应该支持限制参数', async () => {
      await request(app)
        .get('/v1/monitoring/optimization?limit=5')
        .expect(httpStatus.OK);
      
      expect(mockMonitoringService.getOptimizationData).toHaveBeenCalledWith({
        limit: 5
      });
    });
  });

  describe('POST /optimization/analyze', () => {
    test('应该触发性能分析', async () => {
      const res = await request(app)
        .post('/v1/monitoring/optimization/analyze')
        .expect(httpStatus.OK);
      
      expect(mockMonitoringService.performanceOptimizer.analyze).toHaveBeenCalled();
      expect(res.body).toBeDefined();
    });
    
    test('应该处理性能优化器不可用的情况', async () => {
      const tempOptimizer = mockMonitoringService.performanceOptimizer;
      mockMonitoringService.performanceOptimizer = null;
      
      await request(app)
        .post('/v1/monitoring/optimization/analyze')
        .expect(httpStatus.NOT_IMPLEMENTED);
        
      mockMonitoringService.performanceOptimizer = tempOptimizer;
    });
    
    test('应该处理分析错误', async () => {
      mockMonitoringService.performanceOptimizer.analyze.mockRejectedValueOnce(
        new Error('Analysis failed')
      );
      
      await request(app)
        .post('/v1/monitoring/optimization/analyze')
        .expect(httpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('POST /optimization/optimize', () => {
    test('应该触发性能优化', async () => {
      const res = await request(app)
        .post('/v1/monitoring/optimization/optimize')
        .send({ optimizers: ['database', 'cache'] })
        .expect(httpStatus.OK);
      
      expect(mockMonitoringService.performanceOptimizer.optimize).toHaveBeenCalledWith(
        ['database', 'cache']
      );
      expect(res.body).toBeDefined();
    });
    
    test('应该验证优化器参数', async () => {
      await request(app)
        .post('/v1/monitoring/optimization/optimize')
        .send({})
        .expect(httpStatus.BAD_REQUEST);
    });
    
    test('应该处理性能优化器不可用的情况', async () => {
      const tempOptimizer = mockMonitoringService.performanceOptimizer;
      mockMonitoringService.performanceOptimizer = null;
      
      await request(app)
        .post('/v1/monitoring/optimization/optimize')
        .send({ optimizers: ['database'] })
        .expect(httpStatus.NOT_IMPLEMENTED);
        
      mockMonitoringService.performanceOptimizer = tempOptimizer;
    });
    
    test('应该处理优化错误', async () => {
      mockMonitoringService.performanceOptimizer.optimize.mockRejectedValueOnce(
        new Error('Optimization failed')
      );
      
      await request(app)
        .post('/v1/monitoring/optimization/optimize')
        .send({ optimizers: ['database'] })
        .expect(httpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('POST /optimization/toggle', () => {
    test('应该启用自动优化', async () => {
      const res = await request(app)
        .post('/v1/monitoring/optimization/toggle')
        .send({ enabled: true })
        .expect(httpStatus.OK);
      
      expect(mockMonitoringService.performanceOptimizer.enableAutomaticOptimization).toHaveBeenCalled();
      expect(res.body).toBeDefined();
    });
    
    test('应该禁用自动优化', async () => {
      const res = await request(app)
        .post('/v1/monitoring/optimization/toggle')
        .send({ enabled: false })
        .expect(httpStatus.OK);
      
      expect(mockMonitoringService.performanceOptimizer.disableAutomaticOptimization).toHaveBeenCalled();
      expect(res.body).toBeDefined();
    });
    
    test('应该验证必要的参数', async () => {
      await request(app)
        .post('/v1/monitoring/optimization/toggle')
        .send({})
        .expect(httpStatus.BAD_REQUEST);
    });
    
    test('应该处理性能优化器不可用的情况', async () => {
      const tempOptimizer = mockMonitoringService.performanceOptimizer;
      mockMonitoringService.performanceOptimizer = null;
      
      await request(app)
        .post('/v1/monitoring/optimization/toggle')
        .send({ enabled: true })
        .expect(httpStatus.NOT_IMPLEMENTED);
        
      mockMonitoringService.performanceOptimizer = tempOptimizer;
    });
  });
});