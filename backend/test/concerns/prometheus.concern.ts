import { jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import {
  PrometheusQueryClient,
  type PromSample,
  type PromSeries,
} from '@packages/metrics/index.js';

export interface PrometheusFixture {
  /** Trả mẫu cho instant query theo nội dung PromQL; `[]` = không có dữ liệu. */
  query: (expr: string) => PromSample[];
  /** Trả chuỗi cho range query (`offsetSec` > 0 = khoảng lùi về quá khứ); mặc định không có dữ liệu. */
  range?: (expr: string, offsetSec: number) => PromSeries[];
}

/**
 * Test Concern: stubPrometheus
 * Thay `query`/`range` của PrometheusQueryClient trong app test bằng dữ liệu cố định — test không cần Prometheus
 * thật. `value`/`safeQuery`/`safeRange` đi qua hai hàm này nên cũng nhận dữ liệu giả; `configured` báo true như khi
 * có `PROMETHEUS_URL`. Trả về hàm khôi phục.
 */
export function stubPrometheus(app: INestApplication, fixture: PrometheusFixture): () => void {
  const client = app.get(PrometheusQueryClient);
  const query = jest
    .spyOn(client, 'query')
    .mockImplementation((expr: string) => Promise.resolve(fixture.query(expr)));
  const range = jest
    .spyOn(client, 'range')
    .mockImplementation((expr: string, _minutes: number, _step: number, offsetSec = 0) =>
      Promise.resolve(fixture.range?.(expr, offsetSec) ?? []),
    );
  const configured = jest.spyOn(client, 'configured', 'get').mockReturnValue(true);
  return () => {
    query.mockRestore();
    range.mockRestore();
    configured.mockRestore();
  };
}

export const sample = (value: number, labels: Record<string, string> = {}): PromSample => ({
  labels,
  value,
});
