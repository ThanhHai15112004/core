import { Injectable, Optional } from '@nestjs/common';
import {
  ConflictAppException,
  NotFoundAppException,
  SettingRegistryService,
  defaultSettingRegistry,
  parseNumericUserId,
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
  INBOUND_WEBHOOK_AUTH_TYPE,
  INBOUND_WEBHOOK_DEFAULTS,
  INBOUND_WEBHOOK_PROVIDER_STATUS,
  INBOUND_WEBHOOK_SIGNATURE_FORMAT,
} from '../enum/inbound-webhooks.enum.js';
import type { InboundWebhookProviderEntity } from '../entities/inbound-webhook-provider.entity.js';
import { resolveInboundWebhookRuntimeConfig } from '../helpers/inbound-webhook-config.helper.js';
import { normalizeAndValidateHeaderName } from '../helpers/inbound-webhook-extractor.helper.js';
import {
  generateInboundWebhookSecret,
  maskInboundWebhookSecret,
} from '../helpers/inbound-webhook-signature.helper.js';
import { InboundWebhookProviderRepository } from '../repositories/inbound-webhook-provider.repository.js';
import type {
  CreateInboundWebhookProviderInput,
  ListInboundWebhookProvidersQuery,
  RotateInboundWebhookSecretRequest,
  UpdateInboundWebhookProviderRequest,
} from '../requests/inbound-webhooks.requests.js';
import { InboundWebhooksResponseMapper } from '../responses/inbound-webhooks.response.js';
import type {
  InboundWebhookProviderView,
  InboundWebhookProviderWithSecretView,
} from '../types/inbound-webhooks.types.js';

@Injectable()
export class InboundWebhooksProvidersService {
  private readonly settingRegistry: SettingRegistryService;
  private readonly encryptionService: FieldEncryptionService;

  constructor(
    private readonly providerRepo: InboundWebhookProviderRepository,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() encryptionService?: FieldEncryptionService,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.encryptionService = encryptionService ?? defaultFieldEncryptionService;
  }

