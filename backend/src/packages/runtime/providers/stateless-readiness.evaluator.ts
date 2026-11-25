export type StatelessCheckStatus = 'pass' | 'warn' | 'fail';

export interface StatelessCheckItem {
  readonly key:
    | 'session_store'
    | 'object_storage'
    | 'shared_cache'
    | 'distributed_rate_limit'
    | 'stateless_chunked_upload'
    | 'scheduler_distributed_lock'
    | 'graceful_shutdown_draining';
  readonly status: StatelessCheckStatus;
  readonly detail: string;
}

export interface StatelessReadinessReport {
  readonly compliant: boolean;
  readonly status: 'ok' | 'degraded' | 'down';
  readonly environment: string;
  readonly instanceId: string;
  readonly runtimeState: string;
  readonly draining: boolean;
  readonly inFlightRequests: number;
  readonly drainDelayMs: number;
  readonly gracefulTimeoutMs: number;
  readonly checks: readonly StatelessCheckItem[];
}

export interface EvaluateStatelessReadinessInput {
  readonly environment: string;
  readonly instanceId: string;
  readonly runtimeState: string;
  readonly draining: boolean;
  readonly inFlightRequests: number;
  readonly storageDriver: 'local' | 's3';
  readonly allowLocalStorageInProd: boolean;
  readonly cacheDriver: 'redis' | 'memory';
  readonly allowMemoryCacheInProd: boolean;
  readonly redisReady: boolean;
  readonly databaseEnabled: boolean;
  readonly distributedRateLimitReady: boolean;
  readonly drainDelayMs: number;
  readonly gracefulTimeoutMs: number;
}

/**
 * Đánh giá mức độ sẵn sàng chạy không trạng thái (Stateless — Phase 13.1) theo 7 tiêu chí:
 * Session store, Object Storage, Shared Cache, Distributed Rate Limit, Stateless Chunked Upload,
 * Scheduler Distributed Lock, và Graceful Shutdown / Connection Draining.
 */
export function evaluateStatelessReadiness(
  input: EvaluateStatelessReadinessInput,
): StatelessReadinessReport {
  const isProd = input.environment === 'production';

  const sessionStatus: StatelessCheckStatus =
    input.redisReady || input.databaseEnabled ? 'pass' : 'warn';

  const storageStatus: StatelessCheckStatus =
    input.storageDriver === 's3'
      ? 'pass'
      : isProd && !input.allowLocalStorageInProd
        ? 'fail'
        : 'warn';

  const cacheStatus: StatelessCheckStatus =
    input.cacheDriver === 'redis'
      ? input.redisReady
        ? 'pass'
        : 'warn'
      : isProd && !input.allowMemoryCacheInProd
        ? 'fail'
        : 'warn';

  const rateLimitStatus: StatelessCheckStatus =
    input.distributedRateLimitReady || input.redisReady ? 'pass' : 'warn';

  const chunkUploadStatus: StatelessCheckStatus =
    input.cacheDriver === 'redis' && input.redisReady && input.storageDriver === 's3'
      ? 'pass'
      : storageStatus === 'fail' || cacheStatus === 'fail'
        ? 'fail'
        : 'warn';

  const schedulerLockStatus: StatelessCheckStatus = input.redisReady ? 'pass' : 'warn';

  const drainingStatus: StatelessCheckStatus =
    input.gracefulTimeoutMs >= 1000 && (!isProd || input.drainDelayMs > 0) ? 'pass' : 'warn';

  const checks: StatelessCheckItem[] = [
    {
      key: 'session_store',
      status: sessionStatus,
      detail:
        sessionStatus === 'pass'
          ? 'JWT + shared DB/Redis session store'
          : 'No shared DB/Redis store ready for session revocation',
    },
    {
      key: 'object_storage',
      status: storageStatus,
      detail:
        input.storageDriver === 's3'
          ? 'S3-compatible object storage active'
          : input.allowLocalStorageInProd
            ? 'Local disk explicitly allowed (single-server mode)'
            : 'Local disk storage active (non-HA across multiple nodes)',
    },
    {
      key: 'shared_cache',
      status: cacheStatus,
      detail:
        input.cacheDriver === 'redis'
          ? input.redisReady
            ? 'Redis shared cache + Pub/Sub invalidation ready'
            : 'Redis configured but client is not ready'
          : input.allowMemoryCacheInProd
            ? 'Memory cache explicitly allowed (single-server mode)'
            : 'In-memory cache driver active (per-process only)',
    },
    {
      key: 'distributed_rate_limit',
      status: rateLimitStatus,
      detail:
        rateLimitStatus === 'pass'
          ? 'Redis-backed distributed rate limit & login counter active'
          : 'Using per-process in-memory rate limit fallback',
    },
    {
      key: 'stateless_chunked_upload',
      status: chunkUploadStatus,
      detail:
        chunkUploadStatus === 'pass'
          ? 'Redis chunk session state + S3 stateless part assembly active'
          : 'Chunked upload uses local cache/storage fallback',
    },
    {
      key: 'scheduler_distributed_lock',
      status: schedulerLockStatus,
      detail:
        schedulerLockStatus === 'pass'
          ? 'Standalone scheduler + Redis distributed lock ready'
          : 'Redis unavailable for scheduler distributed lock',
    },
    {
      key: 'graceful_shutdown_draining',
      status: drainingStatus,
      detail: `drainDelayMs=${input.drainDelayMs}, gracefulTimeoutMs=${input.gracefulTimeoutMs}, state=${input.runtimeState}`,
    },
  ];

  const hasFail = checks.some((c) => c.status === 'fail');
  const hasWarn = checks.some((c) => c.status === 'warn');

  return {
    compliant: !hasFail && (!isProd || !hasWarn),
    status: hasFail ? 'down' : hasWarn ? 'degraded' : 'ok',
    environment: input.environment,
    instanceId: input.instanceId,
    runtimeState: input.runtimeState,
    draining: input.draining,
    inFlightRequests: input.inFlightRequests,
    drainDelayMs: input.drainDelayMs,
    gracefulTimeoutMs: input.gracefulTimeoutMs,
    checks,
  };
}
