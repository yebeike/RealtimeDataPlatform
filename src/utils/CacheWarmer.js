// src/utils/CacheWarmer.js

class CacheWarmer {
    constructor(cacheService, logger) {
      this.cacheService = cacheService;
      this.logger = logger;
      this.warmupTasks = new Map();
      this.isWarming = false;
      this.statistics = {
        totalTasks: 0,
        successfulTasks: 0,
        failedTasks: 0,
        lastWarmupTime: null,
        averageWarmupTime: 0
      };
    }
  
    /**
     * 注册预热任务
     * @param {string} key - 任务标识符
     * @param {Function} dataFetcher - 获取数据的函数
     * @param {Object} options - 预热选项
     * @param {number} options.priority - 优先级(1-10，1最高)
     * @param {number} options.ttl - 缓存过期时间(秒)
     * @param {boolean} options.isCore - 是否核心数据
     */
    registerTask(key, dataFetcher, options = {}) {
      const defaultOptions = {
        priority: 5,
        ttl: 3600,
        isCore: false,
        retryTimes: 3,
        retryDelay: 1000
      };
  
      this.warmupTasks.set(key, {
        dataFetcher,
        options: { ...defaultOptions, ...options }
      });
    }
  
    /**
     * 获取预热任务列表
     * @returns {Array} 排序后的任务列表
     */
    getTaskList() {
      return Array.from(this.warmupTasks.entries())
        .map(([key, task]) => ({
          key,
          ...task
        }))
        .sort((a, b) => a.options.priority - b.options.priority);
    }
  
    /**
     * 获取预热状态和统计信息
     * @returns {Object} 预热状态和统计信息
     */
    getStatus() {
      return {
        isWarming: this.isWarming,
        ...this.statistics
      };
    }
  
    /**
     * 重置统计信息
     */
    resetStatistics() {
      this.statistics = {
        totalTasks: 0,
        successfulTasks: 0,
        failedTasks: 0,
        lastWarmupTime: null,
        averageWarmupTime: 0
      };
    }
  
    /**
     * 执行单个预热任务
     * @param {string} key - 任务标识符
     * @param {Object} task - 任务配置
     * @returns {Promise<boolean>} 是否成功
     */
    async executeTask(key, task) {
      const startTime = Date.now();
      const { dataFetcher, options } = task;
  
      try {
        // 获取数据
        const data = await dataFetcher();
        if (!data) {
          throw new Error('No data fetched');
        }
  
        // 设置缓存
        await this.cacheService.set(key, data, options.ttl);
  
        // 更新统计信息
        this.statistics.successfulTasks++;
        const warmupTime = Date.now() - startTime;
        this.statistics.averageWarmupTime = 
          (this.statistics.averageWarmupTime * (this.statistics.successfulTasks - 1) + warmupTime) 
          / this.statistics.successfulTasks;
  
        this.logger.info(`Cache warmup successful for key: ${key}`);
        return true;
      } catch (error) {
        this.statistics.failedTasks++;
        this.logger.error(`Cache warmup failed for key: ${key}, error: ${error.message}`);
        return false;
      }
    }
  
    /**
     * 执行启动预热
     * @param {Object} options - 预热选项
     * @param {number} options.concurrency - 并发数量
     * @param {number} options.timeout - 超时时间(ms)
     * @returns {Promise<Object>} 预热结果
     */
    async warmupOnStartup(options = {}) {
      if (this.isWarming) {
        throw new Error('Warmup is already in progress');
      }
  
      const defaultOptions = {
        concurrency: 5,
        timeout: 30000
      };
  
      const config = { ...defaultOptions, ...options };
      this.isWarming = true;
      this.resetStatistics();
      const startTime = Date.now();
  
      try {
        // 获取排序后的任务列表
        const tasks = this.getTaskList();
        this.statistics.totalTasks = tasks.length;
  
        // 创建任务池
        const taskPool = [];
        const results = {
          successful: [],
          failed: []
        };
  
        // 执行预热任务
        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i];
          
          // 控制并发数量
          if (taskPool.length >= config.concurrency) {
            await Promise.race(taskPool);
          }
  
          // 创建任务Promise
          const taskPromise = this.executeTask(task.key, task)
            .then(success => {
              const index = taskPool.indexOf(taskPromise);
              if (index > -1) {
                taskPool.splice(index, 1);
              }
              if (success) {
                results.successful.push(task.key);
              } else {
                results.failed.push(task.key);
              }
            });
  
          taskPool.push(taskPromise);
  
          // 检查是否超时
          if (Date.now() - startTime > config.timeout) {
            throw new Error('Warmup timeout');
          }
        }
  
