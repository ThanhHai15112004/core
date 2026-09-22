import { describe, it, expect } from '@jest/globals';
import { evaluateEndpoint } from '@modules/traffic/services/traffic-status.js';
import { tierCovering } from '@modules/traffic/index.js';
import type { TrafficStatsDto } from '@modules/traffic/index.js';

const thresholds = {
  endpointP95Ms: 500,
  errorRateWarnPercent: 2,
  errorRateCritPercent: 10,
  spikeIncreasePercent: 100,
  minRpsForAlert: 1,
  minRequestsForStatus: 20,
};

const stats = (o: Partial<TrafficStatsDto>): TrafficStatsDto => ({
  requests: 100,
  requestsPerSecond: 1,
  avgLatencyMs: 20,
  p50LatencyMs: 10,
  p95LatencyMs: 40,
  p99LatencyMs: 80,
  clientErrors: 0,
  serverErrors: 0,
  errorRatePercent: 0,
  clientErrorRatePercent: 0,
  ...o,
});

describe('evaluateEndpoint', () => {
  it('idle khi không có request, low_traffic khi chưa đủ mẫu', () => {
    expect(evaluateEndpoint(stats({ requests: 0 }), thresholds).status).toBe('idle');
    expect(evaluateEndpoint(stats({ requests: 5, errorRatePercent: 100 }), thresholds).status).toBe(
      'low_traffic',
    );
  });

  it('healthy khi trong ngưỡng', () => {
    expect(evaluateEndpoint(stats({}), thresholds)).toEqual({ status: 'healthy', reasons: [] });
  });

  it('slow khi P95 vượt ngưỡng', () => {
    const r = evaluateEndpoint(stats({ p95LatencyMs: 1200 }), thresholds);
    expect(r.status).toBe('slow');
    expect(r.reasons[0]).toEqual({ code: 'slow', params: { p95: 1200, threshold: 500 } });
  });

  it('lỗi 5xx được ưu tiên hơn chậm', () => {
    expect(
      evaluateEndpoint(stats({ errorRatePercent: 3, p95LatencyMs: 900 }), thresholds).status,
    ).toBe('high_error');
    const failing = evaluateEndpoint(
      stats({ errorRatePercent: 25, p95LatencyMs: 900 }),
      thresholds,
    );
    expect(failing.status).toBe('failing');
    expect(failing.reasons.map((x) => x.code)).toEqual(['failing', 'slow']);
  });

  it('4xx không làm endpoint bị coi là lỗi', () => {
    expect(evaluateEndpoint(stats({ clientErrorRatePercent: 60 }), thresholds).status).toBe(
      'healthy',
    );
  });
});

describe('tierCovering', () => {
  const now = Date.now();
  it('chọn tầng mịn nhất còn giữ dữ liệu', () => {
    expect(tierCovering(now - 15 * 60_000, now)).toBe('s10');
    expect(tierCovering(now - 6 * 3600_000, now)).toBe('m1');
    expect(tierCovering(now - 7 * 24 * 3600_000, now)).toBe('h1');
    expect(tierCovering(now - 14 * 24 * 3600_000, now)).toBeNull();
  });
});
