export interface StoredTrustedDeviceRecord {
  readonly deviceId: string;
  readonly tokenHash: string;
  readonly deviceName: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly createdAt: string;
  lastUsedAt: string;
  readonly trustedUntil: string;
}

export interface MfaExtendedEnvelope {
  codes: string[];
  smsOtpEnabled?: boolean;
  smsOtpCodeHash?: string | null;
  smsOtpExpiresAt?: string | null;
  smsOtpFailedAttempts?: number;
  trustedDevices?: StoredTrustedDeviceRecord[];
}

export interface TrustedDeviceView {
  readonly deviceId: string;
  readonly deviceName: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly trustedUntil: string;
}

export type TrustedDeviceItemResponse = TrustedDeviceView;

export interface AdminResetMfaInput {
  readonly reason: string;
  readonly verificationReference?: string | undefined;
  readonly revokeSessions?: boolean | undefined;
  readonly stepUpToken?: string | undefined;
}

export interface AdminResetMfaResult {
  readonly reset: true;
  readonly userId: number;
  readonly revokedSessionsCount: number;
  readonly revokedTrustedDevicesCount: number;
  readonly reason: string;
  readonly verificationReference?: string | null;
  readonly resetByActorId?: number | null;
  readonly resetAt: string;
}

export type AdminResetMfaResponse = AdminResetMfaResult;

export interface MfaStatusResponse {
  readonly mfaEnabled: boolean;
  readonly totpEnabled: boolean;
  readonly emailOtpEnabled: boolean;
  readonly smsOtpEnabled?: boolean;
  readonly preferredMethod: 'TOTP' | 'EMAIL_OTP' | 'SMS_OTP' | 'RECOVERY_CODE';
  readonly remainingRecoveryCodesCount: number;
  readonly remainingRecoveryCodes: number;
  readonly trustedDevicesCount?: number;
  readonly verifiedAt: string | null;
}

export interface MfaTotpSetupResponse {
  readonly secret: string;
  readonly otpauthUri: string;
  readonly otpauthUrl: string;
  readonly accountName: string;
  readonly issuer: string;
}

export interface MfaEnableResultResponse {
  readonly mfaEnabled: boolean;
  readonly totpEnabled: boolean;
  readonly emailOtpEnabled: boolean;
  readonly smsOtpEnabled?: boolean;
  readonly recoveryCodes: readonly string[];
}

export interface SendEmailOtpResponse {
  readonly sent: true;
  readonly maskedEmail: string;
  readonly expiresInSeconds: number;
  readonly messageId?: string;
  readonly devOtpCode?: string;
}

export interface SendSmsOtpResponse {
  readonly sent: true;
  readonly maskedPhone: string;
  readonly expiresInSeconds: number;
  readonly providerMessageId?: string;
  readonly devOtpCode?: string;
}
