import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  PrometheusQueryClient,
  PrometheusUnavailableError,
  type PromSample,
} from '@packages/metrics/index.js';
import {
  TrafficEndpointNotFoundException,
  TrafficTelemetryUnavailableException,
} from '../exceptions/traffic.exceptions.js';
import type {
  EndpointDetailDto,
  EndpointRowDto,
  EndpointStatus,
  ErrorAnalysisDto,
  ReasonDto,
  SecurityTrafficDto,
  StatusClass,
  StatusCountDto,
  TimeseriesDto,
  TimeseriesMetric,
  TrafficComparisonDto,
  TrafficInsightsDto,
  TrafficProblemDto,
  TrafficSettingsDto,
  TrafficStatsDto,
  TrafficSummary24hDto,
  TrafficSummaryDto,
} from '../responses/traffic.response.js';

export const TRAFFIC_RANGES = {
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '6h': 360,
  '24h': 1440,
  '7d': 10080,
} as const;
export type TrafficRange = keyof typeof TRAFFIC_RANGES;

export const ENDPOINT_SORTS = ['traffic', 'latency', 'p95', 'errors'] as const;
export type EndpointSort = (typeof ENDPOINT_SORTS)[number];

const STATUS_CLASSES: StatusClass[] = ['2xx', '3xx', '4xx', '5xx'];
const SECURITY_STATUSES = [401, 403, 429] as const;
const H = 'http_request_duration_seconds';
/** Cửa sổ "hiện tại" của phát hiện bất thường và baseline liền trước. */
const RECENT_MIN = 5;
const BASELINE_MIN = 60;
const MAX_POINTS = 60;
const PROBLEM_ENDPOINTS = 5;

/** Tạo khóa định danh cho tuyến đường API (route) */
const routeKey = (labels: Record<string, string>) =>
  `${labels['method'] || 'GET'} ${labels['route'] || '/'}`;
/** Phân nhóm số liệu đo lường theo tuyến đường API */
const byRoute = (samples: PromSample[]) =>
  new Map(samples.map((item) => [routeKey(item.labels), item.value]));
/** Chuyển đổi giá trị thời gian sang đơn vị mili-giây */
const toMs = (sec: number | null | undefined) =>
  sec === null || sec === undefined || !Number.isFinite(sec) ? null : Math.round(sec * 1000);
/** Làm tròn giá trị số đến số chữ số chỉ định */
const round = (n: number, d = 2) => Number(n.toFixed(d));
/** Tính toán tỷ lệ phần trăm của một giá trị so với tổng số */
const percentOf = (part: number, total: number) => (total > 0 ? round((part / total) * 100) : 0);
/** Tính toán tỷ lệ phần trăm thay đổi giữa hai mốc đo */
const percentDelta = (current: number | null, previous: number | null) =>
  current === null || previous === null || previous === 0
    ? null
    : round(((current - previous) / previous) * 100, 1);
/** Giá trị nhãn an toàn trong PromQL. */
const lv = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
/** Thoát các ký tự đặc biệt trong chuỗi để sử dụng trong Regular Expression */
const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');

/** Regex PromQL (khớp toàn chuỗi) cho route nội bộ thuộc các module `TRAFFIC_INTERNAL_MODULES`. */
export function internalRouteRegex(modules: readonly string[]): string {
  const mods = modules.map(escapeRe).join('|') || 'ops|health';
  return `.*/(${mods})(/.*)?`;
}

export interface TrafficQuery {
  range: TrafficRange;
  method?: string | undefined;
  routeId?: string | undefined;
  includeInternal: boolean;
}

/** Số liệu thô của một cửa sổ (tổng hoặc một endpoint). */
interface WindowStats {
  statuses: StatusCountDto[];
  stats: TrafficStatsDto;
}

/**
 * HTTP Traffic từ Prometheus: histogram `http_request_duration_seconds{method,route,status}` do hook Fastify ghi.
 * Mọi con số có nguồn PromQL; Prometheus không trả lời → 503, không trả 0 giả.
 */
