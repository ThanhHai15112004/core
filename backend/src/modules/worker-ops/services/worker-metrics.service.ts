import { Injectable } from '@nestjs/common';
import type { Gauge } from 'prom-client';
import type { QueueInfo } from '@packages/queue/index.js';
import {
  MetricsRegistryService,
  PrometheusQueryClient,
  type PromSample,
} from '@packages/metrics/index.js';
import { round } from '@modules/performance/index.js';
import type { DurationStatsDto } from '../responses/worker-ops.response.js';
import { waitingOf } from './worker-utils.js';

/** Số liệu một queue (hoặc tổng) trong cửa sổ, đọc từ Prometheus. */
interface QueueStats {
  incoming: number;
  completed: number;
  failed: number;
  retried: number;
  exhausted: number;
  recovered: number;
  processing: DurationStatsDto;
  wait: { avgMs: number | null; p95Ms: number | null };
  peakWaiting: number | null;
}

/** Cửa sổ thời gian đã đọc sẵn từ PromQL — `null` khi Prometheus không trả lời. */
export interface MetricWindow {
  seconds: number;
  total: QueueStats;
  queues: Map<string, QueueStats>;
}

/** Số đo job theo cửa sổ: nhận vào, xong, lỗi, retry, hết lượt thử. */
export interface JobCounts {
  incoming: number;
  completed: number;
  failed: number;
  retried: number;
  exhausted: number;
  recovered: number;
  failureRatePercent: number | null;
}

export const QUEUE_JOBS_METRIC = 'core_queue_jobs';
const MAX_POINTS = 120;
const QUEUE_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

const r = (n: number | null, d = 2) => (n === null || !Number.isFinite(n) ? null : round(n, d));
const rate = (part: number, total: number) => (total > 0 ? round((part / total) * 100, 2) : null);
const emptyStats = (): QueueStats => ({
  incoming: 0,
  completed: 0,
  failed: 0,
  retried: 0,
  exhausted: 0,
  recovered: 0,
  processing: { avgMs: null, p50Ms: null, p95Ms: null, p99Ms: null },
  wait: { avgMs: null, p95Ms: null },
  peakWaiting: null,
});

/**
 * Số đo công việc nền: counter/histogram do worker ghi bằng prom-client (`messages_*_total`,
 * `job_duration_seconds`, `job_wait_seconds`, `job_attempt_failures_total`, `job_recovered_total`) và gauge
 * `core_queue_jobs{queue,state}` do monitor ghi — đọc lại bằng PromQL.
 */
@Injectable()
export class WorkerMetricsService {
  private readonly queueJobs: Gauge<'queue' | 'state'>;

  constructor(
    private readonly prom: PrometheusQueryClient,
    metrics: MetricsRegistryService,
  ) {
    this.queueJobs = metrics.gauge(QUEUE_JOBS_METRIC, 'Jobs per queue and state', [
      'queue',
      'state',
    ]);
  }

  /** Ghi độ sâu queue (monitor nền gọi mỗi tick). */
  public recordQueues(queues: readonly QueueInfo[]): void {
    for (const q of queues) {
      for (const state of QUEUE_STATES) {
        const v = state === 'waiting' ? waitingOf(q) : q.counts[state];
        this.queueJobs.set({ queue: q.name, state }, v);
      }
    }
  }

