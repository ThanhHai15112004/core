import type { UserIdentity } from '@packages/security/index.js';

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

export interface DecideApprovalStepInput {
  readonly decision: 'APPROVE' | 'REJECT' | 'RETURN';
  readonly stepId?: number | undefined;
  readonly comment?: string | null | undefined;
  readonly targetStateCode?: string | undefined;
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
  readonly createdAt?: string | undefined;
}

export interface ApprovalInstanceStepsOverview {
  readonly instanceId: number;
  readonly workflowCode: string;
  readonly currentStateCode: string;
  readonly currentStepOrder: number;
  readonly status: number;
  readonly statusName: string;
  readonly approvalSteps: readonly ApprovalStepSummaryView[];
}

export interface IApprovalsPublicService {
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
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly id: number; readonly revoked: true }>;
  getActiveDelegationMap(): Promise<Map<number, ApprovalDelegationRuleView>>;
  registerInstanceApprovalCoordinator?(coordinator: {
    readonly getInstanceSteps: (
      instanceId: number,
      actor?: UserIdentity,
    ) => Promise<ApprovalInstanceStepsOverview>;
    readonly decideStep: (
      instanceId: number,
      input: DecideApprovalStepInput,
      actor?: UserIdentity,
    ) => Promise<unknown>;
  }): void;
}

export const APPROVALS_PUBLIC_SERVICE = Symbol('APPROVALS_PUBLIC_SERVICE');
