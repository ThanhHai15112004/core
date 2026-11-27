import { Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  DATA_GOVERNANCE_DOMAIN_EVENTS,
  DomainEventBusService,
  FeatureFlagRegistryService,
  ForbiddenAppException,
  NotFoundAppException,
  SettingRegistryService,
  createDomainEvent,
  defaultDomainEventBus,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
  type IPersonalDataContributor,
  type IRetentionExecutor,
  type PaginatedResult,
  type PersonalDataErasureModuleResult,
  type PersonalDataErasureOptions,
  type PersonalDataModuleSection,
  type RetentionPolicyExecutionInput,
  type RetentionPolicyExecutionResult,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import { CONSENT_STATUS, DATA_GOVERNANCE_PERMISSIONS } from '../enum/data-governance.enum.js';
import {
  assertDataGovernanceEnabled,
  resolveDataGovernanceRuntimeConfig,
} from '../helpers/data-governance-config.helper.js';
import {
  mapConsentDefinitionToView,
  mapUserConsentToView,
} from '../helpers/data-governance-mapper.helper.js';
import { PrivacyConsentDefinitionRepository } from '../repositories/privacy-consent-definition.repository.js';
import { PrivacyUserConsentRepository } from '../repositories/privacy-user-consent.repository.js';
import type {
  GrantConsentRequest,
  ListConsentDefinitionsQuery,
  ListUserConsentsQuery,
  UpsertConsentDefinitionRequest,
  WithdrawConsentRequest,
} from '../requests/data-governance.requests.js';
import type { ConsentDefinitionView, UserConsentView } from '../types/data-governance.types.js';

@Injectable()
export class ConsentManagementService implements IPersonalDataContributor, IRetentionExecutor {
  public readonly contributorKey = 'data-governance.consents';
  public readonly moduleName = 'data-governance';
  public readonly dataTypeCode = 'privacy.consents';
  public readonly defaultClassification = 'CONFIDENTIAL' as const;

  private readonly settingRegistry: SettingRegistryService;
  private readonly featureFlagRegistry: FeatureFlagRegistryService;
  private readonly eventBus: DomainEventBusService;

  constructor(
    private readonly definitionRepo: PrivacyConsentDefinitionRepository,
    private readonly userConsentRepo: PrivacyUserConsentRepository,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() featureFlagRegistry?: FeatureFlagRegistryService,
    @Optional() eventBus?: DomainEventBusService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.featureFlagRegistry = featureFlagRegistry ?? defaultFeatureFlagRegistry;
    this.eventBus = eventBus ?? defaultDomainEventBus;
  }

  private canManageOtherUsers(actor: UserIdentity): boolean {
    const roles = new Set((actor.roles ?? []).map((r) => r.toLowerCase()));
    if (roles.has('super_admin')) return true;
    const perms = new Set(actor.permissions ?? []);
    return perms.has('*') || perms.has(DATA_GOVERNANCE_PERMISSIONS.CONSENT_MANAGE);
  }

  public async countActiveDefinitions(): Promise<number> {
    const active = await this.definitionRepo.findAllActive();
    return active.length;
  }

  public async listDefinitions(
    query: ListConsentDefinitionsQuery,
  ): Promise<PaginatedResult<ConsentDefinitionView>> {
    const page = await this.definitionRepo.paginateFiltered({
      purposeCode: query.purposeCode,
      isActive: query.isActive,
      page: query.page,
      limit: query.limit,
    });
    return {
      data: page.data.map(mapConsentDefinitionToView),
      meta: page.meta,
    };
  }

  public async upsertDefinition(
    dto: UpsertConsentDefinitionRequest,
    actor: UserIdentity,
  ): Promise<ConsentDefinitionView> {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertDataGovernanceEnabled(cfg);
    if (!cfg.consentEnabled) {
      throw new ForbiddenAppException('data-governance.consentDisabled');
    }

    const purpose = dto.purposeCode.trim().toLowerCase();
    const version = dto.policyVersion.trim();
    const existing = await this.definitionRepo.findByPurposeAndVersion(purpose, version);

    const entity = existing
      ? Object.assign(existing, {
          title: dto.title.trim(),
          description: dto.description.trim(),
          classificationLevel: dto.classificationLevel,
          isMandatory: dto.isMandatory,
          validityDays: dto.validityDays ?? null,
          isActive: dto.isActive,
          updatedBy: actor.id,
        })
      : this.definitionRepo.create({
          purposeCode: purpose,
          policyVersion: version,
          title: dto.title.trim(),
          description: dto.description.trim(),
          classificationLevel: dto.classificationLevel,
          isMandatory: dto.isMandatory,
          validityDays: dto.validityDays ?? null,
          isActive: dto.isActive,
          publishedAt: new Date(),
          createdBy: actor.id,
          updatedBy: actor.id,
        });

    const saved = await this.definitionRepo.saveEntity(entity);
    await this.auditLogService?.record({
      actor,
      module: 'data-governance',
      feature: 'consent-definition',
      action: existing ? 'UPDATE' : 'CREATE',
      resourceType: 'privacy_consent_definition',
      resourceId: String(saved.id),
      afterData: mapConsentDefinitionToView(saved) as unknown as Record<string, unknown>,
    });
    await this.eventBus.publish(
      createDomainEvent({
        type: DATA_GOVERNANCE_DOMAIN_EVENTS.CONSENT_DEFINITION_SAVED,
        sourceModule: 'data-governance',
        aggregateType: 'privacy_consent_definition',
        aggregateId: String(saved.id),
        actorId: actor.id,
        payload: {
          purposeCode: saved.purposeCode,
          policyVersion: saved.policyVersion,
          isMandatory: saved.isMandatory,
        },
      }),
    );

    return mapConsentDefinitionToView(saved);
  }

  public async listUserConsents(
    query: ListUserConsentsQuery,
  ): Promise<PaginatedResult<UserConsentView>> {
    const page = await this.userConsentRepo.paginateFiltered({
      userId: query.userId,
      purposeCode: query.purposeCode,
      consentStatus: query.consentStatus,
      page: query.page,
      limit: query.limit,
    });
    return {
      data: page.data.map(mapUserConsentToView),
      meta: page.meta,
    };
  }

  public async listMyConsents(actor: UserIdentity): Promise<UserConsentView[]> {
    const records = await this.userConsentRepo.findByUserId(actor.id);
    return records.map(mapUserConsentToView);
  }

  public async grantConsent(
    dto: GrantConsentRequest,
    actor: UserIdentity,
    requestMeta?: { readonly ipAddress?: string | null; readonly userAgent?: string | null },
  ): Promise<UserConsentView> {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertDataGovernanceEnabled(cfg);
    if (!cfg.consentEnabled) {
      throw new ForbiddenAppException('data-governance.consentDisabled');
    }

    const targetUserId = dto.userId ?? actor.id;
    if (targetUserId !== actor.id && !this.canManageOtherUsers(actor)) {
      throw new ForbiddenAppException('data-governance.dsarForbiddenAccess');
    }

    const purpose = dto.purposeCode.trim().toLowerCase();
    const def = dto.policyVersion?.trim()
      ? await this.definitionRepo.findByPurposeAndVersion(purpose, dto.policyVersion.trim())
      : await this.definitionRepo.findLatestActiveByPurpose(purpose);

    if (!def || !def.isActive) {
      throw new NotFoundAppException('data-governance.consentDefinitionNotFound', {
        purposeCode: purpose,
      });
    }

    const now = new Date();
    const expiresAt = def.validityDays ? new Date(now.getTime() + def.validityDays * 86_400_000) : null;

    const entity = this.userConsentRepo.create({
      userId: targetUserId,
      purposeCode: def.purposeCode,
      policyVersion: def.policyVersion,
      consentStatus: CONSENT_STATUS.GRANTED,
      grantedAt: now,
      withdrawnAt: null,
      withdrawReason: null,
      expiresAt,
      collectionSource: dto.collectionSource.trim().toUpperCase(),
      ipAddress: requestMeta?.ipAddress ?? null,
      userAgent: requestMeta?.userAgent ? requestMeta.userAgent.slice(0, 255) : null,
      metadataJson: dto.metadata ? JSON.stringify(dto.metadata) : null,
      recordedBy: actor.id,
    });

    const saved = await this.userConsentRepo.saveEntity(entity);
    await this.auditLogService?.record({
      actor,
      module: 'data-governance',
      feature: 'user-consent',
      action: 'GRANT',
      resourceType: 'privacy_user_consent',
      resourceId: String(saved.id),
      afterData: mapUserConsentToView(saved) as unknown as Record<string, unknown>,
    });
    await this.eventBus.publish(
      createDomainEvent({
        type: DATA_GOVERNANCE_DOMAIN_EVENTS.CONSENT_GRANTED,
        sourceModule: 'data-governance',
        aggregateType: 'privacy_user_consent',
        aggregateId: String(saved.id),
        actorId: actor.id,
        payload: {
          userId: saved.userId,
          purposeCode: saved.purposeCode,
          policyVersion: saved.policyVersion,
        },
      }),
    );

    return mapUserConsentToView(saved);
  }

  public async withdrawConsent(
    dto: WithdrawConsentRequest,
    actor: UserIdentity,
  ): Promise<UserConsentView> {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertDataGovernanceEnabled(cfg);
    if (!cfg.consentEnabled) {
      throw new ForbiddenAppException('data-governance.consentDisabled');
    }

    const targetUserId = dto.userId ?? actor.id;
    if (targetUserId !== actor.id && !this.canManageOtherUsers(actor)) {
      throw new ForbiddenAppException('data-governance.dsarForbiddenAccess');
    }

    const purpose = dto.purposeCode.trim().toLowerCase();
    const activeRecord = await this.userConsentRepo.findLatestGrantedByUserAndPurpose(
      targetUserId,
      purpose,
    );
    if (!activeRecord) {
      throw new NotFoundAppException('data-governance.consentRecordNotFound', {
        purposeCode: purpose,
      });
    }

    const def = await this.definitionRepo.findByPurposeAndVersion(
      activeRecord.purposeCode,
      activeRecord.policyVersion,
    );
    if (def?.isMandatory) {
      throw new BadRequestAppException('data-governance.consentMandatoryCannotWithdraw');
    }

    activeRecord.consentStatus = CONSENT_STATUS.WITHDRAWN;
    activeRecord.withdrawnAt = new Date();
    activeRecord.withdrawReason = dto.reason?.trim() || 'Withdrawn by user';
    activeRecord.recordedBy = actor.id;

    const saved = await this.userConsentRepo.saveEntity(activeRecord);
    await this.auditLogService?.record({
      actor,
      module: 'data-governance',
      feature: 'user-consent',
      action: 'WITHDRAW',
      resourceType: 'privacy_user_consent',
      resourceId: String(saved.id),
      afterData: mapUserConsentToView(saved) as unknown as Record<string, unknown>,
    });
    await this.eventBus.publish(
      createDomainEvent({
        type: DATA_GOVERNANCE_DOMAIN_EVENTS.CONSENT_WITHDRAWN,
        sourceModule: 'data-governance',
        aggregateType: 'privacy_user_consent',
        aggregateId: String(saved.id),
        actorId: actor.id,
        payload: {
          userId: saved.userId,
          purposeCode: saved.purposeCode,
          policyVersion: saved.policyVersion,
        },
      }),
    );

    return mapUserConsentToView(saved);
  }

  public async expireElapsedConsents(now: Date = new Date()): Promise<number> {
    const expired = await this.userConsentRepo.findExpiredGrantedConsents(now);
    for (const item of expired) {
      item.consentStatus = CONSENT_STATUS.EXPIRED;
      await this.userConsentRepo.saveEntity(item);
    }
    return expired.length;
  }

  public async collectPersonalData(subjectUserId: number): Promise<PersonalDataModuleSection> {
    const records = await this.userConsentRepo.findByUserId(subjectUserId);
    const mapped = records.map(
      (r) => mapUserConsentToView(r) as unknown as Record<string, unknown>,
    );
    return {
      moduleName: this.moduleName,
      dataTypeCode: this.dataTypeCode,
      classificationLevel: this.defaultClassification,
      recordCount: mapped.length,
      records: mapped,
    };
  }

  public async eraseOrAnonymizePersonalData(
    options: PersonalDataErasureOptions,
  ): Promise<PersonalDataErasureModuleResult> {
    const records = await this.userConsentRepo.findByUserId(options.subjectUserId);
    let anonymizedCount = 0;
    const now = new Date();
    for (const r of records) {
      if (r.consentStatus === CONSENT_STATUS.GRANTED) {
        r.consentStatus = CONSENT_STATUS.WITHDRAWN;
        r.withdrawnAt = now;
        r.withdrawReason = `DSAR Erasure (${options.requestCode})`;
      }
      r.ipAddress = null;
      r.userAgent = null;
      r.metadataJson = null;
      await this.userConsentRepo.saveEntity(r);
      anonymizedCount += 1;
    }

    return {
      moduleName: this.moduleName,
      dataTypeCode: this.dataTypeCode,
      erasedCount: 0,
      anonymizedCount,
      retainedExceptions:
        records.length > 0
          ? [
              {
                moduleName: this.moduleName,
                dataTypeCode: this.dataTypeCode,
                reasonCode: 'CONSENT_PROOF_RETENTION',
                reason:
                  'Giữ lại dấu vết thời điểm đồng ý/rút đồng ý (đã xóa IP & User-Agent) để chứng minh tuân thủ pháp lý.',
                retainedCount: records.length,
              },
            ]
          : [],
    };
  }

  public async executeRetention(
    input: RetentionPolicyExecutionInput,
  ): Promise<RetentionPolicyExecutionResult> {
    const candidates = await this.userConsentRepo.findWithdrawnBeforeCutoff(input.cutoffDate);
    let affectedCount = 0;
    let skippedLegalHoldCount = 0;

    for (const item of candidates) {
      if (await input.isUserUnderLegalHold(item.userId)) {
        skippedLegalHoldCount += 1;
        continue;
      }
      if (!input.dryRun) {
        if (input.retentionAction === 'ANONYMIZE') {
          item.ipAddress = null;
          item.userAgent = null;
          item.metadataJson = null;
          await this.userConsentRepo.saveEntity(item);
        } else {
          await this.userConsentRepo.softRemoveEntity(item);
        }
      }
      affectedCount += 1;
    }

    return {
      dataTypeCode: this.dataTypeCode,
      scannedCount: candidates.length,
      affectedCount,
      skippedLegalHoldCount,
      actionApplied: input.dryRun ? `DRY_RUN_${input.retentionAction}` : input.retentionAction,
    };
  }
}
