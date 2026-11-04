import { Inject, Injectable, Optional } from '@nestjs/common';
import { scanModuleManifests } from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  type IPermissionsPublicService,
  type ModulePermissionDeclaration,
  type ModulePermissionsManifestInput,
  type PermissionItemSummary,
} from '../contracts/index.js';
import {
  type NormalizedPermissionDeclaration,
  buildDeclaredPermissionsMap,
  buildOrphanedPermissionWarnings,
  groupPermissionCatalogItems,
  mapPermissionsToCatalogItems,
} from '../helpers/permission-catalog.helper.js';
import { PermissionRepository } from '../repositories/permission.repository.js';
import type { SyncPermissionsRequest } from '../requests/permissions.requests.js';
import type {
  OrphanedPermissionWarningResponse,
  PermissionCatalogItemResponse,
  PermissionFunctionalGroupResponse,
  SyncPermissionsResultResponse,
} from '../responses/permissions.response.js';

@Injectable()
export class PermissionsService implements IPermissionsPublicService {
  private readonly registeredModules = new Map<string, ModulePermissionsManifestInput>();
  private customActiveModulesOverride: Map<string, ModulePermissionsManifestInput> | null = null;

  constructor(
    private readonly permissionRepository: PermissionRepository,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService: AuditLogService | null = null,
  ) {
    this.initializeModuleManifests();
  }

  /** Đăng ký danh sách quyền công bố của một module (Mục 4.2 — Mỗi module tự công bố quyền của mình) */
  public registerModulePermissions(input: ModulePermissionsManifestInput): void {
    const moduleKey = input.module.trim().toLowerCase();
    if (!moduleKey) return;
    this.registeredModules.set(moduleKey, {
      module: moduleKey,
      displayName: input.displayName?.trim() || input.module,
      permissions: input.permissions,
    });
  }

  /** Hợp đồng công khai: Lấy toàn bộ danh mục quyền */
  public async findAll(): Promise<PermissionItemSummary[]> {
    return this.permissionRepository.findAll();
  }

  /** Hợp đồng công khai: Tìm danh sách quyền theo mảng ID số nguyên */
  public async findByIds(ids: readonly number[]): Promise<PermissionItemSummary[]> {
    return this.permissionRepository.findByIds(ids);
  }

  /** Hợp đồng công khai: Tìm danh sách quyền theo mảng mã code */
  public async findByCodes(codes: readonly string[]): Promise<PermissionItemSummary[]> {
    return this.permissionRepository.findByCodes(codes);
  }

  /** Hợp đồng công khai: Đảm bảo các mã quyền đều tồn tại trong bảng permissions */
  public async ensurePermissionsByCodes(
    codes: readonly string[],
  ): Promise<PermissionItemSummary[]> {
    return this.permissionRepository.ensurePermissionsByCodes(codes);
  }

  /** Alias cho `ensurePermissionsByCodes` */
  public async ensureByCodes(codes: readonly string[]): Promise<PermissionItemSummary[]> {
    return this.permissionRepository.ensureByCodes(codes);
  }

  /** Hợp đồng công khai: Đồng bộ idempotent danh sách quyền vào bảng permissions */
  public async upsertCatalogItems(
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
  }> {
    return this.permissionRepository.upsertCatalogItems(items);
  }

  /** Lấy danh mục quyền hạn hệ thống từ bảng permissions kèm nhóm chức năng và cờ cảnh báo quyền mồ côi (Mục 4.2) */
  public async listPermissionsCatalog(): Promise<PermissionCatalogItemResponse[]> {
    const perms = await this.permissionRepository.findAll();
    const declaredMap = this.getActiveDeclaredPermissionsMap();
    return mapPermissionsToCatalogItems(perms, declaredMap);
  }

  /** Nhóm danh mục quyền theo module và nhóm chức năng (Mục 4.2 — Nhóm quyền theo chức năng dễ chọn và quản lý) */
  public async listPermissionsGrouped(): Promise<PermissionFunctionalGroupResponse[]> {
    const catalog = await this.listPermissionsCatalog();
    return groupPermissionCatalogItems(catalog, this.getActiveModulesMap());
  }