@Injectable()
export class TrafficService {
  constructor(
    private readonly prom: PrometheusQueryClient,
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
  ) {}

  private get cfg() {
    return this.config.traffic;
  }

  /** Route nội bộ = segment thuộc `TRAFFIC_INTERNAL_MODULES` (mặc định ops, health). */
  private get internalRe(): string {
    return internalRouteRegex(this.cfg.internalModules);
  }

  /** Kiểm tra xem yêu cầu HTTP có phải là nội bộ hệ thống hay không */
  private isInternal(route: string): boolean {
    return new RegExp(`^${this.internalRe.replace(/\\\\/g, '\\')}$`).test(route);
  }

  /** Bộ lọc nhãn theo query (+ điều kiện thêm), vd. `{route!~"…",method="GET",status=~"5.."}`. */
  private sel(q: Omit<TrafficQuery, 'range'>, ...extra: string[]): string {
    const parts = [...extra];
    if (!q.includeInternal) parts.push(`route!~"${this.internalRe}"`);
    if (q.method) parts.push(`method="${lv(q.method)}"`);
    if (q.routeId) {
      const i = q.routeId.indexOf(' ');
      if (i > 0) {
        parts.push(`method="${lv(q.routeId.slice(0, i))}"`);
        parts.push(`route="${lv(q.routeId.slice(i + 1))}"`);
      }
    }
    return parts.length ? `{${parts.join(',')}}` : '';
  }

  /** Prometheus không cấu hình/không trả lời → 503, thay vì số 0 trông như "không có traffic". */
  private async must<T>(task: Promise<T>): Promise<T> {
    try {
      return await task;
    } catch (err) {
      if (err instanceof PrometheusUnavailableError)
        throw new TrafficTelemetryUnavailableException();
      throw err;
    }
  }

  /** Lấy các thiết lập cấu hình phân tích lưu lượng truy cập */
  private settings(): TrafficSettingsDto {
    const th = this.cfg.thresholds;
    return {
      endpointP95WarnMs: th.endpointP95Ms,
      errorRateWarnPercent: th.errorRateWarnPercent,
      errorRateCritPercent: th.errorRateCritPercent,
    };
  }

  /** Thống kê một cửa sổ `seconds` kết thúc trước hiện tại `offsetSec` giây. */
  private async window(
    selector: string,
    seconds: number,
    offsetSec = 0,
    strict = true,
  ): Promise<WindowStats> {
    const w = `${Math.max(60, Math.round(seconds))}s`;
    const off = offsetSec > 0 ? ` offset ${Math.round(offsetSec)}s` : '';
    /** Làm tròn giá trị số theo độ chia nhỏ nhất (quantum) */
    const quant = (p: number) =>
      this.prom.value(
        `histogram_quantile(${p}, sum by (le) (rate(${H}_bucket${selector}[${w}]${off})))`,
      );
    const statusQuery = this.prom.query(
      `sum by (status) (increase(${H}_count${selector}[${w}]${off}))`,
    );
    const [statusSamples, sumDuration, p50, p95, p99] = await Promise.all([
      strict ? this.must(statusQuery) : statusQuery.catch(() => [] as PromSample[]),
      this.prom.value(`sum(increase(${H}_sum${selector}[${w}]${off}))`),
      quant(0.5),
      quant(0.95),
      quant(0.99),
    ]);
    const statuses = statusSamples
      .map((s) => ({ status: Number(s.labels['status']) || 0, count: Math.round(s.value) }))
      .filter((s) => s.status > 0 && s.count > 0)
      .sort((a, b) => b.count - a.count || a.status - b.status);
    const requests = statuses.reduce((n, s) => n + s.count, 0);
    /** Đếm tổng số lượng phần tử theo điều kiện chỉ định */
    const count = (from: number, to: number) =>
      statuses.filter((s) => s.status >= from && s.status < to).reduce((n, s) => n + s.count, 0);
    const clientErrors = count(400, 500);
    const serverErrors = count(500, 600);
    return {
      statuses,
      stats: {
        requests,
        requestsPerSecond: round(requests / seconds, 3),
        avgLatencyMs:
          requests > 0 && sumDuration !== null ? round((sumDuration / requests) * 1000, 1) : null,
        p50LatencyMs: toMs(p50),
        p95LatencyMs: toMs(p95),
        p99LatencyMs: toMs(p99),
        clientErrors,
        serverErrors,
        errorRatePercent: percentOf(serverErrors, requests),
        clientErrorRatePercent: percentOf(clientErrors, requests),
      },
    };
  }

