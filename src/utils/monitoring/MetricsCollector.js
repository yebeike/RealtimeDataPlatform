// 文件位置: src/utils/monitoring/MetricsCollector.js

const os = require('os');
const EventEmitter = require('events');
const logger = require('../../config/logger');

/**
 * 指标类型枚举
 */
const MetricType = {
  COUNTER: 'counter',  // 累计值，只增不减
  GAUGE: 'gauge',      // 瞬时值，可增可减
  HISTOGRAM: 'histogram' // 分布统计
};

/**
 * 指标收集器 - 负责收集和管理系统各项性能指标
 */
class MetricsCollector extends EventEmitter {
  constructor(options = {}) {
    super();
    this.metrics = new Map();
    this.interval = options.interval || 10000; // 默认10秒收集一次
    this.collectTimer = null;
    this.prefix = options.prefix || 'app_';
    this.labels = options.labels || {};
    this.enabled = options.enabled !== false;
    
    // 是否已初始化内置指标
    this.initialized = false;
    
    // 如果启用，则自动开始收集
    if (this.enabled) {
      this.initialize();
      this.startCollection();
    }
  }
  
  /**
   * 初始化基础指标
   */
  initialize() {
    if (this.initialized) return;
    
    // 系统指标
    this.registerMetric('system_cpu_usage', MetricType.GAUGE, 'CPU usage percentage');
    this.registerMetric('system_memory_total', MetricType.GAUGE, 'Total memory in bytes');
    this.registerMetric('system_memory_free', MetricType.GAUGE, 'Free memory in bytes');
    this.registerMetric('system_memory_usage', MetricType.GAUGE, 'Memory usage percentage');
    this.registerMetric('system_load_average', MetricType.GAUGE, 'System load average (1m)');
    
    // 应用指标
    this.registerMetric('app_uptime', MetricType.GAUGE, 'Application uptime in seconds');
    this.registerMetric('app_requests_total', MetricType.COUNTER, 'Total number of requests');
    this.registerMetric('app_requests_active', MetricType.GAUGE, 'Number of active requests');
    this.registerMetric('app_request_duration', MetricType.HISTOGRAM, 'Request duration in ms', ['method', 'route', 'status_code']);
    this.registerMetric('app_requests_errors', MetricType.COUNTER, 'Total number of request errors');
    
    // 缓存指标
    this.registerMetric('cache_hits', MetricType.COUNTER, 'Cache hits');
    this.registerMetric('cache_misses', MetricType.COUNTER, 'Cache misses');
    this.registerMetric('cache_hit_rate', MetricType.GAUGE, 'Cache hit rate');
    this.registerMetric('cache_size', MetricType.GAUGE, 'Current cache size in bytes');
    
    // 队列指标
    this.registerMetric('queue_size', MetricType.GAUGE, 'Queue size', ['queue_name']);
    this.registerMetric('queue_processed', MetricType.COUNTER, 'Processed messages', ['queue_name']);
    this.registerMetric('queue_errors', MetricType.COUNTER, 'Message processing errors', ['queue_name']);
    this.registerMetric('queue_processing_time', MetricType.HISTOGRAM, 'Message processing time in ms', ['queue_name']);
    
    // 数据处理器指标
    this.registerMetric('processor_throughput', MetricType.GAUGE, 'Data processor throughput (items/sec)');
    this.registerMetric('processor_processing_time', MetricType.HISTOGRAM, 'Data processing time in ms');
    this.registerMetric('processor_errors', MetricType.COUNTER, 'Data processing errors');
    this.registerMetric('processor_concurrency', MetricType.GAUGE, 'Current processing concurrency');
    
    // 数据库指标
    this.registerMetric('db_connections', MetricType.GAUGE, 'Database active connections');
    this.registerMetric('db_queries', MetricType.COUNTER, 'Total database queries');
    this.registerMetric('db_query_time', MetricType.HISTOGRAM, 'Database query time in ms');
    this.registerMetric('db_errors', MetricType.COUNTER, 'Database query errors');
    
    this.initialized = true;
    logger.info('Metrics collector initialized with default metrics');
  }
  
  /**
   * 注册一个新指标
   * @param {string} name 指标名称
   * @param {string} type 指标类型 (counter, gauge, histogram)
   * @param {string} help 指标描述
   * @param {Array<string>} labelNames 标签名称数组
   * @returns {Object} 已注册的指标对象
   */
  registerMetric(name, type, help, labelNames = []) {
    if (this.metrics.has(name)) {
      return this.metrics.get(name);
    }
    
    const fullName = `${this.prefix}${name}`;
    const metric = {
      name: fullName,
      type,
      help,
      labelNames,
      created: Date.now(),
      // 根据类型初始化不同的数据结构
      value: type === MetricType.HISTOGRAM ? { sum: 0, count: 0, buckets: {} } : 0,
      // 带标签的值存储
      labelValues: new Map(),
    };
    
    this.metrics.set(name, metric);
    logger.debug(`Registered metric: ${fullName} (${type})`);
    
    return metric;
  }
  
