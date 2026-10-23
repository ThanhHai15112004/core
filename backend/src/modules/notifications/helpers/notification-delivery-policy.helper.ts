import { PasswordHasherService } from '@packages/security/index.js';
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_SUPPRESSION_REASON,
  type NotificationChannelCode,
  type NotificationSuppressionReasonCode,
} from '../enum/notifications.enum.js';
import type { ResolvedNotificationRuntimeConfig } from '../types/notifications.types.js';

const hasher = new PasswordHasherService();

// GSM 03.38 Basic Character Set regex
const GSM_7BIT_REGEX =
  /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;

export interface SmsSegmentCalculationResult {
  readonly encoding: 'GSM_7BIT' | 'UCS2_UNICODE';
  readonly charLength: number;
  readonly segmentsCount: number;
  readonly maxCharsPerSegment: number;
}

/**
 * Tính số bản tin SMS (Segments) theo chuẩn viễn thông:
 * - GSM-7 (không dấu): 160 ký tự / 1 tin; nếu > 160 ký tự thì 153 ký tự / tin ghép.
 * - UCS-2 Unicode (Tiếng Việt có dấu / Emoji): 70 ký tự / 1 tin; nếu > 70 ký tự thì 67 ký tự / tin ghép.
 */
export function calculateSmsSegments(content: string): SmsSegmentCalculationResult {
  const text = content ?? '';
  const charLength = Array.from(text).length;
  if (charLength === 0) {
    return {
      encoding: 'GSM_7BIT',
      charLength: 0,
      segmentsCount: 1,
      maxCharsPerSegment: 160,
    };
  }

  const isGsm7 = GSM_7BIT_REGEX.test(text);
  if (isGsm7) {
    const maxSingle = 160;
    const maxMulti = 153;
    const segmentsCount = charLength <= maxSingle ? 1 : Math.ceil(charLength / maxMulti);
    return {
      encoding: 'GSM_7BIT',
      charLength,
      segmentsCount,
      maxCharsPerSegment: charLength <= maxSingle ? maxSingle : maxMulti,
    };
  }

  const maxSingle = 70;
  const maxMulti = 67;
  const segmentsCount = charLength <= maxSingle ? 1 : Math.ceil(charLength / maxMulti);
  return {
    encoding: 'UCS2_UNICODE',
    charLength,
    segmentsCount,
    maxCharsPerSegment: charLength <= maxSingle ? maxSingle : maxMulti,
  };
}

export function calculateChannelEstimatedCost(
  channel: NotificationChannelCode,
  segmentsCount: number,
  runtimeConfig: ResolvedNotificationRuntimeConfig,
): number {
  const safeSegments = Math.max(1, segmentsCount);
  if (channel === NOTIFICATION_CHANNEL.SMS) {
    return Number((safeSegments * runtimeConfig.smsCostPerSegment).toFixed(4));
  }
  if (channel === NOTIFICATION_CHANNEL.EMAIL) {
    return Number(runtimeConfig.emailCostPerMessage.toFixed(4));
  }
  if (channel === NOTIFICATION_CHANNEL.PUSH) {
    return Number(runtimeConfig.pushCostPerMessage.toFixed(4));
  }
  return 0;
}

export function buildDeliveryIdempotencyKey(params: {
  callerIdempotencyKey?: string | null | undefined;
  notificationId?: number | null | undefined;
  recipientUserId: number;
  channel: NotificationChannelCode;
  destination: string;
}): string {
  const normalizedDest = params.destination.trim().toLowerCase();
  if (params.callerIdempotencyKey && params.callerIdempotencyKey.trim()) {
    const raw = `${params.callerIdempotencyKey.trim()}:${params.recipientUserId}:${params.channel}:${normalizedDest}`;
    return `idem_${hasher.sha256(raw).slice(0, 64)}`;
  }
  const raw = `notif_${params.notificationId ?? 0}:user_${params.recipientUserId}:ch_${params.channel}:dest_${normalizedDest}`;
  return `idem_${hasher.sha256(raw).slice(0, 64)}`;
}

