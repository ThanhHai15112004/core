import { AppException } from '@packages/kernel/index.js';

export class PerformanceValidationException extends AppException {
  public override readonly code = 'VALIDATION_FAILED';

  constructor(details: unknown[] = []) {
    super('VALIDATION_FAILED', 400, details);
  }
}

/** Prometheus chưa cấu hình (`PROMETHEUS_URL`) hoặc không trả lời — không đọc được số đo nào. */
export class PerformanceTelemetryUnavailableException extends AppException {
  public override readonly code = 'PERFORMANCE_TELEMETRY_UNAVAILABLE';

  constructor() {
    super('performance.error.telemetryUnavailable', 503);
  }
}

export class PerformanceComponentNotFoundException extends AppException {
  public override readonly code = 'PERFORMANCE_COMPONENT_NOT_FOUND';

  constructor(id: string) {
    super('performance.error.componentNotFound', 404, [], { id });
  }
}
