import { Injectable } from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
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
import type { LogEntry } from '@packages/logging/index.js';

const EVENT_SCAN_LIMIT = 2000;

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Đọc telemetry runtime từ Redis (chỉ đọc, phía API). */
@Injectable()
export class RuntimeStoreService {
  private readonly keys: ReturnType<typeof runtimeKeys>;

  constructor(private readonly redis: RedisService) {
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

  /** Mẫu time-series cũ nhất trước, chỉ lấy trong `sinceMs`. */
  public async samples(id: RuntimeId, sinceMs: number): Promise<RuntimeSample[]> {
    const raws = await this.redis.client.lrange(this.keys.samples(id), 0, -1);
    return raws
      .map((r) => parseJson<RuntimeSample>(r))
      .filter((s): s is RuntimeSample => s !== null && s.t >= sinceMs)
      .reverse();
  }

  /** Log mới nhất trước. */
  public async logs(id: RuntimeId, limit: number): Promise<LogEntry[]> {
    const raws = await this.redis.client.lrange(this.keys.logs(id), 0, limit - 1);
    return raws.map((r) => parseJson<LogEntry>(r)).filter((e): e is LogEntry => e !== null);
  }

  public async cliHistory(limit = 200): Promise<CliExecution[]> {
    const raws = await this.redis.client.lrange(this.keys.cliHistory(), 0, limit - 1);
    return raws.map((r) => parseJson<CliExecution>(r)).filter((e): e is CliExecution => e !== null);
  }
}
