import type {
  AuthEventStatusCode,
  AuthEventStatusName,
  AuthEventTypeCode,
  AuthEventTypeName,
} from '../enum/sessions.enum.js';

export interface SessionDeviceMetadata {
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly deviceName?: string | null;
}

export interface IssuedSessionTokens {
  readonly sessionId: number;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
}

export interface RecordAuthEventInput {
  readonly userId?: number | null;
  readonly actorId?: number | null;
  readonly sessionId?: number | null;
  readonly identifier?: string | null;
  readonly eventType: AuthEventTypeCode;
  readonly status?: AuthEventStatusCode;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly deviceName?: string | null;
  readonly reason?: string | null;
  readonly metadata?: Record<string, unknown> | null;
}

export interface SessionItemResponse {
  readonly id: number;
  readonly userId: number;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly deviceName: string | null;
  readonly isCurrent: boolean;
  readonly lastActiveAt: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly revokedAt?: string | null;
  readonly revokeReason?: string | null;
}

export interface LoginHistoryItemResponse {
  readonly id: number;
  readonly userId: number | null;
  readonly sessionId: number | null;
  readonly identifier: string | null;
  readonly eventType: number;
  readonly eventTypeName: AuthEventTypeName;
  readonly status: number;
  readonly statusName: AuthEventStatusName;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly deviceName: string | null;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface ISessionSecuritySettingsReader {
  getSettings(): Promise<{
    readonly sessionIdleTimeoutMinutes?: number | undefined;
    readonly sessionMaxLifetimeMinutes?: number | undefined;
    readonly enableLoginAuditLog?: boolean | undefined;
  }>;
}
