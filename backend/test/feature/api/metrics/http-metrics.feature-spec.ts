import { describe, beforeAll, afterAll, it, expect } from '@jest/globals';
import { createTestApp, type TestAppContext } from '../../../concerns/test-app.concern.js';

/** Đếm `http_request_duration_seconds_count` của một bộ nhãn trong output `/metrics`. */
function countOf(body: string, labels: Record<string, string>): number {
  const line = body
    .split('\n')
    .find(
      (l) =>
        l.startsWith('http_request_duration_seconds_count{') &&
        Object.entries(labels).every(([k, v]) => l.includes(`${k}="${v}"`)),
    );
  return line ? Number(line.split(' ').at(-1)) : 0;
}

/**
 * Metric HTTP ghi ở hook Fastify `onResponse`, nên thấy cả response mà interceptor của Nest bỏ sót:
 * 404 không khớp route nào và 400 do validation.
 */
describe('HTTP metrics (/metrics)', () => {
  let context: TestAppContext;

  const scrape = async () => (await context.app.inject({ method: 'GET', url: '/metrics' })).body;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.close();
  });

  it('404 không khớp route → route="unmatched"', async () => {
    const before = countOf(await scrape(), { route: 'unmatched', status: '404' });
    const res = await context.app.inject({ method: 'GET', url: '/no/such/route' });
    expect(res.statusCode).toBe(404);
    expect(countOf(await scrape(), { method: 'GET', route: 'unmatched', status: '404' })).toBe(
      before + 1,
    );
  });

  it('400 validation và 200 được đếm theo template route', async () => {
    const bad = await context.app.inject({ method: 'GET', url: '/ops/traffic/summary?range=2d' });
    expect(bad.statusCode).toBe(400);
    await context.app.inject({ method: 'GET', url: '/health' });
    const body = await scrape();
    expect(countOf(body, { route: '/ops/traffic/summary', status: '400' })).toBeGreaterThanOrEqual(
      1,
    );
    expect(countOf(body, { route: '/health', status: '200' })).toBeGreaterThanOrEqual(1);
    // Chính /metrics không bị đếm.
    expect(body).not.toContain('route="/metrics"');
  });
});
