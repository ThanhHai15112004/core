import { randomBytes } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import {
  ConflictAppException,
  DATA_GOVERNANCE_DOMAIN_EVENTS,
  DataGovernanceHookRegistry,
  DomainEventBusService,
  FeatureFlagRegistryService,
  ForbiddenAppException,
  NotFoundAppException,
  SequenceRegistryService,
  SettingRegistryService,
  createDomainEvent,
  defaultDataGovernanceHookRegistry,
  defaultDomainEventBus,
  defaultFeatureFlagRegistry,
  defaultSequenceRegistry,
  defaultSettingRegistry,
  type PaginatedResult,
  type PersonalDataErasureExceptionItem,
  type PersonalDataModuleSection,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  DATA_GOVERNANCE_PERMISSIONS,
  DSAR_EXPORT_FORMAT,
  DSAR_REQUEST_TYPE,
  DSAR_STATUS,
  type DsarExportFormat,
} from '../enum/data-governance.enum.js';
import { nextDsarRequestCode } from '../helpers/code-generator.helper.js';
import {
  assertDataGovernanceEnabled,
  resolveDataGovernanceRuntimeConfig,
} from '../helpers/data-governance-config.helper.js';
import { mapDsarRequestToView } from '../helpers/data-governance-mapper.helper.js';
import {
  buildPortablePersonalDataCsv,
  computeSha256Hex,
} from '../helpers/sensitive-masking.helper.js';
import { DataClassificationRepository } from '../repositories/data-classification.repository.js';
import { PrivacyDsarRequestRepository } from '../repositories/privacy-dsar-request.repository.js';
import type {
  ApproveDsarRequest,
  CreateDsarRequest,
  ListDsarRequestsQuery,
  RejectDsarRequest,
} from '../requests/data-governance.requests.js';
import type {
  DsarDownloadPayloadView,
  DsarErasureExecutionReport,
  DsarPersonalDataSnapshot,
  DsarRequestView,
} from '../types/data-governance.types.js';
import { LegalHoldService } from './legal-hold.service.js';

interface StoredExportPayload {
  readonly requestCode: string;
  readonly subjectUserId: number;
  readonly format: DsarExportFormat;
  readonly fileName: string;
  readonly contentType: string;
  readonly checksumSha256: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly content: string;
}

@Injectable()
export class DsarService {
  private readonly exportPayloads = new Map<string, StoredExportPayload>();
  private readonly hookRegistry: DataGovernanceHookRegistry;
  private readonly settingRegistry: SettingRegistryService;
  private readonly featureFlagRegistry: FeatureFlagRegistryService;
  private readonly sequenceRegistry: SequenceRegistryService;
  private readonly eventBus: DomainEventBusService;

  constructor(
    private readonly dsarRepo: PrivacyDsarRequestRepository,
    private readonly classificationRepo: DataClassificationRepository,
    private readonly legalHoldService: LegalHoldService,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() hookRegistry?: DataGovernanceHookRegistry,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() featureFlagRegistry?: FeatureFlagRegistryService,
    @Optional() sequenceRegistry?: SequenceRegistryService,
    @Optional() eventBus?: DomainEventBusService,
  ) {
    this.hookRegistry = hookRegistry ?? defaultDataGovernanceHookRegistry;
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.featureFlagRegistry = featureFlagRegistry ?? defaultFeatureFlagRegistry;
    this.sequenceRegistry = sequenceRegistry ?? defaultSequenceRegistry;
    this.eventBus = eventBus ?? defaultDomainEventBus;
  }

  private canManageAllDsar(actor: UserIdentity): boolean {
    const roles = new Set((actor.roles ?? []).map((r) => r.toLowerCase()));
    if (roles.has('super_admin')) return true;
    const perms = new Set(actor.permissions ?? []);
    return (
      perms.has('*') ||
      perms.has(DATA_GOVERNANCE_PERMISSIONS.MANAGE) ||
      perms.has(DATA_GOVERNANCE_PERMISSIONS.DSAR_APPROVE) ||
      perms.has(DATA_GOVERNANCE_PERMISSIONS.READ)
    );
  }

