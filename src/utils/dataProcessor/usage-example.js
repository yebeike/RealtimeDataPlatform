/**
 * 实时数据处理系统使用示例
 * 演示如何使用DataProcessor处理实时数据
 */

// const { DataProcessor, transformers, processors } = require('../utils/dataProcessor');
const { DataProcessor, transformers, processors } = require('./index');
// const logger = require('../config/logger');
const logger = require('../../config/logger');

/**
 * 示例1：处理用户活动数据
 */
const processUserActivity = async () => {
  // 创建数据处理器实例
  const dataProcessor = new DataProcessor({
    concurrency: 5
  });
  
  // 注册转换器和处理器
  dataProcessor.registerTransformer('fieldRename', transformers.fieldRename);
  dataProcessor.registerTransformer('typeConverter', transformers.typeConverter);
  dataProcessor.registerProcessor('groupBy', processors.groupBy);
  
  // 构建处理管道
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
  
  // 模拟用户活动数据
  const userData = [
    {
      ts: '2023-11-01T10:15:30Z',
      uid: 'user_123',
      act: 'login',
      ip: '192.168.1.103',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    },
    {
      ts: '2023-11-01T10:20:45Z',
      uid: 'user_123',
      act: 'view_page',
      page: 'home',
      duration: 45,
      ip: '192.168.1.103',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    },
    {
      ts: '2023-11-01T10:25:12Z',
      uid: 'user_123',
      act: 'view_page',
      page: 'product',
      duration: 120,
      ip: '192.168.1.103',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    },
    {
      ts: '2023-11-01T10:27:35Z',
      uid: 'user_123',
      act: 'add_to_cart',
      product_id: 'prod_789',
      ip: '192.168.1.103',
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    },
    {
      ts: '2023-11-01T10:30:22Z',
      uid: 'user_456',
      act: 'login',
      ip: '192.168.1.104',
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    },
    {
      ts: '2023-11-01T10:32:45Z',
      uid: 'user_456',
      act: 'view_page',
      page: 'home',
      duration: 30,
      ip: '192.168.1.104',
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    }
  ];
  
  try {
    // 处理数据
    logger.info('Processing user activity data...');
    const result = await dataProcessor.processBatch(userData);
    
    // 输出结果
    logger.info('Processing completed successfully');
    logger.info('Processing metrics:', dataProcessor.getMetrics());
    
    // 打印结果
    console.log('Processed results:');
    console.log(JSON.stringify(result, null, 2));
    
    return result;
  } catch (error) {
    logger.error('Error processing user activity data:', error);
    throw error;
  }
};

/**
 * 示例2：实时系统指标分析
 */
const analyzeSystemMetrics = async () => {
  // 创建数据处理器实例
  const dataProcessor = new DataProcessor();
  
  // 注册转换器和处理器
  dataProcessor.registerTransformer('fieldFilter', transformers.fieldFilter);
  dataProcessor.registerProcessor('windowProcessor', processors.windowProcessor);
  dataProcessor.registerProcessor('anomalyDetector', processors.anomalyDetector);
  
  // 构建处理管道
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
  
  // 模拟系统指标数据
  const metricsData = [
    {
      timestamp: '2023-11-01T10:00:00Z',
      metric: 'cpu_usage',
      value: 45,
      host: 'server-01',
      datacenter: 'us-east'
    },
    {
      timestamp: '2023-11-01T10:01:00Z',
      metric: 'cpu_usage',
      value: 47,
      host: 'server-01',
      datacenter: 'us-east'
    },
    {
      timestamp: '2023-11-01T10:02:00Z',
      metric: 'cpu_usage',
      value: 46,
      host: 'server-01',
      datacenter: 'us-east'
    },
    {
      timestamp: '2023-11-01T10:03:00Z',
      metric: 'cpu_usage',
      value: 98, // 异常值
      host: 'server-01',
      datacenter: 'us-east'
    },
    {
      timestamp: '2023-11-01T10:04:00Z',
      metric: 'cpu_usage',
      value: 50,
      host: 'server-01',
      datacenter: 'us-east'
    },
    {
      timestamp: '2023-11-01T10:05:00Z',
      metric: 'cpu_usage',
      value: 48,
      host: 'server-01',
      datacenter: 'us-east'
    }
  ];
  
  try {
    // 处理数据
    logger.info('Analyzing system metrics...');
    const result = await dataProcessor.processItem(metricsData);
    
    // 输出结果
    logger.info('Analysis completed successfully');
    logger.info('Processing metrics:', dataProcessor.getMetrics());
    
    // 打印结果
    console.log('Analysis results:');
    console.log(JSON.stringify(result, null, 2));
    
    // 检查是否发现异常
    const anomalies = result.filter(item => item.value_isAnomaly);
    if (anomalies.length > 0) {
      logger.warn(`Found ${anomalies.length} anomalies in the metrics`);
      console.log('Anomalies detected:');
      console.log(JSON.stringify(anomalies, null, 2));
    }
    
    return result;
  } catch (error) {
    logger.error('Error analyzing system metrics:', error);
    throw error;
  }
};

