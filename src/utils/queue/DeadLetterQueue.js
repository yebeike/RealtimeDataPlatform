// src/utils/queue/DeadLetterQueue.js

const Queue = require('./Queue');
const logger = require('../../config/logger');

class DeadLetterQueue {
  constructor(options = {}) {
    this.options = {
      queueName: 'dead-letter-queue',
      retryInterval: 1000 * 60 * 30, // 30分钟后重试
      maxRetries: 3,
      ttl: 1000 * 60 * 60 * 24 * 7, // 7天过期
      ...options
    };

    this.queue = new Queue(this.options.queueName, {
      defaultJobOptions: {
        removeOnComplete: false, // 不自动删除完成的任务
        attempts: 1 // 死信队列的任务默认不重试
      }
    });

    // 存储定时器ID以便清理
    this.cleanupTimerId = null;
    
    // 初始化定时清理任务
    this._initCleanupTask();
  }

  /**
   * 添加失败消息到死信队列
   * @param {Object} message - 原始消息
   * @param {Error} error - 失败原因
   * @param {Object} context - 上下文信息
   * @returns {Promise<void>}
   */
  async addFailedMessage(message, error, context = {}) {
    const deadLetterMessage = {
      originalMessage: message,
      error: {
        message: error.message,
        stack: error.stack
      },
      context: {
        failedAt: new Date(),
        originalQueue: context.queueName,
        attempts: context.attempts || 0,
        ...context
      },
      meta: {
        addedAt: new Date(),
        retryCount: 0,
        nextRetryAt: this._calculateNextRetryTime()
      }
    };

    try {
      await this.queue.add(deadLetterMessage, {
        jobId: `dlq:${message.id}`,
        removeOnComplete: false
      });
      
      logger.info(`Message ${message.id} added to dead letter queue`, {
        error: error.message,
        context
      });
    } catch (err) {
      logger.error(`Failed to add message ${message.id} to dead letter queue:`, err);
      throw err;
    }
  }

  /**
   * 重试死信队列中的消息
   * @param {string} messageId - 消息ID
   * @param {Object} options - 重试选项
   * @returns {Promise<boolean>}
   */
  async retryMessage(messageId, options = {}) {
    try {
      const job = await this.queue.getJob(`dlq:${messageId}`);
      if (!job) {
        throw new Error(`Message ${messageId} not found in dead letter queue`);
      }

      const deadLetterMessage = job.data;
      
      // 防御性处理，确保 originalMessage 存在
      if (!deadLetterMessage.originalMessage) {
        throw new Error(`Invalid dead letter message structure: missing originalMessage`);
      }
      
      // 防御性处理，确保 meta 对象存在
      if (!deadLetterMessage.meta) {
        deadLetterMessage.meta = { retryCount: 0 };
      }
      
      const { originalMessage, meta } = deadLetterMessage;
      
      // 确保 retryCount 存在
      if (meta.retryCount === undefined) {
        meta.retryCount = 0;
      }

      // 检查重试次数
      if (meta.retryCount >= this.options.maxRetries) {
        logger.warn(`Message ${messageId} has exceeded max retry attempts`);
        return false;
      }

      // 更新重试信息
      meta.retryCount++;
      meta.lastRetryAt = new Date();
      meta.nextRetryAt = this._calculateNextRetryTime(meta.retryCount);

      // 防御性处理，确保 context 和 originalQueue 存在
      if (!deadLetterMessage.context) {
        deadLetterMessage.context = { originalQueue: 'default-queue' };
      } else if (!deadLetterMessage.context.originalQueue) {
        deadLetterMessage.context.originalQueue = 'default-queue';
      }

      // 发送到原始队列重试
      const targetQueue = new Queue(deadLetterMessage.context.originalQueue);
      await targetQueue.add(originalMessage, {
        ...options,
        attempts: 1 // 重试时只尝试一次
      });

      // 更新死信队列中的消息状态
      await job.update({
        ...deadLetterMessage,
        meta
      });

      logger.info(`Message ${messageId} retry attempt ${meta.retryCount} initiated`);
      return true;
    } catch (error) {
      logger.error(`Failed to retry message ${messageId}:`, error);
      throw error;
    }
  }

