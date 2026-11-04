import type { UserAuthIdentityView } from '@modules/users/contracts/index.js';
import type {
  ISessionSecuritySettingsReader,
  IssuedSessionTokens,
  LoginHistoryItemResponse,
  RecordAuthEventInput,
  SessionItemResponse,
} from '../types/sessions.types.js';

export * from '../enum/sessions.enum.js';
export * from '../types/sessions.types.js';

export interface ISessionsPublicService {
  createSession(
    user: UserAuthIdentityView,
    context: { ipAddress?: string | null; userAgent?: string | null; deviceName?: string | null },
  ): Promise<IssuedSessionTokens>;
  rotateRefreshSession(
    refreshToken: string,
    resolveUser: (userId: number) => Promise<UserAuthIdentityView | null>,
    meta?: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<IssuedSessionTokens & { user: UserAuthIdentityView }>;
  isSessionActive(sessionId: number, userId: number): Promise<boolean>;
  listUserSessions(userId: number, currentSessionId?: number): Promise<SessionItemResponse[]>;
  listUserLoginHistory(userId: number, limit?: number): Promise<LoginHistoryItemResponse[]>;
  revokeSessionById(
    userId: number,
    sessionId: number,
    reason?: string,
    meta?: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<{ revoked: true; sessionId: number }>;
  revokeAllUserSessions(
    userId: number,
    reason?: string,
    exceptSessionId?: number,
    meta?: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<number>;
  recordAuthEvent(input: RecordAuthEventInput): Promise<unknown>;
  setSecuritySettingsService(service?: ISessionSecuritySettingsReader): void;
}

export const SESSIONS_PUBLIC_SERVICE = Symbol('SESSIONS_PUBLIC_SERVICE');
export const SESSION_SECURITY_POLICY_PROVIDER = Symbol('SESSION_SECURITY_POLICY_PROVIDER');