  public async listProviders(
    query: ListInboundWebhookProvidersQuery,
  ): Promise<PaginatedResult<InboundWebhookProviderView>> {
    const paged = await this.providerRepo.listPaginated({
      page: query.page,
      limit: query.limit,
      countMode: query.countMode,
      status: query.status,
      search: query.search,
    });
    return createPaginatedResult(
      paged.data.map((item) => InboundWebhooksResponseMapper.toProviderView(item)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async getProviderById(id: number): Promise<InboundWebhookProviderView> {
    const entity = await this.getProviderEntityById(id);
    return InboundWebhooksResponseMapper.toProviderView(entity);
  }

  public async getProviderEntityById(id: number): Promise<InboundWebhookProviderEntity> {
    const entity = await this.providerRepo.findByIdSafe(Number(id));
    if (!entity) {
      throw new NotFoundAppException('inbound-webhooks.providerNotFound', { id });
    }
    return entity;
  }

  public async getProviderEntityByCode(
    providerCode: string,
  ): Promise<InboundWebhookProviderEntity | null> {
    return this.providerRepo.findByCode(providerCode);
  }

  public decryptSigningSecret(provider: InboundWebhookProviderEntity): string {
    return this.encryptionService.decrypt(provider.signingSecretEncrypted);
  }

  public async createProvider(
    input: CreateInboundWebhookProviderInput,
    actor?: UserIdentity,
  ): Promise<InboundWebhookProviderWithSecretView> {
    const normalizedCode = input.providerCode.trim().toLowerCase();
    const existing = await this.providerRepo.findByCode(normalizedCode);
    if (existing) {
      throw new ConflictAppException('inbound-webhooks.providerCodeExists', [
        { field: 'providerCode', providerCode: normalizedCode },
      ]);
    }

    const runtimeConfig = resolveInboundWebhookRuntimeConfig(this.settingRegistry);
    const authType = input.authType ?? INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256;
    const signatureFormat =
      input.signatureFormat ??
      (authType === INBOUND_WEBHOOK_AUTH_TYPE.STATIC_TOKEN
        ? INBOUND_WEBHOOK_SIGNATURE_FORMAT.RAW_BODY
        : INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY);
    const signaturePrefix =
      input.signaturePrefix !== undefined
        ? input.signaturePrefix?.length
          ? input.signaturePrefix
          : null
        : authType === INBOUND_WEBHOOK_AUTH_TYPE.STATIC_TOKEN
          ? null
          : INBOUND_WEBHOOK_DEFAULTS.SIGNATURE_PREFIX;
    const requireTimestamp =
      input.requireTimestamp ??
      (authType !== INBOUND_WEBHOOK_AUTH_TYPE.STATIC_TOKEN &&
        signatureFormat === INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY);

    const plainSecret = input.signingSecret?.trim() || generateInboundWebhookSecret();
    const actorUserId = parseNumericUserId(actor?.id);

    const saved = await this.providerRepo.saveEntity({
      providerCode: normalizedCode,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: input.status ?? INBOUND_WEBHOOK_PROVIDER_STATUS.ACTIVE,
      authType,
      signingSecretEncrypted: this.encryptionService.encrypt(plainSecret),
      signingSecretPrefix: maskInboundWebhookSecret(plainSecret),
      signatureHeader: normalizeAndValidateHeaderName(
        input.signatureHeader ?? INBOUND_WEBHOOK_DEFAULTS.SIGNATURE_HEADER,
      ),
      signaturePrefix,
      signatureFormat,
      timestampHeader: normalizeAndValidateHeaderName(
        input.timestampHeader ?? INBOUND_WEBHOOK_DEFAULTS.TIMESTAMP_HEADER,
      ),
      requireTimestamp,
      toleranceSec: input.toleranceSec ?? runtimeConfig.defaultToleranceSec,
      eventIdHeader: normalizeAndValidateHeaderName(
        input.eventIdHeader ?? INBOUND_WEBHOOK_DEFAULTS.EVENT_ID_HEADER,
      ),
      eventIdPayloadPath: input.eventIdPayloadPath?.trim() || null,
      eventTypeHeader: normalizeAndValidateHeaderName(
        input.eventTypeHeader ?? INBOUND_WEBHOOK_DEFAULTS.EVENT_TYPE_HEADER,
      ),
      eventTypePayloadPath: input.eventTypePayloadPath?.trim() || null,
      sensitiveFieldsJson: JSON.stringify([
        ...new Set((input.sensitiveFields ?? []).map((f) => f.trim()).filter(Boolean)),
      ]),
      maxRetries: input.maxRetries ?? runtimeConfig.defaultMaxRetries,
      lastReceivedAt: null,
      lastProcessedAt: null,
      lastRejectedAt: null,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const view = InboundWebhooksResponseMapper.toProviderView(saved);
    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: 'inbound-webhooks',
      feature: 'providers',
      action: 'CREATE',
      resourceType: 'inbound_webhook_provider',
      resourceId: String(saved.id),
      beforeData: null,
      afterData: view as unknown as Record<string, unknown>,
      reason: `Created inbound webhook provider "${saved.providerCode}"`,
    });

    return InboundWebhooksResponseMapper.toProviderWithSecretView(saved, plainSecret);
  }

  public async updateProvider(
    id: number,
    input: UpdateInboundWebhookProviderRequest,
    actor?: UserIdentity,
  ): Promise<InboundWebhookProviderView> {
    const existing = await this.getProviderEntityById(id);
    const beforeView = InboundWebhooksResponseMapper.toProviderView(existing);

    if (input.name !== undefined) existing.name = input.name.trim();
    if (input.description !== undefined) existing.description = input.description?.trim() || null;
    if (input.status !== undefined) existing.status = input.status;
    if (input.authType !== undefined) existing.authType = input.authType;
    if (input.signatureHeader !== undefined) {
      existing.signatureHeader = normalizeAndValidateHeaderName(input.signatureHeader);
    }
    if (input.signaturePrefix !== undefined) {
      existing.signaturePrefix = input.signaturePrefix?.length ? input.signaturePrefix : null;
    }
    if (input.signatureFormat !== undefined) existing.signatureFormat = input.signatureFormat;
    if (input.timestampHeader !== undefined) {
      existing.timestampHeader = normalizeAndValidateHeaderName(input.timestampHeader);
    }
    if (input.requireTimestamp !== undefined) existing.requireTimestamp = input.requireTimestamp;
    if (input.toleranceSec !== undefined) existing.toleranceSec = input.toleranceSec;
    if (input.eventIdHeader !== undefined) {
      existing.eventIdHeader = normalizeAndValidateHeaderName(input.eventIdHeader);
    }
    if (input.eventIdPayloadPath !== undefined) {
      existing.eventIdPayloadPath = input.eventIdPayloadPath?.trim() || null;
    }
    if (input.eventTypeHeader !== undefined) {
      existing.eventTypeHeader = normalizeAndValidateHeaderName(input.eventTypeHeader);
    }
    if (input.eventTypePayloadPath !== undefined) {
      existing.eventTypePayloadPath = input.eventTypePayloadPath?.trim() || null;
    }
    if (input.sensitiveFields !== undefined) {
      existing.sensitiveFieldsJson = JSON.stringify([
        ...new Set(input.sensitiveFields.map((f) => f.trim()).filter(Boolean)),
      ]);
    }
    if (input.maxRetries !== undefined) existing.maxRetries = input.maxRetries;

    const actorUserId = parseNumericUserId(actor?.id);
    existing.updatedBy = actorUserId;

    const saved = await this.providerRepo.saveEntity(existing);
    const afterView = InboundWebhooksResponseMapper.toProviderView(saved);

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: 'inbound-webhooks',
      feature: 'providers',
      action: 'UPDATE',
      resourceType: 'inbound_webhook_provider',
      resourceId: String(saved.id),
      beforeData: beforeView as unknown as Record<string, unknown>,
      afterData: afterView as unknown as Record<string, unknown>,
      reason: input.reason?.trim() || 'Updated inbound webhook provider',
    });

    return afterView;
  }

  public async deleteProvider(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    const existing = await this.getProviderEntityById(id);
    const beforeView = InboundWebhooksResponseMapper.toProviderView(existing);
    const actorUserId = parseNumericUserId(actor?.id);

    await this.providerRepo.repository.softDelete({ id: existing.id });

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: 'inbound-webhooks',
      feature: 'providers',
      action: 'DELETE',
      resourceType: 'inbound_webhook_provider',
      resourceId: String(existing.id),
      beforeData: beforeView as unknown as Record<string, unknown>,
      afterData: null,
      reason: 'Deleted inbound webhook provider',
    });

