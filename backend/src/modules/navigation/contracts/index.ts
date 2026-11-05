import type {
  BuildAuthorizedMenuTreeOptions,
  MenuPositionCode,
  MenuStatusCode,
  MenuStatusName,
  MenuTreeEvaluationResult,
  MenuTypeCode,
  MenuTypeName,
} from '@packages/kernel/index.js';

export const NAVIGATION_PUBLIC_SERVICE = Symbol('NAVIGATION_PUBLIC_SERVICE');
export const MENUS_PUBLIC_SERVICE = NAVIGATION_PUBLIC_SERVICE;

export interface MenuSummary {
  readonly id: number;
  readonly code: string;
  readonly module: string;
  readonly name: string;
  readonly status: MenuStatusCode;
  readonly statusName: MenuStatusName;
  readonly link: string | null;
  readonly linkApi: string | null;
  readonly type: MenuTypeCode;
  readonly typeName: MenuTypeName;
  readonly parent: number | null;
  readonly parentCode: string | null;
  readonly level: number;
  readonly key: string | null;
  readonly numOrder: number;
  readonly icon: string | null;
  readonly position: MenuPositionCode;
  readonly updatedAt: string;
}

export interface SyncMenusResult {
  readonly syncedModules: string[];
  readonly totalMenus: number;
}

export interface DeleteMenuResult {
  readonly deleted: true;
  readonly code: string;
  readonly id: number;
}

export interface InvalidateMenuCacheResult {
  readonly invalidated: true;
  readonly cacheVersion: number;
}

export interface INavigationPublicService {
  syncManifests(): Promise<SyncMenusResult>;
  getAuthorizedMenuTree(
    options?: BuildAuthorizedMenuTreeOptions,
  ): Promise<MenuTreeEvaluationResult>;
  invalidateCache(): Promise<InvalidateMenuCacheResult>;
}

export type IMenusPublicService = INavigationPublicService;
