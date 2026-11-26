import { createHmac, randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { HTTP_CLIENT_TOKEN, type HttpClientContract } from '@packages/http-client/index.js';
import { DR_DOMAIN_EVENTS, safeJsonParse, type PaginatedResult } from '@packages/kernel/index.js';
import { AuditLogService } from '@packages/security/index.js';
import {
  DR_AUDIT_ACTIONS,
  DR_CHECKLIST_STEP_STATUS,
  DR_OPERATIONAL_STATE,
  DR_SITE_ROLE,
  DR_SWITCH_DIRECTION,
  DR_SWITCH_MODE,
  DR_SWITCH_STATUS,
  type DrChecklistStepStatus,
  type DrSwitchDirection,
  type DrSwitchMode,
} from '../enum/dr-ops.enum.js';
import {
  DrDisabledException,
  DrSplitBrainGuardException,
  DrSwitchGuardException,
  DrSwitchNotFoundException,
  DrValidationException,
} from '../exceptions/dr-ops.exceptions.js';
import {
  buildFailbackChecklist,
  buildFailoverChecklist,
  evaluateRtoCompliance,
  validateChecklistReadyForCompletion,
} from '../helpers/dr-checklist.helper.js';
import { DrProfileRepository } from '../repositories/dr-profile.repository.js';
import {
  DrSwitchExecutionRepository,
  type ListDrSwitchesFilter,
} from '../repositories/dr-switch-execution.repository.js';
import { DrOpsResponseMapper } from '../responses/dr-ops.response.js';
import type { DrChecklistItem, DrSwitchExecutionView } from '../types/dr-ops.types.js';
import { DrAlertService } from './dr-alert.service.js';
import { DrProfileService } from './dr-profile.service.js';

@Injectable()
export class DrSwitchoverService {
  constructor(
    private readonly config: CoreConfigService,
    private readonly profileService: DrProfileService,
    private readonly profileRepo: DrProfileRepository,
    private readonly switchRepo: DrSwitchExecutionRepository,
    private readonly alertService: DrAlertService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional()
    @Inject(HTTP_CLIENT_TOKEN)
    private readonly httpClient?: HttpClientContract,
  ) {}

  private async dispatchSwitchWebhook(payload: Record<string, unknown>): Promise<void> {
    const url = this.config.dr.switchWebhookUrl;
    if (!url) return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new DrSwitchGuardException('Invalid DR_SWITCH_WEBHOOK_URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new DrSwitchGuardException('Unsupported protocol in DR_SWITCH_WEBHOOK_URL');
    }
    if (!this.httpClient) {
      throw new DrSwitchGuardException(
        'HttpClientModule is unavailable to dispatch DR_SWITCH_WEBHOOK_URL',
      );
    }

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.dr.switchWebhookSecret) {
      const sig = createHmac('sha256', this.config.dr.switchWebhookSecret)
        .update(body)
        .digest('hex');
      headers['x-dr-signature'] = `sha256=${sig}`;
    }

    const res = await this.httpClient.requestRaw('POST', parsed.toString(), payload, {
      service: 'dr-switch-webhook',
      headers,
      timeoutMs: 10_000,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new DrSwitchGuardException(
        `DR switch webhook returned HTTP ${res.status}`,
      );
    }
  }

  public async initiateSwitch(input: {
    direction: DrSwitchDirection;
    mode: DrSwitchMode;
    reason: string;
    confirm?: string | undefined;
    actorUserId?: number | null | undefined;
    actorName: string;
  }): Promise<DrSwitchExecutionView> {
    const reason = input.reason?.trim() ?? '';
    const actorName = input.actorName?.trim() || 'system-console-operator';
    if (reason.length < 5) {
      throw new DrValidationException('Switch reason must be at least 5 characters');
    }

    const active = await this.switchRepo.findActiveInProgress('DEFAULT');
    if (active) {
      throw new DrSplitBrainGuardException(
        `Another switch execution (${active.switchCode}) is already IN_PROGRESS`,
      );
    }

    const profile = await this.profileService.getOrCreateDefaultProfile();
    const isFailover = input.direction === DR_SWITCH_DIRECTION.FAILOVER;
    const expectedConfirm = isFailover ? 'FAILOVER' : 'FAILBACK';

    if (input.mode === DR_SWITCH_MODE.LIVE) {
      if (!this.config.dr.enabled && !profile.isEnabled) {
        throw new DrDisabledException('Enable DR_ENABLED or profile.isEnabled before LIVE switch');
      }
      if (!this.config.dr.liveSwitchEnabled) {
        throw new DrSwitchGuardException(
          'Live DR switch is disabled (DR_LIVE_SWITCH_ENABLED=false)',
        );
      }
      if (input.confirm !== expectedConfirm) {
        throw new DrSwitchGuardException(
          `Confirmation string "${expectedConfirm}" is required for LIVE ${input.direction}`,
        );
      }
      if (isFailover && profile.activeSite !== DR_SITE_ROLE.PRIMARY) {
        throw new DrSplitBrainGuardException(
          `Cannot LIVE FAILOVER when activeSite is already ${profile.activeSite}`,
        );
      }
      if (!isFailover && profile.activeSite !== DR_SITE_ROLE.DR) {
        throw new DrSplitBrainGuardException(
          `Cannot LIVE FAILBACK when activeSite is ${profile.activeSite} (must be running on DR)`,
        );
      }
    }

    const startedAt = new Date();
    const prefix = isFailover ? 'FOV' : 'FBK';
    const switchCode = `${prefix}-${startedAt.toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const checklist = isFailover
      ? buildFailoverChecklist(profile.topologyMode)
      : buildFailbackChecklist(profile.topologyMode);

    const fromSite = isFailover ? DR_SITE_ROLE.PRIMARY : DR_SITE_ROLE.DR;
    const toSite = isFailover ? DR_SITE_ROLE.DR : DR_SITE_ROLE.PRIMARY;

    const entity = await this.switchRepo.saveEntity({
      switchCode,
      profileCode: profile.code,
      direction: input.direction,
      mode: input.mode,
      fromSite,
      toSite,
      status: DR_SWITCH_STATUS.IN_PROGRESS,
      reason,
      checklistJson: JSON.stringify(checklist),
      rtoTargetSeconds: profile.rtoTargetSeconds,
      actualRtoSeconds: null,
      rtoMet: null,
      reconciliationReportId: null,
      initiatedByUserId: input.actorUserId ?? null,
      initiatedByName: actorName,
      completedByName: null,
      startedAt,
      completedAt: null,
      durationMs: null,
      errorMessage: null,
      metadataJson: JSON.stringify({ topologyMode: profile.topologyMode }),
    });

    if (input.mode === DR_SWITCH_MODE.LIVE && this.profileRepo.isDatabaseReady()) {
      profile.operationalState = isFailover
        ? DR_OPERATIONAL_STATE.FAILING_OVER
        : DR_OPERATIONAL_STATE.FAILING_BACK;
      await this.profileRepo.saveEntity(profile);
    }

    const eventName = isFailover
      ? DR_DOMAIN_EVENTS.FAILOVER_INITIATED
      : DR_DOMAIN_EVENTS.FAILBACK_INITIATED;
    await this.alertService.publishEvent(eventName, 'DrSwitchExecution', entity.switchCode, {
      switchCode: entity.switchCode,
      direction: input.direction,
      mode: input.mode,
      fromSite,
      toSite,
      actorName,
      reason,
    });

    if (this.auditLog) {
      await this.auditLog
        .record({
          module: 'dr-ops',
          feature: 'dr_switchover',
          action: isFailover
            ? DR_AUDIT_ACTIONS.FAILOVER_INITIATED
            : DR_AUDIT_ACTIONS.FAILBACK_INITIATED,
          resourceType: 'DR_SWITCH_EXECUTION',
          resourceId: entity.switchCode,
          actorUserId: input.actorUserId ?? null,
          actorIdentifier: actorName,
          afterData: {
            switchCode: entity.switchCode,
            direction: input.direction,
            mode: input.mode,
            reason,
          },
        })
        .catch(() => undefined);
    }

    return DrOpsResponseMapper.toSwitchExecutionView(entity);
  }

  public async updateChecklistStep(
    switchId: number,
    stepKey: string,
    input: {
      status: DrChecklistStepStatus;
      note?: string | null | undefined;
      actorUserId?: number | null | undefined;
      actorName: string;
    },
  ): Promise<DrSwitchExecutionView> {
    const entity = await this.switchRepo.findByIdSafe(switchId);
    if (!entity) {
      throw new DrSwitchNotFoundException(switchId);
    }
    if (entity.status !== DR_SWITCH_STATUS.IN_PROGRESS) {
      throw new DrSwitchGuardException(
        `Cannot update checklist on switch execution in status ${entity.status}`,
      );
    }

    const steps = safeJsonParse<DrChecklistItem[]>(entity.checklistJson, []) ?? [];
    const idx = steps.findIndex((s) => s.stepKey === stepKey);
    if (idx === -1) {
      throw new DrValidationException(`Checklist step "${stepKey}" does not exist`);
    }

    const target = steps[idx]!;
    if (target.required && input.status === DR_CHECKLIST_STEP_STATUS.SKIPPED) {
      throw new DrSwitchGuardException(`Required checklist step "${stepKey}" cannot be skipped`);
    }

    const actorName = input.actorName?.trim() || 'system-console-operator';
    const updatedStep: DrChecklistItem = {
      ...target,
      status: input.status,
      completedBy: input.status === DR_CHECKLIST_STEP_STATUS.PENDING ? null : actorName,
      completedAt:
        input.status === DR_CHECKLIST_STEP_STATUS.PENDING ? null : new Date().toISOString(),
      note: input.note !== undefined ? input.note : target.note,
    };

    steps[idx] = updatedStep;
    entity.checklistJson = JSON.stringify(steps);
    const saved = await this.switchRepo.saveEntity(entity);

    if (this.auditLog) {
      await this.auditLog
        .record({
          module: 'dr-ops',
          feature: 'dr_switchover',
          action: DR_AUDIT_ACTIONS.CHECKLIST_UPDATED,
          resourceType: 'DR_SWITCH_EXECUTION',
          resourceId: saved.switchCode,
          actorUserId: input.actorUserId ?? null,
          actorIdentifier: actorName,
          afterData: {
            switchCode: saved.switchCode,
            stepKey,
            status: input.status,
            note: updatedStep.note,
          },
        })
        .catch(() => undefined);
    }

    return DrOpsResponseMapper.toSwitchExecutionView(saved);
  }

  public async completeSwitch(
    switchId: number,
    input: {
      confirm?: string | undefined;
      reconciliationReportId?: number | null | undefined;
      actorUserId?: number | null | undefined;
      actorName: string;
    },
  ): Promise<DrSwitchExecutionView> {
    const entity = await this.switchRepo.findByIdSafe(switchId);
    if (!entity) {
      throw new DrSwitchNotFoundException(switchId);
    }
    if (entity.status !== DR_SWITCH_STATUS.IN_PROGRESS) {
      throw new DrSwitchGuardException(
        `Switch execution #${switchId} is not IN_PROGRESS (current: ${entity.status})`,
      );
    }

    const steps = safeJsonParse<DrChecklistItem[]>(entity.checklistJson, []) ?? [];
    const check = validateChecklistReadyForCompletion(steps);
    if (!check.ready) {
      throw new DrSwitchGuardException(
        `Required checklist steps are still incomplete: ${check.pendingRequiredKeys.join(', ')}`,
      );
    }

    const expectedConfirm = entity.direction;
    if (entity.mode === DR_SWITCH_MODE.LIVE) {
      if (!this.config.dr.liveSwitchEnabled) {
        throw new DrSwitchGuardException(
          'Live DR switch is disabled (DR_LIVE_SWITCH_ENABLED=false)',
        );
      }
      if (input.confirm !== expectedConfirm) {
        throw new DrSwitchGuardException(
          `Confirmation string "${expectedConfirm}" is required to complete LIVE ${entity.direction}`,
        );
      }

      await this.dispatchSwitchWebhook({
        switchCode: entity.switchCode,
        direction: entity.direction,
        fromSite: entity.fromSite,
        toSite: entity.toSite,
        triggeredAt: new Date().toISOString(),
      });
    }

    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - new Date(entity.startedAt).getTime());
    const actualRtoSeconds = Math.max(0, Math.round(durationMs / 1000));
    const rtoEval = evaluateRtoCompliance(actualRtoSeconds, entity.rtoTargetSeconds);
    const actorName = input.actorName?.trim() || 'system-console-operator';

    entity.status = DR_SWITCH_STATUS.COMPLETED;
    entity.completedAt = completedAt;
    entity.durationMs = durationMs;
    entity.actualRtoSeconds = actualRtoSeconds;
    entity.rtoMet = rtoEval.met;
    entity.completedByName = actorName;
    if (input.reconciliationReportId !== undefined) {
      entity.reconciliationReportId = input.reconciliationReportId;
    }

    const saved = await this.switchRepo.saveEntity(entity);

    const profile = await this.profileService.getOrCreateDefaultProfile();
    if (entity.mode === DR_SWITCH_MODE.LIVE && this.profileRepo.isDatabaseReady()) {
      profile.activeSite = entity.toSite;
      profile.operationalState =
        entity.toSite === DR_SITE_ROLE.DR
          ? DR_OPERATIONAL_STATE.RUNNING_ON_DR
          : DR_OPERATIONAL_STATE.NORMAL;
      profile.lastRtoSeconds = actualRtoSeconds;
      await this.profileRepo.saveEntity(profile);
    }

    const isFailover = entity.direction === DR_SWITCH_DIRECTION.FAILOVER;
    await this.alertService.publishEvent(
      isFailover ? DR_DOMAIN_EVENTS.FAILOVER_COMPLETED : DR_DOMAIN_EVENTS.FAILBACK_COMPLETED,
      'DrSwitchExecution',
      saved.switchCode,
      {
        switchCode: saved.switchCode,
        direction: saved.direction,
        mode: saved.mode,
        toSite: saved.toSite,
        actualRtoSeconds,
        rtoMet: rtoEval.met,
      },
    );

    if (this.auditLog) {
      await this.auditLog
        .record({
          module: 'dr-ops',
          feature: 'dr_switchover',
          action: isFailover
            ? DR_AUDIT_ACTIONS.FAILOVER_COMPLETED
            : DR_AUDIT_ACTIONS.FAILBACK_COMPLETED,
          resourceType: 'DR_SWITCH_EXECUTION',
          resourceId: saved.switchCode,
          actorUserId: input.actorUserId ?? null,
          actorIdentifier: actorName,
          afterData: {
            switchCode: saved.switchCode,
            status: saved.status,
            actualRtoSeconds,
            rtoMet: rtoEval.met,
          },
        })
        .catch(() => undefined);
    }

    return DrOpsResponseMapper.toSwitchExecutionView(saved);
  }

  public async abortSwitch(
    switchId: number,
    input: { reason: string; actorUserId?: number | null | undefined; actorName: string },
  ): Promise<DrSwitchExecutionView> {
    const entity = await this.switchRepo.findByIdSafe(switchId);
    if (!entity) {
      throw new DrSwitchNotFoundException(switchId);
    }
    if (entity.status !== DR_SWITCH_STATUS.IN_PROGRESS) {
      throw new DrSwitchGuardException(
        `Cannot abort switch execution in status ${entity.status}`,
      );
    }

    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - new Date(entity.startedAt).getTime());
    const actorName = input.actorName?.trim() || 'system-console-operator';

    entity.status = DR_SWITCH_STATUS.ABORTED;
    entity.completedAt = completedAt;
    entity.durationMs = durationMs;
    entity.completedByName = actorName;
    entity.errorMessage = `Aborted: ${input.reason.trim()}`;
    const saved = await this.switchRepo.saveEntity(entity);

    const profile = await this.profileService.getOrCreateDefaultProfile();
    if (entity.mode === DR_SWITCH_MODE.LIVE && this.profileRepo.isDatabaseReady()) {
      profile.operationalState =
        profile.activeSite === DR_SITE_ROLE.DR
          ? DR_OPERATIONAL_STATE.RUNNING_ON_DR
          : DR_OPERATIONAL_STATE.NORMAL;
      await this.profileRepo.saveEntity(profile);
    }

    await this.alertService.publishEvent(
      DR_DOMAIN_EVENTS.SWITCH_ABORTED,
      'DrSwitchExecution',
      saved.switchCode,
      {
        switchCode: saved.switchCode,
        direction: saved.direction,
        reason: input.reason.trim(),
        actorName,
      },
    );

    if (this.auditLog) {
      await this.auditLog
        .record({
          module: 'dr-ops',
          feature: 'dr_switchover',
          action: DR_AUDIT_ACTIONS.SWITCH_ABORTED,
          resourceType: 'DR_SWITCH_EXECUTION',
          resourceId: saved.switchCode,
          actorUserId: input.actorUserId ?? null,
          actorIdentifier: actorName,
          afterData: {
            switchCode: saved.switchCode,
            status: saved.status,
            reason: input.reason.trim(),
          },
        })
        .catch(() => undefined);
    }

    return DrOpsResponseMapper.toSwitchExecutionView(saved);
  }

  public async getSwitchById(id: number): Promise<DrSwitchExecutionView> {
    const entity = await this.switchRepo.findByIdSafe(id);
    if (!entity) {
      throw new DrSwitchNotFoundException(id);
    }
    return DrOpsResponseMapper.toSwitchExecutionView(entity);
  }

  public async listSwitches(
    filter: ListDrSwitchesFilter,
  ): Promise<PaginatedResult<DrSwitchExecutionView>> {
    const page = await this.switchRepo.listPaginated(filter);
    return {
      ...page,
      data: page.data.map((item) => DrOpsResponseMapper.toSwitchExecutionView(item)),
    };
  }
}
