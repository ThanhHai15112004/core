import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { BaseCacheProvider } from '@packages/cache/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
  ProviderRegistryService as KernelProviderRegistryService,
  SettingRegistryService,
  defaultProviderRegistry,
  defaultSettingRegistry,
  parseNumericUserId,
  safeJsonParseObject,
  type PaginatedResult,
  type ProviderTypeName,
} from '@packages/kernel/index.js';
import { BaseMessagePublisherProvider, QUEUES } from '@packages/messaging/index.js';
import {
  FieldEncryptionService,
  defaultFieldEncryptionService,
  type UserIdentity,
} from '@packages/security/index.js';
import {
  PROVIDER_HISTORY_ACTION,
  PROVIDER_REGISTRY_AUDIT_META,
  PROVIDER_REGISTRY_EVENTS,
  PROVIDER_ROLE,
  PROVIDER_STATUS,
} from '../enum/provider-registry.enum.js';
import type { ProviderRegistryEntryEntity } from '../entities/provider-registry-entry.entity.js';
import { resolveProviderRegistryConfig } from '../helpers/provider-config.helper.js';
import {
  maskProviderSecretHint,
  sanitizeProviderErrorMessage,
} from '../helpers/provider-redaction.helper.js';
import { validateHealthCheckUrl } from '../helpers/provider-ssrf.helper.js';
import { ProviderRegistryEntryRepository } from '../repositories/provider-registry-entry.repository.js';
import { ProviderUnitAssignmentRepository } from '../repositories/provider-unit-assignment.repository.js';
import type {
  CreateProviderEntryRequest,
  ListProviderEntriesQuery,
  UpdateProviderEntryRequest,
} from '../requests/provider-registry.requests.js';
import { ProviderRegistryResponseMapper } from '../responses/provider-registry.response.js';
import type { ProviderRegistryEntryView } from '../types/provider-registry.types.js';
import { ProviderHistoryService } from './provider-history.service.js';

const CACHE_KEY_SNAPSHOT_VERSION = 'provider_registry:snapshot_version';

@Injectable()
export class ProviderEntriesService implements OnModuleInit {
  private readonly kernelRegistry: KernelProviderRegistryService;
  private readonly settingRegistry: SettingRegistryService;
  private readonly encryptionService: FieldEncryptionService;

  constructor(
    private readonly entryRepo: ProviderRegistryEntryRepository,
    private readonly unitRepo: ProviderUnitAssignmentRepository,
    private readonly historyService: ProviderHistoryService,
    @Optional() kernelRegistry?: KernelProviderRegistryService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() encryptionService?: FieldEncryptionService,
    @Optional() private readonly cacheProvider?: BaseCacheProvider,
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider,
  ) {
    this.kernelRegistry = kernelRegistry ?? defaultProviderRegistry;
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.encryptionService = encryptionService ?? defaultFieldEncryptionService;
    this.kernelRegistry.setPolicyProvider(() =>
      resolveProviderRegistryConfig(this.settingRegistry),
    );
  }

  public async onModuleInit(): Promise<void> {
    try {
      await this.syncKernelSnapshot();
    } catch {
      // Allow graceful startup before migration runs
    }
  }

  public async syncKernelSnapshot(): Promise<void> {
    const [entries, assignments] = await Promise.all([
      this.entryRepo.listAll(),
      this.unitRepo.listAll(),
    ]);

    this.kernelRegistry.replaceSnapshot(
      entries.map((entry) => ProviderRegistryResponseMapper.toKernelSnapshot(entry)),
      assignments.map((assign) => ({
        id: Number(assign.id),
        providerType: assign.providerType,
        organizationUnitId: Number(assign.organizationUnitId),
        primaryProviderId: Number(assign.primaryProviderId),
        fallbackProviderId:
          assign.fallbackProviderId !== null && assign.fallbackProviderId !== undefined
            ? Number(assign.fallbackProviderId)
            : null,
        allowFallbackOverride:
          assign.allowFallbackOverride === null || assign.allowFallbackOverride === undefined
            ? null
            : Boolean(assign.allowFallbackOverride),
        isEnabled: Boolean(assign.isEnabled),
      })),
    );
  }

