import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { DR_DOMAIN_EVENTS } from '@packages/kernel/index.js';
import { AuditLogService } from '@packages/security/index.js';
import {
  DR_AUDIT_ACTIONS,
  DR_DRILL_STATUS,
  DR_OPERATIONAL_STATE,
  DR_RECONCILE_STATUS,
  DR_SITE_ROLE,
  DR_SYNC_STATUS,
} from '../enum/dr-ops.enum.js';
import { evaluateRpoCompliance, evaluateRtoCompliance } from '../helpers/dr-checklist.helper.js';
import { buildDrRunbook } from '../helpers/dr-runbook.helper.js';
import { DrDrillRepository } from '../repositories/dr-drill.repository.js';
import { DrProfileRepository } from '../repositories/dr-profile.repository.js';
import { DrReconciliationReportRepository } from '../repositories/dr-reconciliation-report.repository.js';
import { DrSwitchExecutionRepository } from '../repositories/dr-switch-execution.repository.js';
import { DrSyncRunRepository } from '../repositories/dr-sync-run.repository.js';
import type { UpdateDrProfileRequest } from '../requests/dr-ops.requests.js';
import { DrOpsResponseMapper } from '../responses/dr-ops.response.js';
import type {
  DrHealthStatus,
  DrOverviewView,
  DrProfileView,
  DrRunbookView,
} from '../types/dr-ops.types.js';
import type { DrProfileEntity } from '../entities/dr-profile.entity.js';
import { DrAlertService } from './dr-alert.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DrProfileService {
  constructor(
    private readonly config: CoreConfigService,
    private readonly profileRepo: DrProfileRepository,
    private readonly syncRepo: DrSyncRunRepository,
    private readonly switchRepo: DrSwitchExecutionRepository,
    private readonly reconcileRepo: DrReconciliationReportRepository,
    private readonly drillRepo: DrDrillRepository,
    private readonly alertService: DrAlertService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  /** Lấy hoặc khởi tạo hồ sơ DR mặc định (`DEFAULT`) từ `CoreConfigService.dr`. */
  public async getOrCreateDefaultProfile(): Promise<DrProfileEntity> {
    const existing = await this.profileRepo.findByCodeSafe('DEFAULT');
    if (existing) return existing;

    const cfg = this.config.dr;
    const nextDrillDueAt = new Date(Date.now() + cfg.drillIntervalDays * DAY_MS);

    const draft: Partial<DrProfileEntity> = {
      code: 'DEFAULT',
      name: 'Hồ sơ Disaster Recovery mặc định (DC chính ↔ DR dự phòng)',
      isEnabled: cfg.enabled,
      topologyMode: cfg.topologyMode,
      rpoTargetSeconds: cfg.rpoTargetSeconds,
      rtoTargetSeconds: cfg.rtoTargetSeconds,
      primarySiteCode: cfg.primarySite.code,
      primarySiteName: cfg.primarySite.name,
      primaryRegion: cfg.primarySite.region,
      primaryEndpoint: cfg.primarySite.endpoint || null,
      drSiteCode: cfg.drSite.code,
      drSiteName: cfg.drSite.name,
      drRegion: cfg.drSite.region,
      drEndpoint: cfg.drSite.endpoint || null,
      activeSite: DR_SITE_ROLE.PRIMARY,
      operationalState: DR_OPERATIONAL_STATE.NORMAL,
      syncCron: cfg.syncCron,
      drillIntervalDays: cfg.drillIntervalDays,
      lastSyncAt: null,
      lastRpoSeconds: null,
      lastDrillAt: null,
      lastRtoSeconds: null,
      nextDrillDueAt,
      optionsJson: null,
    };

    if (!this.profileRepo.isDatabaseReady()) {
      const now = new Date();
      return {
        ...(draft as DrProfileEntity),
        id: 0,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
    }

    return this.profileRepo.saveEntity(draft);
  }

  public async getProfile(): Promise<DrProfileView> {
    const entity = await this.getOrCreateDefaultProfile();
    return DrOpsResponseMapper.toProfileView(entity);
  }

  public async updateProfile(
    input: UpdateDrProfileRequest,
    actor?: { userId?: number | null | undefined; name?: string | null | undefined },
  ): Promise<DrProfileView> {
    const entity = await this.getOrCreateDefaultProfile();
    const before = DrOpsResponseMapper.toProfileView(entity);

    if (input.name !== undefined) entity.name = input.name;
    if (input.isEnabled !== undefined) entity.isEnabled = input.isEnabled;
    if (input.topologyMode !== undefined) entity.topologyMode = input.topologyMode;
    if (input.rpoTargetSeconds !== undefined) entity.rpoTargetSeconds = input.rpoTargetSeconds;
    if (input.rtoTargetSeconds !== undefined) entity.rtoTargetSeconds = input.rtoTargetSeconds;
    if (input.primarySiteCode !== undefined) entity.primarySiteCode = input.primarySiteCode;
    if (input.primarySiteName !== undefined) entity.primarySiteName = input.primarySiteName;
    if (input.primaryRegion !== undefined) entity.primaryRegion = input.primaryRegion;
    if (input.primaryEndpoint !== undefined) {
      entity.primaryEndpoint = input.primaryEndpoint || null;
    }
    if (input.drSiteCode !== undefined) entity.drSiteCode = input.drSiteCode;
    if (input.drSiteName !== undefined) entity.drSiteName = input.drSiteName;
    if (input.drRegion !== undefined) entity.drRegion = input.drRegion;
    if (input.drEndpoint !== undefined) entity.drEndpoint = input.drEndpoint || null;
    if (input.syncCron !== undefined) entity.syncCron = input.syncCron;
    if (input.drillIntervalDays !== undefined) {
      entity.drillIntervalDays = input.drillIntervalDays;
      const base = entity.lastDrillAt ? new Date(entity.lastDrillAt).getTime() : Date.now();
      entity.nextDrillDueAt = new Date(base + input.drillIntervalDays * DAY_MS);
    }

    const saved = this.profileRepo.isDatabaseReady()
      ? await this.profileRepo.saveEntity(entity)
      : entity;
    const after = DrOpsResponseMapper.toProfileView(saved);

    await this.alertService.publishEvent(DR_DOMAIN_EVENTS.PROFILE_UPDATED, 'DrProfile', saved.code, {
      isEnabled: after.isEnabled,
      topologyMode: after.topologyMode,
      rpoTargetSeconds: after.rpoTargetSeconds,
      rtoTargetSeconds: after.rtoTargetSeconds,
    });

    if (this.auditLog) {
      await this.auditLog
        .record({
          module: 'dr-ops',
          feature: 'dr_profile',
          action: DR_AUDIT_ACTIONS.PROFILE_UPDATED,
          resourceType: 'DR_PROFILE',
          resourceId: saved.code,
          actorUserId: actor?.userId ?? null,
          actorIdentifier: actor?.name ?? 'system-console-operator',
          beforeData: before as unknown as Record<string, unknown>,
          afterData: after as unknown as Record<string, unknown>,
        })
        .catch(() => undefined);
    }

    return after;
  }

  public async getOverview(): Promise<DrOverviewView> {
    const [profileEntity, latestSync, latestReconcile, latestDrill, activeSwitch] =
      await Promise.all([
        this.getOrCreateDefaultProfile(),
        this.syncRepo.findLatest('DEFAULT'),
        this.reconcileRepo.findLatest('DEFAULT'),
        this.drillRepo.findLatest('DEFAULT'),
        this.switchRepo.findActiveInProgress('DEFAULT'),
      ]);

    const profile = DrOpsResponseMapper.toProfileView(profileEntity);
    const configEnabled = this.config.dr.enabled;
    const effectiveEnabled = configEnabled || profile.isEnabled;

    const rpoEval = evaluateRpoCompliance(
      latestSync?.actualRpoSeconds ?? profile.lastRpoSeconds,
      profile.rpoTargetSeconds,
    );
    const rtoEval = evaluateRtoCompliance(
      latestDrill?.measuredRtoSeconds ?? profile.lastRtoSeconds,
      profile.rtoTargetSeconds,
    );

    const drillOverdue =
      effectiveEnabled &&
      profile.nextDrillDueAt !== null &&
      Date.parse(profile.nextDrillDueAt) <= Date.now();

    let healthStatus: DrHealthStatus = 'unknown';
    if (!effectiveEnabled) {
      healthStatus = 'disabled';
    } else if (
      latestSync?.status === DR_SYNC_STATUS.FAILED ||
      latestDrill?.status === DR_DRILL_STATUS.FAILED ||
      profile.operationalState === DR_OPERATIONAL_STATE.DEGRADED
    ) {
      healthStatus = 'critical';
    } else if (
      rpoEval.status === 'BREACHED' ||
      rtoEval.status === 'BREACHED' ||
      drillOverdue ||
      latestReconcile?.status === DR_RECONCILE_STATUS.DISCREPANCIES_FOUND ||
      latestSync?.status === DR_SYNC_STATUS.DEGRADED
    ) {
      healthStatus = 'warning';
    } else if (latestSync?.status === DR_SYNC_STATUS.SUCCESS) {
      healthStatus = 'healthy';
    }

    return {
      configEnabled,
      effectiveEnabled,
      liveSwitchEnabled: this.config.dr.liveSwitchEnabled,
      healthStatus,
      rpoStatus: rpoEval.status,
      rtoStatus: rtoEval.status,
      drillOverdue,
      profile,
      latestSync: latestSync ? DrOpsResponseMapper.toSyncRunView(latestSync) : null,
      latestReconciliation: latestReconcile
        ? DrOpsResponseMapper.toReconciliationView(latestReconcile)
        : null,
      latestDrill: latestDrill ? DrOpsResponseMapper.toDrillView(latestDrill) : null,
      activeSwitch: activeSwitch ? DrOpsResponseMapper.toSwitchExecutionView(activeSwitch) : null,
      storageDrConfigured:
        this.config.dr.storage.driver === 's3'
          ? Boolean(this.config.dr.storage.s3Bucket)
          : Boolean(this.config.dr.storage.localPath),
      dbDrConfigured: Boolean(this.config.dr.db.host || this.config.database.readReplicas.length),
    };
  }

  public getRunbook(): DrRunbookView {
    return buildDrRunbook();
  }
}
