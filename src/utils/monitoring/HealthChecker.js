// 文件位置: src/utils/monitoring/HealthChecker.js

const EventEmitter = require('events');
const logger = require('../../config/logger');

/**
 * 健康状态枚举
 */
const HealthStatus = {
  UNKNOWN: 'unknown',
  HEALTHY: 'healthy',
  UNHEALTHY: 'unhealthy',
  DEGRADED: 'degraded'
};

/**
 * 健康检查器 - 负责检查系统各组件的健康状态
 */
class HealthChecker extends EventEmitter {
  constructor(options = {}) {
    super();
    this.checks = new Map();
    this.interval = options.interval || 30000; // 默认30秒检查一次
    this.checkTimer = null;
    this.status = {
      status: HealthStatus.UNKNOWN,
      lastCheck: null,
      components: {}
    };
    this.enabled = options.enabled !== false;
    
    // 如果启用，自动开始健康检查
    if (this.enabled) {
      this.startChecking();
    }
  }
  
  /**
   * 注册健康检查
   * @param {string} name 组件名称
   * @param {Function} checkFn 检查函数，必须返回Promise
   * @param {Object} options 配置选项
   * @param {number} options.timeout 超时时间(ms)
   * @param {boolean} options.critical 是否为关键组件
   * @param {Function} options.onUnhealthy 不健康时的回调函数
   * @returns {HealthChecker} 当前实例，便于链式调用
   */
  registerCheck(name, checkFn, options = {}) {
    if (typeof checkFn !== 'function') {
      throw new Error(`Check function for ${name} must be a function`);
    }
    
    const check = {
      check: checkFn,
      timeout: options.timeout || 5000,
      critical: options.critical !== false,
      onUnhealthy: options.onUnhealthy
    };
    
    this.checks.set(name, check);
    this.status.components[name] = { 
      status: HealthStatus.UNKNOWN,
      critical: check.critical
    };
    
    logger.debug(`Registered health check: ${name} (critical: ${check.critical})`);
    return this;
  }
  
  /**
   * 注册数据库健康检查
   * @param {Object} db 数据库连接对象
   * @param {Object} options 配置选项
   * @returns {HealthChecker} 当前实例，便于链式调用
   */
  registerDatabaseCheck(db, options = {}) {
    return this.registerCheck('database', async () => {
      // 根据具体数据库类型执行相应的检查
      if (db.db) {
        // MongoDB
        const adminDb = db.db.admin();
        const result = await adminDb.ping();
        return {
          ping: result.ok === 1,
          responseTime: Date.now() - result.requestStart
        };
      } else if (db.query) {
        // SQL数据库
        const start = Date.now();
        await db.query('SELECT 1');
        return {
          ping: true,
          responseTime: Date.now() - start
        };
      } else {
        throw new Error('Unsupported database type');
      }
    }, {
      timeout: options.timeout || 5000,
      critical: options.critical !== false,
      onUnhealthy: options.onUnhealthy
    });
  }
  
  /**
   * 注册Redis健康检查
   * @param {Object} redis Redis客户端
   * @param {Object} options 配置选项
   * @returns {HealthChecker} 当前实例，便于链式调用
   */
  registerRedisCheck(redis, options = {}) {
    return this.registerCheck('redis', async () => {
      const start = Date.now();
      const result = await redis.ping();
      return {
        ping: result === 'PONG',
        responseTime: Date.now() - start
      };
    }, {
      timeout: options.timeout || 3000,
      critical: options.critical !== false,
      onUnhealthy: options.onUnhealthy
    });
  }
  
  /**
   * 注册队列健康检查
   * @param {Object} queue 队列对象
   * @param {Object} options 配置选项
   * @returns {HealthChecker} 当前实例，便于链式调用
   */
  registerQueueCheck(queue, options = {}) {
    return this.registerCheck('queue', async () => {
      const isActive = await queue.isReady();
      const metrics = await queue.getMetrics();
      return {
        active: isActive,
        metrics
      };
    }, {
      timeout: options.timeout || 3000,
      critical: options.critical !== false,
      onUnhealthy: options.onUnhealthy
    });
  }
  
  /**
   * 注册外部服务健康检查
   * @param {string} name 服务名称
   * @param {string} url URL端点
   * @param {Object} options 配置选项
   * @returns {HealthChecker} 当前实例，便于链式调用
   */
  registerExternalServiceCheck(name, url, options = {}) {
    return this.registerCheck(`external-${name}`, async () => {
      const start = Date.now();
      const response = await fetch(url, { 
        method: options.method || 'GET',
        timeout: options.timeout || 5000,
        headers: options.headers || {}
      });
      
      return {
        status: response.status,
        ok: response.ok,
        responseTime: Date.now() - start
      };
    }, {
      timeout: options.timeout || 5000,
      critical: options.critical !== false,
      onUnhealthy: options.onUnhealthy
    });
  }
  
