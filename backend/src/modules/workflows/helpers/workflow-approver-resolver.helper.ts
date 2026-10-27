import type { IUsersPublicService } from '@modules/users/contracts/index.js';
import type { WorkflowApprovalStepEntity } from '../entities/workflow-approval-step.entity.js';
import type { WorkflowStateEntity } from '../entities/workflow-state.entity.js';
import { WORKFLOW_APPROVAL_DECISION, WORKFLOW_APPROVAL_MODE } from '../enum/workflows.enum.js';
import type {
  CreateWorkflowApprovalStepInput,
  WorkflowApprovalStepRepository,
} from '../repositories/workflow-approval-step.repository.js';
import { parseStateApprovalConfig } from './workflow-condition-evaluator.helper.js';

export async function generateApprovalStepsForState(params: {
  workflowInstanceId: number;
  targetState: WorkflowStateEntity | undefined;
  initiatorUserId: number | null;
  approvalStepRepository: WorkflowApprovalStepRepository;
  usersPublicService: IUsersPublicService | null;
}): Promise<WorkflowApprovalStepEntity[]> {
  const {
    workflowInstanceId,
    targetState,
    initiatorUserId,
    approvalStepRepository,
    usersPublicService,
  } = params;

  if (!targetState) return [];
  const approvalConfig = parseStateApprovalConfig(targetState.approvalConfigJson);
  if (!approvalConfig || !approvalConfig.enabled) {
    return [];
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
      inputs.push({
        workflowInstanceId,
        stateCode: targetState.code,
        stepOrder: stepOrder++,
        approvalMode: chain.length > 1 ? WORKFLOW_APPROVAL_MODE.SEQUENTIAL_CHAIN : mode,
        approverUserId: item.userId,
        decision: WORKFLOW_APPROVAL_DECISION.PENDING,
      });
    }
  }

  if (approvalConfig.approverUserIds && approvalConfig.approverUserIds.length > 0) {
    const existingApproverIds = new Set(inputs.map((i) => i.approverUserId));
    for (const uid of approvalConfig.approverUserIds) {
      const numericId = Number(uid);
      if (Number.isInteger(numericId) && numericId > 0 && !existingApproverIds.has(numericId)) {
        existingApproverIds.add(numericId);
        inputs.push({
          workflowInstanceId,
          stateCode: targetState.code,
          stepOrder: mode === WORKFLOW_APPROVAL_MODE.SEQUENTIAL_CHAIN ? stepOrder++ : 1,
          approvalMode: mode,
          approverUserId: numericId,
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
