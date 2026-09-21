import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { FileSecretProvider } from '@packages/security/index.js';

describe('FileSecretProvider Unit Tests', () => {
  let tempDir: string;
  let provider: FileSecretProvider;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-secrets-test-'));
    fs.writeFileSync(
      path.join(tempDir, 'jwt_access_secret'),
      'super-secure-jwt-token-value\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(tempDir, 'db_password'),
      'db_super_password_123',
      'utf8',
    );
    fs.writeFileSync(
      path.join(tempDir, 'db_username'),
      'postgres_admin',
      'utf8',
    );
    fs.writeFileSync(
      path.join(tempDir, 'api-third-party-key'),
      'api_key_xyz987',
      'utf8',
    );

    provider = new FileSecretProvider(tempDir);
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should return trimmed secret content when file exists', async () => {
    const secret = await provider.getSecret('jwt_access_secret');
    expect(secret).toBe('super-secure-jwt-token-value');
  });

  it('should support case-insensitive and normalized key lookups', async () => {
    // UPPERCASE lookup: JWT_ACCESS_SECRET -> finds jwt_access_secret
    const secretUpper = await provider.getSecret('JWT_ACCESS_SECRET');
    expect(secretUpper).toBe('super-secure-jwt-token-value');

    // Dot-notation lookup: jwt.accessSecret -> finds jwt_access_secret
    const secretDot = await provider.getSecret('jwt.accessSecret');
    expect(secretDot).toBe('super-secure-jwt-token-value');

    // Kebab-case lookup: api.third.party.key -> finds api-third-party-key
    const secretKebab = await provider.getSecret('api.third.party.key');
    expect(secretKebab).toBe('api_key_xyz987');
  });

  it('should return null when secret file does not exist', async () => {
    const secret = await provider.getSecret('non_existent_secret_key');
    expect(secret).toBeNull();
  });

  it('should return null if secret directory does not exist', async () => {
    const invalidProvider = new FileSecretProvider('/tmp/non_existent_path_xyz_123');
    const secret = await invalidProvider.getSecret('any_key');
    expect(secret).toBeNull();
  });

  it('should retrieve secrets by prefix correctly', async () => {
    const dbSecrets = await provider.getSecretsByPrefix('db');
    expect(dbSecrets).toEqual({
      db_password: 'db_super_password_123',
      db_username: 'postgres_admin',
    });
  });
});
