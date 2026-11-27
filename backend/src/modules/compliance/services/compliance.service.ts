import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  COMPLIANCE_DOMAIN_EVENTS,
  DomainEventBusService,
  FeatureFlagRegistryService,
  SettingRegistryService,
  createDomainEvent,
  defaultDomainEventBus,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  type INotificationsPublicService,
  NOTIFICATIONS_PUBLIC_SERVICE,
} from '@modules/notifications/contracts/index.js';
import type { ICompliancePublicService } from '../contracts/index.js';
import {
  ASSESSMENT_APPROVAL_STATUS,
  COMPLIANCE_DUE_STATUS,
  COMPLIANCE_RISK_LEVEL,
  CONTROL_CHECK_RESULT,
  CONTROL_STATUS,
  EVIDENCE_STATUS,
  VENDOR_CATEGORY,
  VENDOR_STATUS,
  type VendorCategory,
} from '../enum/compliance.enum.js';
import {
  assertComplianceEnabled,
  resolveComplianceRuntimeConfig,
} from '../helpers/compliance-config.helper.js';
import { classifyDueStatus, computeDaysUntil } from '../helpers/compliance.helper.js';
import { ComplianceEvidenceRepository } from '../repositories/compliance-evidence.repository.js';
import type {
  ComplianceReportQuery,
  CreateControlRequest,
  CreateEvidenceRequest,
  CreateVendorDataAssessmentRequest,
  CreateVendorRequest,
  GenerateComplianceReportRequest,
  ListCheckHistoriesQuery,
  ListControlsQuery,
  ListEvidencesQuery,
  ListVendorsQuery,
  RecordControlCheckRequest,
  UpdateControlRequest,
  UpdateVendorDataAssessmentRequest,
  UpdateVendorRequest,
} from '../requests/compliance.requests.js';
import type {
  ComplianceCheckHistoryView,
  ComplianceControlView,
  ComplianceDueItemSummary,
  ComplianceEvidenceView,
  ComplianceOverviewView,
  ComplianceReportDownloadView,
  ComplianceReportResultView,
  ComplianceReviewSweepResult,
  ComplianceVendorView,
  VendorDataAssessmentView,
} from '../types/compliance.types.js';
import { ComplianceControlService } from './compliance-control.service.js';
import { ComplianceEvidenceService } from './compliance-evidence.service.js';
import { ComplianceReportService } from './compliance-report.service.js';
import { ComplianceVendorService } from './compliance-vendor.service.js';

@Injectable()
export class ComplianceService implements ICompliancePublicService {
  private readonly settingRegistry: SettingRegistryService;
  private readonly featureFlagRegistry: FeatureFlagRegistryService;
  private readonly eventBus: DomainEventBusService;

  constructor(
    private readonly controlService: ComplianceControlService,
    private readonly evidenceService: ComplianceEvidenceService,
    private readonly vendorService: ComplianceVendorService,
    private readonly reportService: ComplianceReportService,
    private readonly evidenceRepo: ComplianceEvidenceRepository,
    @Optional()
    @Inject(NOTIFICATIONS_PUBLIC_SERVICE)
    private readonly notificationsService?: INotificationsPublicService | null,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() featureFlagRegistry?: FeatureFlagRegistryService,
    @Optional() eventBus?: DomainEventBusService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.featureFlagRegistry = featureFlagRegistry ?? defaultFeatureFlagRegistry;
    this.eventBus = eventBus ?? defaultDomainEventBus;
  }

  public async getOverview(now: Date = new Date()): Promise<ComplianceOverviewView> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertComplianceEnabled(cfg);

    const [controls, evidences, checks, vendors, assessments] = await Promise.all([
      this.controlService.listAllControlsForAggregation(now),
      this.evidenceService.listAllEvidencesForAggregation(),
      this.controlService.listAllChecksForAggregation(),
      this.vendorService.listAllVendorsForAggregation(now),
      this.vendorService.listAllAssessmentsForAggregation(),
    ]);

