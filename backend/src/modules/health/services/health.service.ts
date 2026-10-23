import { getHeapStatistics } from 'node:v8';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  HealthCheckService,
  HealthIndicatorService,
  MemoryHealthIndicator,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { DatabaseConnectionService } from '@packages/database/index.js';
import { RedisService } from '@packages/redis/index.js';
import { StorageConnectionService } from '@packages/storage/index.js';

/** Heap dùng quá tỷ lệ này của giới hạn V8 (`--max-old-space-size`) → down. */
const HEAP_LIMIT_RATIO = 0.9;
const PING_TIMEOUT_MS = 2000;

export type HealthIndicatorState = 'up' | 'down';

export interface HealthCheckResult {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  /** Từng phụ thuộc: database (bỏ qua khi `DB_ENABLED=false`), redis, storage, heap. */
  checks: Record<string, { status: HealthIndicatorState } & Record<string, unknown>>;
}

/** Bọc Promise với thời gian timeout giới hạn */
const withTimeout = <T>(task: Promise<T>, ms: number) =>
  Promise.race([
    task,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms).unref(),
    ),
  ]);

/** Health thật qua `@nestjs/terminus`: ping database, PING Redis, kiểm tra Storage, heap so với giới hạn V8. */
@Injectable()
export class HealthService {
  constructor(
    @Inject(HealthCheckService) private readonly health: HealthCheckService,
    @Inject(HealthIndicatorService) private readonly indicator: HealthIndicatorService,
    @Inject(MemoryHealthIndicator) private readonly memory: MemoryHealthIndicator,
    @Inject(DatabaseConnectionService) private readonly database: DatabaseConnectionService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Optional()
    @Inject(StorageConnectionService)
    private readonly storageConnection?: StorageConnectionService,
  ) {}

  /** Thực hiện kiểm tra sức khỏe toàn diện các thành phần (DB, Redis, Storage, Heap) */
  public async check(): Promise<HealthCheckResult> {
    const indicators: (() => Promise<HealthIndicatorResult>)[] = [
      () => this.checkDatabase(),
      () => this.checkRedis(),
      ...(this.storageConnection ? [() => this.checkStorage()] : []),
      () => this.checkHeap(),
    ];
    const result = await this.health.check(indicators).catch((err: unknown) => {
      // Indicator down → terminus ném ServiceUnavailableException kèm kết quả đầy đủ.
      const res = (err as { getResponse?: () => unknown }).getResponse?.();
      if (res && typeof res === 'object' && 'details' in res)
        return res as Awaited<ReturnType<HealthCheckService['check']>>;
      throw err;
    });
    return {
      status: result.status === 'ok' ? 'ok' : 'degraded',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks: result.details as HealthCheckResult['checks'],
    };
  }

  /** Kiểm tra trạng thái kết nối và độ trễ tới cơ sở dữ liệu */
  private async checkDatabase(): Promise<HealthIndicatorResult> {
    const i = this.indicator.check('database');
    const state = this.database.getStatus().state;
    if (state === 'disabled') return i.up({ state });
    const ping = await this.database.ping();
    return ping.ok
      ? i.up({ state, latencyMs: ping.latencyMs })
      : i.down({ state, error: ping.error?.message ?? state });
  }

  /** Kiểm tra kết nối ping tới dịch vụ Redis */
  private async checkRedis(): Promise<HealthIndicatorResult> {
    const i = this.indicator.check('redis');
    try {
      await withTimeout(this.redis.client.ping(), PING_TIMEOUT_MS);
      return i.up();
    } catch (err) {
      return i.down({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Kiểm tra trạng thái kết nối tới dịch vụ Lưu trữ (Storage Provider — Mục 6.4.5) */
  private async checkStorage(): Promise<HealthIndicatorResult> {
    const i = this.indicator.check('storage');
    if (!this.storageConnection) return i.up({ state: 'disabled' });
    try {
      const status = await withTimeout(this.storageConnection.check(), PING_TIMEOUT_MS);
      return status.state === 'connected'
        ? i.up({ state: status.state, latencyMs: status.lastPingMs })
        : i.down({ state: status.state, error: status.lastError ?? status.state });
    } catch (err) {
      return i.down({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Kiểm tra mức độ tiêu thụ bộ nhớ V8 Heap */
  private checkHeap(): Promise<HealthIndicatorResult> {
    return this.memory.checkHeap('heap', getHeapStatistics().heap_size_limit * HEAP_LIMIT_RATIO);
  }
}
