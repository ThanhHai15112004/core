import { describe, it, expect } from '@jest/globals';
import { SecretRegistryService } from '@packages/security/index.js';
import { EnvironmentSecretProvider } from '@packages/security/providers/env-secret.provider.js';
import { SecretService } from '@packages/security/providers/secret.service.js';

describe('SecretRegistryService', () => {
  it('liệt kê metadata của secret nhưng TUYỆT ĐỐI không bao giờ chứa giá trị', async () => {
    process.env['JWT_ACCESS_SECRET'] = 'super-secret-key-123456';
    const envProvider = new EnvironmentSecretProvider();
    const secretService = new SecretService(envProvider);
    const registry = new SecretRegistryService(secretService);

    const list = await registry.listSecrets();
    expect(list.length).toBeGreaterThan(0);

    const jwtSecret = list.find((s) => s.key === 'JWT_ACCESS_SECRET');
    expect(jwtSecret).toBeDefined();
    expect(jwtSecret?.present).toBe(true);
    expect(jwtSecret?.length).toBe('super-secret-key-123456'.length);
    expect(jwtSecret?.driver).toBe('env');

    // Quan trọng nhất: kiểm tra mọi item trong list không có thuộc tính value hoặc rò rỉ secret
    for (const item of list) {
      expect((item as Record<string, unknown>)['value']).toBeUndefined();
      expect(JSON.stringify(item)).not.toContain('super-secret-key-123456');
    }
  });
});
