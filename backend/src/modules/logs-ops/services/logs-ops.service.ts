import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  LOG_ENTRY_LEVELS,
  SENSITIVE_KEY_NAMES,
  TEXT_REDACTION_PATTERNS,
  type LogEntry,
  type LogLevelOverrideRecord,
} from '@packages/logging/index.js';
import { LOG_INGEST_TTL_MS, LONG_RUNNING_RUNTIMES } from '@packages/runtime/index.js';
import { TELEMETRY_TIERS, type MetricBucket } from '@packages/telemetry/index.js';
import { dependencyOf } from '@packages/messaging/index.js';
import { JobMonitoringService } from '@packages/queue/index.js';
import { SchedulerStore } from '@packages/scheduler/index.js';
import type { RequestSummary } from '@packages/traffic/index.js';
import { TrafficStoreService } from '@modules/traffic/index.js';
import { RuntimeStoreService } from '@modules/runtimes/index.js';
import { round } from '@modules/performance/index.js';
import { LogsStoreService, type ErrorGroupState } from './logs-store.service.js';
import { LogsMetricsService, type LogWindow } from './logs-metrics.service.js';
import { LogAuditService } from './log-audit.service.js';
import { LogTraceService } from './log-trace.service.js';
import { logRow } from './log-rows.js';
import {
  decodeLogCursor,
  encodeLogCursor,
  entryTime,
  matchesLog,
  newerThan,
  olderThan,
  type LogFilter,
} from './log-query.js';
import {
  LogNotFoundException,
  LogsActionRejectedException,
  LogsUnavailableException,
} from '../exceptions/logs-ops.exceptions.js';
import type {
  ErrorGroupDetailDto,
  ErrorGroupRowDto,
  ErrorGroupsDto,
  LevelStateDto,
  LogCoverageDto,
  LogDetailDto,
  LogIssueDto,
  LogLinksDto,
  LogSearchDto,
  LogTailDto,
  LogsBackendDto,
  LogsConfigDto,
  LogsOverviewDto,
  LogsRange,
  LogsReportDto,
  LogsReportTotalsDto,
  LogsSeriesDto,
  TraceDto,
} from '../responses/logs-ops.response.js';

/** Khoảng thời gian (phút). */
export const LOGS_RANGES: Record<LogsRange, number> = {
  '15m': 15,
  '1h': 60,
  '6h': 360,
  '24h': 1440,
  '7d': 10080,
};
export const LEVEL_DURATIONS_MIN = [15, 30, 60, 120] as const;
export const OVERRIDE_LEVELS = ['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
export type OverrideLevel = (typeof OVERRIDE_LEVELS)[number];
export type ExportFormat = 'json' | 'csv' | 'ndjson';

/** Cửa sổ so sánh để nhận diện spike: 5 phút gần nhất so với 60 phút trước đó. */
const RECENT_MIN = 5;
const BASELINE_MIN = 60;
const STREAMING_SEC = 60;
const SPARK_POINTS = 24;

export interface OperationContext {
  actor: string | null;
  ip: string | null;
}

const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);
const pct = (part: number, total: number) => (total > 0 ? round((part / total) * 100, 1) : null);

function groupLabel(g: ErrorGroupState['meta']): string {
  return g.errorType ? `${g.errorType}: ${g.template}` : g.template;
}

