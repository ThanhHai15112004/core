import { randomUUID } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
  SettingRegistryService,
  UnauthorizedAppException,
  defaultSettingRegistry,
  parseNumericUserId,
  safeJsonParseObject,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import { maskIp } from '@packages/http/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { BaseMessagePublisherProvider, QUEUES } from '@packages/messaging/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  INBOUND_WEBHOOKS_QUEUE_TOPICS,
  INBOUND_WEBHOOK_AUTH_TYPE,
  INBOUND_WEBHOOK_EVENT_STATUS,
  INBOUND_WEBHOOK_PROVIDER_STATUS,
  INBOUND_WEBHOOK_REJECTION_REASON,
  INBOUND_WEBHOOK_SIGNATURE_FORMAT,
  getInboundWebhookEventStatusName,
  type InboundWebhookRejectionReason,
} from '../enum/inbound-webhooks.enum.js';
import type { InboundWebhookEventEntity } from '../entities/inbound-webhook-event.entity.js';
import type { InboundWebhookProviderEntity } from '../entities/inbound-webhook-provider.entity.js';
import { resolveInboundWebhookRuntimeConfig } from '../helpers/inbound-webhook-config.helper.js';
import {
  extractEventType,
  extractExternalEventId,
  normalizeIncomingHeaders,
} from '../helpers/inbound-webhook-extractor.helper.js';
import {
  redactAndSerializeInboundPayload,
  redactInboundHeaders,
} from '../helpers/inbound-webhook-redaction.helper.js';
import {
  computeInboundHmacSignature,
  computePayloadSha256Hex,
  parseInboundWebhookTimestamp,
  parseSignatureHeaderComponents,
  validateInboundWebhookTimestamp,
  verifyInboundWebhookAuth,
} from '../helpers/inbound-webhook-signature.helper.js';
import { InboundWebhookEventRepository } from '../repositories/inbound-webhook-event.repository.js';
import { InboundWebhookProviderRepository } from '../repositories/inbound-webhook-provider.repository.js';
import type { SimulateInboundWebhookRequest } from '../requests/inbound-webhooks.requests.js';
import type {
  InboundWebhookRuntimeConfig,
  ReceiveInboundWebhookInput,
  ReceiveInboundWebhookResult,
  SimulateInboundWebhookResult,
} from '../types/inbound-webhooks.types.js';
import { InboundWebhooksProvidersService } from './inbound-webhooks-providers.service.js';

function isUniqueConstraintViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as Record<string, unknown>;
  const code = String(record['code'] ?? '');
  const driverErr = record['driverError'] as Record<string, unknown> | undefined;
  const driverCode = String(driverErr?.['code'] ?? '');
  const errno = Number(driverErr?.['errno'] ?? record['errno'] ?? 0);
  const message = String(record['message'] ?? '').toLowerCase();

  return (
    code === '23505' ||
    driverCode === '23505' ||
    code === 'ER_DUP_ENTRY' ||
    driverCode === 'ER_DUP_ENTRY' ||
    errno === 1062 ||
    code === 'SQLITE_CONSTRAINT' ||
    message.includes('duplicate') ||
    message.includes('unique constraint')
  );
}