    return { deleted: true, id: Number(existing.id) };
  }

  public async rotateSecret(
    id: number,
    input: RotateInboundWebhookSecretRequest = {},
    actor?: UserIdentity,
  ): Promise<InboundWebhookProviderWithSecretView> {
    const existing = await this.getProviderEntityById(id);
    const previousPrefix = existing.signingSecretPrefix;

    const plainSecret = input.signingSecret?.trim() || generateInboundWebhookSecret();
    existing.signingSecretEncrypted = this.encryptionService.encrypt(plainSecret);
    existing.signingSecretPrefix = maskInboundWebhookSecret(plainSecret);

    const actorUserId = parseNumericUserId(actor?.id);
    existing.updatedBy = actorUserId;

    const saved = await this.providerRepo.saveEntity(existing);

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: 'inbound-webhooks',
      feature: 'providers',
      action: 'ROTATE_SECRET',
      resourceType: 'inbound_webhook_provider',
      resourceId: String(saved.id),
      beforeData: { signingSecretPrefix: previousPrefix },
      afterData: { signingSecretPrefix: saved.signingSecretPrefix },
      reason: input.reason?.trim() || 'Rotated inbound webhook signing secret',
    });

    return InboundWebhooksResponseMapper.toProviderWithSecretView(saved, plainSecret);
  }
}
