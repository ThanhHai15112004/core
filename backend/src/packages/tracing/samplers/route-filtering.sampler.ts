import type { Attributes, Context, Link, SpanKind } from '@opentelemetry/api';
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  ParentBasedSampler,
  SamplingDecision,
  TraceIdRatioBasedSampler,
  type Sampler,
  type SamplingResult,
} from '@opentelemetry/sdk-trace-base';
import type { TracingSamplerType } from '@packages/config/index.js';

const API_VERSION_PREFIX_RE = /^\/api\/v\d+(?=\/|$)/i;

function normalizeRoutePath(raw: string): string {
  const pathOnly = raw.split('?')[0]?.trim() ?? '';
  if (!pathOnly) return '/';
  const withSlash = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  return withSlash.replace(API_VERSION_PREFIX_RE, '') || '/';
}

/** Kiểm tra đường dẫn request có nằm trong danh sách route bỏ qua (health, metrics, ops...) hay không. */
export function shouldIgnoreRoute(
  rawPath: string | undefined,
  ignoreRoutes: readonly string[],
): boolean {
  if (!rawPath || ignoreRoutes.length === 0) return false;
  const fullPath = rawPath.split('?')[0]?.trim() ?? '';
  const strippedPath = normalizeRoutePath(rawPath);

  for (const rawPattern of ignoreRoutes) {
    const pattern = rawPattern.trim();
    if (!pattern) continue;
    const normalizedPattern = pattern.startsWith('/') ? pattern : `/${pattern}`;
    const matches = (candidate: string): boolean =>
      candidate === normalizedPattern || candidate.startsWith(`${normalizedPattern}/`);
    if (matches(fullPath) || matches(strippedPath)) {
      return true;
    }
  }
  return false;
}

/** Tạo base OpenTelemetry Sampler theo chiến lược và tỉ lệ cấu hình. */
export function buildBaseSampler(samplerType: TracingSamplerType, samplingRatio: number): Sampler {
  const ratio = Number.isFinite(samplingRatio) ? Math.min(1, Math.max(0, samplingRatio)) : 1;
  switch (samplerType) {
    case 'always_on':
      return new AlwaysOnSampler();
    case 'always_off':
      return new AlwaysOffSampler();
    case 'traceidratio':
      return new TraceIdRatioBasedSampler(ratio);
    case 'parentbased_traceidratio':
    default:
      return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) });
  }
}

/**
 * Sampler bọc ngoài: loại bỏ các route nhiễu (`/health`, `/metrics`, `/ops`) trước khi áp dụng
 * chiến lược lấy mẫu (sampling) cấu hình để giảm chi phí lưu trữ trace.
 */
export class RouteFilteringSampler implements Sampler {
  constructor(
    private readonly inner: Sampler,
    private readonly ignoreRoutes: readonly string[],
  ) {}

  public shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[],
  ): SamplingResult {
    const rawPath =
      (typeof attributes['url.path'] === 'string' ? attributes['url.path'] : undefined) ??
      (typeof attributes['http.route'] === 'string' ? attributes['http.route'] : undefined) ??
      (typeof attributes['http.target'] === 'string' ? attributes['http.target'] : undefined);

    if (shouldIgnoreRoute(rawPath, this.ignoreRoutes)) {
      return { decision: SamplingDecision.NOT_RECORD };
    }

    return this.inner.shouldSample(context, traceId, spanName, spanKind, attributes, links);
  }

  public toString(): string {
    return `RouteFilteringSampler{inner=${this.inner.toString()}, ignoreRoutes=${this.ignoreRoutes.join(',')}}`;
  }
}
