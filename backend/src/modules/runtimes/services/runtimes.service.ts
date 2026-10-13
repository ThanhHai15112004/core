import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { NotFoundAppException } from '@packages/kernel/index.js';
import {
  LONG_RUNNING_RUNTIMES,
  type CliExecution,
  type LongRunningRuntimeId,
  type RuntimeEvent,
  type RuntimeEventType,
  type RuntimeHeartbeat,
} from '@packages/runtime/index.js';
import { RuntimeStoreService } from './runtime-store.service.js';
import { deriveRuntimeStatus, type StatusReason } from './runtime-status.js';
import type {
  CliPanelDto,
  RestartHistoryItemDto,
  RuntimeActionsDto,
  RuntimeAlertDto,
  RuntimeDetailDto,
  RuntimeEventDto,
  RuntimeLogDto,
  RuntimeReasonDto,
  RuntimeSeriesDto,
  RuntimeSummaryDto,
  RuntimesOverviewDto,
} from '../responses/runtime.response.js';

export const METRIC_RANGES = { '15m': 15, '1h': 60, '6h': 360, '24h': 1440 } as const;
export type MetricRange = keyof typeof METRIC_RANGES;

const EVENT_LEVEL: Record<RuntimeEventType, RuntimeEventDto['level']> = {
  started: 'success',
  stopping: 'info',
  stopped: 'info',
  crashed: 'error',
  paused: 'warn',
  resumed: 'success',
  restart_requested: 'warn',
  threshold_exceeded: 'warn',
  threshold_recovered: 'success',
  command_failed: 'error',
};

const DOWN_STATUSES = new Set(['crashed', 'stopped']);
const RUNNING_STATUSES = new Set(['healthy', 'degraded', 'starting']);

interface RuntimeContext {
  telemetry: boolean;
  heartbeats: Map<string, RuntimeHeartbeat>;
  events: RuntimeEvent[];
}

/** Kiểm tra xem mã định danh có phải là một runtime hợp lệ hay không */
const isRuntimeId = (id: string): id is LongRunningRuntimeId =>
  (LONG_RUNNING_RUNTIMES as readonly string[]).includes(id);

/** Lấy mốc thời gian bắt đầu của ngày hiện tại */
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Tổng hợp telemetry runtime thành dữ liệu cho System Console (đã dịch theo locale request). */
@Injectable()
export class RuntimesService {
  constructor(
    private readonly store: RuntimeStoreService,
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
  ) {}

  /** Kiểm tra và xác thực tính hợp lệ của mã định danh runtime */
  public assertRuntimeId(id: string): LongRunningRuntimeId {
    if (!isRuntimeId(id)) throw new NotFoundAppException('runtime.error.notFound', { id });
    return id;
  }

  /** Lấy dữ liệu tổng quan trạng thái hệ thống */
  public async getOverview(): Promise<RuntimesOverviewDto> {
    const ctx = await this.loadContext();
    const runtimes = LONG_RUNNING_RUNTIMES.map((id) => this.buildSummary(id, ctx));
    const withResources = runtimes.filter((r) => r.resources);
    const today = startOfToday();
    const cliHistory = ctx.telemetry ? await this.store.cliHistory().catch(() => []) : [];

    return {
      thresholds: this.thresholds(),
      telemetry: ctx.telemetry
        ? { available: true }
        : { available: false, reason: this.i18n.t('runtime.reason.noTelemetry') },
      summary: {
        running: runtimes.filter((r) => RUNNING_STATUSES.has(r.status)).length,
        total: runtimes.length,
        warnings: runtimes.filter((r) => r.status === 'degraded').length,
        down: runtimes.filter((r) => DOWN_STATUSES.has(r.status)).length,
        restartsToday: LONG_RUNNING_RUNTIMES.reduce(
          (sum, id) =>
            sum +
            this.restartHistory(id, ctx.events).filter((h) => Date.parse(h.at) >= today).length,
          0,
        ),
        totalCpuPercent: withResources.length
          ? Number(withResources.reduce((s, r) => s + r.resources!.cpuPercent, 0).toFixed(1))
          : null,
        totalMemoryMb: withResources.length
          ? Number(withResources.reduce((s, r) => s + r.resources!.rssMb, 0).toFixed(1))
          : null,
        totalMemoryLimitMb: withResources.some((r) => r.resources!.memoryLimitSource === 'cgroup')
          ? Number(
              withResources
                .filter((r) => r.resources!.memoryLimitSource === 'cgroup')
                .reduce((s, r) => s + (r.resources!.memoryLimitMb ?? 0), 0)
                .toFixed(0),
            )
          : null,
      },
      runtimes,
      cli: this.buildCliPanel(cliHistory),
    };
  }

