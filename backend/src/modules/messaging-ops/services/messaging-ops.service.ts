import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  MessagingConnectionService,
  MessagingMonitoringService,
  MessagingOperationError,
  MessagingOperationsService,
  channelMetric,
  queueMetric,
  type BacklogSample,
  type ChannelRegistryEntry,
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
import { TELEMETRY_TIERS, type MetricBucket } from '@packages/telemetry/index.js';
import {
  changePercent,
  counterOf,
  gaugeWindow,
  mergedOf,
  meanOf,
  percentileOf,
  round,
} from '@modules/performance/index.js';
import { MessagingMetricsService, type MetricWindow } from './messaging-metrics.service.js';
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
  MessagingProducersDto,
  MessagingRange,
  MessagingReportDto,
  MessagingRetriesDto,
  MessagingSeriesDto,
  MessagingSettingsDto,
  MessagingTestDto,
  ProducerRowDto,
  QueueRowDto,
  SectionDto,
} from '../responses/messaging-ops.response.js';

export const MESSAGING_RANGES: Record<MessagingRange, number> = {
  '15m': 15,
  '1h': 60,
  '6h': 360,
  '24h': 1440,
};
export const MESSAGING_METRICS: MessagingMetric[] = [
  'throughput',
  'lag',
  'failures',
  'processing',
  'size',
];

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_POINTS = 120;
const OVERVIEW_EVENTS = 8;
const OVERVIEW_CHANNELS = 8;
const ERROR_LIST_LIMIT = 200;
const RECENT_LIMIT = 20;
const DEAD_LETTER_LIMIT = 200;
const RETRY_LIMIT = 200;
const LAG_TREND_MS = 15 * MINUTE;
/** Chênh lệch publish − consume nhỏ hơn mức này (msg/s) coi là cân bằng. */
const BALANCE_EPSILON = 0.01;
const CHANNEL_KINDS = ['pub', 'con', 'fail', 'retry', 'dlq', 'pubfail', 'proc', 'size'];
const ERROR_KINDS: MessagingErrorKind[] = [
  'processing',
  'timeout',
  'deserialize',
  'publish',
  'connection',
  'stalled',
  'other',
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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** Tên channel có trong bucket (`msg.ch.<channel>.<kind>` — kind không chứa dấu chấm). */
export function channelsInBuckets(buckets: readonly MetricBucket[]): Set<string> {
  const out = new Set<string>();
  for (const b of buckets)
    for (const key of b.metrics.keys()) {
      if (!key.startsWith('msg.ch.')) continue;
      const i = key.lastIndexOf('.');
      if (CHANNEL_KINDS.includes(key.slice(i + 1))) out.add(key.slice('msg.ch.'.length, i));
    }
  return out;
}

type Group = { t: number; b: MetricBucket[]; seconds: number };
type SeriesDef = { id: string; unit: string; value: (g: Group) => number | null };
interface Live {
  queues: SectionDto<QueueSnapshot[]>;
  consumers: ConsumerRegistration[];
}

/**
 * Messaging Monitor: health broker, throughput publish/consume, lag, channel/producer/consumer, message
 * explorer + vòng đời, retry, Dead Letter, lỗi & sự kiện, thao tác có kiểm soát. Không có số liệu giả:
 * phần broker không hỗ trợ trả lý do.
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
      maxAttempts: c.maxAttempts,
      largeMessageBytes: this.largeBytes,
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
        completed: q.counts.completed,
        paused: q.paused,
        workers: q.workers?.length ?? null,
        consumers: [
          ...new Set(live.consumers.filter((c) => c.queue === q.name).map((c) => c.consumer)),
        ],
        oldestWaitingSec: secondsSince(q.oldestWaitingAt, now),
      })),
    };
  }

  private channelRows(
    win: MetricWindow | null,
    registry: ChannelRegistryEntry[],
    backlog: BacklogSample | null,
    live: Live,
    now: number,
  ): ChannelRowDto[] {
    const names = new Set<string>([
      ...registry.map((r) => r.channel),
      ...(backlog?.channels.map((c) => c.channel) ?? []),
      ...channelsInBuckets(win?.buckets ?? []),
    ]);
    const queues = live.queues.available ? live.queues.data : null;
    const rows = [...names].map((name): ChannelRowDto => {
      const m = this.metrics.channel(win, name);
      const reg = registry.filter((r) => r.channel === name);
      const waiting = backlog?.channels.filter((c) => c.channel === name) ?? [];
      const queue = reg[0]?.queue ?? waiting[0]?.queue ?? null;
      const lag = backlog ? waiting.reduce((s, c) => s + c.waiting, 0) : null;
      const oldest = waiting.reduce<number | null>(
        (min, c) => (c.oldestAt !== null && (min === null || c.oldestAt < min) ? c.oldestAt : min),
        null,
      );
      const q = queues?.find((x) => x.name === queue) ?? null;
      const lastPublished = reg.reduce<number | null>(
        (max, r) => (max === null || r.lastPublishedAt > max ? r.lastPublishedAt : max),
        null,
      );
      const row: Omit<ChannelRowDto, 'status'> = {
        channel: name,
        queue,
        published: m.published,
        consumed: m.consumed,
        failed: m.failed,
        retried: m.retried,
        deadLettered: m.deadLettered,
        publishPerSec: this.metrics.perSec(win, m.published),
        consumePerSec: this.metrics.perSec(win, m.consumed),
        failureRatePercent: m.failureRatePercent,
        lag,
        oldestWaitingSec: secondsSince(oldest, now),
        avgMs: m.avgMs,
        p95Ms: m.p95Ms,
        avgSizeBytes: m.avgSizeBytes,
        producers: [...new Set(reg.map((r) => r.producer))].sort(),
        consumers: [
          ...new Set(live.consumers.filter((c) => c.queue === queue).map((c) => c.consumer)),
        ],
        lastPublishedAt: iso(lastPublished),
      };
      return { ...row, status: this.channelStatus(row, q) };
    });
    const rank: Record<ChannelStatus, number> = {
      no_consumer: 0,
      high_failure: 1,
      lagging: 2,
      healthy: 3,
      idle: 4,
    };
    return rows.sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        b.published + b.consumed - (a.published + a.consumed) ||
        a.channel.localeCompare(b.channel),
    );
  }

  private channelStatus(
    row: Omit<ChannelRowDto, 'status'>,
    q: QueueSnapshot | null,
  ): ChannelStatus {
    const r = this.cfg.rules;
    if ((row.lag ?? 0) > 0 && q && q.workers !== null && q.workers.length === 0)
      return 'no_consumer';
    if (
      row.consumed + row.failed >= r.minOps &&
      (row.failureRatePercent ?? 0) >= r.failureRatePercent
    )
      return 'high_failure';
    if ((row.lag ?? 0) >= r.lagWarn) return 'lagging';
    if (row.published + row.consumed + row.failed === 0 && !row.lag) return 'idle';
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
      const runtime = first.runtime ?? undefined;
      const m = this.metrics.consumer(win, runtime);
      const q = queues?.find((x) => x.name === first.queue) ?? null;
      const lag = q ? waitingOf(q) : null;
      const brokerWorkers = q?.workers?.length ?? null;
      const ops = m.consumed + m.failed;
      const status: ConsumerStatus =
        brokerWorkers === 0
          ? 'offline'
          : regs.every((x) => x.paused)
            ? 'paused'
            : ops >= r.minOps && (m.failureRatePercent ?? 0) >= r.failureRatePercent
              ? 'high_failure'
              : ops >= r.minOps && (m.p95Ms ?? 0) >= r.processingP95Ms
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
          runtime: x.runtime,
          concurrency: x.concurrency,
          paused: x.paused,
          inFlight: x.inFlight,
          startedAt: new Date(x.startedAt).toISOString(),
        })),
        brokerWorkers,
        consumed: m.consumed,
        failed: m.failed,
        perSec: this.metrics.perSec(win, m.consumed),
        failureRatePercent: m.failureRatePercent,
        avgMs: m.avgMs,
        p95Ms: m.p95Ms,
        p99Ms: m.p99Ms,
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

  private report(w: MetricWindow | null): MessagingReportDto {
    const d = this.metrics.delivery(w);
    const lag = this.metrics.lag(w);
    return {
      published: d.published,
      consumed: d.consumed,
      failed: d.failed + d.publishFailures,
      retried: d.retried,
      deadLettered: d.deadLettered,
      avgProcessingMs: this.metrics.processing(w).avgMs,
      avgLag: lag.avg === null ? null : round(lag.avg, 1),
      peakLag: lag.peak,
    };
  }

  // ─── Overview ─────────────────────────────────────────────────────────────

  public async getOverview(range: MessagingRange): Promise<MessagingOverviewDto> {
    const now = Date.now();
    const today = startOfDay(now);
    const [win, lagWin, todayWin, yesterdayWin, live, registry, backlog, alerts, events, dlq] =
      await Promise.all([
        this.rangeWindow(range, now),
        this.metrics.window(now - LAG_TREND_MS, now, now, 's10'),
        this.metrics.window(today, now, now),
        this.metrics.window(today - DAY, today, now),
        this.live(),
        this.monitoring.channelRegistry().catch(() => [] as ChannelRegistryEntry[]),
        this.monitoring.usable()
          ? this.monitoring.backlog().catch(() => null)
          : Promise.resolve(null),
        this.alerts(),
        this.eventsSince(now - DAY),
        this.monitoring.section('deadLetter', () => this.monitoring.provider.deadLetters(3)),
      ]);
    const delivery = this.metrics.delivery(win);
    const queues = this.queueRows(live, now);
    const channels = this.channelRows(win, registry, backlog, live, now);
    const lagGauge = this.metrics.lag(lagWin);
    const lagNow = queues.available
      ? queues.data.reduce((s, q) => s + q.waiting, 0)
      : lagGauge.current;
    const ago = lagGauge.points[0]?.value ?? null;
    const lagChange = changePercent(lagNow, ago);
    const pub = this.metrics.perSec(win, delivery.published);
    const con = this.metrics.perSec(win, delivery.consumed);
    const diff = pub !== null && con !== null ? round(pub - con, 3) : null;
    const direction =
      lagNow === null || ago === null ? null : lagNow > ago ? 'up' : lagNow < ago ? 'down' : 'flat';
    const balanceState =
      diff === null || (delivery.published === 0 && delivery.consumed === 0)
        ? null
        : diff > BALANCE_EPSILON && (lagNow ?? 0) > 0
          ? 'growing'
          : diff < -BALANCE_EPSILON && (lagNow ?? 0) > 0
            ? 'draining'
            : 'stable';
    const payload = this.metrics.payload(win);
    const sum = (k: 'delayed' | 'failed' | 'workers') =>
      queues.available ? queues.data.reduce((s, q) => s + (q[k] ?? 0), 0) : null;
    return {
      generatedAt: new Date(now).toISOString(),
      range,
      provider: this.monitoring.provider.info(),
      environment: this.config.app.env,
      capabilities: [...this.monitoring.provider.capabilities],
      health: this.health(alerts),
      kpis: {
        publishedPerSec: pub,
        consumedPerSec: con,
        lag: lagNow,
        failed: delivery.failed + delivery.publishFailures,
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
      payload: { ...payload, largeBytes: this.largeBytes },
      delivery,
      queues,
      topChannels: channels.slice(0, OVERVIEW_CHANNELS),
      consumers: this.consumerRows(win, live),
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
      events: events.slice(0, OVERVIEW_EVENTS).map((e) => this.eventDto(e)),
      settings: this.settings(),
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
    const info = this.monitoring.provider.info();
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
      since: s.since,
      lastSuccessAt: s.lastSuccessAt,
      lastPublishAt: s.lastPublishAt,
      pingMs: s.lastPingMs,
      lastError: s.lastError,
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
          value: s.value,
          threshold: s.threshold,
          unit: s.unit,
          since: new Date(s.since).toISOString(),
          tab: RULE_TAB[rule] ?? 'overview',
          target: typeof s.extra['target'] === 'string' ? s.extra['target'] : null,
        };
      })
      .sort((a, b) => rank[a.severity] - rank[b.severity]);
  }

  private alertMessage(rule: string, p: Record<string, unknown>): string {
    const value = Number(p['value'] ?? 0);
    const threshold = Number(p['threshold'] ?? 0);
    const bytes = rule === 'LARGE_MESSAGE';
    return this.i18n.t(`messaging.alert.${rule}.message`, {
      value: bytes ? formatBytes(value) : value,
      threshold: bytes ? formatBytes(threshold) : threshold,
      target: String(p['target'] ?? ''),
      oldestMin: String(p['oldestMin'] ?? 0),
      ago: String(p['ago'] ?? 0),
      failures: String(p['failures'] ?? 0),
      channel: String(p['channel'] ?? ''),
    });
  }

  // ─── Chart ────────────────────────────────────────────────────────────────

  private async series(
    range: MessagingRange,
    defs: SeriesDef[],
  ): Promise<{ series: MessagingSeriesDto[]; resolutionSec: number | null }> {
    const now = Date.now();
    const win = await this.rangeWindow(range, now);
    const tierSec = win ? TELEMETRY_TIERS[win.tier].seconds : 0;
    const buckets = win?.buckets ?? [];
    const size = Math.max(1, Math.ceil(buckets.length / MAX_POINTS));
    const groups: Group[] = [];
    for (let i = 0; i < buckets.length; i += size) {
      const b = buckets.slice(i, i + size);
      groups.push({
        t: b[0]!.start,
        b,
        seconds: Math.max(1, Math.min(b.length * tierSec, (now - b[0]!.start) / 1000)),
      });
    }
    return {
      resolutionSec: win ? tierSec : null,
      series: defs.map((d) => ({
        id: d.id,
        label: this.i18n.t(`messaging.series.${d.id}`),
        unit: d.unit,
        points: groups
          .map((g) => ({ t: g.t, value: d.value(g) }))
          .filter(
            (p): p is { t: number; value: number } => p.value !== null && Number.isFinite(p.value),
          )
          .map((p) => ({ t: p.t, value: round(p.value, 3) })),
      })),
    };
  }

  private static perSec = (name: string) => (g: Group) => counterOf(g.b, name) / g.seconds;
  private static perMin = (name: string, runtime?: string) => (g: Group) =>
    counterOf(g.b, name, runtime) / (g.seconds / 60);
  private static pct = (name: string, p: number, runtime?: string) => (g: Group) =>
    percentileOf(mergedOf(g.b, name, runtime), p);
  private static gauge = (name: string) => (g: Group) =>
    gaugeWindow(g.b, name, { mode: 'max' }).avg;

  public async getMetrics(
    range: MessagingRange,
    metric: MessagingMetric,
  ): Promise<MessagingMetricsDto> {
    const S = MessagingOpsService;
    const defs: Record<MessagingMetric, SeriesDef[]> = {
      throughput: [
        { id: 'published', unit: '/s', value: S.perSec('msg.published') },
        { id: 'consumed', unit: '/s', value: S.perSec('msg.consumed') },
        { id: 'failed', unit: '/s', value: S.perSec('msg.consume.failed') },
      ],
      lag: [
        { id: 'lag', unit: 'msgs', value: S.gauge('msg.lag') },
        { id: 'deadLetterSize', unit: 'msgs', value: S.gauge('msg.dlq.size') },
      ],
      failures: [
        { id: 'failedPerMin', unit: '/min', value: S.perMin('msg.consume.failed') },
        { id: 'retriedPerMin', unit: '/min', value: S.perMin('msg.retry') },
        { id: 'deadLetteredPerMin', unit: '/min', value: S.perMin('msg.dlq') },
        { id: 'publishFailedPerMin', unit: '/min', value: S.perMin('msg.publish.failed') },
      ],
      processing: [
        { id: 'processingAvg', unit: 'ms', value: (g) => meanOf(mergedOf(g.b, 'msg.process')) },
        { id: 'processingP95', unit: 'ms', value: S.pct('msg.process', 95) },
        { id: 'processingP99', unit: 'ms', value: S.pct('msg.process', 99) },
      ],
      size: [
        {
          id: 'sizeAvg',
          unit: 'B',
          value: (g) => {
            const a = mergedOf(g.b, 'msg.size');
            return a.n > 0 ? a.s / a.n : null;
          },
        },
        { id: 'sizeMax', unit: 'B', value: (g) => mergedOf(g.b, 'msg.size').x },
      ],
    };
    const { series, resolutionSec } = await this.series(range, defs[metric]);
    const list = series.filter((s, i) => i === 0 || s.points.length > 0);
    return { metric, range, resolutionSec, unit: list[0]?.unit ?? '', series: list };
  }

  // ─── Channels / Producers / Consumers ─────────────────────────────────────

  private async channelContext(range: MessagingRange, now: number) {
    const [win, live, registry, backlog] = await Promise.all([
      this.rangeWindow(range, now),
      this.live(),
      this.monitoring.channelRegistry().catch(() => [] as ChannelRegistryEntry[]),
      this.monitoring.usable()
        ? this.monitoring.backlog().catch(() => null)
        : Promise.resolve(null),
    ]);
    return { win, live, registry, backlog };
  }

  public async getChannels(range: MessagingRange): Promise<MessagingChannelsDto> {
    const now = Date.now();
    const { win, live, registry, backlog } = await this.channelContext(range, now);
    return {
      range,
      channels: this.channelRows(win, registry, backlog, live, now),
      queues: this.queueRows(live, now),
      backlogSampled: backlog?.sampled ?? null,
      backlogTruncated: backlog?.truncated ?? false,
    };
  }

  public async getChannelDetail(name: string, range: MessagingRange): Promise<ChannelDetailDto> {
    const now = Date.now();
    const { win, live, registry, backlog } = await this.channelContext(range, now);
    const row = this.channelRows(win, registry, backlog, live, now).find((c) => c.channel === name);
    if (!row) throw new MessagingNotFoundException('messaging.error.channelNotFound', { name });
    const S = MessagingOpsService;
    const [{ series: throughput }, { series: processing }, errors, recent] = await Promise.all([
      this.series(range, [
        { id: 'published', unit: '/s', value: S.perSec(channelMetric(name, 'pub')) },
        { id: 'consumed', unit: '/s', value: S.perSec(channelMetric(name, 'con')) },
        { id: 'failed', unit: '/s', value: S.perSec(channelMetric(name, 'fail')) },
      ]),
      this.series(range, [
        {
          id: 'processingAvg',
          unit: 'ms',
          value: (g) => meanOf(mergedOf(g.b, channelMetric(name, 'proc'))),
        },
        { id: 'processingP95', unit: 'ms', value: S.pct(channelMetric(name, 'proc'), 95) },
      ]),
      this.store.errors().catch(() => [] as MessagingErrorRecord[]),
      this.recentMessages({
        queue: row.queue,
        channel: name,
        status: null,
        producer: null,
        search: '',
      }),
    ]);
    return {
      range,
      channel: row,
      throughput,
      processing,
      consumers: this.consumerRows(win, live).filter((c) => c.queue === row.queue),
      recentErrors: errors
        .filter((e) => e.channel === name)
        .slice(0, RECENT_LIMIT)
        .map((e) => this.errorDto(e)),
      recentMessages: recent,
    };
  }

  private recentMessages(filter: MessageFilter): Promise<SectionDto<MessageRowDto[]>> {
    return this.monitoring.section('browse', async () => {
      const page = await this.monitoring.provider.listMessages(filter, RECENT_LIMIT);
      return page.messages.slice(0, RECENT_LIMIT).map((m) => this.messageRow(m));
    });
  }

  public async getProducers(range: MessagingRange): Promise<MessagingProducersDto> {
    const now = Date.now();
    const [win, registry, errors] = await Promise.all([
      this.rangeWindow(range, now),
      this.monitoring.channelRegistry().catch(() => [] as ChannelRegistryEntry[]),
      this.store.errors().catch(() => [] as MessagingErrorRecord[]),
    ]);
    const producers = [...new Set(registry.map((r) => r.producer))];
    const rows: ProducerRowDto[] = producers.map((producer) => {
      const regs = registry.filter((r) => r.producer === producer);
      const m = this.metrics.producer(
        win,
        producer,
        regs.map((r) => r.channel),
      );
      const lastFail = errors.find((e) => e.stage === 'publish' && e.runtime === producer);
      return {
        producer,
        published: m.published,
        perSec: this.metrics.perSec(win, m.published),
        failures: m.failures,
        failureRatePercent:
          m.published + m.failures > 0
            ? round((m.failures / (m.published + m.failures)) * 100, 2)
            : null,
        channels: m.channels
          .map((c) => ({
            channel: c.channel,
            queue: regs.find((r) => r.channel === c.channel)?.queue ?? '',
            published: c.published,
            perSec: this.metrics.perSec(win, c.published),
          }))
          .sort((a, b) => b.published - a.published || a.channel.localeCompare(b.channel)),
        lastPublishedAt: iso(Math.max(...regs.map((r) => r.lastPublishedAt))),
        lastFailureAt: iso(lastFail?.at),
      };
    });
    return { range, producers: rows.sort((a, b) => b.published - a.published) };
  }

  public async getConsumers(range: MessagingRange): Promise<MessagingConsumersDto> {
    const now = Date.now();
    const [win, live] = await Promise.all([this.rangeWindow(range, now), this.live()]);
    const queues = this.queueRows(live, now);
    return {
      range,
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
    const rt = row.runtime ?? undefined;
    const S = MessagingOpsService;
    const [{ series: processing }, { series: throughput }, { series: lag }, errors, recent] =
      await Promise.all([
        this.series(range, [
          {
            id: 'processingAvg',
            unit: 'ms',
            value: (g) => meanOf(mergedOf(g.b, 'msg.process', rt)),
          },
          { id: 'processingP95', unit: 'ms', value: S.pct('msg.process', 95, rt) },
        ]),
        this.series(range, [
          { id: 'consumedPerMin', unit: '/min', value: S.perMin('msg.consumed', rt) },
          { id: 'failedPerMin', unit: '/min', value: S.perMin('msg.consume.failed', rt) },
        ]),
        this.series(range, [
          { id: 'lag', unit: 'msgs', value: S.gauge(queueMetric(row.queue, 'waiting')) },
        ]),
        this.store.errors().catch(() => [] as MessagingErrorRecord[]),
        this.recentMessages({
          queue: row.queue,
          channel: null,
          status: null,
          producer: null,
          search: '',
        }),
      ]);
    const m = this.metrics.consumer(win, rt);
    return {
      range,
      consumer: row,
      processing,
      throughput,
      lag,
      recentErrors: errors
        .filter((e) => e.consumer === name)
        .slice(0, RECENT_LIMIT)
        .map((e) => this.errorDto(e)),
      recentMessages: recent,
      retry: { retried: m.retried, recovered: m.recovered, deadLettered: m.deadLettered },
    };
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  public async getMessages(filter: MessageFilter, perState: number): Promise<MessagingMessagesDto> {
    const page = await this.monitoring.section('browse', () =>
      this.monitoring.provider.listMessages(filter, perState),
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
      this.monitoring.section('browse', () => this.monitoring.provider.message(id, queue)),
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
      this.monitoring.section('retry', () => this.monitoring.provider.retrying(RETRY_LIMIT)),
      this.metrics.window(startOfDay(now), now, now),
    ]);
    const d = this.metrics.delivery(todayWin);
    const c = this.cfg;
    return {
      retrying: list.available
        ? { available: true, data: list.data.map((m) => this.messageRow(m)) }
        : list,
      stats: {
        retryingNow: list.available ? list.data.length : null,
        retriedToday: d.retried,
        recoveredToday: d.recovered,
        deadLetteredToday: d.deadLettered,
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
      this.monitoring.section('deadLetter', () =>
        this.monitoring.provider.deadLetters(DEAD_LETTER_LIMIT),
      ),
      this.live(),
      this.metrics.window(startOfDay(now), now, now),
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
      addedToday: this.metrics.delivery(todayWin).deadLettered,
      oldestSec: secondsSince(oldest, now),
      bySource: [...bySource.entries()]
        .map(([channel, count]) => ({ channel, count }))
        .sort((a, b) => b.count - a.count),
      settings: this.settings(),
    };
  }

  public async getBroker(): Promise<MessagingBrokerDto> {
    return {
      broker: await this.monitoring.section('brokerInfo', () => this.monitoring.provider.broker()),
    };
  }

  // ─── Errors / Events / Operations / Config ────────────────────────────────

  public async getErrors(range: MessagingRange): Promise<MessagingErrorsDto> {
    const now = Date.now();
    const from = now - MESSAGING_RANGES[range] * MINUTE;
    const [errors, win] = await Promise.all([
      this.store.errors().catch(() => [] as MessagingErrorRecord[]),
      this.rangeWindow(range, now),
    ]);
    const b = win?.buckets ?? [];
    const recent = errors.filter((e) => e.at >= from);
    const counts = Object.fromEntries(
      ERROR_KINDS.map((k) => [
        k,
        k === 'publish'
          ? counterOf(b, 'msg.publish.failed')
          : win
            ? counterOf(b, `msg.err.${k}`)
            : recent.filter((e) => e.kind === k).length,
      ]),
    ) as Record<MessagingErrorKind, number>;
    return {
      counts,
      byStage: {
        publish: counterOf(b, 'msg.publish.failed'),
        consume: counterOf(b, 'msg.consume.failed'),
      },
      total: Object.values(counts).reduce((s, n) => s + n, 0),
      items: recent.slice(0, ERROR_LIST_LIMIT).map((e) => this.errorDto(e)),
      range,
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
    const info = this.monitoring.provider.info();
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
    return { ...result, at: new Date().toISOString() };
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
          { product: this.monitoring.provider.info().product },
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
