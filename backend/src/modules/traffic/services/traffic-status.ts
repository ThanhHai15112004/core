import type { TrafficConfig } from '@packages/config/index.js';
import type { EndpointStatus, TrafficStatsDto } from '../responses/traffic.response.js';

export interface StatusReasonKey {
  code: string;
  params: Record<string, string | number>;
}

const SEVERITY: Record<EndpointStatus, number> = {
  idle: 0,
  low_traffic: 0,
  healthy: 1,
  slow: 2,
  high_error: 3,
  failing: 4,
};

/** Suy ra trạng thái endpoint từ số liệu — chỉ kết luận khi đủ mẫu. */
export function evaluateEndpoint(
  stats: TrafficStatsDto,
  thresholds: TrafficConfig['thresholds'],
): { status: EndpointStatus; reasons: StatusReasonKey[] } {
  if (stats.requests === 0) return { status: 'idle', reasons: [{ code: 'idle', params: {} }] };
  if (stats.requests < thresholds.minRequestsForStatus) {
    return {
      status: 'low_traffic',
      reasons: [
        {
          code: 'lowTraffic',
          params: { count: stats.requests, min: thresholds.minRequestsForStatus },
        },
      ],
    };
  }

  let status: EndpointStatus = 'healthy';
  const reasons: StatusReasonKey[] = [];
  const raise = (next: EndpointStatus) => {
    if (SEVERITY[next] > SEVERITY[status]) status = next;
  };

  if (stats.errorRatePercent >= thresholds.errorRateCritPercent) {
    raise('failing');
    reasons.push({
      code: 'failing',
      params: { rate: stats.errorRatePercent, threshold: thresholds.errorRateCritPercent },
    });
  } else if (stats.errorRatePercent >= thresholds.errorRateWarnPercent) {
    raise('high_error');
    reasons.push({
      code: 'highError',
      params: { rate: stats.errorRatePercent, threshold: thresholds.errorRateWarnPercent },
    });
  }
  if (stats.p95LatencyMs !== null && stats.p95LatencyMs > thresholds.endpointP95Ms) {
    raise('slow');
    reasons.push({
      code: 'slow',
      params: { p95: stats.p95LatencyMs, threshold: thresholds.endpointP95Ms },
    });
  }
  return { status, reasons };
}

export const isProblemStatus = (s: EndpointStatus): s is 'slow' | 'high_error' | 'failing' =>
  s === 'slow' || s === 'high_error' || s === 'failing';
