import type { IUsersPublicService } from '@modules/users/contracts/index.js';
import type { WorkflowApprovalStepEntity } from '../entities/workflow-approval-step.entity.js';
import type { WorkflowStateEntity } from '../entities/workflow-state.entity.js';
import { WORKFLOW_APPROVAL_DECISION, WORKFLOW_APPROVAL_MODE } from '../enum/workflows.enum.js';
import type {
  CreateWorkflowApprovalStepInput,
  WorkflowApprovalStepRepository,
} from '../repositories/workflow-approval-step.repository.js';
import type { WorkflowApprovalDelegationRule } from '../types/workflows.types.js';
import { parseStateApprovalConfig } from './workflow-condition-evaluator.helper.js';

export interface WorkflowDelegationScopeContext {
  readonly workflowCode?: string | undefined;
  readonly entityType?: string | undefined;
  readonly organizationUnitId?: number | null | undefined;
}

export function isDelegationScopeMatched(
  scope: {
    readonly workflowCodes?: readonly string[] | undefined;
    readonly entityTypes?: readonly string[] | undefined;
    readonly organizationUnitId?: number | null | undefined;
  },
  context?: WorkflowDelegationScopeContext | undefined,
): boolean {
  if (!context) return true;
  if (scope.workflowCodes && scope.workflowCodes.length > 0 && context.workflowCode) {
    const targetCode = context.workflowCode.trim().toUpperCase();
    const matched = scope.workflowCodes.some((c) => c.trim().toUpperCase() === targetCode);
    if (!matched) return false;
  }
  if (scope.entityTypes && scope.entityTypes.length > 0 && context.entityType) {
    const targetEntity = context.entityType.trim().toLowerCase();
    const matched = scope.entityTypes.some((e) => e.trim().toLowerCase() === targetEntity);
    if (!matched) return false;
  }
  if (
    scope.organizationUnitId !== undefined &&
    scope.organizationUnitId !== null &&
    context.organizationUnitId !== undefined &&
    context.organizationUnitId !== null &&
    Number(scope.organizationUnitId) !== Number(context.organizationUnitId)
  ) {
    return false;
  }
  return true;
}

export function findActiveDelegationRuleForApprover(params: {
  approverUserId: number;
  delegationRules?: readonly WorkflowApprovalDelegationRule[] | undefined;
  scopeContext?: WorkflowDelegationScopeContext | undefined;
  nowMs?: number | undefined;
}): WorkflowApprovalDelegationRule | null {
  const { approverUserId, delegationRules, scopeContext, nowMs = Date.now() } = params;
  if (!delegationRules || delegationRules.length === 0) return null;

  for (const rule of delegationRules) {
    if (!rule.isActive) continue;
    if (Number(rule.fromUserId) !== Number(approverUserId)) continue;
    const fromMs = new Date(rule.effectiveFrom).getTime();
    const untilMs = new Date(rule.effectiveUntil).getTime();
    if (Number.isNaN(fromMs) || Number.isNaN(untilMs)) continue;
    if (nowMs < fromMs || nowMs > untilMs) continue;
    if (!isDelegationScopeMatched(rule, scopeContext)) continue;
    return rule;
  }
  return null;
}

