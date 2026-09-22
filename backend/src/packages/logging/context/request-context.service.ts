import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

export interface RequestContextStore {
  correlationId: string;
  userId?: string;
  [key: string]: unknown;
}

@Injectable()
export class RequestContextService {
  private static readonly storage = new AsyncLocalStorage<RequestContextStore>();

  public run<R>(store: RequestContextStore, callback: () => R): R {
    return RequestContextService.storage.run(store, callback);
  }

  public getStore(): RequestContextStore | undefined {
    return RequestContextService.storage.getStore();
  }

  /** Dùng ở nơi không inject được (vd. logger khởi tạo sớm). */
  public static currentCorrelationId(): string | undefined {
    return RequestContextService.storage.getStore()?.correlationId;
  }

  public getCorrelationId(): string {
    return this.getStore()?.correlationId ?? 'unknown-correlation-id';
  }
}
