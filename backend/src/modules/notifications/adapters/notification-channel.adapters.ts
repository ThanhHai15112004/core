import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_ERROR_TYPE,
  NOTIFICATION_SUPPRESSION_REASON,
  type NotificationChannelCode,
  type NotificationErrorTypeCode,
  type NotificationSuppressionReasonCode,
} from '../enum/notifications.enum.js';

export interface ChannelProviderSendRequest {
  readonly channel: NotificationChannelCode;
  readonly providerCode: string;
  readonly destination: string;
  readonly subject?: string | null | undefined;
  readonly body: string;
  readonly htmlBody?: string | null | undefined;
  readonly fromAddress?: string | null | undefined;
  readonly fromName?: string | null | undefined;
  readonly senderId?: string | null | undefined;
  readonly idempotencyKey: string;
  readonly metadata?: Record<string, unknown> | null | undefined;
}

export interface ChannelProviderSendResult {
  readonly success: boolean;
  readonly status: 'SENT' | 'DELIVERED' | 'FAILED';
  readonly providerCode: string;
  readonly providerMessageId: string | null;
  readonly errorType: NotificationErrorTypeCode;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly shouldSuppressDestination: boolean;
  readonly suppressionReason?: NotificationSuppressionReasonCode | undefined;
}

export interface INotificationChannelProviderAdapter {
  readonly channel: NotificationChannelCode;
  send(request: ChannelProviderSendRequest): Promise<ChannelProviderSendResult>;
}

function inspectSimulatedOrProviderFailure(
  request: ChannelProviderSendRequest,
): ChannelProviderSendResult | null {
  const destLower = request.destination.trim().toLowerCase();
  const sim = String(request.metadata?.simulateDeliveryFailure ?? '').toUpperCase();

  // 1. Transient error (timeout / 503 / rate-limit)
  if (sim === 'TRANSIENT' || destLower.includes('transient') || destLower.includes('timeout')) {
    return {
      success: false,
      status: 'FAILED',
      providerCode: request.providerCode,
      providerMessageId: null,
      errorType: NOTIFICATION_ERROR_TYPE.TRANSIENT,
      errorCode: 'PROVIDER_TIMEOUT_503',
      errorMessage: 'Temporary upstream timeout (503 Service Unavailable)',
      shouldSuppressDestination: false,
    };
  }

  if (sim === 'RATE_LIMITED' || destLower.includes('ratelimit')) {
    return {
      success: false,
      status: 'FAILED',
      providerCode: request.providerCode,
      providerMessageId: null,
      errorType: NOTIFICATION_ERROR_TYPE.RATE_LIMITED,
      errorCode: 'PROVIDER_RATE_LIMIT_429',
      errorMessage: 'Provider rate limit exceeded (429 Too Many Requests)',
      shouldSuppressDestination: false,
    };
  }

  // 2. Permanent error (Hard bounce / Unregistered token / Invalid recipient)
  if (
    sim === 'HARD_BOUNCE' ||
    destLower.startsWith('bounce@') ||
    destLower.includes('hardbounce') ||
    destLower.endsWith('@bounce.invalid')
  ) {
    return {
      success: false,
      status: 'FAILED',
      providerCode: request.providerCode,
      providerMessageId: null,
      errorType: NOTIFICATION_ERROR_TYPE.PERMANENT,
      errorCode: 'SMTP_550_USER_UNKNOWN',
      errorMessage: `Hard bounce: mailbox does not exist (${request.destination})`,
      shouldSuppressDestination: true,
      suppressionReason: NOTIFICATION_SUPPRESSION_REASON.HARD_BOUNCE,
    };
  }

  if (
    sim === 'UNREGISTERED_TOKEN' ||
    destLower.includes('expired_token') ||
    destLower.includes('unregistered') ||
    destLower.includes('dead_token')
  ) {
    return {
      success: false,
      status: 'FAILED',
      providerCode: request.providerCode,
      providerMessageId: null,
      errorType: NOTIFICATION_ERROR_TYPE.PERMANENT,
      errorCode: 'PUSH_UNREGISTERED_TOKEN',
      errorMessage: `Push endpoint or token is no longer registered (${request.destination})`,
      shouldSuppressDestination: true,
      suppressionReason: NOTIFICATION_SUPPRESSION_REASON.UNREGISTERED_TOKEN,
    };
  }

  if (sim === 'INVALID_NUMBER' || destLower.endsWith('00000000')) {
    return {
      success: false,
      status: 'FAILED',
      providerCode: request.providerCode,
      providerMessageId: null,
      errorType: NOTIFICATION_ERROR_TYPE.PERMANENT,
      errorCode: 'SMS_INVALID_DESTINATION',
      errorMessage: `Permanent SMS carrier rejection for number ${request.destination}`,
      shouldSuppressDestination: true,
      suppressionReason: NOTIFICATION_SUPPRESSION_REASON.HARD_BOUNCE,
    };
  }

  return null;
}