  /** Lấy thông tin chi tiết của một bản ghi theo mã định danh */
  public async getDetail(rawId: string): Promise<RuntimeDetailDto> {
    const id = this.assertRuntimeId(rawId);
    const ctx = await this.loadContext();
    const hb = ctx.heartbeats.get(id) ?? null;
    const lastExit = this.eventsFor(id, ctx.events).find(
      (e) => e.type === 'stopped' || e.type === 'crashed',
    );

    return {
      ...this.buildSummary(id, ctx),
      environment: hb?.environment ?? null,
      process: hb?.process ?? null,
      descriptor: hb?.descriptor ?? null,
      details: hb?.details ?? {},
      restartHistory: this.restartHistory(id, ctx.events),
      lastExitCode: lastExit ? Number(lastExit.data['exitCode'] ?? 0) : null,
      thresholds: this.thresholds(),
    };
  }

  /** Truy vấn danh sách các sự kiện vận hành gần đây */
  public async getEvents(runtime: string | undefined, limit: number): Promise<RuntimeEventDto[]> {
    if (runtime) this.assertRuntimeId(runtime);
    if (!this.store.isAvailable()) return [];
    const events = await this.store.events().catch(() => []);
    return events
      .filter((e) => !runtime || e.runtime === runtime)
      .slice(0, limit)
      .map((e) => this.toEventDto(e));
  }

  /** Lấy chuỗi dữ liệu chuỗi thời gian (time series) theo dải thời gian */
  public async getSeries(
    ids: LongRunningRuntimeId[],
    range: MetricRange,
  ): Promise<RuntimeSeriesDto> {
    if (!this.store.isAvailable()) return Object.fromEntries(ids.map((id) => [id, []]));
    const since = Date.now() - METRIC_RANGES[range] * 60_000;
    const entries = await Promise.all(
      ids.map(async (id) => [id, await this.store.samples(id, since).catch(() => [])]),
    );
    return Object.fromEntries(entries);
  }

  /** Lấy danh sách bản ghi log gần đây của runtime process */
  public async getLogs(
    rawId: string,
    limit: number,
    filter: {
      level?: string | undefined;
      correlationId?: string | undefined;
      jobId?: string | undefined;
    } = {},
  ): Promise<RuntimeLogDto[]> {
    const id = rawId === 'cli' ? 'cli' : this.assertRuntimeId(rawId);
    if (!this.store.isAvailable()) return [];
    const { level, correlationId, jobId } = filter;
    // Có bộ lọc thì quét toàn bộ ring buffer rồi mới cắt `limit`, để không bỏ sót log cũ hơn.
    const scan = level || correlationId || jobId ? this.config.runtime.logRetention : limit;
    const logs = await this.store.logs(id, scan).catch(() => []);
    return logs
      .filter(
        (l) =>
          (!level || l.level === level) &&
          (!correlationId || l.correlationId === correlationId) &&
          (!jobId || l.jobId === jobId),
      )
      .slice(0, limit)
      .map((l) => ({
        t: l.t,
        level: l.level,
        ...(l.context ? { context: l.context } : {}),
        message: l.stack ? `${l.message}\n${l.stack}` : l.message,
      }));
  }

