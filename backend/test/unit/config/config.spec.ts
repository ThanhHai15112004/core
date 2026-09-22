import { describe, it, expect, beforeEach } from '@jest/globals';
import { env, CoreConfigService } from '@packages/config/index.js';
import { applyTestEnv } from '../../fixtures/env.fixture.js';

describe('packages/config Unit Tests', () => {
  beforeEach(() => {
    applyTestEnv();
  });

  describe('env() helper (Fail-Fast, No Fallbacks)', () => {
    it('should return value when environment variable exists', () => {
      process.env.TEST_EXISTING_KEY = 'valid_value';
      expect(env('TEST_EXISTING_KEY')).toBe('valid_value');
    });

    it('should throw ConfigError immediately when key is missing or empty', () => {
      delete process.env.TEST_MISSING_KEY;
      expect(() => env('TEST_MISSING_KEY')).toThrow('[ConfigError]');

      process.env.TEST_EMPTY_KEY = '';
      expect(() => env('TEST_EMPTY_KEY')).toThrow('[ConfigError]');
    });

    it('should parse numbers correctly with env.number()', () => {
      process.env.TEST_PORT_NUM = '8080';
      expect(env.number('TEST_PORT_NUM')).toBe(8080);

      process.env.TEST_INVALID_NUM = 'not-a-number';
      expect(() => env.number('TEST_INVALID_NUM')).toThrow('[ConfigError]');
    });

    it('should parse booleans correctly with env.boolean()', () => {
      process.env.TEST_BOOL_TRUE = 'true';
      process.env.TEST_BOOL_ONE = '1';
      process.env.TEST_BOOL_FALSE = 'false';
      process.env.TEST_BOOL_ZERO = '0';

      expect(env.boolean('TEST_BOOL_TRUE')).toBe(true);
      expect(env.boolean('TEST_BOOL_ONE')).toBe(true);
      expect(env.boolean('TEST_BOOL_FALSE')).toBe(false);
      expect(env.boolean('TEST_BOOL_ZERO')).toBe(false);

      process.env.TEST_INVALID_BOOL = 'maybe';
      expect(() => env.boolean('TEST_INVALID_BOOL')).toThrow('[ConfigError]');
    });
  });

  describe('CoreConfigService', () => {
    it('should instantiate and provide strongly typed configuration', () => {
      const config = new CoreConfigService();

      expect(config.app.name).toBe('CoreAppTest');
      expect(config.app.port).toBe(4001);
      expect(config.database.connection).toBe('pgsql');
      expect(config.database.host).toBe('127.0.0.1');
      expect(config.database.port).toBe(5432);
      expect(config.database.database).toBe('core_test');
      expect(config.database.username).toBe('test_user');
      expect(config.database.password).toBe('test_password');
      expect(config.database.maxConnections).toBe(5);
      expect(config.auth.jwt.accessSecret).toBe('test_access_secret_key_at_least_32_chars_long!!');
      expect(config.cache.redis.host).toBe('127.0.0.1');
      expect(config.cache.redis.port).toBe(6379);
      expect(config.cache.redis.prefix).toBe('core_test:');
      expect(config.storage.driver).toBe('local');
    });

    it('should identify environment flags correctly', () => {
      const config = new CoreConfigService();
      expect(config.isTest).toBe(true);
      expect(config.isProduction).toBe(false);
      expect(config.isDevelopment).toBe(false);
    });

    it('should support dot-notation queries via config.get()', () => {
      const config = new CoreConfigService();

      expect(config.get<string>('database.database')).toBe('core_test');
      expect(config.get<number>('app.port')).toBe(4001);
      expect(config.get<string>('auth.jwt.accessSecret')).toBe(
        'test_access_secret_key_at_least_32_chars_long!!',
      );
      expect(config.get('non.existent.path')).toBeUndefined();
    });
  });
});
