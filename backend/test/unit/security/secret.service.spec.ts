import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  SecretService,
  EnvironmentSecretProvider,
  type SecretProvider,
} from '@packages/security/index.js';

describe('SecretService Unit Tests', () => {
  let mockGetSecret: jest.Mock<(key: string) => Promise<string | null>>;
  let mockGetSecretsByPrefix: jest.Mock<(prefix: string) => Promise<Record<string, string>>>;
  let mockProvider: SecretProvider;
  let secretService: SecretService;

  beforeEach(() => {
    mockGetSecret = jest.fn<(key: string) => Promise<string | null>>();
    mockGetSecretsByPrefix = jest.fn<(prefix: string) => Promise<Record<string, string>>>();
    mockProvider = {
      getSecret: mockGetSecret,
      getSecretsByPrefix: mockGetSecretsByPrefix,
    };
    secretService = new SecretService(mockProvider, { cacheTtlMs: 60_000 });
  });

  it('should return secret value when found in provider', async () => {
    mockGetSecret.mockResolvedValue('secret-123');

    const val = await secretService.getSecret('test.key');
    expect(val).toBe('secret-123');
    expect(mockGetSecret).toHaveBeenCalledWith('test.key');
  });

  it('should return defaultValue when secret is null', async () => {
    mockGetSecret.mockResolvedValue(null);

    const val = await secretService.getSecret('missing.key', 'default_fallback');
    expect(val).toBe('default_fallback');
  });

  it('should throw [SecretError] in getRequiredSecret when secret is missing', async () => {
    mockGetSecret.mockResolvedValue(null);

    await expect(secretService.getRequiredSecret('critical_secret')).rejects.toThrow(
      '[SecretError]',
    );
  });

  it('should throw [SecretError] in getRequiredSecret when secret is empty string', async () => {
    mockGetSecret.mockResolvedValue('');

    await expect(secretService.getRequiredSecret('empty_secret')).rejects.toThrow(
      '[SecretError]',
    );
  });

  it('should return secret in getRequiredSecret when secret exists', async () => {
    mockGetSecret.mockResolvedValue('valid_secret');

    const val = await secretService.getRequiredSecret('valid_secret_key');
    expect(val).toBe('valid_secret');
  });

  it('should return boolean in hasSecret correctly', async () => {
    mockGetSecret.mockResolvedValueOnce('present');
    expect(await secretService.hasSecret('key1')).toBe(true);

    mockGetSecret.mockResolvedValueOnce(null);
    expect(await secretService.hasSecret('key2')).toBe(false);
  });

  it('should cache secret in memory within TTL', async () => {
    mockGetSecret.mockResolvedValue('cached_val');

    // First call: calls provider
    const first = await secretService.getSecret('cache.key');
    expect(first).toBe('cached_val');
    expect(mockGetSecret).toHaveBeenCalledTimes(1);

    // Second call: served from cache
    const second = await secretService.getSecret('cache.key');
    expect(second).toBe('cached_val');
    expect(mockGetSecret).toHaveBeenCalledTimes(1);
  });

  it('should invalidate cache when clearCache() is invoked', async () => {
    mockGetSecret.mockResolvedValue('initial_secret');

    await secretService.getSecret('rotation.key');
    expect(mockGetSecret).toHaveBeenCalledTimes(1);

    // Xoá cache khi xoay vòng secret (Secret Rotation)
    secretService.clearCache();

    mockGetSecret.mockResolvedValue('rotated_new_secret');
    const updated = await secretService.getSecret('rotation.key');
    expect(updated).toBe('rotated_new_secret');
    expect(mockGetSecret).toHaveBeenCalledTimes(2);
  });

  it('should delegate getSecretsByPrefix to provider', async () => {
    mockGetSecretsByPrefix.mockResolvedValue({
      db_pass: '123',
      db_user: 'admin',
    });

    const results = await secretService.getSecretsByPrefix('db');
    expect(results).toEqual({
      db_pass: '123',
      db_user: 'admin',
    });
  });

  describe('Integration with EnvironmentSecretProvider', () => {
    it('should read from environment variables via EnvironmentSecretProvider', async () => {
      process.env.APP_SECRET_TOKEN = 'env_secret_value_999';

      const envProvider = new EnvironmentSecretProvider();
      const service = new SecretService(envProvider);

      const val = await service.getSecret('APP_SECRET_TOKEN');
      expect(val).toBe('env_secret_value_999');

      delete process.env.APP_SECRET_TOKEN;
    });
  });
});
