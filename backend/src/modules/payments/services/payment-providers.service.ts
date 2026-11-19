import { Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
  SettingRegistryService,
  defaultSettingRegistry,
  parseNumericUserId,
  safeJsonParseObject,
  safeJsonParseStringArray,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  AuditLogService,
  FieldEncryptionService,
  defaultFieldEncryptionService,
  type UserIdentity,
} from '@packages/security/index.js';
import {
  PAYMENT_AUDIT_META,
  PAYMENT_ENVIRONMENT,
  PAYMENT_PROVIDER_STATUS,
} from '../enum/payments.enum.js';
import type { PaymentProviderEntity } from '../entities/payment-provider.entity.js';
import { resolvePaymentRuntimeConfig } from '../helpers/payment-config.helper.js';
import { maskSecretHint } from '../helpers/payment-redaction.helper.js';
import { PaymentProviderRepository } from '../repositories/payment-provider.repository.js';
import type {
  CreatePaymentProviderRequest,
  ListPaymentProvidersQuery,
  UpdatePaymentProviderRequest,
} from '../requests/payments.requests.js';
import { PaymentResponseMapper } from '../responses/payments.response.js';
import type { PaymentAdapterResolvedConfig, PaymentProviderView } from '../types/payments.types.js';
import { PaymentAdapterRegistryService } from './payment-adapter-registry.service.js';

@Injectable()
export class PaymentProvidersService {
  private readonly settingRegistry: SettingRegistryService;
  private readonly encryptionService: FieldEncryptionService;

  constructor(
    private readonly providerRepo: PaymentProviderRepository,
    private readonly adapterRegistry: PaymentAdapterRegistryService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() encryptionService?: FieldEncryptionService,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.encryptionService = encryptionService ?? defaultFieldEncryptionService;
  }