  /** So sánh dữ liệu lưu lượng giữa hai khoảng thời gian */
  private compare(current: TrafficStatsDto, previous: TrafficStatsDto): TrafficComparisonDto {
    if (previous.requests === 0)
      return { requestsPercent: null, p95Percent: null, errorRateDelta: null };
    return {
      requestsPercent: percentDelta(current.requests, previous.requests),
      p95Percent: percentDelta(current.p95LatencyMs, previous.p95LatencyMs),
      errorRateDelta: round(current.errorRatePercent - previous.errorRatePercent),
    };
  }

  /** Số request từ 0 giờ hôm nay (giờ của server). */
  private requestsToday(selector: string): Promise<number | null> {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const sec = Math.max(60, Math.round((Date.now() - midnight.getTime()) / 1000));
    return this.prom
      .value(`sum(increase(${H}_count${selector}[${sec}s]))`)
      .then((v) => (v === null ? null : Math.round(v)));
  }

  /** Phân loại các mã trạng thái phản hồi HTTP */
  private classes(statuses: StatusCountDto[], total: number) {
    return STATUS_CLASSES.map((cls) => {
      const count = statuses
        .filter((s) => `${String(s.status)[0]}xx` === cls)
        .reduce((n, s) => n + s.count, 0);
      return { class: cls, count, percent: total > 0 ? round((count / total) * 100, 1) : 0 };
    });
  }

  /** Lấy dữ liệu tóm tắt lưu lượng và hiệu năng truy cập */
  public async getSummary(q: TrafficQuery): Promise<TrafficSummaryDto> {
    const seconds = TRAFFIC_RANGES[q.range] * 60;
    const selector = this.sel(q);
    const [current, previous, today] = await Promise.all([
      this.window(selector, seconds),
      this.window(selector, seconds, seconds, false),
      this.requestsToday(selector),
    ]);
    return {
      stats: current.stats,
      comparison: this.compare(current.stats, previous.stats),
      requestsToday: today,
      hasTraffic: current.stats.requests > 0 || (today ?? 0) > 0,
      statusClasses: this.classes(current.statuses, current.stats.requests),
      topStatuses: current.statuses.slice(0, 10),
      settings: this.settings(),
    };
  }

