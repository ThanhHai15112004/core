import type { LogEntry } from '@packages/logging/index.js';
import type { LogRowDto } from '../responses/logs-ops.response.js';

/** Log đã lưu → dòng Explorer (không metadata / stack). */
export function logRow(e: LogEntry): LogRowDto {
  const status = e.metadata?.status;
  return {
    id: e.id ?? '',
    at: e.t,
    level: e.level,
    runtime: e.runtime ?? null,
    instance: e.instance ?? null,
    module: e.context ?? null,
    message: e.message,
    correlationId: e.correlationId ?? null,
    requestId: e.requestId ?? null,
    jobId: e.jobId ?? null,
    jobType: e.jobType ?? null,
    messageId: e.messageId ?? null,
    executionId: e.executionId ?? null,
    userId: e.userId ?? null,
    route: e.route ?? null,
    errorType: e.errorType ?? null,
    errorCode: e.errorCode ?? null,
    durationMs: typeof e.durationMs === 'number' ? e.durationMs : null,
    status: typeof status === 'number' ? status : null,
    fingerprint: e.fingerprint ?? null,
    hasStack: Boolean(e.stack),
    hasMetadata: Boolean(e.metadata && Object.keys(e.metadata).length),
  };
}
