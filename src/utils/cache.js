// src/utils/cache.js
const Redis = require('ioredis');
const logger = require('../config/logger');
const CacheKeyGenerator = require('./CacheKeyGenerator');
const cacheLock = require('./CacheLock');  // 添加这一行

class CacheService {
  constructor() {
    // 创建 Redis 客户端
    this.redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || null,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });

    // 创建缓存键生成器实例
    this.keyGenerator = new CacheKeyGenerator();

    // Redis 连接事件监听
    this.redisClient.on('connect', () => {
      logger.info('Redis连接成功');
    });

    this.redisClient.on('error', (err) => {
      logger.error('Redis连接错误:', err);
    });
  }

  /**
   * 生成标准化的缓存键
   * @param {string} entity - 实体类型（如：user, order）
   * @param {string} operation - 操作类型（如：profile, list）
   * @param {string} identifier - 唯一标识符
   * @param {string} [version] - 版本号（可选）
   * @returns {string} 格式化的缓存键
   */
  generateKey(entity, operation, identifier, version) {
    return this.keyGenerator.generate({ entity, operation, identifier, version });
  }

  /**
   * 设置缓存
   * @param {string} entity - 实体类型
   * @param {string} operation - 操作类型
   * @param {string} identifier - 唯一标识符
   * @param {*} value - 缓存值
   * @param {number} [expireTime=3600] - 过期时间（秒）
   */
  async set(entity, operation, identifier, value, expireTime = 3600) {
    const key = this.generateKey(entity, operation, identifier);
    try {
      await this.redisClient.set(key, JSON.stringify(value), 'EX', expireTime);
    } catch (error) {
      logger.error('缓存设置错误:', error);
      throw error;
    }
  }

  /**
   * 获取缓存
   * @param {string} entity - 实体类型
   * @param {string} operation - 操作类型
   * @param {string} identifier - 唯一标识符
   * @returns {Promise<*>} 缓存值
   */
  async get(entity, operation, identifier) {
    const key = this.generateKey(entity, operation, identifier);
    try {
      const data = await this.redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error('缓存获取错误:', error);
      throw error;
    }
  }

  /**
   * 删除缓存
   * @param {string} entity - 实体类型
   * @param {string} operation - 操作类型
   * @param {string} identifier - 唯一标识符
   */
  async del(entity, operation, identifier) {
    const key = this.generateKey(entity, operation, identifier);
    try {
      await this.redisClient.del(key);
    } catch (error) {
      logger.error('缓存删除错误:', error);
      throw error;
    }
  }

  /**
   * 设置带有过期时间的缓存（保持向后兼容）
   * @deprecated 使用 set 方法代替
   */
  async setWithExpiry(key, value, seconds) {
    try {
      await this.redisClient.set(key, JSON.stringify(value), 'EX', seconds);
    } catch (error) {
      logger.error('设置过期缓存错误:', error);
      throw error;
    }
  }

  /**
   * 检查缓存是否存在
   * @param {string} entity - 实体类型
   * @param {string} operation - 操作类型
   * @param {string} identifier - 唯一标识符
   * @returns {Promise<boolean>} 是否存在
   */
  async exists(entity, operation, identifier) {
    const key = this.generateKey(entity, operation, identifier);
    try {
      const exists = await this.redisClient.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error('检查缓存存在错误:', error);
      throw error;
    }
  }

  /**
   * 批量获取缓存
   * @param {Array<{entity: string, operation: string, identifier: string}>} keys
   * @returns {Promise<Array>} 缓存值数组
   */
  async mget(keys) {
    try {
      const redisKeys = keys.map(({ entity, operation, identifier }) =>
        this.generateKey(entity, operation, identifier)
      );
      const results = await this.redisClient.mget(redisKeys);
      return results.map(item => (item ? JSON.parse(item) : null));
    } catch (error) {
      logger.error('批量获取缓存错误:', error);
      throw error;
    }
  }

  /**
   * 获取缓存剩余过期时间（秒）
   * @param {string} entity - 实体类型
   * @param {string} operation - 操作类型
   * @param {string} identifier - 唯一标识符
   * @returns {Promise<number>} 剩余秒数，-1表示永久，-2表示不存在
   */
  async ttl(entity, operation, identifier) {
    const key = this.generateKey(entity, operation, identifier);
    try {
      return await this.redisClient.ttl(key);
    } catch (error) {
      logger.error('获取过期时间错误:', error);
      throw error;
    }
  }


  /**
   * 带击穿保护的获取缓存
   * @param {string} entity - 实体类型
   * @param {string} operation - 操作类型
   * @param {string} identifier - 唯一标识符
   * @param {Function} fallback - 当缓存不存在时的回调函数
   * @param {number} [expireTime=3600] - 缓存过期时间
   */
  async getWithProtection(entity, operation, identifier, fallback, expireTime = 3600) {
    const cacheKey = this.generateKey(entity, operation, identifier);
    
    // 尝试从缓存获取
    let data = await this.get(entity, operation, identifier);
    if (data) {
      return data;
    }

    // 尝试获取锁
    const locked = await cacheLock.acquire(cacheKey);
    if (!locked) {
      // 未获取到锁，等待100ms后重试
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.getWithProtection(entity, operation, identifier, fallback, expireTime);
    }

    try {
      // 双重检查，避免其他进程已经写入缓存
      data = await this.get(entity, operation, identifier);
      if (data) {
        return data;
      }

      // 执行回调获取数据
      data = await fallback();
      
      // 写入缓存
      await this.set(entity, operation, identifier, data, expireTime);
      
      return data;
    } finally {
      // 释放锁
      await cacheLock.release(cacheKey);
    }
  }
}

// 导出单例实例
module.exports = new CacheService();