// src/utils/queue/MessageProcessor.js

const EventEmitter = require('events');
const logger = require('../../config/logger');

class MessageProcessor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      maxRetries: 3,
      retryDelay: 1000,
      timeout: 30000,
      ...options
    };
    
    // 存储处理中的消息
    this.processingMessages = new Map();
    // 存储处理器
    this.handlers = new Map();
    // 存储超时计时器ID
    this.timeoutTimers = new Map();
  }

  /**
   * 注册消息处理器
   * @param {string} type - 消息类型
   * @param {Function} handler - 处理函数
   */
  registerHandler(type, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }
    this.handlers.set(type, handler);
    logger.info(`Handler registered for message type: ${type}`);
  }

  /**
   * 处理消息
   * @param {Object} message - 消息对象
   * @returns {Promise<any>}
   */
  async process(message) {
    const { id, type, data, attempts = 0 } = message;

    if (!id || !type) {
      throw new Error('Invalid message format: missing id or type');
    }

    // 检查是否已在处理中
    if (this.processingMessages.has(id)) {
      throw new Error(`Message ${id} is already being processed`);
    }

    // 获取处理器
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`No handler registered for message type: ${type}`);
    }

    // 记录处理开始
    this.processingMessages.set(id, {
      startTime: Date.now(),
      attempts: attempts + 1
    });

    let timeoutId = null;
    try {
      // 设置超时处理
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Processing timeout for message ${id}`));
        }, this.options.timeout);
        // 存储超时计时器ID以便清理
        this.timeoutTimers.set(id, timeoutId);
      });

      // 执行处理器
      const processingPromise = handler(data);
      const result = await Promise.race([processingPromise, timeoutPromise]);

      // 清理超时计时器
      this._clearTimeout(id);

      // 处理成功
      this.processingMessages.delete(id);
      this.emit('processed', { id, result });
      logger.info(`Message ${id} processed successfully`);
      
      return result;
    } catch (error) {
      // 清理超时计时器
      this._clearTimeout(id);

      // 处理失败
      const processingInfo = this.processingMessages.get(id) || { attempts: 1 };
      const shouldRetry = processingInfo.attempts < this.options.maxRetries;

      this.processingMessages.delete(id);
      
      if (shouldRetry) {
        // 准备重试
        const retryDelay = this.calculateRetryDelay(processingInfo.attempts);
        this.emit('retry', { 
          id, 
          error, 
          attempts: processingInfo.attempts,
          nextRetryDelay: retryDelay 
        });
        
        // 延迟后重试
        await this.delay(retryDelay);
        return this.process({
          ...message,
          attempts: processingInfo.attempts
        });
      } else {
        // 达到最大重试次数
        this.emit('failed', { id, error, attempts: processingInfo.attempts });
        throw error;
      }
    }
  }

  /**
   * 清理超时计时器
   * @param {string} messageId - 消息ID
   * @private
   */
  _clearTimeout(messageId) {
    const timeoutId = this.timeoutTimers.get(messageId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.timeoutTimers.delete(messageId);
    }
  }

  /**
   * 批量处理消息
   * @param {Array} messages - 消息数组
   * @returns {Promise<Array>}
   */
  async processBatch(messages) {
    const results = await Promise.allSettled(
      messages.map(message => this.process(message))
    );

    const summary = {
      total: messages.length,
      succeeded: 0,
      failed: 0,
      results: []
    };

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        summary.succeeded++;
        summary.results.push({
          id: messages[index].id,
          status: 'success',
          result: result.value
        });
      } else {
        summary.failed++;
        summary.results.push({
          id: messages[index].id,
          status: 'error',
          error: result.reason
        });
      }
    });

    return summary;
  }

  /**
   * 计算重试延迟时间
   * @param {number} attempts - 重试次数
   * @returns {number} - 延迟时间(ms)
   * @private
   */
  calculateRetryDelay(attempts) {
    // 使用指数退避策略
    return Math.min(
      this.options.retryDelay * Math.pow(2, attempts - 1),
      30000 // 最大延迟30秒
    );
  }

 /**
 * 延迟执行
 * @param {number} ms - 延迟时间(ms)
 * @returns {Promise<void>}
 * @private
 */
delay(ms) {
  // 在测试环境中立即解析 Promise，不实际延迟
  if (process.env.NODE_ENV === 'test') {
    return Promise.resolve();
  }
  
  return new Promise(resolve => {
    const timerId = setTimeout(resolve, ms);
    // 记录计时器 ID 以便清理
    this.delayTimers = this.delayTimers || new Set();
    this.delayTimers.add(timerId);
  });
}

  /**
   * 获取处理状态
   * @returns {Object}
   */
  getStatus() {
    return {
      processingCount: this.processingMessages.size,
      handlerTypes: Array.from(this.handlers.keys())
    };
  }

  /**
   * 清理超时的处理中消息
   * @private
   */
  cleanupTimedOutMessages() {
    const now = Date.now();
    for (const [id, info] of this.processingMessages) {
      if (now - info.startTime > this.options.timeout) {
        this._clearTimeout(id);
        this.processingMessages.delete(id);
        this.emit('timeout', { id, startTime: info.startTime });
        logger.warn(`Message ${id} processing timed out`);
      }
    }
  }

  // 添加清理延迟计时器的方法
  cleanup() {
    // 清理所有超时计时器
    for (const [id, timerId] of this.timeoutTimers) {
      clearTimeout(timerId);
    }
    this.timeoutTimers.clear();
    
    // 清理所有延迟计时器
    if (this.delayTimers) {
      for (const timerId of this.delayTimers) {
        clearTimeout(timerId);
      }
      this.delayTimers.clear();
    }
    
    this.processingMessages.clear();
  }
}

module.exports = MessageProcessor;