  /** Lấy dữ liệu chuỗi thời gian của lưu lượng mạng */
  public async getTimeseries(q: TrafficQuery, metric: TimeseriesMetric): Promise<TimeseriesDto> {
    const minutes = TRAFFIC_RANGES[q.range];
    const stepSec = Math.max(15, Math.round((minutes * 60) / MAX_POINTS));
    const w = `${Math.max(60, stepSec * 2)}s`;
    const selector = this.sel(q);
    /** Tính toán tỷ lệ phần trăm giữa hai đại lượng */
    const rate = (extra?: string) =>
      `sum(rate(${H}_count${extra ? this.sel(q, extra) : selector}[${w}]))`;

    let unit: TimeseriesDto['unit'] = 'rps';
    let series: TimeseriesDto['series'];
    // Series đầu tiên là series chính để tính current/average/peak (status: tổng các lớp).
    let main: { t: number; value: number }[];
    if (metric === 'status') {
      const [total, ...byClass] = await Promise.all([
        this.must(this.prom.range(rate(), minutes, stepSec)),
        ...STATUS_CLASSES.map((cls) =>
          this.prom.safeRange(rate(`status=~"${cls[0]}.."`), minutes, stepSec),
        ),
      ]);
      series = STATUS_CLASSES.map((cls, i) => ({
        id: cls,
        points: this.points(byClass[i]?.[0]?.points),
      }));
      main = this.points(total[0]?.points);
    } else if (metric === 'latency') {
      unit = 'ms';
      /** Làm tròn giá trị số theo độ chia nhỏ nhất (quantum) */
      const quant = (p: number) =>
        `histogram_quantile(${p}, sum by (le) (rate(${H}_bucket${selector}[${w}]))) * 1000`;
      const [p95, p50, p99] = await Promise.all([
        this.must(this.prom.range(quant(0.95), minutes, stepSec)),
        this.prom.safeRange(quant(0.5), minutes, stepSec),
        this.prom.safeRange(quant(0.99), minutes, stepSec),
      ]);
      series = [
        { id: 'p95', points: this.points(p95[0]?.points) },
        { id: 'p50', points: this.points(p50[0]?.points) },
        { id: 'p99', points: this.points(p99[0]?.points) },
      ];
      main = series[0]!.points;
    } else {
      const expr = metric === 'errors' ? `${rate('status=~"5.."')} / ${rate()} * 100` : rate();
      unit = metric === 'errors' ? 'percent' : 'rps';
      const res = await this.must(this.prom.range(expr, minutes, stepSec));
      series = [{ id: metric, points: this.points(res[0]?.points) }];
      main = series[0]!.points;
    }

    const values = main.map((p) => p.value);
    const peak = values.length ? Math.max(...values) : null;
    return {
      metric,
      stepSec,
      unit,
      series,
      current: values.at(-1) ?? null,
      average: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null,
      peak,
      peakAt: peak !== null ? (main.find((p) => p.value === peak)?.t ?? null) : null,
    };
  }

  /** Chuyển đổi dữ liệu đo lường thành các điểm tọa độ biểu đồ */
  private points(list: { t: number; v: number }[] | undefined) {
    return (list ?? [])
      .filter((p) => Number.isFinite(p.v))
      .map((p) => ({ t: p.t, value: round(p.v) }));
  }

  /** Lấy trạng thái vận hành hiện tại của dịch vụ */
  private status(stats: TrafficStatsDto): { status: EndpointStatus; reasons: ReasonDto[] } {
    const th = this.cfg.thresholds;
    /** Trích xuất chuỗi giải thích nguyên nhân lỗi hoặc cảnh báo */
    const reason = (code: string, params: Record<string, string | number>) => ({
      code,
      message: this.i18n.t(`traffic.reason.${code}`, params),
    });
    if (stats.requests === 0) return { status: 'idle', reasons: [reason('idle', {})] };
    if (stats.requests < th.minRequestsForStatus)
      return {
        status: 'low_traffic',
        reasons: [reason('lowTraffic', { count: stats.requests, min: th.minRequestsForStatus })],
      };
    if (stats.errorRatePercent >= th.errorRateCritPercent)
      return {
        status: 'failing',
        reasons: [
          reason('failing', {
            rate: stats.errorRatePercent,
            threshold: th.errorRateCritPercent,
          }),
        ],
      };
    if (stats.errorRatePercent >= th.errorRateWarnPercent)
      return {
        status: 'high_error',
        reasons: [
          reason('highError', {
            rate: stats.errorRatePercent,
            threshold: th.errorRateWarnPercent,
          }),
        ],
      };
    if (stats.p95LatencyMs !== null && stats.p95LatencyMs >= th.endpointP95Ms)
      return {
        status: 'slow',
        reasons: [reason('slow', { p95: stats.p95LatencyMs, threshold: th.endpointP95Ms })],
      };
    return { status: 'healthy', reasons: [] };
  }