  private async collectPersonalDataSnapshot(
    subjectUserId: number,
  ): Promise<DsarPersonalDataSnapshot> {
    const contributors = this.hookRegistry.listPersonalDataContributors();
    const policies = await this.classificationRepo.findAllEnabled();
    const levelByType = new Map(policies.map((p) => [p.dataTypeCode, p.classificationLevel]));

    const sections: PersonalDataModuleSection[] = [];
    for (const contributor of contributors) {
      const sec = await contributor.collectPersonalData(subjectUserId);
      const overriddenLevel = levelByType.get(sec.dataTypeCode) ?? sec.classificationLevel;
      sections.push({
        ...sec,
        classificationLevel: overriddenLevel,
      });
    }

    const totalRecords = sections.reduce((acc, s) => acc + s.recordCount, 0);
    const serialized = JSON.stringify(sections);
    return {
      generatedAt: new Date().toISOString(),
      subjectUserId,
      totalModules: sections.length,
      totalRecords,
      checksumSha256: computeSha256Hex(serialized),
      sections,
    };
  }

  public async getPendingCounts(): Promise<{ pending: number; pendingApprovalErasure: number }> {
    return this.dsarRepo.countByStatuses();
  }

  public async listRequests(
    query: ListDsarRequestsQuery,
    actor: UserIdentity,
  ): Promise<PaginatedResult<DsarRequestView>> {
    const effectiveSubjectUserId = this.canManageAllDsar(actor) ? query.subjectUserId : actor.id;
    const page = await this.dsarRepo.paginateFiltered({
      requestType: query.requestType,
      subjectUserId: effectiveSubjectUserId,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
    return {
      data: page.data.map(mapDsarRequestToView),
      meta: page.meta,
    };
  }

  public async listMyRequests(actor: UserIdentity): Promise<DsarRequestView[]> {
    const page = await this.dsarRepo.paginateFiltered({
      subjectUserId: actor.id,
      page: 1,
      limit: 50,
    });
    return page.data.map(mapDsarRequestToView);
  }

  public async getRequestById(id: number, actor: UserIdentity): Promise<DsarRequestView> {
    const entity = await this.dsarRepo.findById(id);
    if (!entity) {
      throw new NotFoundAppException('data-governance.dsarNotFound', { id });
    }
    if (entity.subjectUserId !== actor.id && !this.canManageAllDsar(actor)) {
      throw new ForbiddenAppException('data-governance.dsarForbiddenAccess');
    }
    return mapDsarRequestToView(entity);
  }

  public async createRequest(
    dto: CreateDsarRequest,
    actor: UserIdentity,
  ): Promise<DsarRequestView> {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertDataGovernanceEnabled(cfg);
    if (!cfg.dsarEnabled) {
      throw new ForbiddenAppException('data-governance.dsarDisabled');
    }

    const subjectUserId = dto.subjectUserId ?? actor.id;
    if (subjectUserId !== actor.id && !this.canManageAllDsar(actor)) {
      throw new ForbiddenAppException('data-governance.dsarForbiddenAccess');
    }

    const now = new Date();
    const dueAt = new Date(now.getTime() + cfg.dsarSlaDays * 86_400_000);
    const requestCode = await nextDsarRequestCode(this.sequenceRegistry);

    if (dto.requestType === DSAR_REQUEST_TYPE.ACCESS) {
      const snapshot = await this.collectPersonalDataSnapshot(subjectUserId);
      const entity = this.dsarRepo.create({
        requestCode,
        requestType: DSAR_REQUEST_TYPE.ACCESS,
        subjectUserId,
        requestedBy: actor.id,
        status: DSAR_STATUS.COMPLETED,
        exportFormat: null,
        reason: dto.reason?.trim() || null,
        requiresApproval: false,
        approvedBy: null,
        approvedAt: null,
        decisionComment: null,
        exceptionsJson: null,
        summaryJson: JSON.stringify(snapshot),
        exportToken: null,
        exportExpiresAt: null,
        dueAt,
        completedAt: now,
      });
      const saved = await this.dsarRepo.saveEntity(entity);
      await this.auditLogService?.record({
        actor,
        module: 'data-governance',
        feature: 'dsar',
        action: 'ACCESS_COMPLETED',
        resourceType: 'privacy_dsar_request',
        resourceId: String(saved.id),
        afterData: {
          requestCode: saved.requestCode,
          subjectUserId,
          totalModules: snapshot.totalModules,
          totalRecords: snapshot.totalRecords,
        },
      });
      await this.eventBus.publish(
        createDomainEvent({
          type: DATA_GOVERNANCE_DOMAIN_EVENTS.DSAR_COMPLETED,
          sourceModule: 'data-governance',
          aggregateType: 'privacy_dsar_request',
          aggregateId: String(saved.id),
          actorId: actor.id,
          payload: {
            requestCode: saved.requestCode,
            requestType: saved.requestType,
            subjectUserId,
          },
        }),
      );
      return mapDsarRequestToView(saved);
    }

    if (dto.requestType === DSAR_REQUEST_TYPE.EXPORT) {
      const format: DsarExportFormat = dto.exportFormat ?? DSAR_EXPORT_FORMAT.JSON;
      const snapshot = await this.collectPersonalDataSnapshot(subjectUserId);
      const exportToken = `dsar_${randomBytes(18).toString('hex')}`;
      const expiresAt = new Date(now.getTime() + cfg.exportTtlMinutes * 60_000);

      const portablePayload =
        format === DSAR_EXPORT_FORMAT.CSV
          ? buildPortablePersonalDataCsv(snapshot.sections)
          : JSON.stringify(
              {
                schemaVersion: '1.0',
                requestCode,
                exportedAt: snapshot.generatedAt,
                subjectUserId,
                checksumSha256: snapshot.checksumSha256,
                sections: snapshot.sections,
              },
              null,
              2,
            );

      const fileName = `personal_data_${subjectUserId}_${requestCode}.${format}`;
      const contentType =
        format === DSAR_EXPORT_FORMAT.CSV
          ? 'text/csv; charset=utf-8'
          : 'application/json; charset=utf-8';

      this.exportPayloads.set(exportToken, {
        requestCode,
        subjectUserId,
        format,
        fileName,
        contentType,
        checksumSha256: computeSha256Hex(portablePayload),
        generatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        content: portablePayload,
      });

      const entity = this.dsarRepo.create({
        requestCode,
        requestType: DSAR_REQUEST_TYPE.EXPORT,
        subjectUserId,
        requestedBy: actor.id,
        status: DSAR_STATUS.COMPLETED,
        exportFormat: format,
        reason: dto.reason?.trim() || null,
        requiresApproval: false,
        approvedBy: null,
        approvedAt: null,
        decisionComment: null,
        exceptionsJson: null,
        summaryJson: JSON.stringify({
          generatedAt: snapshot.generatedAt,
          subjectUserId,
          format,
          fileName,
          totalModules: snapshot.totalModules,
          totalRecords: snapshot.totalRecords,
          checksumSha256: snapshot.checksumSha256,
        }),
        exportToken,
        exportExpiresAt: expiresAt,
        dueAt,
        completedAt: now,
      });
      const saved = await this.dsarRepo.saveEntity(entity);
      await this.auditLogService?.record({
        actor,
        module: 'data-governance',
        feature: 'dsar',
        action: 'EXPORT_COMPLETED',
        resourceType: 'privacy_dsar_request',
        resourceId: String(saved.id),
        afterData: {
          requestCode: saved.requestCode,
          subjectUserId,
          format,
          totalRecords: snapshot.totalRecords,
        },
      });
      await this.eventBus.publish(
        createDomainEvent({
          type: DATA_GOVERNANCE_DOMAIN_EVENTS.DSAR_COMPLETED,
          sourceModule: 'data-governance',
          aggregateType: 'privacy_dsar_request',
          aggregateId: String(saved.id),
          actorId: actor.id,
          payload: { requestCode: saved.requestCode, requestType: saved.requestType, format },
        }),
      );
      return mapDsarRequestToView(saved);
    }

    const predeclaredExceptions: PersonalDataErasureExceptionItem[] = (
      dto.excludedDataTypeCodes ?? []
    ).map((code) => ({
      moduleName: code.split('.')[0] ?? 'custom',
      dataTypeCode: code.trim().toLowerCase(),
      reasonCode: 'REQUESTED_EXCLUSION',
      reason: 'Loại dữ liệu được đánh dấu ngoại lệ giữ lại khi khởi tạo yêu cầu xóa.',
      retainedCount: 1,
    }));

    const entity = this.dsarRepo.create({
      requestCode,
      requestType: DSAR_REQUEST_TYPE.ERASURE,
      subjectUserId,
      requestedBy: actor.id,
      status: cfg.erasureRequireApproval ? DSAR_STATUS.PENDING_APPROVAL : DSAR_STATUS.APPROVED,
      exportFormat: null,
      reason: dto.reason?.trim() || null,
      requiresApproval: cfg.erasureRequireApproval,
      approvedBy: null,
      approvedAt: null,
      decisionComment: null,
      exceptionsJson:
        predeclaredExceptions.length > 0 ? JSON.stringify(predeclaredExceptions) : null,
      summaryJson: null,
      exportToken: null,
      exportExpiresAt: null,
      dueAt,
      completedAt: null,
    });

    const saved = await this.dsarRepo.saveEntity(entity);
    await this.auditLogService?.record({
      actor,
      module: 'data-governance',
      feature: 'dsar',
      action: 'ERASURE_REQUESTED',
      resourceType: 'privacy_dsar_request',
      resourceId: String(saved.id),
      afterData: {
        requestCode: saved.requestCode,
        subjectUserId,
        requiresApproval: saved.requiresApproval,
      },
    });
    await this.eventBus.publish(
      createDomainEvent({
        type: DATA_GOVERNANCE_DOMAIN_EVENTS.DSAR_CREATED,
        sourceModule: 'data-governance',
        aggregateType: 'privacy_dsar_request',
        aggregateId: String(saved.id),
        actorId: actor.id,
        payload: {
          requestCode: saved.requestCode,
          requestType: saved.requestType,
          subjectUserId,
        },
      }),
    );

    if (!cfg.erasureRequireApproval) {
      return this.executeApprovedErasure(saved.id, {}, actor, true);
    }
    return mapDsarRequestToView(saved);
  }

  public async approveErasureRequest(
    id: number,
    dto: ApproveDsarRequest,
    actor: UserIdentity,
  ): Promise<DsarRequestView> {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertDataGovernanceEnabled(cfg);

    const existing = await this.dsarRepo.findById(id);
    if (!existing) {
      throw new NotFoundAppException('data-governance.dsarNotFound', { id });
    }
    if (
      existing.requestType !== DSAR_REQUEST_TYPE.ERASURE ||
      (existing.status !== DSAR_STATUS.PENDING_APPROVAL &&
        existing.status !== DSAR_STATUS.BLOCKED_LEGAL_HOLD)
    ) {
      throw new ConflictAppException('data-governance.dsarInvalidStatus', [
        { status: existing.status },
      ]);
    }

    const isSuperAdmin = (actor.roles ?? []).some((r) => r.toLowerCase() === 'super_admin');
    if (existing.requestedBy === actor.id && !cfg.allowSelfApproval && !isSuperAdmin) {
      throw new ForbiddenAppException('data-governance.dsarSelfApprovalForbidden');
    }

    return this.executeApprovedErasure(id, dto, actor, false);
  }

  private async executeApprovedErasure(
    id: number,
    dto: ApproveDsarRequest,
    actor: UserIdentity,
    autoApproved: boolean,
  ): Promise<DsarRequestView> {
    const entity = await this.dsarRepo.findById(id);
    if (!entity) {
      throw new NotFoundAppException('data-governance.dsarNotFound', { id });
    }

    const holdDecision = await this.legalHoldService.checkLegalHold({
      userId: entity.subjectUserId,
    });
    if (holdDecision.onHold) {
      entity.status = DSAR_STATUS.BLOCKED_LEGAL_HOLD;
      entity.decisionComment = `Blocked by active Legal Hold: ${holdDecision.holds.map((h) => h.holdCode).join(', ')}`;
      await this.dsarRepo.saveEntity(entity);
      throw new ConflictAppException('data-governance.blockedByLegalHold', [...holdDecision.holds]);
    }

    const policies = await this.classificationRepo.findAllEnabled();
    const policyRetainedCodes = new Set(
      policies
        .filter((p) => p.retentionAction === 'RETAIN_LEGAL')
        .map((p) => p.dataTypeCode.toLowerCase()),
    );

    const existingExceptions: PersonalDataErasureExceptionItem[] = entity.exceptionsJson
      ? (JSON.parse(entity.exceptionsJson) as PersonalDataErasureExceptionItem[])
      : [];
    const excludedCodes = new Set<string>([
      ...existingExceptions.map((e) => e.dataTypeCode.toLowerCase()),
      ...(dto.excludedDataTypeCodes ?? []).map((c) => c.trim().toLowerCase()),
      ...policyRetainedCodes,
    ]);

    const retainedExceptions: PersonalDataErasureExceptionItem[] = [
      ...existingExceptions,
      ...(dto.customExceptions ?? []).map((ce) => ({
        moduleName: ce.moduleName.trim().toLowerCase(),
        dataTypeCode: ce.dataTypeCode.trim().toLowerCase(),
        reasonCode: ce.reasonCode,
        reason: ce.reason,
        retainedCount: ce.retainedCount,
      })),
    ];

    for (const code of dto.excludedDataTypeCodes ?? []) {
      const normalized = code.trim().toLowerCase();
      if (!retainedExceptions.some((e) => e.dataTypeCode === normalized)) {
        retainedExceptions.push({
          moduleName: normalized.split('.')[0] ?? 'system',
          dataTypeCode: normalized,
          reasonCode: 'APPROVER_EXCEPTION',
          reason: dto.comment?.trim() || 'Giữ lại theo phê duyệt ngoại lệ của người duyệt DSAR.',
          retainedCount: 1,
        });
      }
    }

    const contributors = this.hookRegistry.listPersonalDataContributors();
    const moduleResults: Array<{
      moduleName: string;
      dataTypeCode: string;
      erasedCount: number;
      anonymizedCount: number;
    }> = [];
    let totalErased = 0;
    let totalAnonymized = 0;

    for (const contributor of contributors) {
      const dtCode = contributor.dataTypeCode.toLowerCase();
      const typeHold = await this.legalHoldService.checkLegalHold({ dataTypeCode: dtCode });
      if (typeHold.onHold) {
        retainedExceptions.push({
          moduleName: contributor.moduleName,
          dataTypeCode: contributor.dataTypeCode,
          reasonCode: 'DATA_TYPE_LEGAL_HOLD',
          reason: `Loại dữ liệu đang nằm trong Legal Hold (${typeHold.holds.map((h) => h.holdCode).join(', ')})`,
          retainedCount: 1,
        });
        continue;
      }

      if (excludedCodes.has(dtCode) && dtCode !== 'audit.logs') {
        if (!retainedExceptions.some((e) => e.dataTypeCode.toLowerCase() === dtCode)) {
          retainedExceptions.push({
            moduleName: contributor.moduleName,
            dataTypeCode: contributor.dataTypeCode,
            reasonCode: 'POLICY_RETAIN_LEGAL',
            reason: 'Chính sách phân loại dữ liệu quy định giữ lại theo nghĩa vụ pháp lý.',
            retainedCount: 1,
          });
        }
        continue;
      }

      if (!contributor.eraseOrAnonymizePersonalData) continue;

      const res = await contributor.eraseOrAnonymizePersonalData({
        subjectUserId: entity.subjectUserId,
        actorUserId: actor.id,
        requestCode: entity.requestCode,
        excludedDataTypeCodes: [...excludedCodes],
        reason: entity.reason,
      });

      totalErased += res.erasedCount;
      totalAnonymized += res.anonymizedCount;
      moduleResults.push({
        moduleName: res.moduleName,
        dataTypeCode: res.dataTypeCode,
        erasedCount: res.erasedCount,
        anonymizedCount: res.anonymizedCount,
      });

      for (const exc of res.retainedExceptions) {
        retainedExceptions.push(exc);
      }
    }

    const now = new Date();
    const report: DsarErasureExecutionReport = {
      executedAt: now.toISOString(),
      totalErased,
      totalAnonymized,
      moduleResults,
      retainedExceptions,
    };

    entity.approvedBy = autoApproved ? null : actor.id;
    entity.approvedAt = now;
    entity.decisionComment =
      dto.comment?.trim() || (autoApproved ? 'Auto-approved by policy' : null);
    entity.exceptionsJson = JSON.stringify(retainedExceptions);
    entity.summaryJson = JSON.stringify(report);
    entity.completedAt = now;
    entity.status =
      retainedExceptions.length > 0 ? DSAR_STATUS.PARTIALLY_COMPLETED : DSAR_STATUS.COMPLETED;

    const saved = await this.dsarRepo.saveEntity(entity);
    await this.auditLogService?.record({
      actor,
      module: 'data-governance',
      feature: 'dsar',
      action: 'ERASURE_APPROVED_AND_EXECUTED',
      resourceType: 'privacy_dsar_request',
      resourceId: String(saved.id),
      afterData: {
        requestCode: saved.requestCode,
        subjectUserId: saved.subjectUserId,
        status: saved.status,
        totalErased,
        totalAnonymized,
        exceptionsCount: retainedExceptions.length,
      },
    });
    await this.eventBus.publish(
      createDomainEvent({
        type: DATA_GOVERNANCE_DOMAIN_EVENTS.DSAR_APPROVED,
        sourceModule: 'data-governance',
        aggregateType: 'privacy_dsar_request',
        aggregateId: String(saved.id),
        actorId: actor.id,
        payload: {
          requestCode: saved.requestCode,
          subjectUserId: saved.subjectUserId,
          retainedExceptionsCount: retainedExceptions.length,
        },
      }),
    );

    return mapDsarRequestToView(saved);
  }

  public async rejectErasureRequest(
    id: number,
    dto: RejectDsarRequest,
    actor: UserIdentity,
  ): Promise<DsarRequestView> {
    const existing = await this.dsarRepo.findById(id);
    if (!existing) {
      throw new NotFoundAppException('data-governance.dsarNotFound', { id });
    }
    if (
      existing.status !== DSAR_STATUS.PENDING_APPROVAL &&
      existing.status !== DSAR_STATUS.BLOCKED_LEGAL_HOLD
    ) {
      throw new ConflictAppException('data-governance.dsarInvalidStatus', [
        { status: existing.status },
      ]);
    }

    existing.status = DSAR_STATUS.REJECTED;
    existing.approvedBy = actor.id;
    existing.approvedAt = new Date();
    existing.decisionComment = dto.comment.trim();

    const saved = await this.dsarRepo.saveEntity(existing);
    await this.auditLogService?.record({
      actor,
      module: 'data-governance',
      feature: 'dsar',
      action: 'ERASURE_REJECTED',
      resourceType: 'privacy_dsar_request',
      resourceId: String(saved.id),
      afterData: {
        requestCode: saved.requestCode,
        decisionComment: saved.decisionComment,
      },
    });
    await this.eventBus.publish(
      createDomainEvent({
        type: DATA_GOVERNANCE_DOMAIN_EVENTS.DSAR_REJECTED,
        sourceModule: 'data-governance',
        aggregateType: 'privacy_dsar_request',
        aggregateId: String(saved.id),
        actorId: actor.id,
        payload: { requestCode: saved.requestCode },
      }),
    );

    return mapDsarRequestToView(saved);
  }

  public async downloadPersonalDataExport(
    token: string,
    actor: UserIdentity,
  ): Promise<DsarDownloadPayloadView> {
    const cleanToken = token.trim();
    const entity = await this.dsarRepo.findByExportToken(cleanToken);
    if (!entity) {
      throw new NotFoundAppException('data-governance.dsarDownloadExpired');
    }
    if (entity.subjectUserId !== actor.id && !this.canManageAllDsar(actor)) {
      throw new ForbiddenAppException('data-governance.dsarForbiddenAccess');
    }
    if (!entity.exportExpiresAt || new Date(entity.exportExpiresAt).getTime() <= Date.now()) {
      this.exportPayloads.delete(cleanToken);
      throw new NotFoundAppException('data-governance.dsarDownloadExpired');
    }

    const cached = this.exportPayloads.get(cleanToken);
    if (cached) {
      return cached;
    }

    const format: DsarExportFormat = entity.exportFormat ?? DSAR_EXPORT_FORMAT.JSON;
    const snapshot = await this.collectPersonalDataSnapshot(entity.subjectUserId);
    const content =
      format === DSAR_EXPORT_FORMAT.CSV
        ? buildPortablePersonalDataCsv(snapshot.sections)
        : JSON.stringify(
            {
              schemaVersion: '1.0',
              requestCode: entity.requestCode,
              exportedAt: snapshot.generatedAt,
              subjectUserId: entity.subjectUserId,
              checksumSha256: snapshot.checksumSha256,
              sections: snapshot.sections,
            },
            null,
            2,
          );

    const rebuilt: StoredExportPayload = {
      requestCode: entity.requestCode,
      subjectUserId: entity.subjectUserId,
      format,
      fileName: `personal_data_${entity.subjectUserId}_${entity.requestCode}.${format}`,
      contentType:
        format === DSAR_EXPORT_FORMAT.CSV
          ? 'text/csv; charset=utf-8'
          : 'application/json; charset=utf-8',
      checksumSha256: computeSha256Hex(content),
      generatedAt: snapshot.generatedAt,
      expiresAt: new Date(entity.exportExpiresAt).toISOString(),
      content,
    };
    this.exportPayloads.set(cleanToken, rebuilt);
    return rebuilt;
  }

  public async purgeExpiredExportTokens(now: Date = new Date()): Promise<number> {
    for (const [tok, item] of this.exportPayloads.entries()) {
      if (new Date(item.expiresAt).getTime() <= now.getTime()) {
        this.exportPayloads.delete(tok);
      }
    }
    const expiredEntities = await this.dsarRepo.findExpiredExportTokens(now);
    for (const e of expiredEntities) {
      e.exportToken = null;
      await this.dsarRepo.saveEntity(e);
    }
    return expiredEntities.length;
  }
}
