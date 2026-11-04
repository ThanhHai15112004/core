import type { UserIdentity } from '@packages/security/index.js';
import type { SyncPermissionsRequest } from '../requests/permissions.requests.js';
import type {
  OrphanedPermissionWarningResponse,
  PermissionCatalogItemResponse,
  PermissionFunctionalGroupResponse,
  SyncPermissionsResultResponse,
} from '../responses/permissions.response.js';

export const PERMISSION_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
} as const;

export type PermissionStatusCode = (typeof PERMISSION_STATUS)[keyof typeof PERMISSION_STATUS];
export type PermissionStatusName = keyof typeof PERMISSION_STATUS;

export interface PermissionItemSummary {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly module: string;
  readonly description?: string | null | undefined;
  readonly status: PermissionStatusCode;
}

export interface ModulePermissionDeclaration {
  readonly code: string;
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly featureGroup?: string | undefined;
}

export interface ModulePermissionsManifestInput {
  readonly module: string;
  readonly displayName?: string | undefined;
  readonly permissions: readonly (string | ModulePermissionDeclaration)[];
}

export interface SyncPermissionsSummary {
  readonly totalDeclared: number;
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly unchangedCount: number;
  readonly orphanedCount: number;
  readonly createdCodes: readonly string[];
  readonly updatedCodes: readonly string[];
  readonly orphanedCodes: readonly string[];
  readonly syncedModules: readonly string[];
}

export interface IPermissionsPublicService {
  findAll(): Promise<PermissionItemSummary[]>;
  findByIds(ids: readonly number[]): Promise<PermissionItemSummary[]>;
  findByCodes(codes: readonly string[]): Promise<PermissionItemSummary[]>;
  ensurePermissionsByCodes(codes: readonly string[]): Promise<PermissionItemSummary[]>;
  ensureByCodes(codes: readonly string[]): Promise<PermissionItemSummary[]>;
  upsertCatalogItems(
    items: readonly {
      code: string;
      name: string;
      module: string;
      description: string | null;
    }[],
  ): Promise<{
    createdCodes: string[];
    updatedCodes: string[];
    unchangedCount: number;
  }>;
  registerModulePermissions(input: ModulePermissionsManifestInput): void;
  listPermissionsCatalog(): Promise<PermissionCatalogItemResponse[]>;
  listPermissionsGrouped(): Promise<PermissionFunctionalGroupResponse[]>;
  syncModulePermissions(
    request?: SyncPermissionsRequest | readonly ModulePermissionsManifestInput[],
    actor?: UserIdentity,
  ): Promise<SyncPermissionsResultResponse>;
  listOrphanedPermissions(): Promise<OrphanedPermissionWarningResponse[]>;
}

export const PERMISSIONS_PUBLIC_SERVICE = Symbol('PERMISSIONS_PUBLIC_SERVICE');
