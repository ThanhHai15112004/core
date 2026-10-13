import { readFileSync } from 'node:fs';
import { monitorEventLoopDelay, PerformanceObserver, performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import type { RuntimeResources } from '../contracts/runtime.types.js';

const MB = 1024 * 1024;
/** cgroup v1 báo "không giới hạn" bằng một số rất lớn (≈ 2^63, làm tròn theo trang). */
const CGROUP_V1_UNLIMITED = 2 ** 60;

const mb = (bytes: number) => Math.round((bytes / MB) * 10) / 10;
const ms1 = (v: number) => Math.round(v * 100) / 100;

/** Giới hạn RAM của container (cgroup v2 `memory.max`, v1 `memory.limit_in_bytes`); null = không giới hạn. */
export function cgroupMemoryLimit(read: (path: string) => string = readText): number | null {
  const v2 = read('/sys/fs/cgroup/memory.max').trim();
  if (v2) return v2 === 'max' ? null : positive(Number(v2));
  const v1 = Number(read('/sys/fs/cgroup/memory/memory.limit_in_bytes').trim());
  return Number.isFinite(v1) && v1 > 0 && v1 < CGROUP_V1_UNLIMITED ? v1 : null;
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

const positive = (n: number) => (Number.isFinite(n) && n > 0 ? n : null);

/**
 * Đo tài nguyên của process giữa hai lần `sample()`: CPU% (delta `process.cpuUsage()` / thời gian thực, 100% = một
 * core), độ trễ event loop (`monitorEventLoopDelay`), GC pause (`PerformanceObserver('gc')`), RAM so với giới hạn
 * cgroup — hoặc heap so với giới hạn V8 khi không chạy trong container có giới hạn.
 */
export class ResourceSampler {
  private readonly loop = monitorEventLoopDelay({ resolution: 20 });
  private readonly gcObserver: PerformanceObserver;
  private gc = { count: 0, totalMs: 0, maxMs: 0 };
  private cpu = { usage: process.cpuUsage(), at: performance.now() };
  private readonly cgroupLimit: number | null;

  constructor(cgroupLimit: number | null = cgroupMemoryLimit()) {
    this.cgroupLimit = cgroupLimit;
    this.gcObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        this.gc.count++;
        this.gc.totalMs += e.duration;
        this.gc.maxMs = Math.max(this.gc.maxMs, e.duration);
      }
    });
  }

  public start(): void {
    this.loop.enable();
    this.gcObserver.observe({ entryTypes: ['gc'] });
    this.cpu = { usage: process.cpuUsage(), at: performance.now() };
  }

  public stop(): void {
    this.loop.disable();
    this.gcObserver.disconnect();
  }

  /** Số đo kể từ lần gọi trước (lần đầu: kể từ `start()`), rồi đặt lại bộ đếm. */
  public sample(): RuntimeResources {
    const now = performance.now();
    const usage = process.cpuUsage(this.cpu.usage);
    const elapsedUs = Math.max(1, (now - this.cpu.at) * 1000);
    this.cpu = { usage: process.cpuUsage(), at: now };
    const cpuPercent = Math.round(((usage.user + usage.system) / elapsedUs) * 1000) / 10;

    // Histogram tính bằng nano giây; chưa có mẫu nào → NaN.
    const loopMean = this.loop.count > 0 ? ms1(this.loop.mean / 1e6) : null;
    const loopP99 = this.loop.count > 0 ? ms1(this.loop.percentile(99) / 1e6) : null;
    this.loop.reset();
    const gc = this.gc;
    this.gc = { count: 0, totalMs: 0, maxMs: 0 };

    const mem = process.memoryUsage();
    const heapLimit = getHeapStatistics().heap_size_limit;
    const limit = this.cgroupLimit ?? heapLimit;
    const used = this.cgroupLimit !== null ? mem.rss : mem.heapUsed;
    return {
      cpuPercent,
      rssMb: mb(mem.rss),
      heapUsedMb: mb(mem.heapUsed),
      heapTotalMb: mb(mem.heapTotal),
      externalMb: mb(mem.external),
      memoryLimitMb: mb(limit),
      memoryLimitSource: this.cgroupLimit !== null ? 'cgroup' : 'v8-heap',
      memoryPercent: Math.round((used / limit) * 1000) / 10,
      eventLoopMeanMs: loopMean,
      eventLoopP99Ms: loopP99,
      gcPauseMs: ms1(gc.totalMs),
      gcCount: gc.count,
      gcMaxPauseMs: ms1(gc.maxMs),
      activeHandles:
        (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.()
          ?.length ?? 0,
    };
  }
}
