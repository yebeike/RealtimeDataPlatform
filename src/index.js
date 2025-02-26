const mongoose = require('mongoose');
const app = require('./app');
const config = require('./config/config');
const logger = require('./config/logger');
const cache = require('./utils/cache');
const { QueueManager } = require('./utils/queue'); // 引入队列管理器

let server;

async function initializeQueues() {
    try {
        // 创建默认队列示例
        await QueueManager.createQueue('default', {
            defaultJobOptions: {
                removeOnComplete: true,
                attempts: 3
            }
        });

        // 可以在这里创建其他需要的队列
        await QueueManager.createQueue('high-priority', {
            defaultJobOptions: {
                priority: 1,
                removeOnComplete: true,
                attempts: 5
            }
        });

        logger.info('消息队列初始化成功');
    } catch (error) {
        logger.error('消息队列初始化失败:', error);
        throw error; // 如果队列初始化失败，可能需要终止应用启动
    }
}

async function main() {
    try {
        // MongoDB连接
        await mongoose.connect(config.mongoose.url, config.mongoose.options);
        logger.info('MongoDB连接成功');

        // Redis连接测试
        try {
            await cache.testConnection();
            logger.info('Redis连接测试成功');

            // 初始化消息队列
            await initializeQueues();
        } catch (error) {
            logger.error('Redis/队列初始化失败:', error);
            // 继续启动应用，即使Redis有问题
        }

        // 启动服务器
        server = app.listen(config.port, () => {
            logger.info(`服务器监听端口 ${config.port}`);
        });
    } catch (error) {
        logger.error('启动错误:', error);
        process.exit(1);
    }
}

// 启动应用
main();

// 错误处理和优雅关闭
const exitHandler = async () => {
    try {
        // 关闭所有队列
        await QueueManager.closeAll();
        logger.info('所有队列已关闭');

        if (server) {
            server.close(() => {
                logger.info('服务器已关闭');
                process.exit(1);
            });
        } else {
            process.exit(1);
        }
    } catch (error) {
        logger.error('关闭队列时发生错误:', error);
        process.exit(1);
    }
};

const unexpectedErrorHandler = (error) => {
    logger.error(error);
    exitHandler();
};

process.on('uncaughtException', unexpectedErrorHandler);
process.on('unhandledRejection', unexpectedErrorHandler);

process.on('SIGTERM', async () => {
    logger.info('SIGTERM received');
    try {
        await QueueManager.closeAll();
        logger.info('所有队列已关闭');
        if (server) {
            server.close();
        }
    } catch (error) {
        logger.error('SIGTERM 处理时发生错误:', error);
        process.exit(1);
    }
});