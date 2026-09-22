import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { HttpMetricsService } from '@packages/logging/index.js';
import { readRequestError } from '@packages/http/index.js';
import {
  FIELD_SEPARATOR,
  PEAK_ACTIVE_FIELD,
  REQUEST_DETAIL_TTL_SEC,
  trafficKeys,
} from '../constants/traffic.keys.js';
import {
  TRAFFIC_TIERS,
  UNMATCHED_ROUTE,
  type ActiveRequest,
  type ActiveSnapshot,
  type CaptureReason,
  type RequestDetail,
  type RequestSummary,
  type TimelineMark,
  type TimelinePhase,
  type TrafficRoute,
  type TrafficTier,
} from '../contracts/traffic.types.js';
import { histogramIndex } from '@packages/telemetry/index.js';
import type { RequestContextStore } from '@packages/logging/index.js';
import { buildRoute, matchesGlob } from '../utils/route-key.js';
import { captureBody, maskHeaders, maskIp, redactQuery } from '../utils/capture.js';

/** Giới hạn dữ liệu chờ ghi khi Redis tạm mất — không để RAM phình vô hạn. */
const MAX_PENDING_BUCKETS = 2000;
const MAX_PENDING_DETAILS = 200;
/** Request treo quá lâu (client biến mất mà không có abort) bị loại khỏi danh sách active. */
const ACTIVE_STALE_MS = 60 * 60_000;
/** Status quy ước khi client đóng kết nối trước khi có response. */
export const CLIENT_CLOSED_STATUS = 499;

interface RequestState {
  id: string;
  at: number;
  start: number;
  route: TrafficRoute;
  path: string;
  marks: Partial<Record<TimelinePhase, number>>;
  requestBody?: unknown;
  responsePayload?: unknown;
  /** Context ALS của request (có thời gian DB/cache do instrumentation cộng dồn). */
  context?: RequestContextStore;
}

interface PendingBucket {
  ttlSec: number;
  fields: Map<string, number>;
}

