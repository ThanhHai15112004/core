import { RequestContextService, type RequestContextStore } from '@packages/logging/index.js';

type Timings = NonNullable<RequestContextStore['timings']>;

const timingsOf = (store: RequestContextStore): Timings =>
  (store.timings ??= { dbMs: 0, dbQueries: 0, cacheMs: 0, cacheOps: 0 });

/** Cộng thời gian của một thao tác DB/cache vào request HTTP hiện tại (nếu đang trong một request). */
export function addRequestTiming(kind: 'db' | 'cache', ms: number): void {
  const store = RequestContextService.current();
  if (!store) return;
  const t = timingsOf(store);
  if (kind === 'db') {
    t.dbMs += ms;
    t.dbQueries++;
  } else {
    t.cacheMs += ms;
    t.cacheOps++;
  }
}

/** Store của request hiện tại để đọc lại timings khi request kết thúc (ngoài async context). */
export function currentRequestStore(): RequestContextStore | undefined {
  return RequestContextService.current();
}