  /** Lấy danh sách thống kê hiệu năng theo từng endpoint API */
  public async getEndpoints(q: TrafficQuery, sort: EndpointSort): Promise<EndpointRowDto[]> {
    const seconds = TRAFFIC_RANGES[q.range] * 60;
    const w = `${seconds}s`;
    const selector = this.sel(q);
    /** Sắp xếp hoặc phân nhóm dữ liệu theo thuộc tính chỉ định */
    const by = (extra?: string, metric = '_count') =>
      `sum by (route, method) (increase(${H}${metric}${extra ? this.sel(q, extra) : selector}[${w}]))`;
    /** Tính toán giá trị phân vị xác suất của tập hợp số liệu */
    const quantile = (p: number) =>
      this.prom.safeQuery(
        `histogram_quantile(${p}, sum by (le, route, method) (rate(${H}_bucket${selector}[${w}])))`,
      );
    const [counts, sums, p50s, p95s, p99s, errors5xx, errors4xx] = await Promise.all([
      this.must(this.prom.query(by())),
      this.prom.safeQuery(by(undefined, '_sum')),
      quantile(0.5),
      quantile(0.95),
      quantile(0.99),
      this.prom.safeQuery(by('status=~"5.."')),
      this.prom.safeQuery(by('status=~"4.."')),
    ]);
    const sumMap = byRoute(sums);
    const p50Map = byRoute(p50s);
    const p95Map = byRoute(p95s);
    const p99Map = byRoute(p99s);
    const errMap = byRoute(errors5xx);
    const clientErrMap = byRoute(errors4xx);

    const rows = counts.map((item): EndpointRowDto => {
      const method = item.labels['method'] || 'GET';
      const route = item.labels['route'] || '/';
      const key = routeKey(item.labels);
      const requests = Math.round(item.value);
      const sumSec = sumMap.get(key);
      const serverErrors = Math.round(errMap.get(key) ?? 0);
      const clientErrors = Math.round(clientErrMap.get(key) ?? 0);
      const segments = route.split('/').filter(Boolean);
      const stats: TrafficStatsDto = {
        requests,
        requestsPerSecond: round(requests / seconds, 3),
        avgLatencyMs:
          requests > 0 && sumSec !== undefined ? round((sumSec / requests) * 1000, 1) : null,
        p50LatencyMs: toMs(p50Map.get(key)),
        p95LatencyMs: toMs(p95Map.get(key)),
        p99LatencyMs: toMs(p99Map.get(key)),
        clientErrors,
        serverErrors,
        errorRatePercent: percentOf(serverErrors, requests),
        clientErrorRatePercent: percentOf(clientErrors, requests),
      };
      return {
        id: key,
        method,
        route,
        module: segments[1] ?? segments[0] ?? 'root',
        internal: this.isInternal(route),
        stats,
        ...this.status(stats),
      };
    });

    const metricOf: Record<EndpointSort, (r: EndpointRowDto) => number> = {
      traffic: (r) => r.stats.requests,
      latency: (r) => r.stats.avgLatencyMs ?? 0,
      p95: (r) => r.stats.p95LatencyMs ?? 0,
      errors: (r) => r.stats.errorRatePercent,
    };
    return rows.sort((a, b) => metricOf[sort](b) - metricOf[sort](a) || a.id.localeCompare(b.id));
  }

  /** Lấy thông tin chi tiết về lưu lượng và lỗi của một endpoint API */
  public async getEndpoint(routeId: string, q: TrafficQuery): Promise<EndpointDetailDto> {
    const endpoints = await this.getEndpoints({ ...q, includeInternal: true }, 'traffic');
    const ep =
      endpoints.find((e) => e.id === routeId || e.route === routeId) ??
      endpoints.find((e) => e.id.toLowerCase() === routeId.toLowerCase());
    if (!ep) throw new TrafficEndpointNotFoundException(routeId);
    const seconds = TRAFFIC_RANGES[q.range] * 60;
    const selector = this.sel({ includeInternal: true, routeId: ep.id });
    const [current, previous, today] = await Promise.all([
      this.window(selector, seconds),
      this.window(selector, seconds, seconds, false),
      this.requestsToday(selector),
    ]);
    return {
      ...ep,
      range: q.range,
      comparison: this.compare(current.stats, previous.stats),
      requestsToday: today,
      topStatuses: current.statuses.slice(0, 10),
    };
  }

