/**
 * 数据处理服务
 * 集成消息队列和数据处理器
 */

const logger = require('../../config/logger');
const queueManager = require('../queue/QueueManager');
const { DataProcessor, transformers, processors } = require('../dataProcessor');

/**
 * 初始化数据处理服务
 * @param {Object} options - 配置选项
 */
const initDataProcessingService = (options = {}) => {
  logger.info('Initializing data processing service');
  
  // 创建数据处理器实例
  const dataProcessor = new DataProcessor({
    concurrency: options.concurrency || 10,
    batchSize: options.batchSize || 100
  });
  
  // 注册转换器
  Object.entries(transformers).forEach(([name, transformer]) => {
    dataProcessor.registerTransformer(name, transformer);
  });
  
  // 注册处理器
  Object.entries(processors).forEach(([name, processor]) => {
    dataProcessor.registerProcessor(name, processor);
  });
  
  // 监听处理事件
  dataProcessor.on('itemProcessed', (event) => {
    if (event.success) {
      logger.debug('Item processed successfully', { 
        processingTime: event.processingTime 
      });
    } else {
      logger.error('Error processing item', { 
        error: event.error.message,
        processingTime: event.processingTime 
      });
    }
  });
  
  // 创建数据处理队列
  const queueOptions = {
    attempts: 3,                 // 失败重试次数
    backoff: {                   // 重试策略
      type: 'exponential',
      delay: 1000
    }
  };
  
  // 创建并配置事件数据处理队列
  queueManager.createQueue('event-data-processing', queueOptions, async (job) => {
    const { data } = job;
    
    try {
      // 根据数据类型构建不同的处理管道
      switch (data.type) {
        case 'user-activity':
          // 用户活动数据处理管道
          dataProcessor.buildPipeline([
            { 
              type: 'transformer', 
              name: 'fieldRename', 
              config: { 
                fieldMap: { 
                  'ts': 'timestamp',
                  'uid': 'userId', 
                  'act': 'action' 
                } 
              } 
            },
            { 
              type: 'transformer', 
              name: 'typeConverter', 
              config: { 
                typeMap: {
                  'timestamp': { type: 'date' },
                  'userId': { type: 'string' }
                }
              } 
            },
            { 
              type: 'processor', 
              name: 'groupBy', 
              config: { 
                groupByFields: ['userId', 'action'],
                aggregations: [
                  { field: 'timestamp', operation: 'count', outputField: 'actionCount' }
                ]
              } 
            }
          ]);
          break;
          
        case 'system-metrics':
          // 系统指标数据处理管道
          dataProcessor.buildPipeline([
            { 
              type: 'transformer', 
              name: 'fieldFilter', 
              config: { 
                fields: ['timestamp', 'metric', 'value', 'host'] 
              } 
            },
            { 
              type: 'processor', 
              name: 'windowProcessor', 
              config: { 
                timeField: 'timestamp',
                windowSize: 300000, // 5分钟窗口
                slideSize: 60000,   // 1分钟滑动
                aggregations: [
                  { field: 'value', operation: 'avg', outputField: 'avgValue' },
                  { field: 'value', operation: 'max', outputField: 'maxValue' },
                  { field: 'value', operation: 'min', outputField: 'minValue' }
                ]
              } 
            },
            { 
              type: 'processor', 
              name: 'anomalyDetector', 
              config: { 
                field: 'value',
                method: 'zscore',
                threshold: 3
              } 
            }
          ]);
          break;
          
        default:
          // 默认处理管道
          dataProcessor.buildPipeline([
            { 
              type: 'transformer', 
              name: 'dataValidator', 
              config: { 
                validations: {
                  'timestamp': { required: true, type: 'string' },
                  'data': { required: true, type: 'object' }
                },
                throwOnError: false
              } 
            }
          ]);
      }
      
      // 处理数据
      const result = await dataProcessor.processItem(data);
      
      // 处理结果可以存储到数据库或其他队列
      logger.info('Data processed successfully', { 
        type: data.type,
        metrics: dataProcessor.getMetrics() 
      });
      
      return result;
    } catch (error) {
      logger.error('Error in data processing queue', { error: error.message });
      throw error; // 重新抛出错误，触发队列重试机制
    }
  });
  
  // 创建批量数据处理队列
  queueManager.createQueue('batch-data-processing', queueOptions, async (job) => {
    const { data } = job;
    
    try {
      // 对于批量数据，我们可以使用processBatch方法
      if (!Array.isArray(data.items)) {
        throw new Error('Batch processing requires an array of items');
      }
      
      // 配置处理管道
      dataProcessor.buildPipeline([
        // 配置适合批处理的管道步骤
        { 
          type: 'transformer', 
          name: 'typeConverter', 
          config: { 
            typeMap: data.typeMap || {} 
          } 
        },
        { 
          type: 'processor', 
          name: 'groupBy', 
          config: { 
            groupByFields: data.groupBy || [],
            aggregations: data.aggregations || []
          } 
        }
      ]);
      
      // 批量处理数据
      const results = await dataProcessor.processBatch(data.items);
      
      // 处理结果可以存储到数据库或其他队列
      logger.info('Batch processing completed', { 
        total: data.items.length,
        success: results.filter(r => r.status === 'success').length,
        failed: results.filter(r => r.status === 'error').length
      });
      
      return results;
    } catch (error) {
      logger.error('Error in batch processing queue', { error: error.message });
      throw error;
    }
  });
  
  logger.info('Data processing service initialized');
  
  return {
    dataProcessor,
    getMetrics: () => dataProcessor.getMetrics(),
    resetMetrics: () => dataProcessor.resetMetrics()
  };
};

module.exports = {
  initDataProcessingService
};
