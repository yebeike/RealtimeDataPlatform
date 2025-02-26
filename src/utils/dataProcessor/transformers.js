/**
 * 数据转换器集合
 * 包含常用的数据转换和清洗函数
 */

const logger = require('../../config/logger');

/**
 * 字段过滤转换器 - 只保留指定字段
 * @param {Object} data - 输入数据
 * @param {Object} config - 配置对象
 * @returns {Object} - 过滤后的数据
 */
const fieldFilter = (data, config = {}) => {
  const { fields = [] } = config;
  
  if (!Array.isArray(fields) || fields.length === 0) {
    logger.warn('fieldFilter: No fields specified, returning original data');
    return data;
  }
  
  if (typeof data !== 'object' || data === null) {
    logger.warn('fieldFilter: Input is not an object, returning as is');
    return data;
  }
  
  const result = {};
  fields.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      result[field] = data[field];
    }
  });
  
  return result;
};

/**
 * 字段重命名转换器 - 重命名指定字段
 * @param {Object} data - 输入数据
 * @param {Object} config - 配置对象
 * @returns {Object} - 重命名后的数据
 */
const fieldRename = (data, config = {}) => {
  const { fieldMap = {} } = config;
  
  if (typeof data !== 'object' || data === null) {
    logger.warn('fieldRename: Input is not an object, returning as is');
    return data;
  }
  
  if (Object.keys(fieldMap).length === 0) {
    logger.warn('fieldRename: No field mapping specified, returning original data');
    return data;
  }
  
  const result = { ...data };
  
  Object.entries(fieldMap).forEach(([oldName, newName]) => {
    if (Object.prototype.hasOwnProperty.call(data, oldName)) {
      result[newName] = data[oldName];
      delete result[oldName];
    }
  });
  
  return result;
};

/**
 * 类型转换器 - 将字段转换为指定类型
 * @param {Object} data - 输入数据
 * @param {Object} config - 配置对象
 * @returns {Object} - 类型转换后的数据
 */
const typeConverter = (data, config = {}) => {
  const { typeMap = {} } = config;
  
  if (typeof data !== 'object' || data === null) {
    logger.warn('typeConverter: Input is not an object, returning as is');
    return data;
  }
  
  if (Object.keys(typeMap).length === 0) {
    logger.warn('typeConverter: No type mapping specified, returning original data');
    return data;
  }
  
  const result = { ...data };
  
  Object.entries(typeMap).forEach(([field, typeConfig]) => {
    if (!Object.prototype.hasOwnProperty.call(data, field)) {
      return;
    }
    
    const { type, format } = typeConfig;
    const value = data[field];
    
    try {
      switch (type) {
        case 'string':
          result[field] = String(value);
          break;
        case 'number':
          result[field] = Number(value);
          if (isNaN(result[field])) {
            logger.warn(`typeConverter: Failed to convert field '${field}' to number`);
            result[field] = 0; // 默认值
          }
          break;
        case 'boolean':
          if (typeof value === 'string') {
            result[field] = ['true', '1', 'yes'].includes(value.toLowerCase());
          } else {
            result[field] = Boolean(value);
          }
          break;
        case 'date':
          if (value instanceof Date) {
            result[field] = value;
          } else {
            result[field] = new Date(value);
            if (isNaN(result[field].getTime())) {
              logger.warn(`typeConverter: Failed to convert field '${field}' to date`);
              result[field] = null; // 默认值
            }
          }
          break;
        default:
          logger.warn(`typeConverter: Unknown type '${type}' for field '${field}'`);
      }
    } catch (error) {
      logger.error(`typeConverter: Error converting field '${field}':`, error);
    }
  });
  
  return result;
};

/**
 * 数据验证转换器 - 验证数据是否符合规则
 * @param {Object} data - 输入数据
 * @param {Object} config - 配置对象
 * @returns {Object} - 验证后的数据
 */
const dataValidator = (data, config = {}) => {
  const { validations = {}, throwOnError = false } = config;
  
  if (typeof data !== 'object' || data === null) {
    if (throwOnError) {
      throw new Error('dataValidator: Input is not an object');
    }
    logger.warn('dataValidator: Input is not an object, returning as is');
    return data;
  }
  
  if (Object.keys(validations).length === 0) {
    logger.warn('dataValidator: No validations specified, returning original data');
    return data;
  }
  
  const errors = [];
  
  Object.entries(validations).forEach(([field, rules]) => {
    // 检查必填
    if (rules.required && (data[field] === undefined || data[field] === null || data[field] === '')) {
      errors.push(`Field '${field}' is required`);
    }
    
    // 如果字段不存在且不是必填，跳过后续验证
    if (data[field] === undefined || data[field] === null) {
      return;
    }
    
    // 检查类型
    if (rules.type) {
      const actualType = typeof data[field];
      if (
        (rules.type === 'array' && !Array.isArray(data[field])) ||
        (rules.type !== 'array' && actualType !== rules.type)
      ) {
        errors.push(`Field '${field}' should be of type ${rules.type}`);
      }
    }
    
    // 检查最小值/长度
    if (rules.min !== undefined) {
      if (typeof data[field] === 'number' && data[field] < rules.min) {
        errors.push(`Field '${field}' should be at least ${rules.min}`);
      } else if ((typeof data[field] === 'string' || Array.isArray(data[field])) && data[field].length < rules.min) {
        errors.push(`Field '${field}' should have a minimum length of ${rules.min}`);
      }
    }
    
    // 检查最大值/长度
    if (rules.max !== undefined) {
      if (typeof data[field] === 'number' && data[field] > rules.max) {
        errors.push(`Field '${field}' should not exceed ${rules.max}`);
      } else if ((typeof data[field] === 'string' || Array.isArray(data[field])) && data[field].length > rules.max) {
        errors.push(`Field '${field}' should have a maximum length of ${rules.max}`);
      }
    }
    
    // 检查正则表达式
    if (rules.pattern && typeof data[field] === 'string') {
      const pattern = rules.pattern instanceof RegExp ? rules.pattern : new RegExp(rules.pattern);
      if (!pattern.test(data[field])) {
        errors.push(`Field '${field}' does not match the required pattern`);
      }
    }
  });
  
  if (errors.length > 0) {
    if (throwOnError) {
      throw new Error(`Validation failed: ${errors.join(', ')}`);
    }
    logger.warn('dataValidator: Validation errors:', errors);
  }
  
  return data;
};

module.exports = {
  fieldFilter,
  fieldRename,
  typeConverter,
  dataValidator
};