  /**
   * 设置或增加某个指标的值
   * @param {string} name 指标名称
   * @param {number} value 指标值
   * @param {Object} labels 标签值对象
   */
  setMetric(name, value, labels = {}) {
    const metric = this.metrics.get(name);
    if (!metric) {
      logger.warn(`Attempted to set unknown metric: ${name}`);
      return;
    }
    
    // 检查是否有标签
    if (metric.labelNames.length > 0) {
      // 如果指标有标签但调用时未提供，记录警告
      const missingLabels = metric.labelNames.filter(label => !(label in labels));
      if (missingLabels.length > 0) {
        logger.warn(`Missing labels for metric ${name}: ${missingLabels.join(', ')}`);
      }
      
      // 创建标签键
      const labelKey = this._getLabelKey(labels, metric.labelNames);
      
      // 根据指标类型更新值
      if (metric.type === MetricType.COUNTER) {
        // 计数器只能增加
        if (value < 0) {
          logger.warn(`Cannot decrease counter metric ${name}`);
          return;
        }
        
        const currentValue = metric.labelValues.get(labelKey) || 0;
        metric.labelValues.set(labelKey, currentValue + value);
      } 
      else if (metric.type === MetricType.GAUGE) {
        // 仪表盘可以设置为任何值
        metric.labelValues.set(labelKey, value);
      }
      else if (metric.type === MetricType.HISTOGRAM) {
        // 直方图需要更复杂的数据结构
        if (!metric.labelValues.has(labelKey)) {
          metric.labelValues.set(labelKey, { sum: 0, count: 0, buckets: {} });
        }
        
        const histData = metric.labelValues.get(labelKey);
        histData.sum += value;
        histData.count += 1;
        
        // 更新分布桶
        const buckets = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
        for (const bucket of buckets) {
          if (value <= bucket) {
            histData.buckets[bucket] = (histData.buckets[bucket] || 0) + 1;
          }
        }
      }
    } else {
      // 无标签指标的更新
      if (metric.type === MetricType.COUNTER) {
        if (value < 0) {
          logger.warn(`Cannot decrease counter metric ${name}`);
          return;
        }
        metric.value += value;
      } 
      else if (metric.type === MetricType.GAUGE) {
        metric.value = value;
      }
      else if (metric.type === MetricType.HISTOGRAM) {
        metric.value.sum += value;
        metric.value.count += 1;
        
        // 更新分布桶
        const buckets = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
        for (const bucket of buckets) {
          if (value <= bucket) {
            metric.value.buckets[bucket] = (metric.value.buckets[bucket] || 0) + 1;
          }
        }
      }
    }
    
    // 触发指标更新事件
    this.emit('metric:update', {
      name: metric.name,
      type: metric.type,
      value,
      labels
    });
  }
  
  /**
   * 增加计数器类型指标的值
   * @param {string} name 指标名称
   * @param {number} increment 增加值，默认为1
   * @param {Object} labels 标签值对象
   */
  incrementCounter(name, increment = 1, labels = {}) {
    const metric = this.metrics.get(name);
    if (!metric) {
      logger.warn(`Attempted to increment unknown metric: ${name}`);
      return;
    }
    
    if (metric.type !== MetricType.COUNTER) {
      logger.warn(`Metric ${name} is not a counter`);
      return;
    }
    
    this.setMetric(name, increment, labels);
  }
  
  /**
   * 观察直方图类型指标的值
   * @param {string} name 指标名称
   * @param {number} value 观察值
   * @param {Object} labels 标签值对象
   */
  observeHistogram(name, value, labels = {}) {
    const metric = this.metrics.get(name);
    if (!metric) {
      logger.warn(`Attempted to observe unknown metric: ${name}`);
      return;
    }
    
    if (metric.type !== MetricType.HISTOGRAM) {
      logger.warn(`Metric ${name} is not a histogram`);
      return;
    }
    
    this.setMetric(name, value, labels);
  }
  
  /**
   * 获取某个指标的当前值
   * @param {string} name 指标名称
   * @param {Object} labels 标签值对象
   * @returns {number|Object} 指标值
   */
  getMetric(name, labels = {}) {
    const metric = this.metrics.get(name);
    if (!metric) {
      logger.warn(`Attempted to get unknown metric: ${name}`);
      return null;
    }
    
    // 如果有标签，则根据标签获取值
    if (metric.labelNames.length > 0 && Object.keys(labels).length > 0) {
      const labelKey = this._getLabelKey(labels, metric.labelNames);
      return metric.labelValues.get(labelKey) || null;
    }
    
    // 否则返回基本值
    return metric.value;
  }
  
