import type { MfaMethodType } from '../enum/mfa.enum.js';
import type {
  DisableMfaRequest,
  EnableEmailOtpMfaRequest,
  EnableSmsOtpMfaRequest,
  EnableTotpMfaRequest,
} from '../requests/mfa.requests.js';
import type {
  AdminResetMfaInput,
  AdminResetMfaResponse,
  AdminResetMfaResult,
  MfaEnableResultResponse,
  MfaStatusResponse,
  MfaTotpSetupResponse,
  SendEmailOtpResponse,
  SendSmsOtpResponse,
  TrustedDeviceItemResponse,
} from '../types/mfa.types.js';

export * from '../enum/mfa.enum.js';
export * from '../types/mfa.types.js';

export interface IMfaPublicService {
  getStatus(userId: number): Promise<MfaStatusResponse>;
  getAvailableMethodsForUser(userId: number): Promise<MfaMethodType[]>;
  setupTotp(userId: number): Promise<MfaTotpSetupResponse>;
  enableTotp(userId: number, dto: EnableTotpMfaRequest): Promise<MfaEnableResultResponse>;
  enableEmailOtp(userId: number, dto?: EnableEmailOtpMfaRequest): Promise<MfaEnableResultResponse>;
  enableSmsOtp(userId: number, dto?: EnableSmsOtpMfaRequest): Promise<MfaEnableResultResponse>;
  sendEmailOtp(userId: number): Promise<SendEmailOtpResponse>;
  sendSmsOtp(userId: number, phoneOverride?: string): Promise<SendSmsOtpResponse>;
  verifyMfaCode(userId: number, code: string, preferredMethod?: MfaMethodType): Promise<boolean>;
  registerTrustedDevice(
    userId: number,
    options?: {
      deviceName?: string | null | undefined;
      ipAddress?: string | null | undefined;
      userAgent?: string | null | undefined;
      trustDurationDays?: number | undefined;
    },
  ): Promise<{
    deviceId: string;
    trustedDeviceToken: string;
    trustedUntil: string;
    device: TrustedDeviceItemResponse;
  }>;
  verifyTrustedDevice(userId: number, rawTrustedDeviceToken?: string | null): Promise<boolean>;
  listTrustedDevices(userId: number): Promise<TrustedDeviceItemResponse[]>;
  revokeTrustedDevice(
    userId: number,
    deviceId: string,
  ): Promise<{ revoked: true; deviceId: string }>;
  revokeAllTrustedDevices(userId: number): Promise<{ revoked: true; revokedCount: number }>;
  adminResetUserMfa(
    userId: number,
    input: AdminResetMfaInput,
    actorId?: number,
    revokeSessionsCallback?: (userId: number, reason: string) => Promise<number>,
  ): Promise<AdminResetMfaResult & AdminResetMfaResponse>;
  disableMfa(userId: number, dto: DisableMfaRequest): Promise<MfaStatusResponse>;
  regenerateRecoveryCodes(userId: number): Promise<{ recoveryCodes: string[] }>;
}

export const MFA_PUBLIC_SERVICE = Symbol('MFA_PUBLIC_SERVICE');