  public async window(fromMs: number, toMs: number, now: number): Promise<MetricWindow | null> {
    if (!this.prom.configured) return null;
    const seconds = Math.max(1, (Math.min(toMs, now) - fromMs) / 1000);
    const w = `${Math.max(60, Math.round(seconds))}s`;
    const offSec = Math.round((now - Math.min(toMs, now)) / 1000);
    const off = offSec > 0 ? ` offset ${offSec}s` : '';
    const inc = (m: string) => `increase(${m}[${w}]${off})`;
    const q = (expr: string) => this.prom.safeQuery(expr);
    const quant = (h: string, p: number, by: string) =>
      `histogram_quantile(${p}, sum by (${by}le) (${inc(`${h}_bucket`)}))`;

    const [published, consumed, attempts, recovered, ...hist] = await Promise.all([
      q(`sum by (queue) (${inc('messages_published_total{result="success"}')})`),
      q(`sum by (queue, result) (${inc('messages_consumed_total')})`),
      q(`sum by (queue, final) (${inc('job_attempt_failures_total')})`),
      q(`sum by (queue) (${inc('job_recovered_total')})`),
      q(`max by (queue) (max_over_time(${QUEUE_JOBS_METRIC}{state="waiting"}[${w}]${off}))`),
      ...['', 'queue, '].flatMap((by) => [
        q(`sum by (${by.replace(', ', '')}) (${inc('job_duration_seconds_sum')})`),
        q(`sum by (${by.replace(', ', '')}) (${inc('job_duration_seconds_count')})`),
        q(quant('job_duration_seconds', 0.5, by)),
        q(quant('job_duration_seconds', 0.95, by)),
        q(quant('job_duration_seconds', 0.99, by)),
        q(`sum by (${by.replace(', ', '')}) (${inc('job_wait_seconds_sum')})`),
        q(`sum by (${by.replace(', ', '')}) (${inc('job_wait_seconds_count')})`),
        q(quant('job_wait_seconds', 0.95, by)),
      ]),
    ]);

    const total = emptyStats();
    const queues = new Map<string, QueueStats>();
    const of = (labels: Record<string, string>) => {
      const name = labels['queue'];
      if (!name) return null;
      let s = queues.get(name);
      if (!s) queues.set(name, (s = emptyStats()));
      return s;
    };
    const add =
      (key: 'incoming' | 'completed' | 'failed' | 'retried' | 'exhausted' | 'recovered') =>
      (labels: Record<string, string>, v: number) => {
        const n = Math.round(v);
        total[key] += n;
        const s = of(labels);
        if (s) s[key] += n;
      };
    for (const x of published) add('incoming')(x.labels, x.value);
    for (const x of consumed) {
      add(x.labels['result'] === 'success' ? 'completed' : 'failed')(x.labels, x.value);
    }
    for (const x of attempts) {
      add(x.labels['final'] === 'true' ? 'exhausted' : 'retried')(x.labels, x.value);
    }
    for (const x of recovered) add('recovered')(x.labels, x.value);
    const [peak] = hist.splice(0, 1);
    for (const x of peak ?? []) {
      const s = of(x.labels);
      if (s) s.peakWaiting = Math.round(x.value);
      total.peakWaiting = Math.max(total.peakWaiting ?? 0, Math.round(x.value));
    }

    // 8 truy vấn histogram cho tổng, rồi 8 cho từng queue.
    const apply = (
      rows: PromSample[][],
      target: (labels: Record<string, string>) => QueueStats | null,
    ) => {
      const [dSum, dCount, p50, p95, p99, wSum, wCount, w95] = rows;
      const pick = (list: typeof published | undefined, labels: Record<string, string>) =>
        list?.find((x) => (x.labels['queue'] ?? '') === (labels['queue'] ?? ''))?.value ?? null;
      const keys = new Map<string, Record<string, string>>();
      for (const list of rows)
        for (const x of list ?? []) keys.set(x.labels['queue'] ?? '', x.labels);
      for (const labels of keys.values()) {
        const s = target(labels);
        if (!s) continue;
        const ms = (v: number | null) => (v === null ? null : v * 1000);
        const dc = pick(dCount, labels);
        const wc = pick(wCount, labels);
        s.processing = {
          avgMs: r(dc ? ms(pick(dSum, labels))! / dc : null),
          p50Ms: r(ms(pick(p50, labels))),
          p95Ms: r(ms(pick(p95, labels))),
          p99Ms: r(ms(pick(p99, labels))),
        };
        s.wait = {
          avgMs: r(wc ? ms(pick(wSum, labels))! / wc : null),
          p95Ms: r(ms(pick(w95, labels))),
        };
      }
    };
    apply(hist.slice(0, 8), () => total);
    apply(hist.slice(8, 16), of);
    return { seconds, total, queues };
  }

  /** Chuỗi thời gian `minutes` phút gần nhất (`$w` = cửa sổ rate); `resolutionSec` null khi không có điểm. */
  public async series<D extends { expr: string }>(minutes: number, defs: D[]) {
    const stepSec = Math.max(30, Math.ceil((minutes * 60) / MAX_POINTS));
    const rateWindow = `${Math.max(120, stepSec * 2)}s`;
    const series = await Promise.all(
      defs.map(async (d) => {
        const res = await this.prom.safeRange(
          d.expr.replaceAll('$w', rateWindow),
          minutes,
          stepSec,
        );
        return {
          ...d,
          points: (res[0]?.points ?? [])
            .filter((p) => Number.isFinite(p.v))
            .map((p) => ({ t: p.t, value: round(p.v, 3) })),
        };
      }),
    );
    return { resolutionSec: series.some((s) => s.points.length > 0) ? stepSec : null, series };
  }

  public perMin(w: MetricWindow | null, n: number): number | null {
    return w ? round((n / w.seconds) * 60, 2) : null;
  }

  private stats(w: MetricWindow | null, queue?: string | null): QueueStats {
    if (!w) return emptyStats();
    return queue ? (w.queues.get(queue) ?? emptyStats()) : w.total;
  }

  public counts(w: MetricWindow | null, queue?: string | null): JobCounts {
    const s = this.stats(w, queue);
    return {
      incoming: s.incoming,
      completed: s.completed,
      failed: s.failed,
      retried: s.retried,
      exhausted: s.exhausted,
      recovered: s.recovered,
      failureRatePercent: rate(s.failed, s.completed + s.failed),
    };
  }

  /** Thời gian xử lý job — trung bình và phân vị (histogram `job_duration_seconds`). */
  public processing(w: MetricWindow | null, queue?: string | null): DurationStatsDto {
    return this.stats(w, queue).processing;
  }

  /** Thời gian chờ trong queue (tạo job → worker nhận). */
  public wait(w: MetricWindow | null, queue?: string | null) {
    return this.stats(w, queue).wait;
  }

  /** Đỉnh độ sâu queue trong cửa sổ (gauge `core_queue_jobs`). */
  public waiting(w: MetricWindow | null, queue?: string | null) {
    return { peak: this.stats(w, queue).peakWaiting };
  }
}
