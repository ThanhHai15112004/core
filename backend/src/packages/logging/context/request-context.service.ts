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
  userId?: string;
  /** Job đang xử lý (worker) — log trong lúc xử lý mang `jobId` để lọc theo job. */
  jobId?: string;
  source?: RequestSource;
  [key: string]: unknown;
}

@Injectable()
export class RequestContextService {
  private static readonly storage = new AsyncLocalStorage<RequestContextStore>();

  public run<R>(store: RequestContextStore, callback: () => R): R {
    return RequestContextService.storage.run(store, callback);
  }

  /** Dùng ở nơi không inject được (middleware dạng hàm). */
  public static runWith<R>(store: RequestContextStore, callback: () => R): R {
    return RequestContextService.storage.run(store, callback);
  }

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
}
