import type { PaginatedResult } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type {
  ScimClientCreatedView,
  ScimClientView,
  ScimGroupSummaryView,
  ScimReconciliationRunView,
  ScimSyncLogView,
  ScimUserLinkView,
} from '../types/identity-provisioning.types.js';

export * from '../enum/identity-provisioning.enum.js';
export * from '../types/identity-provisioning.types.js';

export interface IIdentityProvisioningPublicService {
  listClients(): Promise<ScimClientView[]>;
  getClientById(clientId: number): Promise<ScimClientView>;
  rotateClientToken(clientId: number, actor?: UserIdentity): Promise<ScimClientCreatedView>;
  listUserLinks(query?: {
    readonly clientId?: number | undefined;
    readonly active?: boolean | undefined;
    readonly search?: string | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<ScimUserLinkView>>;
  listGroups(query?: {
    readonly clientId?: number | undefined;
    readonly search?: string | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<ScimGroupSummaryView>>;
  listSyncLogs(query?: {
    readonly clientId?: number | undefined;
    readonly resourceType?: string | undefined;
    readonly outcome?: string | undefined;
    readonly externalId?: string | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<ScimSyncLogView>>;
  getReconciliationRunById(runId: number): Promise<ScimReconciliationRunView>;
}

export const IDENTITY_PROVISIONING_PUBLIC_SERVICE = Symbol('IDENTITY_PROVISIONING_PUBLIC_SERVICE');
