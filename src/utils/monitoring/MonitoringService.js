// 文件位置: src/utils/monitoring/MonitoringService.js

const EventEmitter = require('events');
const logger = require('../../config/logger');
const MetricsCollector = require('./MetricsCollector');
const HealthChecker = require('./HealthChecker');
const AlertManager = require('./AlertManager');
const PerformanceOptimizer = require('./PerformanceOptimizer');

/**
 * 监控系统服务 - 统一管理所有监控组件
 */
class MonitoringService extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // 创建监控组件
    this.metricsCollector = new MetricsCollector(options.metrics);
    this.healthChecker = new HealthChecker(options.health);
    this.alertManager = new AlertManager(options.alerts);
    
    // 性能优化器是可选的
    this.performanceOptimizer = options.enableOptimizer !== false 
      ? new PerformanceOptimizer({
          ...options.optimizer,
          metricsCollector: this.metricsCollector
        })
      : null;

    // 添加此行来追踪所有计时器
    this.intervals = [];

    // 集成事件转发
    this._setupEventForwarding();
    
    // 集成健康检查和告警
    this._setupHealthAlerts();

   
    
    logger.info('Monitoring service initialized');
  }
  
  /**
   * 设置事件转发
   * @private
   */
  _setupEventForwarding() {
    // 转发指标事件
    this.metricsCollector.on('metric:update', (metric) => {
      this.emit('metric:update', metric);
    });
    
    // 转发健康检查事件
    this.healthChecker.on('health:check:success', (data) => {
      this.emit('health:check:success', data);
    });
    
    this.healthChecker.on('health:check:failure', (data) => {
      this.emit('health:check:failure', data);
    });
    
    this.healthChecker.on('health:check:complete', (status) => {
      this.emit('health:check:complete', status);
    });
    
    // 转发告警事件
    this.alertManager.on('alert', (alert) => {
      this.emit('alert', alert);
    });
    
    this.alertManager.on('resolve', (alert) => {
      this.emit('resolve', alert);
    });
    
    // 转发性能优化事件
    if (this.performanceOptimizer) {
      this.performanceOptimizer.on('status:change', (status) => {
        this.emit('optimizer:status:change', status);
      });
      
      this.performanceOptimizer.on('analysis:complete', (data) => {
        this.emit('optimizer:analysis:complete', data);
      });
      
      this.performanceOptimizer.on('optimize:complete', (data) => {
        this.emit('optimizer:optimize:complete', data);
      });
      
      this.performanceOptimizer.on('verify:complete', (data) => {
        this.emit('optimizer:verify:complete', data);
      });
    }
  }
  
  /**
   * 设置健康检查告警集成
   * @private
   */
  _setupHealthAlerts() {
    // 将健康检查系统与告警系统集成
    this.alertManager.addHealthCheckRule(this.healthChecker);
    
    // 添加指标阈值告警
    this._setupMetricAlerts();
  }
  
  /**
   * 设置指标阈值告警
   * @private
   */
  _setupMetricAlerts() {
    // CPU使用率告警
    this.alertManager.addMetricRule({
      name: 'high_cpu_usage',
      metricFn: () => this.metricsCollector.getMetric('system_cpu_usage'),
      comparison: '>',
      threshold: 90,
      severity: AlertManager.AlertSeverity.WARNING,
      message: 'System CPU usage exceeds 90%',
      checkInterval: 60000 // 每分钟检查一次
    });
    
    // 内存使用率告警
    this.alertManager.addMetricRule({
      name: 'high_memory_usage',
      metricFn: () => this.metricsCollector.getMetric('system_memory_usage'),
      comparison: '>',
      threshold: 90,
      severity: AlertManager.AlertSeverity.WARNING,
      message: 'System memory usage exceeds 90%',
      checkInterval: 60000
    });
    
    // 请求错误率告警
    this.alertManager.addMetricRule({
      name: 'high_error_rate',
      metricFn: () => {
        const errors = this.metricsCollector.getMetric('app_requests_errors') || 0;
        const total = this.metricsCollector.getMetric('app_requests_total') || 1;
        return (errors / total) * 100;
      },
      comparison: '>',
      threshold: 5,
      severity: AlertManager.AlertSeverity.ERROR,
      message: 'Request error rate exceeds 5%',
      checkInterval: 60000
    });
    
    // 缓存命中率告警
    this.alertManager.addMetricRule({
      name: 'low_cache_hit_rate',
      metricFn: () => {
        const hits = this.metricsCollector.getMetric('cache_hits') || 0;
        const misses = this.metricsCollector.getMetric('cache_misses') || 0;
        const total = hits + misses;
        return total > 0 ? (hits / total) * 100 : 100;
      },
      comparison: '<',
      threshold: 50,
      severity: AlertManager.AlertSeverity.WARNING,
      message: 'Cache hit rate below 50%',
      checkInterval: 300000 // 每5分钟检查一次
    });
    
    // 队列积压告警
    this.alertManager.addMetricRule({
      name: 'queue_backlog',
      metricFn: () => {
        // 总队列大小
        let totalSize = 0;
        const queueSizes = this.metricsCollector.getMetrics()
          .filter(m => m.name.includes('queue_size'));
        
        for (const metric of queueSizes) {
          for (const value of metric.values || []) {
            totalSize += value.value;
          }
        }
        
        return totalSize;
      },
      comparison: '>',
      threshold: 10000,
      severity: AlertManager.AlertSeverity.WARNING,
      message: 'Message queue backlog exceeds 10,000 messages',
      checkInterval: 60000
    });
  }
  
  /**
   * 注册数据库监控
   * @param {Object} db 数据库连接对象
   * @param {Object} options 配置选项
   * @returns {MonitoringService} 当前实例，便于链式调用
   */
  registerDatabase(db, options = {}) {
    // 注册健康检查
    this.healthChecker.registerDatabaseCheck(db, options);
    
    // 如果启用了优化器，注册数据库优化器
    if (this.performanceOptimizer) {
      this.performanceOptimizer.addDatabaseOptimizer(db, options);
    }
    
    // 监控数据库连接池
    this._monitorDatabaseMetrics(db);
    
    logger.info('Database monitoring registered');
    return this;
  }
  
  /**
   * 监控数据库指标
   * @private
   * @param {Object} db 数据库连接对象
   */
  _monitorDatabaseMetrics(db) {
    // 定期收集数据库指标
    const interval = setInterval(async () => {
      try {
        if (db.getConnectionCount) {
          const connections = await db.getConnectionCount();
          this.metricsCollector.setMetric('db_connections', connections);
        }
        
        if (db.getStats) {
          const stats = await db.getStats();
          if (stats.queryCount) {
            this.metricsCollector.setMetric('db_queries', stats.queryCount);
          }
          if (stats.averageQueryTime) {
            this.metricsCollector.observeHistogram('db_query_time', stats.averageQueryTime);
          }
          if (stats.errorCount) {
            this.metricsCollector.setMetric('db_errors', stats.errorCount);
          }
        }
      } catch (error) {
        logger.error('Error collecting database metrics:', error);
      }
    }, 10000); // 每10秒收集一次
    this.intervals.push(interval);
    
    // 清理函数
    const cleanup = () => {
      clearInterval(interval);
    };
    
    // 返回清理函数
    return cleanup;
  }
  
  /**
   * 注册Redis监控
   * @param {Object} redis Redis客户端
   * @param {Object} options 配置选项
   * @returns {MonitoringService} 当前实例，便于链式调用
   */
  registerRedis(redis, options = {}) {
    // 注册健康检查
    this.healthChecker.registerRedisCheck(redis, options);
    
    // 监控Redis指标
    this._monitorRedisMetrics(redis);
    
    logger.info('Redis monitoring registered');
    return this;
  }
  
  /**
   * 监控Redis指标
   * @private
   * @param {Object} redis Redis客户端
   */
  _monitorRedisMetrics(redis) {
    // 定期收集Redis指标
    const interval = setInterval(async () => {
      try {
        if (redis.info) {
          const info = await redis.info();
          
          // 解析INFO命令结果
          const parseInfo = (infoStr) => {
            const result = {};
            const lines = infoStr.split('\r\n');
            
            for (const line of lines) {
              if (line && !line.startsWith('#')) {
                const parts = line.split(':');
                if (parts.length === 2) {
                  const key = parts[0];
                  let value = parts[1];
                  
                  // 尝试将值转换为数字
                  if (!isNaN(value)) {
                    value = parseFloat(value);
                  }
                  
                  result[key] = value;
                }
              }
            }
            
            return result;
          };
          
          const infoData = parseInfo(info);
          
          // 内存使用
          if (infoData.used_memory) {
            this.metricsCollector.setMetric('cache_size', infoData.used_memory);
          }
          
          // 连接数
          if (infoData.connected_clients) {
            this.metricsCollector.setMetric('redis_connections', infoData.connected_clients);
          }
          
          // 命令处理
          if (infoData.instantaneous_ops_per_sec) {
            this.metricsCollector.setMetric('redis_ops_per_sec', infoData.instantaneous_ops_per_sec);
          }
          
          // 内存碎片率
          if (infoData.mem_fragmentation_ratio) {
            this.metricsCollector.setMetric('redis_fragmentation_ratio', infoData.mem_fragmentation_ratio);
          }
          
          // 缓存命中率
          if (infoData.keyspace_hits && infoData.keyspace_misses) {
            const hits = parseInt(infoData.keyspace_hits, 10);
            const misses = parseInt(infoData.keyspace_misses, 10);
            const total = hits + misses;
            
            if (total > 0) {
              const hitRate = (hits / total) * 100;
              this.metricsCollector.setMetric('cache_hit_rate', hitRate);
              this.metricsCollector.setMetric('cache_hits', hits);
              this.metricsCollector.setMetric('cache_misses', misses);
            }
          }
        }
      } catch (error) {
        logger.error('Error collecting Redis metrics:', error);
      }
    }, 10000); // 每10秒收集一次
    this.intervals.push(interval);
    
    // 清理函数
    const cleanup = () => {
      clearInterval(interval);
    };
    
    // 返回清理函数
    return cleanup;
  }
  
  /**
   * 注册队列监控
   * @param {Object} queueManager 队列管理器
   * @param {Object} options 配置选项
   * @returns {MonitoringService} 当前实例，便于链式调用
   */
  registerQueueSystem(queueManager, options = {}) {
    // 注册健康检查
    this.healthChecker.registerQueueCheck(queueManager, options);
    
    // 如果启用了优化器，注册队列优化器
    if (this.performanceOptimizer) {
      this.performanceOptimizer.addQueueOptimizer(queueManager, options);
    }
    
    // 监控队列指标
    this._monitorQueueMetrics(queueManager);
    
    logger.info('Queue system monitoring registered');
    return this;
  }
  
  /**
   * 监控队列指标
   * @private
   * @param {Object} queueManager 队列管理器
   */
  _monitorQueueMetrics(queueManager) {
    // 定期收集队列指标
    const interval = setInterval(async () => {
      try {
        if (queueManager.getQueues) {
          const queues = await queueManager.getQueues();
          
          for (const queue of queues) {
            if (queue.getMetrics) {
              const metrics = await queue.getMetrics();
              
              // 队列大小
              this.metricsCollector.setMetric('queue_size', metrics.size, { queue_name: queue.name });
              
              // 已处理消息
              this.metricsCollector.setMetric('queue_processed', metrics.processed, { queue_name: queue.name });
              
              // 错误数
              this.metricsCollector.setMetric('queue_errors', metrics.errors, { queue_name: queue.name });
              
              // 处理时间
              if (metrics.averageProcessingTime) {
                this.metricsCollector.observeHistogram(
                  'queue_processing_time', 
                  metrics.averageProcessingTime, 
                  { queue_name: queue.name }
                );
              }
            }
          }
        }
      } catch (error) {
        logger.error('Error collecting queue metrics:', error);
      }
    }, 5000); // 每5秒收集一次
    this.intervals.push(interval);
    
    // 清理函数
    const cleanup = () => {
      clearInterval(interval);
    };
    
    // 返回清理函数
    return cleanup;
  }
  
  /**
   * 注册缓存服务监控
   * @param {Object} cacheService 缓存服务
   * @param {Object} options 配置选项
   * @returns {MonitoringService} 当前实例，便于链式调用
   */
  registerCacheService(cacheService, options = {}) {
    // 如果启用了优化器，注册缓存优化器
    if (this.performanceOptimizer) {
      this.performanceOptimizer.addCacheOptimizer(cacheService, options);
    }
    
    // 添加缓存事件监听
    this._setupCacheEventListeners(cacheService);
    
    logger.info('Cache service monitoring registered');
    return this;
  }
  
  /**
   * 设置缓存事件监听
   * @private
   * @param {Object} cacheService 缓存服务
   */
  _setupCacheEventListeners(cacheService) {
    // 监听缓存命中
    if (cacheService.on) {
      cacheService.on('hit', (key) => {
        this.metricsCollector.incrementCounter('cache_hits');
      });
      
      cacheService.on('miss', (key) => {
        this.metricsCollector.incrementCounter('cache_misses');
      });
      
      cacheService.on('set', (key, size) => {
        // 如果提供了大小信息，更新缓存大小
        if (size) {
          const currentSize = this.metricsCollector.getMetric('cache_size') || 0;
          this.metricsCollector.setMetric('cache_size', currentSize + size);
        }
      });
      
      cacheService.on('del', (key, size) => {
        // 如果提供了大小信息，更新缓存大小
        if (size) {
          const currentSize = this.metricsCollector.getMetric('cache_size') || 0;
          this.metricsCollector.setMetric('cache_size', Math.max(0, currentSize - size));
        }
      });
    }
  }
  
  /**
   * 添加请求监控中间件
   * @returns {Function} Express中间件函数
   */
  // 在_extractRoute方法之前修改requestMonitoringMiddleware方法
  requestMonitoringMiddleware() {
    return (req, res, next) => {
      // 记录请求开始时间
      const startTime = Date.now();
      
      // 增加请求计数 - 确保直接访问指标并增加
      const metricName = 'app_requests_total';
      
      // 直接更新计数器值，确保计数增加
      if (this.metricsCollector.metrics.has('app_requests_total')) {
        this.metricsCollector.metrics.get('app_requests_total').value += 1;
      } else {
        // 如果指标不存在，进行注册
        this.metricsCollector.registerMetric('app_requests_total', 'counter', 'Total number of requests');
        this.metricsCollector.incrementCounter('app_requests_total');
      }
      
      // 增加活跃请求计数
      const activeMetricName = 'app_requests_active';
      const activeRequests = (this.metricsCollector.getMetric(activeMetricName) || 0) + 1;
      this.metricsCollector.setMetric(activeMetricName, activeRequests);
      
      // 处理响应完成事件
      const onFinish = () => {
        // 计算请求处理时间
        const duration = Date.now() - startTime;
        
        // 减少活跃请求计数
        const currentActive = Math.max(0, (this.metricsCollector.getMetric(activeMetricName) || 0) - 1);
        this.metricsCollector.setMetric(activeMetricName, currentActive);
        
        // 记录请求持续时间
        this.metricsCollector.observeHistogram('app_request_duration', duration, {
          method: req.method,
          route: this._extractRoute(req),
          status_code: res.statusCode
        });
        
        // 如果是错误响应，增加错误计数
        if (res.statusCode >= 400) {
          this.metricsCollector.incrementCounter('app_requests_errors');
        }
        
        // 移除事件监听器
        res.removeListener('finish', onFinish);
        res.removeListener('close', onFinish);
      };
      
      // 监听响应完成事件
      res.on('finish', onFinish);
      res.on('close', onFinish);
      
      next();
    };
  }
  
  /**
   * 提取请求路由
   * @private
   * @param {Object} req 请求对象
   * @returns {string} 路由路径
   */
  _extractRoute(req) {
    // 如果Express已经解析了路由，使用它
    if (req.route && req.route.path) {
      let baseRoute = req.baseUrl || '';
      return baseRoute + req.route.path;
    }
    
    // 否则使用原始路径
    return req.path || req.url.split('?')[0];
  }
  
  /**
   * 获取监控状态摘要
   * @returns {Object} 状态摘要
   */
  getStatusSummary() {
    // 系统健康状态
    const health = this.healthChecker.getStatus();
    
    // 活跃告警
    const activeAlerts = this.alertManager.getActiveAlerts();
    
    // 性能状态
    const performance = this.performanceOptimizer 
      ? this.performanceOptimizer.getStatus() 
      : { status: 'disabled' };
    
    // 关键指标
    const metrics = {
      system: {
        cpu: this.metricsCollector.getMetric('system_cpu_usage'),
        memory: this.metricsCollector.getMetric('system_memory_usage'),
        uptime: process.uptime()
      },
      application: {
        requests: this.metricsCollector.getMetric('app_requests_total'),
        active: this.metricsCollector.getMetric('app_requests_active'),
        errors: this.metricsCollector.getMetric('app_requests_errors')
      },
      cache: {
        hitRate: this.metricsCollector.getMetric('cache_hit_rate'),
        size: this.metricsCollector.getMetric('cache_size')
      },
      database: {
        connections: this.metricsCollector.getMetric('db_connections'),
        queryTime: this.metricsCollector.getMetric('db_query_time')
      }
    };
    
    return {
      timestamp: Date.now(),
      health,
      alerts: {
        active: activeAlerts.length,
        critical: activeAlerts.filter(a => a.severity === AlertManager.AlertSeverity.CRITICAL).length,
        error: activeAlerts.filter(a => a.severity === AlertManager.AlertSeverity.ERROR).length,
        warning: activeAlerts.filter(a => a.severity === AlertManager.AlertSeverity.WARNING).length,
        info: activeAlerts.filter(a => a.severity === AlertManager.AlertSeverity.INFO).length
      },
      performance,
      metrics
    };
  }
  
  /**
   * 获取健康检查状态
   * @returns {Object} 健康状态
   */
  getHealth() {
    return this.healthChecker.getStatus();
  }
  
  /**
   * 获取监控指标数据
   * @returns {Object} 指标数据
   */
  getMetrics() {
    return this.metricsCollector.getMetrics();
  }
  
  /**
   * 获取告警数据
   * @param {Object} options 筛选选项
   * @returns {Object} 告警数据
   */
  getAlerts(options = {}) {
    return {
      active: this.alertManager.getActiveAlerts(),
      history: this.alertManager.getAlertHistory(options)
    };
  }
  
  /**
   * 获取性能优化数据
   * @param {Object} options 筛选选项
   * @returns {Object} 性能优化数据
   */
  getOptimizationData(options = {}) {
    if (!this.performanceOptimizer) {
      return { enabled: false };
    }
    
    return {
      enabled: true,
      status: this.performanceOptimizer.getStatus(),
      history: this.performanceOptimizer.getOptimizationHistory(options)
    };
  }
  
  /**
   * 导出Prometheus格式的指标
   * @returns {string} Prometheus格式的指标
   */
  exportPrometheusMetrics() {
    return this.metricsCollector.exportPrometheusMetrics();
  }
  
  /**
   * 清理并关闭监控服务
   */
  shutdown() {
    logger.info('Shutting down monitoring service');
    
    // 停止指标收集
    this.metricsCollector.stopCollection();
    
    // 停止健康检查
    this.healthChecker.stopChecking();
    
    // 停止性能优化
    if (this.performanceOptimizer) {
      this.performanceOptimizer.stopAnalysis();
    }
    
    // 清理告警管理器
    this.alertManager.shutdown();
    
    // 清理所有计时器
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
    
    // 触发关闭事件
    this.emit('shutdown');
    
    logger.info('Monitoring service stopped');
  }
}

module.exports = MonitoringService;