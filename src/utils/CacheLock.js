// src/utils/CacheLock.js
const Redis = require('ioredis');
const logger = require('../config/logger');

class CacheLock {
    constructor() {
        this.redisClient = new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: process.env.REDIS_PORT || 6379,
          password: process.env.REDIS_PASSWORD || null,
        });
        this.lockPrefix = 'lock:';
        this.defaultLockTime = 10;
    
        this.redisClient.on('error', (err) => {
          logger.error('Redis Lock连接错误:', err);
        });
      }

  /**
   * 尝试获取锁
   * @param {string} key - 锁的键名
   * @param {number} [ttl=10] - 锁的过期时间(秒)
   * @returns {Promise<boolean>} 是否获取到锁
   */
  async acquire(key, ttl = this.defaultLockTime) {
    const lockKey = this.getLockKey(key);
    try {
      // SET key value NX EX seconds - 仅在键不存在时设置
      const result = await this.redisClient.set(lockKey, '1', 'NX', 'EX', ttl);
      return result === 'OK';
    } catch (error) {
      logger.error('获取锁失败:', error);
      return false;
    }
  }

  /**
   * 释放锁
   * @param {string} key - 锁的键名
   */
  async release(key) {
    const lockKey = this.getLockKey(key);
    try {
      await this.redisClient.del(lockKey);
    } catch (error) {
      logger.error('释放锁失败:', error);
    }
  }

  /**
   * 获取锁的键名
   * @private
   */
  getLockKey(key) {
    return `${this.lockPrefix}${key}`;
  }
}

module.exports = new CacheLock();