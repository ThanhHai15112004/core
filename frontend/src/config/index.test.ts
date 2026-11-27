import { describe, expect, it } from 'vitest';
import { resolveFrontendConfig } from './index';

describe('resolveFrontendConfig (Build-Once Runtime Config)', () => {
  it('ưu tiên runtime config (env-config.js) so với import.meta.env', () => {
    const cfg = resolveFrontendConfig(
      {
        appName: 'Core Staging',
        version: '2.4.1',
        environment: 'staging',
        commit: 'abcdef1',
        buildTime: '2026-11-27T10:00:00Z',
        apiBaseUrl: 'https://staging.example.com/api/v1',
        apiTimeoutMs: 25000,
        uploadTimeoutMs: 600000,
      },
      {
        PROD: true,
        VITE_API_BASE_URL: '/api/v1',
        VITE_API_TIMEOUT_MS: '15000',
      },
    );

    expect(cfg.appName).toBe('Core Staging');
    expect(cfg.version).toBe('2.4.1');
    expect(cfg.environment).toBe('staging');
    expect(cfg.commit).toBe('abcdef1');
    expect(cfg.apiBaseUrl).toBe('https://staging.example.com/api/v1');
    expect(cfg.apiTimeoutMs).toBe(25000);
    expect(cfg.uploadTimeoutMs).toBe(600000);
  });

  it('fallback sang build-time env và giá trị mặc định an toàn khi runtime config rỗng hoặc sai số', () => {
    const cfg = resolveFrontendConfig(
      {
        apiBaseUrl: '   ',
        apiTimeoutMs: 'not-a-number',
        uploadTimeoutMs: -5,
      },
      {
        PROD: false,
        VITE_API_BASE_URL: 'http://localhost:3005/api/v1',
      },
    );

    expect(cfg.appName).toBe('Core Framework');
    expect(cfg.environment).toBe('development');
    expect(cfg.apiBaseUrl).toBe('http://localhost:3005/api/v1');
    expect(cfg.apiTimeoutMs).toBe(15000);
    expect(cfg.uploadTimeoutMs).toBe(300000);
  });
});