  public async listProvidersPaginated(
    query: ListPaymentProvidersQuery,
  ): Promise<PaginatedResult<PaymentProviderView>> {
    const paged = await this.providerRepo.listPaginated(query);
    return createPaginatedResult(
      paged.data.map((entity) => this.toSafeProviderView(entity)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async listAllProviders(): Promise<PaymentProviderView[]> {
    const list = await this.providerRepo.listAll();
    return list.map((entity) => this.toSafeProviderView(entity));
  }

  public async getProviderById(id: number): Promise<PaymentProviderView> {
    const entity = await this.providerRepo.findByIdSafe(id);
    if (!entity) {
      throw new NotFoundAppException('payments.providerNotFound', { id });
    }
    return this.toSafeProviderView(entity);
  }

  public async createProvider(
    input: CreatePaymentProviderRequest,
    actor?: UserIdentity,
  ): Promise<PaymentProviderView> {
    const adapter = this.adapterRegistry.getAdapterOrThrow(input.driverCode);
    const meta = adapter.getMetadata();
    const providerCode = input.providerCode.trim().toLowerCase();

    const existing = await this.providerRepo.findByCode(providerCode, true);
    if (existing) {
      throw new ConflictAppException('payments.providerCodeConflict', [{ providerCode }]);
    }

    const actorUserId = parseNumericUserId(actor?.id);
    const allowedCurrencies =
      input.allowedCurrencies && input.allowedCurrencies.length > 0
        ? input.allowedCurrencies
        : [...meta.supportedCurrencies];

    const secrets = input.secrets ?? {};
    const { secretsEncrypted, secretHint } = this.encryptSecrets(secrets);

    const saved = await this.providerRepo.saveEntity({
      providerCode,
      driverCode: input.driverCode,
      displayName: input.displayName.trim(),
      description: input.description?.trim() || null,
      status: input.status ?? PAYMENT_PROVIDER_STATUS.ACTIVE,
      isEnabled: input.isEnabled ?? true,
      isDefault: Boolean(input.isDefault),
      environment: input.environment ?? PAYMENT_ENVIRONMENT.SANDBOX,
      supportsPartialRefund:
        input.supportsPartialRefund !== undefined
          ? Boolean(input.supportsPartialRefund && meta.supportsPartialRefund)
          : meta.supportsPartialRefund,
      allowedCurrenciesJson: JSON.stringify(allowedCurrencies),
      configJson: JSON.stringify(input.config ?? {}),
      secretsEncrypted,
      secretHint,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorCode: null,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    if (saved.isDefault) {
      await this.providerRepo.clearDefaultFlagExcept(saved.id);
    }

    const view = this.toSafeProviderView(saved);
    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: PAYMENT_AUDIT_META.MODULE,
      feature: PAYMENT_AUDIT_META.FEATURES.PROVIDERS,
      action: 'CREATE',
      resourceType: 'payment_provider',
      resourceId: String(saved.id),
      beforeData: null,
      afterData: view as unknown as Record<string, unknown>,
      reason: `Created payment provider "${providerCode}" (${input.driverCode})`,
    });

    return view;
  }

  public async updateProvider(
    id: number,
    input: UpdatePaymentProviderRequest,
    actor?: UserIdentity,
  ): Promise<PaymentProviderView> {
    const existing = await this.providerRepo.findByIdSafe(id);
    if (!existing) {
      throw new NotFoundAppException('payments.providerNotFound', { id });
    }

    const meta = this.adapterRegistry.getAdapterOrThrow(existing.driverCode).getMetadata();
    const beforeView = this.toSafeProviderView(existing);
    const actorUserId = parseNumericUserId(actor?.id);

    if (input.displayName !== undefined) existing.displayName = input.displayName.trim();
    if (input.description !== undefined) existing.description = input.description?.trim() || null;
    if (input.status !== undefined) existing.status = input.status;
    if (input.isEnabled !== undefined) existing.isEnabled = input.isEnabled;
    if (input.isDefault !== undefined) existing.isDefault = input.isDefault;
    if (input.environment !== undefined) existing.environment = input.environment;
    if (input.supportsPartialRefund !== undefined) {
      existing.supportsPartialRefund = Boolean(
        input.supportsPartialRefund && meta.supportsPartialRefund,
      );
    }
    if (input.allowedCurrencies !== undefined) {
      existing.allowedCurrenciesJson = JSON.stringify(input.allowedCurrencies);
    }
    if (input.config !== undefined) {
      const currentConfig = safeJsonParseObject<Record<string, unknown>>(existing.configJson, {});
      existing.configJson = JSON.stringify({ ...currentConfig, ...input.config });
    }
    if (input.secrets !== undefined) {
      const currentSecrets = this.decryptSecrets(existing.secretsEncrypted);
      const mergedSecrets = { ...currentSecrets, ...input.secrets };
      const { secretsEncrypted, secretHint } = this.encryptSecrets(mergedSecrets);
      existing.secretsEncrypted = secretsEncrypted;
      existing.secretHint = secretHint;
    }
    existing.updatedBy = actorUserId;

    const saved = await this.providerRepo.saveEntity(existing);
    if (saved.isDefault) {
      await this.providerRepo.clearDefaultFlagExcept(saved.id);
    }

    const afterView = this.toSafeProviderView(saved);
    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: PAYMENT_AUDIT_META.MODULE,
      feature: PAYMENT_AUDIT_META.FEATURES.PROVIDERS,
      action: 'UPDATE',
      resourceType: 'payment_provider',
      resourceId: String(saved.id),
      beforeData: beforeView as unknown as Record<string, unknown>,
      afterData: afterView as unknown as Record<string, unknown>,
      reason: `Updated payment provider "${saved.providerCode}"`,
    });

    return afterView;
  }

  public async deleteProvider(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    const existing = await this.providerRepo.findByIdSafe(id);
    if (!existing) {
      throw new NotFoundAppException('payments.providerNotFound', { id });
    }
    const actorUserId = parseNumericUserId(actor?.id);
    const beforeView = this.toSafeProviderView(existing);
    await this.providerRepo.repository.softDelete({ id: existing.id });

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: PAYMENT_AUDIT_META.MODULE,
      feature: PAYMENT_AUDIT_META.FEATURES.PROVIDERS,
      action: 'DELETE',
      resourceType: 'payment_provider',
      resourceId: String(existing.id),
      beforeData: beforeView as unknown as Record<string, unknown>,
      afterData: null,
      reason: `Soft-deleted payment provider "${existing.providerCode}"`,
    });