  /** Lấy danh sách thống kê các lỗi HTTP ghi nhận được */
  public async getErrors(q: TrafficQuery): Promise<ErrorAnalysisDto> {
    const [summary, endpoints] = await Promise.all([
      this.getSummary(q),
      this.getEndpoints(q, 'errors'),
    ]);
    return {
      stats: summary.stats,
      topRoutes: endpoints
        .filter((e) => e.stats.serverErrors > 0 || e.stats.clientErrors > 0)
        .sort(
          (a, b) =>
            b.stats.serverErrors - a.stats.serverErrors ||
            b.stats.clientErrors - a.stats.clientErrors,
        )
        .map((e) => ({
          routeId: e.id,
          method: e.method,
          route: e.route,
          clientErrors: e.stats.clientErrors,
          serverErrors: e.stats.serverErrors,
        })),
      topStatuses: summary.topStatuses.filter((s) => s.status >= 400),
    };
  }

  /** Phân tích và đưa ra các nhận định chuyên sâu về lưu lượng mạng */
  public async getInsights(q: TrafficQuery): Promise<TrafficInsightsDto> {
    const selector = this.sel(q);
    const [problems, security, last24h] = await Promise.all([
      this.problems(q, selector),
      this.security(q),
      this.last24h(selector),
    ]);
    return {
      problems,
      security,
      rateLimit: { configured: false, message: this.i18n.t('traffic.rateLimit.notConfigured') },
      last24h,
    };
  }

  /**
   * Bất thường theo rule: `RECENT_MIN` phút gần nhất so với `BASELINE_MIN` phút liền trước (lưu lượng tăng vọt, 5xx
   * vượt ngưỡng, P95 tăng vọt), cộng các endpoint đang slow / high_error / failing trong khoảng đang xem.
   */
  private async problems(q: TrafficQuery, selector: string): Promise<TrafficProblemDto[]> {
    const th = this.cfg.thresholds;
    const [recent, baseline, endpoints, recentEndpoints] = await Promise.all([
      this.window(selector, RECENT_MIN * 60),
      this.window(selector, BASELINE_MIN * 60, RECENT_MIN * 60, false),
      this.getEndpoints(q, 'errors'),
      this.getEndpoints({ ...q, range: '5m' }, 'errors'),
    ]);
    const now = new Date().toISOString();
    const out: TrafficProblemDto[] = [];
    /** Thêm mới một phần tử vào danh sách hoặc bộ sưu tập */
    const add = (
      kind: TrafficProblemDto['kind'],
      severity: TrafficProblemDto['severity'],
      params: Record<string, string | number>,
      routeId: string | null = null,
    ) =>
      out.push({
        kind,
        severity,
        title: this.i18n.t(`traffic.problem.${kind}.title`, params),
        message: this.i18n.t(`traffic.problem.${kind}.message`, params),
        routeId,
        since: now,
      });
    const none = this.i18n.t('traffic.problem.none');

    const r = recent.stats;
    const b = baseline.stats;
    const growth = percentDelta(r.requestsPerSecond, b.requestsPerSecond);
    if (
      r.requestsPerSecond >= th.minRpsForAlert &&
      growth !== null &&
      growth >= th.spikeIncreasePercent
    )
      add('trafficSpike', 'warning', {
        percent: growth,
        current: r.requestsPerSecond,
        baseline: b.requestsPerSecond,
      });

    if (r.requests >= th.minRequestsForStatus && r.errorRatePercent >= th.errorRateWarnPercent) {
      const top = recentEndpoints.find((e) => e.stats.serverErrors > 0);
      add(
        'errorSpike',
        r.errorRatePercent >= th.errorRateCritPercent ? 'critical' : 'warning',
        {
          baseline: b.requests > 0 ? b.errorRatePercent : none,
          current: r.errorRatePercent,
          endpoint: top?.id ?? none,
        },
        top?.id ?? null,
      );
    }

    const p95 = r.p95LatencyMs;
    const p95Base = b.p95LatencyMs;
    if (
      r.requests >= th.minRequestsForStatus &&
      p95 !== null &&
      p95 >= this.cfg.slowMs &&
      (p95Base === null || p95 >= p95Base * (1 + th.spikeIncreasePercent / 100))
    ) {
      const slow = recentEndpoints
        .filter((e) => (e.stats.p95LatencyMs ?? 0) >= th.endpointP95Ms)
        .slice(0, 3)
        .map((e) => e.id);
      add('latency', 'warning', {
        baseline: p95Base ?? none,
        current: p95,
        endpoints: slow.join(', ') || none,
      });
    }

    for (const e of endpoints
      .filter((x) => x.status === 'failing' || x.status === 'high_error' || x.status === 'slow')
      .slice(0, PROBLEM_ENDPOINTS)) {
      const kind = `endpoint.${e.status}` as TrafficProblemDto['kind'];
      out.push({
        kind,
        severity: e.status === 'failing' ? 'critical' : 'warning',
        title: this.i18n.t(`traffic.problem.${kind}.title`, { endpoint: e.id }),
        message: e.reasons[0]?.message ?? '',
        routeId: e.id,
        since: null,
      });
    }
    const rank = { critical: 0, warning: 1 } as const;
    return out.sort((a, b2) => rank[a.severity] - rank[b2.severity]);
  }

