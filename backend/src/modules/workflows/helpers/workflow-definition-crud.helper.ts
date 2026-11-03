import {
  BadRequestAppException,
  ConflictAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
} from '@packages/kernel/index.js';
import type { TransactionManager } from '@packages/database/index.js';
import type { AuditLogService } from '@packages/security/index.js';
import {
  WORKFLOWS_AUDIT_META,
  WORKFLOW_DEFINITION_STATUS,
  type WorkflowDefinitionItemView,
} from '../contracts/index.js';
import type { WorkflowDefinitionRepository } from '../repositories/workflow-definition.repository.js';
import type { WorkflowStateRepository } from '../repositories/workflow-state.repository.js';
import type { WorkflowTransitionRepository } from '../repositories/workflow-transition.repository.js';
import type {
  CreateWorkflowDefinitionRequest,
  UpdateWorkflowDefinitionRequest,
} from '../requests/workflows.requests.js';
import {
  DEFAULT_WORKFLOW_STATES,
  DEFAULT_WORKFLOW_TRANSITIONS,
} from './workflow-hydration.helper.js';

export function validateStatesAndTransitionsConsistency(
  states: ReadonlyArray<{ readonly code: string }>,
  transitions: ReadonlyArray<{
    readonly code: string;
    readonly fromStateCode: string;
    readonly toStateCode: string;
  }>,
): void {
  const stateCodes = new Set(states.map((s) => s.code.trim().toUpperCase()));
  if (stateCodes.size === 0) {
    throw new BadRequestAppException('workflows.statesCannotBeEmpty');
  }
  for (const tr of transitions) {
    const fromCode = tr.fromStateCode.trim().toUpperCase();
    const toCode = tr.toStateCode.trim().toUpperCase();
    if (!stateCodes.has(fromCode) || !stateCodes.has(toCode)) {
      throw new BadRequestAppException('workflows.transitionReferencesUnknownState', [
        {
          transitionCode: tr.code,
          fromStateCode: fromCode,
          toStateCode: toCode,
        },
      ]);
    }
  }
}

export async function executeCreateWorkflowDefinition(params: {
  dto: CreateWorkflowDefinitionRequest;
  actorId?: number | undefined;
  definitionRepository: WorkflowDefinitionRepository;
  stateRepository: WorkflowStateRepository;
  transitionRepository: WorkflowTransitionRepository;
  transactionManager: TransactionManager | null;
  auditLogService: AuditLogService | null;
  getDefinitionById: (id: number) => Promise<WorkflowDefinitionItemView>;
}): Promise<WorkflowDefinitionItemView> {
  const {
    dto,
    actorId,
    definitionRepository,
    stateRepository,
    transitionRepository,
    transactionManager,
    auditLogService,
    getDefinitionById,
  } = params;

  const code = dto.code.trim().toUpperCase();
  const version = dto.version ?? (await definitionRepository.findMaxVersionByCode(code)) + 1;

  const existing = await definitionRepository.findByCodeAndVersion(code, version);
  if (existing) {
    throw new ConflictAppException(
      'workflows.duplicateCodeAndVersion',
      [{ code, version }],
      { code, version },
      HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
    );
  }

  const statesToSave = dto.states && dto.states.length > 0 ? dto.states : DEFAULT_WORKFLOW_STATES;
  const transitionsToSave =
    dto.transitions !== undefined ? dto.transitions : DEFAULT_WORKFLOW_TRANSITIONS;

  validateStatesAndTransitionsConsistency(statesToSave, transitionsToSave);

  const work = async (): Promise<number> => {
    const saved = await definitionRepository.saveEntity({
      code,
      version,
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      targetEntityType: dto.targetEntityType.trim().toLowerCase(),
      defaultSlaHours: dto.defaultSlaHours,
      warningBeforeMinutes: dto.warningBeforeMinutes,
      isSystem: false,
      status: dto.status ?? WORKFLOW_DEFINITION_STATUS.ACTIVE,
      createdByUserId: actorId ?? null,
    });
    const defId = Number(saved.id);
    await stateRepository.replaceStatesForDefinition(defId, statesToSave);
    await transitionRepository.replaceTransitionsForDefinition(defId, transitionsToSave);
    return defId;
  };

  const createdId = transactionManager
    ? await transactionManager.runInTransaction(work)
    : await work();

  const result = await getDefinitionById(createdId);
  await auditLogService?.record({
    actorUserId: actorId ?? null,
    module: WORKFLOWS_AUDIT_META.MODULE,
    feature: WORKFLOWS_AUDIT_META.FEATURES.DEFINITION,
    action: 'workflow.definition.create',
    resourceType: WORKFLOWS_AUDIT_META.RESOURCE_TYPES.DEFINITION,
    resourceId: result.id,
    beforeData: null,
    afterData: { code: result.code, version: result.version, name: result.name },
    reason: 'Created workflow definition',
  });
  return result;
}

