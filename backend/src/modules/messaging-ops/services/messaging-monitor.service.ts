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
  queueMetric,
  recordMessagingEvent,
  type ConsumerRegistration,
  type QueueSnapshot,
} from '@packages/messaging/index.js';
import { MetricRecorder } from '@packages/telemetry/index.js';
import { MessagingMetricsService } from './messaging-metrics.service.js';
import { MessagingStoreService } from './messaging-store.service.js';
import {
  diffMessagingAlerts,
  evaluateMessagingRules,
  type MessagingViolation,
  type QueueRuleInput,
} from './messaging-rules.js';

/** Lag là số liệu nổi bật nhất — lấy mẫu dày hơn các monitor khác. */
const TICK_MS = 15_000;
const RULE_WINDOW_MS = 15 * 60_000;

/** Message đang chờ của queue (waiting + prioritized). */
export const waitingOf = (q: QueueSnapshot) => q.counts.waiting + q.counts.prioritized;

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
 * Chạy nền trong API (một instance mỗi chu kỳ nhờ lock Redis): PING broker, ghi gauge lag/độ sâu queue/
 * Dead Letter/consumer để vẽ lịch sử, và đánh giá cảnh báo.
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
    @Optional() private readonly recorder?: MetricRecorder,
    @Optional() private readonly redis?: RedisService,
  ) {}

  public onApplicationBootstrap(): void {
    if (this.config.isTest) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 5000).unref();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

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
        ? await this.monitoring.provider.queues().catch((err) => {
            this.logger.warn(`Queue snapshot failed: ${err instanceof Error ? err.message : err}`);
            return null;
          })
        : null;
      const consumers = await this.monitoring.consumers().catch(() => []);
      if (queues) this.record(queues, now);
      await this.evaluate(queues, consumers, now);
    } catch (err) {
      this.logger.warn(
        `Messaging monitor tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private record(queues: QueueSnapshot[], now: number): void {
    const g = (name: string, v: number) => this.recorder?.gauge(name, v, now);
    let lag = 0;
    let failed = 0;
    let workers = 0;
    for (const q of queues) {
      const waiting = waitingOf(q);
      lag += waiting;
      failed += q.counts.failed;
      workers += q.workers?.length ?? 0;
      g(queueMetric(q.name, 'waiting'), waiting);
      g(queueMetric(q.name, 'active'), q.counts.active);
      g(queueMetric(q.name, 'delayed'), q.counts.delayed);
      g(queueMetric(q.name, 'failed'), q.counts.failed);
    }
    g('msg.lag', lag);
    g('msg.dlq.size', failed);
    g('msg.consumers', workers);
  }

  private async evaluate(
    queues: QueueSnapshot[] | null,
    consumers: ConsumerRegistration[],
    now: number,
  ): Promise<void> {
    const cfg = this.config.messaging;
    const [win, active] = await Promise.all([
      this.metrics.window(now - RULE_WINDOW_MS, now, now, 's10'),
      this.store.activeAlerts(),
    ]);
    const delivery = this.metrics.delivery(win);
    const processing = this.metrics.processing(win);
    const lag = this.metrics.lag(win);
    const payload = this.metrics.payload(win);
    const lagNow = queues ? queues.reduce((s, q) => s + waitingOf(q), 0) : lag.current;
    const violations = evaluateMessagingRules(
      {
        connection: this.connection.getStatus().state,
        queues: queues ? queueRuleInputs(queues, consumers, now) : null,
        lag: { now: lagNow, ago15m: lag.points[0]?.value ?? null },
        consume: {
          ops: delivery.consumed + delivery.failed,
          failureRatePercent: delivery.failureRatePercent,
          p95Ms: processing.p95Ms,
        },
        publish: { ops: delivery.published, failures: delivery.publishFailures },
        deadLetter: queues ? queues.reduce((s, q) => s + q.counts.failed, 0) : null,
        largestMessage:
          payload.maxBytes === null ? null : { bytes: payload.maxBytes, channel: null },
      },
      { ...cfg.rules, largeMessageBytes: cfg.largeMessageKb * 1024 },
    );
    await this.applyAlerts(violations, active, now);
  }

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
