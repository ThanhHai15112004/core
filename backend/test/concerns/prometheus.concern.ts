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
  /** Trả chuỗi cho range query; mặc định không có dữ liệu. */
  range?: (expr: string) => PromSeries[];
}

/**
 * Test Concern: stubPrometheus
 * Thay `query`/`range` của PrometheusQueryClient trong app test bằng dữ liệu cố định — test không cần Prometheus
 * thật. `value`/`safeQuery`/`safeRange` đi qua hai hàm này nên cũng nhận dữ liệu giả. Trả về hàm khôi phục.
 */
export function stubPrometheus(app: INestApplication, fixture: PrometheusFixture): () => void {
  const client = app.get(PrometheusQueryClient);
  const query = jest
    .spyOn(client, 'query')
    .mockImplementation((expr: string) => Promise.resolve(fixture.query(expr)));
  const range = jest
    .spyOn(client, 'range')
    .mockImplementation((expr: string) => Promise.resolve(fixture.range?.(expr) ?? []));
  return () => {
    query.mockRestore();
    range.mockRestore();
  };
}

export const sample = (value: number, labels: Record<string, string> = {}): PromSample => ({
  labels,
  value,
});
