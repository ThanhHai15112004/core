import { getHeapStatistics } from 'node:v8';
import { Injectable } from '@nestjs/common';
import {
  HealthCheckService,
  HealthIndicatorService,
  MemoryHealthIndicator,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { DatabaseConnectionService } from '@packages/database/index.js';
import { RedisService } from '@packages/redis/index.js';

/** Heap dùng quá tỷ lệ này của giới hạn V8 (`--max-old-space-size`) → down. */
const HEAP_LIMIT_RATIO = 0.9;
const PING_TIMEOUT_MS = 2000;

export type HealthIndicatorState = 'up' | 'down';

export interface HealthCheckResult {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  /** Từng phụ thuộc: database (bỏ qua khi `DB_ENABLED=false`), redis, heap. */
  checks: Record<string, { status: HealthIndicatorState } & Record<string, unknown>>;
}

const withTimeout = <T>(task: Promise<T>, ms: number) =>
  Promise.race([
    task,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms).unref(),
    ),
  ]);

/** Health thật qua `@nestjs/terminus`: ping database, PING Redis, heap so với giới hạn V8. */
@Injectable()
export class HealthService {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly memory: MemoryHealthIndicator,
    private readonly database: DatabaseConnectionService,
    private readonly redis: RedisService,
  ) {}

  public async check(): Promise<HealthCheckResult> {
    const result = await this.health
      .check([() => this.checkDatabase(), () => this.checkRedis(), () => this.checkHeap()])
      .catch((err: unknown) => {
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

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    const i = this.indicator.check('database');
    const state = this.database.getStatus().state;
    if (state === 'disabled') return i.up({ state });
    const ping = await this.database.ping();
    return ping.ok
      ? i.up({ state, latencyMs: ping.latencyMs })
      : i.down({ state, error: ping.error?.message ?? state });
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    const i = this.indicator.check('redis');
    try {
      await withTimeout(this.redis.client.ping(), PING_TIMEOUT_MS);
      return i.up();
    } catch (err) {
      return i.down({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  private checkHeap(): Promise<HealthIndicatorResult> {
    return this.memory.checkHeap('heap', getHeapStatistics().heap_size_limit * HEAP_LIMIT_RATIO);
  }
}
