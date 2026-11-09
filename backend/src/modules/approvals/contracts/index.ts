import type { UserIdentity } from '@packages/security/index.js';

export const WORKFLOW_APPROVAL_MODE = {
  SINGLE: 'SINGLE',
  SEQUENTIAL: 'SEQUENTIAL',
  PARALLEL: 'PARALLEL',
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

export interface WorkflowApprovalStepRecord {
  id: number;
  workflowInstanceId: number;
  stateCode: string;
  stepOrder: number;
  approvalMode: WorkflowApprovalMode;
  approverUserId?: number | null | undefined;
  delegatedFromUserId?: number | null | undefined;
  approverRoleCode?: string | null | undefined;
  decision: WorkflowApprovalDecision;
  comment?: string | null | undefined;
  decidedAt?: Date | null | undefined;
  decidedByUserId?: number | null | undefined;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

export interface CreateWorkflowApprovalStepInput {
  readonly workflowInstanceId: number;
  readonly stateCode: string;
  readonly stepOrder: number;
  readonly approvalMode?: WorkflowApprovalMode | undefined;
  readonly approverUserId?: number | null | undefined;
  readonly delegatedFromUserId?: number | null | undefined;
  readonly approverRoleCode?: string | null | undefined;
  readonly decision?: WorkflowApprovalDecision | undefined;
}

export interface IApprovalStepsPersistenceContract {
  findByInstanceId(workflowInstanceId: number): Promise<WorkflowApprovalStepRecord[]>;
  findByInstanceIds(instanceIds: readonly number[]): Promise<WorkflowApprovalStepRecord[]>;
  createSteps(
    inputs: readonly CreateWorkflowApprovalStepInput[],
  ): Promise<WorkflowApprovalStepRecord[]>;
  saveEntity(step: WorkflowApprovalStepRecord): Promise<WorkflowApprovalStepRecord>;
}

export interface ApprovalDelegationRuleView {
  readonly id: number;
  readonly fromUserId: number;
  readonly toUserId: number;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string;
  readonly workflowCodes: readonly string[];
  readonly entityTypes: readonly string[];
  readonly organizationUnitId: number | null;
  readonly reason: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface CreateApprovalDelegationRuleInput {
  readonly fromUserId?: number | undefined;
  readonly toUserId: number;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string;
  readonly workflowCodes?: readonly string[] | undefined;
  readonly entityTypes?: readonly string[] | undefined;
  readonly organizationUnitId?: number | null | undefined;
  readonly reason?: string | null | undefined;
}

export interface ApprovalStepSummaryView {
  readonly id: number;
  readonly workflowInstanceId: number;
  readonly stateCode: string;
  readonly stepOrder: number;
  readonly approvalMode: string;
  readonly approverUserId: number | null;
  readonly delegatedFromUserId: number | null;
  readonly approverRoleCode: string | null;
  readonly decision: string;
  readonly comment: string | null;
  readonly decidedAt: string | null;
  readonly decidedByUserId: number | null;
  readonly createdAt: string;
}

export interface ApprovalInstanceStepsOverviewView {
  readonly instanceId: number;
  readonly workflowCode: string;
  readonly currentStateCode: string;
  readonly currentStepOrder: number;
  readonly status: number;
  readonly statusName: string;
  readonly approvalSteps: readonly ApprovalStepSummaryView[];
}

export interface DecideApprovalStepInput {
  readonly decision: 'APPROVE' | 'REJECT' | 'RETURN' | 'APPROVED' | 'REJECTED' | 'RETURNED';
  readonly stepId?: number | undefined;
  readonly comment?: string | null | undefined;
  readonly targetStateCode?: string | undefined;
  readonly returnToStateCode?: string | null | undefined;
  readonly contextDataPatch?: Record<string, unknown> | undefined;
}

export interface DelegateApprovalStepInput {
  readonly stepId?: number | null | undefined;
  readonly toUserId: number;
  readonly reason?: string | null | undefined;
  readonly effectiveFrom?: string | undefined;
  readonly effectiveUntil?: string | undefined;
  readonly workflowCodes?: readonly string[] | undefined;
}

export interface InstanceApprovalCoordinator {
  getInstanceSteps(
    instanceId: number,
    actor?: UserIdentity,
  ): Promise<ApprovalInstanceStepsOverviewView>;
  decideStep(
    instanceId: number,
    input: DecideApprovalStepInput,
    actor?: UserIdentity,
  ): Promise<unknown>;
  delegateStep?(
    instanceId: number,
    input: DelegateApprovalStepInput,
    actor?: UserIdentity,
  ): Promise<unknown>;
}

export interface IApprovalsPublicService extends IApprovalStepsPersistenceContract {
  registerInstanceApprovalCoordinator(coordinator: InstanceApprovalCoordinator): void;
  createDelegation(
    input: CreateApprovalDelegationRuleInput,
    actor?: UserIdentity,
  ): Promise<ApprovalDelegationRuleView>;
  listDelegations(query?: {
    readonly fromUserId?: number | undefined;
    readonly toUserId?: number | undefined;
    readonly activeOnly?: boolean | undefined;
  }): Promise<ApprovalDelegationRuleView[]>;
  revokeDelegation(
    ruleId: number,
    actor?: UserIdentity,
  ): Promise<{ readonly revoked: true; readonly id: number }>;
  findActiveDelegationForApprover(params: {
    readonly fromUserId: number;
    readonly workflowCode?: string | null | undefined;
    readonly entityType?: string | null | undefined;
    readonly organizationUnitId?: number | null | undefined;
    readonly at?: Date | undefined;
  }): Promise<ApprovalDelegationRuleView | null>;
  getInstanceSteps(
    instanceId: number,
    actor?: UserIdentity,
  ): Promise<ApprovalInstanceStepsOverviewView>;
  decideInstanceStep(
    instanceId: number,
    input: DecideApprovalStepInput,
    actor?: UserIdentity,
  ): Promise<unknown>;
  delegateInstanceStep(
    instanceId: number,
    input: DelegateApprovalStepInput,
    actor?: UserIdentity,
  ): Promise<unknown>;
}

export const APPROVALS_PUBLIC_SERVICE = Symbol('APPROVALS_PUBLIC_SERVICE');
