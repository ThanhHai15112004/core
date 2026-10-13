import { describe, it, expect } from '@jest/globals';
import { ResourceSampler, cgroupMemoryLimit } from '@packages/runtime/index.js';

const files = (map: Record<string, string>) => (path: string) => map[path] ?? '';

describe('cgroupMemoryLimit', () => {
  it('cgroup v2: số byte → giới hạn; "max" → không giới hạn', () => {
    expect(cgroupMemoryLimit(files({ '/sys/fs/cgroup/memory.max': '536870912\n' }))).toBe(
      536870912,
    );
    expect(cgroupMemoryLimit(files({ '/sys/fs/cgroup/memory.max': 'max\n' }))).toBeNull();
  });

  it('cgroup v1: số rất lớn = không giới hạn; không có cgroup → null', () => {
    const v1 = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
    expect(cgroupMemoryLimit(files({ [v1]: '268435456' }))).toBe(268435456);
    expect(cgroupMemoryLimit(files({ [v1]: '9223372036854771712' }))).toBeNull();
    expect(cgroupMemoryLimit(files({}))).toBeNull();
  });
});

describe('ResourceSampler', () => {
  it('CPU% theo delta giữa hai lần đo; RAM so với giới hạn cgroup', () => {
    const sampler = new ResourceSampler(1024 * 1024 * 1024);
    sampler.start();
    const until = Date.now() + 30;
    while (Date.now() < until) Math.sqrt(Math.random()); // bận CPU một chút
    const r = sampler.sample();
    sampler.stop();
    expect(r.cpuPercent).toBeGreaterThan(0);
    expect(r.memoryLimitSource).toBe('cgroup');
    expect(r.memoryLimitMb).toBe(1024);
    expect(r.memoryPercent).toBeCloseTo((r.rssMb / 1024) * 100, 0);
  });

  it('không có cgroup → so heap với giới hạn heap của V8', () => {
    const sampler = new ResourceSampler(null);
    sampler.start();
    const r = sampler.sample();
    sampler.stop();
    expect(r.memoryLimitSource).toBe('v8-heap');
    expect(r.memoryLimitMb).toBeGreaterThan(r.heapUsedMb);
    expect(r.memoryPercent).toBeGreaterThan(0);
  });
});
