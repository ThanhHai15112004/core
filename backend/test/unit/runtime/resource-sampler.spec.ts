import { describe, it, expect } from '@jest/globals';
import * as os from 'node:os';
import {
  computeCpuPercent,
  readCgroupMemoryLimit,
  ResourceSampler,
} from '@packages/runtime/index.js';

describe('ResourceSampler helpers', () => {
  it('computes CPU percent across cores', () => {
    // 500ms CPU trong 1s trên 2 nhân = 25%
    expect(computeCpuPercent(500_000, 1000, 2)).toBe(25);
    expect(computeCpuPercent(10_000_000, 1000, 1)).toBe(100);
    expect(computeCpuPercent(1000, 0, 4)).toBe(0);
  });

  it('reads cgroup v2 limit and treats "max" as unlimited', () => {
    const limit = 512 * 1024 * 1024;
    expect(readCgroupMemoryLimit(() => String(limit))).toBe(limit);
    expect(readCgroupMemoryLimit(() => 'max')).toBeNull();
  });

  it('treats a cgroup v1 "unlimited" huge value as no limit', () => {
    expect(readCgroupMemoryLimit(() => String(os.totalmem() * 1000))).toBeNull();
  });

  it('returns null when cgroup files are missing', () => {
    expect(
      readCgroupMemoryLimit(() => {
        throw new Error('ENOENT');
      }),
    ).toBeNull();
  });

  it('samples real process resources', () => {
    const sampler = new ResourceSampler();
    sampler.start();
    const r = sampler.sample();
    sampler.stop();
    expect(r.rssMb).toBeGreaterThan(0);
    expect(r.memoryLimitMb).toBeGreaterThan(0);
    expect(r.memoryPercent).toBeGreaterThan(0);
    expect(sampler.processInfo().pid).toBe(process.pid);
  });
});
