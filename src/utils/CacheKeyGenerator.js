// src/utils/CacheKeyGenerator.js
class CacheKeyGenerator {
    constructor(defaultPrefix = 'rdp') {
      this.defaultPrefix = defaultPrefix;
    }
  
    /**
     * 生成缓存键
     * @param {Object} params 缓存键参数
     * @param {string} [params.prefix] 前缀（可选，默认为构造函数中的defaultPrefix）
     * @param {string} params.entity 实体名称（如：user, order）
     * @param {string} params.operation 操作类型（如：profile, list）
     * @param {string} params.identifier 唯一标识符
     * @param {string} [params.version] 版本号（可选，默认为v1）
     * @returns {string} 格式化的缓存键
     */
    generate({prefix = this.defaultPrefix, entity, operation, identifier, version = 'v1'}) {
      // 验证必需参数
      if (!entity) throw new Error('entity is required');
      if (!operation) throw new Error('operation is required');
      if (!identifier) throw new Error('identifier is required');
  
      // 生成并返回缓存键
      return `${prefix}:${entity}:${operation}:${identifier}:${version}`;
    }
  }
  
  module.exports = CacheKeyGenerator;