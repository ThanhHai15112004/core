import { Inject, Injectable, Optional } from '@nestjs/common';
import { SECRET_PROVIDER, type SecretProvider } from '../contracts/secret-provider.contract.js';
import type { SecretOptions } from '../types/secret.types.js';

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

@Injectable()
export class SecretService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;

  constructor(
    @Inject(SECRET_PROVIDER)
    private readonly provider: SecretProvider,
    @Optional() options?: SecretOptions,
  ) {
    this.cacheTtlMs = options?.cacheTtlMs ?? 60_000;
  }

  /**
   * Lấy giá trị bí mật theo key.
   * Nếu không tìm thấy, trả về defaultValue hoặc null.
   */
  public async getSecret(key: string, defaultValue?: string): Promise<string | null> {
    if (!key) return defaultValue ?? null;

    const now = Date.now();
    const cached = this.cache.get(key);

    if (cached && (this.cacheTtlMs === 0 || cached.expiresAt > now)) {
      return cached.value ?? defaultValue ?? null;
    }

    const value = await this.provider.getSecret(key);
    const resolvedValue = value ?? defaultValue ?? null;

    if (this.cacheTtlMs > 0) {
      this.cache.set(key, {
        value: resolvedValue,
        expiresAt: now + this.cacheTtlMs,
      });
    }

    return resolvedValue;
  }

  /**
   * Lấy bí mật bắt buộc. Ném lỗi nếu bí mật không tồn tại trong kho lưu trữ.
   */
  public async getRequiredSecret(key: string): Promise<string> {
    const value = await this.getSecret(key);
    if (value === null || value === '') {
      throw new Error(
        `[SecretError] Secret bắt buộc [${key}] không tồn tại hoặc rỗng trong kho lưu trữ secret!`,
      );
    }
    return value;
  }

  /**
   * Kiểm tra bí mật có tồn tại hay không.
   */
  public async hasSecret(key: string): Promise<boolean> {
    const val = await this.getSecret(key);
    return val !== null && val !== '';
  }

  /**
   * Lấy danh sách bí mật theo tiền tố.
   */
  public async getSecretsByPrefix(prefix: string): Promise<Record<string, string>> {
    if (this.provider.getSecretsByPrefix) {
      return this.provider.getSecretsByPrefix(prefix);
    }
    return {};
  }

  /**
   * Xoá toàn bộ cache bộ nhớ (phục vụ khi kích hoạt Secret Rotation).
   */
  public clearCache(): void {
    this.cache.clear();
  }
}
