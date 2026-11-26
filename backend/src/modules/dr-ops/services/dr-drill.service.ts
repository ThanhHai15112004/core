import { randomUUID } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { DR_DOMAIN_EVENTS, type PaginatedResult } from '@packages/kernel/index.js';
import { AuditLogService } from '@packages/security/index.js';
import {
  DR_AUDIT_ACTIONS,
  DR_CHECKLIST_STEP_STATUS,
  DR_DRILL_STATUS,
  DR_DRILL_TYPE,
  DR_RECONCILE_STATUS,
  DR_SWITCH_DIRECTION,
  DR_SWITCH_MODE,
  DR_SYNC_SCOPE,
  DR_SYNC_TRIGGER,
  type DrDrillStatus,
  type DrDrillType,
} from '../enum/dr-ops.enum.js';
import { evaluateRpoCompliance, evaluateRtoCompliance } from '../helpers/dr-checklist.helper.js';
import { DrDrillRepository, type ListDrDrillsFilter } from '../repositories/dr-drill.repository.js';
import { DrProfileRepository } from '../repositories/dr-profile.repository.js';
import { DrOpsResponseMapper } from '../responses/dr-ops.response.js';
import type { DrDrillView } from '../types/dr-ops.types.js';
import { DrAlertService } from './dr-alert.service.js';
import { DrProfileService } from './dr-profile.service.js';
import { DrReconciliationService } from './dr-reconciliation.service.js';
import { DrSwitchoverService } from './dr-switchover.service.js';
import { DrSyncService } from './dr-sync.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DrDrillService {
  private readonly logger = new Logger(DrDrillService.name);

  constructor(
    private readonly config: CoreConfigService,
    private readonly profileService: DrProfileService,
    private readonly profileRepo: DrProfileRepository,
    private readonly drillRepo: DrDrillRepository,
    private readonly syncService: DrSyncService,
    private readonly switchoverService: DrSwitchoverService,
    private readonly reconciliationService: DrReconciliationService,
    private readonly alertService: DrAlertService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  /** Chạy diễn tập DR định kỳ hoặc thủ công: kiểm tra sync (RPO) + mô phỏng chuyển site (RTO) + đối soát. */
  public async runDrill(input?: {
    drillType?: DrDrillType | undefined;
    scenario?: string | undefined;
    measuredRpoSeconds?: number | undefined;
    measuredRtoSeconds?: number | undefined;
    lessonsLearned?: string | undefined;
    actorUserId?: number | null | undefined;
    actorName?: string | null | undefined;
  }): Promise<DrDrillView> {
    const profile = await this.profileService.getOrCreateDefaultProfile();
    const drillType = input?.drillType ?? DR_DRILL_TYPE.MANUAL_SIMULATION;
    const scenario =
      input?.scenario?.trim() || 'Diễn tập chuyển đổi DC chính → DR và đo RTO/RPO thực tế';
    const actorName = input?.actorName?.trim() || 'system-dr-drill';
    const startedAt = new Date();
    const drillCode = `DRD-${startedAt.toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;

    const steps: Array<{ name: string; status: string; durationMs: number; detail?: string }> = [];
    let switchExecutionId: number | null = null;
    let reconciliationReportId: number | null = null;
    let computedRpoSeconds: number | null = input?.measuredRpoSeconds ?? null;
    let computedRtoSeconds: number | null = input?.measuredRtoSeconds ?? null;
    let errorMessage: string | null = null;

    try {
      // Bước 1: Kiểm tra đồng bộ & đo RPO hiện hành
      const s1Start = Date.now();
      const syncRes = await this.syncService.runSync({
        scope: DR_SYNC_SCOPE.FULL,
        triggerSource: DR_SYNC_TRIGGER.PRE_SWITCH,
        actorUserId: input?.actorUserId,
        actorName,
      });
      if (computedRpoSeconds === null) {
        computedRpoSeconds = syncRes.actualRpoSeconds;
      }
      steps.push({
        name: 'sync_and_rpo_check',
        status: syncRes.rpoMet ? 'PASSED' : 'WARNING',
        durationMs: Date.now() - s1Start,
        detail: `sync=${syncRes.syncCode}, rpo=${syncRes.actualRpoSeconds ?? 'unknown'}s`,
      });

      // Bước 2: Mô phỏng Failover checklist (khi là SIMULATION)
      if (
        drillType === DR_DRILL_TYPE.MANUAL_SIMULATION ||
        drillType === DR_DRILL_TYPE.SCHEDULED_SIMULATION
      ) {
        const s2Start = Date.now();
        const sw = await this.switchoverService.initiateSwitch({
          direction: DR_SWITCH_DIRECTION.FAILOVER,
          mode: DR_SWITCH_MODE.SIMULATED,
          reason: `DR Drill (${drillCode}): ${scenario}`,
          actorUserId: input?.actorUserId,
          actorName,
        });
        switchExecutionId = sw.id;

        for (const item of sw.checklist) {
          if (item.required) {
            await this.switchoverService.updateChecklistStep(sw.id, item.stepKey, {
              status: DR_CHECKLIST_STEP_STATUS.COMPLETED,
              note: `Verified in DR drill ${drillCode}`,
              actorUserId: input?.actorUserId,
              actorName,
            });
          }
        }

        // Bước 3: Đối soát sau chuyển hệ thống
        const s3Start = Date.now();
        const rec = await this.reconciliationService.runReconciliation({
          scope: DR_SYNC_SCOPE.FULL,
          switchExecutionId: sw.id,
          actorUserId: input?.actorUserId,
          actorName,
        });
        reconciliationReportId = rec.id;
        steps.push({
          name: 'post_switch_reconciliation',
          status: rec.status === DR_RECONCILE_STATUS.PASSED ? 'PASSED' : 'WARNING',
          durationMs: Date.now() - s3Start,
          detail: `report=${rec.reportCode}, discrepancies=${rec.totalDiscrepancies}`,
        });

        const completedSwitch = await this.switchoverService.completeSwitch(sw.id, {
          reconciliationReportId: rec.id,
          actorUserId: input?.actorUserId,
          actorName,
        });
        steps.push({
          name: 'simulated_failover_checklist',
          status: 'PASSED',
          durationMs: Date.now() - s2Start,
          detail: `switch=${completedSwitch.switchCode}`,
        });
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      steps.push({
        name: 'drill_execution_error',
        status: 'FAILED',
        durationMs: Math.max(0, Date.now() - startedAt.getTime()),
        detail: errorMessage,
      });
    }

    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
    if (computedRtoSeconds === null) {
      computedRtoSeconds = Math.max(0, Math.round(durationMs / 1000));
    }

    const rpoEval = evaluateRpoCompliance(computedRpoSeconds, profile.rpoTargetSeconds);
    const rtoEval = evaluateRtoCompliance(computedRtoSeconds, profile.rtoTargetSeconds);
    const passed = errorMessage === null && rpoEval.met && rtoEval.met;
    const status: DrDrillStatus = passed ? DR_DRILL_STATUS.PASSED : DR_DRILL_STATUS.FAILED;

    const saved = await this.drillRepo.saveEntity({
      drillCode,
      profileCode: profile.code,
      drillType,
      scenario,
      status,
      rpoTargetSeconds: profile.rpoTargetSeconds,
      rtoTargetSeconds: profile.rtoTargetSeconds,
      measuredRpoSeconds: computedRpoSeconds,
      measuredRtoSeconds: computedRtoSeconds,
      rpoMet: rpoEval.met,
      rtoMet: rtoEval.met,
      switchExecutionId,
      reconciliationReportId,
      stepsJson: JSON.stringify(steps),
      lessonsLearned: input?.lessonsLearned?.trim() || null,
      actorUserId: input?.actorUserId ?? null,
      actorName,
      startedAt,
      completedAt,
      durationMs,
      errorMessage,
    });

    profile.lastDrillAt = completedAt;
    profile.lastRtoSeconds = computedRtoSeconds;
    profile.nextDrillDueAt = new Date(completedAt.getTime() + profile.drillIntervalDays * DAY_MS);
    if (this.profileRepo.isDatabaseReady()) {
      await this.profileRepo.saveEntity(profile);
    }

    if (passed) {
      await this.alertService.publishEvent(
        DR_DOMAIN_EVENTS.DRILL_PASSED,
        'DrDrill',
        saved.drillCode,
        {
          drillCode: saved.drillCode,
          measuredRpoSeconds: computedRpoSeconds,
          measuredRtoSeconds: computedRtoSeconds,
        },
      );
    } else {
      await this.alertService.emitAlert({
        eventName: DR_DOMAIN_EVENTS.DRILL_FAILED,
        alertCode: 'DR_DRILL_FAILED',
        title: `Diễn tập DR không đạt mục tiêu (${saved.drillCode})`,
        description: `RPO=${computedRpoSeconds ?? 'N/A'}s (mục tiêu ${profile.rpoTargetSeconds}s), RTO=${computedRtoSeconds}s (mục tiêu ${profile.rtoTargetSeconds}s).${errorMessage ? ` Lỗi: ${errorMessage}` : ''}`,
        severity: 'P1',
        aggregateId: saved.drillCode,
        metadata: {
          drillCode: saved.drillCode,
          measuredRpoSeconds: computedRpoSeconds,
          measuredRtoSeconds: computedRtoSeconds,
        },
      });
    }

    if (this.auditLog) {
      await this.auditLog
        .record({
          module: 'dr-ops',
          feature: 'dr_drill',
          action: DR_AUDIT_ACTIONS.DRILL_EXECUTED,
          resourceType: 'DR_DRILL',
          resourceId: saved.drillCode,
          actorUserId: input?.actorUserId ?? null,
          actorIdentifier: actorName,
          afterData: {
            drillCode: saved.drillCode,
            status,
            measuredRpoSeconds: computedRpoSeconds,
            measuredRtoSeconds: computedRtoSeconds,
            rpoMet: rpoEval.met,
            rtoMet: rtoEval.met,
          },
        })
        .catch(() => undefined);
    }

    return DrOpsResponseMapper.toDrillView(saved);
  }

  /** Kiểm tra hạn diễn tập định kỳ; nếu quá hạn sẽ chạy tự động hoặc phát cảnh báo quá hạn. */
  public async runScheduledDrillCheck(): Promise<
    DrDrillView | { overdue: boolean; action: string; nextDrillDueAt: string | null }
  > {
    const profile = await this.profileService.getOrCreateDefaultProfile();
    if (!this.config.dr.enabled && !profile.isEnabled) {
      this.logger.debug('Skipping DR scheduled drill check because DR is disabled');
      return {
        overdue: false,
        action: 'skipped_dr_disabled',
        nextDrillDueAt: profile.nextDrillDueAt
          ? new Date(profile.nextDrillDueAt).toISOString()
          : null,
      };
    }

    const dueAtMs = profile.nextDrillDueAt ? new Date(profile.nextDrillDueAt).getTime() : 0;
    const isOverdue = dueAtMs === 0 || dueAtMs <= Date.now();
    if (!isOverdue) {
      return {
        overdue: false,
        action: 'not_due',
        nextDrillDueAt: profile.nextDrillDueAt
          ? new Date(profile.nextDrillDueAt).toISOString()
          : null,
      };
    }

    if (this.config.dr.autoExecuteScheduledDrill) {
      return this.runDrill({
        drillType: DR_DRILL_TYPE.SCHEDULED_SIMULATION,
        scenario: 'Scheduled periodic DR simulation drill',
        actorName: 'scheduler-dr-drill',
      });
    }

    await this.alertService.emitAlert({
      eventName: DR_DOMAIN_EVENTS.DRILL_OVERDUE,
      alertCode: 'DR_DRILL_OVERDUE',
      title: 'Quá hạn diễn tập Disaster Recovery định kỳ',
      description: `Hồ sơ DR ${profile.code} đã quá hạn diễn tập định kỳ (chu kỳ ${profile.drillIntervalDays} ngày). Vui lòng tổ chức DR Drill để đo RTO/RPO thực tế.`,
      severity: 'P2',
      aggregateId: profile.code,
      metadata: {
        nextDrillDueAt: profile.nextDrillDueAt
          ? new Date(profile.nextDrillDueAt).toISOString()
          : null,
      },
    });

    return {
      overdue: true,
      action: 'alert_emitted',
      nextDrillDueAt: profile.nextDrillDueAt
        ? new Date(profile.nextDrillDueAt).toISOString()
        : null,
    };
  }

  public async listDrills(filter: ListDrDrillsFilter): Promise<PaginatedResult<DrDrillView>> {
    const page = await this.drillRepo.listPaginated(filter);
    return {
      ...page,
      data: page.data.map((item) => DrOpsResponseMapper.toDrillView(item)),
    };
  }
}