@Injectable()
export class EmailChannelProviderAdapter implements INotificationChannelProviderAdapter {
  public readonly channel = NOTIFICATION_CHANNEL.EMAIL;
  private readonly logger = new Logger(EmailChannelProviderAdapter.name);

  public async send(request: ChannelProviderSendRequest): Promise<ChannelProviderSendResult> {
    const failure = inspectSimulatedOrProviderFailure(request);
    if (failure) {
      return failure;
    }

    const providerMessageId = `email-${request.providerCode.toLowerCase()}-${randomUUID()}`;
    this.logger.debug(
      `[EmailAdapter:${request.providerCode}] Sent email to ${request.destination} (msgId=${providerMessageId})`,
    );

    const autoDeliver = request.metadata?.simulateQueuedSentOnly !== true;
    return {
      success: true,
      status: autoDeliver ? 'DELIVERED' : 'SENT',
      providerCode: request.providerCode,
      providerMessageId,
      errorType: NOTIFICATION_ERROR_TYPE.NONE,
      errorCode: null,
      errorMessage: null,
      shouldSuppressDestination: false,
    };
  }
}

@Injectable()
export class SmsChannelProviderAdapter implements INotificationChannelProviderAdapter {
  public readonly channel = NOTIFICATION_CHANNEL.SMS;
  private readonly logger = new Logger(SmsChannelProviderAdapter.name);

  public async send(request: ChannelProviderSendRequest): Promise<ChannelProviderSendResult> {
    const failure = inspectSimulatedOrProviderFailure(request);
    if (failure) {
      return failure;
    }

    const providerMessageId = `sms-${request.providerCode.toLowerCase()}-${randomUUID()}`;
    this.logger.debug(
      `[SmsAdapter:${request.providerCode}] Sent SMS (sender=${request.senderId ?? 'CORE'}) to ${request.destination} (msgId=${providerMessageId})`,
    );

    const autoDeliver = request.metadata?.simulateQueuedSentOnly !== true;
    return {
      success: true,
      status: autoDeliver ? 'DELIVERED' : 'SENT',
      providerCode: request.providerCode,
      providerMessageId,
      errorType: NOTIFICATION_ERROR_TYPE.NONE,
      errorCode: null,
      errorMessage: null,
      shouldSuppressDestination: false,
    };
  }
}

@Injectable()
export class PushChannelProviderAdapter implements INotificationChannelProviderAdapter {
  public readonly channel = NOTIFICATION_CHANNEL.PUSH;
  private readonly logger = new Logger(PushChannelProviderAdapter.name);

  public async send(request: ChannelProviderSendRequest): Promise<ChannelProviderSendResult> {
    const failure = inspectSimulatedOrProviderFailure(request);
    if (failure) {
      return failure;
    }

    const providerMessageId = `push-${request.providerCode.toLowerCase()}-${randomUUID()}`;
    this.logger.debug(
      `[PushAdapter:${request.providerCode}] Sent Push to ${request.destination} (msgId=${providerMessageId})`,
    );

    const autoDeliver = request.metadata?.simulateQueuedSentOnly !== true;
    return {
      success: true,
      status: autoDeliver ? 'DELIVERED' : 'SENT',
      providerCode: request.providerCode,
      providerMessageId,
      errorType: NOTIFICATION_ERROR_TYPE.NONE,
      errorCode: null,
      errorMessage: null,
      shouldSuppressDestination: false,
    };
  }
}

@Injectable()
export class NotificationChannelAdapterRegistry {
  private readonly adapters = new Map<
    NotificationChannelCode,
    INotificationChannelProviderAdapter
  >();

  constructor(
    emailAdapter?: EmailChannelProviderAdapter,
    smsAdapter?: SmsChannelProviderAdapter,
    pushAdapter?: PushChannelProviderAdapter,
  ) {
    this.adapters.set(
      NOTIFICATION_CHANNEL.EMAIL,
      emailAdapter ?? new EmailChannelProviderAdapter(),
    );
    this.adapters.set(NOTIFICATION_CHANNEL.SMS, smsAdapter ?? new SmsChannelProviderAdapter());
    this.adapters.set(NOTIFICATION_CHANNEL.PUSH, pushAdapter ?? new PushChannelProviderAdapter());
  }

  public registerAdapter(
    channel: NotificationChannelCode,
    adapter: INotificationChannelProviderAdapter,
  ): void {
    this.adapters.set(channel, adapter);
  }

  public getAdapter(channel: NotificationChannelCode): INotificationChannelProviderAdapter | null {
    return this.adapters.get(channel) ?? null;
  }
}