  public async listProviders(
    query: Partial<ListProviderEntriesQuery> = {},
  ): Promise<PaginatedResult<ProviderRegistryEntryView>> {
    const paged = await this.entryRepo.listPaginated(query);
    return createPaginatedResult(
      paged.data.map((entity) => this.toSafeEntryView(entity)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async listAllEntries(): Promise<ProviderRegistryEntryEntity[]> {
    return this.entryRepo.listAll();
  }

  public async getEntryOrThrow(id: number): Promise<ProviderRegistryEntryEntity> {
    const entity = await this.entryRepo.findByIdSafe(id);
    if (!entity) {
      throw new NotFoundAppException('provider-registry.providerNotFound', { id });
    }
    return entity;
  }

  public async getProviderById(id: number): Promise<ProviderRegistryEntryView> {
    const entity = await this.getEntryOrThrow(id);
    return this.toSafeEntryView(entity);
  }

  public async createProvider(
    input: CreateProviderEntryRequest,
    actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView> {
    const providerCode = input.providerCode.trim().toLowerCase();
    const existing = await this.entryRepo.findByTypeAndCode(input.providerType, providerCode, true);
    if (existing) {
      throw new ConflictAppException('provider-registry.providerCodeConflict', [
        { providerType: input.providerType, providerCode },
      ]);
    }

    const status = input.status ?? PROVIDER_STATUS.ACTIVE;
    const isPrimary = Boolean(input.isPrimary);
    if (isPrimary && status !== PROVIDER_STATUS.ACTIVE) {
      throw new BadRequestAppException('provider-registry.cannotSetInactiveAsPrimary', [
        { providerCode },
      ]);
    }

    const sanitizedConfig = await this.validateAndNormalizeConfig(input.config ?? {});
    const { secretsEncrypted, secretHint } = this.encryptSecrets(input.secrets);
    const actorUserId = parseNumericUserId(actor?.id);
    const role =
      input.role ??
      (isPrimary
        ? PROVIDER_ROLE.PRIMARY
        : input.fallbackAllowed
          ? PROVIDER_ROLE.FALLBACK
          : PROVIDER_ROLE.STANDBY);

    const saved = await this.entryRepo.saveEntity({
      providerCode,
      providerType: input.providerType,
      driverCode: input.driverCode.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      description: input.description?.trim() || null,
      domainRefCode: input.domainRefCode?.trim() || null,
      httpServiceName: input.httpServiceName?.trim().toLowerCase() || null,
      role,
      priority: input.priority ?? 100,
      isPrimary,
      fallbackAllowed: Boolean(input.fallbackAllowed),
      status,
      pausedAt: status === PROVIDER_STATUS.PAUSED ? new Date() : null,
      pausedBy: status === PROVIDER_STATUS.PAUSED ? actorUserId : null,
      pausedReason:
        status === PROVIDER_STATUS.PAUSED
          ? (sanitizeProviderErrorMessage(input.reason) ?? 'Created in paused state')
          : null,
      secretRef: input.secretRef?.trim() || null,
      secretsEncrypted,
      secretHint,
      configJson: JSON.stringify(sanitizedConfig),
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    if (saved.isPrimary) {
      await this.entryRepo.clearPrimaryFlagExcept(saved.providerType, Number(saved.id));
    }

    await this.afterEntryMutated();

    const afterView = this.toSafeEntryView(saved);
    await this.historyService.recordChange({
      providerId: Number(saved.id),
      providerType: saved.providerType,
      providerCode: saved.providerCode,
      action: PROVIDER_HISTORY_ACTION.CREATE,
      beforeState: null,
      afterState: afterView as unknown as Record<string, unknown>,
      reason: input.reason ?? `Registered ${saved.providerType} provider "${saved.providerCode}"`,
      feature: PROVIDER_REGISTRY_AUDIT_META.FEATURES.ENTRIES,
      actor,
    });

    await this.publishEventSafe(PROVIDER_REGISTRY_EVENTS.PROVIDER_CREATED, {
      providerId: afterView.id,
      providerType: afterView.providerType,
      providerCode: afterView.providerCode,
      isPrimary: afterView.isPrimary,
    });

    return afterView;
  }

  public async updateProvider(
    id: number,
    input: UpdateProviderEntryRequest,
    actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView> {
    const existing = await this.getEntryOrThrow(id);
    const beforeView = this.toSafeEntryView(existing);

    const nextStatus = input.status ?? existing.status;
    const nextIsPrimary = input.isPrimary !== undefined ? input.isPrimary : existing.isPrimary;
    if (nextIsPrimary && nextStatus !== PROVIDER_STATUS.ACTIVE) {
      throw new BadRequestAppException('provider-registry.cannotSetInactiveAsPrimary', [
        { id, providerCode: existing.providerCode },
      ]);
    }

    const actorUserId = parseNumericUserId(actor?.id);
    if (input.driverCode !== undefined) existing.driverCode = input.driverCode.trim().toLowerCase();
    if (input.displayName !== undefined) existing.displayName = input.displayName.trim();
    if (input.description !== undefined) existing.description = input.description?.trim() || null;
    if (input.domainRefCode !== undefined) {
      existing.domainRefCode = input.domainRefCode?.trim() || null;
    }
    if (input.httpServiceName !== undefined) {
      existing.httpServiceName = input.httpServiceName?.trim().toLowerCase() || null;
    }
    if (input.priority !== undefined) existing.priority = input.priority;
    if (input.fallbackAllowed !== undefined) existing.fallbackAllowed = input.fallbackAllowed;
    if (input.isPrimary !== undefined) existing.isPrimary = input.isPrimary;
    if (input.role !== undefined) {
      existing.role = input.role;
    } else if (input.isPrimary === true) {
      existing.role = PROVIDER_ROLE.PRIMARY;
    } else if (input.isPrimary === false && existing.role === PROVIDER_ROLE.PRIMARY) {
      existing.role = existing.fallbackAllowed ? PROVIDER_ROLE.FALLBACK : PROVIDER_ROLE.STANDBY;
    }

    if (input.status !== undefined && input.status !== existing.status) {
      existing.status = input.status;
      if (input.status === PROVIDER_STATUS.PAUSED) {
        existing.pausedAt = new Date();
        existing.pausedBy = actorUserId;
        existing.pausedReason =
          sanitizeProviderErrorMessage(input.reason) ??
          existing.pausedReason ??
          'Paused via update';
      } else if (input.status === PROVIDER_STATUS.ACTIVE) {
        existing.pausedAt = null;
        existing.pausedBy = null;
        existing.pausedReason = null;
      }
    }

    if (input.secretRef !== undefined) {
      existing.secretRef = input.secretRef?.trim() || null;
    }
    if (input.clearSecrets) {
      existing.secretsEncrypted = null;
      existing.secretHint = null;
    } else if (input.secrets !== undefined) {
      const mergedSecrets = {
        ...this.decryptSecrets(existing.secretsEncrypted),
        ...input.secrets,
      };
      const encrypted = this.encryptSecrets(mergedSecrets);
      existing.secretsEncrypted = encrypted.secretsEncrypted;
      existing.secretHint = encrypted.secretHint;
    }

    if (input.config !== undefined) {
      const sanitizedConfig = await this.validateAndNormalizeConfig(input.config);
      existing.configJson = JSON.stringify(sanitizedConfig);
    }

    existing.updatedBy = actorUserId;
    const saved = await this.entryRepo.saveEntity(existing);
    if (saved.isPrimary) {
      await this.entryRepo.clearPrimaryFlagExcept(saved.providerType, Number(saved.id));
    }

    await this.afterEntryMutated();
    const afterView = this.toSafeEntryView(saved);

    await this.historyService.recordChange({
      providerId: Number(saved.id),
      providerType: saved.providerType,
      providerCode: saved.providerCode,
      action: PROVIDER_HISTORY_ACTION.UPDATE,
      beforeState: beforeView as unknown as Record<string, unknown>,
      afterState: afterView as unknown as Record<string, unknown>,
      reason: input.reason ?? `Updated ${saved.providerType} provider "${saved.providerCode}"`,
      feature: PROVIDER_REGISTRY_AUDIT_META.FEATURES.ENTRIES,
      actor,
    });

    await this.publishEventSafe(PROVIDER_REGISTRY_EVENTS.PROVIDER_UPDATED, {
      providerId: afterView.id,
      providerType: afterView.providerType,
      providerCode: afterView.providerCode,
    });

    return afterView;
  }

  public async setPrimary(
    id: number,
    reason?: string,
    actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView> {
    const existing = await this.getEntryOrThrow(id);
    if (existing.status !== PROVIDER_STATUS.ACTIVE) {
      throw new BadRequestAppException('provider-registry.cannotSetInactiveAsPrimary', [
        { id, providerCode: existing.providerCode },
      ]);
    }

    const beforeView = this.toSafeEntryView(existing);
    existing.isPrimary = true;
    existing.role = PROVIDER_ROLE.PRIMARY;
    existing.updatedBy = parseNumericUserId(actor?.id);

    const saved = await this.entryRepo.saveEntity(existing);
    await this.entryRepo.clearPrimaryFlagExcept(saved.providerType, Number(saved.id));
    await this.afterEntryMutated();

    const afterView = this.toSafeEntryView(saved);
    await this.historyService.recordChange({
      providerId: Number(saved.id),
      providerType: saved.providerType,
      providerCode: saved.providerCode,
      action: PROVIDER_HISTORY_ACTION.SET_PRIMARY,
      beforeState: beforeView as unknown as Record<string, unknown>,
      afterState: afterView as unknown as Record<string, unknown>,
      reason:
        reason?.trim() || `Set "${saved.providerCode}" as primary ${saved.providerType} provider`,
      feature: PROVIDER_REGISTRY_AUDIT_META.FEATURES.ENTRIES,
      actor,
    });

    await this.publishEventSafe(PROVIDER_REGISTRY_EVENTS.PROVIDER_PRIMARY_CHANGED, {
      providerId: afterView.id,
      providerType: afterView.providerType,
      providerCode: afterView.providerCode,
    });

    return afterView;
  }

  public async pauseProvider(
    id: number,
    reason?: string,
    actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView> {
    const existing = await this.getEntryOrThrow(id);
    if (existing.status === PROVIDER_STATUS.PAUSED) {
      throw new BadRequestAppException('provider-registry.providerAlreadyPaused', [
        { id, providerCode: existing.providerCode },
      ]);
    }

    const beforeView = this.toSafeEntryView(existing);
    const actorUserId = parseNumericUserId(actor?.id);
    const cleanReason = sanitizeProviderErrorMessage(reason) ?? 'Paused by administrator';

    existing.status = PROVIDER_STATUS.PAUSED;
    existing.pausedAt = new Date();
    existing.pausedBy = actorUserId;
    existing.pausedReason = cleanReason;
    existing.updatedBy = actorUserId;

    const saved = await this.entryRepo.saveEntity(existing);
    await this.afterEntryMutated();

    const afterView = this.toSafeEntryView(saved);
    await this.historyService.recordChange({
      providerId: Number(saved.id),
      providerType: saved.providerType,
      providerCode: saved.providerCode,
      action: PROVIDER_HISTORY_ACTION.PAUSE,
      beforeState: beforeView as unknown as Record<string, unknown>,
      afterState: afterView as unknown as Record<string, unknown>,
      reason: cleanReason,
      feature: PROVIDER_REGISTRY_AUDIT_META.FEATURES.ENTRIES,
      actor,
    });

    await this.publishEventSafe(PROVIDER_REGISTRY_EVENTS.PROVIDER_PAUSED, {
      providerId: afterView.id,
      providerType: afterView.providerType,
      providerCode: afterView.providerCode,
      reason: cleanReason,
    });

    return afterView;
  }

  public async resumeProvider(
    id: number,
    reason?: string,
    actor?: UserIdentity,
  ): Promise<ProviderRegistryEntryView> {
    const existing = await this.getEntryOrThrow(id);
    if (existing.status !== PROVIDER_STATUS.PAUSED) {
      throw new BadRequestAppException('provider-registry.providerNotPaused', [
        { id, providerCode: existing.providerCode },
      ]);
    }

    const beforeView = this.toSafeEntryView(existing);
    const cleanReason = sanitizeProviderErrorMessage(reason) ?? 'Resumed by administrator';

    existing.status = PROVIDER_STATUS.ACTIVE;
    existing.pausedAt = null;
    existing.pausedBy = null;
    existing.pausedReason = null;
    existing.updatedBy = parseNumericUserId(actor?.id);

    const saved = await this.entryRepo.saveEntity(existing);
    await this.afterEntryMutated();

    const afterView = this.toSafeEntryView(saved);
    await this.historyService.recordChange({
      providerId: Number(saved.id),
      providerType: saved.providerType,
      providerCode: saved.providerCode,
      action: PROVIDER_HISTORY_ACTION.RESUME,
      beforeState: beforeView as unknown as Record<string, unknown>,
      afterState: afterView as unknown as Record<string, unknown>,
      reason: cleanReason,
      feature: PROVIDER_REGISTRY_AUDIT_META.FEATURES.ENTRIES,
      actor,
    });

    await this.publishEventSafe(PROVIDER_REGISTRY_EVENTS.PROVIDER_RESUMED, {
      providerId: afterView.id,
      providerType: afterView.providerType,
      providerCode: afterView.providerCode,
      reason: cleanReason,
    });

    return afterView;
  }

  public async deleteProvider(
    id: number,
    reason?: string,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    const existing = await this.getEntryOrThrow(id);
    const beforeView = this.toSafeEntryView(existing);

    existing.isPrimary = false;
    existing.status = PROVIDER_STATUS.DISABLED;
    existing.updatedBy = parseNumericUserId(actor?.id);
    await this.entryRepo.saveEntity(existing);
    await this.entryRepo.repository.softDelete({ id: existing.id });
    await this.unitRepo.clearReferencesToProvider(Number(existing.id));

    await this.afterEntryMutated();
    await this.historyService.recordChange({
      providerId: Number(existing.id),
      providerType: existing.providerType,
      providerCode: existing.providerCode,
      action: PROVIDER_HISTORY_ACTION.DELETE,
      beforeState: beforeView as unknown as Record<string, unknown>,
      afterState: null,
      reason:
        reason?.trim() ||
        `Soft-deleted ${existing.providerType} provider "${existing.providerCode}"`,
      feature: PROVIDER_REGISTRY_AUDIT_META.FEATURES.ENTRIES,
      actor,
    });

    return { deleted: true, id: Number(existing.id) };
  }

  public toSafeEntryView(entity: ProviderRegistryEntryEntity): ProviderRegistryEntryView {
    const secrets = this.decryptSecrets(entity.secretsEncrypted);
    const configuredSecretKeys = Object.keys(secrets).filter((k) => Boolean(secrets[k]));
    return ProviderRegistryResponseMapper.toEntryView(entity, configuredSecretKeys);
  }

  public getSafeEntryViewByIdFromList(
    providerType: ProviderTypeName,
    providerCode: string,
    entries: readonly ProviderRegistryEntryEntity[],
  ): ProviderRegistryEntryView | null {
    const found = entries.find(
      (e) => e.providerType === providerType && e.providerCode === providerCode,
    );
    return found ? this.toSafeEntryView(found) : null;
  }

  public async afterEntryMutated(): Promise<void> {
    await this.syncKernelSnapshot();
    await this.cacheProvider?.delete(CACHE_KEY_SNAPSHOT_VERSION).catch(() => undefined);
  }

  private async validateAndNormalizeConfig(
    config: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const out = { ...config };
    if (typeof out.healthCheckUrl === 'string' && out.healthCheckUrl.trim()) {
      const runtimeConfig = resolveProviderRegistryConfig(this.settingRegistry);
      out.healthCheckUrl = await validateHealthCheckUrl(out.healthCheckUrl, {
        allowPrivateUrls: runtimeConfig.allowPrivateHealthUrls,
      });
    } else if (out.healthCheckUrl === '') {
      delete out.healthCheckUrl;
    }
    return out;
  }

  private encryptSecrets(secrets?: Record<string, string>): {
    readonly secretsEncrypted: string | null;
    readonly secretHint: string | null;
  } {
    if (!secrets) {
      return { secretsEncrypted: null, secretHint: null };
    }
    const cleaned: Record<string, string> = {};
    let firstSecret = '';
    for (const [k, v] of Object.entries(secrets)) {
      if (typeof v === 'string' && v.trim()) {
        cleaned[k.trim()] = v.trim();
        if (!firstSecret) firstSecret = v.trim();
      }
    }
    if (Object.keys(cleaned).length === 0) {
      return { secretsEncrypted: null, secretHint: null };
    }
    return {
      secretsEncrypted: this.encryptionService.encrypt(JSON.stringify(cleaned)),
      secretHint: maskProviderSecretHint(firstSecret),
    };
  }

  private decryptSecrets(encrypted: string | null | undefined): Record<string, string> {
    if (!encrypted) return {};
    try {
      const plain = this.encryptionService.decrypt(encrypted);
      const parsed = safeJsonParseObject<Record<string, unknown>>(plain, {});
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v) {
          out[k] = v;
        }
      }
      return out;
    } catch {
      return {};
    }
  }

  private async publishEventSafe(topic: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.messagePublisher) return;
    try {
      await this.messagePublisher.publish(topic, payload, QUEUES.SYSTEM_EVENTS);
    } catch {
      // Non-critical domain event
    }
  }
}
