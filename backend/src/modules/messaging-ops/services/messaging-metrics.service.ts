import { Injectable } from '@nestjs/common';
import { PrometheusQueryClient, type PromSample, round } from '@packages/metrics/index.js';
import { QUEUE_JOBS_METRIC, WorkerMetricsService } from '@modules/worker-ops/index.js';
import type { DeliveryDto } from '../responses/messaging-ops.response.js';

export interface Timing {
  avgMs: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

/** Luồng message của một channel / queue / tổng trong cửa sổ. */
export interface Flow {
  published: number;
  publishFailures: number;
  consumed: number;
  failed: number;
  retried: number;
  deadLettered: number;
  recovered: number;
  processing: Timing;
}

/** Cửa sổ thời gian đã đọc sẵn từ PromQL — `null` khi Prometheus không trả lời. */
export interface MetricWindow {
  seconds: number;
  total: Flow & { lag: { avg: number | null; peak: number | null } };
  channels: Map<string, Flow>;
  queues: Map<string, Flow>;
  /** Queue mà channel đi qua (theo nhãn của counter). */
  channelQueue: Map<string, string>;
}

const WAITING = `max by (queue) (${QUEUE_JOBS_METRIC}{state="waiting"})`;

const r = (n: number | null, d = 2) => (n === null || !Number.isFinite(n) ? null : round(n, d));
const rate = (part: number, total: number) => (total > 0 ? round((part / total) * 100, 2) : null);
const emptyFlow = (): Flow => ({
  published: 0,
  publishFailures: 0,
  consumed: 0,
  failed: 0,
  retried: 0,
  deadLettered: 0,
  recovered: 0,
  processing: { avgMs: null, p95Ms: null, p99Ms: null },
});

/** Giá trị nhãn an toàn trong PromQL (`{channel="…"}`). */
export const labelValue = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * Số đo messaging đọc bằng PromQL: counter `messages_published_total` (publisher) / `messages_consumed_total`,
 * `job_attempt_failures_total`, `job_recovered_total`, histogram `job_duration_seconds` (worker) và gauge
 * `core_queue_jobs` (monitor Worker & Queue) — không tự lưu time-series.
 */
@Injectable()
export class MessagingMetricsService {
  constructor(
    private readonly prom: PrometheusQueryClient,
    private readonly worker: WorkerMetricsService,
  ) {}

