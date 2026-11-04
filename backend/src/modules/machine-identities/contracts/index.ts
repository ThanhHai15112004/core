import type {
  IdentityResolutionContext,
  TokenPayload,
  UserIdentity,
} from '@packages/security/index.js';
import type {
  CreateApiClientRequest,
  CreateServiceAccountRequest,
  IssueApiClientTokenRequest,
  RevokeApiClientRequest,
  RotateApiClientSecretRequest,
  UpdateApiClientAllowedIpsRequest,
  UpdateApiClientScopesRequest,
  UpdateServiceAccountRequest,
} from '../requests/machine-identities.requests.js';
import type {
  ApiClientCreatedWithSecretResponse,
  ApiClientResponse,
  ApiClientRevokeResponse,
  ApiClientRotateSecretResponse,
  ApiClientTokenResponse,
  ApiClientUsageLogResponse,
  ServiceAccountResponse,
} from '../responses/machine-identities.response.js';

export * from '../enum/machine-identities.enum.js';
export * from '../types/machine-identities.types.js';

export interface IMachineIdentitiesPublicService {
  createServiceAccount(
    dto: CreateServiceAccountRequest,
    actorId?: number,
  ): Promise<ServiceAccountResponse>;
  listServiceAccounts(): Promise<ServiceAccountResponse[]>;
  getServiceAccountById(id: number): Promise<ServiceAccountResponse>;
  updateServiceAccount(
    id: number,
    dto: UpdateServiceAccountRequest,
  ): Promise<ServiceAccountResponse>;
  createApiClient(
    dto: CreateApiClientRequest,
    actorId?: number,
  ): Promise<ApiClientCreatedWithSecretResponse>;
  listApiClients(serviceAccountId?: number): Promise<ApiClientResponse[]>;
  getApiClientById(id: number): Promise<ApiClientResponse>;
  updateApiClientScopes(id: number, dto: UpdateApiClientScopesRequest): Promise<ApiClientResponse>;
  updateApiClientAllowedIps(
    id: number,
    dto: UpdateApiClientAllowedIpsRequest,
  ): Promise<ApiClientResponse>;
  rotateClientSecret(
    id: number,
    dto?: RotateApiClientSecretRequest,
  ): Promise<ApiClientRotateSecretResponse>;
  revokeApiClient(id: number, dto?: RevokeApiClientRequest): Promise<ApiClientRevokeResponse>;
  issueClientToken(
    dto: IssueApiClientTokenRequest,
    meta?: { ipAddress?: string | null; endpoint?: string | null },
  ): Promise<ApiClientTokenResponse>;
  resolveApiClientTokenIdentity(
    payload: TokenPayload,
    context?: IdentityResolutionContext,
  ): Promise<UserIdentity | null>;
  getApiClientUsage(id: number): Promise<ApiClientUsageLogResponse>;
}

export const MACHINE_IDENTITIES_PUBLIC_SERVICE = Symbol('MACHINE_IDENTITIES_PUBLIC_SERVICE');
