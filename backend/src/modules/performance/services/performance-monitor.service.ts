import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { PerformanceEventsService, type StoredPerfEvent } from './performance-events.service.js';
import { PerformanceService } from './performance.service.js';
import { diffBottlenecks } from './performance-rules.js';

/**
 * Chạy nền trong API (một instance mỗi chu kỳ nhờ lock Redis): đánh giá rule nghẽn mỗi `PERF_EVALUATE_MS`, lưu
 * trạng thái đang diễn ra (để biết `since`) và ghi sự kiện bắt đầu / nặng thêm / hồi phục.
 */
@Injectable()
export class PerformanceMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('PerformanceMonitor');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly performance: PerformanceService,
    private readonly events: PerformanceEventsService,
    private readonly config: CoreConfigService,
  ) {}

  public onApplicationBootstrap(): void {
    if (this.config.isTest) return;
    const every = Math.max(5000, this.config.performance.evaluateMs);
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref();
    setTimeout(() => void this.tick(), 10_000).unref();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public async tick(now = Date.now()): Promise<void> {
    if (this.running || !this.events.isAvailable() || !this.performance.telemetryConfigured) return;
    this.running = true;
    try {
      const every = Math.max(5000, this.config.performance.evaluateMs);
      const locked = await this.events.client.set(
        this.events.keys.evaluateLock(),
        String(now),
        'PX',
        every - 1000,
        'NX',
      );
      if (locked !== 'OK') return;
      const [violations, active] = await Promise.all([
        this.performance.evaluate(),
        this.events.active(),
      ]);
      if (violations === null) return; // Prometheus không trả lời → giữ nguyên trạng thái.
      const { started, escalated, next, recovered } = diffBottlenecks(violations, active, now);
      const base = (v: (typeof violations)[number]) => ({
        at: now,
        bottleneckId: v.id,
        rule: v.rule,
        runtime: v.runtime,
        severity: v.severity,
        value: v.value,
        threshold: v.threshold,
        unit: v.unit,
      });
      const records: Omit<StoredPerfEvent, 'id'>[] = [
        ...started.map((v) => ({ ...base(v), type: 'started' as const })),
        ...escalated.map((v) => ({ ...base(v), type: 'escalated' as const })),
        ...recovered.map((r) => ({
          at: now,
          type: 'recovered' as const,
          bottleneckId: r.id,
          rule: r.id.split(':')[0] as StoredPerfEvent['rule'],
          runtime: r.id.includes(':') ? r.id.slice(r.id.indexOf(':') + 1) : null,
          severity: r.severity,
          value: 0,
          threshold: 0,
          unit: '',
          durationMs: r.durationMs,
        })),
      ];
      await this.events.save(next, records);
    } catch (err) {
      this.logger.warn(
        `Performance monitor tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
