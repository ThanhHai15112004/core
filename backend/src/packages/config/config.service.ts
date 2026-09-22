import { Injectable } from '@nestjs/common';
import { appConfig, type AppConfig } from './app.config.js';
import { databaseConfig, type DatabaseConfig } from './database.config.js';
import { authConfig, type AuthConfig } from './auth.config.js';
import { cacheConfig, type CacheConfig } from './cache.config.js';
import { storageConfig, type StorageConfig } from './storage.config.js';
import { runtimeConfig, type RuntimeConfig } from './runtime.config.js';

@Injectable()
export class CoreConfigService {
  public readonly app: AppConfig;
  public readonly database: DatabaseConfig;
  public readonly auth: AuthConfig;
  public readonly cache: CacheConfig;
  public readonly storage: StorageConfig;
  public readonly runtime: RuntimeConfig;

  constructor() {
    this.app = appConfig();
    this.database = databaseConfig();
    this.auth = authConfig();
    this.cache = cacheConfig();
    this.storage = storageConfig();
    this.runtime = runtimeConfig();
  }

  public get isProduction(): boolean {
    return this.app.env === 'production';
  }

  public get isDevelopment(): boolean {
    return this.app.env === 'development';
  }

  public get isTest(): boolean {
    return this.app.env === 'test';
  }

  /**
   * Truy xuất cấu hình dạng dot-notation tương tự Laravel config('database.url')
   * Ví dụ: config.get('database.url'), config.get('auth.jwt.accessSecret')
   */
  public get<T = unknown>(path: string): T {
    const root: Record<string, unknown> = {
      app: this.app,
      database: this.database,
      auth: this.auth,
      cache: this.cache,
      storage: this.storage,
      runtime: this.runtime,
    };
    const parts = path.split('.');
    let current: unknown = root;

    for (const part of parts) {
      if (current === undefined || current === null || typeof current !== 'object') {
        return undefined as T;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current as T;
  }
}
