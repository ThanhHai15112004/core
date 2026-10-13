import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  MessagingConnectionService,
  MessagingMonitoringService,
  MessagingOperationError,
  MessagingOperationsService,
  type BacklogSample,
  type ConsumerRegistration,
  type MessageFilter,
  type MessageSummary,
  type MessagingErrorKind,
  type MessagingErrorRecord,
  type MessagingEventRecord,
  type MessagingOperationRecord,
  type OperationContext,
  type QueueSnapshot,
} from '@packages/messaging/index.js';
import { QUEUE_JOBS_METRIC } from '@modules/worker-ops/index.js';
import {
  MessagingMetricsService,
  labelValue,
  type MetricWindow,
} from './messaging-metrics.service.js';
import { MessagingStoreService } from './messaging-store.service.js';
import { waitingOf } from './messaging-monitor.service.js';
import {
  RULE_TAB,
  ruleOf,
  type MessagingRule,
  type StoredMessagingAlert,
} from './messaging-rules.js';
import {
  MessagingActionRejectedException,
  MessagingNotConnectedException,
  MessagingNotFoundException,
} from '../exceptions/messaging-ops.exceptions.js';
import type {
  ChannelDetailDto,
  ChannelRowDto,
  ChannelStatus,
  ConsumerDetailDto,
  ConsumerRowDto,
  ConsumerStatus,
  LifecycleEntryDto,
  MessageDetailDto,
  MessageRowDto,
  MessagingAlertDto,
  MessagingBrokerDto,
  MessagingChannelsDto,
  MessagingConfigDto,
  MessagingConsumersDto,
  MessagingDeadLetterDto,
  MessagingErrorDto,
  MessagingErrorsDto,
  MessagingEventDto,
  MessagingHealthDto,
  MessagingMessagesDto,
  MessagingMetric,
  MessagingMetricsDto,
  MessagingOperationDto,
  MessagingOverviewDto,
  MessagingRange,
  MessagingReportDto,
  MessagingRetriesDto,
  MessagingSeriesDto,
  MessagingSettingsDto,
  MessagingTestDto,
  QueueRowDto,
  SectionDto,
} from '../responses/messaging-ops.response.js';
import { changePercent, round } from '@packages/metrics/index.js';

export const MESSAGING_RANGES: Record<MessagingRange, number> = {
  '15m': 15,
  '1h': 60,
  '6h': 360,
  '24h': 1440,
};
export const MESSAGING_METRICS: MessagingMetric[] = ['throughput', 'lag', 'failures', 'processing'];

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const OVERVIEW_CHANNELS = 8;
const ERROR_LIST_LIMIT = 200;
const RECENT_LIMIT = 20;
const DEAD_LETTER_LIMIT = 200;
const RETRY_LIMIT = 200;
const LAG_TREND_MIN = 15;
/** Chênh lệch publish − consume nhỏ hơn mức này (msg/s) coi là cân bằng. */
const BALANCE_EPSILON = 0.01;
const ERROR_KINDS: MessagingErrorKind[] = [
  'processing',
  'timeout',
  'deserialize',
  'connection',
  'stalled',
];

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const iso = (t: number | null | undefined) =>
  t === null || t === undefined ? null : new Date(t).toISOString();
const secondsSince = (t: number | null, now: number) =>
  t === null ? null : Math.max(0, Math.round((now - t) / 1000));

type SeriesDef = { id: string; unit: string; expr: string };
interface Live {
  queues: SectionDto<QueueSnapshot[]>;
  consumers: ConsumerRegistration[];
}

/**
 * Messaging Monitor: health broker, throughput publish/consume, lag, channel/consumer, message explorer + vòng đời,
 * retry, Dead Letter, lỗi & sự kiện, thao tác có kiểm soát. Trạng thái hiện tại đọc từ BullMQ, lịch sử từ
 * Prometheus. Không có số liệu giả: thiếu nguồn → `null` hoặc lý do.
 */
@Injectable()
export class MessagingOpsService {
  constructor(
    private readonly connection: MessagingConnectionService,
    private readonly monitoring: MessagingMonitoringService,
    private readonly operations: MessagingOperationsService,
    private readonly metrics: MessagingMetricsService,
    private readonly store: MessagingStoreService,
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
  ) {}

  private get cfg() {
    return this.config.messaging;
  }

  private get largeBytes() {
    return this.cfg.largeMessageKb * 1024;
  }

  private settings(): MessagingSettingsDto {
    const c = this.cfg;
    const s = (cap: Parameters<MessagingMonitoringService['supports']>[0]) =>
      this.monitoring.supports(cap);
    return {
      retry: c.retry && s('retry'),
      replay: c.replay && s('replay'),
      discard: c.discard && s('discard'),
      payload: c.payload && s('browse'),
    };
  }

  private rangeWindow(range: MessagingRange, now: number) {
    return this.metrics.window(now - MESSAGING_RANGES[range] * MINUTE, now, now);
  }

  // ─── Nguồn dùng chung ─────────────────────────────────────────────────────