interface PeakEntry {
  value: number;
  ttlSec: number;
  bucketEndMs: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const TIER_ENTRIES = Object.entries(TRAFFIC_TIERS) as [
  TrafficTier,
  (typeof TRAFFIC_TIERS)[TrafficTier],
][];
const PHASE_ORDER: TimelinePhase[] = [
  'received',
  'routed',
  'handlerStart',
  'handlerEnd',
  'send',
  'finished',
];

/** Đơn vị lưu thời gian breakdown: 0.1 ms (HINCRBY chỉ nhận số nguyên). */
export const BREAKDOWN_UNIT_MS = 0.1;
const units = (ms: number) => Math.max(0, Math.round(ms / BREAKDOWN_UNIT_MS));

/**
 * Thời gian theo từng giai đoạn của request đã vào tới handler (field `b.*`):
 * routing/middleware → guards → handler (trong đó DB/cache) → serialize/gửi.
 * Request bị chặn trước handler (401/404) không có đủ mốc nên không tính vào breakdown.
 */
function breakdownOf(state: RequestState): [string, number][] {
  const { routed, handlerStart, handlerEnd, finished } = state.marks;
  if (
    routed === undefined ||
    handlerStart === undefined ||
    handlerEnd === undefined ||
    finished === undefined
  )
    return [];
  const handlerMs = handlerEnd - handlerStart;
  const t = state.context?.timings;
  const dbMs = Math.min(t?.dbMs ?? 0, handlerMs);
  const cacheMs = Math.min(t?.cacheMs ?? 0, Math.max(0, handlerMs - dbMs));
  return [
    ['b.n', 1],
    ['b.route', units(routed)],
    ['b.guard', units(handlerStart - routed)],
    ['b.app', units(handlerMs - dbMs - cacheMs)],
    ['b.db', units(dbMs)],
    ['b.cache', units(cacheMs)],
    ['b.send', units(finished - handlerEnd)],
    ['b.dbq', t?.dbQueries ?? 0],
  ];
}

/**
 * Thu thập HTTP traffic của instance hiện tại: aggregate theo bucket (10s/1m/1h) cho từng endpoint,
 * log nhẹ cho mọi request, bản chi tiết chỉ cho request chậm/lỗi/được lấy mẫu. Ghi Redis theo lô.
 */
@Injectable()
export class TrafficCollectorService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(TrafficCollectorService.name);
  private readonly keys: ReturnType<typeof trafficKeys>;
  private readonly states = new WeakMap<object, RequestState>();
  private readonly active = new Map<string, ActiveRequest>();
  private readonly routes = new Map<string, TrafficRoute>();
  private pendingRoutes = new Map<string, TrafficRoute>();
  private pendingBuckets = new Map<string, PendingBucket>();
  private readonly peaks = new Map<string, PeakEntry>();
  private pendingLog: RequestSummary[] = [];
  private pendingDetails: RequestDetail[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private lastFlushError: string | null = null;

  constructor(
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
    private readonly http: HttpMetricsService,
  ) {
    this.keys = trafficKeys(redis);
  }

  private get cfg() {
    return this.config.traffic;
  }

  public onModuleInit(): void {
    if (!this.cfg.enabled) return;
    this.timer = setInterval(() => void this.flush(), this.cfg.flushMs);
    this.timer.unref();
  }

  public async beforeApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  /** Đăng ký sẵn các route của app (để endpoint chưa có request vẫn hiện ở trạng thái idle). */
  public registerRoutes(routes: { method: string; route: string }[]): void {
    for (const { method, route } of routes) this.resolveRoute(method, route);
  }

  public start(req: FastifyRequest): void {
    const method = req.method.toUpperCase();
    const template = req.routeOptions?.url ?? UNMATCHED_ROUTE;
    if (this.cfg.excludeMethods.includes(method)) return;
    if (template !== UNMATCHED_ROUTE && matchesGlob(template, this.cfg.excludeRoutes)) return;

    const route = this.resolveRoute(method, template);
    const state: RequestState = {
      id: `req_${randomBytes(8).toString('hex')}`,
      at: Date.now(),
      start: performance.now(),
      route,
      path: (req.url.split('?')[0] ?? req.url) || '/',
      marks: { received: 0 },
    };
    this.states.set(req.raw, state);
    this.active.set(state.id, {
      id: state.id,
      method,
      route: route.route,
      routeId: route.id,
      path: state.path,
      startedAt: state.at,
      instance: this.cfg.instanceId,
    });
    this.http.begin();
    this.updatePeaks(state.at);
  }

  public mark(raw: object, phase: TimelinePhase): void {
    const state = this.states.get(raw);
    if (state && state.marks[phase] === undefined) {
      state.marks[phase] = performance.now() - state.start;
    }
  }

  /** Gắn context ALS để lúc kết thúc (ngoài async context) vẫn đọc được thời gian DB/cache. */
  public attachContext(raw: object, context: RequestContextStore | undefined): void {
    const state = this.states.get(raw);
    if (state && context) state.context = context;
  }

  public keepRequestBody(req: FastifyRequest): void {
    const state = this.states.get(req.raw);
    if (state && this.cfg.captureBodies) state.requestBody = req.body;
  }

  public keepResponsePayload(req: FastifyRequest, payload: unknown): void {
    const state = this.states.get(req.raw);
    if (state && this.cfg.captureBodies) state.responsePayload = payload;
  }

  /** `reply = null` khi client đóng kết nối trước khi có response. */
  public finish(req: FastifyRequest, reply: FastifyReply | null): void {
    const state = this.states.get(req.raw);
    if (!state) return;
    this.states.delete(req.raw);
    this.active.delete(state.id);
    this.http.end();

    const durationMs = round1(performance.now() - state.start);
    state.marks.finished = durationMs;
    const status = reply ? reply.statusCode : CLIENT_CLOSED_STATUS;
    this.http.record(durationMs, status);
    if (!this.cfg.enabled) return;

    const error = readRequestError(req.raw) ?? null;
    const correlation = reply?.getHeader('x-correlation-id');
    const reason: CaptureReason | null =
      status >= 400
        ? 'error'
        : durationMs >= this.cfg.slowMs
          ? 'slow'
          : Math.random() < this.cfg.sampleRate
            ? 'sampled'
            : null;

    const summary: RequestSummary = {
      id: state.id,
      at: state.at,
      method: state.route.method,
      routeId: state.route.id,
      route: state.route.route,
      path: state.path,
      status,
      durationMs,
      instance: this.cfg.instanceId,
      correlationId: typeof correlation === 'string' ? correlation : null,
      errorCode: status >= 400 ? (error?.code ?? null) : null,
      captured: reason !== null,
    };

    this.aggregate(summary, breakdownOf(state));
    this.pendingLog.push(summary);
    if (this.pendingLog.length > this.cfg.requestLogSize) {
      this.pendingLog = this.pendingLog.slice(-this.cfg.requestLogSize);
    }
    if (reason && this.pendingDetails.length < MAX_PENDING_DETAILS) {
      this.pendingDetails.push(this.buildDetail(summary, reason, state, req, reply, error));
    }
  }

  /** Snapshot request đang chạy của instance này (dùng cho ghi Redis và test). */
  public activeSnapshot(now = Date.now()): ActiveSnapshot {
    for (const [id, a] of this.active)
      if (now - a.startedAt > ACTIVE_STALE_MS) this.active.delete(id);
    return { instance: this.cfg.instanceId, at: now, active: [...this.active.values()] };
  }

  public getLastFlushError(): string | null {
    return this.lastFlushError;
  }

  /** Ghi toàn bộ dữ liệu đang chờ vào Redis bằng một pipeline. */
  public async flush(): Promise<void> {
    if (!this.cfg.enabled || this.flushing) return;
    if (!this.redis.isReady()) {
      this.capPending();
      return;
    }
    this.flushing = true;
    const buckets = this.pendingBuckets;
    const routes = this.pendingRoutes;
    const log = this.pendingLog;
    const details = this.pendingDetails;
    this.pendingBuckets = new Map();
    this.pendingRoutes = new Map();
    this.pendingLog = [];
    this.pendingDetails = [];

    const now = Date.now();
    const pipe = this.redis.client.pipeline();
    for (const [key, bucket] of buckets) {
      for (const [field, value] of bucket.fields) pipe.hincrby(key, field, value);
      pipe.expire(key, bucket.ttlSec);
    }
    for (const [key, peak] of this.peaks) {
      pipe.hset(key, PEAK_ACTIVE_FIELD, peak.value);
      pipe.expire(key, peak.ttlSec);
      if (peak.bucketEndMs < now) this.peaks.delete(key);
    }
    for (const [id, route] of routes) pipe.hset(this.keys.routes(), id, JSON.stringify(route));
    if (log.length > 0) {
      // LPUSH đảo thứ tự: phần tử cuối (mới nhất) nằm đầu danh sách.
      pipe.lpush(this.keys.requestLog(), ...log.map((s) => JSON.stringify(s)));
      pipe.ltrim(this.keys.requestLog(), 0, this.cfg.requestLogSize - 1);
    }
    for (const detail of details) {
      pipe.set(
        this.keys.requestDetail(detail.id),
        JSON.stringify(detail),
        'EX',
        REQUEST_DETAIL_TTL_SEC,
      );
    }
    const activeTtl = Math.max(15, Math.ceil((this.cfg.flushMs * 3) / 1000));
    pipe.set(
      this.keys.active(this.cfg.instanceId),
      JSON.stringify(this.activeSnapshot(now)),
      'EX',
      activeTtl,
    );
    pipe.zadd(this.keys.instances(), now, this.cfg.instanceId);

    try {
      const results = (await pipe.exec()) ?? [];
      const failed = results.find(([err]) => err);
      if (failed?.[0]) throw failed[0];
      if (this.lastFlushError) this.logger.log('Traffic telemetry flush recovered');
      this.lastFlushError = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== this.lastFlushError)
        this.logger.warn(`Traffic telemetry flush failed: ${message}`);
      this.lastFlushError = message;
      // Route phải được ghi lại lần sau, nếu không endpoint sẽ thiếu tên.
      for (const [id, route] of routes) this.pendingRoutes.set(id, route);
    } finally {
      this.flushing = false;
    }
  }