    const activeControls = controls.filter((c) => c.status === CONTROL_STATUS.ACTIVE);
    const overdueControls = activeControls.filter(
      (c) => c.dueStatus === COMPLIANCE_DUE_STATUS.OVERDUE,
    );
    const dueSoonControls = activeControls.filter(
      (c) => c.dueStatus === COMPLIANCE_DUE_STATUS.DUE_SOON,
    );
    const passedControls = activeControls.filter(
      (c) => c.lastCheckResult === CONTROL_CHECK_RESULT.PASS,
    ).length;
    const applicableControls = activeControls.filter(
      (c) => c.lastCheckResult !== CONTROL_CHECK_RESULT.NOT_APPLICABLE,
    );
    const passRatePercent =
      applicableControls.length > 0
        ? Number(((passedControls / applicableControls.length) * 100).toFixed(2))
        : 100;

    const vendorsByCategory: Record<VendorCategory, number> = {
      [VENDOR_CATEGORY.EMAIL]: 0,
      [VENDOR_CATEGORY.SMS]: 0,
      [VENDOR_CATEGORY.CLOUD]: 0,
      [VENDOR_CATEGORY.PAYMENT]: 0,
      [VENDOR_CATEGORY.AI]: 0,
      [VENDOR_CATEGORY.OTHER]: 0,
    };
    for (const v of vendors) {
      vendorsByCategory[v.category] = (vendorsByCategory[v.category] ?? 0) + 1;
    }

    const activeVendors = vendors.filter((v) => v.status !== VENDOR_STATUS.OFFBOARDED);
    const vendorsMissingFallback = activeVendors.filter((v) => !v.hasFallbackPlan).length;
    const expiringContractsCount = activeVendors.filter(
      (v) =>
        v.contractDueStatus === COMPLIANCE_DUE_STATUS.OVERDUE ||
        v.contractDueStatus === COMPLIANCE_DUE_STATUS.DUE_SOON,
    ).length;
    const overdueVendorReviewsCount = activeVendors.filter(
      (v) => v.reviewDueStatus === COMPLIANCE_DUE_STATUS.OVERDUE,
    ).length;
    const highRiskDataAssessmentsCount = assessments.filter(
      (a) =>
        (a.riskLevel === COMPLIANCE_RISK_LEVEL.HIGH ||
          a.riskLevel === COMPLIANCE_RISK_LEVEL.CRITICAL) &&
        a.approvalStatus !== ASSESSMENT_APPROVAL_STATUS.REJECTED,
    ).length;

    const frameworkStats = new Map<string, { totalControls: number; passingControls: number }>();
    for (const c of activeControls) {
      for (const tag of c.frameworkTags) {
        const prefix = tag.split(':')[0]?.trim() || tag;
        const current = frameworkStats.get(prefix) ?? { totalControls: 0, passingControls: 0 };
        current.totalControls += 1;
        if (c.lastCheckResult === CONTROL_CHECK_RESULT.PASS) {
          current.passingControls += 1;
        }
        frameworkStats.set(prefix, current);
      }
    }

    const frameworkCoverage = [...frameworkStats.entries()]
      .map(([frameworkTag, stats]) => ({
        frameworkTag,
        totalControls: stats.totalControls,
        passingControls: stats.passingControls,
        passRatePercent:
          stats.totalControls > 0
            ? Number(((stats.passingControls / stats.totalControls) * 100).toFixed(2))
            : 100,
      }))
      .sort((a, b) => b.totalControls - a.totalControls);

    const upcomingAndOverdueItems = this.collectDueItems(controls, vendors, evidences, cfg, now);

