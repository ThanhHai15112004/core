export const WORKFLOWS_ROUTES = {
  ROOT: 'workflows',
  DEFINITIONS: 'definitions',
  DEFINITION_BY_ID: 'definitions/:id',
  DEFINITION_NEW_VERSION: 'definitions/:id/new-version',
  DEFINITION_STATES: 'definitions/:id/states',
  DEFINITION_TRANSITIONS: 'definitions/:id/transitions',
  INSTANCES: 'instances',
  INSTANCE_BY_ID: 'instances/:id',
  INSTANCE_START: 'instances/start',
  INSTANCE_TRANSITION: 'instances/:id/transition',
  INSTANCE_APPROVE: 'instances/:id/approve',
  INSTANCE_DELEGATE: 'instances/:id/delegate',
  INSTANCE_CANCEL: 'instances/:id/cancel',
  INSTANCE_HISTORIES: 'instances/:id/histories',
  SLA_SCAN_OVERDUE: 'sla/scan-overdue',
} as const;

export const WORKFLOW_DEFINITION_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
  DRAFT: 3,
  ARCHIVED: 4,
} as const;

export type WorkflowDefinitionStatusCode =
  (typeof WORKFLOW_DEFINITION_STATUS)[keyof typeof WORKFLOW_DEFINITION_STATUS];

export type WorkflowDefinitionStatusName = 'ACTIVE' | 'INACTIVE' | 'DRAFT' | 'ARCHIVED';

export const WORKFLOW_INSTANCE_STATUS = {
  RUNNING: 1,
  COMPLETED: 2,
  REJECTED: 3,
  CANCELLED: 4,
  EXPIRED: 5,
} as const;

export type WorkflowInstanceStatusCode =
  (typeof WORKFLOW_INSTANCE_STATUS)[keyof typeof WORKFLOW_INSTANCE_STATUS];

export type WorkflowInstanceStatusName =
  'RUNNING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

export const WORKFLOW_STATE_TYPE = {
  INITIAL: 'INITIAL',
  INTERMEDIATE: 'INTERMEDIATE',
  FINAL_APPROVED: 'FINAL_APPROVED',
  FINAL_REJECTED: 'FINAL_REJECTED',
  CANCELLED: 'CANCELLED',
} as const;

export type WorkflowStateType = (typeof WORKFLOW_STATE_TYPE)[keyof typeof WORKFLOW_STATE_TYPE];

export const WORKFLOW_APPROVAL_MODE = {
  SINGLE: 'SINGLE',
  ALL: 'ALL',
  ANY: 'ANY',
  SEQUENTIAL_CHAIN: 'SEQUENTIAL_CHAIN',
} as const;

export type WorkflowApprovalMode =
  (typeof WORKFLOW_APPROVAL_MODE)[keyof typeof WORKFLOW_APPROVAL_MODE];

export const WORKFLOW_APPROVAL_DECISION = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  RETURNED: 'RETURNED',
  SKIPPED: 'SKIPPED',
} as const;

export type WorkflowApprovalDecision =
  (typeof WORKFLOW_APPROVAL_DECISION)[keyof typeof WORKFLOW_APPROVAL_DECISION];

export const WORKFLOW_HISTORY_ACTION_TYPE = {
  START: 'START',
  TRANSITION: 'TRANSITION',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  RETURN: 'RETURN',
  DELEGATE: 'DELEGATE',
  CANCEL: 'CANCEL',
  TERMINATE: 'TERMINATE',
  SLA_WARNING: 'SLA_WARNING',
  SLA_OVERDUE: 'SLA_OVERDUE',
} as const;

export type WorkflowHistoryActionType =
  (typeof WORKFLOW_HISTORY_ACTION_TYPE)[keyof typeof WORKFLOW_HISTORY_ACTION_TYPE];

export const WORKFLOWS_CODE_TYPES = {
  DEFINITION_STATUS: 'workflows.definition_status',
  INSTANCE_STATUS: 'workflows.instance_status',
} as const;

export const WORKFLOWS_SETTING_KEYS = {
  PAGINATION_PREFIX: 'workflows.pagination',
  SLA_DEFAULT_HOURS: 'workflows.sla.default_hours',
  SLA_WARNING_BEFORE_MINUTES: 'workflows.sla.warning_before_minutes',
} as const;

export const WORKFLOWS_AUDIT_META = {
  MODULE: 'workflows',
  FEATURES: {
    DEFINITION: 'workflow_definition',
    INSTANCE: 'workflow_instance',
    APPROVAL: 'workflow_approval',
    SLA: 'workflow_sla',
  },
  RESOURCE_TYPES: {
    DEFINITION: 'workflow_definition',
    INSTANCE: 'workflow_instance',
  },
} as const;