export async function generateApprovalStepsForState(params: {
  workflowInstanceId: number;
  targetState: WorkflowStateEntity | undefined;
  initiatorUserId: number | null;
  approvalStepRepository: WorkflowApprovalStepRepository;
  usersPublicService: IUsersPublicService | null;
  delegationRules?: readonly WorkflowApprovalDelegationRule[] | undefined;
  scopeContext?: WorkflowDelegationScopeContext | undefined;
}): Promise<WorkflowApprovalStepEntity[]> {
  const {
    workflowInstanceId,
    targetState,
    initiatorUserId,
    approvalStepRepository,
    usersPublicService,
    delegationRules,
    scopeContext,
  } = params;

  if (!targetState) return [];
  const approvalConfig = parseStateApprovalConfig(targetState.approvalConfigJson);
  if (!approvalConfig || !approvalConfig.enabled) {
    return [];
  }

  // Nếu trạng thái này từng có các bước PENDING cũ (ví dụ sau khi RETURNED rồi nộp lại), đánh dấu SKIPPED
  const existingSteps = await approvalStepRepository.findByInstanceId(workflowInstanceId);
  for (const oldStep of existingSteps) {
    if (
      oldStep.stateCode.toUpperCase() === targetState.code.toUpperCase() &&
      oldStep.decision === WORKFLOW_APPROVAL_DECISION.PENDING
    ) {
      oldStep.decision = WORKFLOW_APPROVAL_DECISION.SKIPPED;
      oldStep.decidedAt = new Date();
      await approvalStepRepository.saveEntity(oldStep);
    }
  }

  const mode = approvalConfig.mode ?? WORKFLOW_APPROVAL_MODE.SINGLE;
  const inputs: CreateWorkflowApprovalStepInput[] = [];
  let stepOrder = 1;

  if (
    approvalConfig.useManagerChain &&
    initiatorUserId &&
    usersPublicService?.resolveApproverChain
  ) {
    const chain = await usersPublicService.resolveApproverChain(
      initiatorUserId,
      approvalConfig.maxChainLevels ?? 3,
    );
    for (const item of chain) {
      const rawUserId = Number(item.userId ?? (item as { approverUserId?: number }).approverUserId);
      const activeDelegation = Number.isInteger(rawUserId)
        ? findActiveDelegationRuleForApprover({
            approverUserId: rawUserId,
            delegationRules,
            scopeContext,
          })
        : null;
      inputs.push({
        workflowInstanceId,
        stateCode: targetState.code,
        stepOrder: stepOrder++,
        approvalMode: chain.length > 1 ? WORKFLOW_APPROVAL_MODE.SEQUENTIAL_CHAIN : mode,
        approverUserId: activeDelegation ? activeDelegation.toUserId : rawUserId,
        delegatedFromUserId: activeDelegation ? rawUserId : null,
        decision: WORKFLOW_APPROVAL_DECISION.PENDING,
      });
    }
  }

  if (approvalConfig.approverUserIds && approvalConfig.approverUserIds.length > 0) {
    const existingApproverIds = new Set(
      inputs.map((i) => i.delegatedFromUserId ?? i.approverUserId),
    );
    for (const uid of approvalConfig.approverUserIds) {
      const numericId = Number(uid);
      if (Number.isInteger(numericId) && numericId > 0 && !existingApproverIds.has(numericId)) {
        existingApproverIds.add(numericId);
        const activeDelegation = findActiveDelegationRuleForApprover({
          approverUserId: numericId,
          delegationRules,
          scopeContext,
        });
        inputs.push({
          workflowInstanceId,
          stateCode: targetState.code,
          stepOrder: mode === WORKFLOW_APPROVAL_MODE.SEQUENTIAL_CHAIN ? stepOrder++ : 1,
          approvalMode: mode,
          approverUserId: activeDelegation ? activeDelegation.toUserId : numericId,
          delegatedFromUserId: activeDelegation ? numericId : null,
          decision: WORKFLOW_APPROVAL_DECISION.PENDING,
        });
      }
    }
  }

  if (approvalConfig.approverRoleCodes && approvalConfig.approverRoleCodes.length > 0) {
    for (const roleCode of approvalConfig.approverRoleCodes) {
      const trimmed = roleCode.trim();
      if (!trimmed) continue;
      inputs.push({
        workflowInstanceId,
        stateCode: targetState.code,
        stepOrder: mode === WORKFLOW_APPROVAL_MODE.SEQUENTIAL_CHAIN ? stepOrder++ : 1,
        approvalMode: mode,
        approverUserId: null,
        approverRoleCode: trimmed,
        decision: WORKFLOW_APPROVAL_DECISION.PENDING,
      });
    }
  }

  if (inputs.length === 0) {
    return [];
  }

  return approvalStepRepository.createSteps(inputs);
}
