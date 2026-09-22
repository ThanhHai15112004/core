import { randomBytes } from 'node:crypto';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { PerformanceService } from './performance.service.js';
import {
  PerformanceStoreService,
  type ActiveRuleState,
  type StoredPerfEvent,
} from './performance-store.service.js';
import type { Violation } from './performance-rules.js';

/**
 * Đánh giá rule định kỳ để ghi lại lúc một điểm nghẽn bắt đầu / nặng lên / hồi phục
 * (trang Performance và marker trên biểu đồ đọc lại). Nhiều instance API → chỉ một instance chạy mỗi chu kỳ (lock Redis).
 */
@Injectable()
export class PerformanceMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PerformanceMonitorService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly performance: PerformanceService,
    private readonly store: PerformanceStoreService,
    private readonly config: CoreConfigService,
  ) {}

  private get cfg() {
    return this.config.performance;
  }

  public onApplicationBootstrap(): void {
    if (!this.cfg.enabled || this.config.isTest) return;
    this.timer = setInterval(() => void this.tick(), this.cfg.evaluateMs);
    this.timer.unref();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Một chu kỳ đánh giá; trả về số sự kiện đã ghi (public để test). */
  public async tick(now = Date.now()): Promise<number> {
    if (this.running || !this.store.isAvailable()) return 0;
    this.running = true;
    try {
      const keys = this.store.telemetryKeys;
      const lockMs = Math.max(1000, this.cfg.evaluateMs - 1000);
      const locked = await this.store.client.set(
        keys.evaluateLock(),
        String(now),
        'PX',
        lockMs,
        'NX',
      );
      if (locked !== 'OK') return 0;

      const [{ violations }, active] = await Promise.all([
        this.performance.evaluate(now),
        this.store.activeRules(),
      ]);
      const { events, next } = diffRules(violations, active, now);
      const pipe = this.store.client.pipeline();
      for (const [id, state] of next.set) pipe.hset(keys.activeRules(), id, JSON.stringify(state));
      if (next.removed.length) pipe.hdel(keys.activeRules(), ...next.removed);
      if (events.length) {
        pipe.lpush(keys.events(), ...events.map((e) => JSON.stringify(e)));
        pipe.ltrim(keys.events(), 0, this.cfg.eventLogSize - 1);
      }
      await pipe.exec();
      return events.length;
    } catch (err) {
      this.logger.warn(
        `Performance evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }
}

/** So trạng thái vi phạm mới với trạng thái đã lưu → sự kiện bắt đầu / nặng lên / hồi phục. */
export function diffRules(
  violations: readonly Violation[],
  active: ReadonlyMap<string, ActiveRuleState>,
  now: number,
): { events: StoredPerfEvent[]; next: { set: Map<string, ActiveRuleState>; removed: string[] } } {
  const events: StoredPerfEvent[] = [];
  const set = new Map<string, ActiveRuleState>();
  const event = (
    type: StoredPerfEvent['type'],
    v: Violation,
    extra: Partial<StoredPerfEvent> = {},
  ) =>
    events.push({
      id: `pe_${randomBytes(6).toString('hex')}`,
      at: now,
      type,
      bottleneckId: v.id,
      rule: v.rule,
      runtime: v.runtime,
      severity: v.severity,
      value: v.value,
      threshold: v.threshold,
      unit: v.unit,
      ...extra,
    });

  const seen = new Set<string>();
  for (const v of violations) {
    seen.add(v.id);
    const prev = active.get(v.id);
    if (!prev) {
      set.set(v.id, { since: now, severity: v.severity });
      event('started', v);
    } else if (prev.severity !== v.severity) {
      set.set(v.id, { since: prev.since, severity: v.severity });
      if (v.severity === 'critical') event('escalated', v);
    }
  }
  const removed: string[] = [];
  for (const [id, state] of active) {
    if (seen.has(id)) continue;
    removed.push(id);
    const [rule, runtime] = id.split(':');
    events.push({
      id: `pe_${randomBytes(6).toString('hex')}`,
      at: now,
      type: 'recovered',
      bottleneckId: id,
      rule: rule as Violation['rule'],
      runtime: runtime ?? null,
      severity: state.severity,
      value: 0,
      threshold: 0,
      unit: '',
      durationMs: now - state.since,
    });
  }
  return { events, next: { set, removed } };
}