  private async live(): Promise<Live> {
    const [queues, consumers] = await Promise.all([
      this.monitoring.section('queueDepth', () => this.monitoring.queues()),
      this.monitoring.consumers().catch(() => [] as ConsumerRegistration[]),
    ]);
    return { queues, consumers };
  }

  private queueRows(live: Live, now: number): SectionDto<QueueRowDto[]> {
    if (!live.queues.available) return live.queues;
    return {
      available: true,
      data: live.queues.data.map((q) => ({
        name: q.name,
        waiting: waitingOf(q),
        active: q.counts.active,
        delayed: q.counts.delayed,
        failed: q.counts.failed,
        paused: q.paused,
        workers: q.workers?.length ?? null,
        consumers: [
          ...new Set(live.consumers.filter((c) => c.queue === q.name).map((c) => c.consumer)),
        ],
        oldestWaitingSec: secondsSince(q.oldestWaitingAt, now),
      })),
    };
  }

  /** Channel = nhãn `channel` có lưu lượng trong Prometheus ∪ channel có message đang chờ trong broker. */
  private channelRows(
    win: MetricWindow | null,
    backlog: BacklogSample | null,
    live: Live,
    now: number,
  ): ChannelRowDto[] {
    const names = new Set<string>([
      ...(backlog?.channels.map((c) => c.channel) ?? []),
      ...(win?.channels.keys() ?? []),
    ]);
    const queues = live.queues.available ? live.queues.data : null;
    const rows = [...names].map((name) => {
      const m = this.metrics.channel(win, name);
      const waiting = backlog?.channels.filter((c) => c.channel === name) ?? [];
      const queue = waiting[0]?.queue ?? win?.channelQueue.get(name) ?? null;
      const lag = backlog ? waiting.reduce((s, c) => s + c.waiting, 0) : null;
      const oldest = waiting.reduce<number | null>(
        (min, c) => (c.oldestAt !== null && (min === null || c.oldestAt < min) ? c.oldestAt : min),
        null,
      );
      const q = queues?.find((x) => x.name === queue) ?? null;
      const published = m?.published ?? null;
      const consumed = m?.consumed ?? null;
      const row: Omit<ChannelRowDto, 'status'> = {
        channel: name,
        queue,
        failed: m?.failed ?? null,
        retried: m?.retried ?? null,
        deadLettered: m?.deadLettered ?? null,
        publishPerSec: this.metrics.perSec(win, published),
        consumePerSec: this.metrics.perSec(win, consumed),
        failureRatePercent: this.metrics.failureRate(m),
        lag,
        oldestWaitingSec: secondsSince(oldest, now),
        avgMs: m?.processing.avgMs ?? null,
        p95Ms: m?.processing.p95Ms ?? null,
      };
      return {
        row: { ...row, status: this.channelStatus(row, published, consumed, q) },
        traffic: (published ?? 0) + (consumed ?? 0),
      };
    });
    const rank: Record<ChannelStatus, number> = {
      no_consumer: 0,
      high_failure: 1,
      lagging: 2,
      healthy: 3,
      idle: 4,
    };
    return rows
      .sort(
        (a, b) =>
          rank[a.row.status] - rank[b.row.status] ||
          b.traffic - a.traffic ||
          a.row.channel.localeCompare(b.row.channel),
      )
      .map((x) => x.row);
  }

  private channelStatus(
    row: Omit<ChannelRowDto, 'status'>,
    published: number | null,
    consumed: number | null,
    q: QueueSnapshot | null,
  ): ChannelStatus {
    const r = this.cfg.rules;
    const ops = (consumed ?? 0) + (row.failed ?? 0);
    if ((row.lag ?? 0) > 0 && q && q.workers !== null && q.workers.length === 0)
      return 'no_consumer';
    if (ops >= r.minOps && (row.failureRatePercent ?? 0) >= r.failureRatePercent)
      return 'high_failure';
    if ((row.lag ?? 0) >= r.lagWarn) return 'lagging';
    if (published === 0 && ops === 0 && !row.lag) return 'idle';
    return 'healthy';
  }

