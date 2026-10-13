import {
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  MessagingConnectionService,
  MessagingMonitoringService,
  recordMessagingEvent,
  type ConsumerRegistration,
  type QueueSnapshot,
} from '@packages/messaging/index.js';
import { MessagingMetricsService } from './messaging-metrics.service.js';
import { MessagingStoreService } from './messaging-store.service.js';
import {
  diffMessagingAlerts,
  evaluateMessagingRules,
  type MessagingViolation,
  type QueueRuleInput,
} from './messaging-rules.js';

const TICK_MS = 15_000;
const RULE_WINDOW_MIN = 15;

/** Message đang chờ của queue (waiting + prioritized). */
export const waitingOf = (q: QueueSnapshot) => q.counts.waiting + q.counts.prioritized;

/** Chuẩn hóa các tham số đầu vào cho quy tắc hàng đợi */
export function queueRuleInputs(
  queues: QueueSnapshot[],
  consumers: ConsumerRegistration[],
  now: number,
): QueueRuleInput[] {
  return queues.map((q) => {
    const regs = consumers.filter((c) => c.queue === q.name);
    return {
      name: q.name,
      waiting: waitingOf(q),
      failed: q.counts.failed,
      workers: q.workers?.length ?? null,
      activeConsumers: regs.filter((c) => !c.paused).length,
      registeredConsumers: regs.length,
      oldestWaitingMin: q.oldestWaitingAt === null ? null : (now - q.oldestWaitingAt) / 60_000,
    };
  });
}

/**
 * Chạy nền trong API (một instance mỗi chu kỳ nhờ lock Redis): PING broker và đánh giá cảnh báo. Độ sâu queue cho
 * biểu đồ do monitor Worker & Queue ghi vào gauge `core_queue_jobs`; tốc độ/lỗi/thời gian xử lý đọc bằng PromQL.
 */
@Injectable()
export class MessagingMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('MessagingMonitor');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly connection: MessagingConnectionService,
    private readonly monitoring: MessagingMonitoringService,
    private readonly metrics: MessagingMetricsService,
    private readonly store: MessagingStoreService,
    private readonly config: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /** Thực thi tác vụ khởi động sau khi toàn bộ ứng dụng hoàn tất bootstrap */
  public onApplicationBootstrap(): void {
    if (this.config.isTest) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 5000).unref();
  }

  /** Dọn dẹp tài nguyên và ngắt kết nối khi module bị hủy */
  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Thực hiện kiểm tra định kỳ và cập nhật trạng thái kết nối */
  public async tick(now = Date.now()): Promise<void> {
    if (this.running || !this.store.isAvailable()) return;
    this.running = true;
    try {
      const locked = await this.store.client.set(
        this.store.keys.collectLock(),
        String(now),
        'PX',
        TICK_MS - 1000,
        'NX',
      );
      if (locked !== 'OK') return;
      await this.connection.check();
      const queues = this.monitoring.usable()
        ? await this.monitoring.queues().catch((err) => {
            this.logger.warn(`Queue snapshot failed: ${err instanceof Error ? err.message : err}`);
            return null;
          })
        : null;
      const consumers = await this.monitoring.consumers().catch(() => []);
      await this.evaluate(queues, consumers, now);
    } catch (err) {
      this.logger.warn(
        `Messaging monitor tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Đánh giá các điều kiện và phát hiện cảnh báo bất thường */
  private async evaluate(
    queues: QueueSnapshot[] | null,
    consumers: ConsumerRegistration[],
    now: number,
  ): Promise<void> {
    const [win, lagAgo, active] = await Promise.all([
      this.metrics.window(now - RULE_WINDOW_MIN * 60_000, now, now, false),
      this.metrics.lagAgo(RULE_WINDOW_MIN),
      this.store.activeAlerts(),
    ]);
    const delivery = this.metrics.delivery(win);
    const lagNow = queues ? queues.reduce((s, q) => s + waitingOf(q), 0) : null;
    const violations = evaluateMessagingRules(
      {
        connection: this.connection.getStatus().state,
        queues: queues ? queueRuleInputs(queues, consumers, now) : null,
        lag: { now: lagNow, ago15m: lagAgo },
        consume: delivery && {
          ops: delivery.consumed + delivery.failed,
          failureRatePercent: delivery.failureRatePercent,
          p95Ms: this.metrics.processing(win).p95Ms,
        },
        publish: delivery && { ops: delivery.published, failures: delivery.publishFailures },
        deadLetter: queues ? queues.reduce((s, q) => s + q.counts.failed, 0) : null,
      },
      this.config.messaging.rules,
    );
    await this.applyAlerts(violations, active, now);
  }

  /** Cập nhật danh sách các cảnh báo hiện thời của hệ thống */
  private async applyAlerts(
    violations: MessagingViolation[],
    active: Awaited<ReturnType<MessagingStoreService['activeAlerts']>>,
    now: number,
  ): Promise<void> {
    const { started, set, recovered } = diffMessagingAlerts(violations, active, now);
    const key = this.store.keys.activeAlerts();
    const pipe = this.store.client.pipeline();
    for (const [id, state] of set) pipe.hset(key, id, JSON.stringify(state));
    if (recovered.length) pipe.hdel(key, ...recovered.map((r) => r.id));
    await pipe.exec();
    for (const v of started) {
      if (v.severity === 'info') continue;
      await recordMessagingEvent(this.redis, {
        type: 'alert_started',
        severity: v.severity,
        params: { rule: v.id, value: v.value, threshold: v.threshold, unit: v.unit, ...v.extra },
        runtime: null,
        at: now,
      });
    }
    for (const r of recovered) {
      if (r.alert.severity === 'info') continue;
      await recordMessagingEvent(this.redis, {
        type: 'alert_recovered',
        severity: 'success',
        params: {
          rule: r.id,
          minutes: Math.max(1, Math.round(r.durationMs / 60_000)),
          ...r.alert.extra,
        },
        runtime: null,
        at: now,
      });
    }
  }
}
