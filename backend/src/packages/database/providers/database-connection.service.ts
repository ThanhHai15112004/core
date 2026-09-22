import { performance } from 'node:perf_hooks';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import { databaseKeys } from '../constants/database.keys.js';
import type { ConnectionState, ConnectionStatus } from '../contracts/database-events.types.js';
import { errorCodeOf, sanitizeDbMessage } from '../instrumentation/error-classify.js';
import { QueryInstrumentService } from '../instrumentation/query-instrument.service.js';
import { recordDbEvent } from '../monitoring/db-events.js';

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** Số lần ping lỗi liên tiếp trước khi chuyển từ `reconnecting` sang `unavailable`. */
const FAILURES_BEFORE_UNAVAILABLE = 3;

/** Backoff lũy thừa có trần: 1s, 2s, 4s … 30s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.max(0, attempt - 1));
}

/**
 * Mở kết nối database nền (không chặn khởi động), kiểm tra sức khoẻ định kỳ bằng `SELECT 1` và tự kết nối lại.
 * Trạng thái được báo lên Redis để System Console thấy từng runtime.
 */
@Injectable()
export class DatabaseConnectionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Database');
  private dataSource: DataSource | null = null;
  private status: ConnectionStatus;
  private failures = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private initializing: Promise<void> | null = null;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly config: CoreConfigService,
    private readonly instrument: QueryInstrumentService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly recorder?: MetricRecorder,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {
    this.status = {
      state: config.database.enabled ? 'connecting' : 'disabled',
      since: new Date().toISOString(),
      lastSuccessAt: null,
      lastPingMs: null,
      lastError: null,
      attempts: 0,
    };
  }

  public onApplicationBootstrap(): void {
    if (!this.config.database.enabled) return;
    try {
      this.dataSource = this.moduleRef.get(DataSource, { strict: false });
    } catch {
      this.dataSource = null;
    }
    if (!this.dataSource) {
      this.transition('unavailable', {
        code: 'NO_DATASOURCE',
        message: 'TypeORM DataSource is not registered',
      });
      return;
    }
    this.schedule(0);
  }

  public async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  public getStatus(): ConnectionStatus {
    return { ...this.status };
  }

  public isConnected(): boolean {
    return this.status.state === 'connected';
  }

  /** DataSource đã kết nối; `null` khi chưa sẵn sàng. */
  public connected(): DataSource | null {
    return this.dataSource?.isInitialized ? this.dataSource : null;
  }

  /** Loại driver TypeORM (`mysql`, `postgres`, `mssql`, `better-sqlite3`…). */
  public get driver(): string {
    if (this.dataSource) return this.dataSource.options.type;
    const configured = this.config.database.connection;
    return configured === 'pgsql'
      ? 'postgres'
      : configured === 'sqlite'
        ? 'better-sqlite3'
        : configured;
  }

  /** Kiểm tra kết nối ngay (Test Connection / health check); không tính vào số liệu query của app. */
  public async ping(): Promise<{
    ok: boolean;
    latencyMs: number | null;
    error: ConnectionStatus['lastError'];
  }> {
    const ds = this.connected();
    if (!ds) {
      return {
        ok: false,
        latencyMs: null,
        error: this.status.lastError ?? {
          code: this.status.state.toUpperCase(),
          message: this.status.state,
        },
      };
    }
    const startedAt = performance.now();
    try {
      await this.instrument.untracked(() => ds.query('SELECT 1'));
      const latencyMs = Math.round((performance.now() - startedAt) * 10) / 10;
      this.recorder?.gauge('db.ping', latencyMs);
      return { ok: true, latencyMs, error: null };
    } catch (err) {
      return {
        ok: false,
        latencyMs: null,
        error: { code: errorCodeOf(err), message: sanitizeDbMessage(err) },
      };
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    if (this.stopped || !this.dataSource) return;
    if (!this.dataSource.isInitialized) {
      await this.initialize();
      return;
    }
    const result = await this.ping();
    if (result.ok) {
      this.failures = 0;
      this.status.lastPingMs = result.latencyMs;
      this.status.lastSuccessAt = new Date().toISOString();
      if (this.status.state !== 'connected') this.transition('connected', null);
      else void this.publish();
    } else {
      this.failures++;
      const next = this.failures >= FAILURES_BEFORE_UNAVAILABLE ? 'unavailable' : 'reconnecting';
      if (next !== this.status.state) this.transition(next, result.error);
      else {
        this.status.lastError = result.error;
        void this.publish();
      }
    }
    this.schedule(result.ok ? this.config.database.healthIntervalMs : retryDelayMs(this.failures));
  }

  private initialize(): Promise<void> {
    this.initializing ??= (async () => {
      const ds = this.dataSource!;
      this.status.attempts++;
      try {
        await ds.initialize();
        this.failures = 0;
        this.status.lastSuccessAt = new Date().toISOString();
        this.transition('connected', null);
        this.schedule(this.config.database.healthIntervalMs);
      } catch (err) {
        this.failures++;
        await this.closePool(ds);
        const error = { code: errorCodeOf(err), message: sanitizeDbMessage(err) };
        const state = this.status.lastSuccessAt
          ? 'reconnecting'
          : this.failures >= FAILURES_BEFORE_UNAVAILABLE
            ? 'unavailable'
            : 'connecting';
        if (state !== this.status.state || this.failures === 1) {
          this.logger.warn(
            `Database connection failed (${error.code ?? 'error'}): ${error.message} — retrying`,
          );
        }
        if (state !== this.status.state) this.transition(state, error);
        else {
          this.status.lastError = error;
          void this.publish();
        }
        this.schedule(retryDelayMs(this.failures));
      } finally {
        this.initializing = null;
      }
    })();
    return this.initializing;
  }

  /** Pool tạo ra trong lần initialize lỗi không tự đóng → đóng để không rò kết nối khi retry. */
  private async closePool(ds: DataSource): Promise<void> {
    const driver = ds.driver as unknown as {
      pool?: { end?: (cb?: () => void) => unknown };
      master?: { end?: () => Promise<void> };
    };
    try {
      if (driver.master?.end) await driver.master.end();
      else if (driver.pool?.end)
        await new Promise<void>((resolve) => driver.pool!.end!(() => resolve()));
    } catch {
      // pool chưa tạo hoặc đã đóng
    }
  }

  private transition(state: ConnectionState, error: ConnectionStatus['lastError']): void {
    const previous = this.status.state;
    this.status = {
      ...this.status,
      state,
      since: new Date().toISOString(),
      lastError: error ?? this.status.lastError,
    };
    if (state === 'connected') this.status.lastError = null;
    if (state === 'connected' && previous !== 'connecting') {
      this.logger.log('Database connection recovered');
      void recordDbEvent(this.redis, {
        type: 'connection_recovered',
        severity: 'success',
        params: {},
        runtime: this.identity?.id ?? null,
      });
    } else if (state === 'connected') {
      this.logger.log(
        `Connected to ${this.driver} ${this.config.database.host}:${this.config.database.port}/${this.config.database.database}`,
      );
    }
    if ((state === 'reconnecting' || state === 'unavailable') && previous === 'connected') {
      void recordDbEvent(this.redis, {
        type: 'connection_lost',
        severity: 'critical',
        params: { code: error?.code ?? '', message: error?.message ?? '' },
        runtime: this.identity?.id ?? null,
      });
    }
    void this.publish();
  }

  /** Báo trạng thái lên Redis (TTL = 3 chu kỳ) để Console gộp theo runtime. */
  private async publish(): Promise<void> {
    const instance = this.recorder?.instance;
    if (!this.redis?.isReady() || !instance) return;
    const ttl = Math.max(15, Math.ceil((this.config.database.healthIntervalMs * 3) / 1000));
    await this.redis.client
      .set(databaseKeys(this.redis).connection(instance), JSON.stringify(this.status), 'EX', ttl)
      .catch(() => undefined);
  }
}
