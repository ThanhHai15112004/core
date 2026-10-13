import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../services/api';
import { QUERY_RETRY_COUNT, QUERY_STALE_MS } from '../constants/ui.constants';

/** Lỗi 4xx không retry (sai tham số / không có quyền / không tồn tại) — retry chỉ cho lỗi mạng & 5xx. */
const shouldRetry = (failureCount: number, error: unknown) =>
  failureCount < QUERY_RETRY_COUNT && !(error instanceof ApiError && error.status >= 400 && error.status < 500);

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: QUERY_STALE_MS,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