  /** `detail` = false bỏ thời gian xử lý theo channel/queue (đánh giá rule, báo cáo ngày chỉ cần tổng). */
  public async window(
    fromMs: number,
    toMs: number,
    now: number,
    detail = true,
  ): Promise<MetricWindow | null> {
    if (!this.prom.configured) return null;
    const seconds = Math.max(1, (Math.min(toMs, now) - fromMs) / 1000);
    const w = `${Math.max(60, Math.round(seconds))}s`;
    const offSec = Math.round((now - Math.min(toMs, now)) / 1000);
    const off = offSec > 0 ? ` offset ${offSec}s` : '';
    const step = `${Math.max(15, Math.round(seconds / 120))}s`;
    const inc = (m: string) => `increase(${m}[${w}]${off})`;
    const q = (expr: string) => this.prom.query(expr);
    const quant = (p: number, by: string) =>
      `histogram_quantile(${p}, sum by (${by ? `${by}, ` : ''}le) (${inc('job_duration_seconds_bucket')}))`;
    const sumBy = (by: string) => (by ? `sum by (${by})` : 'sum');
    const timing = (by: string) => [
      q(`${sumBy(by)} (${inc('job_duration_seconds_sum')})`),
      q(`${sumBy(by)} (${inc('job_duration_seconds_count')})`),
      q(quant(0.95, by)),
      q(quant(0.99, by)),
    ];

    let rows: PromSample[][];
    try {
      rows = await Promise.all([
        q(`sum by (queue, channel, result) (${inc('messages_published_total')})`),
        q(`sum by (queue, channel, result) (${inc('messages_consumed_total')})`),
        q(`sum by (queue, channel, final) (${inc('job_attempt_failures_total')})`),
        q(`sum by (queue) (${inc('job_recovered_total')})`),
        q(`avg_over_time(sum(${WAITING})[${w}:${step}]${off})`),
        q(`max_over_time(sum(${WAITING})[${w}:${step}]${off})`),
        ...timing(''),
        ...(detail ? [...timing('channel'), ...timing('queue')] : []),
      ]);
    } catch {
      // Prometheus không trả lời → không có số liệu (null), không phải 0.
      return null;
    }
    const [published, consumed, attempts, recovered, lagAvg, lagPeak, ...hist] = rows;

    const total = {
      ...emptyFlow(),
      lag: {
        avg: r(lagAvg![0]?.value ?? null, 1),
        peak: lagPeak![0] ? Math.round(lagPeak![0].value) : null,
      },
    };
    const channels = new Map<string, Flow>();
    const queues = new Map<string, Flow>();
    const channelQueue = new Map<string, string>();
    const of = (map: Map<string, Flow>, key: string | undefined) => {
      if (!key) return null;
      let f = map.get(key);
      if (!f) map.set(key, (f = emptyFlow()));
      return f;
    };
    type Counted = Exclude<keyof Flow, 'processing'>;
    const add = (key: Counted, labels: Record<string, string>, v: number) => {
      const n = Math.round(v);
      total[key] += n;
      if (labels['channel'] && labels['queue'])
        channelQueue.set(labels['channel'], labels['queue']);
      const c = of(channels, labels['channel']);
      if (c) c[key] += n;
      const qf = of(queues, labels['queue']);
      if (qf) qf[key] += n;
    };
    for (const x of published!)
      add(x.labels['result'] === 'success' ? 'published' : 'publishFailures', x.labels, x.value);
    for (const x of consumed!)
      add(x.labels['result'] === 'success' ? 'consumed' : 'failed', x.labels, x.value);
    for (const x of attempts!)
      add(x.labels['final'] === 'true' ? 'deadLettered' : 'retried', x.labels, x.value);
    for (const x of recovered!) add('recovered', x.labels, x.value);

    // Mỗi nhóm 4 truy vấn: sum, count, p95, p99 (tổng, rồi theo channel, theo queue).
    const apply = (group: PromSample[][], label: string, target: (k: string) => Flow | null) => {
      const [sum, count, p95, p99] = group;
      const pick = (list: PromSample[] | undefined, k: string) =>
        list?.find((x) => (x.labels[label] ?? '') === k)?.value ?? null;
      const keys = new Set(group.flatMap((list) => list.map((x) => x.labels[label] ?? '')));
      for (const k of keys) {
        const f = target(k);
        if (!f) continue;
        const n = pick(count, k);
        const s = pick(sum, k);
        const ms = (v: number | null) => (v === null ? null : v * 1000);
        f.processing = {
          avgMs: r(n && s !== null ? (s / n) * 1000 : null),
          p95Ms: r(ms(pick(p95, k))),
          p99Ms: r(ms(pick(p99, k))),
        };
      }
    };
    apply(hist.slice(0, 4), '', () => total);
    if (detail) {
      apply(hist.slice(4, 8), 'channel', (k) => of(channels, k));
      apply(hist.slice(8, 12), 'queue', (k) => of(queues, k));
    }
    return { seconds, total, channels, queues, channelQueue };
  }

  /** Tổng message đang chờ `minutes` phút trước (gauge `core_queue_jobs`). */
  public lagAgo(minutes: number): Promise<number | null> {
    return this.prom.value(`sum(${WAITING} offset ${minutes}m)`);
  }

  /** Chuỗi thời gian (`$w` = cửa sổ rate) — dùng chung cách lấy mẫu với Worker & Queue. */
  public series<D extends { expr: string }>(minutes: number, defs: D[]) {
    return this.worker.series(minutes, defs);
  }

  public perSec(w: MetricWindow | null, n: number | null): number | null {
    return w && n !== null ? round(n / w.seconds, 3) : null;
  }

  public delivery(w: MetricWindow | null): DeliveryDto | null {
    if (!w) return null;
    const t = w.total;
    return {
      published: t.published,
      consumed: t.consumed,
      failed: t.failed,
      retried: t.retried,
      deadLettered: t.deadLettered,
      recovered: t.recovered,
      publishFailures: t.publishFailures,
      failureRatePercent: rate(t.failed, t.consumed + t.failed),
    };
  }

  public processing(w: MetricWindow | null, queue?: string): Timing {
    const f = queue ? w?.queues.get(queue) : w?.total;
    return f?.processing ?? emptyFlow().processing;
  }

  /** Luồng của một channel; `null` khi không có Prometheus, số 0 khi channel không có lưu lượng. */
  public channel(w: MetricWindow | null, name: string): Flow | null {
    return w ? (w.channels.get(name) ?? emptyFlow()) : null;
  }

  public queue(w: MetricWindow | null, name: string): Flow | null {
    return w ? (w.queues.get(name) ?? emptyFlow()) : null;
  }

  public failureRate(f: Flow | null): number | null {
    return f ? rate(f.failed, f.consumed + f.failed) : null;
  }
}
