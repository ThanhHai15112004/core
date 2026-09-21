import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import type { SecretProvider } from '../contracts/secret-provider.contract.js';

@Injectable()
export class EnvironmentSecretProvider implements SecretProvider {
  constructor(@Optional() private readonly configService?: CoreConfigService) {}

  public async getSecret(key: string): Promise<string | null> {
    if (!key) return null;

    // 1. Tìm trực tiếp theo key trong process.env
    if (process.env[key] !== undefined && process.env[key] !== '') {
      return process.env[key];
    }

    // 2. Chuẩn hoá sang UPPER_SNAKE_CASE (vd: jwt.accessSecret -> JWT_ACCESS_SECRET)
    const upperKey = key.replace(/[.-]/g, '_').toUpperCase();
    if (process.env[upperKey] !== undefined && process.env[upperKey] !== '') {
      return process.env[upperKey];
    }

    // 3. Tra cứu qua CoreConfigService nếu có
    if (this.configService) {
      const val = this.configService.get<unknown>(key);
      if (typeof val === 'string' && val.trim() !== '') {
        return val;
      }
    }

    return null;
  }

  public async getSecretsByPrefix(prefix: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const normalizedPrefix = prefix.replace(/[.-]/g, '_').toUpperCase();

    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined || v === '') continue;
      if (k.startsWith(prefix) || k.startsWith(normalizedPrefix)) {
        result[k] = v;
      }
    }

    return result;
  }
}
