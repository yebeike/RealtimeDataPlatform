/**
 * 实时数据处理器
 * 提供数据处理管道，支持数据转换和处理
 */

const EventEmitter = require('events');
const logger = require('../../config/logger');

class DataProcessor extends EventEmitter {
  /**
   * 创建数据处理器实例
   * @param {Object} options - 配置选项
   */
  constructor(options = {}) {
    super();
    
    this.options = {
      concurrency: 5,      // 默认并发数
      batchSize: 100,      // 默认批处理大小
      timeout: 30000,      // 默认超时时间(ms)
      ...options
    };
    
    this.transformers = new Map(); // 存储转换器
    this.processors = new Map();   // 存储处理器
    this.pipeline = [];            // 处理管道配置
    this.metrics = {               // 性能指标
      processed: 0,
      failed: 0,
      processingTime: []
    };
    
    logger.info('DataProcessor initialized with options:', this.options);
  }
  
  /**
   * 注册数据转换器
   * @param {string} name - 转换器名称
   * @param {Function} transformer - 转换器函数
   * @returns {DataProcessor} - 返回自身，支持链式调用
   */
  registerTransformer(name, transformer) {
    if (typeof transformer !== 'function') {
      throw new Error('Transformer must be a function');
    }
    this.transformers.set(name, transformer);
    logger.info(`Transformer "${name}" registered`);
    return this;
  }
  
  /**
   * 注册数据处理器
   * @param {string} name - 处理器名称
   * @param {Function} processor - 处理器函数
   * @returns {DataProcessor} - 返回自身，支持链式调用
   */
  registerProcessor(name, processor) {
    if (typeof processor !== 'function') {
      throw new Error('Processor must be a function');
    }
    this.processors.set(name, processor);
    logger.info(`Processor "${name}" registered`);
    return this;
  }
  
  /**
   * 构建处理管道
   * @param {Array<Object>} steps - 处理步骤配置
   * @returns {DataProcessor} - 返回自身，支持链式调用
   */
  buildPipeline(steps) {
    if (!Array.isArray(steps)) {
      throw new Error('Steps must be an array');
    }
    
    this.pipeline = steps.map(step => {
      const { type, name, config = {}, errorHandler } = step;
      
      if (type === 'transformer') {
        const transformer = this.transformers.get(name);
        if (!transformer) {
          throw new Error(`Transformer "${name}" not found`);
        }
        return { 
          type,
          name,
          execute: async data => transformer(data, config),
          errorHandler
        };
      }
      
      if (type === 'processor') {
        const processor = this.processors.get(name);
        if (!processor) {
          throw new Error(`Processor "${name}" not found`);
        }
        return { 
          type,
          name,
          execute: async data => processor(data, config),
          errorHandler
        };
      }
      
      throw new Error(`Invalid step type: ${type}`);
    });
    
    logger.info(`Pipeline built with ${this.pipeline.length} steps`);
    return this;
  }
  
  /**
   * 处理单条数据
   * @param {any} data - 要处理的数据
   * @returns {Promise<any>} - 处理后的数据
   */
  async processItem(data) {
    const startTime = Date.now();
    let current = data;
    
    try {
      // 按顺序执行管道中的每个步骤
      for (const step of this.pipeline) {
        try {
          current = await step.execute(current);
          
          // 如果返回null或undefined，终止处理
          if (current === null || current === undefined) {
            logger.debug(`Step "${step.name}" returned null/undefined, stopping pipeline`);
            break;
          }
        } catch (error) {
          // 如果步骤有错误处理函数，调用它
          if (typeof step.errorHandler === 'function') {
            logger.debug(`Error in step "${step.name}", calling custom error handler`);
            current = await step.errorHandler(error, current);
            
            // 如果错误处理返回null或undefined，终止处理
            if (current === null || current === undefined) {
              logger.debug(`Error handler for "${step.name}" returned null/undefined, stopping pipeline`);
              break;
            }
          } else {
            // 否则重新抛出错误
            throw error;
          }
        }
      }
      
      const processingTime = Date.now() - startTime;
      this.metrics.processed++;
      this.metrics.processingTime.push(processingTime);
      
      this.emit('itemProcessed', {
        success: true,
        processingTime,
        result: current
      });
      
      return current;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.metrics.failed++;
      
      this.emit('itemProcessed', {
        success: false,
        processingTime,
        error,
        data
      });
      
      throw error;
    }
  }
  
  /**
   * 批量处理数据
   * @param {Array<any>} items - 要处理的数据数组
   * @returns {Promise<Array<Object>>} - 处理结果数组
   */
  async processBatch(items) {
    if (!Array.isArray(items)) {
      throw new Error('Items must be an array');
    }
    
    logger.info(`Processing batch of ${items.length} items`);
    
    if (this.options.concurrency === 1) {
      // 串行处理
      const results = [];
      for (const item of items) {
        try {
          const result = await this.processItem(item);
          results.push({ status: 'success', data: result });
        } catch (error) {
          results.push({ status: 'error', error, data: item });
        }
      }
      return results;
    } else {
      // 并行处理（有并发限制）
      const batchResults = [];
      // 将items分成多个批次，每批次最多concurrency个
      for (let i = 0; i < items.length; i += this.options.concurrency) {
        const batch = items.slice(i, i + this.options.concurrency);
        const batchPromises = batch.map(item => 
          this.processItem(item)
            .then(result => ({ status: 'success', data: result }))
            .catch(error => ({ status: 'error', error, data: item }))
        );
        
        // 等待当前批次完成
        const results = await Promise.all(batchPromises);
        batchResults.push(...results);
      }
      
      return batchResults;
    }
  }
  
  /**
   * 获取处理指标
   * @returns {Object} - 性能指标对象
   */
  getMetrics() {
    const processingTimes = this.metrics.processingTime;
    return {
      processed: this.metrics.processed,
      failed: this.metrics.failed,
      averageProcessingTime: processingTimes.length ? 
        processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length : 0,
      minProcessingTime: processingTimes.length ? Math.min(...processingTimes) : 0,
      maxProcessingTime: processingTimes.length ? Math.max(...processingTimes) : 0
    };
  }
  
  /**
   * 重置性能指标
   */
  resetMetrics() {
    this.metrics = {
      processed: 0,
      failed: 0,
      processingTime: []
    };
    logger.info('DataProcessor metrics reset');
  }
}

module.exports = DataProcessor;