  /** Dữ liệu runtime dùng chung cho các module khác (vd. System Overview). */
  public async getSummaries(): Promise<RuntimeSummaryDto[]> {
    const ctx = await this.loadContext();
    return LONG_RUNNING_RUNTIMES.map((id) => this.buildSummary(id, ctx));
  }

  /** Lấy các ngưỡng giới hạn cảnh báo hiệu năng */
  private thresholds() {
    const { memoryPercent, cpuPercent, eventLoopMs } = this.config.runtime.thresholds;
    return { memoryPercent, cpuPercent, eventLoopMs };
  }

  /** Nạp thông tin ngữ cảnh hoạt động của hệ thống */
  private async loadContext(): Promise<RuntimeContext> {
    if (!this.store.isAvailable()) return { telemetry: false, heartbeats: new Map(), events: [] };
    try {
      const [heartbeats, events] = await Promise.all([
        this.store.heartbeats(LONG_RUNNING_RUNTIMES),
        this.store.events(),
      ]);
      return { telemetry: true, heartbeats, events };
    } catch {
      return { telemetry: false, heartbeats: new Map(), events: [] };
    }
  }

  /** Lọc danh sách các sự kiện liên quan tới một đối tượng cụ thể */
  private eventsFor(id: string, events: RuntimeEvent[]): RuntimeEvent[] {
    return events.filter((e) => e.runtime === id);
  }

  /** Xây dựng thông tin tóm tắt trạng thái tổng thể */
  private buildSummary(id: LongRunningRuntimeId, ctx: RuntimeContext): RuntimeSummaryDto {
    const hb = ctx.heartbeats.get(id) ?? null;
    const events = this.eventsFor(id, ctx.events);
    const { thresholds } = this.config.runtime;
    const { status, reasons } = deriveRuntimeStatus({
      telemetryAvailable: ctx.telemetry,
      heartbeat: hb,
      events,
      now: Date.now(),
      restartStorm: {
        count: thresholds.restartStormCount,
        windowMin: thresholds.restartStormWindowMin,
      },
    });
    const history = this.restartHistory(id, ctx.events);
    const lastRestart = history[0];

    return {
      id,
      name: this.i18n.t(`runtime.name.${id}`),
      status,
      reasons: reasons.map((r) => this.toReason(r)),
      alerts: (hb?.alerts ?? []).map<RuntimeAlertDto>((a) => ({
        ...a,
        message: this.i18n.t(`runtime.alert.${a.key}`, { value: a.value, threshold: a.threshold }),
      })),
      pid: hb?.process.pid ?? null,
      uptimeSec: hb?.uptimeSec ?? null,
      startedAt: hb?.startedAt ?? null,
      lastRestartAt: lastRestart?.at ?? null,
      restartCount: history.length,
      resources: hb?.resources ?? null,
      metrics: hb?.metrics ?? {},
      supervisor: hb?.supervisor ?? null,
      actions: this.buildActions(id, hb, status),
    };
  }

  /** Quy tắc cho phép action được tính ở backend để UI chỉ hiển thị, không tự suy luận. */
  private buildActions(
    id: LongRunningRuntimeId,
    hb: RuntimeHeartbeat | null,
    status: string,
  ): RuntimeActionsDto {
    /** Từ chối yêu cầu và thiết lập mã phản hồi cấm truy cập */
    const deny = (key: string) => ({ allowed: false, reason: this.i18n.t(key) });
    if (!this.config.runtime.actionsEnabled) {
      const disabled = deny('runtime.action.disabled');
      return { stop: disabled, start: disabled };
    }
    if (!hb) {
      const down = deny(
        status === 'unknown' ? 'runtime.action.noTelemetry' : 'runtime.action.processDown',
      );
      return { stop: down, start: down };
    }

    const busy = hb.state === 'stopping';
    return {
      stop:
        id === 'api'
          ? deny('runtime.action.apiStop')
          : !hb.capabilities.pause
            ? deny('runtime.action.pauseUnsupported')
            : hb.state === 'paused'
              ? deny('runtime.action.alreadyStopped')
              : busy
                ? deny('runtime.action.busy')
                : { allowed: true },
      start: hb.state === 'paused' ? { allowed: true } : deny('runtime.action.notStopped'),
    };
  }

