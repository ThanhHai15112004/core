import { AppException } from '@packages/kernel/index.js';

export class TrafficValidationException extends AppException {
  public override readonly code = 'VALIDATION_FAILED';

  constructor(details: unknown[] = []) {
    super('VALIDATION_FAILED', 400, details);
  }
}

/** Redis không kết nối được. */
export class TrafficTelemetryUnavailableException extends AppException {
  public override readonly code = 'TRAFFIC_TELEMETRY_UNAVAILABLE';

  constructor() {
    super('traffic.error.telemetryUnavailable', 503);
  }
}

/** TRAFFIC_ENABLED=false — không thu thập. */
export class TrafficTelemetryDisabledException extends AppException {
  public override readonly code = 'TRAFFIC_TELEMETRY_DISABLED';

  constructor() {
    super('traffic.error.disabled', 503);
  }
}

export class TrafficRequestNotFoundException extends AppException {
  public override readonly code = 'TRAFFIC_REQUEST_NOT_FOUND';

  constructor(id: string) {
    super('traffic.error.requestNotFound', 404, [], { id });
  }
}

export class TrafficEndpointNotFoundException extends AppException {
  public override readonly code = 'TRAFFIC_ENDPOINT_NOT_FOUND';

  constructor(id: string) {
    super('traffic.error.endpointNotFound', 404, [], { id });
  }
}
