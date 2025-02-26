// src/utils/cache.js
const Redis = require('ioredis');
const logger = require('../config/logger');

// 创建Redis客户端
const redisClient = new Redis({
    // 基础配置
    host: process.env.REDIS_HOST || 'localhost',  // Redis服务器地址
    port: process.env.REDIS_PORT || 6379,         // Redis端口号
    password: process.env.REDIS_PASSWORD || null,  // Redis密码(如果有的话)
    
    // 重试策略：连接失败时如何重试
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000); // 重试延迟，最大2秒
        return delay;
    }
});

// Redis连接事件监听
redisClient.on('connect', () => {
    logger.info('Redis连接成功');
});

redisClient.on('error', (err) => {
    logger.error('Redis连接错误:', err);
});

// 导出基本的缓存操作方法
module.exports = {
    // 设置缓存
    async set(key, value, expireTime = 3600) {
        try {
            // 将值转换为JSON字符串存储
            await redisClient.set(key, JSON.stringify(value), 'EX', expireTime);
        } catch (error) {
            logger.error('缓存设置错误:', error);
            throw error;
        }
    },

    // 获取缓存
    async get(key) {
        try {
            const data = await redisClient.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            logger.error('缓存获取错误:', error);
            throw error;
        }
    },

    // 删除缓存
    async del(key) {
        try {
            await redisClient.del(key);
        } catch (error) {
            logger.error('缓存删除错误:', error);
            throw error;
        }
    },

    // 设置带有过期时间的缓存
    async setWithExpiry(key, value, seconds) {
        try {
            await redisClient.set(key, JSON.stringify(value), 'EX', seconds);
        } catch (error) {
            logger.error('设置过期缓存错误:', error);
            throw error;
        }
    }
};