  private resolveRoute(method: string, template: string): TrafficRoute {
    const route = buildRoute(method, template, this.config.app.apiPrefix, this.cfg.internalModules);
    if (!this.routes.has(route.id)) {
      this.routes.set(route.id, route);
      this.pendingRoutes.set(route.id, route);
    }
    return this.routes.get(route.id)!;
  }

  private aggregate(s: RequestSummary, breakdown: [string, number][]): void {
    const atSec = Math.floor(s.at / 1000);
    const fields: [string, number][] = [
      ['n', 1],
      ['ms', Math.round(s.durationMs)],
      [`h${histogramIndex(s.durationMs)}`, 1],
      [`s${s.status}`, 1],
      ...breakdown,
    ];
    if (s.errorCode) fields.push([`x${s.errorCode}`, 1]);

    for (const [tier, { seconds, ttlSec }] of TIER_ENTRIES) {
      const key = this.keys.bucket(tier, atSec - (atSec % seconds), this.cfg.instanceId);
      let bucket = this.pendingBuckets.get(key);
      if (!bucket) {
        bucket = { ttlSec, fields: new Map() };
        this.pendingBuckets.set(key, bucket);
      }
      for (const [metric, value] of fields) {
        const field = `${s.routeId}${FIELD_SEPARATOR}${metric}`;
        bucket.fields.set(field, (bucket.fields.get(field) ?? 0) + value);
      }
    }
  }

