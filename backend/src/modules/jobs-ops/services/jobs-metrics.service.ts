import { Injectable } from '@nestjs/common';
import { PrometheusQueryClient } from '@packages/metrics/index.js';
import { round } from '@modules/performance/index.js';
import { WorkerMetricsService, type MetricWindow } from '@modules/worker-ops/index.js';
import type { JobTypeRowDto, JobsReportDto } from '../responses/jobs-ops.response.js';

const MINUTE = 60_000;
const TYPE_TTL_MS = 5 * MINUTE;
const WAIT_TTL_MS = MINUTE;

const r2 = (n: number | null) => (n === null || !Number.isFinite(n) ? null : round(n, 2));
const rate = (part: number, total: number) => (total > 0 ? round((part / total) * 100, 2) : null);

/**
 * Số đo job theo thời gian (Prometheus, dùng chung với Worker & Queue): báo cáo hôm nay / hôm qua, hiệu năng theo
 * loại job (label `channel`), và baseline (p95 theo loại job, thời gian chờ trung bình theo queue) để nhận diện job
 * chạy lâu / chờ lâu bất thường. Baseline đổi chậm nên giữ trong bộ nhớ ngắn hạn.
 */
@Injectable()
export class JobsMetricsService {
  private typeCache: { at: number; values: Map<string, number> } | null = null;
  private waitCache: { at: number; values: Map<string, number> } | null = null;

  constructor(
    private readonly metrics: WorkerMetricsService,
    private readonly prom: PrometheusQueryClient,
  ) {}

  public window(from: number, to: number, now: number) {
    return this.metrics.window(from, to, now);
  }

  /** p95 thời gian xử lý của từng loại job trong 24 giờ. */
  public async typicalByType(now: number): Promise<Map<string, number>> {
    if (this.typeCache && now - this.typeCache.at < TYPE_TTL_MS) return this.typeCache.values;
    const rows = await this.prom.safeQuery(
      'histogram_quantile(0.95, sum by (channel, le) (increase(job_duration_seconds_bucket[1d])))',
    );
    const values = new Map<string, number>();
    for (const x of rows) {
      const type = x.labels['channel'];
      if (type && Number.isFinite(x.value)) values.set(type, x.value * 1000);
    }
    this.typeCache = { at: now, values };
    return values;
  }

  /** Thời gian chờ trung bình 1 giờ qua theo queue (`*` = mọi queue). */
  public async waitByQueue(now: number, queues: string[]): Promise<Map<string, number>> {
    if (this.waitCache && now - this.waitCache.at < WAIT_TTL_MS) return this.waitCache.values;
    const w = await this.metrics.window(now - 60 * MINUTE, now, now).catch(() => null);
    const values = new Map<string, number>();
    const all = this.metrics.wait(w).avgMs;
    if (all !== null) values.set('*', all);
    for (const q of queues) {
      const v = this.metrics.wait(w, q).avgMs;
      if (v !== null) values.set(q, v);
    }
    this.waitCache = { at: now, values };
    return values;
  }

  public counts(w: MetricWindow | null, queue?: string | null) {
    return this.metrics.counts(w, queue);
  }

  public report(w: MetricWindow | null): JobsReportDto {
    const c = this.metrics.counts(w);
    const p = this.metrics.processing(w);
    return {
      created: c.incoming,
      completed: c.completed,
      failed: c.exhausted,
      retried: c.retried,
      successRatePercent: rate(c.completed, c.completed + c.exhausted),
      avgWaitMs: this.metrics.wait(w).avgMs,
      avgProcessingMs: p.avgMs,
      p95ProcessingMs: p.p95Ms,
    };
  }

  /** Hiệu năng theo loại job (`minutes` phút gần nhất): số lần chạy, lỗi, trung bình / p95 thời gian xử lý. */
  public async types(minutes: number): Promise<JobTypeRowDto[]> {
    const w = `${Math.max(1, Math.round(minutes))}m`;
    const q = (expr: string) => this.prom.safeQuery(expr);
    const [pub, con, sum, count, p95] = await Promise.all([
      q(`sum by (channel) (increase(messages_published_total{result="success"}[${w}]))`),
      q(`sum by (channel, result) (increase(messages_consumed_total[${w}]))`),
      q(`sum by (channel) (increase(job_duration_seconds_sum[${w}]))`),
      q(`sum by (channel) (increase(job_duration_seconds_count[${w}]))`),
      q(
        `histogram_quantile(0.95, sum by (channel, le) (increase(job_duration_seconds_bucket[${w}])))`,
      ),
    ]);
    const rows = new Map<
      string,
      {
        created: number;
        ok: number;
        failed: number;
        sum: number;
        count: number;
        p95: number | null;
      }
    >();
    const row = (type: string) => {
      let x = rows.get(type);
      if (!x) rows.set(type, (x = { created: 0, ok: 0, failed: 0, sum: 0, count: 0, p95: null }));
      return x;
    };
    const each = (
      list: typeof pub,
      fn: (x: ReturnType<typeof row>, v: number, l: Record<string, string>) => void,
    ) => {
      for (const s of list) {
        const type = s.labels['channel'];
        if (type && Number.isFinite(s.value)) fn(row(type), s.value, s.labels);
      }
    };
    each(pub, (x, v) => (x.created += Math.round(v)));
    each(con, (x, v, l) => {
      if (l['result'] === 'success') x.ok += Math.round(v);
      else x.failed += Math.round(v);
    });
    each(sum, (x, v) => (x.sum = v));
    each(count, (x, v) => (x.count = v));
    each(p95, (x, v) => (x.p95 = v));
    return [...rows.entries()]
      .map(([type, x]) => ({
        type,
        created: x.created,
        runs: x.ok + x.failed,
        failed: x.failed,
        failureRatePercent: rate(x.failed, x.ok + x.failed),
        avgMs: r2(x.count > 0 ? (x.sum / x.count) * 1000 : null),
        p95Ms: r2(x.p95 === null ? null : x.p95 * 1000),
      }))
      .filter((t) => t.created + t.runs > 0)
      .sort((a, b) => b.runs - a.runs || b.created - a.created || a.type.localeCompare(b.type));
  }
}