export interface DestinationValidationResult {
  readonly valid: boolean;
  readonly normalizedDestination: string;
  readonly invalidReason?: NotificationSuppressionReasonCode;
  readonly errorMessage?: string;
}

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_FORMAT_REGEX = /^\+?[0-9]{8,15}$/;

export function validateAndNormalizeDestination(
  channel: NotificationChannelCode,
  rawDestination: string | null | undefined,
): DestinationValidationResult {
  const trimmed = (rawDestination ?? '').trim();
  if (!trimmed) {
    return {
      valid: false,
      normalizedDestination: '',
      invalidReason: NOTIFICATION_SUPPRESSION_REASON.INVALID_FORMAT,
      errorMessage: 'Destination address or token is empty',
    };
  }

  if (channel === NOTIFICATION_CHANNEL.EMAIL) {
    const normalized = trimmed.toLowerCase();
    if (
      !EMAIL_FORMAT_REGEX.test(normalized) ||
      normalized.endsWith('.invalid') ||
      normalized.includes('..')
    ) {
      return {
        valid: false,
        normalizedDestination: normalized,
        invalidReason: NOTIFICATION_SUPPRESSION_REASON.INVALID_FORMAT,
        errorMessage: `Invalid email address format: ${normalized}`,
      };
    }
    return { valid: true, normalizedDestination: normalized };
  }

  if (channel === NOTIFICATION_CHANNEL.SMS) {
    let cleaned = trimmed.replace(/[\s.\-()]/g, '');
    if (cleaned.startsWith('00')) {
      cleaned = `+${cleaned.slice(2)}`;
    } else if (cleaned.startsWith('0') && cleaned.length === 10) {
      cleaned = `+84${cleaned.slice(1)}`;
    }
    if (!PHONE_FORMAT_REGEX.test(cleaned)) {
      return {
        valid: false,
        normalizedDestination: cleaned || trimmed,
        invalidReason: NOTIFICATION_SUPPRESSION_REASON.INVALID_FORMAT,
        errorMessage: `Invalid phone number format: ${trimmed}`,
      };
    }
    return { valid: true, normalizedDestination: cleaned };
  }

  if (channel === NOTIFICATION_CHANNEL.PUSH) {
    if (trimmed.length < 10 || trimmed.toLowerCase().startsWith('invalid_token')) {
      return {
        valid: false,
        normalizedDestination: trimmed,
        invalidReason: NOTIFICATION_SUPPRESSION_REASON.UNREGISTERED_TOKEN,
        errorMessage: `Invalid or unregistered push token: ${trimmed}`,
      };
    }
    return { valid: true, normalizedDestination: trimmed };
  }

  return { valid: true, normalizedDestination: trimmed };
}

export function computeExponentialBackoffRetryAt(
  attemptCount: number,
  baseDelaySec: number,
  now: Date = new Date(),
): Date {
  const exponent = Math.max(0, attemptCount - 1);
  const delaySec = Math.min(3600 * 6, Math.max(1, baseDelaySec) * Math.pow(2, exponent));
  return new Date(now.getTime() + delaySec * 1000);
}

export interface BatchChunkItem<T> {
  readonly batchIndex: number;
  readonly batchKey: string;
  readonly items: readonly T[];
}

export function chunkItemsIntoBatches<T>(
  items: readonly T[],
  batchSize: number,
  batchPrefix: string,
): BatchChunkItem<T>[] {
  const safeBatchSize = Math.max(1, Math.floor(batchSize));
  const batches: BatchChunkItem<T>[] = [];
  let batchIndex = 1;
  for (let i = 0; i < items.length; i += safeBatchSize) {
    const slice = items.slice(i, i + safeBatchSize);
    batches.push({
      batchIndex,
      batchKey: `${batchPrefix}-B${String(batchIndex).padStart(3, '0')}`,
      items: slice,
    });
    batchIndex++;
  }
  return batches;
}

export function resolveCurrentQuotaPeriodKeys(now: Date = new Date()): {
  readonly dailyPeriodKey: string;
  readonly monthlyPeriodKey: string;
} {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return {
    dailyPeriodKey: `${yyyy}-${mm}-${dd}`,
    monthlyPeriodKey: `${yyyy}-${mm}`,
  };
}
