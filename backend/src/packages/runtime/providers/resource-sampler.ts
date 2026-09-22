import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import * as os from 'node:os';
import {
  monitorEventLoopDelay,
  performance,
  PerformanceObserver,
  type IntervalHistogram,
} from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import type { RuntimeProcessInfo, RuntimeResources } from '../contracts/runtime.types.js';

const MB = 1024 * 1024;
const NS_PER_MS = 1e6;
const CGROUP_V2 = '/sys/fs/cgroup/memory.max';
const CGROUP_V1 = '/sys/fs/cgroup/memory/memory.limit_in_bytes';

const round = (n: number, digits = 1) => Number(n.toFixed(digits));

/** Giới hạn bộ nhớ của container (cgroup v2/v1); `null` nếu không giới hạn hoặc không chạy trong cgroup. */
export function readCgroupMemoryLimit(
  read: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): number | null {
  for (const path of [CGROUP_V2, CGROUP_V1]) {
    try {
      const raw = read(path).trim();
      if (raw === 'max') return null;
      const bytes = Number(raw);
      // cgroup v1 trả số rất lớn khi không giới hạn.
      if (Number.isFinite(bytes) && bytes > 0 && bytes < os.totalmem()) return bytes;
      return null;
    } catch {
      // thử đường dẫn tiếp theo
    }
  }
  return null;
}

/** CPU % của process trên toàn bộ số nhân (0–100) từ delta `process.cpuUsage()`. */
export function computeCpuPercent(
  cpuDeltaMicros: number,
  elapsedMs: number,
  cores: number,
): number {
  if (elapsedMs <= 0 || cores <= 0) return 0;
  return Math.min(100, Math.max(0, (cpuDeltaMicros / 1000 / elapsedMs / cores) * 100));
}

/** Số đo tài nguyên thật của process Node hiện tại. */
@Injectable()
export class ResourceSampler {
  private lastCpu = process.cpuUsage();
  private lastAt = performance.now();
  private histogram: IntervalHistogram | null = null;
  private gcObserver: PerformanceObserver | null = null;
  private gcPauseMs = 0;
  private gcCount = 0;
  private readonly cgroupLimit = readCgroupMemoryLimit();

  public start(): void {
    this.histogram = monitorEventLoopDelay({ resolution: 20 });
    this.histogram.enable();
    this.gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        this.gcPauseMs += entry.duration;
        this.gcCount++;
      }
    });
    this.gcObserver.observe({ entryTypes: ['gc'] });
  }

  public stop(): void {
    this.histogram?.disable();
    this.gcObserver?.disconnect();
  }

  /** Đọc số đo và reset các bộ đếm theo khoảng (CPU, event loop, GC). */
  public sample(): RuntimeResources {
    const now = performance.now();
    const cpu = process.cpuUsage(this.lastCpu);
    const cpuPercent = computeCpuPercent(
      cpu.user + cpu.system,
      now - this.lastAt,
      os.availableParallelism(),
    );
    this.lastCpu = process.cpuUsage();
    this.lastAt = now;

    const mem = process.memoryUsage();
    const limitBytes = this.cgroupLimit ?? getHeapStatistics().heap_size_limit;
    const usedForLimit = this.cgroupLimit ? mem.rss : mem.heapUsed;

    const resources: RuntimeResources = {
      cpuPercent: round(cpuPercent),
      rssMb: round(mem.rss / MB),
      heapUsedMb: round(mem.heapUsed / MB),
      heapTotalMb: round(mem.heapTotal / MB),
      externalMb: round(mem.external / MB),
      memoryLimitMb: round(limitBytes / MB),
      memoryLimitSource: this.cgroupLimit ? 'cgroup' : 'v8-heap',
      memoryPercent: round((usedForLimit / limitBytes) * 100),
      eventLoopMeanMs: this.histogram ? round(this.histogram.mean / NS_PER_MS, 2) : 0,
      eventLoopP99Ms: this.histogram ? round(this.histogram.percentile(99) / NS_PER_MS, 2) : 0,
      gcPauseMs: round(this.gcPauseMs, 2),
      gcCount: this.gcCount,
      activeHandles: process.getActiveResourcesInfo().length,
    };

    this.histogram?.reset();
    this.gcPauseMs = 0;
    this.gcCount = 0;
    return resources;
  }

  public processInfo(): RuntimeProcessInfo {
    let user = 'unknown';
    try {
      user = os.userInfo().username;
    } catch {
      // container không có /etc/passwd cho uid hiện tại
    }
    return {
      pid: process.pid,
      ppid: process.ppid,
      user,
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      execArgv: process.execArgv,
    };
  }
}
