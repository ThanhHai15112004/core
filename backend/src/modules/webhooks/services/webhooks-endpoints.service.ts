import { Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
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
import { WEBHOOK_ENDPOINT_STATUS } from '../enum/webhooks.enum.js';
import { resolveWebhookRuntimeConfig } from '../helpers/webhook-config.helper.js';
import {
  collectWebhookEventCatalog,
  normalizeWebhookEventPatterns,
} from '../helpers/webhook-event-matcher.helper.js';
import { normalizeAndValidateCustomHeaders } from '../helpers/webhook-redaction.helper.js';
import {
  generateWebhookSigningSecret,
  maskWebhookSigningSecret,
} from '../helpers/webhook-signature.helper.js';
import { assertWebhookUrlSafe, type WebhookDnsLookupFn } from '../helpers/webhook-ssrf.helper.js';
import { WebhookEndpointRepository } from '../repositories/webhook-endpoint.repository.js';
import type {
  CreateWebhookEndpointRequest,
  ListWebhookEndpointsQuery,
  ReactivateWebhookEndpointRequest,
  UpdateWebhookEndpointRequest,
} from '../requests/webhooks.requests.js';
import { WebhooksResponseMapper } from '../responses/webhooks.response.js';
import type {
  WebhookEndpointView,
  WebhookEndpointWithSecretView,
  WebhookEventCatalogItem,
} from '../types/webhooks.types.js';

@Injectable()
export class WebhooksEndpointsService {
  private readonly settingRegistry: SettingRegistryService;
  private readonly encryptionService: FieldEncryptionService;
  private dnsLookupOverride: WebhookDnsLookupFn | undefined;

  constructor(
    private readonly endpointRepo: WebhookEndpointRepository,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() encryptionService?: FieldEncryptionService,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.encryptionService = encryptionService ?? defaultFieldEncryptionService;
  }

  public setDnsLookupForTesting(fn?: WebhookDnsLookupFn): void {
    this.dnsLookupOverride = fn;
  }

  public listEventCatalog(): WebhookEventCatalogItem[] {
    return collectWebhookEventCatalog();
  }

  public async listEndpoints(
    query: ListWebhookEndpointsQuery,
  ): Promise<PaginatedResult<WebhookEndpointView>> {
    const paged = await this.endpointRepo.listPaginated({
      page: query.page,
      limit: query.limit,
      countMode: query.countMode,
      status: query.status,
      search: query.search,
    });
    return createPaginatedResult(
      paged.data.map((item) => WebhooksResponseMapper.toEndpointView(item)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async getEndpointById(id: number): Promise<WebhookEndpointView> {
    const entity = await this.endpointRepo.findByIdSafe(Number(id));
    if (!entity) {
      throw new NotFoundAppException('webhooks.endpointNotFound', { id });
    }
    return WebhooksResponseMapper.toEndpointView(entity);
  }

  public async createEndpoint(
    input: CreateWebhookEndpointRequest,
    actor?: UserIdentity,
  ): Promise<WebhookEndpointWithSecretView> {
    const runtimeConfig = resolveWebhookRuntimeConfig(this.settingRegistry);
    const normalizedUrl = await assertWebhookUrlSafe(input.url, {
      allowHttpInDev: runtimeConfig.allowHttpInDev,
      dnsLookup: this.dnsLookupOverride,
    });

    const events = normalizeWebhookEventPatterns(input.events);
    if (events.length === 0) {
      throw new BadRequestAppException('webhooks.invalidEvents');
    }

    const customHeaders = normalizeAndValidateCustomHeaders(input.customHeaders);
    const plainSecret = generateWebhookSigningSecret();
    const signingSecretEncrypted = this.encryptionService.encrypt(plainSecret);
    const signingSecretPrefix = maskWebhookSigningSecret(plainSecret);
    const actorUserId = parseNumericUserId(actor?.id);

    const saved = await this.endpointRepo.saveEntity({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      targetUrl: normalizedUrl,
      eventsJson: JSON.stringify(events),
      status: input.status ?? WEBHOOK_ENDPOINT_STATUS.ACTIVE,
      signingSecretEncrypted,
      signingSecretPrefix,
      customHeadersJson: JSON.stringify(customHeaders),
      timeoutMs: input.timeoutMs ?? runtimeConfig.defaultTimeoutMs,
      maxRetries: input.maxRetries ?? runtimeConfig.defaultMaxRetries,
      failureThreshold: input.failureThreshold ?? runtimeConfig.defaultFailureThreshold,
      consecutiveFailures: 0,
      disabledReason: null,
      disabledAt: null,
      lastTriggeredAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const view = WebhooksResponseMapper.toEndpointView(saved);
    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: 'webhooks',
      feature: 'endpoints',
      action: 'CREATE',
      resourceType: 'webhook_endpoint',
      resourceId: String(saved.id),
      beforeData: null,
      afterData: view as unknown as Record<string, unknown>,
      reason: 'Created outbound webhook endpoint',
    });

    return {
      ...view,
      signingSecret: plainSecret,
    };
  }

  public async updateEndpoint(
    id: number,
    input: UpdateWebhookEndpointRequest,
    actor?: UserIdentity,
  ): Promise<WebhookEndpointView> {
    const existing = await this.endpointRepo.findByIdSafe(Number(id));
    if (!existing) {
      throw new NotFoundAppException('webhooks.endpointNotFound', { id });
    }

    const runtimeConfig = resolveWebhookRuntimeConfig(this.settingRegistry);
    const beforeView = WebhooksResponseMapper.toEndpointView(existing);

    if (input.url !== undefined) {
      existing.targetUrl = await assertWebhookUrlSafe(input.url, {
        allowHttpInDev: runtimeConfig.allowHttpInDev,
        dnsLookup: this.dnsLookupOverride,
      });
    }

    if (input.events !== undefined) {
      const events = normalizeWebhookEventPatterns(input.events);
      if (events.length === 0) {
        throw new BadRequestAppException('webhooks.invalidEvents');
      }
      existing.eventsJson = JSON.stringify(events);
    }

    if (input.customHeaders !== undefined) {
      const customHeaders = normalizeAndValidateCustomHeaders(input.customHeaders);
      existing.customHeadersJson = JSON.stringify(customHeaders);
    }

    if (input.name !== undefined) existing.name = input.name.trim();
    if (input.description !== undefined) existing.description = input.description?.trim() || null;
    if (input.timeoutMs !== undefined) existing.timeoutMs = input.timeoutMs;
    if (input.maxRetries !== undefined) existing.maxRetries = input.maxRetries;
    if (input.failureThreshold !== undefined) existing.failureThreshold = input.failureThreshold;

    if (input.status !== undefined) {
      existing.status = input.status;
      if (input.status === WEBHOOK_ENDPOINT_STATUS.ACTIVE) {
        existing.consecutiveFailures = 0;
        existing.disabledReason = null;
        existing.disabledAt = null;
      }
    }

    const actorUserId = parseNumericUserId(actor?.id);
    existing.updatedBy = actorUserId;

    const saved = await this.endpointRepo.saveEntity(existing);
    const afterView = WebhooksResponseMapper.toEndpointView(saved);

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: 'webhooks',
      feature: 'endpoints',
      action: 'UPDATE',
      resourceType: 'webhook_endpoint',
      resourceId: String(saved.id),
      beforeData: beforeView as unknown as Record<string, unknown>,
      afterData: afterView as unknown as Record<string, unknown>,
      reason: input.reason?.trim() || 'Updated outbound webhook endpoint',
    });

    return afterView;
  }

  public async deleteEndpoint(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    const existing = await this.endpointRepo.findByIdSafe(Number(id));
    if (!existing) {
      throw new NotFoundAppException('webhooks.endpointNotFound', { id });
    }

    const beforeView = WebhooksResponseMapper.toEndpointView(existing);
    const actorUserId = parseNumericUserId(actor?.id);

    await this.endpointRepo.repository.softDelete({ id: existing.id });

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: 'webhooks',
      feature: 'endpoints',
      action: 'DELETE',
      resourceType: 'webhook_endpoint',
      resourceId: String(existing.id),
      beforeData: beforeView as unknown as Record<string, unknown>,
      afterData: null,
      reason: 'Deleted outbound webhook endpoint',
    });

    return { deleted: true, id: Number(existing.id) };
  }

  public async rotateSecret(
    id: number,
    actor?: UserIdentity,
  ): Promise<WebhookEndpointWithSecretView> {
    const existing = await this.endpointRepo.findByIdSafe(Number(id));
    if (!existing) {
      throw new NotFoundAppException('webhooks.endpointNotFound', { id });
    }

    const previousPrefix = existing.signingSecretPrefix;
    const plainSecret = generateWebhookSigningSecret();
    existing.signingSecretEncrypted = this.encryptionService.encrypt(plainSecret);
    existing.signingSecretPrefix = maskWebhookSigningSecret(plainSecret);
    const actorUserId = parseNumericUserId(actor?.id);
    existing.updatedBy = actorUserId;

    const saved = await this.endpointRepo.saveEntity(existing);
    const view = WebhooksResponseMapper.toEndpointView(saved);

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: 'webhooks',
      feature: 'endpoints',
      action: 'ROTATE_SECRET',
      resourceType: 'webhook_endpoint',
      resourceId: String(saved.id),
      beforeData: { signingSecretPrefix: previousPrefix },
      afterData: { signingSecretPrefix: saved.signingSecretPrefix },
      reason: 'Rotated webhook signing secret',
    });

    return {
      ...view,
      signingSecret: plainSecret,
    };
  }

  public async reactivateEndpoint(
    id: number,
    input: ReactivateWebhookEndpointRequest,
    actor?: UserIdentity,
  ): Promise<WebhookEndpointView> {
    const existing = await this.endpointRepo.findByIdSafe(Number(id));
    if (!existing) {
      throw new NotFoundAppException('webhooks.endpointNotFound', { id });
    }

    if (existing.status === WEBHOOK_ENDPOINT_STATUS.ACTIVE) {
      throw new BadRequestAppException('webhooks.endpointReactivateInvalidState', [{ id }]);
    }

    const runtimeConfig = resolveWebhookRuntimeConfig(this.settingRegistry);
    await assertWebhookUrlSafe(existing.targetUrl, {
      allowHttpInDev: runtimeConfig.allowHttpInDev,
      dnsLookup: this.dnsLookupOverride,
    });

    const beforeView = WebhooksResponseMapper.toEndpointView(existing);
    const actorUserId = parseNumericUserId(actor?.id);

    existing.status = WEBHOOK_ENDPOINT_STATUS.ACTIVE;
    existing.consecutiveFailures = 0;
    existing.disabledReason = null;
    existing.disabledAt = null;
    existing.updatedBy = actorUserId;

    const saved = await this.endpointRepo.saveEntity(existing);
    const afterView = WebhooksResponseMapper.toEndpointView(saved);

    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: 'webhooks',
      feature: 'endpoints',
      action: 'REACTIVATE',
      resourceType: 'webhook_endpoint',
      resourceId: String(saved.id),
      beforeData: beforeView as unknown as Record<string, unknown>,
      afterData: afterView as unknown as Record<string, unknown>,
      reason: input.reason?.trim() || 'Reactivated webhook endpoint',
    });

    return afterView;
  }
}
