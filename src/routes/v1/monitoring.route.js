// 文件位置: src/routes/v1/monitoring.route.js

const express = require('express');
const httpStatus = require('http-status');
const router = express.Router();
const auth = require('../../middlewares/auth');

/**
 * 创建监控系统路由
 * @param {Object} monitoringService 监控系统服务实例
 * @returns {express.Router} Express路由
 */
const createMonitoringRoutes = (monitoringService) => {
  /**
   * @api {get} /monitoring/status 获取系统监控状态摘要
   * @apiDescription 获取系统监控状态的摘要信息
   * @apiName GetMonitoringStatus
   * @apiGroup Monitoring
   * @apiPermission admin
   *
   * @apiSuccess {Object} status 监控状态摘要
   */
  router.get('/status', auth('getMonitoring'), (req, res) => {
    const status = monitoringService.getStatusSummary();
    res.json(status);
  });

  /**
   * @api {get} /monitoring/health 获取系统健康状态
   * @apiDescription 获取系统及各组件的健康状态
   * @apiName GetHealthStatus
   * @apiGroup Monitoring
   * @apiPermission admin
   *
   * @apiSuccess {Object} health 健康状态信息
   */
  router.get('/health', (req, res) => {
    const health = monitoringService.getHealth();
    
    // 根据健康状态设置HTTP状态码
    const httpStatusCode = health.status === 'healthy' 
      ? httpStatus.OK 
      : health.status === 'degraded'
        ? httpStatus.SERVICE_UNAVAILABLE
        : httpStatus.INTERNAL_SERVER_ERROR;
    
    res.status(httpStatusCode).json(health);
  });

  /**
   * @api {get} /monitoring/metrics 获取系统指标数据
   * @apiDescription 获取系统收集的所有监控指标
   * @apiName GetMetrics
   * @apiGroup Monitoring
   * @apiPermission admin
   *
   * @apiSuccess {Array} metrics 指标数据数组
   */
  router.get('/metrics', auth('getMonitoring'), (req, res) => {
    const metrics = monitoringService.getMetrics();
    res.json(metrics);
  });

  /**
   * @api {get} /monitoring/metrics/prometheus 获取Prometheus格式的指标
   * @apiDescription 获取适用于Prometheus抓取的指标数据
   * @apiName GetPrometheusMetrics
   * @apiGroup Monitoring
   * @apiPermission admin
   *
   * @apiSuccess {String} metrics Prometheus格式的指标数据
   */
  router.get('/metrics/prometheus', (req, res) => {
    const metrics = monitoringService.exportPrometheusMetrics();
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  });

  /**
   * @api {get} /monitoring/alerts 获取系统告警
   * @apiDescription 获取活跃告警和历史告警记录
   * @apiName GetAlerts
   * @apiGroup Monitoring
   * @apiPermission admin
   *
   * @apiParam {Number} [limit] 限制返回的历史告警数量
   * @apiParam {String} [severity] 按严重级别筛选 (info, warning, error, critical)
   * @apiParam {String} [status] 按状态筛选 (active, resolved, acknowledged, silenced)
   *
   * @apiSuccess {Object} alerts 告警数据
   */
  router.get('/alerts', auth('getMonitoring'), (req, res) => {
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      severity: req.query.severity,
      status: req.query.status,
      startTime: req.query.startTime ? parseInt(req.query.startTime, 10) : undefined,
      endTime: req.query.endTime ? parseInt(req.query.endTime, 10) : undefined
    };
    
    const alerts = monitoringService.getAlerts(options);
    res.json(alerts);
  });

  /**
   * @api {post} /monitoring/alerts/:name/acknowledge 确认告警
   * @apiDescription 确认指定的告警
   * @apiName AcknowledgeAlert
   * @apiGroup Monitoring
   * @apiPermission admin
   *
   * @apiParam {String} name 告警名称
   * @apiParam {String} acknowledgedBy 确认人
   * @apiParam {String} [message] 确认消息
   *
   * @apiSuccess {Boolean} success 操作是否成功
   */
  // 在"/alerts/:name/acknowledge"处理程序中
  router.post('/alerts/:name/acknowledge', auth('manageMonitoring'), (req, res) => {
    const { name } = req.params;
    const { acknowledgedBy, message } = req.body;
    
    if (!acknowledgedBy) {
      return res.status(httpStatus.BAD_REQUEST).json({
        code: httpStatus.BAD_REQUEST,
        message: 'acknowledgedBy is required'
      });
    }
    
    const success = monitoringService.alertManager.acknowledge(name, acknowledgedBy, message);
    
    if (success) {
      res.json({ success: true });
    } else {
      res.status(httpStatus.NOT_FOUND).json({
        code: httpStatus.NOT_FOUND,
        message: `Alert ${name} not found`
      });
    }
  });

  /**
   * @api {post} /monitoring/alerts/:name/resolve 解决告警
   * @apiDescription 将指定的告警标记为已解决
   * @apiName ResolveAlert
   * @apiGroup Monitoring
   * @apiPermission admin
   *
   * @apiParam {String} name 告警名称
   * @apiParam {String} [message] 解决消息
   *
   * @apiSuccess {Boolean} success 操作是否成功
   */
  router.post('/alerts/:name/resolve', auth('manageMonitoring'), (req, res) => {
    const { name } = req.params;
    const { message } = req.body;
    
    const success = monitoringService.alertManager.resolve(name, message);
    
    if (success) {
      res.json({ success: true });
    } else {
      res.status(httpStatus.NOT_FOUND).json({
        code: httpStatus.NOT_FOUND,
        message: `Alert ${name} not found`
      });
    }
  });

  /**
   * @api {post} /monitoring/alerts/:name/silence 静默告警
   * @apiDescription 将指定的告警静默一段时间
   * @apiName SilenceAlert
   * @apiGroup Monitoring
   * @apiPermission admin
   *
   * @apiParam {String} name 告警名称
   * @apiParam {Number} duration 静默持续时间(ms)
   * @apiParam {Array} [labels] 标签匹配数组
   * @apiParam {String} silencedBy 静默人
   * @apiParam {String} [message] 静默原因
   *
   * @apiSuccess {String} silenceId 静默ID
   */
  router.post('/alerts/:name/silence', auth('manageMonitoring'), (req, res) => {
    const { name } = req.params;
    const { duration, labels, silencedBy, message } = req.body;
    
    if (!duration || !silencedBy) {
      return res.status(httpStatus.BAD_REQUEST).json({
        code: httpStatus.BAD_REQUEST,
        message: 'duration and silencedBy are required'
      });
    }
    
    const silenceId = monitoringService.alertManager.silence(
      name, 
      parseInt(duration, 10), 
      labels || [], 
      silencedBy, 
      message
    );
    
    res.json({ silenceId });
  });

  /**
   * @api {delete} /monitoring/alerts/silence/:id 取消静默
   * @apiDescription 取消指定的告警静默
   * @apiName UnsilenceAlert
   * @apiGroup Monitoring
   * @apiPermission admin
   *
   * @apiParam {String} id 静默ID
   *
   * @apiSuccess {Boolean} success 操作是否成功
   */
  router.delete('/alerts/silence/:id', auth('manageMonitoring'), (req, res) => {
    const { id } = req.params;
    
    const success = monitoringService.alertManager.unsilence(id);
    
    if (success) {
      res.json({ success: true });
    } else {
      res.status(httpStatus.NOT_FOUND).json({
        code: httpStatus.NOT_FOUND,
        message: `Silence ${id} not found`
      });
    }
  });

  /**
   * @api {get} /monitoring/optimization 获取性能优化数据
   * @apiDescription 获取性能优化历史和当前状态
   * @apiName GetOptimizationData
   * @apiGroup Monitoring
   * @apiPermission admin
   *
   * @apiParam {Number} [limit] 限制返回的历史记录数量
   *
   * @apiSuccess {Object} optimization 性能优化数据
   */
  router.get('/optimization', auth('getMonitoring'), (req, res) => {
    const options = {
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined
    };
    
    const optimization = monitoringService.getOptimizationData(options);
    res.json(optimization);
  });

  /**
   * @api {post} /monitoring/optimization/analyze 执行性能分析
   * @apiDescription 手动触发性能分析
   * @apiName StartOptimizationAnalysis
   * @apiGroup Monitoring
   * @apiPermission admin
   *
   * @apiSuccess {Object} result 分析结果
   */
  router.post('/optimization/analyze', auth('manageMonitoring'), async (req, res) => {
    if (!monitoringService.performanceOptimizer) {
      return res.status(httpStatus.NOT_IMPLEMENTED).json({
        code: httpStatus.NOT_IMPLEMENTED,
        message: 'Performance optimizer is not enabled'
      });
    }
    
    try {
      const result = await monitoringService.performanceOptimizer.analyze();
      res.json(result);
    } catch (error) {
      res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
        code: httpStatus.INTERNAL_SERVER_ERROR,
        message: error.message
      });
    }
  });

  /**
   * @api {post} /monitoring/optimization/optimize 执行性能优化
   * @apiDescription 手动触发性能优化
   * @apiName StartOptimization
   * @apiGroup Monitoring
   * @apiPermission admin
   *
   * @apiParam {Array} optimizers 要运行的优化器名称数组
   *
   * @apiSuccess {Object} result 优化结果
   */
  router.post('/optimization/optimize', auth('manageMonitoring'), async (req, res) => {
    if (!monitoringService.performanceOptimizer) {
      return res.status(httpStatus.NOT_IMPLEMENTED).json({
        code: httpStatus.NOT_IMPLEMENTED,
        message: 'Performance optimizer is not enabled'
      });
    }
    
    const { optimizers } = req.body;
    
    if (!optimizers || !Array.isArray(optimizers) || optimizers.length === 0) {
      return res.status(httpStatus.BAD_REQUEST).json({
        code: httpStatus.BAD_REQUEST,
        message: 'optimizers array is required'
      });
    }
    
    try {
      const result = await monitoringService.performanceOptimizer.optimize(optimizers);
      res.json(result);
    } catch (error) {
      res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
        code: httpStatus.INTERNAL_SERVER_ERROR,
        message: error.message
      });
    }
  });

  /**
   * @api {post} /monitoring/optimization/toggle 切换自动优化
   * @apiDescription 启用或禁用自动性能优化
   * @apiName ToggleAutomaticOptimization
   * @apiGroup Monitoring
   * @apiPermission admin
   *
   * @apiParam {Boolean} enabled 是否启用
   *
   * @apiSuccess {Object} status 当前状态
   */
  router.post('/optimization/toggle', auth('manageMonitoring'), (req, res) => {
    if (!monitoringService.performanceOptimizer) {
      return res.status(httpStatus.NOT_IMPLEMENTED).json({
        code: httpStatus.NOT_IMPLEMENTED,
        message: 'Performance optimizer is not enabled'
      });
    }
    
    const { enabled } = req.body;
    
    if (enabled === undefined) {
      return res.status(httpStatus.BAD_REQUEST).json({
        code: httpStatus.BAD_REQUEST,
        message: 'enabled is required'
      });
    }
    
    if (enabled) {
      monitoringService.performanceOptimizer.enableAutomaticOptimization();
    } else {
      monitoringService.performanceOptimizer.disableAutomaticOptimization();
    }
    
    res.json(monitoringService.performanceOptimizer.getStatus());
  });

  return router;
};

module.exports = createMonitoringRoutes;