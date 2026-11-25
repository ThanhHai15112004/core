import { Injectable } from '@nestjs/common';
import { defaultSettingRegistry } from '@packages/kernel/index.js';
import { appConfig, type AppConfig } from './app.config.js';
import { databaseConfig, type DatabaseConfig } from './database.config.js';
import { authConfig, type AuthConfig } from './auth.config.js';
import { cacheConfig, type CacheConfig } from './cache.config.js';
import { storageConfig, type StorageConfig } from './storage.config.js';
import { messagingConfig, type MessagingConfig } from './messaging.config.js';
import { queueConfig, type QueueConfig } from './queue.config.js';
import { schedulerConfig, type SchedulerConfig } from './scheduler.config.js';
import { jobsConfig, type JobsConfig } from './jobs.config.js';
import { logsConfig, type LogsConfig } from './logs.config.js';
import { runtimeConfig, type RuntimeConfig } from './runtime.config.js';
import { trafficConfig, type TrafficConfig } from './traffic.config.js';
import { performanceConfig, type PerformanceConfig } from './performance.config.js';
import { metricsConfig, type MetricsConfig } from './metrics.config.js';
import { tracingConfig, type TracingConfig } from './tracing.config.js';
import { httpClientConfig, type HttpClientConfig } from './http-client.config.js';

/**
 * Kiểm tra fail-fast cấu hình Stateless khi chạy `production`:
 * Ngăn vô tình deploy `STORAGE_DRIVER=local` hoặc `CACHE_DRIVER=memory` lên cụm multi-node.
 * Mô hình 1 server nhỏ có thể chủ đích opt-in qua `STORAGE_ALLOW_LOCAL_IN_PRODUCTION=true` / `CACHE_ALLOW_MEMORY_IN_PRODUCTION=true`.
 */
export function assertProductionStatelessConfig(
  app: Pick<AppConfig, 'env'>,
  storage: Pick<StorageConfig, 'driver' | 'allowLocalInProduction'>,
  cache: Pick<CacheConfig, 'driver' | 'allowMemoryInProduction'>,
): void {
  if (app.env !== 'production') {
    return;
  }
  if (storage.driver === 'local' && !storage.allowLocalInProduction) {
    throw new Error(
      '[ConfigError] STORAGE_DRIVER=local is forbidden in production because instances must be stateless. Configure STORAGE_DRIVER=s3 (S3/MinIO) or explicitly set STORAGE_ALLOW_LOCAL_IN_PRODUCTION=true for single-server deployments.',
    );
  }
  if (cache.driver === 'memory' && !cache.allowMemoryInProduction) {
    throw new Error(
      '[ConfigError] CACHE_DRIVER=memory is forbidden in production because instances must share state. Configure CACHE_DRIVER=redis or explicitly set CACHE_ALLOW_MEMORY_IN_PRODUCTION=true for single-server deployments.',
    );
  }
}

@Injectable()
export class CoreConfigService {
  public readonly app: AppConfig;
  public readonly database: DatabaseConfig;
  public readonly auth: AuthConfig;
  public readonly cache: CacheConfig;
  public readonly storage: StorageConfig;
  public readonly messaging: MessagingConfig;
  public readonly queue: QueueConfig;
  public readonly scheduler: SchedulerConfig;
  public readonly jobs: JobsConfig;
  public readonly logs: LogsConfig;
  public readonly runtime: RuntimeConfig;
  public readonly traffic: TrafficConfig;
  public readonly performance: PerformanceConfig;
  public readonly metrics: MetricsConfig;
  public readonly tracing: TracingConfig;
  public readonly httpClient: HttpClientConfig;

  constructor() {
    this.app = appConfig();
    defaultSettingRegistry.setActiveEnvironment(this.app.env);
    this.database = databaseConfig();
    this.auth = authConfig();
    this.cache = cacheConfig();
    this.storage = storageConfig();
    assertProductionStatelessConfig(this.app, this.storage, this.cache);
    this.messaging = messagingConfig();
    this.queue = queueConfig();
    this.scheduler = schedulerConfig();
    this.jobs = jobsConfig();
    this.logs = logsConfig();
    this.runtime = runtimeConfig();
    this.traffic = trafficConfig();
    this.performance = performanceConfig();
    this.metrics = metricsConfig();
    this.tracing = tracingConfig();
    this.httpClient = httpClientConfig();
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
      messaging: this.messaging,
      queue: this.queue,
      scheduler: this.scheduler,
      jobs: this.jobs,
      logs: this.logs,
      runtime: this.runtime,
      traffic: this.traffic,
      performance: this.performance,
      metrics: this.metrics,
      tracing: this.tracing,
      httpClient: this.httpClient,
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
