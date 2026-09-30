import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { SCHEDULER_GLOBAL_HISTORY_MAX, schedulerKeys } from '../constants/scheduler.keys.js';
import type {
  ExecutionRecord,
  ScheduledTaskMeta,
  SchedulerEventRecord,
  SchedulerInstanceRecord,
  SchedulerOperationRecord,
  TaskDisabledRecord,
  TaskStateRecord,
} from '../contracts/scheduler.types.js';

const DAY_MS = 24 * 3600_000;
/** Số bản ghi đọc mỗi lượt khi lọc lịch sử (lọc theo trạng thái / trigger). */
const PAGE = 200;

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseHash<T>(hash: Record<string, string>): Map<string, T> {
  const map = new Map<string, T>();
  for (const [k, raw] of Object.entries(hash)) {
    const v = parseJson<T>(raw);
    if (v) map.set(k, v);
  }
  return map;
}

/** Thời điểm xếp lịch sử: lúc bắt đầu, hoặc theo lịch với lần chạy không bắt đầu (skipped / missed). */
export const executionScore = (r: ExecutionRecord) =>
  r.startedAt ?? r.scheduledAt ?? r.finishedAt ?? Date.now();

export interface ExecutionQuery {
  /** epoch ms, bao gồm hai đầu. */
  from: number;
  to: number;
  limit: number;
  taskId?: string | null;
  /** Chỉ bản ghi lỗi / lỡ lịch (đọc chỉ mục riêng). */
  problemsOnly?: boolean;
  filter?: (r: ExecutionRecord) => boolean;
  /** Số bản ghi tối đa được xét khi có `filter` (tránh quét cả lịch sử). */
  scanMax?: number;
}

/**
 * Lưu trữ Scheduler trong Redis, dùng chung cho Scheduler runtime (ghi) và System Console (đọc):
 * registry task, trạng thái, task bị tắt, instance, lịch sử thực thi (có thời hạn), sự kiện, audit.
 */
@Injectable()
export class SchedulerStore {
  public readonly keys: ReturnType<typeof schedulerKeys>;

  constructor(
    private readonly redis: RedisService,
    private readonly config: CoreConfigService,
  ) {
    this.keys = schedulerKeys(redis);
  }

  public get client() {
    return this.redis.client;
  }

  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  private get retentionMs() {
    return this.config.scheduler.historyRetentionDays * DAY_MS;
  }

  // ─── Registry / trạng thái ────────────────────────────────────────────────

  /** Thay toàn bộ registry bằng danh sách task của phiên bản đang chạy. */
  public async publishTasks(metas: ScheduledTaskMeta[]): Promise<void> {
    const pipe = this.client.multi().del(this.keys.tasks());
    for (const m of metas) pipe.hset(this.keys.tasks(), m.id, JSON.stringify(m));
    await pipe.exec();
  }

  public async tasks(): Promise<Map<string, ScheduledTaskMeta>> {
    return parseHash<ScheduledTaskMeta>(await this.client.hgetall(this.keys.tasks()));
  }

  public async task(id: string): Promise<ScheduledTaskMeta | null> {
    return parseJson<ScheduledTaskMeta>(await this.client.hget(this.keys.tasks(), id));
  }

  public async states(): Promise<Map<string, TaskStateRecord>> {
    return parseHash<TaskStateRecord>(await this.client.hgetall(this.keys.state()));
  }

  public async setState(taskId: string, state: TaskStateRecord): Promise<void> {
    await this.client.hset(this.keys.state(), taskId, JSON.stringify(state));
  }

  public async disabled(): Promise<Map<string, TaskDisabledRecord>> {
    return parseHash<TaskDisabledRecord>(await this.client.hgetall(this.keys.disabled()));
  }

  public async instances(): Promise<Map<string, SchedulerInstanceRecord>> {
    return parseHash<SchedulerInstanceRecord>(await this.client.hgetall(this.keys.instances()));
  }

  public async running(): Promise<ExecutionRecord[]> {
    return [...parseHash<ExecutionRecord>(await this.client.hgetall(this.keys.running())).values()];
  }

  // ─── Lịch sử thực thi ─────────────────────────────────────────────────────

