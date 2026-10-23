import { safeJsonParse } from '@packages/kernel/index.js';
import type { TrustedDeviceItemResponse } from '../responses/auth.response.js';
import type { MfaExtendedEnvelope, StoredTrustedDeviceRecord } from '../types/auth.types.js';

/** Giải mã cấu trúc JSON mở rộng (tương thích ngược với mảng string[] cũ) */
export function parseExtendedMfaEnvelope(jsonStr?: string | null): MfaExtendedEnvelope {
  const parsed = safeJsonParse<unknown>(jsonStr, null);
  if (!parsed) {
    return { codes: [] };
  }
  if (Array.isArray(parsed)) {
    return {
      codes: parsed.filter((item): item is string => typeof item === 'string'),
    };
  }
  if (typeof parsed === 'object') {
    const obj = parsed as Partial<MfaExtendedEnvelope>;
    return {
      codes: Array.isArray(obj.codes)
        ? obj.codes.filter((item): item is string => typeof item === 'string')
        : [],
      ...(obj.smsOtpEnabled !== undefined ? { smsOtpEnabled: Boolean(obj.smsOtpEnabled) } : {}),
      ...(obj.smsOtpCodeHash !== undefined ? { smsOtpCodeHash: obj.smsOtpCodeHash } : {}),
      ...(obj.smsOtpExpiresAt !== undefined ? { smsOtpExpiresAt: obj.smsOtpExpiresAt } : {}),
      ...(obj.smsOtpFailedAttempts !== undefined
        ? { smsOtpFailedAttempts: Number(obj.smsOtpFailedAttempts) }
        : {}),
      ...(Array.isArray(obj.trustedDevices) ? { trustedDevices: obj.trustedDevices } : {}),
    };
  }
  return { codes: [] };
}

/** Tuần tự hóa lại JSON mở rộng (nếu không có metadata mở rộng thì xuất mảng thuần để giữ tương thích tối đa) */
export function serializeExtendedMfaEnvelope(envelope: MfaExtendedEnvelope): string {
  const hasExtendedMetadata =
    Boolean(envelope.smsOtpEnabled) ||
    Boolean(envelope.smsOtpCodeHash) ||
    Boolean(envelope.trustedDevices && envelope.trustedDevices.length > 0);

  if (!hasExtendedMetadata) {
    return JSON.stringify(envelope.codes);
  }

  return JSON.stringify({
    codes: envelope.codes,
    ...(envelope.smsOtpEnabled ? { smsOtpEnabled: true } : {}),
    ...(envelope.smsOtpCodeHash
      ? {
          smsOtpCodeHash: envelope.smsOtpCodeHash,
          smsOtpExpiresAt: envelope.smsOtpExpiresAt ?? null,
          smsOtpFailedAttempts: envelope.smsOtpFailedAttempts ?? 0,
        }
      : {}),
    ...(envelope.trustedDevices && envelope.trustedDevices.length > 0
      ? { trustedDevices: envelope.trustedDevices }
      : {}),
  });
}

/** Lọc các thiết bị tin cậy còn hạn hiệu lực */
export function filterActiveTrustedDevices(
  devices: StoredTrustedDeviceRecord[],
): StoredTrustedDeviceRecord[] {
  const nowMs = Date.now();
  return devices.filter((d) => {
    const untilMs = new Date(d.trustedUntil).getTime();
    return Number.isFinite(untilMs) && untilMs > nowMs;
  });
}

/** Chuyển đổi bản ghi thiết bị tin cậy sang DTO phản hồi */
export function toTrustedDeviceResponse(
  record: StoredTrustedDeviceRecord,
): TrustedDeviceItemResponse {
  return {
    deviceId: record.deviceId,
    deviceName: record.deviceName,
    ipAddress: record.ipAddress,
    userAgent: record.userAgent,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    trustedUntil: record.trustedUntil,
  };
}

/** Chuẩn hóa mã khôi phục về chữ in hoa không dấu gạch ngang */
export function normalizeRecoveryCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
