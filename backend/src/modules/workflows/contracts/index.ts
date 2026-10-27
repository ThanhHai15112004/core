import { defaultCodeRegistry } from '@packages/kernel/index.js';
import {
  WORKFLOWS_AUDIT_META,
  WORKFLOWS_CODE_TYPES,
  WORKFLOWS_ROUTES,
  WORKFLOWS_SETTING_KEYS,
  WORKFLOW_APPROVAL_DECISION,
  WORKFLOW_APPROVAL_MODE,
  WORKFLOW_DEFINITION_STATUS,
  WORKFLOW_HISTORY_ACTION_TYPE,
  WORKFLOW_INSTANCE_STATUS,
  WORKFLOW_STATE_TYPE,
  type WorkflowApprovalDecision,
  type WorkflowApprovalMode,
  type WorkflowDefinitionStatusCode,
  type WorkflowDefinitionStatusName,
  type WorkflowHistoryActionType,
  type WorkflowInstanceStatusCode,
  type WorkflowInstanceStatusName,
  type WorkflowStateType,
} from '../enum/workflows.enum.js';
import type {
  AvailableWorkflowTransitionView,
  WorkflowApprovalStepItemView,
  WorkflowConditionOperator,
  WorkflowDefinitionItemView,
  WorkflowFieldConditionRule,
  WorkflowHistoryItemView,
  WorkflowInstanceDetailView,
  WorkflowInstanceItemView,
  WorkflowSlaScanResultView,
  WorkflowStateApprovalConfig,
  WorkflowStateItemView,
  WorkflowTransitionActionConfig,
  WorkflowTransitionActionType,
  WorkflowTransitionConditions,
  WorkflowTransitionItemView,
  WorkflowTriggeredActionResult,
} from '../types/workflows.types.js';

export {
  WORKFLOWS_AUDIT_META,
  WORKFLOWS_CODE_TYPES,
  WORKFLOWS_ROUTES,
  WORKFLOWS_SETTING_KEYS,
  WORKFLOW_APPROVAL_DECISION,
  WORKFLOW_APPROVAL_MODE,
  WORKFLOW_DEFINITION_STATUS,
  WORKFLOW_HISTORY_ACTION_TYPE,
  WORKFLOW_INSTANCE_STATUS,
  WORKFLOW_STATE_TYPE,
  type WorkflowApprovalDecision,
  type WorkflowApprovalMode,
  type WorkflowDefinitionStatusCode,
  type WorkflowDefinitionStatusName,
  type WorkflowHistoryActionType,
  type WorkflowInstanceStatusCode,
  type WorkflowInstanceStatusName,
  type WorkflowStateType,
  type AvailableWorkflowTransitionView,
  type WorkflowApprovalStepItemView,
  type WorkflowConditionOperator,
  type WorkflowDefinitionItemView,
  type WorkflowFieldConditionRule,
  type WorkflowHistoryItemView,
  type WorkflowInstanceDetailView,
  type WorkflowInstanceItemView,
  type WorkflowSlaScanResultView,
  type WorkflowStateApprovalConfig,
  type WorkflowStateItemView,
  type WorkflowTransitionActionConfig,
  type WorkflowTransitionActionType,
  type WorkflowTransitionConditions,
  type WorkflowTransitionItemView,
  type WorkflowTriggeredActionResult,
};

export function parseWorkflowDefinitionStatus(val: unknown): WorkflowDefinitionStatusCode {
  const resolved = defaultCodeRegistry.parseToNumericCode(
    WORKFLOWS_CODE_TYPES.DEFINITION_STATUS,
    val,
    WORKFLOW_DEFINITION_STATUS.ACTIVE,
  );
  if (
    resolved === WORKFLOW_DEFINITION_STATUS.ACTIVE ||
    resolved === WORKFLOW_DEFINITION_STATUS.INACTIVE ||
    resolved === WORKFLOW_DEFINITION_STATUS.DRAFT ||
    resolved === WORKFLOW_DEFINITION_STATUS.ARCHIVED
  ) {
    return resolved;
  }
  return WORKFLOW_DEFINITION_STATUS.ACTIVE;
}

export function getWorkflowDefinitionStatusName(code: number): WorkflowDefinitionStatusName {
  switch (code) {
    case WORKFLOW_DEFINITION_STATUS.INACTIVE:
      return 'INACTIVE';
    case WORKFLOW_DEFINITION_STATUS.DRAFT:
      return 'DRAFT';
    case WORKFLOW_DEFINITION_STATUS.ARCHIVED:
      return 'ARCHIVED';
    default:
      return 'ACTIVE';
  }
}

export function parseWorkflowInstanceStatus(val: unknown): WorkflowInstanceStatusCode {
  const resolved = defaultCodeRegistry.parseToNumericCode(
    WORKFLOWS_CODE_TYPES.INSTANCE_STATUS,
    val,
    WORKFLOW_INSTANCE_STATUS.RUNNING,
  );
  if (
    resolved === WORKFLOW_INSTANCE_STATUS.RUNNING ||
    resolved === WORKFLOW_INSTANCE_STATUS.COMPLETED ||
    resolved === WORKFLOW_INSTANCE_STATUS.REJECTED ||
    resolved === WORKFLOW_INSTANCE_STATUS.CANCELLED ||
    resolved === WORKFLOW_INSTANCE_STATUS.EXPIRED
  ) {
    return resolved;
  }
  return WORKFLOW_INSTANCE_STATUS.RUNNING;
}

export function getWorkflowInstanceStatusName(code: number): WorkflowInstanceStatusName {
  switch (code) {
    case WORKFLOW_INSTANCE_STATUS.COMPLETED:
      return 'COMPLETED';
    case WORKFLOW_INSTANCE_STATUS.REJECTED:
      return 'REJECTED';
    case WORKFLOW_INSTANCE_STATUS.CANCELLED:
      return 'CANCELLED';
    case WORKFLOW_INSTANCE_STATUS.EXPIRED:
      return 'EXPIRED';
    default:
      return 'RUNNING';
  }
}

export interface StartWorkflowPublicInput {
  readonly workflowCode: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly title: string;
  readonly initiatorUserId?: number | null | undefined;
  readonly organizationUnitId?: number | null | undefined;
  readonly contextData?: Record<string, unknown> | undefined;
  readonly dueHoursOverride?: number | null | undefined;
}

export interface IWorkflowsPublicService {
  startWorkflowForEntity(input: StartWorkflowPublicInput): Promise<WorkflowInstanceDetailView>;
  getInstanceById(id: number): Promise<WorkflowInstanceDetailView>;
  findInstancesByEntity(entityType: string, entityId: string): Promise<WorkflowInstanceItemView[]>;
  scanSlaAndNotifyOverdue(now?: Date): Promise<WorkflowSlaScanResultView>;
}

export const WORKFLOWS_PUBLIC_SERVICE = Symbol('WORKFLOWS_PUBLIC_SERVICE');
