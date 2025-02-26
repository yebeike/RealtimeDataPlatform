/**
 * 数据处理器集合
 * 包含常用的数据计算和分析函数
 */

const logger = require('../../config/logger');

/**
 * 聚合处理器 - 对指定字段进行聚合计算
 * @param {Object|Array} data - 输入数据
 * @param {Object} config - 配置对象
 * @returns {Object} - 聚合结果
 */
const aggregator = (data, config = {}) => {
  const { aggregations = [] } = config;
  
  if (!Array.isArray(aggregations) || aggregations.length === 0) {
    logger.warn('aggregator: No aggregations specified, returning original data');
    return data;
  }
  
  // 确保data是数组
  const dataArray = Array.isArray(data) ? data : [data];
  
  if (dataArray.length === 0) {
    logger.warn('aggregator: Empty data array');
    return {};
  }
  
  const result = {};
  
  aggregations.forEach(agg => {
    const { field, operation, outputField = `${field}_${operation}` } = agg;
    
    // 提取有效值（非null和非undefined）
    const validValues = dataArray
      .map(item => item[field])
      .filter(value => value !== null && value !== undefined);
    
    if (validValues.length === 0) {
      result[outputField] = null;
      return;
    }
    
    switch (operation) {
      case 'sum':
        result[outputField] = validValues.reduce((sum, value) => sum + Number(value), 0);
        break;
      case 'avg':
        result[outputField] = validValues.reduce((sum, value) => sum + Number(value), 0) / validValues.length;
        break;
      case 'min':
        result[outputField] = Math.min(...validValues.map(Number));
        break;
      case 'max':
        result[outputField] = Math.max(...validValues.map(Number));
        break;
      case 'count':
        result[outputField] = validValues.length;
        break;
      default:
        logger.warn(`aggregator: Unknown operation '${operation}'`);
        result[outputField] = null;
    }
  });
  
  return result;
};

/**
 * 分组处理器 - 按指定字段对数据进行分组
 * @param {Array} data - 输入数据数组
 * @param {Object} config - 配置对象
 * @returns {Object} - 分组结果
 */