    return {
      moduleEnabled: cfg.moduleEnabled,
      controlsEnabled: cfg.controlsEnabled,
      vendorsEnabled: cfg.vendorsEnabled,
      reportsEnabled: cfg.reportsEnabled,
      settings: {
        reviewReminderDaysBefore: cfg.reviewReminderDaysBefore,
        contractExpiringDaysBefore: cfg.contractExpiringDaysBefore,
        evidenceExpiringDaysBefore: cfg.evidenceExpiringDaysBefore,
        reportFileTtlSeconds: cfg.reportFileTtlSeconds,
      },
      counts: {
        totalControls: controls.length,
        activeControls: activeControls.length,
        overdueControls: overdueControls.length,
        dueSoonControls: dueSoonControls.length,
        passRatePercent,
        totalEvidences: evidences.length,
        validEvidences: evidences.filter((e) => e.status === EVIDENCE_STATUS.VALID).length,
        totalChecks: checks.length,
        totalVendors: vendors.length,
        vendorsByCategory,
        vendorsMissingFallback,
        expiringContractsCount,
        overdueVendorReviewsCount,
        highRiskDataAssessmentsCount,
      },
      frameworkCoverage,
      upcomingAndOverdueItems: upcomingAndOverdueItems.slice(0, 20),
    };
  }

  public async runReviewReminderSweep(options?: {
    readonly dryRun?: boolean | undefined;
    readonly now?: Date | undefined;
  }): Promise<ComplianceReviewSweepResult> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertComplianceEnabled(cfg);

    const now = options?.now ?? new Date();
    const dryRun = Boolean(options?.dryRun);

    const [controls, vendors, evidenceEntities] = await Promise.all([
      this.controlService.listAllControlsForAggregation(now),
      this.vendorService.listAllVendorsForAggregation(now),
      this.evidenceRepo.findAll(),
    ]);

    let evidencesMarkedExpired = 0;
    if (!dryRun) {
      for (const ev of evidenceEntities) {
        if (
          ev.status === EVIDENCE_STATUS.VALID &&
          ev.validUntil &&
          ev.validUntil.getTime() < now.getTime()
        ) {
          ev.status = EVIDENCE_STATUS.EXPIRED;
          await this.evidenceRepo.saveEntity(ev);
          evidencesMarkedExpired += 1;
        }
      }
    }

    const evidences = await this.evidenceService.listAllEvidencesForAggregation();
    const dueItems = this.collectDueItems(controls, vendors, evidences, cfg, now);

    const controlsDueOrOverdue = dueItems.filter((i) => i.kind === 'CONTROL_CHECK').length;
    const vendorReviewsDueOrOverdue = dueItems.filter((i) => i.kind === 'VENDOR_REVIEW').length;
    const contractsExpiringOrExpired = dueItems.filter((i) => i.kind === 'VENDOR_CONTRACT').length;
    const evidencesExpiring = dueItems.filter((i) => i.kind === 'EVIDENCE_EXPIRY').length;

    let notificationsDispatched = 0;
    if (!dryRun) {
      for (const item of dueItems) {
        const eventType =
          item.kind === 'VENDOR_CONTRACT'
            ? COMPLIANCE_DOMAIN_EVENTS.CONTRACT_EXPIRING
            : COMPLIANCE_DOMAIN_EVENTS.REVIEW_DUE;

        await this.eventBus
          .publish(
            createDomainEvent({
              type: eventType,
              sourceModule: 'compliance',
              actorId: null,
              aggregateType: item.kind.toLowerCase(),
              aggregateId: String(item.entityId),
              payload: {
                kind: item.kind,
                code: item.code,
                title: item.title,
                dueAt: item.dueAt,
                daysRemaining: item.daysRemaining,
                dueStatus: item.dueStatus,
              },
            }),
          )
          .catch(() => undefined);

        if (item.ownerUserId && this.notificationsService) {
          await this.notificationsService
            .dispatch({
              title: `[Compliance] ${item.code}: sắp/đã đến hạn rà soát`,
              content: `${item.title} (${item.kind}) — hạn ${item.dueAt.slice(0, 10)} (còn ${item.daysRemaining} ngày).`,
              category: 'SYSTEM',
              priority: item.dueStatus === COMPLIANCE_DUE_STATUS.OVERDUE ? 'HIGH' : 'NORMAL',
              targetType: 'SINGLE_USER',
              userId: item.ownerUserId,
              channels: ['IN_APP'],
              referenceModule: 'compliance',
              referenceType: item.kind.toLowerCase(),
              referenceId: String(item.entityId),
            })
            .then(() => {
              notificationsDispatched += 1;
            })
            .catch(() => undefined);
        }
      }

      if (this.auditLogService) {
        await this.auditLogService.record({
          module: 'compliance',
          feature: 'review_sweep',
          action: 'COMPLIANCE_REVIEW_SWEEP_EXECUTED',
          actorId: null,
          resourceType: 'compliance_sweep',
          resourceId: now.toISOString(),
          afterData: {
            controlsDueOrOverdue,
            vendorReviewsDueOrOverdue,
            contractsExpiringOrExpired,
            evidencesExpiring,
            evidencesMarkedExpired,
            notificationsDispatched,
          },
        });
      }
    }

    return {
      executedAt: now.toISOString(),
      dryRun,
      controlsDueOrOverdue,
      vendorReviewsDueOrOverdue,
      contractsExpiringOrExpired,
      evidencesExpiring,
      evidencesMarkedExpired,
      notificationsDispatched,
      items: dueItems,
    };
  }

  public listControls(query: ListControlsQuery): Promise<PaginatedResult<ComplianceControlView>> {
    return this.controlService.listControls(query);
  }

  public getControlById(id: number): Promise<ComplianceControlView> {
    return this.controlService.getControlById(id);
  }

  public createControl(
    dto: CreateControlRequest,
    actor?: UserIdentity,
  ): Promise<ComplianceControlView> {
    return this.controlService.createControl(dto, actor);
  }

  public updateControl(
    id: number,
    dto: UpdateControlRequest,
    actor?: UserIdentity,
  ): Promise<ComplianceControlView> {
    return this.controlService.updateControl(id, dto, actor);
  }

  public deleteControl(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.controlService.deleteControl(id, actor);
  }

  public recordControlCheck(
    controlId: number,
    dto: RecordControlCheckRequest,
    actor: UserIdentity,
  ): Promise<ComplianceCheckHistoryView> {
    return this.controlService.recordCheck(controlId, dto, actor);
  }

  public listCheckHistories(
    query: ListCheckHistoriesQuery,
  ): Promise<PaginatedResult<ComplianceCheckHistoryView>> {
    return this.controlService.listCheckHistories(query);
  }

  public listEvidences(
    query: ListEvidencesQuery,
  ): Promise<PaginatedResult<ComplianceEvidenceView>> {
    return this.evidenceService.listEvidences(query);
  }

  public createEvidence(
    dto: CreateEvidenceRequest,
    actor: UserIdentity,
  ): Promise<ComplianceEvidenceView> {
    return this.evidenceService.createEvidence(dto, actor);
  }

  public deleteEvidence(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.evidenceService.deleteEvidence(id, actor);
  }

  public listVendors(query: ListVendorsQuery): Promise<PaginatedResult<ComplianceVendorView>> {
    return this.vendorService.listVendors(query);
  }

  public getVendorById(id: number): Promise<ComplianceVendorView> {
    return this.vendorService.getVendorById(id);
  }

  public createVendor(
    dto: CreateVendorRequest,
    actor?: UserIdentity,
  ): Promise<ComplianceVendorView> {
    return this.vendorService.createVendor(dto, actor);
  }

  public updateVendor(
    id: number,
    dto: UpdateVendorRequest,
    actor?: UserIdentity,
  ): Promise<ComplianceVendorView> {
    return this.vendorService.updateVendor(id, dto, actor);
  }

  public deleteVendor(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.vendorService.deleteVendor(id, actor);
  }

  public listVendorDataAssessments(vendorId: number): Promise<VendorDataAssessmentView[]> {
    return this.vendorService.listVendorDataAssessments(vendorId);
  }

  public createVendorDataAssessment(
    vendorId: number,
    dto: CreateVendorDataAssessmentRequest,
    actor: UserIdentity,
  ): Promise<VendorDataAssessmentView> {
    return this.vendorService.createVendorDataAssessment(vendorId, dto, actor);
  }

  public updateVendorDataAssessment(
    id: number,
    dto: UpdateVendorDataAssessmentRequest,
    actor: UserIdentity,
  ): Promise<VendorDataAssessmentView> {
    return this.vendorService.updateVendorDataAssessment(id, dto, actor);
  }

  public deleteVendorDataAssessment(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    return this.vendorService.deleteVendorDataAssessment(id, actor);
  }

  public getSummaryReport(
    query: ComplianceReportQuery,
    actor?: UserIdentity,
  ): Promise<ComplianceReportResultView> {
    return this.reportService.getComplianceSummaryReport(query, actor);
  }

  public generateReport(
    dto: GenerateComplianceReportRequest,
    actor?: UserIdentity,
  ): Promise<ComplianceReportResultView> {
    return this.reportService.generateComplianceReport(dto, actor);
  }

  public downloadReportArtifact(token: string): ComplianceReportDownloadView {
    return this.reportService.downloadReportArtifact(token);
  }

  private collectDueItems(
    controls: readonly ComplianceControlView[],
    vendors: readonly ComplianceVendorView[],
    evidences: readonly ComplianceEvidenceView[],
    cfg: ReturnType<typeof resolveComplianceRuntimeConfig>,
    now: Date,
  ): ComplianceDueItemSummary[] {
    const items: ComplianceDueItemSummary[] = [];

    for (const c of controls) {
      if (c.status !== CONTROL_STATUS.ACTIVE || !c.nextCheckDueAt) continue;
      if (
        c.dueStatus === COMPLIANCE_DUE_STATUS.OVERDUE ||
        c.dueStatus === COMPLIANCE_DUE_STATUS.DUE_SOON
      ) {
        items.push({
          kind: 'CONTROL_CHECK',
          entityId: c.id,
          code: c.controlCode,
          title: c.title,
          ownerUserId: c.ownerUserId,
          dueAt: c.nextCheckDueAt,
          daysRemaining: c.daysUntilDue ?? 0,
          dueStatus: c.dueStatus,
        });
      }
    }

    for (const v of vendors) {
      if (v.status === VENDOR_STATUS.OFFBOARDED) continue;
      if (
        v.nextReviewDueAt &&
        (v.reviewDueStatus === COMPLIANCE_DUE_STATUS.OVERDUE ||
          v.reviewDueStatus === COMPLIANCE_DUE_STATUS.DUE_SOON)
      ) {
        items.push({
          kind: 'VENDOR_REVIEW',
          entityId: v.id,
          code: v.vendorCode,
          title: `${v.name} (Rà soát định kỳ)`,
          ownerUserId: v.ownerUserId,
          dueAt: v.nextReviewDueAt,
          daysRemaining: v.daysUntilReviewDue ?? 0,
          dueStatus: v.reviewDueStatus,
        });
      }
      if (
        v.contractEndDate &&
        (v.contractDueStatus === COMPLIANCE_DUE_STATUS.OVERDUE ||
          v.contractDueStatus === COMPLIANCE_DUE_STATUS.DUE_SOON)
      ) {
        items.push({
          kind: 'VENDOR_CONTRACT',
          entityId: v.id,
          code: v.vendorCode,
          title: `${v.name} (Hết hạn hợp đồng)`,
          ownerUserId: v.ownerUserId,
          dueAt: v.contractEndDate,
          daysRemaining: v.daysUntilContractEnd ?? 0,
          dueStatus: v.contractDueStatus,
        });
      }
    }

    for (const ev of evidences) {
      if (ev.status !== EVIDENCE_STATUS.VALID || !ev.validUntil) continue;
      const validUntil = new Date(ev.validUntil);
      const dueStatus = classifyDueStatus(validUntil, cfg.evidenceExpiringDaysBefore, now);
      if (
        dueStatus === COMPLIANCE_DUE_STATUS.OVERDUE ||
        dueStatus === COMPLIANCE_DUE_STATUS.DUE_SOON
      ) {
        items.push({
          kind: 'EVIDENCE_EXPIRY',
          entityId: ev.id,
          code: `EV-${ev.id}`,
          title: ev.title,
          ownerUserId: ev.collectedByUserId,
          dueAt: ev.validUntil,
          daysRemaining: computeDaysUntil(validUntil, now) ?? 0,
          dueStatus,
        });
      }
    }

    return items.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }
}
