import type { UserAuthCredentialsView } from '@modules/users/contracts/index.js';
import type {
  AdminResetPasswordRequest,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  SuggestPasswordQuery,
} from '../requests/credentials.requests.js';
import type {
  AdminResetPasswordResponse,
  AdminResetUserPasswordInput,
  AdminResetUserPasswordResult,
  ForgotPasswordResponse,
  SuggestedPasswordResponse,
} from '../types/credentials.types.js';

export * from '../enum/credentials.enum.js';
export * from '../types/credentials.types.js';

export interface ICredentialsPublicService {
  suggestPasswords(query?: Partial<SuggestPasswordQuery>): Promise<SuggestedPasswordResponse>;
  initializeUserPassword(userId: number, plainPassword: string): Promise<void>;
  changePassword(
    userId: number,
    dto: ChangePasswordRequest,
    currentSessionId?: number,
  ): Promise<{ changed: true; revokedSessionsCount: number }>;
  requestPasswordReset(
    dto: ForgotPasswordRequest,
    requestedIp?: string | null,
  ): Promise<ForgotPasswordResponse>;
  resetPassword(dto: ResetPasswordRequest): Promise<{ reset: true; revokedSessionsCount: number }>;
  adminResetUserPassword(
    userId: number,
    input: AdminResetUserPasswordInput | AdminResetPasswordRequest,
    actorId?: number,
  ): Promise<AdminResetUserPasswordResult & AdminResetPasswordResponse>;
  resolveUserCredentialsById(userId: number): Promise<UserAuthCredentialsView | null>;
}

export const CREDENTIALS_PUBLIC_SERVICE = Symbol('CREDENTIALS_PUBLIC_SERVICE');