@Injectable()
export class InboundWebhooksReceiveService {
  private readonly logger = new Logger(InboundWebhooksReceiveService.name);
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly providersService: InboundWebhooksProvidersService,
    private readonly providerRepo: InboundWebhookProviderRepository,
    private readonly eventRepo: InboundWebhookEventRepository,
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
  }

  public async receiveWebhook(
    input: ReceiveInboundWebhookInput,
    options?: { readonly nowSec?: number | undefined },
  ): Promise<ReceiveInboundWebhookResult> {
    const providerCode = input.providerCode.trim().toLowerCase();
    const provider = await this.providersService.getProviderEntityByCode(providerCode);
    if (!provider) {
      throw new NotFoundAppException('inbound-webhooks.providerNotFound', { providerCode });
    }

    const runtimeConfig = resolveInboundWebhookRuntimeConfig(this.settingRegistry);
    const headers = normalizeIncomingHeaders(input.headers);
    const parsedPayload = this.resolveParsedPayload(input.parsedBody, input.rawBody);
    const correlationId =
      input.correlationId?.trim() ||
      RequestContextService.currentCorrelationId() ||
      `corr_${randomUUID()}`;
    const sourceIpMasked = maskIp(input.sourceIp);
    const payloadHash = computePayloadSha256Hex(input.rawBody);
    const payloadSizeBytes = Buffer.byteLength(input.rawBody, 'utf8');
    const now = options?.nowSec !== undefined ? new Date(options.nowSec * 1000) : new Date();

    if (provider.status !== INBOUND_WEBHOOK_PROVIDER_STATUS.ACTIVE) {
      await this.recordRejectedEvent({
        provider,
        headers,
        parsedPayload,
        payloadHash,
        payloadSizeBytes,
        sourceIpMasked,
        correlationId,
        runtimeConfig,
        rejectionReason: INBOUND_WEBHOOK_REJECTION_REASON.PROVIDER_PAUSED,
        eventType: extractEventType(headers, parsedPayload, provider),
        eventTimestamp: null,
        errorMessage: 'Inbound webhook provider is paused',
        now,
      });
      throw new ForbiddenAppException('inbound-webhooks.providerPaused', [{ providerCode }]);
    }

    const plainSecret = this.providersService.decryptSigningSecret(provider);
    const signatureHeaderVal = headers[provider.signatureHeader.trim().toLowerCase()];
    const sigComponents = parseSignatureHeaderComponents(signatureHeaderVal);
    const rawTimestamp =
      headers[provider.timestampHeader.trim().toLowerCase()] ??
      sigComponents.timestampRaw ??
      undefined;
    const effectiveToleranceSec = Number(
      provider.toleranceSec ?? runtimeConfig.defaultToleranceSec,
    );
    const extractedEventType = extractEventType(headers, parsedPayload, provider);

    const validatedTimestampSec = await this.verifySecurityAndReplayWindow({
      provider,
      plainSecret,
      rawBody: input.rawBody,
      headers,
      parsedPayload,
      signatureHeaderVal,
      rawTimestamp,
      toleranceSec: effectiveToleranceSec,
      nowSec: options?.nowSec,
      now,
      payloadHash,
      payloadSizeBytes,
      sourceIpMasked,
      correlationId,
      runtimeConfig,
      extractedEventType,
    });

    const externalEventId = extractExternalEventId(headers, parsedPayload, provider);
    if (!externalEventId) {
      await this.recordRejectedEvent({
        provider,
        headers,
        parsedPayload,
        payloadHash,
        payloadSizeBytes,
        sourceIpMasked,
        correlationId,
        runtimeConfig,
        rejectionReason: INBOUND_WEBHOOK_REJECTION_REASON.MISSING_EVENT_ID,
        eventType: extractedEventType,
        eventTimestamp: validatedTimestampSec ? new Date(validatedTimestampSec * 1000) : null,
        errorMessage: 'Missing external event ID for idempotency',
        now,
      });
      throw new BadRequestAppException('inbound-webhooks.missingEventId', [{ providerCode }]);
    }

    const existing = await this.eventRepo.findByProviderAndExternalEventId(
      provider.providerCode,
      externalEventId,
    );
    if (existing) {
      return this.handleExistingIdempotentEvent({
        existing,
        provider,
        headers,
        parsedPayload,
        payloadHash,
        payloadSizeBytes,
        sourceIpMasked,
        correlationId,
        runtimeConfig,
        externalEventId,
        eventType: extractedEventType,
        eventTimestamp: validatedTimestampSec ? new Date(validatedTimestampSec * 1000) : null,
        now,
      });
    }

    const extraSensitiveFields = safeJsonParseStringArray(provider.sensitiveFieldsJson);
    const redactedHeaders = redactInboundHeaders(headers, [provider.signatureHeader]);
    const redactedPayload = redactAndSerializeInboundPayload(parsedPayload, {
      extraSensitiveFields,
      maskPiiInPayload: runtimeConfig.maskPiiInPayload,
      maxStoredPayloadBytes: runtimeConfig.maxStoredPayloadBytes,
    });

    const maxAttempts =
      1 + Math.max(0, Number(provider.maxRetries ?? runtimeConfig.defaultMaxRetries));

    let saved: InboundWebhookEventEntity;
    try {
      saved = await this.eventRepo.saveEntity({
        eventUid: `inb_${randomUUID()}`,
        providerId: Number(provider.id),
        providerCode: provider.providerCode,
        externalEventId,
        eventType: extractedEventType,
        eventTimestamp: validatedTimestampSec ? new Date(validatedTimestampSec * 1000) : null,
        payloadHash,
        headersRedactedJson: JSON.stringify(redactedHeaders),
        payloadRedactedJson: redactedPayload.json,
        payloadSizeBytes,
        payloadTruncated: redactedPayload.truncated,
        sourceIpMasked,
        status: INBOUND_WEBHOOK_EVENT_STATUS.QUEUED,
        rejectionReason: null,
        attemptCount: 0,
        maxAttempts,
        duplicateCount: 0,
        lastDuplicateAt: null,
        lastHandlerName: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        receivedAt: now,
        processedAt: null,
        correlationId,
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        const racedExisting = await this.eventRepo.findByProviderAndExternalEventId(
          provider.providerCode,
          externalEventId,
        );
        if (racedExisting) {
          return this.handleExistingIdempotentEvent({
            existing: racedExisting,
            provider,
            headers,
            parsedPayload,
            payloadHash,
            payloadSizeBytes,
            sourceIpMasked,
            correlationId,
            runtimeConfig,
            externalEventId,
            eventType: extractedEventType,
            eventTimestamp: validatedTimestampSec ? new Date(validatedTimestampSec * 1000) : null,
            now,
          });
        }
      }
      throw err;
    }

    provider.lastReceivedAt = now;
    await this.providerRepo.saveEntity(provider);

    await this.enqueueEventProcessing(saved, externalEventId, runtimeConfig);

    return {
      accepted: true,
      duplicate: false,
      eventId: Number(saved.id),
      eventUid: saved.eventUid,
      providerCode: saved.providerCode,
      externalEventId,
      eventType: saved.eventType ?? null,
      status: saved.status,
      statusName: getInboundWebhookEventStatusName(saved.status),
    };
  }

  public async simulateProviderWebhook(
    providerId: number,
    input: SimulateInboundWebhookRequest,
    actor?: UserIdentity,
  ): Promise<SimulateInboundWebhookResult> {
    const provider = await this.providersService.getProviderEntityById(providerId);
    const plainSecret = this.providersService.decryptSigningSecret(provider);
    const timestampSec = Math.floor(Date.now() / 1000);
    const generatedEventId = input.externalEventId?.trim() || `evt_sim_${randomUUID()}`;
    const eventType = input.eventType?.trim() || 'webhook.simulated';

    const bodyObject: Record<string, unknown> = {
      ...(input.payload ?? {}),
      id: generatedEventId,
      type: eventType,
      simulated: true,
    };
    const rawBody = JSON.stringify(bodyObject);

    let signatureHeaderValue: string;
    if (provider.authType === INBOUND_WEBHOOK_AUTH_TYPE.STATIC_TOKEN) {
      signatureHeaderValue = provider.signaturePrefix
        ? `${provider.signaturePrefix}${plainSecret}`
        : plainSecret;
    } else {
      signatureHeaderValue = computeInboundHmacSignature({
        rawBody,
        secret: plainSecret,
        algorithm: provider.authType,
        format: provider.signatureFormat,
        timestampSec,
        prefix: provider.signaturePrefix ?? '',
      });
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      [provider.signatureHeader]: signatureHeaderValue,
      [provider.timestampHeader]: String(timestampSec),
      [provider.eventIdHeader]: generatedEventId,
      [provider.eventTypeHeader]: eventType,
    };

    const receiveResult = await this.receiveWebhook({
      providerCode: provider.providerCode,
      rawBody,
      parsedBody: bodyObject,
      headers,
      sourceIp: '127.0.0.1',
    });

    const actorUserId = parseNumericUserId(actor?.id);
    await this.auditLogService?.record({
      actor: actor ?? null,
      actorUserId,
      module: 'inbound-webhooks',
      feature: 'providers',
      action: 'SIMULATE',
      resourceType: 'inbound_webhook_provider',
      resourceId: String(provider.id),
      beforeData: null,
      afterData: receiveResult as unknown as Record<string, unknown>,
      reason: 'Simulated signed inbound webhook request',
    });

    return {
      receiveResult,
      generatedEventId,
      signatureHeaderUsed: provider.signatureHeader,
    };
  }

  private resolveParsedPayload(parsedBody: unknown, rawBody: string): Record<string, unknown> {
    if (parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)) {
      return parsedBody as Record<string, unknown>;
    }
    if (Array.isArray(parsedBody)) {
      return { items: parsedBody };
    }
    if (rawBody.trim()) {
      const parsed = safeJsonParseObject<Record<string, unknown>>(rawBody, {});
      if (Object.keys(parsed).length > 0) return parsed;
      return { raw: rawBody };
    }
    return {};
  }

  private async verifySecurityAndReplayWindow(params: {
    readonly provider: InboundWebhookProviderEntity;
    readonly plainSecret: string;
    readonly rawBody: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly parsedPayload: Record<string, unknown>;
    readonly signatureHeaderVal: string | undefined;
    readonly rawTimestamp: string | undefined;
    readonly toleranceSec: number;
    readonly nowSec: number | undefined;
    readonly now: Date;
    readonly payloadHash: string;
    readonly payloadSizeBytes: number;
    readonly sourceIpMasked: string | null;
    readonly correlationId: string;
    readonly runtimeConfig: InboundWebhookRuntimeConfig;
    readonly extractedEventType: string | null;
  }): Promise<number | null> {
    const { provider } = params;
    const isTimestampSigned =
      provider.authType !== INBOUND_WEBHOOK_AUTH_TYPE.STATIC_TOKEN &&
      provider.signatureFormat === INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY;

    if (isTimestampSigned) {
      if (!params.signatureHeaderVal?.trim()) {
        await this.rejectWithReason(
          params,
          INBOUND_WEBHOOK_REJECTION_REASON.INVALID_SIGNATURE,
          null,
        );
        throw new UnauthorizedAppException('inbound-webhooks.invalidSignature', [
          { providerCode: provider.providerCode },
        ]);
      }

      if (!params.rawTimestamp?.trim()) {
        await this.rejectWithReason(
          params,
          INBOUND_WEBHOOK_REJECTION_REASON.MISSING_TIMESTAMP,
          null,
        );
        throw new UnauthorizedAppException('inbound-webhooks.missingTimestamp', [
          { providerCode: provider.providerCode },
        ]);
      }

      const parsedTs = parseInboundWebhookTimestamp(params.rawTimestamp);
      if (parsedTs === null) {
        await this.rejectWithReason(
          params,
          INBOUND_WEBHOOK_REJECTION_REASON.INVALID_TIMESTAMP,
          null,
        );
        throw new UnauthorizedAppException('inbound-webhooks.invalidTimestamp', [
          { providerCode: provider.providerCode },
        ]);
      }

      // Xác minh chữ ký mật mã TRƯỚC khi kiểm tra cửa sổ thời gian để không rò rỉ trạng thái timestamp
      const authResult = verifyInboundWebhookAuth({
        authType: provider.authType,
        rawBody: params.rawBody,
        secret: params.plainSecret,
        signatureHeaderName: provider.signatureHeader,
        signatureHeaderValue: params.signatureHeaderVal,
        signaturePrefix: provider.signaturePrefix,
        signatureFormat: provider.signatureFormat,
        timestampSec: parsedTs,
      });
      if (!authResult.valid) {
        await this.rejectWithReason(
          params,
          authResult.reason ?? INBOUND_WEBHOOK_REJECTION_REASON.INVALID_SIGNATURE,
          new Date(parsedTs * 1000),
        );
        throw new UnauthorizedAppException('inbound-webhooks.invalidSignature', [
          { providerCode: provider.providerCode },
        ]);
      }

      const tsValidation = validateInboundWebhookTimestamp({
        rawTimestamp: params.rawTimestamp,
        toleranceSec: params.toleranceSec,
        nowSec: params.nowSec,
        required: true,
      });
      if (!tsValidation.valid) {
        await this.rejectWithReason(
          params,
          tsValidation.reason ?? INBOUND_WEBHOOK_REJECTION_REASON.TIMESTAMP_EXPIRED,
          new Date(parsedTs * 1000),
        );
        throw new UnauthorizedAppException('inbound-webhooks.timestampExpired', [
          { providerCode: provider.providerCode },
        ]);
      }

      return parsedTs;
    }

    // STATIC_TOKEN hoặc HMAC với RAW_BODY: kiểm tra chữ ký/token trước, rồi kiểm tra timestamp nếu có/bắt buộc
    const authResult = verifyInboundWebhookAuth({
      authType: provider.authType,
      rawBody: params.rawBody,
      secret: params.plainSecret,
      signatureHeaderName: provider.signatureHeader,
      signatureHeaderValue: params.signatureHeaderVal,
      signaturePrefix: provider.signaturePrefix,
      signatureFormat: provider.signatureFormat,
      timestampSec: null,
    });
    if (!authResult.valid) {
      const reason =
        authResult.reason ??
        (provider.authType === INBOUND_WEBHOOK_AUTH_TYPE.STATIC_TOKEN
          ? INBOUND_WEBHOOK_REJECTION_REASON.INVALID_TOKEN
          : INBOUND_WEBHOOK_REJECTION_REASON.INVALID_SIGNATURE);
      const errKey =
        reason === INBOUND_WEBHOOK_REJECTION_REASON.INVALID_TOKEN
          ? 'inbound-webhooks.invalidToken'
          : 'inbound-webhooks.invalidSignature';
      await this.rejectWithReason(params, reason, null);
      throw new UnauthorizedAppException(errKey, [{ providerCode: provider.providerCode }]);
    }

    const tsValidation = validateInboundWebhookTimestamp({
      rawTimestamp: params.rawTimestamp,
      toleranceSec: params.toleranceSec,
      nowSec: params.nowSec,
      required: Boolean(provider.requireTimestamp),
    });
    if (!tsValidation.valid) {
      const reason = tsValidation.reason ?? INBOUND_WEBHOOK_REJECTION_REASON.TIMESTAMP_EXPIRED;
      const errKey =
        reason === INBOUND_WEBHOOK_REJECTION_REASON.MISSING_TIMESTAMP
          ? 'inbound-webhooks.missingTimestamp'
          : reason === INBOUND_WEBHOOK_REJECTION_REASON.INVALID_TIMESTAMP
            ? 'inbound-webhooks.invalidTimestamp'
            : 'inbound-webhooks.timestampExpired';
      await this.rejectWithReason(
        params,
        reason,
        tsValidation.timestampSec ? new Date(tsValidation.timestampSec * 1000) : null,
      );
      throw new UnauthorizedAppException(errKey, [{ providerCode: provider.providerCode }]);
    }

    return tsValidation.timestampSec;
  }

  private async rejectWithReason(
    params: {
      readonly provider: InboundWebhookProviderEntity;
      readonly headers: Readonly<Record<string, string>>;
      readonly parsedPayload: Record<string, unknown>;
      readonly payloadHash: string;
      readonly payloadSizeBytes: number;
      readonly sourceIpMasked: string | null;
      readonly correlationId: string;
      readonly runtimeConfig: InboundWebhookRuntimeConfig;
      readonly extractedEventType: string | null;
      readonly now: Date;
    },
    reason: InboundWebhookRejectionReason,
    eventTimestamp: Date | null,
  ): Promise<void> {
    await this.recordRejectedEvent({
      provider: params.provider,
      headers: params.headers,
      parsedPayload: params.parsedPayload,
      payloadHash: params.payloadHash,
      payloadSizeBytes: params.payloadSizeBytes,
      sourceIpMasked: params.sourceIpMasked,
      correlationId: params.correlationId,
      runtimeConfig: params.runtimeConfig,
      rejectionReason: reason,
      eventType: params.extractedEventType,
      eventTimestamp,
      errorMessage: `Inbound webhook rejected: ${reason}`,
      now: params.now,
    });
  }

  private async handleExistingIdempotentEvent(params: {
    readonly existing: InboundWebhookEventEntity;
    readonly provider: InboundWebhookProviderEntity;
    readonly headers: Readonly<Record<string, string>>;
    readonly parsedPayload: Record<string, unknown>;
    readonly payloadHash: string;
    readonly payloadSizeBytes: number;
    readonly sourceIpMasked: string | null;
    readonly correlationId: string;
    readonly runtimeConfig: InboundWebhookRuntimeConfig;
    readonly externalEventId: string;
    readonly eventType: string | null;
    readonly eventTimestamp: Date | null;
    readonly now: Date;
  }): Promise<ReceiveInboundWebhookResult> {
    const { existing } = params;
    if (existing.payloadHash === params.payloadHash) {
      existing.duplicateCount = Number(existing.duplicateCount ?? 0) + 1;
      existing.lastDuplicateAt = params.now;
      await this.eventRepo.saveEntity(existing);

      return {
        accepted: true,
        duplicate: true,
        eventId: Number(existing.id),
        eventUid: existing.eventUid,
        providerCode: existing.providerCode,
        externalEventId: existing.externalEventId ?? params.externalEventId,
        eventType: existing.eventType ?? null,
        status: existing.status,
        statusName: getInboundWebhookEventStatusName(existing.status),
      };
    }

    await this.recordRejectedEvent({
      provider: params.provider,
      headers: params.headers,
      parsedPayload: params.parsedPayload,
      payloadHash: params.payloadHash,
      payloadSizeBytes: params.payloadSizeBytes,
      sourceIpMasked: params.sourceIpMasked,
      correlationId: params.correlationId,
      runtimeConfig: params.runtimeConfig,
      rejectionReason: INBOUND_WEBHOOK_REJECTION_REASON.IDEMPOTENCY_PAYLOAD_MISMATCH,
      eventType: params.eventType,
      eventTimestamp: params.eventTimestamp,
      errorMessage: `Duplicate externalEventId "${params.externalEventId}" with mismatched payload digest`,
      now: params.now,
    });

    throw new ConflictAppException('inbound-webhooks.idempotencyPayloadMismatch', [
      { providerCode: params.provider.providerCode, externalEventId: params.externalEventId },
    ]);
  }

  private async recordRejectedEvent(params: {
    readonly provider: InboundWebhookProviderEntity;
    readonly headers: Readonly<Record<string, string>>;
    readonly parsedPayload: Record<string, unknown>;
    readonly payloadHash: string;
    readonly payloadSizeBytes: number;
    readonly sourceIpMasked: string | null;
    readonly correlationId: string;
    readonly runtimeConfig: InboundWebhookRuntimeConfig;
    readonly rejectionReason: InboundWebhookRejectionReason;
    readonly eventType: string | null;
    readonly eventTimestamp: Date | null;
    readonly errorMessage: string;
    readonly now: Date;
  }): Promise<void> {
    params.provider.lastRejectedAt = params.now;
    await this.providerRepo.saveEntity(params.provider);

    if (!params.runtimeConfig.recordRejectedRequests) {
      return;
    }

    const extraSensitiveFields = safeJsonParseStringArray(params.provider.sensitiveFieldsJson);
    const redactedHeaders = redactInboundHeaders(params.headers, [params.provider.signatureHeader]);
    const redactedPayload = redactAndSerializeInboundPayload(params.parsedPayload, {
      extraSensitiveFields,
      maskPiiInPayload: params.runtimeConfig.maskPiiInPayload,
      maxStoredPayloadBytes: params.runtimeConfig.maxStoredPayloadBytes,
    });

    // Luôn đặt externalEventId = null cho bản ghi REJECTED để chống kẻ tấn công làm nhiễm khóa idempotency
    await this.eventRepo.saveEntity({
      eventUid: `inb_rej_${randomUUID()}`,
      providerId: Number(params.provider.id),
      providerCode: params.provider.providerCode,
      externalEventId: null,
      eventType: params.eventType,
      eventTimestamp: params.eventTimestamp,
      payloadHash: params.payloadHash,
      headersRedactedJson: JSON.stringify(redactedHeaders),
      payloadRedactedJson: redactedPayload.json,
      payloadSizeBytes: params.payloadSizeBytes,
      payloadTruncated: redactedPayload.truncated,
      sourceIpMasked: params.sourceIpMasked,
      status: INBOUND_WEBHOOK_EVENT_STATUS.REJECTED,
      rejectionReason: params.rejectionReason,
      attemptCount: 0,
      maxAttempts: 0,
      duplicateCount: 0,
      lastDuplicateAt: null,
      lastHandlerName: null,
      lastErrorCode: params.rejectionReason,
      lastErrorMessage: params.errorMessage.slice(0, 1000),
      receivedAt: params.now,
      processedAt: null,
      correlationId: params.correlationId,
    });
  }

  private async enqueueEventProcessing(
    event: InboundWebhookEventEntity,
    externalEventId: string,
    runtimeConfig: InboundWebhookRuntimeConfig,
  ): Promise<void> {
    if (!this.messagePublisher) {
      event.status = INBOUND_WEBHOOK_EVENT_STATUS.FAILED;
      event.lastErrorCode = 'QUEUE_PUBLISHER_UNAVAILABLE';
      event.lastErrorMessage = 'Message publisher is not available';
      await this.eventRepo.saveEntity(event);
      throw new BadRequestAppException('inbound-webhooks.queuePublishFailed', [
        { eventId: Number(event.id) },
      ]);
    }

    try {
      await this.messagePublisher.publish(
        INBOUND_WEBHOOKS_QUEUE_TOPICS.EVENT_PROCESS,
        {
          inboundEventId: Number(event.id),
          eventUid: event.eventUid,
          providerCode: event.providerCode,
        },
        QUEUES.SYSTEM_EVENTS,
        {
          attempts: Number(event.maxAttempts),
          backoff: 'exponential',
          backoffDelayMs: runtimeConfig.retryBaseDelayMs,
          idempotencyKey: `inbound-webhook:${event.providerCode}:${externalEventId}`,
          index: {
            inboundEventId: Number(event.id),
            providerCode: event.providerCode,
            externalEventId,
            eventType: event.eventType ?? 'unknown',
          },
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      event.status = INBOUND_WEBHOOK_EVENT_STATUS.FAILED;
      event.lastErrorCode = 'QUEUE_PUBLISH_FAILED';
      event.lastErrorMessage = msg.slice(0, 1000);
      await this.eventRepo.saveEntity(event);
      this.logger.warn(
        `Failed to enqueue inbound webhook event #${event.id} (${event.providerCode}): ${msg}`,
      );
      throw new BadRequestAppException('inbound-webhooks.queuePublishFailed', [
        { eventId: Number(event.id) },
      ]);
    }
  }
}
