import { Injectable, Logger } from '@nestjs/common';
import type {
  ConcurrencyLimiterSnapshot,
  HttpConcurrencyPolicy,
  HttpMethod,
} from '../contracts/http-client.contract.js';
import { HttpConcurrencyLimitError } from '../errors/http-client.errors.js';

interface Waiter {
  readonly resolve: (release: () => void) => void;
  readonly reject: (err: Error) => void;
  readonly timer: NodeJS.Timeout;
  readonly cleanupAbort: () => void;
}

interface BulkheadState {
  inFlight: number;
  peakInFlight: number;
  totalRejected: number;
  queue: Waiter[];
  policy: HttpConcurrencyPolicy;
}

const DEFAULT_CONCURRENCY_POLICY: HttpConcurrencyPolicy = {
  enabled: true,
  maxConcurrent: 20,
  maxQueue: 0,
  queueTimeoutMs: 2_000,
};

/**
 * Bulkhead / Concurrency Limiter theo từng dịch vụ ngoài (Provider):
 * Giới hạn số request đang thực thi đồng thời (`inFlight <= maxConcurrent`), hỗ trợ hàng đợi có biên (`maxQueue`)
 * và từ chối nhanh (`HttpConcurrencyLimitError`) để không làm quá tải hệ thống bên ngoài.
 */
@Injectable()
export class ConcurrencyLimiterRegistry {
  private readonly logger = new Logger(ConcurrencyLimiterRegistry.name);
  private readonly limiters = new Map<string, BulkheadState>();

  /** Giành 1 slot đồng thời cho dịch vụ; trả về hàm `release()` bắt buộc gọi trong `finally`. */
  public async acquire(
    service: string,
    policy: HttpConcurrencyPolicy,
    method: HttpMethod,
    redactedUrl: string,
    signal?: AbortSignal,
  ): Promise<{ readonly release: () => void; readonly inFlight: number }> {
    const entry = this.getOrCreate(service, policy);
    entry.policy = policy;

    if (!policy.enabled || policy.maxConcurrent <= 0) {
      entry.inFlight += 1;
      if (entry.inFlight > entry.peakInFlight) entry.peakInFlight = entry.inFlight;
      return {
        release: this.createRelease(service, entry),
        inFlight: entry.inFlight,
      };
    }

    if (entry.inFlight < policy.maxConcurrent) {
      entry.inFlight += 1;
      if (entry.inFlight > entry.peakInFlight) entry.peakInFlight = entry.inFlight;
      return {
        release: this.createRelease(service, entry),
        inFlight: entry.inFlight,
      };
    }

    if (policy.maxQueue <= 0 || entry.queue.length >= policy.maxQueue) {
      entry.totalRejected += 1;
      this.logger.warn(
        `[Bulkhead] Rejected ${method} ${redactedUrl} for service "${service}" (${entry.inFlight}/${policy.maxConcurrent} in-flight, queued=${entry.queue.length}/${policy.maxQueue})`,
      );
      throw new HttpConcurrencyLimitError({
        service,
        method,
        url: redactedUrl,
        maxConcurrent: policy.maxConcurrent,
        inFlight: entry.inFlight,
        queued: entry.queue.length,
        reason: 'limit_exceeded',
      });
    }

    if (signal?.aborted) {
      entry.totalRejected += 1;
      throw new HttpConcurrencyLimitError({
        service,
        method,
        url: redactedUrl,
        maxConcurrent: policy.maxConcurrent,
        inFlight: entry.inFlight,
        queued: entry.queue.length,
        reason: 'aborted',
      });
    }

    const release = await new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(
          () => {
            const idx = entry.queue.indexOf(waiter);
            if (idx >= 0) entry.queue.splice(idx, 1);
            waiter.cleanupAbort();
            entry.totalRejected += 1;
            reject(
              new HttpConcurrencyLimitError({
                service,
                method,
                url: redactedUrl,
                maxConcurrent: policy.maxConcurrent,
                inFlight: entry.inFlight,
                queued: entry.queue.length,
                reason: 'queue_timeout',
              }),
            );
          },
          Math.max(50, policy.queueTimeoutMs),
        ),
        cleanupAbort: () => undefined,
      };
      waiter.timer.unref?.();

      if (signal) {
        const onAbort = () => {
          clearTimeout(waiter.timer);
          const idx = entry.queue.indexOf(waiter);
          if (idx >= 0) entry.queue.splice(idx, 1);
          entry.totalRejected += 1;
          reject(
            new HttpConcurrencyLimitError({
              service,
              method,
              url: redactedUrl,
              maxConcurrent: policy.maxConcurrent,
              inFlight: entry.inFlight,
              queued: entry.queue.length,
              reason: 'aborted',
            }),
          );
        };
        signal.addEventListener('abort', onAbort, { once: true });
        (waiter as { cleanupAbort: () => void }).cleanupAbort = () =>
          signal.removeEventListener('abort', onAbort);
      }

      entry.queue.push(waiter);
    });

    return { release, inFlight: entry.inFlight };
  }

  /** Lấy số lượng request đang thực thi (in-flight) hiện tại của dịch vụ. */
  public getInFlight(service: string): number {
    return this.limiters.get(service)?.inFlight ?? 0;
  }

  /** Ảnh chụp trạng thái bulkhead của một dịch vụ. */
  public getSnapshot(
    service: string,
    policy?: HttpConcurrencyPolicy,
  ): ConcurrencyLimiterSnapshot | undefined {
    const entry = this.limiters.get(service);
    if (!entry) return undefined;
    return this.toSnapshot(service, entry, policy ?? entry.policy);
  }

  /** Liệt kê ảnh chụp trạng thái bulkhead của toàn bộ các dịch vụ đang theo dõi. */
  public listSnapshots(): ConcurrencyLimiterSnapshot[] {
    const out: ConcurrencyLimiterSnapshot[] = [];
    for (const [service, entry] of this.limiters.entries()) {
      out.push(this.toSnapshot(service, entry, entry.policy));
    }
    return out;
  }

  private createRelease(service: string, entry: BulkheadState): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.inFlight = Math.max(0, entry.inFlight - 1);
      this.drainQueue(service, entry);
    };
  }

  private drainQueue(service: string, entry: BulkheadState): void {
    while (entry.queue.length > 0 && entry.inFlight < entry.policy.maxConcurrent) {
      const next = entry.queue.shift();
      if (!next) break;
      clearTimeout(next.timer);
      next.cleanupAbort();
      entry.inFlight += 1;
      if (entry.inFlight > entry.peakInFlight) entry.peakInFlight = entry.inFlight;
      next.resolve(this.createRelease(service, entry));
    }
  }

  private getOrCreate(service: string, policy: HttpConcurrencyPolicy): BulkheadState {
    let entry = this.limiters.get(service);
    if (!entry) {
      entry = {
        inFlight: 0,
        peakInFlight: 0,
        totalRejected: 0,
        queue: [],
        policy: policy ?? DEFAULT_CONCURRENCY_POLICY,
      };
      this.limiters.set(service, entry);
    }
    return entry;
  }

  private toSnapshot(
    service: string,
    entry: BulkheadState,
    policy: HttpConcurrencyPolicy,
  ): ConcurrencyLimiterSnapshot {
    return {
      service,
      enabled: policy.enabled,
      inFlight: entry.inFlight,
      maxConcurrent: policy.maxConcurrent,
      queued: entry.queue.length,
      maxQueue: policy.maxQueue,
      peakInFlight: entry.peakInFlight,
      totalRejected: entry.totalRejected,
    };
  }
}