  private updatePeaks(at: number): void {
    const atSec = Math.floor(at / 1000);
    const current = this.active.size;
    for (const [tier, { seconds, ttlSec }] of TIER_ENTRIES) {
      const start = atSec - (atSec % seconds);
      const key = this.keys.bucket(tier, start, this.cfg.instanceId);
      const peak = this.peaks.get(key);
      if (!peak || peak.value < current) {
        this.peaks.set(key, { value: current, ttlSec, bucketEndMs: (start + seconds) * 1000 });
      }
    }
  }

  private buildDetail(
    summary: RequestSummary,
    captureReason: CaptureReason,
    state: RequestState,
    req: FastifyRequest,
    reply: FastifyReply | null,
    error: RequestDetail['error'],
  ): RequestDetail {
    const { captureBodies, maxBodyBytes } = this.cfg;
    const responseHeaders = (reply?.getHeaders() ?? {}) as Record<
      string,
      string | string[] | number | undefined
    >;
    const timeline: TimelineMark[] = PHASE_ORDER.filter((p) => state.marks[p] !== undefined).map(
      (phase) => ({ phase, offsetMs: round1(state.marks[phase]!) }),
    );
    return {
      ...summary,
      captureReason,
      query: redactQuery(req.query),
      ip: maskIp(req.ip),
      userAgent: req.headers['user-agent'] ?? null,
      headers: maskHeaders(req.headers),
      responseHeaders: maskHeaders(responseHeaders),
      requestBody: captureBody(
        state.requestBody,
        req.headers['content-type'],
        maxBodyBytes,
        captureBodies,
      ),
      responseBody: captureBody(
        state.responsePayload,
        String(responseHeaders['content-type'] ?? ''),
        maxBodyBytes,
        captureBodies,
      ),
      timeline,
      error: error ? { code: error.code, name: error.name, message: error.message } : null,
    };
  }

  private capPending(): void {
    if (this.pendingBuckets.size <= MAX_PENDING_BUCKETS) return;
    const overflow = this.pendingBuckets.size - MAX_PENDING_BUCKETS;
    const oldest = [...this.pendingBuckets.keys()].slice(0, overflow);
    for (const key of oldest) this.pendingBuckets.delete(key);
  }
}