const groupBy = (data, config = {}) => {
  const { groupByFields = [], aggregations = [] } = config;
  
  if (!Array.isArray(data)) {
    logger.warn('groupBy: Input is not an array, returning empty result');
    return {};
  }
  
  if (data.length === 0) {
    logger.warn('groupBy: Empty data array');
    return {};
  }
  
  if ((!Array.isArray(groupByFields) || groupByFields.length === 0) && typeof groupByFields !== 'string') {
    logger.warn('groupBy: No groupByFields specified, returning original data');
    return { all: data };
  }
  
  // 将单个字段转换为数组
  const fields = typeof groupByFields === 'string' ? [groupByFields] : groupByFields;
  
  // 按字段值分组
  const groups = {};
  
  data.forEach(item => {
    // 创建组合键
    const keyParts = fields.map(field => {
      const value = item[field];
      // 处理null、undefined和非原始类型值
      if (value === null || value === undefined) {
        return 'null';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
    });
    
    const groupKey = keyParts.join('|');
    
    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    
    groups[groupKey].push(item);
  });
  
  // 如果没有指定聚合，则返回分组结果
  if (aggregations.length === 0) {
    return groups;
  }
  
  // 对每个分组应用聚合
  const result = {};
  
  Object.entries(groups).forEach(([groupKey, groupData]) => {
    result[groupKey] = aggregator(groupData, { aggregations });
    
    // 添加分组字段值到结果中
    const keyParts = groupKey.split('|');
    fields.forEach((field, index) => {
      result[groupKey][field] = keyParts[index] === 'null' ? null : keyParts[index];
    });
  });
  
  return result;
};

/**
 * 窗口处理器 - 对时间窗口内的数据进行处理
 * @param {Array} data - 输入数据数组
 * @param {Object} config - 配置对象
 * @returns {Array<Object>} - 窗口处理结果数组
 */
const windowProcessor = (data, config = {}) => {
  const { 
    timeField, 
    windowSize, 
    slideSize = windowSize, 
    aggregations = [] 
  } = config;
  
  if (!Array.isArray(data)) {
    logger.warn('windowProcessor: Input is not an array, returning empty result');
    return [];
  }
  
  if (data.length === 0) {
    logger.warn('windowProcessor: Empty data array');
    return [];
  }
  
  if (!timeField || !windowSize) {
    logger.warn('windowProcessor: Missing required config (timeField, windowSize)');
    return data;
  }
  
  // 确保数据按时间排序
  const sortedData = [...data].sort((a, b) => {
    const timeA = new Date(a[timeField]).getTime();
    const timeB = new Date(b[timeField]).getTime();
    return timeA - timeB;
  });
  
  // 找出时间范围
  const startTime = new Date(sortedData[0][timeField]).getTime();
  const endTime = new Date(sortedData[sortedData.length - 1][timeField]).getTime();
  
  // 如果时间范围小于窗口大小，则处理整个数据集
  if (endTime - startTime <= windowSize) {
    const result = aggregator(sortedData, { aggregations });
    result.windowStart = new Date(startTime).toISOString();
    result.windowEnd = new Date(endTime).toISOString();
    result.count = sortedData.length;
    return [result];
  }
  
  // 生成窗口
  const windows = [];
  for (let windowStart = startTime; windowStart <= endTime; windowStart += slideSize) {
    const windowEnd = windowStart + windowSize;
    
    // 过滤窗口内的数据
    const windowData = sortedData.filter(item => {
      const itemTime = new Date(item[timeField]).getTime();
      return itemTime >= windowStart && itemTime < windowEnd;
    });
    
    if (windowData.length > 0) {
      const windowResult = aggregator(windowData, { aggregations });
      windowResult.windowStart = new Date(windowStart).toISOString();
      windowResult.windowEnd = new Date(windowEnd).toISOString();
      windowResult.count = windowData.length;
      windows.push(windowResult);
    }
  }
  
  return windows;
};

/**
 * 异常检测处理器 - 基于统计方法检测异常值
 * @param {Array} data - 输入数据数组
 * @param {Object} config - 配置对象
 * @returns {Object} - 检测结果
 */
const anomalyDetector = (data, config = {}) => {
  const { 
    field, 
    method = 'zscore',   // 'zscore', 'iqr'
    threshold = 3,       // z-score阈值或IQR倍数
    outputField = `${field}_isAnomaly` 
  } = config;
  
  if (!Array.isArray(data)) {
    logger.warn('anomalyDetector: Input is not an array, returning original data');
    return data;
  }
  
  if (data.length === 0) {
    logger.warn('anomalyDetector: Empty data array');
    return data;
  }
  
  if (!field) {
    logger.warn('anomalyDetector: No field specified');
    return data;
  }
  
  // 提取有效值
  const values = data
    .map(item => item[field])
    .filter(value => value !== null && value !== undefined)
    .map(Number);
  
  if (values.length === 0) {
    logger.warn(`anomalyDetector: No valid values for field '${field}'`);
    return data.map(item => ({ ...item, [outputField]: false }));
  }
  
  // 根据不同方法检测异常
  if (method === 'zscore') {
    // 计算均值和标准差
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    // 如果标准差接近0，无法进行z-score计算
    if (stdDev < 0.0001) {
      logger.warn('anomalyDetector: Standard deviation too small, cannot detect anomalies');
      return data.map(item => ({ ...item, [outputField]: false }));
    }
    
    // 为每个数据点计算z-score并标记异常
    return data.map(item => {
      const value = Number(item[field]);
      if (isNaN(value) || value === null || value === undefined) {
        return { ...item, [outputField]: false };
      }
      
      const zscore = Math.abs((value - mean) / stdDev);
      return {
        ...item,
        [outputField]: zscore > threshold,
        [`${field}_zscore`]: zscore
      };
    });
  } else if (method === 'iqr') {
    // 计算四分位数
    const sortedValues = [...values].sort((a, b) => a - b);
    const q1Index = Math.floor(sortedValues.length * 0.25);
    const q3Index = Math.floor(sortedValues.length * 0.75);
    const q1 = sortedValues[q1Index];
    const q3 = sortedValues[q3Index];
    const iqr = q3 - q1;
    
    // 设置上下界
    const lowerBound = q1 - (iqr * threshold);
    const upperBound = q3 + (iqr * threshold);
    
    // 标记异常
    return data.map(item => {
      const value = Number(item[field]);
      if (isNaN(value) || value === null || value === undefined) {
        return { ...item, [outputField]: false };
      }
      
      return {
        ...item,
        [outputField]: value < lowerBound || value > upperBound,
        [`${field}_lowerBound`]: lowerBound,
        [`${field}_upperBound`]: upperBound
      };
    });
  } else {
    logger.warn(`anomalyDetector: Unknown method '${method}'`);
    return data;
  }
};

module.exports = {
  aggregator,
  groupBy,
  windowProcessor,
  anomalyDetector
};