        // 等待所有任务完成
        await Promise.all(taskPool);
  
        this.statistics.lastWarmupTime = Date.now() - startTime;
        this.logger.info('Startup warmup completed', this.getStatus());
  
        return results;
      } catch (error) {
        this.logger.error('Startup warmup failed', error);
        throw error;
      } finally {
        this.isWarming = false;
      }
    }
  
    /**
     * 启动定时预热任务
     * @param {Object} options - 定时预热配置
     * @param {string} options.cron - cron表达式
     * @param {number} options.maxRetries - 最大重试次数
     * @param {number} options.retryDelay - 重试延迟(ms)
     */
    async startScheduledWarmup(options = {}) {
      const defaultOptions = {
        cron: '0 */2 * * *',  // 默认每2小时执行一次
        maxRetries: 3,
        retryDelay: 5000,
        timeout: 30000
      };
  
      const config = { ...defaultOptions, ...options };
      this.scheduledTasks = new Map();
  
      // 设置定时任务
      for (const [key, task] of this.warmupTasks.entries()) {
        if (!task.options.isScheduled) continue;
  
        const schedule = async (retryCount = 0) => {
          try {
            const success = await this.executeTask(key, task);
            
            if (!success && retryCount < config.maxRetries) {
              this.logger.warn(`Scheduling retry for task: ${key}, attempt: ${retryCount + 1}`);
              setTimeout(() => schedule(retryCount + 1), config.retryDelay);
            }
          } catch (error) {
            this.logger.error(`Scheduled warmup failed for key: ${key}`, error);
            if (retryCount < config.maxRetries) {
              setTimeout(() => schedule(retryCount + 1), config.retryDelay);
            }
          }
        };
  
        // 创建定时器
        const timer = setInterval(() => {
          if (!this.isWarming) {
            schedule();
          }
        }, this.parseCron(config.cron));
  
        this.scheduledTasks.set(key, timer);
      }
  
      this.logger.info('Scheduled warmup tasks started');
    }
  
    /**
     * 停止定时预热任务
     */
    stopScheduledWarmup() {
      if (this.scheduledTasks) {
        for (const timer of this.scheduledTasks.values()) {
          clearInterval(timer);
        }
        this.scheduledTasks.clear();
        this.logger.info('Scheduled warmup tasks stopped');
      }
    }
  
    /**
     * 执行单次定时预热（手动触发）
     * @param {Object} options - 预热选项
     */
    async executeScheduledWarmup(options = {}) {
      if (this.isWarming) {
        throw new Error('Warmup is already in progress');
      }
  
      const defaultOptions = {
        maxRetries: 3,
        retryDelay: 5000,
        timeout: 30000,
        concurrency: 5
      };
  
      const config = { ...defaultOptions, ...options };
      this.isWarming = true;
      const startTime = Date.now();
  
      try {
        // 获取需要定时预热的任务
        const tasks = this.getTaskList().filter(task => task.options.isScheduled);
        const results = {
          successful: [],
          failed: [],
          retried: []
        };
  
        // 并发执行任务
        await Promise.all(tasks.map(async task => {
          let success = false;
          let retryCount = 0;
  
          while (!success && retryCount <= config.maxRetries) {
            success = await this.executeTask(task.key, task);
            
            if (!success) {
              retryCount++;
              if (retryCount <= config.maxRetries) {
                results.retried.push(task.key);
                await new Promise(resolve => setTimeout(resolve, config.retryDelay));
              }
            }
          }
  
          if (success) {
            results.successful.push(task.key);
          } else {
            results.failed.push(task.key);
          }
        }));
  
        this.statistics.lastWarmupTime = Date.now() - startTime;
        this.logger.info('Scheduled warmup execution completed', results);
        return results;
      } catch (error) {
        this.logger.error('Scheduled warmup execution failed', error);
        throw error;
      } finally {
        this.isWarming = false;
      }
    }
  
    /**
     * 简单的cron表达式解析（仅支持小时间隔）
     * @param {string} cron - cron表达式
     * @returns {number} 间隔毫秒数
     */
    parseCron(cron) {
      // 这里简化处理，仅支持 "0 */X * * *" 格式
      const hours = parseInt(cron.split(' ')[1].replace('*/', ''));
      return hours * 60 * 60 * 1000;
    }
  
    /**
     * 初始化访问统计
     */
    initAccessStats() {
      this.accessStats = {
        counters: new Map(),  // 访问计数器
        timestamps: new Map(), // 访问时间戳
        thresholds: new Map(), // 预热阈值
        cooldowns: new Map()   // 冷却时间
      };
    }
  
    /**
     * 记录缓存访问
     * @param {string} key - 缓存键
     * @param {boolean} isHit - 是否命中缓存
     */
    recordAccess(key, isHit) {
      if (!this.accessStats) {
        this.initAccessStats();
      }
  
      const now = Date.now();
      const stats = this.accessStats;
  
      // 更新访问计数
      stats.counters.set(key, (stats.counters.get(key) || 0) + 1);
      
      // 更新访问时间戳
      if (!stats.timestamps.has(key)) {
        stats.timestamps.set(key, []);
      }
      const timestamps = stats.timestamps.get(key);
      timestamps.push(now);
  
      // 只保留最近1小时的访问记录
      const oneHourAgo = now - 3600000;
      while (timestamps.length > 0 && timestamps[0] < oneHourAgo) {
        timestamps.shift();
      }
  
      // 未命中缓存时检查是否需要预热
      if (!isHit) {
        this.checkAndTriggerWarmup(key);
      }
    }
  
    /**
     * 检查并触发按需预热
     * @param {string} key - 缓存键
     */
    async checkAndTriggerWarmup(key) {
      const stats = this.accessStats;
      const now = Date.now();
  
      // 检查冷却时间
      const lastWarmup = stats.cooldowns.get(key) || 0;
      const cooldownPeriod = 300000; // 5分钟冷却时间
      if (now - lastWarmup < cooldownPeriod) {
        return;
      }
  
      // 计算最近一小时的访问频率
      const timestamps = stats.timestamps.get(key) || [];
      const recentAccesses = timestamps.length;
      
      // 获取或设置预热阈值
      let threshold = stats.thresholds.get(key);
      if (!threshold) {
        threshold = this.calculateInitialThreshold(key);
        stats.thresholds.set(key, threshold);
      }
  
      // 判断是否需要预热
      if (recentAccesses >= threshold) {
        try {
          const task = this.warmupTasks.get(key);
          if (task) {
            // 更新冷却时间
            stats.cooldowns.set(key, now);
            
            // 执行预热
            await this.executeTask(key, task);
            
            // 动态调整阈值
            this.adjustThreshold(key, true);
            
            this.logger.info(`On-demand warmup triggered for key: ${key}`);
          }
        } catch (error) {
          this.logger.error(`On-demand warmup failed for key: ${key}`, error);
          this.adjustThreshold(key, false);
        }
      }
    }
  
    /**
     * 计算初始预热阈值
     * @param {string} key - 缓存键
     * @returns {number} 初始阈值
     */
    calculateInitialThreshold(key) {
      const task = this.warmupTasks.get(key);
      if (!task) return 100; // 默认阈值
  
      // 根据任务优先级调整初始阈值
      const { priority } = task.options;
      // 优先级越高，阈值越低
      return Math.max(20, 100 - (priority * 10));
    }
  
    /**
     * 动态调整预热阈值
     * @param {string} key - 缓存键
     * @param {boolean} success - 预热是否成功
     */
    adjustThreshold(key, success) {
      const stats = this.accessStats;
      let threshold = stats.thresholds.get(key);
      
      if (!threshold) return;
  
      if (success) {
        // 预热成功，稍微降低阈值，使其更容易触发
        threshold = Math.max(20, threshold * 0.9);
      } else {
        // 预热失败，提高阈值，减少触发频率
        threshold = Math.min(200, threshold * 1.2);
      }
  
      stats.thresholds.set(key, threshold);
    }
  
    /**
     * 获取访问统计信息
     * @returns {Object} 统计信息
     */
    getAccessStats() {
      if (!this.accessStats) {
        return {};
      }
  
      const stats = {};
      for (const [key, counter] of this.accessStats.counters) {
        stats[key] = {
          totalAccesses: counter,
          recentAccesses: (this.accessStats.timestamps.get(key) || []).length,
          threshold: this.accessStats.thresholds.get(key),
          lastWarmup: this.accessStats.cooldowns.get(key)
        };
      }
  
      return stats;
    }
  }
  
  module.exports = CacheWarmer;
  