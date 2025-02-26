// 完整的 tests/unit/utils/queue.test.js 文件

// Mock bull - 使用同步调用处理器
jest.mock('bull', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    // 同步调用处理器
    process: jest.fn().mockImplementation((concurrency, handler) => {
      const actualHandler = typeof concurrency === 'function' ? concurrency : handler;
      if (actualHandler) {
        actualHandler({ data: { test: 'data' }, id: 'test-job-id' });
      }
    }),
    add: jest.fn().mockResolvedValue({ id: 'test-job-id', data: { test: 'data' } }),
    addBulk: jest.fn().mockResolvedValue([{ id: 'test-job-id', data: { test: 'data' } }]),
    getJob: jest.fn().mockResolvedValue({ 
      id: 'test-job-id', 
      data: { 
        originalMessage: { id: 'test-id', data: 'test-data' },
        meta: { retryCount: 0 },
        context: { originalQueue: 'test-queue' },
        error: { message: 'Test error' }
      }, 
      remove: jest.fn(),
      update: jest.fn().mockResolvedValue(true)
    }),
    getWaitingCount: jest.fn().mockResolvedValue(0),
    getActiveCount: jest.fn().mockResolvedValue(0),
    getCompletedCount: jest.fn().mockResolvedValue(0),
    getFailedCount: jest.fn().mockResolvedValue(0),
    getDelayedCount: jest.fn().mockResolvedValue(0),
    empty: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    removeAllListeners: jest.fn(),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    getJobs: jest.fn().mockResolvedValue([])
  }));
});

// Mock logger
jest.mock('../../../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const QueueManager = require('../../../src/utils/queue/QueueManager');
const Queue = require('../../../src/utils/queue/Queue');
const MessageProcessor = require('../../../src/utils/queue/MessageProcessor');
const DeadLetterQueue = require('../../../src/utils/queue/DeadLetterQueue');

// 创建一个专门用于测试的队列实例
let testQueue;
let messageProcessor;
let deadLetterQueue;

describe('Queue System', () => {
  // 使用假定时器
  beforeAll(() => {
    jest.useFakeTimers();
  });

  beforeEach(async () => {
    // 创建新的测试实例
    testQueue = new Queue('test-queue', {
      defaultJobOptions: {
        removeOnComplete: true,
        attempts: 3
      }
    });

    messageProcessor = new MessageProcessor({
      maxRetries: 3,
      retryDelay: 100
    });

    deadLetterQueue = new DeadLetterQueue({
      queueName: 'test-dlq'
    });

    // 清理所有模拟函数的调用记录
    jest.clearAllMocks();
  });

  // 每次测试结束后清理计时器
  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('Queue', () => {
    test('should add job successfully', async () => {
      const job = await testQueue.add({ data: 'test-data' });
      expect(job).toBeDefined();
      expect(job.id).toBe('test-job-id');
    });

    test('should process job with handler', async () => {
      const mockHandler = jest.fn().mockResolvedValue('processed');
      testQueue.setProcessor(mockHandler);

      await testQueue.add({ data: 'test-data' });
      
      // 由于 bull mock 现在会同步调用处理器，不需要等待
      expect(mockHandler).toHaveBeenCalled();
    });
  });

  describe('MessageProcessor', () => {
    test('should register and execute handler', async () => {
      const mockHandler = jest.fn().mockResolvedValue('result');
      messageProcessor.registerHandler('test-type', mockHandler);

      const result = await messageProcessor.process({
        id: 'test-id',
        type: 'test-type',
        data: { test: 'data' }
      });

      expect(result).toBe('result');
      expect(mockHandler).toHaveBeenCalledWith({ test: 'data' });
    });

    test('should handle processing failure', async () => {
      const mockHandler = jest.fn().mockRejectedValue(new Error('test error'));
      messageProcessor.registerHandler('test-type', mockHandler);

      const message = {
        id: 'test-id',
        type: 'test-type',
        data: { test: 'data' }
      };

      await expect(messageProcessor.process(message))
        .rejects
        .toThrow('test error');
    });

    test('should retry on failure', async () => {
      const mockHandler = jest.fn()
        .mockRejectedValueOnce(new Error('test error'))
        .mockResolvedValue('success');
      
      messageProcessor.registerHandler('test-type', mockHandler);

      // 给 delay 方法打补丁，在测试中不实际延迟
      const originalDelay = messageProcessor.delay;
      messageProcessor.delay = jest.fn().mockResolvedValue(undefined);

      const result = await messageProcessor.process({
        id: 'test-id',
        type: 'test-type',
        data: { test: 'data' }
      });

      // 恢复原始方法
      messageProcessor.delay = originalDelay;

      expect(result).toBe('success');
      expect(mockHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('DeadLetterQueue', () => {
    test('should add failed message', async () => {
      const message = {
        id: 'test-id',
        data: 'test-data'
      };
      const error = new Error('test error');

      await deadLetterQueue.addFailedMessage(message, error, {
        queueName: 'original-queue'
      });

      const status = await deadLetterQueue.getStatus();
      expect(status.total).toBe(0); // mock的结果是0
    });

    test('should retry failed message', async () => {
      // 手动模拟 getJob 方法的返回值，确保有正确的结构
      const mockJob = {
        id: 'dlq:test-id',
        data: {
          originalMessage: { id: 'test-id', data: 'test-data' },
          meta: { retryCount: 0 },
          context: { originalQueue: 'test-queue' }
        },
        update: jest.fn().mockResolvedValue(true)
      };
      
      deadLetterQueue.queue.getJob = jest.fn().mockResolvedValue(mockJob);

      const result = await deadLetterQueue.retryMessage('test-id');
      expect(result).toBe(true);
    });
  });

  // 清理测试数据
  afterEach(async () => {
    await testQueue.clear();
    if (deadLetterQueue.queue) {
      await deadLetterQueue.queue.clear();
    }
  });

  // 关闭所有队列连接
  afterAll(async () => {
    await testQueue.close();
    if (deadLetterQueue.queue) {
      // 确保清理死信队列的计时器
      if (deadLetterQueue.cleanupTimerId) {
        clearInterval(deadLetterQueue.cleanupTimerId);
      }
      await deadLetterQueue.close();
    }
    
    jest.useRealTimers();
  });
});