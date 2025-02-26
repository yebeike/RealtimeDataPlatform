// tests/unit/utils/cacheKeyGenerator.test.js
const CacheKeyGenerator = require('../../../src/utils/CacheKeyGenerator');

describe('CacheKeyGenerator', () => {
  let cacheKeyGenerator;

  beforeEach(() => {
    cacheKeyGenerator = new CacheKeyGenerator();
  });

  describe('generate', () => {
    test('should generate cache key with correct format', () => {
      const key = cacheKeyGenerator.generate({
        entity: 'user',
        operation: 'profile',
        identifier: '123'
      });
      
      expect(key).toBe('rdp:user:profile:123:v1');
    });

    test('should allow custom prefix', () => {
      const key = cacheKeyGenerator.generate({
        prefix: 'custom',
        entity: 'user',
        operation: 'profile',
        identifier: '123'
      });
      
      expect(key).toBe('custom:user:profile:123:v1');
    });

    test('should allow custom version', () => {
      const key = cacheKeyGenerator.generate({
        entity: 'user',
        operation: 'profile',
        identifier: '123',
        version: 'v2'
      });
      
      expect(key).toBe('rdp:user:profile:123:v2');
    });

    test('should throw error if entity is missing', () => {
      expect(() => {
        cacheKeyGenerator.generate({
          operation: 'profile',
          identifier: '123'
        });
      }).toThrow('entity is required');
    });

    test('should throw error if operation is missing', () => {
      expect(() => {
        cacheKeyGenerator.generate({
          entity: 'user',
          identifier: '123'
        });
      }).toThrow('operation is required');
    });

    test('should throw error if identifier is missing', () => {
      expect(() => {
        cacheKeyGenerator.generate({
          entity: 'user',
          operation: 'profile'
        });
      }).toThrow('identifier is required');
    });
  });
});