import { Injectable, Optional } from '@nestjs/common';
import {
  DataGovernanceHookRegistry,
  FeatureFlagRegistryService,
  SettingRegistryService,
  defaultDataGovernanceHookRegistry,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
  type LegalHoldCheckDecision,
  type LegalHoldCheckQuery,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { IDataGovernancePublicService } from '../contracts/index.js';
import { resolveDataGovernanceRuntimeConfig } from '../helpers/data-governance-config.helper.js';
import type {
  ApproveDsarRequest,
  CreateDsarRequest,
  CreateLegalHoldRequest,
  EvaluateSensitivePayloadRequest,
  GrantConsentRequest,
  ListConsentDefinitionsQuery,
  ListDataClassificationsQuery,
  ListDsarRequestsQuery,
  ListLegalHoldsQuery,
  ListSensitiveFieldsQuery,
  ListUserConsentsQuery,
  RejectDsarRequest,
  ReleaseLegalHoldRequest,
  UpdateDataClassificationRequest,
  UpdateSensitiveFieldRequest,
  UpsertConsentDefinitionRequest,
  UpsertDataClassificationRequest,
  UpsertSensitiveFieldRequest,
  WithdrawConsentRequest,
} from '../requests/data-governance.requests.js';
import type {
  ConsentDefinitionView,
  DataClassificationView,
  DataGovernanceOverviewView,
  DsarDownloadPayloadView,
  DsarRequestView,
  GovernanceExpirationSweepResult,
  LegalHoldView,
  RetentionSweepSummaryView,
  SensitiveFieldView,
  UserConsentView,
} from '../types/data-governance.types.js';
import { ConsentManagementService } from './consent-management.service.js';
import { DataClassificationService } from './data-classification.service.js';
import { DsarService } from './dsar.service.js';
import { LegalHoldService } from './legal-hold.service.js';

@Injectable()
export class DataGovernanceService implements IDataGovernancePublicService {
  private readonly hookRegistry: DataGovernanceHookRegistry;
  private readonly settingRegistry: SettingRegistryService;
  private readonly featureFlagRegistry: FeatureFlagRegistryService;

  constructor(
    private readonly classificationService: DataClassificationService,
    private readonly dsarService: DsarService,
    private readonly consentService: ConsentManagementService,
    private readonly legalHoldService: LegalHoldService,
    @Optional() hookRegistry?: DataGovernanceHookRegistry,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() featureFlagRegistry?: FeatureFlagRegistryService,
  ) {
    this.hookRegistry = hookRegistry ?? defaultDataGovernanceHookRegistry;
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.featureFlagRegistry = featureFlagRegistry ?? defaultFeatureFlagRegistry;
  }

  public async getOverview(): Promise<DataGovernanceOverviewView> {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    const [classSummary, sensitiveStats, dsarCounts, activePurposes, activeHolds] =
      await Promise.all([
        this.classificationService.getClassificationSummaryCounts(),
        this.classificationService.getSensitiveFieldStats(),
        this.dsarService.getPendingCounts(),
        this.consentService.countActiveDefinitions(),
        this.legalHoldService.countActiveHolds(),
      ]);

    return {
      moduleEnabled: cfg.moduleEnabled,
      dsarEnabled: cfg.dsarEnabled,
      consentEnabled: cfg.consentEnabled,
      legalHoldEnabled: cfg.legalHoldEnabled,
      dsarSlaDays: cfg.dsarSlaDays,
      exportTtlMinutes: cfg.exportTtlMinutes,
      erasureRequireApproval: cfg.erasureRequireApproval,
      counts: {
        classificationsTotal: classSummary.total,
        classificationsByLevel: classSummary.byLevel,
        sensitiveFieldsTotal: sensitiveStats.total,
        logRedactedFieldsCount: sensitiveStats.logRedacted,
        exportMaskedFieldsCount: sensitiveStats.exportMasked,
        pendingDsarCount: dsarCounts.pending,
        pendingApprovalErasureCount: dsarCounts.pendingApprovalErasure,
        activeConsentPurposesCount: activePurposes,
        activeLegalHoldsCount: activeHolds,
        registeredContributorsCount: this.hookRegistry.listPersonalDataContributors().length,
      },
    };
  }

  public listClassifications(
    query: ListDataClassificationsQuery,
  ): Promise<PaginatedResult<DataClassificationView>> {
    return this.classificationService.listClassifications(query);
  }

  public upsertClassification(
    dto: UpsertDataClassificationRequest,
    actor?: UserIdentity,
  ): Promise<DataClassificationView> {
    return this.classificationService.upsertClassification(dto, actor);
  }

  public updateClassification(
    id: number,
    dto: UpdateDataClassificationRequest,
    actor?: UserIdentity,
  ): Promise<DataClassificationView> {
    return this.classificationService.updateClassification(id, dto, actor);
  }

  public listSensitiveFields(
    query: ListSensitiveFieldsQuery,
  ): Promise<PaginatedResult<SensitiveFieldView>> {
    return this.classificationService.listSensitiveFields(query);
  }

  public upsertSensitiveField(
    dto: UpsertSensitiveFieldRequest,
    actor?: UserIdentity,
  ): Promise<SensitiveFieldView> {
    return this.classificationService.upsertSensitiveField(dto, actor);
  }

  public updateSensitiveField(
    id: number,
    dto: UpdateSensitiveFieldRequest,
    actor?: UserIdentity,
  ): Promise<SensitiveFieldView> {
    return this.classificationService.updateSensitiveField(id, dto, actor);
  }

  public async evaluateSensitivePayload(
    dto: EvaluateSensitivePayloadRequest,
    actor?: UserIdentity,
  ): Promise<{
    readonly resourceType: string;
    readonly context: 'read' | 'export';
    readonly sanitizedPayload: Record<string, unknown>;
  }> {
    const sanitizedPayload = await this.classificationService.sanitizeRecordForActor(
      dto.resourceType,
      dto.payload,
      actor,
      dto.context,
    );
    return {
      resourceType: dto.resourceType,
      context: dto.context,
      sanitizedPayload,
    };
  }

  public runRetentionSweep(options?: {
    readonly dataTypeCode?: string | undefined;
    readonly dryRun?: boolean | undefined;
    readonly now?: Date | undefined;
    readonly actor?: UserIdentity | undefined;
  }): Promise<RetentionSweepSummaryView> {
    return this.classificationService.runRetentionSweep(options);
  }

  public listDsarRequests(
    query: ListDsarRequestsQuery,
    actor: UserIdentity,
  ): Promise<PaginatedResult<DsarRequestView>> {
    return this.dsarService.listRequests(query, actor);
  }

  public listMyDsarRequests(actor: UserIdentity): Promise<DsarRequestView[]> {
    return this.dsarService.listMyRequests(actor);
  }

  public getDsarRequestById(id: number, actor: UserIdentity): Promise<DsarRequestView> {
    return this.dsarService.getRequestById(id, actor);
  }

  public createDsarRequest(dto: CreateDsarRequest, actor: UserIdentity): Promise<DsarRequestView> {
    return this.dsarService.createRequest(dto, actor);
  }

  public approveDsarRequest(
    id: number,
    dto: ApproveDsarRequest,
    actor: UserIdentity,
  ): Promise<DsarRequestView> {
    return this.dsarService.approveErasureRequest(id, dto, actor);
  }

  public rejectDsarRequest(
    id: number,
    dto: RejectDsarRequest,
    actor: UserIdentity,
  ): Promise<DsarRequestView> {
    return this.dsarService.rejectErasureRequest(id, dto, actor);
  }

  public downloadDsarExport(token: string, actor: UserIdentity): Promise<DsarDownloadPayloadView> {
    return this.dsarService.downloadPersonalDataExport(token, actor);
  }

  public listConsentDefinitions(
    query: ListConsentDefinitionsQuery,
  ): Promise<PaginatedResult<ConsentDefinitionView>> {
    return this.consentService.listDefinitions(query);
  }

  public upsertConsentDefinition(
    dto: UpsertConsentDefinitionRequest,
    actor: UserIdentity,
  ): Promise<ConsentDefinitionView> {
    return this.consentService.upsertDefinition(dto, actor);
  }

  public listUserConsents(query: ListUserConsentsQuery): Promise<PaginatedResult<UserConsentView>> {
    return this.consentService.listUserConsents(query);
  }

  public listMyConsents(actor: UserIdentity): Promise<UserConsentView[]> {
    return this.consentService.listMyConsents(actor);
  }

  public grantConsent(
    dto: GrantConsentRequest,
    actor: UserIdentity,
    meta?: { readonly ipAddress?: string | null; readonly userAgent?: string | null },
  ): Promise<UserConsentView> {
    return this.consentService.grantConsent(dto, actor, meta);
  }

  public withdrawConsent(
    dto: WithdrawConsentRequest,
    actor: UserIdentity,
  ): Promise<UserConsentView> {
    return this.consentService.withdrawConsent(dto, actor);
  }

  public listLegalHolds(query: ListLegalHoldsQuery): Promise<PaginatedResult<LegalHoldView>> {
    return this.legalHoldService.listLegalHolds(query);
  }

  public checkLegalHold(query: LegalHoldCheckQuery): Promise<LegalHoldCheckDecision> {
    return this.legalHoldService.checkLegalHold(query);
  }

  public createLegalHold(dto: CreateLegalHoldRequest, actor: UserIdentity): Promise<LegalHoldView> {
    return this.legalHoldService.createLegalHold(dto, actor);
  }

  public releaseLegalHold(
    id: number,
    dto: ReleaseLegalHoldRequest,
    actor: UserIdentity,
  ): Promise<LegalHoldView> {
    return this.legalHoldService.releaseLegalHold(id, dto, actor);
  }

  public async runExpirationSweep(
    now: Date = new Date(),
  ): Promise<GovernanceExpirationSweepResult> {
    const [expiredHoldsCount, expiredConsentsCount, purgedExportTokensCount] = await Promise.all([
      this.legalHoldService.expireElapsedHolds(now),
      this.consentService.expireElapsedConsents(now),
      this.dsarService.purgeExpiredExportTokens(now),
    ]);
    return {
      expiredHoldsCount,
      expiredConsentsCount,
      purgedExportTokensCount,
      sweptAt: now.toISOString(),
    };
  }
}