/** Gộp các bucket thành tối đa `n` điểm (sparkline). */
function compress(values: number[], n: number): number[] {
  if (values.length <= n) return values;
  const size = values.length / n;
  return Array.from({ length: n }, (_, i) =>
    values.slice(Math.floor(i * size), Math.floor((i + 1) * size)).reduce((a, b) => a + b, 0),
  );
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Logs — Investigation Center: tổng quan volume / lỗi, Log Explorer (lọc + cursor), live tail, chi tiết log (metadata,
 * stack, liên kết sang request / job / execution), nhóm lỗi (fingerprint), trace theo correlation, audit, báo cáo,
 * cấu hình (level tạm thời, retention, redaction) và export. Mọi số liệu lấy từ log / telemetry thật.
 */
@Injectable()
export class LogsOpsService {
  constructor(
    private readonly config: CoreConfigService,
    private readonly store: LogsStoreService,
    private readonly metrics: LogsMetricsService,
    private readonly audit: LogAuditService,
    private readonly traces: LogTraceService,
    private readonly traffic: TrafficStoreService,
    private readonly jobs: JobMonitoringService,
    private readonly scheduler: SchedulerStore,
    private readonly runtimes: RuntimeStoreService,
  ) {}

  public get available(): boolean {
    return this.store.isAvailable();
  }

  public get auditEnabled(): boolean {
    return this.config.logs.audit;
  }

  private assertAvailable(): void {
    if (!this.store.isAvailable()) throw new LogsUnavailableException();
  }

  private backend(): LogsBackendDto {
    return {
      provider: 'redis-buffer',
      historicalSearch: 'limited',
      fullText: 'scan',
      bufferPerRuntime: this.store.capacity,
      metricsRetentionDays: TELEMETRY_TIERS.h1.ttlSec / 86_400,
      consoleFormat: this.config.logs.format,
    };
  }

  private redaction(): LogsOverviewDto['redaction'] {
    return {
      enabled: true,
      keys: [...SENSITIVE_KEY_NAMES],
      patterns: [...TEXT_REDACTION_PATTERNS],
    };
  }

  private async coverage(): Promise<LogCoverageDto[]> {
    const snap = await this.store.logs();
    return [...snap.byRuntime].map(([runtime, list]) => ({
      runtime,
      entries: list.length,
      capacity: this.store.capacity,
      oldestAt: list.length ? list[list.length - 1]!.t : null,
      newestAt: list.length ? list[0]!.t : null,
    }));
  }

  // ─── Overview ─────────────────────────────────────────────────────────────

  public async getOverview(range: LogsRange, now = Date.now()): Promise<LogsOverviewDto> {
    const base = {
      range,
      environment: this.config.app.env,
      backend: this.backend(),
      redaction: this.redaction(),
    };
    if (!this.store.isAvailable())
      return {
        ...base,
        status: 'unavailable',
        lastEventAt: null,
        lastIngestAt: null,
        kpis: {
          logsPerMin: null,
          total: null,
          errors: null,
          warnings: null,
          fatal: null,
          sources: 0,
          errorRatePercent: null,
          uniqueErrors: 0,
          traceablePercent: null,
          dropped: null,
          redacted: null,
        },
        levels: [],
        sources: [],
        modules: [],
        issues: [{ key: 'logs.issue.unavailable', severity: 'critical', params: {}, target: null }],
        topErrors: [],
        recentAudit: [],
        levelsActive: [],
      };

    const from = now - LOGS_RANGES[range] * 60_000;
    const [w, spikeW, snap, ingest, overrides, groups, audit] = await Promise.all([
      this.metrics.window(from, now, now),
      this.metrics.window(now - (RECENT_MIN + BASELINE_MIN) * 60_000, now, now, 'm1'),
      this.store.logs(),
      this.store.ingestStates().catch(() => []),
      this.store.overrides().catch(() => new Map<string, LogLevelOverrideRecord>()),
      this.store.groups().catch(() => [] as ErrorGroupState[]),
      this.audit.all().catch(() => ({ items: [], domains: [] })),
    ]);

    const counts = this.metrics.levelCounts(w);
    const total = this.metrics.total(counts);
    const errors = counts.error + counts.fatal;
    const hasMetrics = w !== null && (total > 0 || w.buckets.some((b) => b.byInstance.size > 0));
    const recent = this.metrics.rateChange(
      spikeW,
      (b) => this.metrics.totalIn(b),
      now,
      RECENT_MIN,
      BASELINE_MIN,
    );
    const errRate = this.metrics.rateChange(
      spikeW,
      (b) => this.metrics.errorsIn(b),
      now,
      RECENT_MIN,
      BASELINE_MIN,
    );
    const byGroup = this.metrics.byGroup(w?.buckets ?? []);
    const sources = this.metrics.bySource(w);
    const modules = this.metrics.byModule(w);
    const dropped = this.metrics.counter(w, 'log.drop');
    const traceable = this.metrics.counter(w, 'log.tr');
    const liveIngest = ingest.filter((s) => s.updatedAt >= now - LOG_INGEST_TTL_MS);
    const lastEventAt = snap.entries[0] ? entryTime(snap.entries[0]) : null;
    const lastIngestAt = liveIngest.reduce<number | null>(
      (m, s) => Math.max(m ?? 0, s.lastSuccessAt ?? 0) || m,
      null,
    );
    const failing = liveIngest.filter(
      (s) => s.lastErrorAt && (!s.lastSuccessAt || s.lastErrorAt > s.lastSuccessAt),
    );

    const groupRows = this.groupRows(groups, w, spikeW, now);
    const issues = this.issues({
      now,
      errors,
      total,
      dropped,
      failing,
      recent,
      errRate,
      groupRows,
      sources,
      overrides,
    });

    return {
      ...base,
      status:
        failing.length || dropped > 0
          ? 'degraded'
          : lastEventAt && lastEventAt >= now - STREAMING_SEC * 1000
            ? 'streaming'
            : 'idle',
      lastEventAt: iso(lastEventAt),
      lastIngestAt: iso(lastIngestAt),
      kpis: {
        logsPerMin: hasMetrics ? (recent?.currentPerMin ?? this.metrics.perMin(w, total)) : null,
        total: hasMetrics ? total : null,
        errors: hasMetrics ? errors : null,
        warnings: hasMetrics ? counts.warn : null,
        fatal: hasMetrics ? counts.fatal : null,
        sources: sources.size,
        errorRatePercent: hasMetrics ? pct(errors, total) : null,
        uniqueErrors: byGroup.size,
        traceablePercent: hasMetrics ? pct(traceable, total) : null,
        dropped: hasMetrics ? dropped : null,
        redacted: liveIngest.length ? liveIngest.reduce((a, s) => a + s.redacted, 0) : null,
      },
      levels: LOG_ENTRY_LEVELS.filter(
        (l) => counts[l] > 0 || l === 'info' || l === 'warn' || l === 'error',
      ).map((l) => ({
        level: l,
        count: counts[l],
        percent: pct(counts[l], total),
      })),
      sources: [...sources]
        .map(([runtime, s]) => ({
          runtime,
          total: s.total,
          perMin: this.metrics.perMin(w, s.total),
          errors: s.errors,
          warnings: s.warnings,
          instances: s.instances.size,
        }))
        .sort((a, b) => b.total - a.total),
      modules: [...modules]
        .map(([module, m]) => ({ module, total: m.total, errors: m.errors }))
        .sort((a, b) => b.errors - a.errors || b.total - a.total)
        .slice(0, 12),
      issues,
      topErrors: groupRows.filter((g) => g.count > 0).slice(0, 5),
      recentAudit: audit.items.slice(0, 6),
      levelsActive: [...overrides.values()]
        .filter((o) => o.until === null || o.until > now)
        .map((o) => ({
          runtime: o.runtime,
          level: o.level,
          until: iso(o.until),
          modules: o.modules,
        })),
    };
  }

  private issues(x: {
    now: number;
    errors: number;
    total: number;
    dropped: number;
    failing: { runtime: string; lastError: string | null }[];
    recent: { currentPerMin: number; baselinePerMin: number } | null;
    errRate: { currentPerMin: number; baselinePerMin: number } | null;
    groupRows: ErrorGroupRowDto[];
    sources: Map<string, { errors: number }>;
    overrides: Map<string, LogLevelOverrideRecord>;
  }): LogIssueDto[] {
    const r = this.config.logs.rules;
    const out: LogIssueDto[] = [];
    if (x.dropped > 0)
      out.push({
        key: 'logs.issue.dropped',
        severity: 'critical',
        params: { count: x.dropped },
        target: { kind: 'config' },
      });
    for (const f of x.failing)
      out.push({
        key: 'logs.issue.ingestFailing',
        severity: 'critical',
        params: { runtime: f.runtime, error: f.lastError ?? '' },
        target: { kind: 'config' },
      });
    if (
      x.errRate &&
      this.isSpike(
        x.errRate.currentPerMin,
        x.errRate.baselinePerMin,
        r.spikeFactor,
        r.spikeMinPerMin,
      )
    )
      out.push({
        key: 'logs.issue.errorSpike',
        severity: 'warning',
        params: {
          before: x.errRate.baselinePerMin,
          after: x.errRate.currentPerMin,
          percent: this.increase(x.errRate.currentPerMin, x.errRate.baselinePerMin),
        },
        target: { kind: 'explorer', query: { level: 'error,fatal', window: '15m' } },
      });
    for (const g of x.groupRows.filter((g) => g.spiking).slice(0, 3))
      out.push({
        key: 'logs.issue.groupSpike',
        severity: 'warning',
        params: { label: g.errorType ?? g.template, percent: g.changePercent ?? 0 },
        target: { kind: 'error', fingerprint: g.fingerprint },
      });
    for (const g of x.groupRows.filter((g) => g.isNew).slice(0, 3))
      out.push({
        key: 'logs.issue.newError',
        severity: 'warning',
        params: {
          label: g.errorType ?? g.template,
          minutes: g.firstSeen
            ? Math.max(0, Math.round((x.now - Date.parse(g.firstSeen)) / 60_000))
            : 0,
          count: g.total,
        },
        target: { kind: 'error', fingerprint: g.fingerprint },
      });
    const rate = pct(x.errors, x.total);
    if (rate !== null && rate >= r.errorRateWarnPercent && x.errors >= 5)
      out.push({
        key: 'logs.issue.errorRate',
        severity: 'warning',
        params: { percent: rate, threshold: r.errorRateWarnPercent },
        target: { kind: 'explorer', query: { level: 'error,fatal' } },
      });
    const top = [...x.sources].sort((a, b) => b[1].errors - a[1].errors)[0];
    if (top && x.errors >= 10 && top[1].errors / x.errors >= 0.6)
      out.push({
        key: 'logs.issue.sourceShare',
        severity: 'info',
        params: { runtime: top[0], percent: pct(top[1].errors, x.errors) ?? 0 },
        target: { kind: 'explorer', query: { runtime: top[0], level: 'error,fatal' } },
      });
    if (
      x.recent &&
      this.isSpike(
        x.recent.currentPerMin,
        x.recent.baselinePerMin,
        r.highVolumeFactor,
        r.highVolumeMinPerMin,
      )
    )
      out.push({
        key: 'logs.issue.highVolume',
        severity: 'warning',
        params: { current: x.recent.currentPerMin, baseline: x.recent.baselinePerMin },
        target: { kind: 'config' },
      });
    for (const o of x.overrides.values()) {
      if (o.until !== null && o.until <= x.now) continue;
      if (o.level !== 'DEBUG' && o.level !== 'VERBOSE') continue;
      out.push({
        key: o.until ? 'logs.issue.debugActive' : 'logs.issue.debugPermanent',
        severity: o.until ? 'info' : 'warning',
        params: {
          runtime: o.runtime,
          level: o.level,
          minutes: o.until ? Math.max(1, Math.round((o.until - x.now) / 60_000)) : 0,
        },
        target: { kind: 'config' },
      });
    }
    if (!out.some((i) => i.severity === 'critical' || i.severity === 'warning'))
      out.unshift({ key: 'logs.issue.healthy', severity: 'ok', params: {}, target: null });
    return out;
  }

  private isSpike(current: number, baseline: number, factor: number, minPerMin: number): boolean {
    return current >= minPerMin && current >= factor * Math.max(baseline, 0.1);
  }

  private increase(current: number, baseline: number): number {
    return baseline > 0
      ? Math.round(((current - baseline) / baseline) * 100)
      : 100 * Math.round(current);
  }

  // ─── Biểu đồ ──────────────────────────────────────────────────────────────

  public async getSeries(range: LogsRange, now = Date.now()): Promise<LogsSeriesDto> {
    const from = now - LOGS_RANGES[range] * 60_000;
    // 15m / 1h ở tầng 1 phút cho biểu đồ dễ đọc; dài hơn theo tầng phủ được.
    const w = await this.metrics.window(
      from,
      now,
      now,
      range === '15m' || range === '1h' ? 'm1' : undefined,
    );
    const bucketSec = w ? TELEMETRY_TIERS[w.tier].seconds : 60;
    const points = (w?.buckets ?? []).map((b) => {
      const c = this.metrics.levelCounts(null, [b]);
      return {
        t: new Date(b.start).toISOString(),
        debug: c.debug + c.verbose,
        info: c.info,
        warn: c.warn,
        error: c.error,
        fatal: c.fatal,
      };
    });
    return { range, bucketSec, points, spike: this.spikeIn(points, bucketSec) };
  }

  /** Bucket có số lỗi vượt ngưỡng spike so với trung bình các bucket trước đó (rolling baseline). */
  private spikeIn(points: LogsSeriesDto['points'], bucketSec: number): LogsSeriesDto['spike'] {
    const r = this.config.logs.rules;
    const perMin = points.map((p) => ((p.error + p.fatal) / bucketSec) * 60);
    let best: LogsSeriesDto['spike'] = null;
    let bestRatio = 0;
    for (let i = 3; i < perMin.length; i++) {
      const prev = perMin.slice(Math.max(0, i - 12), i);
      const baseline = prev.reduce((a, b) => a + b, 0) / prev.length;
      const cur = perMin[i]!;
      if (!this.isSpike(cur, baseline, r.spikeFactor, r.spikeMinPerMin)) continue;
      const ratio = cur / Math.max(baseline, 0.1);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = { at: points[i]!.t, beforePerMin: round(baseline, 2), afterPerMin: round(cur, 2) };
      }
    }
    return best;
  }

  // ─── Explorer / live tail ─────────────────────────────────────────────────

  public async search(
    filter: LogFilter,
    cursor: string | null,
    limit: number,
  ): Promise<LogSearchDto> {
    this.assertAvailable();
    const snap = await this.store.logs(cursor === null);
    const c = decodeLogCursor(cursor);
    const matched = snap.entries.filter((e) => matchesLog(e, filter));
    const page = (c ? matched.filter((e) => olderThan(e, c)) : matched).slice(0, limit + 1);
    const items = page.slice(0, limit);
    return {
      items: items.map(logRow),
      nextCursor: page.length > limit ? encodeLogCursor(items[items.length - 1]!) : null,
      scanned: snap.entries.length,
      matched: matched.length,
      coverage: await this.coverage(),
      resolved: filter.anyId
        ? await this.traces.resolve(filter.anyId, snap.entries).catch(() => null)
        : null,
    };
  }

  /** Log mới hơn cursor (live mode) — tối đa `limit`, mới nhất trước. */
  public async tail(filter: LogFilter, after: string | null, limit: number): Promise<LogTailDto> {
    this.assertAvailable();
    const snap = await this.store.logs();
    const c = decodeLogCursor(after);
    const fresh = snap.entries.filter((e) => (!c || newerThan(e, c)) && matchesLog(e, filter));
    const items = c ? fresh.slice(-limit) : fresh.slice(0, limit);
    const latest = snap.entries.find((e) => matchesLog(e, filter)) ?? null;
    return {
      items: items.map(logRow),
      more: fresh.length > items.length,
      latestCursor: latest ? encodeLogCursor(latest) : after,
    };
  }

  public async exportLogs(
    filter: LogFilter,
    format: ExportFormat,
    requested: number,
    filterSummary: string,
    ctx: OperationContext,
  ): Promise<{ body: string; count: number; contentType: string; fileName: string }> {
    if (!this.config.logs.export) throw new LogsActionRejectedException('EXPORT_DISABLED', {}, 403);
    this.assertAvailable();
    const started = Date.now();
    const max = Math.min(requested, this.config.logs.exportMax);
    const snap = await this.store.logs(true);
    const rows = snap.entries.filter((e) => matchesLog(e, filter)).slice(0, max);
    const withDetails = this.config.logs.details;
    const full = (e: LogEntry) =>
      withDetails ? e : { ...e, stack: undefined, metadata: undefined };
    let body: string;
    if (format === 'csv') {
      const cols = [
        'at',
        'level',
        'runtime',
        'instance',
        'module',
        'message',
        'correlationId',
        'requestId',
        'jobId',
        'messageId',
        'executionId',
        'userId',
        'route',
        'status',
        'errorType',
        'durationMs',
        'fingerprint',
      ] as const;
      body = [
        cols.join(','),
        ...rows.map((e) => {
          const r = logRow(e);
          return cols.map((c) => csvCell(r[c])).join(',');
        }),
      ].join('\n');
    } else if (format === 'ndjson') body = rows.map((e) => JSON.stringify(full(e))).join('\n');
    else body = JSON.stringify(rows.map(full), null, 2);
    const stamp = new Date(started).toISOString().replace(/[:.]/g, '-');
    await this.store.recordOperation({
      at: started,
      action: 'export',
      target: format,
      result: 'success',
      detail: `rows=${rows.length}${filterSummary ? ` · ${filterSummary}` : ''}`,
      durationMs: Date.now() - started,
      actor: ctx.actor,
      ip: ctx.ip,
      error: null,
    });
    return {
      body,
      count: rows.length,
      contentType:
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : format === 'ndjson'
            ? 'application/x-ndjson'
            : 'application/json',
      fileName: `logs-${stamp}.${format}`,
    };
  }

  // ─── Chi tiết log ─────────────────────────────────────────────────────────

  public async getEntry(id: string): Promise<LogDetailDto> {
    this.assertAvailable();
    let snap = await this.store.logs();
    let entry = snap.entries.find((e) => e.id === id);
    if (!entry) {
      snap = await this.store.logs(true);
      entry = snap.entries.find((e) => e.id === id);
    }
    if (!entry) throw new LogNotFoundException('LOG_NOT_FOUND', { id });

    const sameInstance = (snap.byRuntime.get(entry.runtime ?? '') ?? []).filter(
      (e) => e.instance === entry.instance,
    );
    const idx = sameInstance.findIndex((e) => e.id === id);
    const details = this.config.logs.details;
    const group = entry.fingerprint
      ? (await this.store.groups([entry.fingerprint]).catch(() => []))[0]
      : undefined;
    return {
      ...logRow(entry),
      stack: details ? (entry.stack ?? null) : null,
      metadata: details ? (entry.metadata ?? null) : null,
      detailsHidden: !details && Boolean(entry.stack || entry.metadata),
      links: await this.links(entry),
      // Danh sách mới nhất trước: sau (mới hơn) nằm phía trước chỉ số.
      after: idx > 0 ? sameInstance.slice(Math.max(0, idx - 10), idx).map(logRow) : [],
      before: idx >= 0 ? sameInstance.slice(idx + 1, idx + 11).map(logRow) : [],
      group: group
        ? {
            fingerprint: group.meta.fingerprint,
            count: group.total,
            firstSeen: iso(group.firstSeen),
            lastSeen: iso(group.lastSeen),
          }
        : null,
    };
  }

  private async links(e: LogEntry): Promise<LogLinksDto> {
    const meta = e.metadata ?? {};
    let request: LogLinksDto['request'] = null;
    if (e.requestId) {
      const r = (await this.traffic.requestLog().catch(() => [] as RequestSummary[])).find(
        (x) => x.id === e.requestId,
      );
      request = {
        id: e.requestId,
        method: r?.method ?? null,
        route: r?.route ?? e.route ?? null,
        status: r?.status ?? null,
      };
    }
    let job: LogLinksDto['job'] = null;
    if (e.jobId) {
      const queue = typeof meta.queue === 'string' ? meta.queue : null;
      const rec = this.jobs.usable() ? await this.jobs.get(e.jobId, queue).catch(() => null) : null;
      job = { id: e.jobId, queue: rec?.queue ?? queue, type: rec?.type ?? e.jobType ?? null };
    }
    let execution: LogLinksDto['execution'] = null;
    if (e.executionId) {
      const x = await this.scheduler.execution(e.executionId).catch(() => null);
      execution = {
        id: e.executionId,
        taskId: x?.taskId ?? (typeof meta.taskId === 'string' ? meta.taskId : null),
      };
    }
    const dep = typeof meta.dependency === 'string' ? meta.dependency : null;
    return {
      request,
      job,
      execution,
      message: e.messageId && e.messageId !== e.jobId ? { id: e.messageId } : null,
      correlationId: e.correlationId ?? null,
      dependency:
        (dep as LogLinksDto['dependency']) ??
        (e.level === 'error' || e.level === 'fatal' || e.level === 'warn'
          ? dependencyOf(`${e.errorType ?? ''} ${e.message}`)
          : null),
    };
  }

  // ─── Nhóm lỗi ─────────────────────────────────────────────────────────────

  private groupRows(
    groups: ErrorGroupState[],
    w: LogWindow | null,
    spikeW: LogWindow | null,
    now: number,
    textFilter: string | null = null,
  ): ErrorGroupRowDto[] {
    const r = this.config.logs.rules;
    const buckets = w?.buckets ?? [];
    const counts = this.metrics.byGroup(buckets);
    const mid = w ? w.from + (w.to - w.from) / 2 : now;
    const firstHalf = this.metrics.byGroup(buckets.filter((b) => b.start < mid));
    const recent = this.metrics.byGroup(
      (spikeW?.buckets ?? []).filter((b) => b.start >= now - RECENT_MIN * 60_000),
    );
    const base = this.metrics.byGroup(
      (spikeW?.buckets ?? []).filter((b) => b.start < now - RECENT_MIN * 60_000),
    );
    const from = w?.from ?? now;
    const text = textFilter?.toLowerCase().trim() ?? '';
    return groups
      .filter((g) => (counts.get(g.meta.fingerprint) ?? 0) > 0 || (g.lastSeen ?? 0) >= from)
      .filter(
        (g) =>
          !text ||
          `${g.meta.errorType ?? ''} ${g.meta.template} ${g.meta.context ?? ''}`
            .toLowerCase()
            .includes(text),
      )
      .map((g) => {
        const fp = g.meta.fingerprint;
        const count = counts.get(fp) ?? 0;
        const first = firstHalf.get(fp) ?? 0;
        const second = count - first;
        const isNew = g.firstSeen !== null && g.firstSeen >= now - r.newErrorMin * 60_000;
        const curPerMin = (recent.get(fp) ?? 0) / RECENT_MIN;
        const basePerMin = (base.get(fp) ?? 0) / BASELINE_MIN;
        const spiking =
          !isNew && this.isSpike(curPerMin, basePerMin, r.spikeFactor, r.spikeMinPerMin);
        const trend: ErrorGroupRowDto['trend'] =
          g.firstSeen !== null && g.firstSeen >= from
            ? 'new'
            : second > first * 1.2 && second - first >= 2
              ? 'up'
              : second < first * 0.8 && first - second >= 2
                ? 'down'
                : 'flat';
        const dims = (d: string) =>
          [...g.dims]
            .filter(([k]) => k.startsWith(`${d}|`))
            .sort((a, b) => b[1] - a[1])
            .map(([k]) => k.slice(d.length + 1));
        return {
          fingerprint: fp,
          errorType: g.meta.errorType,
          template: g.meta.template,
          module: g.meta.context,
          frame: g.meta.frame,
          level: g.meta.level,
          count,
          total: g.total,
          firstSeen: iso(g.firstSeen),
          lastSeen: iso(g.lastSeen),
          trend,
          changePercent: spiking
            ? this.increase(curPerMin, basePerMin)
            : first > 0
              ? Math.round(((second - first) / first) * 100)
              : null,
          isNew,
          spiking,
          runtimes: dims('rt'),
          jobTypes: dims('job').slice(0, 5),
          routes: dims('route').slice(0, 5),
          spark: compress(
            buckets.map((b) => b.metrics.get(`log.eg.${fp}`)?.c ?? 0),
            SPARK_POINTS,
          ),
          sample: {
            id: g.meta.sample.id,
            message: g.meta.sample.message,
            at: iso(g.meta.sample.at),
            runtime: g.meta.sample.runtime,
            jobId: g.meta.sample.jobId,
            requestId: g.meta.sample.requestId,
            correlationId: g.meta.sample.correlationId,
          },
        };
      })
      .sort(
        (a, b) =>
          b.count - a.count || Date.parse(b.lastSeen ?? '0') - Date.parse(a.lastSeen ?? '0'),
      );
  }

  public async getErrors(
    range: LogsRange,
    q: string | null,
    now = Date.now(),
  ): Promise<ErrorGroupsDto> {
    this.assertAvailable();
    const from = now - LOGS_RANGES[range] * 60_000;
    const [w, spikeW, groups] = await Promise.all([
      this.metrics.window(from, now, now),
      this.metrics.window(now - (RECENT_MIN + BASELINE_MIN) * 60_000, now, now, 'm1'),
      this.store.groups(),
    ]);
    return {
      range,
      items: this.groupRows(groups, w, spikeW, now, q),
      otherCount: this.metrics.counter(w, 'log.eg._other'),
    };
  }

  public async getErrorGroup(
    fingerprint: string,
    range: LogsRange,
    now = Date.now(),
  ): Promise<ErrorGroupDetailDto> {
    this.assertAvailable();
    const groups = await this.store.groups([fingerprint]);
    if (!groups.length) throw new LogNotFoundException('ERROR_GROUP_NOT_FOUND', { fingerprint });
    const from = now - LOGS_RANGES[range] * 60_000;
    const [w, spikeW, snap, events] = await Promise.all([
      this.metrics.window(from, now, now, range === '15m' || range === '1h' ? 'm1' : undefined),
      this.metrics.window(now - (RECENT_MIN + BASELINE_MIN) * 60_000, now, now, 'm1'),
      this.store.logs(),
      this.runtimes.events().catch(() => []),
    ]);
    const row =
      this.groupRows(groups, w, spikeW, now)[0] ?? this.groupRows(groups, null, null, now)[0]!;
    const g = groups[0]!;
    const metric = `log.eg.${fingerprint}`;
    const rate = this.metrics.rateChange(
      spikeW,
      (b: MetricBucket) => b.metrics.get(metric)?.c ?? 0,
      now,
      RECENT_MIN,
      BASELINE_MIN,
    );
    const dims = (d: string) =>
      [...g.dims]
        .filter(([k]) => k.startsWith(`${d}|`))
        .map(([k, count]) => ({ name: k.slice(d.length + 1), count }))
        .sort((a, b) => b.count - a.count);
    // Chỉ runtime có lỗi này — khởi động của runtime khác không liên quan.
    const affectedRuntimes = new Set(dims('rt').map((d) => d.name));
    const start =
      g.firstSeen !== null
        ? events
            .filter(
              (e) =>
                e.type === 'started' &&
                (affectedRuntimes.size === 0 || affectedRuntimes.has(e.runtime)) &&
                Date.parse(e.at) <= g.firstSeen! &&
                Date.parse(e.at) >= g.firstSeen! - 86_400_000,
            )
            .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
        : undefined;
    return {
      ...row,
      series: (w?.buckets ?? []).map((b) => ({
        t: new Date(b.start).toISOString(),
        count: b.metrics.get(metric)?.c ?? 0,
      })),
      bucketSec: w ? TELEMETRY_TIERS[w.tier].seconds : 60,
      baselinePerMin: rate?.baselinePerMin ?? null,
      currentPerMin: rate?.currentPerMin ?? null,
      affected: { runtimes: dims('rt'), jobTypes: dims('job'), routes: dims('route') },
      samples: snap.entries
        .filter((e) => e.fingerprint === fingerprint)
        .slice(0, 20)
        .map(logRow),
      nearestStart: start
        ? {
            runtime: start.runtime,
            at: start.at,
            minutesBefore: Math.round((g.firstSeen! - Date.parse(start.at)) / 60_000),
          }
        : null,
      dependency: dependencyOf(
        `${g.meta.errorType ?? ''} ${g.meta.template} ${g.meta.sample.message}`,
      ),
    };
  }

  // ─── Trace ────────────────────────────────────────────────────────────────

  public async getTrace(id: string): Promise<TraceDto> {
    this.assertAvailable();
    const t = await this.traces.trace(id);
    if (!t) throw new LogNotFoundException('TRACE_NOT_FOUND', { id });
    return t;
  }

  // ─── Báo cáo hôm nay vs hôm qua ───────────────────────────────────────────

  public async getReport(now = Date.now()): Promise<LogsReportDto> {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const from = midnight.getTime();
    const span = Math.max(60_000, now - from);
    const [cur, prev, groups] = await Promise.all([
      this.metrics.window(from, now, now, 'm1'),
      this.metrics.window(from - 86_400_000, from - 86_400_000 + span, now),
      this.store.groups().catch(() => [] as ErrorGroupState[]),
    ]);
    const labels = new Map(groups.map((g) => [g.meta.fingerprint, groupLabel(g.meta)]));
    return {
      current: this.totals(cur, labels),
      previous: this.totals(prev, labels),
      from: new Date(from).toISOString(),
      to: new Date(now).toISOString(),
      available: this.store.isAvailable() && cur !== null,
    };
  }

  private totals(w: LogWindow | null, labels: Map<string, string>): LogsReportTotalsDto {
    if (!w)
      return {
        logs: null,
        errors: null,
        warnings: null,
        fatal: null,
        uniqueErrors: 0,
        peakPerMin: null,
        topError: null,
        topErrorSource: null,
      };
    const c = this.metrics.levelCounts(w);
    const byGroup = [...this.metrics.byGroup(w.buckets)].sort((a, b) => b[1] - a[1]);
    const sources = [...this.metrics.bySource(w)].sort((a, b) => b[1].errors - a[1].errors);
    const sec = TELEMETRY_TIERS[w.tier].seconds;
    const top = byGroup.find(([fp]) => fp !== '_other');
    return {
      logs: this.metrics.total(c),
      errors: c.error + c.fatal,
      warnings: c.warn,
      fatal: c.fatal,
      uniqueErrors: byGroup.filter(([fp]) => fp !== '_other').length,
      // Đỉnh log/phút chỉ đo được ở tầng ≤ 1 phút.
      peakPerMin:
        sec <= 60
          ? Math.round(Math.max(0, ...w.buckets.map((b) => (this.metrics.totalIn(b) / sec) * 60)))
          : null,
      topError: top
        ? { fingerprint: top[0], label: labels.get(top[0]) ?? top[0], count: top[1] }
        : null,
      topErrorSource:
        sources[0] && sources[0][1].errors > 0
          ? { runtime: sources[0][0], count: sources[0][1].errors }
          : null,
    };
  }

  // ─── Cấu hình / level ─────────────────────────────────────────────────────

  private async levelStates(now: number): Promise<LevelStateDto[]> {
    const [ingest, overrides] = await Promise.all([
      this.store.ingestStates().catch(() => []),
      this.store.overrides().catch(() => new Map<string, LogLevelOverrideRecord>()),
    ]);
    return LONG_RUNNING_RUNTIMES.map((runtime) => {
      const live = ingest.filter(
        (s) => s.runtime === runtime && s.updatedAt >= now - LOG_INGEST_TTL_MS,
      );
      const o = overrides.get(runtime);
      return {
        runtime,
        running: live.length > 0,
        instances: live.map((s) => ({
          instance: s.instance,
          level: s.level,
          baseLevel: s.baseLevel,
          overrideUntil: iso(s.overrideUntil),
          overrideModules: s.overrideModules,
          dropped: s.dropped,
          written: s.written,
          suppressed: s.suppressed,
          redacted: s.redacted,
          lastSuccessAt: iso(s.lastSuccessAt),
          lastErrorAt: iso(s.lastErrorAt),
          lastError: s.lastError,
          updatedAt: new Date(s.updatedAt).toISOString(),
        })),
        override:
          o && (o.until === null || o.until > now)
            ? {
                level: o.level,
                previous: o.previous,
                until: iso(o.until),
                modules: o.modules,
                setAt: new Date(o.setAt).toISOString(),
                actor: o.actor,
              }
            : null,
      };
    });
  }

  public async getConfig(now = Date.now()): Promise<LogsConfigDto> {
    const l = this.config.logs;
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const available = this.store.isAvailable();
    const [runtimes, buffers, today, week, snap] = await Promise.all([
      available ? this.levelStates(now) : Promise.resolve([] as LevelStateDto[]),
      available ? this.coverage() : Promise.resolve([] as LogCoverageDto[]),
      this.metrics.window(midnight.getTime(), now, now, 'm1'),
      this.metrics.window(now - 7 * 86_400_000, now, now, 'h1'),
      available ? this.store.logs() : Promise.resolve(null),
    ]);
    const todayBytes = today ? this.metrics.counter(today, 'log.b') : null;
    const weekBytes = week ? this.metrics.counter(week, 'log.b') : null;
    const bySource = [...this.metrics.bytesBySource(week)].sort((a, b) => b[1] - a[1]);
    const firstBucket = week?.buckets.find((b) => b.byInstance.size > 0)?.start ?? null;
    const days = firstBucket ? Math.max(1, (now - firstBucket) / 86_400_000) : null;
    return {
      backend: this.backend(),
      environment: this.config.app.env,
      runtimes,
      buffers,
      storage: {
        todayBytes,
        weekBytes,
        avgPerDayBytes: weekBytes !== null && days ? Math.round(weekBytes / days) : null,
        bySource: bySource.map(([runtime, bytes]) => ({
          runtime,
          bytes,
          percent: pct(bytes, weekBytes ?? 0),
        })),
      },
      retention: [
        { key: 'buffer', value: this.store.capacity },
        { key: 'metrics', value: TELEMETRY_TIERS.h1.ttlSec / 86_400 },
        { key: 'errorGroups', value: l.errorGroupRetentionDays },
        { key: 'errorGroupMax', value: l.errorGroupMax },
      ],
      redaction: this.redaction(),
      permissions: {
        levelChange: l.levelChange,
        levelPermanent: l.levelPermanent,
        export: l.export,
        exportMax: l.exportMax,
        details: l.details,
        audit: l.audit,
      },
      rules: { ...l.rules, recentMin: RECENT_MIN, baselineMin: BASELINE_MIN },
      modules: [
        ...new Set(
          (snap?.entries ?? []).map((e) => e.context).filter((c): c is string => Boolean(c)),
        ),
      ]
        .sort()
        .slice(0, 200),
    };
  }

  public async setLevel(
    input: { runtime: string; level: OverrideLevel; durationMin: number | null; modules: string[] },
    ctx: OperationContext,
    now = Date.now(),
  ): Promise<LevelStateDto> {
    if (!this.config.logs.levelChange)
      throw new LogsActionRejectedException('LEVEL_DISABLED', {}, 403);
    if (input.durationMin === null && !this.config.logs.levelPermanent)
      throw new LogsActionRejectedException('LEVEL_PERMANENT_DISABLED', {}, 403);
    this.assertAvailable();
    const states = await this.levelStates(now);
    const state = states.find((s) => s.runtime === input.runtime);
    if (!state?.running)
      throw new LogsActionRejectedException('RUNTIME_NOT_RUNNING', { runtime: input.runtime });
    const previous = state.override?.level ?? state.instances[0]?.baseLevel ?? 'INFO';
    const rec: LogLevelOverrideRecord = {
      runtime: input.runtime,
      level: input.level,
      previous,
      until: input.durationMin === null ? null : now + input.durationMin * 60_000,
      modules: input.modules,
      setAt: now,
      actor: ctx.actor,
    };
    await this.store.setOverride(rec);
    await this.store.recordOperation({
      at: now,
      action: 'level_change',
      target: input.runtime,
      result: 'success',
      detail: [
        `${previous} → ${input.level}`,
        input.durationMin === null ? 'until changed' : `${input.durationMin}m`,
        input.modules.length ? `modules=${input.modules.join(',')}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      durationMs: Date.now() - now,
      actor: ctx.actor,
      ip: ctx.ip,
      error: null,
    });
    return (await this.levelStates(now)).find((s) => s.runtime === input.runtime)!;
  }

  public async revertLevel(
    runtime: string,
    ctx: OperationContext,
    now = Date.now(),
  ): Promise<LevelStateDto> {
    if (!this.config.logs.levelChange)
      throw new LogsActionRejectedException('LEVEL_DISABLED', {}, 403);
    this.assertAvailable();
    const current = (await this.store.overrides()).get(runtime);
    if (!current) throw new LogsActionRejectedException('NO_OVERRIDE', { runtime });
    await this.store.clearOverride(runtime);
    await this.store.recordOperation({
      at: now,
      action: 'level_revert',
      target: runtime,
      result: 'success',
      detail: `${current.level} → ${current.previous}`,
      durationMs: Date.now() - now,
      actor: ctx.actor,
      ip: ctx.ip,
      error: null,
    });
    return (await this.levelStates(now)).find((s) => s.runtime === runtime)!;
  }
}
