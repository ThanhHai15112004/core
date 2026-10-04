import { Injectable } from '@nestjs/common';
import { CoreConfigService } from './config.service.js';

export interface ConfigItemDto {
  domain: string;
  key: string;
  value: unknown;
  source: 'env' | 'default';
  sensitive: boolean;
}

const SENSITIVE_REGEX = /(password|secret|token|private_key|api_key|secret_key|access_key)/i;

/**
 * Kiểm tra xem một key có phải là thông tin nhạy cảm hay không.
 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_REGEX.test(key);
}

/**
 * Che giá trị nhạy cảm.
 */
function maskValue(value: unknown): unknown {
  if (value === null || value === undefined || value === '') {
    return value;
  }
  return '••••••••';
}

@Injectable()
export class ConfigInspectorService {
  constructor(private readonly configService: CoreConfigService) {}

  /**
   * Duyệt toàn bộ cấu hình theo từng domain, che các giá trị nhạy cảm.
   */
  public inspectAll(): ConfigItemDto[] {
    const domains = [
      'app',
      'auth',
      'database',
      'cache',
      'storage',
      'queue',
      'messaging',
      'jobs',
      'logs',
      'scheduler',
      'runtime',
      'traffic',
      'performance',
      'metrics',
    ];

    const results: ConfigItemDto[] = [];
    for (const domain of domains) {
      results.push(...this.inspectDomain(domain));
    }
    return results;
  }

  /**
   * Duyệt cấu hình của một domain cụ thể.
   */
  public inspectDomain(domain: string): ConfigItemDto[] {
    const domainConfig = this.configService.get<Record<string, unknown>>(domain);
    if (!domainConfig || typeof domainConfig !== 'object') {
      return [];
    }

    const items: ConfigItemDto[] = [];
    this.flattenConfig(domain, '', domainConfig, items);
    return items;
  }

  private flattenConfig(
    domain: string,
    prefix: string,
    obj: Record<string, unknown>,
    results: ConfigItemDto[],
  ): void {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        this.flattenConfig(domain, fullKey, value as Record<string, unknown>, results);
      } else {
        const sensitive = isSensitiveKey(fullKey);
        // Kiểm tra xem biến môi trường có tương ứng không
        const envNameCandidate = fullKey.replace(/[.-]/g, '_').toUpperCase();
        const domainEnvCandidate = `${domain.toUpperCase()}_${envNameCandidate}`;
        const isFromEnv =
          process.env[fullKey] !== undefined ||
          process.env[envNameCandidate] !== undefined ||
          process.env[domainEnvCandidate] !== undefined;

        results.push({
          domain,
          key: fullKey,
          value: sensitive ? maskValue(value) : value,
          source: isFromEnv ? 'env' : 'default',
          sensitive,
        });
      }
    }
  }
}