    return { deleted: true, id: Number(existing.id) };
  }

  public async resolveActiveProviderEntity(providerCode?: string): Promise<PaymentProviderEntity> {
    let entity: PaymentProviderEntity | null = null;
    if (providerCode?.trim()) {
      entity = await this.providerRepo.findByCode(providerCode.trim().toLowerCase());
      if (!entity) {
        throw new NotFoundAppException('payments.providerNotFound', { providerCode });
      }
    } else {
      entity = await this.providerRepo.findDefaultActiveProvider();
      if (!entity) {
        throw new BadRequestAppException('payments.noDefaultProvider');
      }
    }

    if (!entity.isEnabled || entity.status !== PAYMENT_PROVIDER_STATUS.ACTIVE) {
      throw new BadRequestAppException('payments.providerDisabled', [
        {
          providerCode: entity.providerCode,
        },
      ]);
    }
    return entity;
  }

  public async resolveProviderEntityByCode(providerCode: string): Promise<PaymentProviderEntity> {
    const entity = await this.providerRepo.findByCode(providerCode.trim().toLowerCase());
    if (!entity) {
      throw new NotFoundAppException('payments.providerNotFound', { providerCode });
    }
    return entity;
  }

  public buildAdapterResolvedConfig(entity: PaymentProviderEntity): PaymentAdapterResolvedConfig {
    const runtimeConfig = resolvePaymentRuntimeConfig(this.settingRegistry);
    const meta = this.adapterRegistry.getAdapterOrThrow(entity.driverCode).getMetadata();
    const parsedCurrencies = safeJsonParseStringArray(entity.allowedCurrenciesJson).map((c) =>
      c.toUpperCase(),
    );

    return {
      providerId: Number(entity.id),
      providerCode: entity.providerCode,
      driverCode: entity.driverCode,
      environment: entity.environment,
      supportsPartialRefund: Boolean(entity.supportsPartialRefund && meta.supportsPartialRefund),
      allowedCurrencies:
        parsedCurrencies.length > 0 ? parsedCurrencies : [...meta.supportedCurrencies],
      config: safeJsonParseObject<Record<string, unknown>>(entity.configJson, {}),
      secrets: this.decryptSecrets(entity.secretsEncrypted),
      callbackToleranceSec: runtimeConfig.callbackToleranceSec,
    };
  }

  public toSafeProviderView(entity: PaymentProviderEntity): PaymentProviderView {
    const secrets = this.decryptSecrets(entity.secretsEncrypted);
    const configuredSecretKeys = Object.keys(secrets).filter((k) => Boolean(secrets[k]));
    return PaymentResponseMapper.toProviderView(entity, configuredSecretKeys);
  }

  private encryptSecrets(secrets: Record<string, string>): {
    readonly secretsEncrypted: string | null;
    readonly secretHint: string | null;
  } {
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
      secretHint: maskSecretHint(firstSecret),
    };
  }

  private decryptSecrets(encrypted: string | null | undefined): Record<string, string> {
    if (!encrypted) return {};
    try {
      const plain = this.encryptionService.decrypt(encrypted);
      const obj = safeJsonParseObject<Record<string, unknown>>(plain, {});
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' && v) {
          out[k] = v;
        }
      }
      return out;
    } catch {
      return {};
    }
  }
}
