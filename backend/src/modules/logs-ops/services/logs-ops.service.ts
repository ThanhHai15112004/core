import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  LOG_ENTRY_LEVELS,
  SENSITIVE_KEY_NAMES,
  TEXT_REDACTION_PATTERNS,
  messageTemplate,
  type LogEntry,
  type LogEntryLevel,
  type LogLevelOverrideRecord,
} from '@packages/logging/index.js';
import { LONG_RUNNING_RUNTIMES } from '@packages/runtime/index.js';
import { LogsStoreService, type LogSnapshot } from './logs-store.service.js';
import { LogAuditService } from './log-audit.service.js';
import { logRow } from './log-rows.js';
import {
  LOG_ID_FIELDS,
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
  CountShareDto,
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
  ResolvedIdDto,
  ResolvedIdKind,
  TraceDto,
  TraceEventDto,
  TraceNodeDto,
} from '../responses/logs-ops.response.js';

/** Khoảng thời gian (phút). */
export const LOGS_RANGES: Record<LogsRange, number> = {
  '15m': 15,
  '1h': 60,
  '6h': 360,
  '24h': 1440,
  '7d': 10080,
};
/** Độ rộng bucket biểu đồ theo khoảng thời gian (giây). */
const BUCKET_SEC: Record<LogsRange, number> = {
  '15m': 30,
  '1h': 60,
  '6h': 300,
  '24h': 900,
  '7d': 3600,
};
export const LEVEL_DURATIONS_MIN = [15, 30, 60, 120] as const;
export const OVERRIDE_LEVELS = ['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
export type OverrideLevel = (typeof OVERRIDE_LEVELS)[number];
export type ExportFormat = 'json' | 'csv' | 'ndjson';

/** Instance coi là đang chạy nếu báo tình trạng ghi log trong chừng này ms (runtime báo mỗi 5 giây). */
const INGEST_TTL_MS = 30_000;
const STREAMING_SEC = 60;
const SPARK_POINTS = 24;
const TRACE_MAX_EVENTS = 500;

export interface OperationContext {
  actor: string | null;
  ip: string | null;
}

const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);
const pct = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 1000) / 10 : null;
const isError = (e: LogEntry) => e.level === 'error' || e.level === 'fatal';

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function countBy(values: (string | undefined)[]): CountShareDto[] {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

function emptyLevels(): Record<LogEntryLevel, number> {
  return { verbose: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
}

/** Thành phần hạ tầng liên quan tới lỗi (theo loại lỗi / message) — để mở đúng màn. */
function dependencyOf(e: LogEntry): LogLinksDto['dependency'] {
  const hay = `${e.errorType ?? ''} ${e.context ?? ''} ${e.message}`.toLowerCase();
  if (/sql|database|typeorm|knex|prisma|mysql|postgres/.test(hay)) return 'database';
  if (/cache/.test(hay)) return 'cache';
  if (/storage|s3|minio|bucket/.test(hay)) return 'storage';
  if (/queue|bullmq|messag|broker/.test(hay)) return 'messaging';
  if (/fetch|http|axios|econnrefused|etimedout/.test(hay)) return 'http';
  return null;
}

/**
 * Logs — Investigation Center trên Redis Stream `logs:<env>`: tổng quan / biểu đồ / nhóm lỗi / báo cáo được tính
 * khi đọc từ `LOG_SCAN_LIMIT` log gần nhất (không lưu counter riêng). Explorer, live tail, chi tiết, trace theo
 * ID, export, đổi level tạm thời và audit.
 */
@Injectable()
export class LogsOpsService {
  constructor(
    private readonly config: CoreConfigService,
    private readonly store: LogsStoreService,
    private readonly audit: LogAuditService,
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
      provider: 'redis-stream',
      historicalSearch: 'limited',
      fullText: 'scan',
      bufferPerRuntime: this.store.capacity,
      metricsRetentionDays: 0,
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

  private coverage(snap: LogSnapshot): LogCoverageDto[] {
    return [...snap.byRuntime].map(([runtime, list]) => ({
      runtime,
      entries: list.length,
      capacity: this.store.capacity,
      oldestAt: list.length ? list[list.length - 1]!.t : null,
      newestAt: list.length ? list[0]!.t : null,
    }));
  }

  private within(snap: LogSnapshot, from: number, to = Infinity): LogEntry[] {
    return snap.entries.filter((e) => {
      const t = entryTime(e);
      return t >= from && t <= to;
    });
  }

  // ─── Nhóm lỗi (tính khi đọc) ─────────────────────────────────────────────

  private groupRows(entries: LogEntry[], from: number, now: number): ErrorGroupRowDto[] {
    const byFp = new Map<string, LogEntry[]>();
    for (const e of entries) {
      if (!e.fingerprint) continue;
      const list = byFp.get(e.fingerprint) ?? [];
      list.push(e);
      byFp.set(e.fingerprint, list);
    }
    const span = Math.max(1, now - from);
    const mid = from + span / 2;
    const newSince = now - this.config.logs.rules.newErrorMin * 60_000;
    return [...byFp]
      .map(([fingerprint, list]) => {
        const sample = list[0]!;
        const first = entryTime(list[list.length - 1]!);
        const last = entryTime(sample);
        const late = list.filter((e) => entryTime(e) >= mid).length;
        const early = list.length - late;
        const spark = new Array<number>(SPARK_POINTS).fill(0);
        for (const e of list) {
          const i = Math.min(
            SPARK_POINTS - 1,
            Math.floor(((entryTime(e) - from) / span) * SPARK_POINTS),
          );
          if (i >= 0) spark[i]! += 1;
        }
        const isNew = first >= newSince;
        const changePercent = early > 0 ? Math.round(((late - early) / early) * 100) : null;
        const trend: ErrorGroupRowDto['trend'] = isNew
          ? 'new'
          : late > early
            ? 'up'
            : late < early
              ? 'down'
              : 'flat';
        return {
          fingerprint,
          errorType: sample.errorType ?? null,
          template: messageTemplate(sample.message),
          module: sample.context ?? null,
          frame: null,
          level: sample.level,
          count: list.length,
          total: list.length,
          firstSeen: iso(first),
          lastSeen: iso(last),
          trend,
          changePercent,
          isNew,
          spiking: early > 0 && late >= this.config.logs.rules.spikeFactor * early && late >= 5,
          runtimes: countBy(list.map((e) => e.runtime)).map((c) => c.name),
          jobTypes: countBy(list.map((e) => e.jobType)).map((c) => c.name),
          routes: countBy(list.map((e) => e.route)).map((c) => c.name),
          spark,
          sample: {
            id: sample.id ?? null,
            message: sample.message,
            at: sample.t,
            runtime: sample.runtime ?? null,
            jobId: sample.jobId ?? null,
            requestId: sample.requestId ?? null,
            correlationId: sample.correlationId ?? null,
          },
        } satisfies ErrorGroupRowDto;
      })
      .sort((a, b) => b.count - a.count);
  }

  // ─── Overview / biểu đồ ───────────────────────────────────────────────────

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
    const [snap, ingest, overrides, audit] = await Promise.all([
      this.store.logs(),
      this.store.ingestStates().catch(() => []),
      this.store.overrides().catch(() => new Map<string, LogLevelOverrideRecord>()),
      this.audit.all().catch(() => ({ items: [], domains: [] })),
    ]);
    const entries = this.within(snap, from);
    const counts = emptyLevels();
    const sources = new Map<
      string,
      { total: number; errors: number; warnings: number; instances: Set<string> }
    >();
    const modules = new Map<string, { total: number; errors: number }>();
    let traceable = 0;
    for (const e of entries) {
      counts[e.level]++;
      if (e.correlationId || e.jobId || e.executionId) traceable++;
      const s = sources.get(e.runtime ?? 'unknown') ?? {
        total: 0,
        errors: 0,
        warnings: 0,
        instances: new Set<string>(),
      };
      s.total++;
      if (isError(e)) s.errors++;
      if (e.level === 'warn') s.warnings++;
      if (e.instance) s.instances.add(e.instance);
      sources.set(e.runtime ?? 'unknown', s);
      if (e.context) {
        const m = modules.get(e.context) ?? { total: 0, errors: 0 };
        m.total++;
        if (isError(e)) m.errors++;
        modules.set(e.context, m);
      }
    }
    const total = entries.length;
    const errors = counts.error + counts.fatal;
    // Cửa sổ thực tế có dữ liệu (stream chỉ giữ N log gần nhất).
    const oldest = entries.length ? entryTime(entries[entries.length - 1]!) : now;
    const minutes = Math.max(1, (now - Math.max(from, oldest)) / 60_000);
    const perMin = (n: number) => Math.round((n / minutes) * 10) / 10;
    const live = ingest.filter((s) => s.updatedAt >= now - INGEST_TTL_MS);
    const dropped = live.reduce((a, s) => a + s.dropped, 0);
    const failing = live.filter(
      (s) => s.lastErrorAt && (!s.lastSuccessAt || s.lastErrorAt > s.lastSuccessAt),
    );
    const lastEventAt = snap.entries[0] ? entryTime(snap.entries[0]) : null;
    const lastIngestAt = live.reduce<number | null>(
      (m, s) => Math.max(m ?? 0, s.lastSuccessAt ?? 0) || m,
      null,
    );
    const groupRows = this.groupRows(entries, from, now);
    const rate = pct(errors, total);

    const issues: LogIssueDto[] = [];
    if (failing.length)
      issues.push({
        key: 'logs.issue.ingestFailing',
        severity: 'critical',
        params: { runtime: failing.map((s) => s.runtime).join(', ') },
        target: { kind: 'config' },
      });
    if (dropped > 0)
      issues.push({
        key: 'logs.issue.dropped',
        severity: 'warning',
        params: { count: dropped },
        target: { kind: 'config' },
      });
    if (rate !== null && rate >= this.config.logs.rules.errorRateWarnPercent)
      issues.push({
        key: 'logs.issue.errorRate',
        severity: 'warning',
        params: { percent: rate },
        target: { kind: 'explorer', query: { level: 'error,fatal' } },
      });
    for (const g of groupRows.filter((r) => r.isNew).slice(0, 3))
      issues.push({
        key: 'logs.issue.newError',
        severity: 'warning',
        params: { label: g.template, count: g.count },
        target: { kind: 'error', fingerprint: g.fingerprint },
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
        logsPerMin: perMin(total),
        total,
        errors,
        warnings: counts.warn,
        fatal: counts.fatal,
        sources: sources.size,
        errorRatePercent: rate,
        uniqueErrors: groupRows.length,
        traceablePercent: pct(traceable, total),
        dropped: live.length ? dropped : null,
        redacted: null,
      },
      levels: LOG_ENTRY_LEVELS.filter(
        (l) => counts[l] > 0 || l === 'info' || l === 'warn' || l === 'error',
      ).map((l) => ({ level: l, count: counts[l], percent: pct(counts[l], total) })),
      sources: [...sources]
        .map(([runtime, s]) => ({
          runtime,
          total: s.total,
          perMin: perMin(s.total),
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
      topErrors: groupRows.slice(0, 5),
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

  public async getSeries(range: LogsRange, now = Date.now()): Promise<LogsSeriesDto> {
    const bucketSec = BUCKET_SEC[range];
    const step = bucketSec * 1000;
    const from = now - LOGS_RANGES[range] * 60_000;
    const start = Math.floor(from / step) * step;
    const n = Math.ceil((now - start) / step);
    const points = Array.from({ length: n }, (_, i) => ({
      t: new Date(start + i * step).toISOString(),
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      fatal: 0,
    }));
    if (this.store.isAvailable()) {
      const snap = await this.store.logs();
      for (const e of this.within(snap, from)) {
        const p = points[Math.min(n - 1, Math.floor((entryTime(e) - start) / step))];
        if (!p) continue;
        if (e.level === 'verbose' || e.level === 'debug') p.debug++;
        else p[e.level]++;
      }
    }
    return { range, bucketSec, points, spike: null };
  }

  // ─── Explorer / live tail / export ────────────────────────────────────────

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
      coverage: this.coverage(snap),
      resolved: filter.anyId ? this.resolve(filter.anyId, snap.entries) : null,
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
          return cols.map((col) => csvCell(r[col])).join(',');
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
    const snap = await this.store.logs();
    const entry = snap.entries.find((e) => e.id === id) ?? (await this.store.get(id));
    if (!entry) throw new LogNotFoundException('LOG_NOT_FOUND', { id });

    const sameInstance = (snap.byRuntime.get(entry.runtime ?? 'unknown') ?? []).filter(
      (e) => e.instance === entry.instance,
    );
    const idx = sameInstance.findIndex((e) => e.id === id);
    const details = this.config.logs.details;
    const group = entry.fingerprint
      ? snap.entries.filter((e) => e.fingerprint === entry.fingerprint)
      : [];
    return {
      ...logRow(entry),
      stack: details ? (entry.stack ?? null) : null,
      metadata: details ? (entry.metadata ?? null) : null,
      detailsHidden: !details && Boolean(entry.stack || entry.metadata),
      links: this.links(entry),
      // Danh sách mới nhất trước: sau (mới hơn) nằm phía trước chỉ số.
      after: idx > 0 ? sameInstance.slice(Math.max(0, idx - 10), idx).map(logRow) : [],
      before: idx >= 0 ? sameInstance.slice(idx + 1, idx + 11).map(logRow) : [],
      group:
        entry.fingerprint && group.length
          ? {
              fingerprint: entry.fingerprint,
              count: group.length,
              firstSeen: group[group.length - 1]!.t,
              lastSeen: group[0]!.t,
            }
          : null,
    };
  }

  private links(e: LogEntry): LogLinksDto {
    const meta = e.metadata ?? {};
    const status = typeof meta.status === 'number' ? meta.status : null;
    const [method, route] = (e.route ?? '').split(' ');
    return {
      request: e.requestId
        ? { id: e.requestId, method: method || null, route: route || null, status }
        : null,
      job: e.jobId
        ? {
            id: e.jobId,
            queue: typeof meta.queue === 'string' ? meta.queue : null,
            type: e.jobType ?? null,
          }
        : null,
      execution: e.executionId
        ? { id: e.executionId, taskId: typeof meta.taskId === 'string' ? meta.taskId : null }
        : null,
      message: e.messageId ? { id: e.messageId } : null,
      correlationId: e.correlationId ?? null,
      dependency: isError(e) ? dependencyOf(e) : null,
    };
  }

  /** Một ID dán vào ô tìm là gì (request / job / execution / correlation / log). */
  private resolve(id: string, entries: LogEntry[]): ResolvedIdDto {
    const kinds = new Set<ResolvedIdKind>();
    let queue: string | null = null;
    let correlationId: string | null = null;
    for (const e of entries) {
      if (e.id === id) kinds.add('log');
      if (e.requestId === id) kinds.add('request');
      if (e.executionId === id) kinds.add('execution');
      if (e.correlationId === id) kinds.add('correlation');
      if (e.jobId === id) {
        kinds.add('job');
        if (!queue && typeof e.metadata?.queue === 'string') queue = e.metadata.queue;
      }
      if (!correlationId && LOG_ID_FIELDS.some((k) => e[k] === id))
        correlationId = e.correlationId ?? null;
    }
    return { id, kinds: [...kinds], queue, correlationId };
  }

  // ─── Nhóm lỗi ─────────────────────────────────────────────────────────────

  public async getErrors(
    range: LogsRange,
    q: string | null,
    now = Date.now(),
  ): Promise<ErrorGroupsDto> {
    if (!this.store.isAvailable()) return { range, items: [], otherCount: 0 };
    const from = now - LOGS_RANGES[range] * 60_000;
    const snap = await this.store.logs();
    const text = q?.toLowerCase().trim() ?? '';
    const items = this.groupRows(this.within(snap, from), from, now).filter(
      (g) =>
        !text ||
        `${g.errorType ?? ''} ${g.template} ${g.module ?? ''} ${g.fingerprint}`
          .toLowerCase()
          .includes(text),
    );
    return { range, items, otherCount: 0 };
  }

  public async getErrorGroup(
    fingerprint: string,
    range: LogsRange,
    now = Date.now(),
  ): Promise<ErrorGroupDetailDto> {
    this.assertAvailable();
    const from = now - LOGS_RANGES[range] * 60_000;
    const snap = await this.store.logs();
    const list = this.within(snap, from).filter((e) => e.fingerprint === fingerprint);
    const row = this.groupRows(list, from, now)[0];
    if (!row) throw new LogNotFoundException('ERROR_GROUP_NOT_FOUND', { fingerprint });
    const series = await this.getSeries(range, now);
    const step = series.bucketSec * 1000;
    const start = Date.parse(series.points[0]?.t ?? new Date(from).toISOString());
    const buckets = series.points.map((p) => ({ t: p.t, count: 0 }));
    for (const e of list) {
      const b = buckets[Math.min(buckets.length - 1, Math.floor((entryTime(e) - start) / step))];
      if (b) b.count++;
    }
    const minutes = LOGS_RANGES[range];
    return {
      ...row,
      series: buckets,
      bucketSec: series.bucketSec,
      baselinePerMin: Math.round((list.length / minutes) * 100) / 100,
      currentPerMin: null,
      affected: {
        runtimes: countBy(list.map((e) => e.runtime)),
        jobTypes: countBy(list.map((e) => e.jobType)),
        routes: countBy(list.map((e) => e.route)),
      },
      samples: list.slice(0, 20).map(logRow),
      nearestStart: null,
      dependency: list[0] ? dependencyOf(list[0]) : null,
    };
  }

  // ─── Trace theo ID ────────────────────────────────────────────────────────

  public async getTrace(id: string): Promise<TraceDto> {
    this.assertAvailable();
    const snap = await this.store.logs();
    const resolved = this.resolve(id, snap.entries);
    const corr = resolved.correlationId;
    const related = snap.entries
      .filter(
        (e) =>
          e.id === id ||
          LOG_ID_FIELDS.some((k) => e[k] === id) ||
          (corr !== null && e.correlationId === corr),
      )
      .reverse();
    if (!related.length) throw new LogNotFoundException('TRACE_NOT_FOUND', { id });

    const events: TraceEventDto[] = related.slice(0, TRACE_MAX_EVENTS).map((e) => {
      const kind: TraceEventDto['kind'] = e.route ? 'request' : e.jobId ? 'job' : 'log';
      return {
        at: e.t,
        component: e.runtime ?? 'unknown',
        kind,
        level: isError(e) ? 'error' : e.level === 'warn' ? 'warn' : 'info',
        label: e.message,
        detail: e.route ?? e.jobType ?? null,
        module: e.context ?? null,
        errorType: e.errorType ?? null,
        logId: e.id ?? null,
        link: e.requestId
          ? { kind: 'request', id: e.requestId }
          : e.jobId
            ? {
                kind: 'job',
                id: e.jobId,
                queue: typeof e.metadata?.queue === 'string' ? e.metadata.queue : null,
              }
            : e.executionId
              ? { kind: 'execution', id: e.executionId }
              : null,
      };
    });
    const flow = new Map<string, TraceNodeDto>();
    for (const ev of events) {
      const n = flow.get(ev.component);
      if (n) {
        n.events++;
        if (ev.level === 'error') n.status = 'error';
      } else
        flow.set(ev.component, {
          component: ev.component,
          label: ev.component,
          status: ev.level === 'error' ? 'error' : 'ok',
          events: 1,
          firstAt: ev.at,
          link: ev.link,
        });
    }
    const first = related[0]!;
    const last = related[related.length - 1]!;
    const failure = events.find((ev) => ev.level === 'error') ?? null;
    return {
      id,
      resolvedFrom: resolved.kinds,
      correlationId: corr,
      startedAt: first.t,
      endedAt: last.t,
      durationMs: entryTime(last) - entryTime(first),
      status: failure ? 'failed' : 'ok',
      services: [...flow.keys()],
      counts: {
        logs: related.length,
        errors: related.filter(isError).length,
        warnings: related.filter((e) => e.level === 'warn').length,
        jobs: new Set(related.map((e) => e.jobId).filter(Boolean)).size,
        requests: new Set(related.map((e) => e.requestId).filter(Boolean)).size,
      },
      root: events[0] ? { kind: events[0].kind, label: events[0].label, at: events[0].at } : null,
      failurePoint: failure
        ? {
            component: failure.component,
            label: failure.label,
            at: failure.at,
            errorType: failure.errorType ?? null,
            logId: failure.logId,
          }
        : null,
      flow: [...flow.values()],
      events,
      truncated: related.length > TRACE_MAX_EVENTS,
    };
  }

  // ─── Báo cáo hôm nay vs hôm qua ───────────────────────────────────────────

  public async getReport(now = Date.now()): Promise<LogsReportDto> {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const from = midnight.getTime();
    const span = Math.max(60_000, now - from);
    const available = this.store.isAvailable();
    const snap = available ? await this.store.logs() : null;
    const totals = (a: number, b: number): LogsReportTotalsDto => {
      const list = snap ? this.within(snap, a, b) : [];
      const groups = this.groupRows(list, a, b);
      const perMinute = new Map<number, number>();
      const errorsBy = countBy(list.filter(isError).map((e) => e.runtime));
      for (const e of list) {
        const m = Math.floor(entryTime(e) / 60_000);
        perMinute.set(m, (perMinute.get(m) ?? 0) + 1);
      }
      const top = groups[0];
      return {
        logs: snap ? list.length : null,
        errors: snap ? list.filter(isError).length : null,
        warnings: snap ? list.filter((e) => e.level === 'warn').length : null,
        fatal: snap ? list.filter((e) => e.level === 'fatal').length : null,
        uniqueErrors: groups.length,
        peakPerMin: snap ? Math.max(0, ...perMinute.values()) : null,
        topError: top
          ? { fingerprint: top.fingerprint, label: top.template, count: top.count }
          : null,
        topErrorSource: errorsBy[0]
          ? { runtime: errorsBy[0].name, count: errorsBy[0].count }
          : null,
      };
    };
    return {
      current: totals(from, now),
      previous: totals(from - 86_400_000, from - 86_400_000 + span),
      from: new Date(from).toISOString(),
      to: new Date(now).toISOString(),
      available,
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
        (s) => s.runtime === runtime && s.updatedAt >= now - INGEST_TTL_MS,
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
    const available = this.store.isAvailable();
    const [runtimes, snap, length] = await Promise.all([
      available ? this.levelStates(now) : Promise.resolve([] as LevelStateDto[]),
      available ? this.store.logs() : Promise.resolve(null),
      available ? this.store.streamLength().catch(() => null) : Promise.resolve(null),
    ]);
    return {
      backend: this.backend(),
      environment: this.config.app.env,
      runtimes,
      buffers: snap ? this.coverage(snap) : [],
      storage: { todayBytes: null, weekBytes: null, avgPerDayBytes: null, bySource: [] },
      retention: [
        { key: 'stream', value: length ?? 0 },
        { key: 'scan', value: this.store.capacity },
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
      rules: { ...l.rules },
      modules: [
        ...new Set((snap?.entries ?? []).map((e) => e.context).filter((c): c is string => !!c)),
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
