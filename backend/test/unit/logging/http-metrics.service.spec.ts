import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpMetricsService } from '@packages/logging/index.js';

describe('HttpMetricsService', () => {
  let metrics: HttpMetricsService;

  beforeEach(() => {
    jest.useFakeTimers();
    metrics = new HttpMetricsService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports no latency when there is no traffic', () => {
    expect(metrics.snapshot()).toMatchObject({
      totalRequests: 0,
      requestsPerSecond: 0,
      errorRatePercent: 0,
      p95LatencyMs: null,
    });
  });

  it('computes request rate, 5xx error rate and p95 latency', () => {
    for (let i = 1; i <= 20; i++) {
      metrics.record(i * 10, i === 20 ? 500 : 200);
    }
    metrics.record(5, 404);

    const snapshot = metrics.snapshot();
    expect(snapshot.totalRequests).toBe(21);
    expect(snapshot.errorCount).toBe(1);
    expect(snapshot.errorRatePercent).toBeCloseTo(4.76, 2);
    expect(snapshot.p95LatencyMs).toBe(190);
  });

  it('drops samples older than the 60s window', () => {
    metrics.record(10, 200);
    jest.advanceTimersByTime(61_000);
    metrics.record(20, 200);

    expect(metrics.snapshot().totalRequests).toBe(1);
  });
});
