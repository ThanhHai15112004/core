import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

/**
 * Công việc đang chạy trong context này (để job được tạo ra biết nguồn của nó): HTTP request, lần chạy Scheduler,
 * job khác (worker), hoặc lệnh CLI.
 */
export interface RequestSource {
  kind: 'http' | 'scheduler' | 'job' | 'cli';
  /** request ID / execution ID / job ID. */
  id: string | null;
  /** `POST /api/v1/reports`, task ID, loại job… */
  name: string | null;
  /** Thông tin phụ: queue của job cha. */
  detail?: string | null;
}

export interface RequestContextStore {
  correlationId: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  module?: string;
  action?: string;
  startedAt?: number;
  userId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  actor?: unknown;
  /** Job đang xử lý (worker) — log trong lúc xử lý mang `jobId` để lọc theo job. */
  jobId?: string;
  source?: RequestSource;
  [key: string]: unknown;
}

@Injectable()
export class RequestContextService {
  private static readonly storage = new AsyncLocalStorage<RequestContextStore>();

  /** Thực thi thao tác vận hành với cơ chế theo dõi và xử lý lỗi */
  public run<R>(store: RequestContextStore, callback: () => R): R {
    return RequestContextService.storage.run(store, callback);
  }

  /** Dùng ở nơi không inject được (middleware dạng hàm). */
  public static runWith<R>(store: RequestContextStore, callback: () => R): R {
    return RequestContextService.storage.run(store, callback);
  }

  /** Chạy hàm con với ngữ cảnh log bổ sung (`module`, `action`, `traceId`) kế thừa store hiện tại. */
  public static withLogContext<R>(
    patch: Partial<Pick<RequestContextStore, 'module' | 'action' | 'traceId'>>,
    callback: () => R,
  ): R {
    const parent = RequestContextService.storage.getStore();
    const nextStore: RequestContextStore = parent
      ? { ...parent, ...patch }
      : { correlationId: patch.traceId ?? 'internal', ...patch };
    return RequestContextService.storage.run(nextStore, callback);
  }

  /** Lấy kho lưu trữ ngữ cảnh bất đồng bộ (AsyncLocalStorage) hiện tại */
  public getStore(): RequestContextStore | undefined {
    return RequestContextService.storage.getStore();
  }

  /** Store của request hiện tại cho code không inject được (instrumentation DB/cache). */
  public static current(): RequestContextStore | undefined {
    return RequestContextService.storage.getStore();
  }

  /** Dùng ở nơi không inject được (vd. logger khởi tạo sớm). */
  public static currentCorrelationId(): string | undefined {
    return RequestContextService.storage.getStore()?.correlationId;
  }

  /** Lấy `traceId` từ AsyncLocalStorage hiện tại (nếu có). */
  public static currentTraceId(): string | undefined {
    return RequestContextService.storage.getStore()?.traceId;
  }

  /** Lấy `spanId` từ AsyncLocalStorage hiện tại (nếu có). */
  public static currentSpanId(): string | undefined {
    return RequestContextService.storage.getStore()?.spanId;
  }
}