  /**
   * 注册系统资源健康检查
   * @param {Object} options 配置选项
   * @returns {HealthChecker} 当前实例，便于链式调用
   */
  registerSystemCheck(options = {}) {
    const memoryThreshold = options.memoryThreshold || 90; // 默认内存使用率阈值
    const cpuThreshold = options.cpuThreshold || 90; // 默认CPU使用率阈值
    
    return this.registerCheck('system', async () => {
      const os = require('os');
      
      // 内存使用率
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const memoryUsage = ((totalMem - freeMem) / totalMem) * 100;
      
      // CPU负载
      const cpus = os.cpus();
      const load = os.loadavg()[0] / cpus.length * 100;
      
      const healthy = memoryUsage < memoryThreshold && load < cpuThreshold;
      
      return {
        healthy,
        memory: {
          total: totalMem,
          free: freeMem,
          usage: memoryUsage,
          threshold: memoryThreshold
        },
        cpu: {
          cores: cpus.length,
          load: load,
          threshold: cpuThreshold
        }
      };
    }, {
      timeout: options.timeout || 3000,
      critical: options.critical !== false,
      onUnhealthy: options.onUnhealthy
    });
  }
  
  /**
   * 执行单个健康检查
   * @param {string} name 组件名称
   * @param {Object} check 检查配置
   * @returns {Promise<boolean>} 是否健康
   */
  async runCheck(name, check) {
    const component = this.status.components[name];
    component.lastCheck = new Date();
    
    try {
      // 创建一个带超时的Promise
      const result = await Promise.race([
        check.check(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Health check timeout for ${name}`)), check.timeout)
        )
      ]);
      
      component.status = HealthStatus.HEALTHY;
      component.details = result || {};
      component.error = null;
      component.lastSuccess = new Date();
      
      this.emit('health:check:success', { name, result });
      logger.debug(`Health check success: ${name}`);
      
      return true;
    } catch (error) {
      component.status = HealthStatus.UNHEALTHY;
      component.error = error.message;
      component.lastFailure = new Date();
      
      // 如果有不健康回调函数，则执行
      if (typeof check.onUnhealthy === 'function') {
        try {
          await check.onUnhealthy(error, component);
        } catch (callbackError) {
          logger.error(`Error in onUnhealthy callback for ${name}:`, callbackError);
        }
      }
      
      this.emit('health:check:failure', { name, error });
      logger.warn(`Health check failure for ${name}: ${error.message}`);
      
      return false;
    }
  }
  
  /**
   * 执行所有健康检查
   * @returns {Promise<Object>} 健康状态对象
   */
  async checkAll() {
    this.status.lastCheck = new Date();
    
    const checkPromises = [];
    for (const [name, check] of this.checks.entries()) {
      // 使用Promise.allSettled让所有检查都执行，不会因为一个失败而中断
      checkPromises.push(
        this.runCheck(name, check)
          .catch(error => {
            logger.error(`Unexpected error in health check ${name}:`, error);
            return false;
          })
      );
    }
    
    await Promise.all(checkPromises);
    
    // 根据组件状态更新整体状态
    this._updateOverallStatus();
    
    this.emit('health:check:complete', this.status);
    return this.status;
  }
  
  /**
   * 更新整体健康状态
   * @private
   */
  _updateOverallStatus() {
    let hasUnhealthyCritical = false;
    let hasUnhealthyNonCritical = false;
    
    for (const [name, component] of Object.entries(this.status.components)) {
      if (component.status === HealthStatus.UNHEALTHY) {
        if (component.critical) {
          hasUnhealthyCritical = true;
        } else {
          hasUnhealthyNonCritical = true;
        }
      }
    }
    
    if (hasUnhealthyCritical) {
      // 如果任何关键组件不健康，则整体不健康
      this.status.status = HealthStatus.UNHEALTHY;
    } else if (hasUnhealthyNonCritical) {
      // 如果只有非关键组件不健康，则降级状态
      this.status.status = HealthStatus.DEGRADED;
    } else {
      // 所有组件健康
      this.status.status = HealthStatus.HEALTHY;
    }
  }
  
  /**
   * 开始定期健康检查
   */
  startChecking() {
    if (this.checkTimer) {
      return;
    }
    
    // 立即执行一次健康检查
    this.checkAll().catch(error => {
      logger.error('Error in initial health check:', error);
    });
    
    // 设置定时器定期检查
    this.checkTimer = setInterval(() => {
      this.checkAll().catch(error => {
        logger.error('Error in periodic health check:', error);
      });
    }, this.interval);
    
    logger.info(`Started health checking with interval: ${this.interval}ms`);
  }
  
  /**
   * 停止定期健康检查
   */
  stopChecking() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
      logger.info('Stopped health checking');
    }
  }
  
  /**
   * 获取当前健康状态
   * @returns {Object} 健康状态对象
   */
  getStatus() {
    return this.status;
  }
  
  /**
   * 获取指定组件的健康状态
   * @param {string} name 组件名称
   * @returns {Object} 组件健康状态
   */
  getComponentStatus(name) {
    return this.status.components[name];
  }
  
  /**
   * 检查系统是否健康
   * @returns {boolean} 是否健康
   */
  isHealthy() {
    return this.status.status === HealthStatus.HEALTHY;
  }
  
  /**
   * 检查系统是否可用（健康或降级）
   * @returns {boolean} 是否可用
   */
  isAvailable() {
    return this.status.status === HealthStatus.HEALTHY || 
           this.status.status === HealthStatus.DEGRADED;
  }
}

// 导出健康状态枚举
HealthChecker.HealthStatus = HealthStatus;

module.exports = HealthChecker;