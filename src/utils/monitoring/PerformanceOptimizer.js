// 文件位置: src/utils/monitoring/PerformanceOptimizer.js

const EventEmitter = require('events');
const logger = require('../../config/logger');

/**
 * 优化状态枚举
 */
const OptimizationStatus = {
  IDLE: 'idle',               // 空闲状态
  ANALYZING: 'analyzing',     // 分析性能数据
  OPTIMIZING: 'optimizing',   // 执行优化措施
  VERIFYING: 'verifying'      // 验证优化效果
};

/**
 * 性能优化器 - 负责自动识别和优化系统性能瓶颈
 */
class PerformanceOptimizer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // 依赖的组件
    this.metricsCollector = options.metricsCollector;
    if (!this.metricsCollector) {
      throw new Error('MetricsCollector is required for PerformanceOptimizer');
    }
    
    // 配置参数
    this.analysisInterval = options.analysisInterval || 300000; // 默认5分钟分析一次
    this.optimizationThreshold = options.optimizationThreshold || 80; // 默认性能使用率超过80%触发优化
    this.automaticOptimization = options.automaticOptimization !== false; // 默认启用自动优化
    this.optimizers = new Map(); // 优化器集合
    
    // 状态追踪
    this.status = OptimizationStatus.IDLE;
    this.currentBenchmark = null; // 当前基准测试
    this.optimizationHistory = []; // 优化历史
    this.analysisTimer = null;
    
    // 如果启用自动优化，则开始分析
    if (this.automaticOptimization) {
      this.startAnalysis();
    }
  }
  
  /**
   * 添加优化器
   * @param {string} name 优化器名称
   * @param {Object} optimizer 优化器配置
   * @param {Function} optimizer.analyze 分析函数，返回分析结果
   * @param {Function} optimizer.optimize 优化函数，执行优化措施
   * @param {Function} optimizer.verify 验证函数，验证优化效果
   * @param {Function} optimizer.isApplicable 检查是否适用的函数
   * @returns {PerformanceOptimizer} 当前实例，便于链式调用
   */
  addOptimizer(name, optimizer) {
    if (!optimizer.analyze || !optimizer.optimize) {
      throw new Error(`Optimizer ${name} must have analyze and optimize functions`);
    }
    
    this.optimizers.set(name, {
      name,
      analyze: optimizer.analyze,
      optimize: optimizer.optimize,
      verify: optimizer.verify || (() => true),
      isApplicable: optimizer.isApplicable || (() => true),
      settings: optimizer.settings || {}
    });
    
    logger.debug(`Added performance optimizer: ${name}`);
    return this;
  }
  
  /**
   * 添加数据库优化器
   * @param {Object} db 数据库连接对象
   * @param {Object} options 配置选项
   * @returns {PerformanceOptimizer} 当前实例，便于链式调用
   */
  addDatabaseOptimizer(db, options = {}) {
    return this.addOptimizer('database', {
      isApplicable: async () => {
        try {
          const dbMetrics = this.metricsCollector.getMetric('db_query_time');
          return dbMetrics && dbMetrics.count > 0;
        } catch (error) {
          return false;
        }
      },
      analyze: async () => {
        // 获取数据库性能指标
        const queryTime = this.metricsCollector.getMetric('db_query_time');
        const connections = this.metricsCollector.getMetric('db_connections');
        
        if (!queryTime) {
          return { optimizable: false, reason: 'No query time metrics available' };
        }
        
        // 分析慢查询
        let slowQueries = [];
        if (db.getSlowQueries) {
          slowQueries = await db.getSlowQueries();
        }
        
        // 检查连接池使用情况
        const connectionPoolUsage = connections ? (connections / options.maxConnections || 100) * 100 : 0;
        
        // 确定是否可以优化
        const optimizable = 
          (queryTime.sum / queryTime.count > options.slowQueryThreshold || 20) || // 平均查询时间过长
          (slowQueries.length > 0) || // 存在慢查询
          (connectionPoolUsage > 70); // 连接池使用率过高
        
        return {
          optimizable,
          metrics: {
            avgQueryTime: queryTime.sum / queryTime.count,
            slowQueries: slowQueries.length,
            connectionPoolUsage
          },
          slowQueries
        };
      },
      optimize: async (analysis) => {
        const optimizations = [];
        
        // 优化连接池
        if (analysis.metrics.connectionPoolUsage > 70) {
          const currentMax = options.maxConnections || 100;
          const newMax = Math.min(currentMax * 1.5, 500); // 增加连接池大小，但不超过500
          
          if (db.setMaxConnections) {
            await db.setMaxConnections(newMax);
            optimizations.push({
              type: 'connection_pool',
              before: currentMax,
              after: newMax,
              description: `Increased connection pool from ${currentMax} to ${newMax}`
            });
          }
        }
        
        // 优化慢查询
        if (analysis.slowQueries && analysis.slowQueries.length > 0) {
          for (const query of analysis.slowQueries) {
            // 检查是否需要添加索引
            if (db.suggestIndexes && !query.indexed) {
              const suggestedIndexes = await db.suggestIndexes(query.query);
              
              if (suggestedIndexes.length > 0) {
                for (const index of suggestedIndexes) {
                  if (db.createIndex) {
                    await db.createIndex(index.collection, index.fields, index.options);
                    optimizations.push({
                      type: 'index',
                      collection: index.collection,
                      fields: index.fields,
                      description: `Created index on ${index.collection}: ${index.fields.join(', ')}`
                    });
                  }
                }
              }
            }
          }
        }
        
        return {
          optimizations,
          description: `Applied ${optimizations.length} database optimizations`
        };
      },
      verify: async (analysis, optimization) => {
        // 等待一段时间，让优化生效
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // 重新获取性能指标
        const newAnalysis = await this.optimizers.get('database').analyze();
        
        // 比较优化前后的性能
        const improvement = {
          avgQueryTime: analysis.metrics.avgQueryTime - newAnalysis.metrics.avgQueryTime,
          slowQueries: analysis.metrics.slowQueries - newAnalysis.metrics.slowQueries,
          connectionPoolUsage: analysis.metrics.connectionPoolUsage - newAnalysis.metrics.connectionPoolUsage
        };
        
        // 计算整体改进
        const overallImprovement = 
          (improvement.avgQueryTime / analysis.metrics.avgQueryTime) * 0.5 +
          (improvement.slowQueries / Math.max(1, analysis.metrics.slowQueries)) * 0.3 +
          (improvement.connectionPoolUsage / Math.max(1, analysis.metrics.connectionPoolUsage)) * 0.2;
        
        return {
          before: analysis.metrics,
          after: newAnalysis.metrics,
          improvement,
          overallImprovement,
          success: overallImprovement > 0
        };
      },
      settings: {
        ...options
      }
    });
  }
  
  /**
   * 添加缓存优化器
   * @param {Object} cacheService 缓存服务对象
   * @param {Object} options 配置选项
   * @returns {PerformanceOptimizer} 当前实例，便于链式调用
   */
  addCacheOptimizer(cacheService, options = {}) {
    return this.addOptimizer('cache', {
      isApplicable: async () => {
        try {
          const cacheHits = this.metricsCollector.getMetric('cache_hits');
          const cacheMisses = this.metricsCollector.getMetric('cache_misses');
          return cacheHits && cacheMisses;
        } catch (error) {
          return false;
        }
      },
      analyze: async () => {
        // 获取缓存性能指标
        const hits = this.metricsCollector.getMetric('cache_hits') || 0;
        const misses = this.metricsCollector.getMetric('cache_misses') || 0;
        const size = this.metricsCollector.getMetric('cache_size') || 0;
        
        // 计算命中率
        const total = hits + misses;
        const hitRate = total > 0 ? (hits / total) * 100 : 0;
        
        // 获取热门缓存键
        let hotKeys = [];
        if (cacheService.getHotKeys) {
          hotKeys = await cacheService.getHotKeys();
        }
        
        // 获取缓存统计信息
        let stats = {};
        if (cacheService.getStats) {
          stats = await cacheService.getStats();
        }
        
        // 确定是否可以优化
        const optimizable = 
          (hitRate < options.minHitRate || 80) || // 命中率过低
          (stats.evictions && stats.evictions > options.maxEvictions || 100) || // 驱逐次数过多
          (stats.expired && stats.expired > options.maxExpired || 100); // 过期次数过多
        
        return {
          optimizable,
          metrics: {
            hits,
            misses,
            hitRate,
            size,
            evictions: stats.evictions || 0,
            expired: stats.expired || 0
          },
          hotKeys
        };
      },
      optimize: async (analysis) => {
        const optimizations = [];
        
        // 优化缓存大小
        if (analysis.metrics.evictions > (options.maxEvictions || 100)) {
          const currentMax = options.maxSize || 1000;
          const newMax = Math.min(currentMax * 1.5, 10000); // 增加缓存大小，但不超过10000
          
          if (cacheService.setMaxSize) {
            await cacheService.setMaxSize(newMax);
            optimizations.push({
              type: 'cache_size',
              before: currentMax,
              after: newMax,
              description: `Increased cache size from ${currentMax} to ${newMax}`
            });
          }
        }
        
        // 优化TTL
        if (analysis.metrics.expired > (options.maxExpired || 100)) {
          const currentTTL = options.ttl || 3600;
          const newTTL = currentTTL * 1.5; // 增加TTL时间
          
          if (cacheService.setDefaultTTL) {
            await cacheService.setDefaultTTL(newTTL);
            optimizations.push({
              type: 'cache_ttl',
              before: currentTTL,
              after: newTTL,
              description: `Increased default TTL from ${currentTTL}s to ${newTTL}s`
            });
          }
        }
        
        // 预热热门键
        if (analysis.hotKeys && analysis.hotKeys.length > 0 && analysis.metrics.hitRate < 80) {
          if (cacheService.prewarm) {
            await cacheService.prewarm(analysis.hotKeys);
            optimizations.push({
              type: 'cache_prewarm',
              keys: analysis.hotKeys.length,
              description: `Prewarmed ${analysis.hotKeys.length} hot cache keys`
            });
          }
        }
        
        return {
          optimizations,
          description: `Applied ${optimizations.length} cache optimizations`
        };
      },
      verify: async (analysis, optimization) => {
        // 等待一段时间，让优化生效
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // 重新获取性能指标
        const newAnalysis = await this.optimizers.get('cache').analyze();
        
        // 比较优化前后的性能
        const improvement = {
          hitRate: newAnalysis.metrics.hitRate - analysis.metrics.hitRate,
          evictions: analysis.metrics.evictions - newAnalysis.metrics.evictions,
          expired: analysis.metrics.expired - newAnalysis.metrics.expired
        };
        
        // 计算整体改进
        const overallImprovement = 
          (improvement.hitRate / 100) * 0.5 +
          (improvement.evictions / Math.max(1, analysis.metrics.evictions)) * 0.25 +
          (improvement.expired / Math.max(1, analysis.metrics.expired)) * 0.25;
        
        return {
          before: analysis.metrics,
          after: newAnalysis.metrics,
          improvement,
          overallImprovement,
          success: overallImprovement > 0
        };
      },
      settings: {
        ...options
      }
    });
  }
  
  /**
   * 添加队列优化器
   * @param {Object} queueManager 队列管理器对象
   * @param {Object} options 配置选项
   * @returns {PerformanceOptimizer} 当前实例，便于链式调用
   */
  addQueueOptimizer(queueManager, options = {}) {
    return this.addOptimizer('queue', {
      isApplicable: async () => {
        try {
          return !!this.metricsCollector.getMetric('queue_size');
        } catch (error) {
          return false;
        }
      },
      analyze: async () => {
        // 获取队列性能指标
        const queueSizes = {};
        const queueThroughputs = {};
        const queueLatencies = {};
        const queueErrors = {};
        
        // 获取队列列表
        let queues = [];
        if (queueManager.getQueues) {
          queues = await queueManager.getQueues();
        }
        
        // 收集每个队列的指标
        for (const queue of queues) {
          queueSizes[queue.name] = this.metricsCollector.getMetric('queue_size', { queue_name: queue.name }) || 0;
          queueThroughputs[queue.name] = this.metricsCollector.getMetric('queue_processed', { queue_name: queue.name }) || 0;
          queueLatencies[queue.name] = this.metricsCollector.getMetric('queue_processing_time', { queue_name: queue.name }) || { sum: 0, count: 0 };
          queueErrors[queue.name] = this.metricsCollector.getMetric('queue_errors', { queue_name: queue.name }) || 0;
        }
        
        // 找出性能瓶颈队列
        const bottlenecks = queues.filter(queue => {
          const size = queueSizes[queue.name] || 0;
          const throughput = queueThroughputs[queue.name] || 0;
          
          // 队列长度过长或处理速度过慢
          return size > (options.maxQueueSize || 1000) || 
                 (throughput > 0 && size / throughput > (options.maxQueueLatency || 30));
        });
        
        // 确定是否可以优化
        const optimizable = bottlenecks.length > 0;
        
        return {
          optimizable,
          metrics: {
            queueSizes,
            queueThroughputs,
            queueLatencies,
            queueErrors
          },
          bottlenecks
        };
      },
      optimize: async (analysis) => {
        const optimizations = [];
        
        // 优化每个瓶颈队列
        for (const queue of analysis.bottlenecks) {
          // 获取当前并发设置
          const currentConcurrency = queue.concurrency || 1;
          
          // 计算新的并发值
          const size = analysis.metrics.queueSizes[queue.name] || 0;
          const throughput = analysis.metrics.queueThroughputs[queue.name] || 0;
          const latency = analysis.metrics.queueLatencies[queue.name] || { sum: 0, count: 1 };
          const avgProcessingTime = latency.count > 0 ? latency.sum / latency.count : 0;
          
          // 根据队列大小和处理时间估算合适的并发数
          let newConcurrency = currentConcurrency;
          
          if (size > 0 && throughput > 0 && avgProcessingTime > 0) {
            // 目标：在30秒内处理完当前队列
            const targetThroughput = size / 30;
            const requiredConcurrency = Math.ceil(targetThroughput * (avgProcessingTime / 1000));
            newConcurrency = Math.min(Math.max(requiredConcurrency, currentConcurrency + 1), options.maxConcurrency || 20);
          } else {
            // 没有足够的指标，保守增加并发
            newConcurrency = Math.min(currentConcurrency * 1.5, options.maxConcurrency || 20);
          }
          
          if (newConcurrency > currentConcurrency) {
            // 更新并发设置
            if (queueManager.setConcurrency) {
              await queueManager.setConcurrency(queue.name, newConcurrency);
              optimizations.push({
                type: 'queue_concurrency',
                queue: queue.name,
                before: currentConcurrency,
                after: newConcurrency,
                description: `Increased queue '${queue.name}' concurrency from ${currentConcurrency} to ${newConcurrency}`
              });
            }
          }
          
          // 检查是否需要启用批处理
          if (!queue.batchEnabled && size > (options.batchThreshold || 500)) {
            if (queueManager.enableBatch) {
              const batchSize = Math.min(Math.ceil(size / 10), options.maxBatchSize || 100);
              await queueManager.enableBatch(queue.name, batchSize);
              optimizations.push({
                type: 'queue_batch',
                queue: queue.name,
                batchSize,
                description: `Enabled batch processing for queue '${queue.name}' with batch size ${batchSize}`
              });
            }
          }
        }
        
        return {
          optimizations,
          description: `Applied ${optimizations.length} queue optimizations`
        };
      },
      verify: async (analysis, optimization) => {
        // 等待一段时间，让优化生效
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // 重新获取性能指标
        const newAnalysis = await this.optimizers.get('queue').analyze();
        
        // 比较优化前后的队列大小
        const improvements = {};
        let totalImprovement = 0;
        let count = 0;
        
        for (const queue of analysis.bottlenecks) {
          const before = analysis.metrics.queueSizes[queue.name] || 0;
          const after = newAnalysis.metrics.queueSizes[queue.name] || 0;
          
          if (before > 0) {
            const queueImprovement = (before - after) / before;
            improvements[queue.name] = queueImprovement;
            totalImprovement += queueImprovement;
            count++;
          }
        }
        
        const overallImprovement = count > 0 ? totalImprovement / count : 0;
        
        return {
          before: analysis.metrics.queueSizes,
          after: newAnalysis.metrics.queueSizes,
          improvements,
          overallImprovement,
          success: overallImprovement > 0
        };
      },
      settings: {
        ...options
      }
    });
  }
  
  /**
   * 开始性能分析
   */
  startAnalysis() {
    if (this.analysisTimer) {
      return;
    }
    
    // 设置定时器定期分析
    this.analysisTimer = setInterval(() => {
      this.analyze().catch(error => {
        logger.error('Error in periodic performance analysis:', error);
      });
    }, this.analysisInterval);
    
    logger.info(`Started performance analysis with interval: ${this.analysisInterval}ms`);
  }
  
  /**
   * 停止性能分析
   */
  stopAnalysis() {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
      logger.info('Stopped performance analysis');
    }
  }
  
  /**
   * 分析系统性能
   * @returns {Promise<Object>} 分析结果
   */
  async analyze() {
    if (this.status !== OptimizationStatus.IDLE) {
      logger.debug(`Performance analysis skipped: optimizer is currently ${this.status}`);
      return null;
    }
    
    this.status = OptimizationStatus.ANALYZING;
    this.emit('status:change', this.status);
    
    try {
      logger.info('Starting performance analysis');
      
      // 收集当前系统指标作为基准
      this.currentBenchmark = {
        timestamp: Date.now(),
        analysis: {}
      };
      
      // 运行每个优化器的分析
      for (const [name, optimizer] of this.optimizers.entries()) {
        try {
          // 检查优化器是否适用
          const isApplicable = await optimizer.isApplicable();
          if (!isApplicable) {
            logger.debug(`Optimizer ${name} is not applicable, skipping`);
            continue;
          }
          
          // 运行分析
          const analysis = await optimizer.analyze();
          this.currentBenchmark.analysis[name] = analysis;
          
          logger.debug(`Analyzed ${name}: optimizable=${analysis.optimizable}`);
          this.emit('analysis:complete', {
            optimizer: name,
            analysis
          });
        } catch (error) {
          logger.error(`Error analyzing with optimizer ${name}:`, error);
          this.emit('analysis:error', {
            optimizer: name,
            error
          });
        }
      }
      
      // 检查是否需要优化
      const optimizersToRun = Object.entries(this.currentBenchmark.analysis)
        .filter(([_, analysis]) => analysis.optimizable)
        .map(([name]) => name);
      
      if (optimizersToRun.length > 0) {
        logger.info(`Performance analysis complete: ${optimizersToRun.length} optimizers can improve performance`);
        
        // 如果启用了自动优化，则立即执行优化
        if (this.automaticOptimization) {
          await this.optimize(optimizersToRun);
        } else {
          this.status = OptimizationStatus.IDLE;
          this.emit('status:change', this.status);
        }
        
        // 返回分析结果
        return {
          timestamp: this.currentBenchmark.timestamp,
          optimizersToRun,
          analysis: this.currentBenchmark.analysis
        };
      } else {
        logger.info('Performance analysis complete: no optimizations needed');
        this.status = OptimizationStatus.IDLE;
        this.emit('status:change', this.status);
        return {
          timestamp: this.currentBenchmark.timestamp,
          optimizersToRun: [],
          analysis: this.currentBenchmark.analysis
        };
      }
    } catch (error) {
      logger.error('Error during performance analysis:', error);
      this.status = OptimizationStatus.IDLE;
      this.emit('status:change', this.status);
      this.emit('analysis:error', {
        error
      });
      throw error;
    }
  }
  
  /**
   * 执行系统优化
   * @param {Array<string>} optimizerNames 要运行的优化器名称
   * @returns {Promise<Object>} 优化结果
   */
  async optimize(optimizerNames) {
    if (this.status !== OptimizationStatus.ANALYZING && this.status !== OptimizationStatus.IDLE) {
      throw new Error(`Cannot optimize: optimizer is currently ${this.status}`);
    }
    
    if (!optimizerNames || optimizerNames.length === 0) {
      throw new Error('No optimizers specified');
    }
    
    // 如果没有当前基准，先运行分析
    if (!this.currentBenchmark && this.status === OptimizationStatus.IDLE) {
      await this.analyze();
    }
    
    this.status = OptimizationStatus.OPTIMIZING;
    this.emit('status:change', this.status);
    
    try {
      logger.info(`Starting performance optimization with ${optimizerNames.length} optimizers`);
      
      const optimizationResult = {
        timestamp: Date.now(),
        results: {}
      };
      
      // 执行每个优化器的优化
      for (const name of optimizerNames) {
        try {
          const optimizer = this.optimizers.get(name);
          if (!optimizer) {
            logger.warn(`Optimizer ${name} not found, skipping`);
            continue;
          }
          
          const analysis = this.currentBenchmark.analysis[name];
          if (!analysis || !analysis.optimizable) {
            logger.debug(`Optimizer ${name} is not optimizable, skipping`);
            continue;
          }
          
          // 执行优化
          logger.info(`Running optimizer: ${name}`);
          const optimizationOutput = await optimizer.optimize(analysis);
          
          optimizationResult.results[name] = {
            analysis,
            optimization: optimizationOutput
          };
          
          this.emit('optimize:complete', {
            optimizer: name,
            result: optimizationOutput
          });
        } catch (error) {
          logger.error(`Error optimizing with ${name}:`, error);
          optimizationResult.results[name] = {
            error: error.message
          };
          this.emit('optimize:error', {
            optimizer: name,
            error
          });
        }
      }
      
      // 添加到优化历史
      this.optimizationHistory.push(optimizationResult);
      
      // 验证优化效果
      await this.verifyOptimization(optimizationResult);
      
      return optimizationResult;
    } catch (error) {
      logger.error('Error during performance optimization:', error);
      this.status = OptimizationStatus.IDLE;
      this.emit('status:change', this.status);
      this.emit('optimize:error', {
        error
      });
      throw error;
    }
  }
  
  /**
   * 验证优化效果
   * @param {Object} optimizationResult 优化结果
   * @returns {Promise<Object>} 验证结果
   */
  async verifyOptimization(optimizationResult) {
    this.status = OptimizationStatus.VERIFYING;
    this.emit('status:change', this.status);
    
    try {
      logger.info('Verifying optimization effects');
      
      const verificationResult = {
        timestamp: Date.now(),
        results: {}
      };
      
      // 验证每个优化器的效果
      for (const [name, result] of Object.entries(optimizationResult.results)) {
        try {
          if (result.error) {
            continue;
          }
          
          const optimizer = this.optimizers.get(name);
          if (!optimizer.verify) {
            continue;
          }
          
          // 执行验证
          const verification = await optimizer.verify(result.analysis, result.optimization);
          
          verificationResult.results[name] = verification;
          
          this.emit('verify:complete', {
            optimizer: name,
            result: verification
          });
          
          // 记录优化效果
          logger.info(`Optimization effect for ${name}: ${verification.success ? 'success' : 'no improvement'} (${Math.round(verification.overallImprovement * 100)}% improvement)`);
        } catch (error) {
          logger.error(`Error verifying optimization for ${name}:`, error);
          verificationResult.results[name] = {
            error: error.message
          };
          this.emit('verify:error', {
            optimizer: name,
            error
          });
        }
      }
      
      // 更新优化历史
      const historyIndex = this.optimizationHistory.indexOf(optimizationResult);
      if (historyIndex !== -1) {
        this.optimizationHistory[historyIndex].verification = verificationResult;
      }
      
      this.status = OptimizationStatus.IDLE;
      this.emit('status:change', this.status);
      
      return verificationResult;
    } catch (error) {
      logger.error('Error during optimization verification:', error);
      this.status = OptimizationStatus.IDLE;
      this.emit('status:change', this.status);
      this.emit('verify:error', {
        error
      });
      throw error;
    }
  }
  
  /**
   * 获取优化历史
   * @param {Object} options 筛选选项
   * @param {number} options.limit 限制数量
   * @returns {Array} 优化历史数组
   */
  getOptimizationHistory(options = {}) {
    let history = [...this.optimizationHistory];
    
    // 排序
    history.sort((a, b) => b.timestamp - a.timestamp);
    
    // 限制数量
    if (options.limit && options.limit > 0) {
      history = history.slice(0, options.limit);
    }
    
    return history;
  }
  
  /**
   * 获取当前性能状态
   * @returns {Object} 性能状态
   */
  getStatus() {
    return {
      status: this.status,
      lastAnalysis: this.currentBenchmark ? {
        timestamp: this.currentBenchmark.timestamp,
        optimizersToRun: Object.entries(this.currentBenchmark.analysis)
          .filter(([_, analysis]) => analysis.optimizable)
          .map(([name]) => name)
      } : null,
      lastOptimization: this.optimizationHistory.length > 0 ? 
        this.optimizationHistory[this.optimizationHistory.length - 1] : null,
      automaticOptimization: this.automaticOptimization
    };
  }
  
  /**
   * 启用自动优化
   */
  enableAutomaticOptimization() {
    this.automaticOptimization = true;
    if (!this.analysisTimer) {
      this.startAnalysis();
    }
    logger.info('Automatic performance optimization enabled');
  }
  
  /**
   * 禁用自动优化
   */
  disableAutomaticOptimization() {
    this.automaticOptimization = false;
    logger.info('Automatic performance optimization disabled');
  }
}

// 导出优化状态枚举
PerformanceOptimizer.OptimizationStatus = OptimizationStatus;

module.exports = PerformanceOptimizer;