  /** 401 / 403 / 429 trong khoảng đang xem, kèm endpoint nhận nhiều nhất. */
  private async security(q: TrafficQuery): Promise<SecurityTrafficDto[]> {
    const w = `${TRAFFIC_RANGES[q.range] * 60}s`;
    const rows = await this.prom.safeQuery(
      `sum by (status, method, route) (increase(${H}_count${this.sel(q, 'status=~"401|403|429"')}[${w}]))`,
    );
    return SECURITY_STATUSES.map((status) => {
      const list = rows
        .filter((x) => Number(x.labels['status']) === status)
        .map((x) => ({ labels: x.labels, count: Math.round(x.value) }))
        .filter((x) => x.count > 0)
        .sort((a, b) => b.count - a.count);
      const top = list[0];
      return {
        status,
        count: list.reduce((n, x) => n + x.count, 0),
        topRoute: top
          ? { method: top.labels['method'] || 'GET', route: top.labels['route'] || '/' }
          : null,
      };
    });
  }

  /** Đúng 24 giờ gần nhất: tổng, thành công (2xx/3xx), lỗi, giờ cao điểm và khung giờ chậm nhất. */
  private async last24h(selector: string): Promise<TrafficSummary24hDto> {
    const DAY_MIN = 1440;
    const [day, rps, p95] = await Promise.all([
      this.window(selector, DAY_MIN * 60, 0, false),
      this.prom.safeRange(`sum(rate(${H}_count${selector}[10m]))`, DAY_MIN, 600),
      this.prom.safeRange(
        `histogram_quantile(0.95, sum by (le) (rate(${H}_bucket${selector}[1h])))`,
        DAY_MIN,
        3600,
      ),
    ]);
    const s = day.stats;
    const peak = (rps[0]?.points ?? [])
      .filter((p) => Number.isFinite(p.v) && p.v > 0)
      .reduce<{ t: number; v: number } | null>((m, p) => (!m || p.v > m.v ? p : m), null);
    const slow = (p95[0]?.points ?? [])
      .filter((p) => Number.isFinite(p.v))
      .reduce<{ t: number; v: number } | null>((m, p) => (!m || p.v > m.v ? p : m), null);
    return {
      total: s.requests,
      successful: Math.max(0, s.requests - s.clientErrors - s.serverErrors),
      clientErrors: s.clientErrors,
      serverErrors: s.serverErrors,
      peak: peak ? { at: new Date(peak.t).toISOString(), requestsPerSecond: round(peak.v) } : null,
      slowest: slow
        ? {
            from: new Date(slow.t - 3_600_000).toISOString(),
            to: new Date(slow.t).toISOString(),
            p95LatencyMs: Math.round(slow.v * 1000),
          }
        : null,
    };
  }
}
