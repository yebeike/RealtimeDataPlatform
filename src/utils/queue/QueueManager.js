// src/utils/queue/QueueManager.js

const Bull = require('bull');
const logger = require('../../config/logger');

class QueueManager {
  constructor() {
    // 存储所有队列实例
    this.queues = new Map();
    // 存储队列配置信息
    this.queueConfigs = new Map();
    // 存储队列处理器
    this.processors = new Map();
  }

  /**
   * 创建新的队列
   * @param {string} name - 队列名称
   * @param {Object} options - 队列配置选项
   * @param {Function} processor - 消息处理函数
   * @returns {Bull.Queue} - 返回创建的队列实例
   */
  createQueue(name, options = {}, processor = null) {
    if (this.queues.has(name)) {
      logger.warn(`Queue ${name} already exists`);
      return this.queues.get(name);
    }

    // 合并默认配置和自定义配置
    const queueOptions = {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || null
      },
      defaultJobOptions: {
        removeOnComplete: true, // 完成后删除任务
        attempts: 3, // 默认重试3次
        backoff: {
          type: 'exponential',
          delay: 1000
        }
      },
      ...options
    };

    try {
      // 创建Bull队列实例
      const queue = new Bull(name, queueOptions);
      
      // 设置全局错误处理
      queue.on('error', error => {
        logger.error(`Queue ${name} error:`, error);
      });

      // 设置任务完成处理
      queue.on('completed', (job, result) => {
        logger.info(`Job ${job.id} in queue ${name} completed`, { result });
      });

      // 设置任务失败处理
      queue.on('failed', (job, error) => {
        logger.error(`Job ${job.id} in queue ${name} failed:`, error);
      });

      // 存储队列实例和配置
      this.queues.set(name, queue);
      this.queueConfigs.set(name, queueOptions);

      // 如果提供了处理器，则设置处理器
      if (processor) {
        this.setProcessor(name, processor);
      }

      logger.info(`Queue ${name} created successfully`);
      return queue;
    } catch (error) {
      logger.error(`Failed to create queue ${name}:`, error);
      throw error;
    }
  }

  /**
   * 设置队列处理器
   * @param {string} name - 队列名称
   * @param {Function} processor - 处理器函数
   */
  setProcessor(name, processor) {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue ${name} not found`);
    }

    // 移除旧的处理器
    if (this.processors.has(name)) {
      queue.removeAllListeners('global:completed');
      queue.removeAllListeners('global:failed');
    }

    // 设置新的处理器
    queue.process(async (job) => {
      try {
        return await processor(job.data);
      } catch (error) {
        logger.error(`Error processing job ${job.id} in queue ${name}:`, error);
        throw error;
      }
    });

    this.processors.set(name, processor);
    logger.info(`Processor set for queue ${name}`);
  }

  /**
   * 添加任务到队列
   * @param {string} name - 队列名称
   * @param {*} data - 任务数据
   * @param {Object} options - 任务选项
   * @returns {Promise<Bull.Job>} - 返回创建的任务
   */
  async addJob(name, data, options = {}) {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue ${name} not found`);
    }

    try {
      const job = await queue.add(data, options);
      logger.info(`Job ${job.id} added to queue ${name}`);
      return job;
    } catch (error) {
      logger.error(`Failed to add job to queue ${name}:`, error);
      throw error;
    }
  }

  /**
   * 批量添加任务
   * @param {string} name - 队列名称
   * @param {Array} jobs - 任务数据数组
   * @returns {Promise<Bull.Job[]>} - 返回创建的任务数组
   */
  async addBulkJobs(name, jobs) {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue ${name} not found`);
    }

    try {
      const addedJobs = await queue.addBulk(jobs);
      logger.info(`Added ${jobs.length} jobs to queue ${name}`);
      return addedJobs;
    } catch (error) {
      logger.error(`Failed to add bulk jobs to queue ${name}:`, error);
      throw error;
    }
  }

  /**
   * 获取队列状态
   * @param {string} name - 队列名称
   * @returns {Promise<Object>} - 返回队列状态信息
   */
  async getQueueStatus(name) {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue ${name} not found`);
    }

    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount()
      ]);

      return {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + completed + failed + delayed
      };
    } catch (error) {
      logger.error(`Failed to get status for queue ${name}:`, error);
      throw error;
    }
  }

  /**
   * 获取所有队列状态
   * @returns {Promise<Object>} - 返回所有队列状态信息
   */
  async getAllQueuesStatus() {
    const statusPromises = Array.from(this.queues.keys()).map(async (name) => {
      const status = await this.getQueueStatus(name);
      return { name, status };
    });

    try {
      return await Promise.all(statusPromises);
    } catch (error) {
      logger.error('Failed to get status for all queues:', error);
      throw error;
    }
  }

  /**
   * 清空队列
   * @param {string} name - 队列名称
   */
  async clearQueue(name) {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue ${name} not found`);
    }

    try {
      await queue.empty();
      logger.info(`Queue ${name} cleared`);
    } catch (error) {
      logger.error(`Failed to clear queue ${name}:`, error);
      throw error;
    }
  }

  /**
   * 暂停队列
   * @param {string} name - 队列名称
   */
  async pauseQueue(name) {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue ${name} not found`);
    }

    try {
      await queue.pause();
      logger.info(`Queue ${name} paused`);
    } catch (error) {
      logger.error(`Failed to pause queue ${name}:`, error);
      throw error;
    }
  }

  /**
   * 恢复队列
   * @param {string} name - 队列名称
   */
  async resumeQueue(name) {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue ${name} not found`);
    }

    try {
      await queue.resume();
      logger.info(`Queue ${name} resumed`);
    } catch (error) {
      logger.error(`Failed to resume queue ${name}:`, error);
      throw error;
    }
  }

  /**
   * 关闭队列
   * @param {string} name - 队列名称
   */
  async closeQueue(name) {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue ${name} not found`);
    }

    try {
      // 移除所有事件监听器
      queue.removeAllListeners();
      
      // 关闭队列
      await queue.close();
      
      // 从管理器中移除队列
      this.queues.delete(name);
      this.queueConfigs.delete(name);
      this.processors.delete(name);
      
      logger.info(`Queue ${name} closed`);
    } catch (error) {
      logger.error(`Failed to close queue ${name}:`, error);
      throw error;
    }
  }

  /**
   * 关闭所有队列
   */
  async closeAll() {
    const closePromises = Array.from(this.queues.keys()).map(name => 
      this.closeQueue(name)
    );
    
    try {
      await Promise.all(closePromises);
      logger.info('All queues closed');
    } catch (error) {
      logger.error('Failed to close all queues:', error);
      throw error;
    }
  }

  /**
   * 获取特定队列
   * @param {string} name - 队列名称
   * @returns {Bull.Queue|null} - 返回队列实例或null
   */
  getQueue(name) {
    return this.queues.get(name) || null;
  }

  /**
   * 获取所有队列名称
   * @returns {Array<string>} - 返回所有队列名称
   */
  getQueueNames() {
    return Array.from(this.queues.keys());
  }
}

// 导出单例
module.exports = new QueueManager();
