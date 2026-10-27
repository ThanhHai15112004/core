import { safeJsonParse, safeJsonParseObject } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { WorkflowApprovalStepEntity } from '../entities/workflow-approval-step.entity.js';
import type { WorkflowInstanceEntity } from '../entities/workflow-instance.entity.js';
import type { WorkflowStateEntity } from '../entities/workflow-state.entity.js';
import type { WorkflowTransitionEntity } from '../entities/workflow-transition.entity.js';
import { WORKFLOW_APPROVAL_DECISION } from '../enum/workflows.enum.js';
import type {
  AvailableWorkflowTransitionView,
  WorkflowFieldConditionRule,
  WorkflowStateApprovalConfig,
  WorkflowTransitionActionConfig,
  WorkflowTransitionConditions,
} from '../types/workflows.types.js';

export function parseTransitionConditions(raw?: string | null): WorkflowTransitionConditions {
  const parsed = safeJsonParse<WorkflowTransitionConditions>(raw, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

export function parseTransitionActions(raw?: string | null): WorkflowTransitionActionConfig[] {
  const parsed = safeJsonParse<WorkflowTransitionActionConfig[]>(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function parseStateApprovalConfig(raw?: string | null): WorkflowStateApprovalConfig | null {
  if (!raw || !raw.trim()) return null;
  const parsed = safeJsonParse<WorkflowStateApprovalConfig>(raw, null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

export function parseInstanceContextData(raw?: string | null): Record<string, unknown> {
  return safeJsonParseObject<Record<string, unknown>>(raw, {});
}

function getNestedFieldValue(data: Record<string, unknown>, fieldPath: string): unknown {
  const parts = fieldPath
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean);
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function evaluateSingleFieldRule(
  rule: WorkflowFieldConditionRule,
  contextData: Record<string, unknown>,
): { readonly passed: boolean; readonly reason?: string } {
  const actual = getNestedFieldValue(contextData, rule.field);
  const expected = rule.value;

  switch (rule.operator) {
    case 'exists': {
      const ok = actual !== undefined && actual !== null && actual !== '';
      return ok
        ? { passed: true }
        : { passed: false, reason: `Thiếu trường dữ liệu bắt buộc "${rule.field}"` };
    }
    case 'eq': {
      const ok = actual === expected || String(actual) === String(expected);
      return ok
        ? { passed: true }
        : {
            passed: false,
            reason: `Điều kiện "${rule.field} == ${String(expected)}" chưa thỏa mãn (hiện tại: ${String(actual)})`,
          };
    }
    case 'neq': {
      const ok = actual !== expected && String(actual) !== String(expected);
      return ok
        ? { passed: true }
        : {
            passed: false,
            reason: `Điều kiện "${rule.field} != ${String(expected)}" chưa thỏa mãn`,
          };
    }
    case 'gt': {
      const ok = Number(actual) > Number(expected);
      return ok
        ? { passed: true }
        : {
            passed: false,
            reason: `Điều kiện "${rule.field} > ${String(expected)}" chưa thỏa mãn (hiện tại: ${String(actual)})`,
          };
    }
    case 'gte': {
      const ok = Number(actual) >= Number(expected);
      return ok
        ? { passed: true }
        : {
            passed: false,
            reason: `Điều kiện "${rule.field} >= ${String(expected)}" chưa thỏa mãn (hiện tại: ${String(actual)})`,
          };
    }
    case 'lt': {
      const ok = Number(actual) < Number(expected);
      return ok
        ? { passed: true }
        : {
            passed: false,
            reason: `Điều kiện "${rule.field} < ${String(expected)}" chưa thỏa mãn (hiện tại: ${String(actual)})`,
          };
    }
    case 'lte': {
      const ok = Number(actual) <= Number(expected);
      return ok
        ? { passed: true }
        : {
            passed: false,
            reason: `Điều kiện "${rule.field} <= ${String(expected)}" chưa thỏa mãn (hiện tại: ${String(actual)})`,
          };
    }
    case 'in': {
      const list = Array.isArray(expected) ? expected.map(String) : [String(expected)];
      const ok = list.includes(String(actual));
      return ok
        ? { passed: true }
        : { passed: false, reason: `Giá trị "${rule.field}" phải thuộc [${list.join(', ')}]` };
    }
    case 'not_in': {
      const list = Array.isArray(expected) ? expected.map(String) : [String(expected)];
      const ok = !list.includes(String(actual));
      return ok
        ? { passed: true }
        : {
            passed: false,
            reason: `Giá trị "${rule.field}" không được thuộc [${list.join(', ')}]`,
          };
    }
    default:
      return { passed: true };
  }
}

export function evaluateTransitionConditions(params: {
  transition: WorkflowTransitionEntity;
  instance: WorkflowInstanceEntity;
  contextData: Record<string, unknown>;
  approvalSteps: readonly WorkflowApprovalStepEntity[];
  actor?: UserIdentity | undefined;
  reason?: string | null | undefined;
  checkReasonProvided?: boolean | undefined;
}): {
  readonly allowed: boolean;
  readonly blockedReasons: string[];
  readonly requireReason: boolean;
} {
  const {
    transition,
    instance,
    contextData,
    approvalSteps,
    actor,
    reason,
    checkReasonProvided = false,
  } = params;

  const conditions = parseTransitionConditions(transition.conditionsJson);
  const blockedReasons: string[] = [];
  const isSuperOrAdmin =
    actor?.roles?.includes('super_admin') || actor?.roles?.includes('admin') || false;

  if (conditions.requiredPermissions && conditions.requiredPermissions.length > 0 && actor) {
    const granted = new Set(actor.permissions ?? []);
    const missing = conditions.requiredPermissions.filter((p) => !granted.has(p));
    if (missing.length > 0 && !isSuperOrAdmin) {
      blockedReasons.push(`Thiếu quyền: ${missing.join(', ')}`);
    }
  }

  if (conditions.allowedRoleCodes && conditions.allowedRoleCodes.length > 0 && actor) {
    const userRoles = new Set((actor.roles ?? []).map((r) => r.toLowerCase()));
    const hasAllowedRole = conditions.allowedRoleCodes.some((r) =>
      userRoles.has(r.trim().toLowerCase()),
    );
    if (!hasAllowedRole && !isSuperOrAdmin) {
      blockedReasons.push(`Yêu cầu vai trò: ${conditions.allowedRoleCodes.join(', ')}`);
    }
  }

  if (conditions.onlyInitiator && actor) {
    if (
      instance.initiatorUserId !== null &&
      instance.initiatorUserId !== undefined &&
      Number(actor.id) !== Number(instance.initiatorUserId) &&
      !isSuperOrAdmin
    ) {
      blockedReasons.push('Chỉ người khởi tạo hồ sơ mới được thực hiện bước chuyển này');
    }
  }

  if (conditions.onlyAssignedApprover && actor) {
    const pendingStepsForCurrentState = approvalSteps.filter(
      (s) =>
        s.stateCode === instance.currentStateCode &&
        s.decision === WORKFLOW_APPROVAL_DECISION.PENDING,
    );
    const userRoles = new Set((actor.roles ?? []).map((r) => r.toLowerCase()));
    const isApprover = pendingStepsForCurrentState.some(
      (s) =>
        (s.approverUserId !== null && Number(s.approverUserId) === Number(actor.id)) ||
        (s.approverRoleCode && userRoles.has(s.approverRoleCode.toLowerCase())),
    );
    if (!isApprover && !isSuperOrAdmin) {
      blockedReasons.push('Chỉ người phê duyệt được phân công ở bước hiện tại mới được thực hiện');
    }
  }

  if (conditions.fieldRules && conditions.fieldRules.length > 0) {
    for (const rule of conditions.fieldRules) {
      const evalRes = evaluateSingleFieldRule(rule, contextData);
      if (!evalRes.passed && evalRes.reason) {
        blockedReasons.push(evalRes.reason);
      }
    }
  }

  const requireReason = Boolean(conditions.requireReason);
  if (checkReasonProvided && requireReason && (!reason || !reason.trim())) {
    blockedReasons.push('Bước chuyển trạng thái này bắt buộc phải nhập lý do / ghi chú');
  }

  return {
    allowed: blockedReasons.length === 0,
    blockedReasons,
    requireReason,
  };
}

export function computeAvailableTransitions(params: {
  transitions: readonly WorkflowTransitionEntity[];
  instance: WorkflowInstanceEntity;
  contextData: Record<string, unknown>;
  approvalSteps: readonly WorkflowApprovalStepEntity[];
  actor?: UserIdentity | undefined;
}): AvailableWorkflowTransitionView[] {
  const { transitions, instance, contextData, approvalSteps, actor } = params;
  const fromCurrent = transitions.filter(
    (t) => t.fromStateCode.toUpperCase() === instance.currentStateCode.toUpperCase(),
  );

  return fromCurrent.map((t) => {
    const evalResult = evaluateTransitionConditions({
      transition: t,
      instance,
      contextData,
      approvalSteps,
      actor,
      checkReasonProvided: false,
    });
    return {
      code: t.code,
      name: t.name,
      fromStateCode: t.fromStateCode,
      toStateCode: t.toStateCode,
      allowed: evalResult.allowed,
      blockedReasons: evalResult.blockedReasons,
      requireReason: evalResult.requireReason,
    };
  });
}

export function resolveStateSlaDueDate(params: {
  targetState: WorkflowStateEntity | undefined;
  defaultSlaHours: number;
  dueHoursOverride?: number | null | undefined;
  fromTime?: Date | undefined;
}): Date | null {
  const { targetState, defaultSlaHours, dueHoursOverride, fromTime = new Date() } = params;
  if (
    targetState &&
    (targetState.stateType === 'FINAL_APPROVED' ||
      targetState.stateType === 'FINAL_REJECTED' ||
      targetState.stateType === 'CANCELLED')
  ) {
    return null;
  }
  const effectiveHours =
    dueHoursOverride !== undefined && dueHoursOverride !== null
      ? Number(dueHoursOverride)
      : targetState?.slaHours !== undefined && targetState?.slaHours !== null
        ? Number(targetState.slaHours)
        : Number(defaultSlaHours);
  if (!Number.isFinite(effectiveHours) || effectiveHours <= 0) {
    return null;
  }
  return new Date(fromTime.getTime() + effectiveHours * 3600_000);
}