  /** Mỗi lần `started` đứng sau một lần dừng/crash (hoặc sau một `started` khác = chết không báo) là một lần restart. */
  private restartHistory(id: string, allEvents: RuntimeEvent[]): RestartHistoryItemDto[] {
    const chronological = this.eventsFor(id, allEvents)
      .filter((e) => e.type === 'started' || e.type === 'stopped' || e.type === 'crashed')
      .reverse();
    const history: RestartHistoryItemDto[] = [];
    let previous: RuntimeEvent | null = null;

    for (const event of chronological) {
      if (event.type === 'started' && previous) {
        const stoppedCleanly = previous.type === 'stopped' || previous.type === 'crashed';
        const reasonCode = stoppedCleanly
          ? previous.type === 'crashed'
            ? 'crash'
            : String(previous.data['reason'] ?? 'shutdown')
          : 'unexpected';
        history.push({
          at: event.at,
          reasonCode,
          reason: this.i18n.t(`runtime.stopReason.${reasonCode}`),
          downtimeMs: stoppedCleanly ? Date.parse(event.at) - Date.parse(previous.at) : null,
          exitCode: stoppedCleanly ? Number(previous.data['exitCode'] ?? 0) : null,
        });
      }
      previous = event;
    }
    return history.reverse();
  }

  /** Xây dựng dữ liệu hiển thị cho bảng điều khiển CLI */
  private buildCliPanel(history: CliExecution[]): CliPanelDto {
    const today = history.filter((h) => Date.parse(h.startedAt) >= startOfToday());
    return {
      lastExecution: history[0] ?? null,
      executionsToday: today.length,
      failuresToday: today.filter((h) => h.result === 'failure').length,
      recent: history.slice(0, 10),
    };
  }

  /** Chuyển đổi thông tin lỗi thành lý do hiển thị thân thiện */
  private toReason(reason: StatusReason): RuntimeReasonDto {
    if (reason.code.startsWith('issue:')) {
      const key = reason.code.slice('issue:'.length);
      return { code: key, message: this.i18n.t(key, reason.params) };
    }
    return {
      code: reason.code,
      message: this.i18n.t(`runtime.reason.${reason.code}`, reason.params),
    };
  }

  /** Chuyển đổi dữ liệu sự kiện nội bộ sang đối tượng Event DTO */
  private toEventDto(e: RuntimeEvent): RuntimeEventDto {
    const d = e.data;
    const params: Record<string, string | number> = {
      runtime: this.i18n.t(`runtime.name.${e.runtime}`),
      ...(d['reason'] ? { reason: this.i18n.t(`runtime.stopReason.${String(d['reason'])}`) } : {}),
      ...(d['metric'] ? { metric: this.i18n.t(`runtime.metric.${String(d['metric'])}`) } : {}),
      ...(d['mode'] ? { mode: this.i18n.t(`runtime.mode.${String(d['mode'])}`) } : {}),
      ...(d['value'] !== undefined && d['value'] !== null ? { value: Number(d['value']) } : {}),
      ...(d['threshold'] !== undefined && d['threshold'] !== null
        ? { threshold: Number(d['threshold']) }
        : {}),
      ...(d['message'] ? { message: this.i18n.t(String(d['message'])) } : {}),
      ...(d['action'] ? { action: String(d['action']) } : {}),
      ...(d['exitCode'] !== undefined && d['exitCode'] !== null
        ? { exitCode: Number(d['exitCode']) }
        : {}),
    };
    return {
      id: e.id,
      runtime: e.runtime,
      runtimeName: params['runtime'] as string,
      type: e.type,
      level: EVENT_LEVEL[e.type] ?? 'info',
      at: e.at,
      message: this.i18n.t(`runtime.event.${e.type}`, params),
    };
  }
}
