import { Injectable, Optional } from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import { PrometheusQueryClient } from '@packages/metrics/index.js';
import {
  runtimeKeys,
  type CliExecution,
  type LongRunningRuntimeId,
  type RuntimeEvent,
  type RuntimeEventType,
  type RuntimeHeartbeat,
  type RuntimeId,
  type RuntimeSample,
} from '@packages/runtime/index.js';
import { LogStreamReader, type LogEntry } from '@packages/logging/index.js';

const EVENT_SCAN_LIMIT = 2000;

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Đọc telemetry runtime từ Redis và Prometheus (chỉ đọc, phía API). */
@Injectable()
export class RuntimeStoreService {
  private readonly keys: ReturnType<typeof runtimeKeys>;

  constructor(
    private readonly redis: RedisService,
    private readonly logStream: LogStreamReader,
    @Optional() private readonly promClient?: PrometheusQueryClient,
  ) {
    this.keys = runtimeKeys(redis);
  }

  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  public lastError(): string | null {
    return this.redis.getLastError();
  }

  public async heartbeats(
    ids: readonly LongRunningRuntimeId[],
  ): Promise<Map<RuntimeId, RuntimeHeartbeat>> {
    const raws = await this.redis.client.mget(...ids.map((id) => this.keys.heartbeat(id)));
    const map = new Map<RuntimeId, RuntimeHeartbeat>();
    raws.forEach((raw, i) => {
      const hb = parseJson<RuntimeHeartbeat>(raw);
      if (hb) map.set(ids[i]!, hb);
    });
    return map;
  }

  /** Sự kiện mới nhất trước. */
  public async events(limit = EVENT_SCAN_LIMIT): Promise<RuntimeEvent[]> {
    const entries = await this.redis.client.xrevrange(this.keys.events(), '+', '-', 'COUNT', limit);
    return entries.map(([id, fields]) => {
      const record: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) record[fields[i]!] = fields[i + 1]!;
      return {
        id,
        runtime: record['runtime'] as RuntimeId,
        type: record['type'] as RuntimeEventType,
        at: record['at'] ?? new Date(Number(id.split('-')[0])).toISOString(),
        data: parseJson<RuntimeEvent['data']>(record['data']) ?? {},
      };
    });
  }

  /**
   * Truy vấn time-series CPU/RAM qua Prometheus PromQL chuẩn:
   * - CPU: rate(process_cpu_seconds_total{runtime="<id>"}[1m]) * 100
   * - RAM: process_resident_memory_bytes{runtime="<id>"} / (1024 * 1024)
   * - Heap: nodejs_heap_size_used_bytes{runtime="<id>"} / (1024 * 1024)
   */
  public async samples(id: RuntimeId, sinceMs: number): Promise<RuntimeSample[]> {
    const minutes = Math.max(1, Math.round((Date.now() - sinceMs) / 60_000));
    const stepSec = Math.max(15, Math.round((minutes * 60) / 60)); // ~60 điểm đo

    if (this.promClient) {
      try {
        const [cpuSeries, memSeries, heapSeries] = await Promise.all([
          this.promClient.safeRange(
            `rate(process_cpu_seconds_total{runtime="${id}"}[1m]) * 100`,
            minutes,
            stepSec,
          ),
          this.promClient.safeRange(
            `process_resident_memory_bytes{runtime="${id}"} / 1048576`,
            minutes,
            stepSec,
          ),
          this.promClient.safeRange(
            `nodejs_heap_size_used_bytes{runtime="${id}"} / 1048576`,
            minutes,
            stepSec,
          ),
        ]);

        const cpuPoints = cpuSeries[0]?.points ?? [];
        const memPoints = memSeries[0]?.points ?? [];
        const heapPoints = heapSeries[0]?.points ?? [];

        if (cpuPoints.length > 0 || memPoints.length > 0) {
          const byTime = new Map<number, RuntimeSample>();
          for (const p of cpuPoints) {
            byTime.set(p.t, {
              t: p.t,
              cpu: Math.round(p.v * 10) / 10,
              mem: 0,
              heap: 0,
              elp99: 0,
              starts: 1,
            });
          }
          for (const p of memPoints) {
            const existing = byTime.get(p.t) ?? {
              t: p.t,
              cpu: 0,
              mem: 0,
              heap: 0,
              elp99: 0,
              starts: 1,
            };
            existing.mem = Math.round(p.v * 10) / 10;
            byTime.set(p.t, existing);
          }
          for (const p of heapPoints) {
            const existing = byTime.get(p.t);
            if (existing) existing.heap = Math.round(p.v * 10) / 10;
          }
          return [...byTime.values()].sort((a, b) => a.t - b.t);
        }
      } catch {
        // query Prometheus thất bại hoặc chưa có dữ liệu
      }
    }

    // Dự phòng khi Prometheus chưa sẵn sàng: đọc từ heartbeat Redis
    if (this.isAvailable()) {
      const hb = await this.redis.client.get(this.keys.heartbeat(id));
      if (hb) {
        try {
          const parsed = JSON.parse(hb) as RuntimeHeartbeat;
          return [
            {
              t: Date.parse(parsed.at),
              cpu: parsed.resources.cpuPercent,
              mem: parsed.resources.rssMb,
              heap: parsed.resources.heapUsedMb,
              elp99: parsed.resources.eventLoopP99Ms,
              starts: parsed.startCount,
            },
          ];
        } catch {
          // ignore
        }
      }
    }

    return [];
  }

  /** Log mới nhất trước của một runtime (quét `scan` log gần nhất trong stream chung). */
  public async logs(id: RuntimeId, limit: number, scan = limit * 5): Promise<LogEntry[]> {
    const entries = await this.logStream.recent(Math.max(limit, scan));
    return entries.filter((e) => e.runtime === id).slice(0, limit);
  }

  public async cliHistory(limit = 200): Promise<CliExecution[]> {
    const raws = await this.redis.client.lrange(this.keys.cliHistory(), 0, limit - 1);
    return raws.map((r) => parseJson<CliExecution>(r)).filter((e): e is CliExecution => e !== null);
  }
}
