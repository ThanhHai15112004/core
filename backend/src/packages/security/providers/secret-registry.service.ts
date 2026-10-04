import { Injectable } from '@nestjs/common';
import { SecretService } from './secret.service.js';
import { SecretDriver } from '../types/secret.types.js';

export interface SecretItemMeta {
  key: string;
  driver: 'env' | 'file';
  present: boolean;
  length?: number;
  lastReadAt?: string;
}

const DEFAULT_KNOWN_SECRET_KEYS = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'DB_PASSWORD',
  'REDIS_PASSWORD',
  'S3_SECRET_KEY',
  'S3_ACCESS_KEY',
  'SESSION_SECRET',
  'APP_KEY',
];

/**
 * Registry quản lý và kiểm tra metadata của các secret key trong hệ thống.
 * TUYỆT ĐỐI KHÔNG BAO GIỜ TRẢ VỀ GIÁ TRỊ THẬT CỦA SECRET.
 */
@Injectable()
export class SecretRegistryService {
  private readonly registeredKeys = new Set<string>(DEFAULT_KNOWN_SECRET_KEYS);

  constructor(private readonly secretService: SecretService) {}

  /**
   * Đăng ký thêm secret key vào registry.
   */
  public registerKey(key: string): void {
    if (key && key.trim()) {
      this.registeredKeys.add(key.trim().toUpperCase());
    }
  }

  /**
   * Liệt kê tất cả metadata của các secret key đã đăng ký.
   */
  public async listSecrets(): Promise<SecretItemMeta[]> {
    const driver =
      process.env.SECRET_DRIVER?.toLowerCase() === SecretDriver.FILE
        ? ('file' as const)
        : ('env' as const);

    const now = new Date().toISOString();
    const items: SecretItemMeta[] = [];

    for (const key of this.registeredKeys) {
      const val = await this.secretService.getSecret(key).catch(() => null);
      const present = val !== null && val !== '';
      items.push({
        key,
        driver,
        present,
        ...(present ? { length: val.length } : {}),
        lastReadAt: now,
      });
    }

    return items;
  }
}
