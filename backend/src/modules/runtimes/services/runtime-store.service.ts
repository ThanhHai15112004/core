import { Injectable, Optional } from '@nestjs/common';
import { safeJsonParse, safeJsonParseList } from '@packages/kernel/index.js';
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

  /** Kiểm tra dịch vụ hoặc kết nối có đang sẵn sàng hoạt động hay không */
  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  /** Lấy thông tin lỗi phát sinh gần đây nhất của tiến trình */
  public lastError(): string | null {
    return this.redis.getLastError();
  }

  /** Lấy dữ liệu nhịp tim (heartbeat) định kỳ của các runtime process */
  public async heartbeats(
    ids: readonly LongRunningRuntimeId[],
  ): Promise<Map<RuntimeId, RuntimeHeartbeat>> {
    const raws = await this.redis.client.mget(...ids.map((id) => this.keys.heartbeat(id)));
    const map = new Map<RuntimeId, RuntimeHeartbeat>();
    raws.forEach((raw, i) => {
      const hb = safeJsonParse<RuntimeHeartbeat>(raw);
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
        data: safeJsonParse<RuntimeEvent['data']>(record['data']) ?? {},
      };
    });
  }

  /**
   * Time-series của runtime từ Prometheus (metric mặc định của prom-client, nhãn `runtime`): CPU %, RSS, heap,
   * event loop p99 và số lần khởi động lại (`changes(process_start_time_seconds)`). Không có Prometheus → một điểm
   * từ heartbeat hiện tại (số đo thật lúc này, không có lịch sử).
   */
  public async samples(id: RuntimeId, sinceMs: number): Promise<RuntimeSample[]> {
    const minutes = Math.max(1, Math.round((Date.now() - sinceMs) / 60_000));
    const stepSec = Math.max(15, Math.round((minutes * 60) / 60)); // ~60 điểm
    const w = `${Math.max(60, stepSec * 2)}s`;
    const sel = `{runtime="${id}"}`;
    const queries = {
      cpu: `sum(rate(process_cpu_seconds_total${sel}[${w}])) * 100`,
      mem: `sum(process_resident_memory_bytes${sel}) / 1048576`,
      heap: `sum(nodejs_heap_size_used_bytes${sel}) / 1048576`,
      elp99: `max(nodejs_eventloop_lag_p99_seconds${sel}) * 1000`,
      restarts: `sum(changes(process_start_time_seconds${sel}[${stepSec}s]))`,
    } as const;
    type Field = keyof typeof queries;

    if (this.promClient?.configured) {
      const fields = Object.keys(queries) as Field[];
      const series = await Promise.all(
        fields.map((f) => this.promClient!.safeRange(queries[f], minutes, stepSec)),
      );
      const byTime = new Map<number, RuntimeSample>();
      fields.forEach((f, i) => {
        for (const p of series[i]?.[0]?.points ?? []) {
          const row = byTime.get(p.t) ?? {
            t: p.t,
            cpu: null,
            mem: null,
            heap: null,
            elp99: null,
            restarts: null,
          };
          row[f] = f === 'restarts' ? Math.round(p.v) : Math.round(p.v * 10) / 10;
          byTime.set(p.t, row);
        }
      });
      if (byTime.size > 0) return [...byTime.values()].sort((a, b) => a.t - b.t);
    }

    if (!this.isAvailable()) return [];
    const hb = safeJsonParse<RuntimeHeartbeat>(
      await this.redis.client.get(this.keys.heartbeat(id)),
    );
    if (!hb) return [];
    return [
      {
        t: Date.parse(hb.at),
        cpu: hb.resources.cpuPercent,
        mem: hb.resources.rssMb,
        heap: hb.resources.heapUsedMb,
        elp99: hb.resources.eventLoopP99Ms,
        restarts: null,
      },
    ];
  }

  /** Log mới nhất trước của một runtime (quét `scan` log gần nhất trong stream chung). */
  public async logs(id: RuntimeId, limit: number, scan = limit * 5): Promise<LogEntry[]> {
    const entries = await this.logStream.recent(Math.max(limit, scan));
    return entries.filter((e) => e.runtime === id).slice(0, limit);
  }

  /** Lấy lịch sử các lệnh CLI đã được thực thi */
  public async cliHistory(limit = 200): Promise<CliExecution[]> {
    const raws = await this.redis.client.lrange(this.keys.cliHistory(), 0, limit - 1);
    return safeJsonParseList<CliExecution>(raws);
  }
}
