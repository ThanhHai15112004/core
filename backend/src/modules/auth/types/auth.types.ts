import type {
  AuthenticatedUserProfileResponse,
  LoginResponse,
  RegisterResponse,
  StepUpVerifyResponse,
  UserPreferencesResponse,
  VerificationConfirmResponse,
  VerificationSendResponse,
} from '../responses/auth.response.js';

export interface CompleteExternalLoginInput {
  readonly userId: number;
  readonly providerCode: string;
  readonly issuer: string;
  readonly identityId?: number | null | undefined;
  readonly deviceName?: string | null | undefined;
  readonly trustedDeviceToken?: string | null | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
}

export type {
  AuthenticatedUserProfileResponse,
  LoginResponse,
  RegisterResponse,
  StepUpVerifyResponse,
  UserPreferencesResponse,
  VerificationConfirmResponse,
  VerificationSendResponse,
};