  /** Đồng bộ quyền idempotent từ các module manifests vào bảng permissions (Mục 4.2 — Không tạo trùng quyền) */
  public async syncModulePermissions(
    input?: SyncPermissionsRequest | readonly ModulePermissionsManifestInput[],
    actor?: UserIdentity,
  ): Promise<SyncPermissionsResultResponse> {
    let modulesInput: readonly ModulePermissionsManifestInput[] | undefined;
    let replaceActiveModules = false;

    if (Array.isArray(input)) {
      modulesInput = input;
    } else if (input && typeof input === 'object') {
      const req = input as SyncPermissionsRequest;
      modulesInput = req.modules;
      replaceActiveModules = Boolean(req.replaceActiveModules);
    }

    if (modulesInput && modulesInput.length > 0) {
      if (replaceActiveModules) {
        const overrideMap = new Map<string, ModulePermissionsManifestInput>();
        for (const mod of modulesInput) {
          const key = mod.module.trim().toLowerCase();
          if (!key) continue;
          overrideMap.set(key, {
            module: key,
            displayName: mod.displayName?.trim() || mod.module,
            permissions: mod.permissions,
          });
        }
        this.customActiveModulesOverride = overrideMap;
      } else {
        this.customActiveModulesOverride = null;
        for (const mod of modulesInput) {
          this.registerModulePermissions(mod);
        }
      }
    } else if (replaceActiveModules) {
      this.customActiveModulesOverride = null;
    }

    const declaredMap = this.getActiveDeclaredPermissionsMap();
    const activeModules = this.getActiveModulesMap();
    const declaredItems = [...declaredMap.values()];

    const { createdCodes, updatedCodes, unchangedCount } =
      await this.permissionRepository.upsertCatalogItems(
        declaredItems.map((item) => ({
          code: item.code,
          name: item.name,
          module: item.module,
          description: item.description,
        })),
      );

    const allAfter = await this.permissionRepository.findAll();
    const orphanedCodes = allAfter
      .map((p) => p.code.trim().toLowerCase())
      .filter((code) => !declaredMap.has(code));

    const summary: SyncPermissionsResultResponse = {
      totalDeclared: declaredItems.length,
      createdCount: createdCodes.length,
      updatedCount: updatedCodes.length,
      unchangedCount,
      orphanedCount: orphanedCodes.length,
      createdCodes,
      updatedCodes,
      orphanedCodes,
      syncedModules: [...activeModules.keys()],
    };

    if (createdCodes.length > 0 || updatedCodes.length > 0) {
      await this.auditLogService?.record({
        module: 'permissions',
        feature: 'permission_catalog_sync',
        action: 'PERMISSIONS_SYNCED',
        resourceType: 'permission_catalog',
        actorUserId: actor?.id ?? null,
        afterData: summary,
      });
    }

    return summary;
  }

  /** Cảnh báo danh sách quyền mồ côi không còn thuộc bất kỳ module hoạt động nào (Mục 4.2 — Tránh permission rác) */
  public async listOrphanedPermissions(): Promise<OrphanedPermissionWarningResponse[]> {
    const allPerms = await this.permissionRepository.findAll();
    const declaredMap = this.getActiveDeclaredPermissionsMap();
    const orphanedPerms = allPerms.filter((p) => !declaredMap.has(p.code.trim().toLowerCase()));
    if (orphanedPerms.length === 0) return [];

    return buildOrphanedPermissionWarnings(orphanedPerms);
  }

  /** Khởi tạo danh sách quyền công bố động từ các tệp module.manifest.json thực tế trên đĩa */
  private initializeModuleManifests(): void {
    for (const { moduleName, raw } of scanModuleManifests<{
      name?: string;
      displayName?: string;
      permissions?: (string | ModulePermissionDeclaration)[];
    }>()) {
      if (moduleName && Array.isArray(raw.permissions)) {
        const existing = this.registeredModules.get(moduleName);
        const mergedPerms = existing
          ? [...existing.permissions, ...raw.permissions]
          : raw.permissions;
        this.registerModulePermissions({
          module: moduleName,
          displayName: raw.displayName || existing?.displayName || moduleName,
          permissions: mergedPerms,
        });
      }
    }
  }

  /** Lấy bản đồ các module đang hoạt động (hỗ trợ override khi test hoặc đồng bộ replaceActiveModules) */
  private getActiveModulesMap(): Map<string, ModulePermissionsManifestInput> {
    if (this.customActiveModulesOverride) {
      return this.customActiveModulesOverride;
    }
    return this.registeredModules;
  }

  /** Tổng hợp bản đồ mã quyền -> thông tin quyền đã chuẩn hóa từ toàn bộ các module đang hoạt động */
  private getActiveDeclaredPermissionsMap(): Map<string, NormalizedPermissionDeclaration> {
    return buildDeclaredPermissionsMap(this.getActiveModulesMap());
  }
}
