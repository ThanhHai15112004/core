export interface WorkflowFieldConditionRule {
  readonly field: string;
  readonly operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'exists';
  readonly value?: unknown;
}

export interface WorkflowTransitionConditions {
  readonly requiredPermissions?: readonly string[];
  readonly allowedRoleCodes?: readonly string[];
  readonly onlyInitiator?: boolean;
  readonly onlyAssignedApprover?: boolean;
  readonly requireReason?: boolean;
  readonly fieldRules?: readonly WorkflowFieldConditionRule[];
}

export interface WorkflowTransitionActionConfig {
  readonly type: 'RECORD_HISTORY' | 'NOTIFY' | 'DISPATCH_JOB';
  readonly title?: string;
  readonly content?: string;
  readonly notifyTargets?: readonly ('INITIATOR' | 'NEXT_APPROVERS' | 'CUSTOM_USERS' | 'ROLE')[];
  readonly targetUserIds?: readonly number[];
  readonly targetRoleCodes?: readonly string[];
  readonly jobTopic?: string;
  readonly jobQueue?: string;
}

export interface WorkflowStateApprovalConfig {
  readonly enabled: boolean;
  readonly mode?: 'SINGLE' | 'ALL' | 'ANY' | 'SEQUENTIAL_CHAIN';
  readonly useManagerChain?: boolean;
  readonly maxChainLevels?: number;
  readonly approverUserIds?: readonly number[];
  readonly approverRoleCodes?: readonly string[];
  readonly autoTransitionOnApprove?: string | null;
  readonly autoTransitionOnReject?: string | null;
  readonly autoTransitionOnReturn?: string | null;
}

export interface WorkflowStateItem {
  readonly id?: number;
  readonly workflowDefinitionId?: number;
  readonly code: string;
  readonly name: string;
  readonly stateType: 'INITIAL' | 'INTERMEDIATE' | 'FINAL_APPROVED' | 'FINAL_REJECTED' | 'CANCELLED';
  readonly badgeTone: string;
  readonly slaHours: number | null;
  readonly approvalConfig?: WorkflowStateApprovalConfig | null;
  readonly sortOrder?: number;
}

export interface WorkflowTransitionItem {
  readonly id?: number;
  readonly workflowDefinitionId?: number;
  readonly code: string;
  readonly name: string;
  readonly fromStateCode: string;
  readonly toStateCode: string;
  readonly conditions: WorkflowTransitionConditions;
  readonly actions: readonly WorkflowTransitionActionConfig[];
  readonly sortOrder?: number;
}

export interface WorkflowDefinitionItem {
  readonly id: number;
  readonly code: string;
  readonly version: number;
  readonly name: string;
  readonly description: string | null;
  readonly targetEntityType: string;
  readonly defaultSlaHours: number;
  readonly warningBeforeMinutes: number;
  readonly isSystem: boolean;
  readonly status: number;
  readonly statusName: string;
  readonly states: readonly WorkflowStateItem[];
  readonly transitions: readonly WorkflowTransitionItem[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AvailableWorkflowTransition {
  readonly code: string;
  readonly name: string;
  readonly fromStateCode: string;
  readonly toStateCode: string;
  readonly allowed: boolean;
  readonly blockedReasons: readonly string[];
  readonly requireReason: boolean;
}

export interface WorkflowApprovalStepItem {
  readonly id: number;
  readonly workflowInstanceId: number;
  readonly stateCode: string;
  readonly stepOrder: number;
  readonly approvalMode: string;
  readonly approverUserId: number | null;
  readonly approverFullName: string | null;
  readonly approverUsername: string | null;
  readonly delegatedFromUserId: number | null;
  readonly approverRoleCode: string | null;
  readonly decision: string;
  readonly comment: string | null;
  readonly decidedAt: string | null;
  readonly decidedByUserId: number | null;
}

export interface WorkflowTriggeredActionResult {
  readonly type: string;
  readonly status: string;
  readonly referenceId?: string | number | null;
  readonly detail?: string | null;
}

export interface WorkflowHistoryItem {
  readonly id: number;
  readonly workflowInstanceId: number;
  readonly transitionCode: string | null;
  readonly actionType: string;
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

export interface WorkflowInstanceItem {
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
  readonly status: number;
  readonly statusName: string;
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
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowInstanceDetail extends WorkflowInstanceItem {
  readonly availableTransitions: readonly AvailableWorkflowTransition[];
  readonly approvalSteps: readonly WorkflowApprovalStepItem[];
  readonly histories: readonly WorkflowHistoryItem[];
}

export interface WorkflowSlaScanResult {
  readonly scannedAt: string;
  readonly totalRunningChecked: number;
  readonly warningsTriggeredCount: number;
  readonly overdueMarkedCount: number;
  readonly warningInstanceIds: readonly number[];
  readonly overdueInstanceIds: readonly number[];
}

export interface CreateWorkflowDefinitionPayload {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly targetEntityType: string;
  readonly defaultSlaHours: number;
  readonly warningBeforeMinutes: number;
  readonly states?: readonly WorkflowStateItem[];
  readonly transitions?: readonly WorkflowTransitionItem[];
}

export interface StartWorkflowInstancePayload {
  readonly workflowCode: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly title: string;
  readonly contextData?: Record<string, unknown>;
  readonly dueHoursOverride?: number | null;
}