  /**
   * 批量重试死信队列中的消息
   * @param {Object} filters - 过滤条件
   * @returns {Promise<Object>}
   */
  async retryBatch(filters = {}) {
    try {
      const jobs = await this.queue.queue.getJobs(['waiting', 'failed']);
      const results = {
        total: jobs.length,
        succeeded: 0,
        failed: 0,
        skipped: 0
      };

      for (const job of jobs) {
        // 防御性检查，确保 job.data 和 originalMessage 存在
        if (!job.data || !job.data.originalMessage || !job.data.originalMessage.id) {
          results.skipped++;
          continue;
        }
        
        const messageId = job.data.originalMessage.id;
        try {
          // 应用过滤条件
          if (this._shouldSkipRetry(job.data, filters)) {
            results.skipped++;
            continue;
          }

          const retried = await this.retryMessage(messageId);
          if (retried) {
            results.succeeded++;
          } else {
            results.skipped++;
          }
        } catch (error) {
          results.failed++;
          logger.error(`Failed to retry message ${messageId} in batch:`, error);
        }
      }

      logger.info('Batch retry completed', results);
      return results;
    } catch (error) {
      logger.error('Failed to execute batch retry:', error);
      throw error;
    }
  }

  /**
   * 获取死信队列状态
   * @returns {Promise<Object>}
   */
  async getStatus() {
    try {
      const status = await this.queue.getStatus();
      const jobs = await this.queue.queue.getJobs(['waiting', 'failed']);

      const stats = {
        ...status,
        messagesByAge: {
          last24h: 0,
          last7d: 0,
          older: 0
        }
      };

      const now = Date.now();
      jobs.forEach(job => {
        const age = now - job.timestamp;
        if (age < 24 * 60 * 60 * 1000) {
          stats.messagesByAge.last24h++;
        } else if (age < 7 * 24 * 60 * 60 * 1000) {
          stats.messagesByAge.last7d++;
        } else {
          stats.messagesByAge.older++;
        }
      });

      return stats;
    } catch (error) {
      logger.error('Failed to get dead letter queue status:', error);
      throw error;
    }
  }

  /**
   * 清理过期消息
   * @private
   */
  async _cleanupExpiredMessages() {
    try {
      const jobs = await this.queue.queue.getJobs(['waiting', 'failed']);
      const now = Date.now();
      let cleaned = 0;

      for (const job of jobs) {
        const age = now - job.timestamp;
        if (age > this.options.ttl) {
          await job.remove();
          cleaned++;
        }
      }

      if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} expired messages from dead letter queue`);
      }
    } catch (error) {
      logger.error('Failed to cleanup expired messages:', error);
    }
  }

  /**
   * 初始化定时清理任务
   * @private
   */
  _initCleanupTask() {
    // 只在非测试环境启动定时任务
    if (process.env.NODE_ENV !== 'test') {
      // 每天执行一次清理
      this.cleanupTimerId = setInterval(() => {
        this._cleanupExpiredMessages();
      }, 24 * 60 * 60 * 1000);
    }
  }

  /**
   * 计算下次重试时间
   * @param {number} retryCount - 重试次数
   * @returns {Date}
   * @private
   */
  _calculateNextRetryTime(retryCount = 0) {
    const delay = this.options.retryInterval * Math.pow(2, retryCount);
    return new Date(Date.now() + delay);
  }

  /**
   * 检查是否应该跳过重试
   * @param {Object} messageData - 消息数据
   * @param {Object} filters - 过滤条件
   * @returns {boolean}
   * @private
   */
  _shouldSkipRetry(messageData, filters) {
    // 防御性检查
    if (!messageData || !messageData.meta) {
      return true;
    }
    
    if (!filters || Object.keys(filters).length === 0) {
      return false;
    }

    // 实现过滤逻辑
    if (filters.minAge && messageData.meta.addedAt && 
        (Date.now() - new Date(messageData.meta.addedAt).getTime()) < filters.minAge) {
      return true;
    }

    if (filters.maxRetries && messageData.meta.retryCount >= filters.maxRetries) {
      return true;
    }

    if (filters.queueName && messageData.context && 
        messageData.context.originalQueue !== filters.queueName) {
      return true;
    }

    return false;
  }

  /**
   * 关闭死信队列并清理资源
   * @returns {Promise<void>}
   */
  async close() {
    // 清理定时器
    if (this.cleanupTimerId) {
      clearInterval(this.cleanupTimerId);
      this.cleanupTimerId = null;
    }
    
    // 关闭队列
    if (this.queue) {
      return this.queue.close();
    }
  }
}

module.exports = DeadLetterQueue;
