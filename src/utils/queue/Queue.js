// src/utils/queue/Queue.js

const Bull = require('bull');
const logger = require('../../config/logger');

class Queue {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
    this._init();
    // 保存处理器引用以便清理
    this.processor = null;
  }

  /**
   * 初始化队列
   * @private
   */
  _init() {
    try {
      this.queue = new Bull(this.name, this.options);
      this._setupListeners();
      logger.info(`Queue ${this.name} initialized`);
    } catch (error) {
      logger.error(`Failed to initialize queue ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * 设置事件监听器
   * @private
   */
  _setupListeners() {
    // 监听队列事件
    this.queue.on('error', error => {
      logger.error(`Queue ${this.name} encountered error:`, error);
    });

    this.queue.on('waiting', jobId => {
      logger.debug(`Job ${jobId} is waiting in queue ${this.name}`);
    });

    this.queue.on('active', job => {
      logger.debug(`Job ${job.id} has started processing in queue ${this.name}`);
    });

    this.queue.on('completed', (job, result) => {
      logger.info(`Job ${job.id} completed in queue ${this.name}`, { result });
    });

    this.queue.on('failed', (job, error) => {
      logger.error(`Job ${job.id} failed in queue ${this.name}:`, error);
    });

    this.queue.on('stalled', job => {
      logger.warn(`Job ${job.id} has stalled in queue ${this.name}`);
    });
  }

  /**
   * 添加任务到队列
   * @param {*} data - 任务数据
   * @param {Object} jobOptions - 任务选项
   * @returns {Promise<Bull.Job>}
   */
  async add(data, jobOptions = {}) {
    try {
      const job = await this.queue.add(data, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000
        },
        removeOnComplete: true,
        ...jobOptions
      });

      logger.info(`Job ${job.id} added to queue ${this.name}`);
      return job;
    } catch (error) {
      logger.error(`Failed to add job to queue ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * 批量添加任务
   * @param {Array} jobs - 任务数组
   * @returns {Promise<Bull.Job[]>}
   */
  async addBulk(jobs) {
    try {
      const addedJobs = await this.queue.addBulk(jobs);
      logger.info(`Added ${jobs.length} jobs to queue ${this.name}`);
      return addedJobs;
    } catch (error) {
      logger.error(`Failed to add bulk jobs to queue ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * 设置任务处理器
   * @param {Function} processor - 处理函数
   * @param {number} concurrency - 并发数
   */
  setProcessor(processor, concurrency = 1) {
    try {
      // 先移除之前的处理器
      if (this.processor) {
        this.queue.removeAllListeners('global:completed');
        this.queue.removeAllListeners('global:failed');
      }
      
      // 保存处理器引用
      this.processor = processor;
      
      // 设置新的处理器
      this.queue.process(concurrency, async (job) => {
        logger.debug(`Processing job ${job.id} in queue ${this.name}`);
        try {
          return await processor(job);
        } catch (error) {
          logger.error(`Error processing job ${job.id} in queue ${this.name}:`, error);
          throw error;
        }
      });
      
      logger.info(`Processor set for queue ${this.name} with concurrency ${concurrency}`);
    } catch (error) {
      logger.error(`Failed to set processor for queue ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * 获取任务
   * @param {string} jobId - 任务ID
   * @returns {Promise<Bull.Job>}
   */
  async getJob(jobId) {
    try {
      const job = await this.queue.getJob(jobId);
      if (!job) {
        logger.warn(`Job ${jobId} not found in queue ${this.name}`);
      }
      return job;
    } catch (error) {
      logger.error(`Failed to get job ${jobId} from queue ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * 移除任务
   * @param {string} jobId - 任务ID
   */
  async removeJob(jobId) {
    try {
      const job = await this.getJob(jobId);
      if (job) {
        await job.remove();
        logger.info(`Job ${jobId} removed from queue ${this.name}`);
      }
    } catch (error) {
      logger.error(`Failed to remove job ${jobId} from queue ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * 暂停队列
   */
  async pause() {
    try {
      await this.queue.pause();
      logger.info(`Queue ${this.name} paused`);
    } catch (error) {
      logger.error(`Failed to pause queue ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * 恢复队列
   */
  async resume() {
    try {
      await this.queue.resume();
      logger.info(`Queue ${this.name} resumed`);
    } catch (error) {
      logger.error(`Failed to resume queue ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * 获取队列状态
   * @returns {Promise<Object>}
   */
  async getStatus() {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount()
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
      logger.error(`Failed to get status for queue ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * 清空队列
   */
  async clear() {
    try {
      await this.queue.empty();
      logger.info(`Queue ${this.name} cleared`);
    } catch (error) {
      logger.error(`Failed to clear queue ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * 关闭队列
   */
  async close() {
    try {
      // 移除所有事件监听器
      this.queue.removeAllListeners();
      
      // 关闭队列连接
      await this.queue.close();
      logger.info(`Queue ${this.name} closed`);
    } catch (error) {
      logger.error(`Failed to close queue ${this.name}:`, error);
      throw error;
    }
  }
}

module.exports = Queue;