/**
 * 示例3：自定义转换器和处理器
 */
const customProcessing = async () => {
  // 创建数据处理器实例
  const dataProcessor = new DataProcessor();
  
  // 注册标准转换器和处理器
  dataProcessor.registerTransformer('typeConverter', transformers.typeConverter);
  
  // 注册自定义转换器
  dataProcessor.registerTransformer('enrichData', (data, config = {}) => {
    // 添加额外信息到数据中
    return {
      ...data,
      processed_at: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      metadata: {
        version: '1.0',
        ...config.metadata
      }
    };
  });
  
  // 注册自定义处理器
  dataProcessor.registerProcessor('calculateMetrics', (data, config = {}) => {
    // 假设数据是销售交易
    if (!Array.isArray(data)) {
      return { error: 'Data must be an array' };
    }
    
    // 计算总销售额
    const totalSales = data.reduce((sum, item) => sum + (item.amount || 0), 0);
    
    // 计算平均订单金额
    const avgOrderValue = totalSales / data.length || 0;
    
    // 找出最大订单
    const maxOrder = data.reduce(
      (max, item) => (item.amount > max.amount ? item : max),
      { amount: 0 }
    );
    
    // 按产品分类统计
    const productStats = {};
    data.forEach(item => {
      if (item.product) {
        if (!productStats[item.product]) {
          productStats[item.product] = {
            count: 0,
            total: 0
          };
        }
        productStats[item.product].count += 1;
        productStats[item.product].total += item.amount || 0;
      }
    });
    
    return {
      transactionCount: data.length,
      totalSales,
      avgOrderValue,
      maxOrder,
      productStats
    };
  });
  
  // 构建处理管道
  dataProcessor.buildPipeline([
    { 
      type: 'transformer', 
      name: 'typeConverter', 
      config: { 
        typeMap: {
          'amount': { type: 'number' },
          'timestamp': { type: 'date' }
        }
      } 
    },
    { 
      type: 'transformer', 
      name: 'enrichData', 
      config: { 
        metadata: {
          source: 'sales-system',
          purpose: 'demo'
        }
      } 
    },
    { 
      type: 'processor', 
      name: 'calculateMetrics'
    }
  ]);
  
  // 模拟销售数据
  const salesData = [
    { id: '001', timestamp: '2023-11-01T12:30:45Z', customer: 'cust_123', product: 'laptop', amount: '1299.99' },
    { id: '002', timestamp: '2023-11-01T12:45:22Z', customer: 'cust_456', product: 'phone', amount: '899.99' },
    { id: '003', timestamp: '2023-11-01T13:15:30Z', customer: 'cust_789', product: 'tablet', amount: '649.99' },
    { id: '004', timestamp: '2023-11-01T14:20:15Z', customer: 'cust_123', product: 'headphones', amount: '199.99' },
    { id: '005', timestamp: '2023-11-01T14:45:30Z', customer: 'cust_456', product: 'laptop', amount: '1499.99' }
  ];
  
  try {
    // 处理数据
    logger.info('Processing sales data with custom processors...');
    const result = await dataProcessor.processItem(salesData);
    
    // 输出结果
    logger.info('Processing completed successfully');
    logger.info('Processing metrics:', dataProcessor.getMetrics());
    
    // 打印结果
    console.log('Sales analysis results:');
    console.log(JSON.stringify(result, null, 2));
    
    return result;
  } catch (error) {
    logger.error('Error processing sales data:', error);
    throw error;
  }
};

/**
 * 执行示例
 */
const runExamples = async () => {
  try {
    console.log('\n=== Example 1: User Activity Processing ===\n');
    await processUserActivity();
    
    console.log('\n=== Example 2: System Metrics Analysis ===\n');
    await analyzeSystemMetrics();
    
    console.log('\n=== Example 3: Custom Processing ===\n');
    await customProcessing();
    
    console.log('\nAll examples completed successfully!');
  } catch (error) {
    console.error('Error running examples:', error);
  }
};

// 如果直接运行此文件，则执行示例
if (require.main === module) {
  runExamples();
}

module.exports = {
  processUserActivity,
  analyzeSystemMetrics,
  customProcessing,
  runExamples
};
