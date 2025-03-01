// 文件位置: src/utils/monitoring/index.js

const MonitoringService = require('./MonitoringService');
const MetricsCollector = require('./MetricsCollector');
const HealthChecker = require('./HealthChecker');
const AlertManager = require('./AlertManager');
const PerformanceOptimizer = require('./PerformanceOptimizer');
const config = require('../../config/config');
const logger = require('../../config/logger');

/**
 * 监控系统配置
 */
const monitoringConfig = config.monitoring || {};

/**
 * 监控系统全局实例
 */
let monitoringInstance = null;

/**
 * 初始化监控系统
 * @param {Object} app Express应用实例
 * @param {Object} db 数据库连接对象
 * @param {Object} redis Redis客户端
 * @param {Object} queueManager 队列管理器
 * @param {Object} cacheService 缓存服务
 * @returns {MonitoringService} 监控系统服务实例
 */
const initMonitoring = (app, { db, redis, queueManager, cacheService } = {}) => {
  if (monitoringInstance) {
    return monitoringInstance;
  }
  
  logger.info('Initializing monitoring system');
  
  // 创建监控服务实例
  monitoringInstance = new MonitoringService({
    metrics: monitoringConfig.metrics,
    health: monitoringConfig.health,
    alerts: monitoringConfig.alerts,
    enableOptimizer: monitoringConfig.enableOptimizer !== false,
    optimizer: monitoringConfig.optimizer
  });
  
  // 注册请求监控中间件
  if (app && monitoringConfig.enableRequestMonitoring !== false) {
    app.use(monitoringInstance.requestMonitoringMiddleware());
    logger.info('Request monitoring middleware registered');
  }
  
  // 注册系统健康检查
  monitoringInstance.healthChecker.registerSystemCheck({
    memoryThreshold: monitoringConfig.memoryThreshold || 90,
    cpuThreshold: monitoringConfig.cpuThreshold || 90
  });
  
  // 注册数据库监控
  if (db) {
    monitoringInstance.registerDatabase(db, monitoringConfig.database);
    logger.info('Database monitoring registered');
  }
  
  // 注册Redis监控
  if (redis) {
    monitoringInstance.registerRedis(redis, monitoringConfig.redis);
    logger.info('Redis monitoring registered');
  }
  
  // 注册队列监控
  if (queueManager) {
    monitoringInstance.registerQueueSystem(queueManager, monitoringConfig.queue);
    logger.info('Queue system monitoring registered');
  }
  
  // 注册缓存服务监控
  if (cacheService) {
    monitoringInstance.registerCacheService(cacheService, monitoringConfig.cache);
    logger.info('Cache service monitoring registered');
  }
  
  // 设置邮件告警通知
  if (monitoringConfig.alertNotifiers && monitoringConfig.alertNotifiers.email) {
    const { emailTransport } = require('../../config/email');
    monitoringInstance.alertManager.addEmailNotifier(
      monitoringConfig.alertNotifiers.email,
      emailTransport
    );
    logger.info('Email alert notifier configured');
  }
  
  // 设置Slack告警通知
  if (monitoringConfig.alertNotifiers && monitoringConfig.alertNotifiers.slack) {
    monitoringInstance.alertManager.addSlackNotifier(
      monitoringConfig.alertNotifiers.slack
    );
    logger.info('Slack alert notifier configured');
  }
  
  // 注册优雅关闭钩子
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down monitoring service');
    monitoringInstance.shutdown();
  });
  
  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down monitoring service');
    monitoringInstance.shutdown();
  });
  
  logger.info('Monitoring system initialized successfully');
  
  return monitoringInstance;
};

/**
 * 获取监控系统实例
 * @returns {MonitoringService} 监控系统服务实例
 */
const getMonitoringService = () => {
  if (!monitoringInstance) {
    logger.warn('Monitoring service accessed before initialization');
  }
  return monitoringInstance;
};

module.exports = {
  initMonitoring,
  getMonitoringService,
  MonitoringService,
  MetricsCollector,
  HealthChecker,
  AlertManager,
  PerformanceOptimizer
};