  /**
   * 获取所有指标的当前快照
   * @returns {Array} 所有指标的数组
   */
  getMetrics() {
    const result = [];
    
    for (const [name, metric] of this.metrics.entries()) {
      // 基本指标信息
      const metricData = {
        name: metric.name,
        type: metric.type,
        help: metric.help,
        labelNames: metric.labelNames,
      };
      
      // 如果没有标签
      if (metric.labelNames.length === 0) {
        metricData.value = metric.value;
        result.push(metricData);
        continue;
      }
      
      // 如果有标签，则添加所有标签值
      metricData.values = [];
      for (const [labelKey, value] of metric.labelValues.entries()) {
        const labelValues = this._parseLabelKey(labelKey);
        metricData.values.push({
          labels: labelValues,
          value: value
        });
      }
      
      result.push(metricData);
    }
    
    return result;
  }
  
  /**
   * 开始收集系统指标
   */
  startCollection() {
    if (this.collectTimer) {
      return;
    }
    
    this.collectTimer = setInterval(() => {
      try {
        this.collectSystemMetrics();
        this.emit('metrics:collected');
      } catch (error) {
        logger.error('Error collecting system metrics:', error);
      }
    }, this.interval);
    
    logger.info(`Started metrics collection with interval: ${this.interval}ms`);
  }
  
  /**
   * 停止收集系统指标
   */
  stopCollection() {
    if (this.collectTimer) {
      clearInterval(this.collectTimer);
      this.collectTimer = null;
      logger.info('Stopped metrics collection');
    }
  }
  
  /**
   * 收集系统级指标
   */
  collectSystemMetrics() {
    // CPU 使用率
    const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
    this.setMetric('system_cpu_usage', cpuUsage);
    
    // 内存使用情况
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMemPercentage = ((totalMem - freeMem) / totalMem) * 100;
    
    this.setMetric('system_memory_total', totalMem);
    this.setMetric('system_memory_free', freeMem);
    this.setMetric('system_memory_usage', usedMemPercentage);
    
    // 系统负载
    this.setMetric('system_load_average', os.loadavg()[0]);
    
    // 应用运行时间
    this.setMetric('app_uptime', process.uptime());
  }
  
  /**
   * 将标签对象转换为唯一的标签键
   * @private
   * @param {Object} labels 标签对象
   * @param {Array<string>} labelNames 标签名称数组
   * @returns {string} 标签键
   */
  _getLabelKey(labels, labelNames) {
    return labelNames
      .map(name => `${name}:${labels[name] !== undefined ? labels[name] : ''}`)
      .join(',');
  }
  
  /**
   * 将标签键解析回标签对象
   * @private
   * @param {string} labelKey 标签键
   * @returns {Object} 标签对象
   */
  _parseLabelKey(labelKey) {
    const result = {};
    const parts = labelKey.split(',');
    
    for (const part of parts) {
      const [name, value] = part.split(':');
      if (name) {
        result[name] = value;
      }
    }
    
    return result;
  }
  
  /**
   * 导出Prometheus格式的指标
   * @returns {string} Prometheus格式的指标
   */
  exportPrometheusMetrics() {
    const lines = [];
    
    for (const [name, metric] of this.metrics.entries()) {
      // 添加帮助和类型信息
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      
      // 如果没有标签
      if (metric.labelNames.length === 0) {
        if (metric.type === MetricType.HISTOGRAM) {
          // 添加直方图的sum
          lines.push(`${metric.name}_sum ${metric.value.sum}`);
          // 添加直方图的count
          lines.push(`${metric.name}_count ${metric.value.count}`);
          // 添加直方图的buckets
          for (const [bucket, count] of Object.entries(metric.value.buckets)) {
            lines.push(`${metric.name}_bucket{le="${bucket}"} ${count}`);
          }
          // 添加+Inf bucket
          lines.push(`${metric.name}_bucket{le="+Inf"} ${metric.value.count}`);
        } else {
          // 普通指标
          lines.push(`${metric.name} ${metric.value}`);
        }
        continue;
      }
      
      // 带标签的指标
      for (const [labelKey, value] of metric.labelValues.entries()) {
        const labelValues = this._parseLabelKey(labelKey);
        const labelString = Object.entries(labelValues)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');
        
        if (metric.type === MetricType.HISTOGRAM) {
          // 添加直方图的sum
          lines.push(`${metric.name}_sum{${labelString}} ${value.sum}`);
          // 添加直方图的count
          lines.push(`${metric.name}_count{${labelString}} ${value.count}`);
          // 添加直方图的buckets
          for (const [bucket, count] of Object.entries(value.buckets)) {
            lines.push(`${metric.name}_bucket{${labelString},le="${bucket}"} ${count}`);
          }
          // 添加+Inf bucket
          lines.push(`${metric.name}_bucket{${labelString},le="+Inf"} ${value.count}`);
        } else {
          // 普通指标
          lines.push(`${metric.name}{${labelString}} ${value}`);
        }
      }
    }
    
    return lines.join('\n');
  }
}

// 导出指标类型枚举
MetricsCollector.MetricType = MetricType;

module.exports = MetricsCollector;