export async function executeUpdateWorkflowDefinition(params: {
  id: number;
  dto: UpdateWorkflowDefinitionRequest;
  definitionRepository: WorkflowDefinitionRepository;
  stateRepository: WorkflowStateRepository;
  transitionRepository: WorkflowTransitionRepository;
  transactionManager: TransactionManager | null;
  getDefinitionById: (id: number) => Promise<WorkflowDefinitionItemView>;
}): Promise<WorkflowDefinitionItemView> {
  const {
    id,
    dto,
    definitionRepository,
    stateRepository,
    transitionRepository,
    transactionManager,
    getDefinitionById,
  } = params;

  const def = await definitionRepository.findById(id);
  if (!def) {
    throw new NotFoundAppException('workflows.definitionNotFound', { id });
  }

  if (dto.name !== undefined) def.name = dto.name.trim();
  if (dto.description !== undefined) def.description = dto.description?.trim() || null;
  if (dto.targetEntityType !== undefined) {
    def.targetEntityType = dto.targetEntityType.trim().toLowerCase();
  }
  if (dto.defaultSlaHours !== undefined) def.defaultSlaHours = dto.defaultSlaHours;
  if (dto.warningBeforeMinutes !== undefined) {
    def.warningBeforeMinutes = dto.warningBeforeMinutes;
  }
  if (dto.status !== undefined) def.status = dto.status;

  const work = async (): Promise<void> => {
    await definitionRepository.saveEntity(def);
    if (dto.states !== undefined) {
      await stateRepository.replaceStatesForDefinition(Number(def.id), dto.states);
    }
    if (dto.transitions !== undefined) {
      await transitionRepository.replaceTransitionsForDefinition(Number(def.id), dto.transitions);
    }
  };

  if (transactionManager) {
    await transactionManager.runInTransaction(work);
  } else {
    await work();
  }

  return getDefinitionById(Number(def.id));
}

export function buildClonedDefinitionVersionPayload(
  current: WorkflowDefinitionItemView,
  nextVersion: number,
): CreateWorkflowDefinitionRequest {
  return {
    code: current.code,
    version: nextVersion,
    name: `${current.name} (v${nextVersion})`,
    description: current.description,
    targetEntityType: current.targetEntityType,
    defaultSlaHours: current.defaultSlaHours,
    warningBeforeMinutes: current.warningBeforeMinutes,
    status: WORKFLOW_DEFINITION_STATUS.ACTIVE,
    states: current.states.map((s) => ({
      code: s.code,
      name: s.name,
      stateType: s.stateType,
      badgeTone: s.badgeTone,
      slaHours: s.slaHours,
      approvalConfig: s.approvalConfig
        ? {
            enabled: s.approvalConfig.enabled,
            ...(s.approvalConfig.mode ? { mode: s.approvalConfig.mode } : {}),
            ...(s.approvalConfig.useManagerChain !== undefined
              ? { useManagerChain: s.approvalConfig.useManagerChain }
              : {}),
            ...(s.approvalConfig.maxChainLevels !== undefined
              ? { maxChainLevels: s.approvalConfig.maxChainLevels }
              : {}),
            ...(s.approvalConfig.approverUserIds
              ? { approverUserIds: [...s.approvalConfig.approverUserIds] }
              : {}),
            ...(s.approvalConfig.approverRoleCodes
              ? { approverRoleCodes: [...s.approvalConfig.approverRoleCodes] }
              : {}),
            ...(s.approvalConfig.autoTransitionOnApprove !== undefined
              ? { autoTransitionOnApprove: s.approvalConfig.autoTransitionOnApprove }
              : {}),
            ...(s.approvalConfig.autoTransitionOnReject !== undefined
              ? { autoTransitionOnReject: s.approvalConfig.autoTransitionOnReject }
              : {}),
            ...(s.approvalConfig.autoTransitionOnReturn !== undefined
              ? { autoTransitionOnReturn: s.approvalConfig.autoTransitionOnReturn }
              : {}),
          }
        : null,
      sortOrder: s.sortOrder,
    })),
    transitions: current.transitions.map((t) => ({
      code: t.code,
      name: t.name,
      fromStateCode: t.fromStateCode,
      toStateCode: t.toStateCode,
      conditions: {
        ...(t.conditions.requiredPermissions
          ? { requiredPermissions: [...t.conditions.requiredPermissions] }
          : {}),
        ...(t.conditions.allowedRoleCodes
          ? { allowedRoleCodes: [...t.conditions.allowedRoleCodes] }
          : {}),
        ...(t.conditions.onlyInitiator !== undefined
          ? { onlyInitiator: t.conditions.onlyInitiator }
          : {}),
        ...(t.conditions.onlyAssignedApprover !== undefined
          ? { onlyAssignedApprover: t.conditions.onlyAssignedApprover }
          : {}),
        ...(t.conditions.requireReason !== undefined
          ? { requireReason: t.conditions.requireReason }
          : {}),
        ...(t.conditions.fieldRules
          ? { fieldRules: t.conditions.fieldRules.map((r) => ({ ...r })) }
          : {}),
      },
      actions: t.actions.map((a) => ({
        type: a.type,
        ...(a.title !== undefined ? { title: a.title } : {}),
        ...(a.content !== undefined ? { content: a.content } : {}),
        ...(a.notifyTargets ? { notifyTargets: [...a.notifyTargets] } : {}),
        ...(a.targetUserIds ? { targetUserIds: [...a.targetUserIds] } : {}),
        ...(a.targetRoleCodes ? { targetRoleCodes: [...a.targetRoleCodes] } : {}),
        ...(a.jobTopic !== undefined ? { jobTopic: a.jobTopic } : {}),
        ...(a.jobQueue !== undefined ? { jobQueue: a.jobQueue } : {}),
        ...(a.jobPayload ? { jobPayload: { ...a.jobPayload } } : {}),
      })),
      sortOrder: t.sortOrder,
    })),
  };
}