  /** Ghi (hoặc cập nhật) một lần chạy và chỉ mục của nó; lần chạy đang diễn ra nằm thêm trong `running`. */
  public async saveExecution(r: ExecutionRecord): Promise<void> {
    const score = executionScore(r);
    const json = JSON.stringify(r);
    const taskKey = this.keys.taskExecutions(r.taskId);
    const pipe = this.client
      .multi()
      .set(this.keys.execution(r.id), json, 'PX', this.retentionMs)
      .zadd(this.keys.executions(), score, r.id)
      .zadd(taskKey, score, r.id)
      .zremrangebyrank(taskKey, 0, -(this.config.scheduler.historyMaxPerTask + 1));
    if (r.status === 'failed' || r.status === 'missed')
      pipe.zadd(this.keys.problems(), score, r.id);
    if (r.status === 'running') pipe.hset(this.keys.running(), r.id, json);
    else pipe.hdel(this.keys.running(), r.id);
    await pipe.exec();
  }

  public async execution(id: string): Promise<ExecutionRecord | null> {
    return parseJson<ExecutionRecord>(await this.client.get(this.keys.execution(id)));
  }

  public async executionsByIds(ids: string[]): Promise<ExecutionRecord[]> {
    if (ids.length === 0) return [];
    const raws = await this.client.mget(...ids.map((id) => this.keys.execution(id)));
    return raws.map((r) => parseJson<ExecutionRecord>(r)).filter((r): r is ExecutionRecord => !!r);
  }

  /** Lần chạy trong khoảng thời gian, mới nhất trước; có `filter` thì đọc theo trang tới khi đủ `limit`. */
  public async executions(
    q: ExecutionQuery,
  ): Promise<{ items: ExecutionRecord[]; truncated: boolean }> {
    const key = q.problemsOnly
      ? this.keys.problems()
      : q.taskId
        ? this.keys.taskExecutions(q.taskId)
        : this.keys.executions();
    const scanMax = q.filter || (q.problemsOnly && q.taskId) ? (q.scanMax ?? 5000) : q.limit;
    const items: ExecutionRecord[] = [];
    let offset = 0;
    while (items.length < q.limit && offset < scanMax) {
      const size = Math.min(PAGE, scanMax - offset);
      const ids = await this.client.zrevrangebyscore(key, q.to, q.from, 'LIMIT', offset, size);
      if (ids.length === 0) return { items, truncated: false };
      offset += ids.length;
      for (const r of await this.executionsByIds(ids)) {
        if (q.problemsOnly && q.taskId && r.taskId !== q.taskId) continue;
        if (q.filter && !q.filter(r)) continue;
        items.push(r);
        if (items.length >= q.limit) return { items, truncated: true };
      }
      if (ids.length < size) return { items, truncated: false };
    }
    return { items, truncated: offset >= scanMax };
  }

  public async countExecutions(from: number, to: number, taskId?: string | null): Promise<number> {
    const key = taskId ? this.keys.taskExecutions(taskId) : this.keys.executions();
    return this.client.zcount(key, from, to);
  }

  /** Xoá chỉ mục quá hạn giữ lịch sử (bản ghi JSON tự hết hạn theo TTL). */
  public async prune(taskIds: string[], now = Date.now()): Promise<number> {
    const before = now - this.retentionMs;
    const pipe = this.client
      .multi()
      .zremrangebyscore(this.keys.executions(), '-inf', before)
      .zremrangebyrank(this.keys.executions(), 0, -(SCHEDULER_GLOBAL_HISTORY_MAX + 1))
      .zremrangebyscore(this.keys.problems(), '-inf', before);
    for (const id of taskIds) pipe.zremrangebyscore(this.keys.taskExecutions(id), '-inf', before);
    const res = (await pipe.exec()) ?? [];
    return res.reduce((sum, [, n]) => sum + (typeof n === 'number' ? n : 0), 0);
  }

  // ─── Sự kiện / audit ──────────────────────────────────────────────────────

  public async events(): Promise<SchedulerEventRecord[]> {
    return (await this.client.lrange(this.keys.events(), 0, -1))
      .map((r) => parseJson<SchedulerEventRecord>(r))
      .filter((e): e is SchedulerEventRecord => !!e);
  }

  public async operations(): Promise<SchedulerOperationRecord[]> {
    return (await this.client.lrange(this.keys.operations(), 0, -1))
      .map((r) => parseJson<SchedulerOperationRecord>(r))
      .filter((e): e is SchedulerOperationRecord => !!e);
  }
}
