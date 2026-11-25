import { AppException, type MessageParams } from '@packages/kernel/index.js';

export class IncidentPolicyNotFoundException extends AppException {
  public override readonly code = 'INCIDENT_POLICY_NOT_FOUND';

  constructor(severity: string, params?: MessageParams) {
    super('incidentsOps.error.policyNotFound', 404, [], params ?? { severity });
  }
}

export class IncidentRunbookNotFoundException extends AppException {
  public override readonly code = 'INCIDENT_RUNBOOK_NOT_FOUND';

  constructor(id: number, params?: MessageParams) {
    super('incidentsOps.error.runbookNotFound', 404, [], params ?? { id });
  }
}

export class IncidentRunbookCodeDuplicateException extends AppException {
  public override readonly code = 'INCIDENT_RUNBOOK_CODE_DUPLICATE';

  constructor(code: string, params?: MessageParams) {
    super('incidentsOps.error.runbookCodeDuplicate', 409, [], params ?? { code });
  }
}

export class AlertOwnerMappingNotFoundException extends AppException {
  public override readonly code = 'ALERT_OWNER_MAPPING_NOT_FOUND';

  constructor(id: number, params?: MessageParams) {
    super('incidentsOps.error.ownerMappingNotFound', 404, [], params ?? { id });
  }
}

export class AlertOwnerMappingDuplicateException extends AppException {
  public override readonly code = 'ALERT_OWNER_MAPPING_DUPLICATE';

  constructor(alertCode: string, params?: MessageParams) {
    super('incidentsOps.error.ownerMappingDuplicate', 409, [], params ?? { alertCode });
  }
}

export class AlertOwnerRequiredException extends AppException {
  public override readonly code = 'ALERT_OWNER_REQUIRED';

  constructor() {
    super('incidentsOps.error.ownerRequired', 400, []);
  }
}

export class IncidentNotFoundException extends AppException {
  public override readonly code = 'INCIDENT_NOT_FOUND';

  constructor(id: number, params?: MessageParams) {
    super('incidentsOps.error.incidentNotFound', 404, [], params ?? { id });
  }
}

export class IncidentPostmortemNotFoundException extends AppException {
  public override readonly code = 'INCIDENT_POSTMORTEM_NOT_FOUND';

  constructor(incidentId: number, params?: MessageParams) {
    super('incidentsOps.error.postmortemNotFound', 404, [], params ?? { incidentId });
  }
}

export class IncidentInvalidTransitionException extends AppException {
  public override readonly code = 'INCIDENT_INVALID_STATUS_TRANSITION';

  constructor(from: string, to: string) {
    super('incidentsOps.error.invalidStatusTransition', 409, [], { from, to });
  }
}

export class IncidentRootCauseRequiredException extends AppException {
  public override readonly code = 'INCIDENT_ROOT_CAUSE_REQUIRED';

  constructor() {
    super('incidentsOps.error.rootCauseRequired', 400, []);
  }
}

export class InvalidSiemEndpointException extends AppException {
  public override readonly code = 'INVALID_SIEM_ENDPOINT';

  constructor() {
    super('incidentsOps.error.invalidSiemEndpoint', 400, []);
  }
}
