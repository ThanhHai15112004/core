import type {
  WorkflowApprovalDecision,
  WorkflowApprovalMode,
  WorkflowDefinitionStatusCode,
  WorkflowDefinitionStatusName,
  WorkflowHistoryActionType,
  WorkflowInstanceStatusCode,
  WorkflowInstanceStatusName,
  WorkflowStateType,
} from '../enum/workflows.enum.js';

export type WorkflowConditionOperator =
  'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'exists';

export interface WorkflowFieldConditionRule {
  readonly field: string;
  readonly operator: WorkflowConditionOperator;
  readonly value?: unknown;
}

export interface WorkflowTransitionConditions {
  readonly requiredPermissions?: readonly string[] | undefined;
  readonly allowedRoleCodes?: readonly string[] | undefined;
  readonly onlyInitiator?: boolean | undefined;
  readonly onlyAssignedApprover?: boolean | undefined;
  readonly requireReason?: boolean | undefined;
  readonly fieldRules?: readonly WorkflowFieldConditionRule[] | undefined;
}

export type WorkflowTransitionActionType = 'RECORD_HISTORY' | 'NOTIFY' | 'DISPATCH_JOB';

export interface WorkflowTransitionActionConfig {
  readonly type: WorkflowTransitionActionType;
  readonly title?: string | undefined;
  readonly content?: string | undefined;
  readonly notifyTargets?:
    readonly ('INITIATOR' | 'NEXT_APPROVERS' | 'CUSTOM_USERS' | 'ROLE')[] | undefined;
  readonly targetUserIds?: readonly number[] | undefined;
  readonly targetRoleCodes?: readonly string[] | undefined;
  readonly jobTopic?: string | undefined;
  readonly jobQueue?: string | undefined;
  readonly jobPayload?: Record<string, unknown> | undefined;
}

export interface WorkflowStateApprovalConfig {
  readonly enabled: boolean;
  readonly mode?: WorkflowApprovalMode | undefined;
  readonly useManagerChain?: boolean | undefined;
  readonly maxChainLevels?: number | undefined;
  readonly approverUserIds?: readonly number[] | undefined;
  readonly approverRoleCodes?: readonly string[] | undefined;
  readonly autoTransitionOnApprove?: string | null | undefined;
  readonly autoTransitionOnReject?: string | null | undefined;
  readonly autoTransitionOnReturn?: string | null | undefined;
}

export interface WorkflowTriggeredActionResult {
  readonly type: WorkflowTransitionActionType;
  readonly status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
  readonly referenceId?: string | number | null | undefined;
  readonly detail?: string | null | undefined;
}

export interface WorkflowStateItemView {
  readonly id: number;
  readonly workflowDefinitionId: number;
  readonly code: string;
  readonly name: string;
  readonly stateType: WorkflowStateType;
  readonly badgeTone: string;
  readonly slaHours: number | null;
  readonly approvalConfig: WorkflowStateApprovalConfig | null;
  readonly sortOrder: number;
}

export interface WorkflowTransitionItemView {
  readonly id: number;
  readonly workflowDefinitionId: number;
  readonly code: string;
  readonly name: string;
  readonly fromStateCode: string;
  readonly toStateCode: string;
  readonly conditions: WorkflowTransitionConditions;
  readonly actions: readonly WorkflowTransitionActionConfig[];
  readonly sortOrder: number;
}

export interface WorkflowDefinitionItemView {
  readonly id: number;
  readonly code: string;
  readonly version: number;
  readonly name: string;
  readonly description: string | null;
  readonly targetEntityType: string;
  readonly defaultSlaHours: number;
  readonly warningBeforeMinutes: number;
  readonly isSystem: boolean;
  readonly status: WorkflowDefinitionStatusCode;
  readonly statusName: WorkflowDefinitionStatusName;
  readonly createdByUserId: number | null;
  readonly states: readonly WorkflowStateItemView[];
  readonly transitions: readonly WorkflowTransitionItemView[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowApprovalStepItemView {
  readonly id: number;
  readonly workflowInstanceId: number;
  readonly stateCode: string;
  readonly stepOrder: number;
  readonly approvalMode: WorkflowApprovalMode;
  readonly approverUserId: number | null;
  readonly approverFullName: string | null;
  readonly approverUsername: string | null;
  readonly delegatedFromUserId: number | null;
  readonly approverRoleCode: string | null;
  readonly decision: WorkflowApprovalDecision;
  readonly comment: string | null;
  readonly decidedAt: string | null;
  readonly decidedByUserId: number | null;
}

export interface WorkflowHistoryItemView {
  readonly id: number;
  readonly workflowInstanceId: number;
  readonly transitionCode: string | null;
  readonly actionType: WorkflowHistoryActionType;
  readonly fromStateCode: string | null;
  readonly toStateCode: string;
  readonly actorUserId: number | null;
  readonly actorFullName: string | null;
  readonly actorUsername: string | null;
  readonly reason: string | null;
  readonly triggeredActions: readonly WorkflowTriggeredActionResult[];
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: string;
}

export interface AvailableWorkflowTransitionView {
  readonly code: string;
  readonly name: string;
  readonly fromStateCode: string;
  readonly toStateCode: string;
  readonly allowed: boolean;
  readonly blockedReasons: readonly string[];
  readonly requireReason: boolean;
}

export interface WorkflowInstanceItemView {
  readonly id: number;
  readonly workflowDefinitionId: number;
  readonly workflowCode: string;
  readonly workflowVersion: number;
  readonly workflowName: string | null;
  readonly entityType: string;
  readonly entityId: string;
  readonly title: string;
  readonly currentStateCode: string;
  readonly currentStateName: string | null;
  readonly currentStateBadgeTone: string | null;
  readonly status: WorkflowInstanceStatusCode;
  readonly statusName: WorkflowInstanceStatusName;
  readonly initiatorUserId: number | null;
  readonly initiatorFullName: string | null;
  readonly organizationUnitId: number | null;
  readonly currentStepOrder: number;
  readonly dueAt: string | null;
  readonly warningSentAt: string | null;
  readonly overdueNotifiedAt: string | null;
  readonly isOverdue: boolean;
  readonly contextData: Record<string, unknown>;
  readonly cancelReason: string | null;
  readonly cancelledByUserId: number | null;
  readonly completedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowInstanceDetailView extends WorkflowInstanceItemView {
  readonly availableTransitions: readonly AvailableWorkflowTransitionView[];
  readonly approvalSteps: readonly WorkflowApprovalStepItemView[];
  readonly histories: readonly WorkflowHistoryItemView[];
}

export interface WorkflowSlaScanResultView {
  readonly scannedAt: string;
  readonly totalRunningChecked: number;
  readonly warningsTriggeredCount: number;
  readonly overdueMarkedCount: number;
  readonly warningInstanceIds: readonly number[];
  readonly overdueInstanceIds: readonly number[];
}
