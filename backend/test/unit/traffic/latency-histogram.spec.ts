import { describe, it, expect } from '@jest/globals';
import {
  LATENCY_BUCKETS_MS,
  emptyHistogram,
  histogramIndex,
  histogramPercentile,
  mergeHistogram,
} from '@packages/traffic/index.js';

const histOf = (durations: number[]) => {
  const h = emptyHistogram();
  for (const d of durations) h[histogramIndex(d)]!++;
  return h;
};

describe('latency histogram', () => {
  it('đặt giá trị vào đúng ô, giá trị vượt cận trên lớn nhất vào ô cuối', () => {
    expect(histogramIndex(0)).toBe(0);
    expect(histogramIndex(5)).toBe(0);
    expect(histogramIndex(5.1)).toBe(1);
    expect(histogramIndex(999)).toBe(LATENCY_BUCKETS_MS.indexOf(1000));
    expect(histogramIndex(60_000)).toBe(LATENCY_BUCKETS_MS.length);
  });

  it('trả về null khi rỗng', () => {
    expect(histogramPercentile(emptyHistogram(), 95)).toBeNull();
  });

  it('P95 bắt được tail latency mà trung bình che mất', () => {
    const durations = [
      ...Array.from({ length: 90 }, () => 10),
      ...Array.from({ length: 10 }, () => 900),
    ];
    const hist = histOf(durations);
    expect(histogramPercentile(hist, 50)).toBeLessThanOrEqual(10);
    const p95 = histogramPercentile(hist, 95)!;
    expect(p95).toBeGreaterThan(500);
    expect(p95).toBeLessThanOrEqual(1000);
  });

  it('ô cuối không có cận trên → trả về cận dưới 10s', () => {
    expect(histogramPercentile(histOf([20_000, 30_000]), 99)).toBe(10_000);
  });

  it('gộp histogram của nhiều instance bằng cộng dồn', () => {
    const merged = mergeHistogram(histOf([1, 1]), histOf([1, 2000]));
    expect(merged[0]).toBe(3);
    expect(merged.reduce((a, b) => a + b, 0)).toBe(4);
  });
});