  private consumerRows(win: MetricWindow | null, live: Live): ConsumerRowDto[] {
    const groups = new Map<string, ConsumerRegistration[]>();
    for (const c of live.consumers) {
      const key = `${c.consumer}\u0000${c.queue}`;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    const queues = live.queues.available ? live.queues.data : null;
    const r = this.cfg.rules;
    return [...groups.values()].map((regs) => {
      const first = regs[0]!;
      // Số đo theo queue: mỗi queue chỉ có một loại consumer (processor) tiêu thụ.
      const m = this.metrics.queue(win, first.queue);
      const failureRate = this.metrics.failureRate(m);
      const q = queues?.find((x) => x.name === first.queue) ?? null;
      const lag = q ? waitingOf(q) : null;
      const brokerWorkers = q?.workers?.length ?? null;
      const ops = m ? m.consumed + m.failed : 0;
      const status: ConsumerStatus =
        brokerWorkers === 0
          ? 'offline'
          : regs.every((x) => x.paused)
            ? 'paused'
            : ops >= r.minOps && (failureRate ?? 0) >= r.failureRatePercent
              ? 'high_failure'
              : ops >= r.minOps && (m?.processing.p95Ms ?? 0) >= r.processingP95Ms
                ? 'slow'
                : (lag ?? 0) >= r.lagWarn
                  ? 'lagging'
                  : 'healthy';
      return {
        consumer: first.consumer,
        queue: first.queue,
        runtime: first.runtime,
        instances: regs.map((x) => ({
          instance: x.instance,
          concurrency: x.concurrency,
          paused: x.paused,
          startedAt: new Date(x.startedAt).toISOString(),
        })),
        brokerWorkers,
        failed: m?.failed ?? null,
        perSec: this.metrics.perSec(win, m?.consumed ?? null),
        failureRatePercent: failureRate,
        avgMs: m?.processing.avgMs ?? null,
        p95Ms: m?.processing.p95Ms ?? null,
        p99Ms: m?.processing.p99Ms ?? null,
        lag,
        idempotent: regs.some((x) => x.idempotent === false)
          ? false
          : regs.every((x) => x.idempotent === true)
            ? true
            : null,
        status,
      };
    });
  }

  private messageRow(m: MessageSummary): MessageRowDto {
    return {
      ...m,
      publishedAt: new Date(m.publishedAt).toISOString(),
      processedAt: iso(m.processedAt),
      finishedAt: iso(m.finishedAt),
      nextAttemptAt: iso(m.nextAttemptAt),
      large: m.size >= this.largeBytes,
    };
  }

  private report(w: MetricWindow | null): MessagingReportDto | null {
    const d = this.metrics.delivery(w);
    if (!w || !d) return null;
    return {
      published: d.published,
      consumed: d.consumed,
      failed: d.failed + d.publishFailures,
      retried: d.retried,
      deadLettered: d.deadLettered,
      avgProcessingMs: this.metrics.processing(w).avgMs,
      avgLag: w.total.lag.avg,
      peakLag: w.total.lag.peak,
    };
  }

  // ─── Overview ─────────────────────────────────────────────────────────────

  public async getOverview(range: MessagingRange): Promise<MessagingOverviewDto> {
    const now = Date.now();
    const today = startOfDay(now);
    const [win, ago, todayWin, yesterdayWin, live, backlog, alerts, dlq] = await Promise.all([
      this.rangeWindow(range, now),
      this.metrics.lagAgo(LAG_TREND_MIN),
      this.metrics.window(today, now, now, false),
      this.metrics.window(today - DAY, today, now, false),
      this.live(),
      this.monitoring.usable()
        ? this.monitoring.backlog().catch(() => null)
        : Promise.resolve(null),
      this.alerts(),
      this.monitoring.section('deadLetter', () => this.monitoring.deadLetters(3)),
    ]);
    const delivery = this.metrics.delivery(win);
    const queues = this.queueRows(live, now);
    const channels = this.channelRows(win, backlog, live, now);
    const lagNow = queues.available ? queues.data.reduce((s, q) => s + q.waiting, 0) : null;
    const lagChange = changePercent(lagNow, ago);
    const pub = this.metrics.perSec(win, delivery?.published ?? null);
    const con = this.metrics.perSec(win, delivery?.consumed ?? null);
    const diff = pub !== null && con !== null ? round(pub - con, 3) : null;
    const direction =
      lagNow === null || ago === null ? null : lagNow > ago ? 'up' : lagNow < ago ? 'down' : 'flat';
    const balanceState =
      diff === null || !delivery || (delivery.published === 0 && delivery.consumed === 0)
        ? null
        : diff > BALANCE_EPSILON && (lagNow ?? 0) > 0
          ? 'growing'
          : diff < -BALANCE_EPSILON && (lagNow ?? 0) > 0
            ? 'draining'
            : 'stable';
    const sum = (k: 'delayed' | 'failed' | 'workers') =>
      queues.available ? queues.data.reduce((s, q) => s + (q[k] ?? 0), 0) : null;
    return {
      provider: this.monitoring.info(),
      capabilities: [...this.monitoring.capabilities],
      health: this.health(alerts),
      kpis: {
        publishedPerSec: pub,
        consumedPerSec: con,
        lag: lagNow,
        failed: delivery ? delivery.failed + delivery.publishFailures : null,
        retrying: sum('delayed'),
        deadLetter: sum('failed'),
        consumers: sum('workers'),
        channels: channels.length,
      },
      balance: {
        publishedPerSec: pub,
        consumedPerSec: con,
        diffPerSec: diff,
        growthPerHour: balanceState === 'growing' && diff !== null ? Math.round(diff * 3600) : null,
        state: balanceState,
      },
      lagTrend: { current: lagNow, ago15m: ago, changePercent: lagChange, direction },
      processing: this.metrics.processing(win),
      delivery: delivery && {
        published: delivery.published,
        consumed: delivery.consumed,
        retried: delivery.retried,
        deadLettered: delivery.deadLettered,
        recovered: delivery.recovered,
        failureRatePercent: delivery.failureRatePercent,
      },
      queues,
      topChannels: channels.slice(0, OVERVIEW_CHANNELS),
      deadLetter: dlq.available
        ? {
            available: true,
            data: {
              total: sum('failed') ?? dlq.data.length,
              latest: dlq.data.slice(0, 3).map((m) => this.messageRow(m)),
            },
          }
        : dlq,
      alerts,
      report: { today: this.report(todayWin), yesterday: this.report(yesterdayWin) },
    };
  }

  private health(alerts: MessagingAlertDto[]): MessagingHealthDto {
    const s = this.connection.getStatus();
    const problems = alerts.filter((a) => a.severity !== 'info');
    const status =
      s.state === 'connected'
        ? problems.length
          ? 'degraded'
          : 'healthy'
        : s.state === 'unavailable'
          ? 'unavailable'
          : s.state === 'reconnecting'
            ? 'reconnecting'
            : 'unknown';
    const info = this.monitoring.info();
    const reasons =
      s.state !== 'connected'
        ? [
            {
              code: s.state,
              message: this.i18n.t(`messaging.health.${s.state}`, {
                product: `${info.product} (${info.broker})`,
              }),
            },
            ...(s.lastError ? [{ code: 'ERROR', message: s.lastError }] : []),
          ]
        : problems.map((a) => ({ code: a.rule, message: `${a.title}: ${a.message}` }));
    return {
      status,
      reasons,
      state: s.state,
      lastSuccessAt: s.lastSuccessAt,
      lastPublishAt: s.lastPublishAt,
      pingMs: s.lastPingMs,
      failures: s.failures,
    };
  }

  private async alerts(): Promise<MessagingAlertDto[]> {
    const active = await this.store
      .activeAlerts()
      .catch(() => new Map<string, StoredMessagingAlert>());
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    return [...active.entries()]
      .map(([id, s]) => {
        const rule = ruleOf(id);
        return {
          id,
          rule,
          severity: s.severity,
          title: this.i18n.t(`messaging.alert.${rule}.title`),
          message: this.alertMessage(rule, { ...s.extra, value: s.value, threshold: s.threshold }),
          since: new Date(s.since).toISOString(),
          tab: RULE_TAB[rule] ?? 'overview',
          target: typeof s.extra['target'] === 'string' ? s.extra['target'] : null,
        };
      })
      .sort((a, b) => rank[a.severity] - rank[b.severity]);
  }

  private alertMessage(rule: string, p: Record<string, unknown>): string {
    return this.i18n.t(`messaging.alert.${rule}.message`, {
      value: Number(p['value'] ?? 0),
      threshold: Number(p['threshold'] ?? 0),
      target: String(p['target'] ?? ''),
      oldestMin: String(p['oldestMin'] ?? 0),
      ago: String(p['ago'] ?? 0),
      failures: String(p['failures'] ?? 0),
    });
  }

  // ─── Chart ────────────────────────────────────────────────────────────────

  private async series(range: MessagingRange, defs: SeriesDef[]): Promise<MessagingSeriesDto[]> {
    const { series } = await this.metrics.series(MESSAGING_RANGES[range], defs);
    return series.map((d) => ({
      id: d.id,
      label: this.i18n.t(`messaging.series.${d.id}`),
      unit: d.unit,
      points: d.points,
    }));
  }

  /**
   * Định nghĩa PromQL cho biểu đồ; `filter` thêm điều kiện nhãn (vd. `channel="x"`) cho trang chi tiết.
   * `$w` là cửa sổ rate do `series` chọn theo độ phân giải.
   */
  private static defs(filter = '') {
    const sel = (m: string, extra = '') => {
      const parts = [filter, extra].filter(Boolean).join(',');
      return parts ? `${m}{${parts}}` : m;
    };
    const perSec = (m: string, extra = '') => `sum(rate(${sel(m, extra)}[$w]))`;
    const perMin = (m: string, extra = '') => `sum(rate(${sel(m, extra)}[$w])) * 60`;
    const quant = (p: number) =>
      `histogram_quantile(${p}, sum by (le) (rate(${sel('job_duration_seconds_bucket')}[$w]))) * 1000`;
    return {
      published: perSec('messages_published_total', 'result="success"'),
      consumed: perSec('messages_consumed_total', 'result="success"'),
      failed: perSec('messages_consumed_total', 'result="failed"'),
      failedPerMin: perMin('messages_consumed_total', 'result="failed"'),
      consumedPerMin: perMin('messages_consumed_total', 'result="success"'),
      retriedPerMin: perMin('job_attempt_failures_total', 'final="false"'),
      deadLetteredPerMin: perMin('job_attempt_failures_total', 'final="true"'),
      publishFailedPerMin: perMin('messages_published_total', 'result="failed"'),
      processingAvg: `sum(rate(${sel('job_duration_seconds_sum')}[$w])) / sum(rate(${sel('job_duration_seconds_count')}[$w])) * 1000`,
      processingP95: quant(0.95),
      processingP99: quant(0.99),
    };
  }

  public async getMetrics(
    range: MessagingRange,
    metric: MessagingMetric,
  ): Promise<MessagingMetricsDto> {
    const e = MessagingOpsService.defs();
    const waiting = (state: string) =>
      `sum(max by (queue) (${QUEUE_JOBS_METRIC}{state="${state}"}))`;
    const defs: Record<MessagingMetric, SeriesDef[]> = {
      throughput: [
        { id: 'published', unit: '/s', expr: e.published },
        { id: 'consumed', unit: '/s', expr: e.consumed },
        { id: 'failed', unit: '/s', expr: e.failed },
      ],
      lag: [
        { id: 'lag', unit: 'msgs', expr: waiting('waiting') },
        { id: 'deadLetterSize', unit: 'msgs', expr: waiting('failed') },
      ],
      failures: [
        { id: 'failedPerMin', unit: '/min', expr: e.failedPerMin },
        { id: 'retriedPerMin', unit: '/min', expr: e.retriedPerMin },
        { id: 'deadLetteredPerMin', unit: '/min', expr: e.deadLetteredPerMin },
        { id: 'publishFailedPerMin', unit: '/min', expr: e.publishFailedPerMin },
      ],
      processing: [
        { id: 'processingAvg', unit: 'ms', expr: e.processingAvg },
        { id: 'processingP95', unit: 'ms', expr: e.processingP95 },
        { id: 'processingP99', unit: 'ms', expr: e.processingP99 },
      ],
    };
    const series = await this.series(range, defs[metric]);
    return { series: series.filter((s, i) => i === 0 || s.points.length > 0) };
  }

  // ─── Channels / Consumers ────────────────────────────────────────────────

  private async channelContext(range: MessagingRange, now: number) {
    const [win, live, backlog] = await Promise.all([
      this.rangeWindow(range, now),
      this.live(),
      this.monitoring.usable()
        ? this.monitoring.backlog().catch(() => null)
        : Promise.resolve(null),
    ]);
    return { win, live, backlog };
  }

  public async getChannels(range: MessagingRange): Promise<MessagingChannelsDto> {
    const now = Date.now();
    const { win, live, backlog } = await this.channelContext(range, now);
    return {
      channels: this.channelRows(win, backlog, live, now),
      queues: this.queueRows(live, now),
      backlogSampled: backlog?.sampled ?? null,
      backlogTruncated: backlog?.truncated ?? false,
    };
  }

  public async getChannelDetail(name: string, range: MessagingRange): Promise<ChannelDetailDto> {
    const now = Date.now();
    const { win, live, backlog } = await this.channelContext(range, now);
    const row = this.channelRows(win, backlog, live, now).find((c) => c.channel === name);
    if (!row) throw new MessagingNotFoundException('messaging.error.channelNotFound', { name });
    const e = MessagingOpsService.defs(`channel="${labelValue(name)}"`);
    const [throughput, processing, errors, recent] = await Promise.all([
      this.series(range, [
        { id: 'published', unit: '/s', expr: e.published },
        { id: 'consumed', unit: '/s', expr: e.consumed },
        { id: 'failed', unit: '/s', expr: e.failed },
      ]),
      this.series(range, [
        { id: 'processingAvg', unit: 'ms', expr: e.processingAvg },
        { id: 'processingP95', unit: 'ms', expr: e.processingP95 },
      ]),
      this.recentFailures(),
      this.recentMessages({
        queue: row.queue,
        channel: name,
        status: null,
        producer: null,
        search: '',
      }),
    ]);
    return {
      channel: row,
      throughput,
      processing,
      consumers: this.consumerRows(win, live).filter((c) => c.queue === row.queue),
      recentErrors: errors
        .filter((x) => x.channel === name)
        .slice(0, RECENT_LIMIT)
        .map((x) => this.errorDto(x)),
      recentMessages: recent,
    };
  }

  private recentMessages(filter: MessageFilter): Promise<SectionDto<MessageRowDto[]>> {
    return this.monitoring.section('browse', async () => {
      const page = await this.monitoring.listMessages(filter, RECENT_LIMIT);
      return page.messages.slice(0, RECENT_LIMIT).map((m) => this.messageRow(m));
    });
  }

  /** Job lỗi còn trong broker; broker mất kết nối → rỗng (trang chi tiết đã báo mất kết nối ở phần khác). */
  private recentFailures(): Promise<MessagingErrorRecord[]> {
    return this.monitoring.usable()
      ? this.monitoring.failures(ERROR_LIST_LIMIT).catch(() => [] as MessagingErrorRecord[])
      : Promise.resolve([]);
  }

  public async getConsumers(range: MessagingRange): Promise<MessagingConsumersDto> {
    const now = Date.now();
    const [win, live] = await Promise.all([this.rangeWindow(range, now), this.live()]);
    const queues = this.queueRows(live, now);
    return {
      consumers: this.consumerRows(win, live),
      unconsumed: queues.available
        ? queues.data.filter((q) => q.waiting > 0 && q.consumers.length === 0 && !q.workers)
        : [],
    };
  }

  public async getConsumerDetail(name: string, range: MessagingRange): Promise<ConsumerDetailDto> {
    const now = Date.now();
    const [win, live] = await Promise.all([this.rangeWindow(range, now), this.live()]);
    const row = this.consumerRows(win, live).find((c) => c.consumer === name);
    if (!row) throw new MessagingNotFoundException('messaging.error.consumerNotFound', { name });
    const queue = labelValue(row.queue);
    const e = MessagingOpsService.defs(`queue="${queue}"`);
    const [processing, throughput, lag, errors, recent] = await Promise.all([
      this.series(range, [
        { id: 'processingAvg', unit: 'ms', expr: e.processingAvg },
        { id: 'processingP95', unit: 'ms', expr: e.processingP95 },
      ]),
      this.series(range, [
        { id: 'consumedPerMin', unit: '/min', expr: e.consumedPerMin },
        { id: 'failedPerMin', unit: '/min', expr: e.failedPerMin },
      ]),
      this.series(range, [
        {
          id: 'lag',
          unit: 'msgs',
          expr: `max(${QUEUE_JOBS_METRIC}{queue="${queue}",state="waiting"})`,
        },
      ]),
      this.recentFailures(),
      this.recentMessages({
        queue: row.queue,
        channel: null,
        status: null,
        producer: null,
        search: '',
      }),
    ]);
    const m = this.metrics.queue(win, row.queue);
    return {
      consumer: row,
      processing,
      throughput,
      lag,
      recentErrors: errors
        .filter((x) => x.queue === row.queue)
        .slice(0, RECENT_LIMIT)
        .map((x) => this.errorDto(x)),
      recentMessages: recent,
      retry: m
        ? { retried: m.retried, recovered: m.recovered, deadLettered: m.deadLettered }
        : null,
    };
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  public async getMessages(filter: MessageFilter, perState: number): Promise<MessagingMessagesDto> {
    const page = await this.monitoring.section('browse', () =>
      this.monitoring.listMessages(filter, perState),
    );
    return {
      messages: page.available
        ? { available: true, data: page.data.messages.map((m) => this.messageRow(m)) }
        : page,
      examined: page.available ? page.data.examined : 0,
      truncated: page.available ? page.data.truncated : false,
    };
  }

  public async getMessageDetail(id: string, queue: string | null): Promise<MessageDetailDto> {
    const [res, consumers] = await Promise.all([
      this.monitoring.section('browse', () => this.monitoring.message(id, queue)),
      this.monitoring.consumers().catch(() => [] as ConsumerRegistration[]),
    ]);
    if (!res.available) throw this.sectionError(res);
    if (!res.data) throw new MessagingNotFoundException('messaging.error.messageNotFound', { id });
    const d = res.data;
    const regs = consumers.filter((c) => c.queue === d.queue);
    const lifecycle: LifecycleEntryDto[] = [
      {
        at: new Date(d.publishedAt).toISOString(),
        type: 'published',
        runtime: d.producer,
        consumer: null,
        attempt: null,
        ms: null,
        error: null,
        delayMs: null,
      },
      ...d.lifecycle.map((e) => ({ ...e, at: new Date(e.at).toISOString() })),
    ];
    const { payload: _payload, lifecycle: _l, ...summary } = d;
    return {
      ...this.messageRow(summary),
      lifecycle,
      stacktrace: d.stacktrace,
      backoff: d.backoff,
      malformed: d.malformed,
      consumers: [...new Set(regs.map((c) => c.consumer))],
      idempotent: regs.length
        ? regs.some((c) => c.idempotent === false)
          ? false
          : regs.every((c) => c.idempotent === true)
            ? true
            : null
        : null,
      settings: this.settings(),
    };
  }

  // ─── Retry / Dead Letter / Broker ─────────────────────────────────────────

  public async getRetries(): Promise<MessagingRetriesDto> {
    const now = Date.now();
    const [list, todayWin] = await Promise.all([
      this.monitoring.section('retry', () => this.monitoring.retrying(RETRY_LIMIT)),
      this.metrics.window(startOfDay(now), now, now, false),
    ]);
    const d = this.metrics.delivery(todayWin);
    const c = this.cfg;
    return {
      retrying: list.available
        ? { available: true, data: list.data.map((m) => this.messageRow(m)) }
        : list,
      stats: {
        retryingNow: list.available ? list.data.length : null,
        retriedToday: d?.retried ?? null,
        recoveredToday: d?.recovered ?? null,
        deadLetteredToday: d?.deadLettered ?? null,
      },
      policy: {
        maxAttempts: c.maxAttempts,
        backoff: c.maxAttempts > 1 && c.backoffDelayMs > 0 ? c.backoff : 'none',
        initialDelayMs: c.maxAttempts > 1 ? c.backoffDelayMs : 0,
        // Độ trễ của lần retry cuối (exponential: delay × 2^(attempts−2)).
        maxDelayMs:
          c.maxAttempts > 1
            ? c.backoff === 'exponential'
              ? c.backoffDelayMs * 2 ** (c.maxAttempts - 2)
              : c.backoffDelayMs
            : 0,
      },
      retryEnabled: this.settings().retry,
    };
  }

  public async getDeadLetter(): Promise<MessagingDeadLetterDto> {
    const now = Date.now();
    const [items, live, todayWin] = await Promise.all([
      this.monitoring.section('deadLetter', () => this.monitoring.deadLetters(DEAD_LETTER_LIMIT)),
      this.live(),
      this.metrics.window(startOfDay(now), now, now, false),
    ]);
    const bySource = new Map<string, number>();
    if (items.available)
      for (const m of items.data) bySource.set(m.channel, (bySource.get(m.channel) ?? 0) + 1);
    const oldest = items.available
      ? items.data.reduce<number | null>((min, m) => {
          const t = m.finishedAt ?? m.publishedAt;
          return min === null || t < min ? t : min;
        }, null)
      : null;
    return {
      items: items.available
        ? { available: true, data: items.data.map((m) => this.messageRow(m)) }
        : items,
      total: live.queues.available
        ? live.queues.data.reduce((s, q) => s + q.counts.failed, 0)
        : null,
      addedToday: this.metrics.delivery(todayWin)?.deadLettered ?? null,
      oldestSec: secondsSince(oldest, now),
      bySource: [...bySource.entries()]
        .map(([channel, count]) => ({ channel, count }))
        .sort((a, b) => b.count - a.count),
      settings: this.settings(),
    };
  }

  public async getBroker(): Promise<MessagingBrokerDto> {
    return {
      broker: await this.monitoring.section('brokerInfo', () => this.monitoring.broker()),
    };
  }

  // ─── Errors / Events / Operations / Config ────────────────────────────────

  public async getErrors(range: MessagingRange): Promise<MessagingErrorsDto> {
    const now = Date.now();
    const from = now - MESSAGING_RANGES[range] * MINUTE;
    const [items, win] = await Promise.all([
      this.monitoring.section('deadLetter', () => this.monitoring.failures(ERROR_LIST_LIMIT)),
      this.rangeWindow(range, now),
    ]);
    const recent = items.available ? items.data.filter((e) => e.at >= from) : null;
    const d = this.metrics.delivery(win);
    return {
      counts: recent
        ? (Object.fromEntries(
            ERROR_KINDS.map((k) => [k, recent.filter((e) => e.kind === k).length]),
          ) as Record<MessagingErrorKind, number>)
        : null,
      byStage: { publish: d?.publishFailures ?? null, consume: d?.failed ?? null },
      items: recent
        ? { available: true, data: recent.slice(0, ERROR_LIST_LIMIT).map((e) => this.errorDto(e)) }
        : (items as Extract<typeof items, { available: false }>),
    };
  }

  public async getEvents(range: MessagingRange): Promise<MessagingEventDto[]> {
    return (await this.eventsSince(Date.now() - MESSAGING_RANGES[range] * MINUTE)).map((e) =>
      this.eventDto(e),
    );
  }

  public async getOperations(): Promise<MessagingOperationDto[]> {
    const ops = await this.store.operations().catch(() => [] as MessagingOperationRecord[]);
    return ops.map((o) => ({ ...o, at: new Date(o.at).toISOString() }));
  }

  public getConfig(): MessagingConfigDto {
    const c = this.cfg;
    const info = this.monitoring.info();
    const redis = this.config.cache.redis;
    return {
      items: [
        { group: 'provider', key: 'driver', value: info.driver },
        { group: 'provider', key: 'product', value: info.product },
        { group: 'provider', key: 'broker', value: info.broker },
        { group: 'provider', key: 'endpoint', value: info.endpoint },
        { group: 'provider', key: 'prefix', value: info.prefix },
        { group: 'provider', key: 'credentials', value: Boolean(redis.password), sensitive: true },
        { group: 'provider', key: 'credentialsSource', value: 'REDIS_PASSWORD' },
        { group: 'delivery', key: 'mode', value: 'at-least-once' },
        { group: 'delivery', key: 'acknowledgement', value: 'auto' },
        { group: 'delivery', key: 'ordering', value: 'fifo' },
        { group: 'delivery', key: 'concurrency', value: this.config.runtime.worker.concurrency },
        { group: 'delivery', key: 'timeoutMs', value: c.timeoutMs },
        { group: 'retry', key: 'maxAttempts', value: c.maxAttempts },
        { group: 'retry', key: 'backoff', value: c.backoff },
        { group: 'retry', key: 'backoffDelayMs', value: c.backoffDelayMs },
        { group: 'retention', key: 'keepCompleted', value: c.keepCompleted },
        { group: 'retention', key: 'keepDeadLetter', value: c.keepDeadLetter },
        { group: 'retention', key: 'keepLifecycle', value: c.keepLifecycle },
        { group: 'thresholds', key: 'lagWarn', value: c.rules.lagWarn },
        { group: 'thresholds', key: 'lagCrit', value: c.rules.lagCrit },
        { group: 'thresholds', key: 'failureRatePercent', value: c.rules.failureRatePercent },
        { group: 'thresholds', key: 'processingP95Ms', value: c.rules.processingP95Ms },
        { group: 'thresholds', key: 'deadLetterWarn', value: c.rules.deadLetterWarn },
        { group: 'thresholds', key: 'oldestWaitingMin', value: c.rules.oldestWaitingMin },
        { group: 'thresholds', key: 'largeMessageKb', value: c.largeMessageKb },
        { group: 'actions', key: 'retry', value: c.retry },
        { group: 'actions', key: 'replay', value: c.replay },
        { group: 'actions', key: 'discard', value: c.discard },
        { group: 'actions', key: 'payload', value: c.payload },
      ],
    };
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  public async test(ctx: OperationContext): Promise<MessagingTestDto> {
    const result = await this.operations.test(ctx);
    this.monitoring.invalidate();
    return result;
  }

  public retry(queue: string, id: string, ctx: OperationContext) {
    return this.act(() => this.operations.retryMessage(queue, id, ctx));
  }

  public replay(queue: string, id: string, ctx: OperationContext) {
    return this.act(() => this.operations.replayDeadLetter(queue, id, ctx));
  }

  public discard(queue: string, id: string, ctx: OperationContext) {
    return this.act(() => this.operations.discardDeadLetter(queue, id, ctx));
  }

  public payload(id: string, queue: string | null, ctx: OperationContext) {
    return this.act(() => this.operations.payload(id, queue, ctx));
  }

  private async act<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw this.operationError(err);
    }
  }

  private async eventsSince(from: number): Promise<MessagingEventRecord[]> {
    return (await this.store.events().catch(() => [] as MessagingEventRecord[])).filter(
      (e) => e.at >= from,
    );
  }

  private eventDto(e: MessagingEventRecord): MessagingEventDto {
    const alertId = typeof e.params['rule'] === 'string' ? e.params['rule'] : null;
    const rule = alertId ? ruleOf(alertId) : null;
    const title = rule ? this.i18n.t(`messaging.alert.${rule}.title`) : '';
    const target =
      typeof e.params['target'] === 'string'
        ? e.params['target']
        : typeof e.params['messageId'] === 'string'
          ? e.params['messageId']
          : typeof e.params['consumer'] === 'string'
            ? e.params['consumer']
            : null;
    const message =
      e.type === 'alert_started' && rule
        ? `${title}: ${this.alertMessage(rule, e.params)}`
        : this.i18n.t(`messaging.event.${e.type}`, {
            ...e.params,
            alert: target && rule ? `${title} (${target})` : title,
          });
    const tab = rule
      ? (RULE_TAB[rule as MessagingRule] ?? null)
      : e.type.startsWith('connection')
        ? 'overview'
        : e.type.startsWith('consumer')
          ? 'consumers'
          : e.type === 'message_retried'
            ? 'retries'
            : e.type === 'dead_lettered' ||
                e.type === 'message_replayed' ||
                e.type === 'message_discarded'
              ? 'dead-letter'
              : null;
    return {
      id: e.id,
      at: new Date(e.at).toISOString(),
      type: e.type,
      severity: e.severity,
      message,
      runtime: e.runtime,
      tab,
      target,
    };
  }

  private errorDto(e: MessagingErrorRecord): MessagingErrorDto {
    return { ...e, at: new Date(e.at).toISOString() };
  }

  private sectionError(s: Extract<SectionDto<unknown>, { available: false }>): Error {
    if (s.reason === 'disconnected')
      return new MessagingNotConnectedException(s.message ?? 'unknown');
    if (s.reason === 'unsupported')
      return new MessagingActionRejectedException(
        'UNSUPPORTED',
        'messaging.error.UNSUPPORTED',
        { product: s.message ?? '' },
        422,
      );
    return new MessagingActionRejectedException(
      'READ_FAILED',
      'messaging.error.readFailed',
      { message: s.message ?? '' },
      502,
    );
  }

  private operationError(err: unknown): Error {
    if (!(err instanceof MessagingOperationError))
      return err instanceof Error ? err : new Error(String(err));
    switch (err.code) {
      case 'UNAVAILABLE':
        return new MessagingNotConnectedException(this.connection.getStatus().state);
      case 'NOT_FOUND':
        return new MessagingNotFoundException('messaging.error.messageNotFound', {
          id: err.params['id'] ?? err.message,
        });
      case 'INVALID_STATE':
        return new MessagingActionRejectedException(err.code, 'messaging.error.INVALID_STATE', {
          id: err.params['id'] ?? '',
          state: err.params['state'] ?? '',
        });
      case 'UNSUPPORTED':
        return new MessagingActionRejectedException(
          err.code,
          'messaging.error.UNSUPPORTED',
          { product: this.monitoring.info().product },
          422,
        );
      case 'FAILED':
        return new MessagingActionRejectedException(
          'ACTION_FAILED',
          'messaging.error.FAILED',
          { message: err.message },
          502,
        );
      default:
        return new MessagingActionRejectedException(err.code, `messaging.error.${err.code}`, {
          ...err.params,
        });
    }
  }
}
