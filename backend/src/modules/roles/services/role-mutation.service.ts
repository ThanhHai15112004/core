import { Inject, Injectable, Optional } from '@nestjs/common';
import { TransactionManager } from '@packages/database/index.js';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
  SettingRegistryService,
  defaultMenuRegistry,
  defaultSettingRegistry,
  resolvePagination,
} from '@packages/kernel/index.js';
import {
  AuditLogService,
  type AuditLogPaginatedResult,
  type AuditLogQueryFilter,
  type AuditLogRecord,
  DataScopeService,
  type DataScopeCustomRuleMetadata,
  PlatformSecurityService,
  type SecurityAnomalyAlert,
  type SecurityEventRecord,
  type UserIdentity,
} from '@packages/security/index.js';
import type { PermissionItemSummary } from '@modules/permissions/index.js';
import {
  DATA_SCOPE,
  ROLE_STATUS,
  inferDefaultDataScopeForRoleCode,
  parseDataScope,
  parseRoleStatus,
} from '../contracts/index.js';
import { ROLES_AUDIT_META, ROLES_SETTING_KEYS } from '../enum/roles.enum.js';
import {
  assertDataScopeAllAllowedForRole,
  buildFallbackEffectiveDataScope,
  createDeclarativeScopeEvaluateFn,
} from '../helpers/role-data-scope.helper.js';
import { RolesMapper } from '../mappers/roles.mapper.js';
import { RolePermissionRepository } from '../repositories/role-permission.repository.js';
import { RoleRepository } from '../repositories/role.repository.js';
import type {
  CloneRoleRequest,
  CreateRoleRequest,
  ListAuditLogsQuery,
  SetRolePermissionsRequest,
  UpdateRoleRequest,
} from '../requests/roles.requests.js';
import type { RoleResponse } from '../responses/roles.response.js';
import type {
  DeclarativeCustomScopeRuleInput,
  EffectiveDataScopeOverview,
} from '../types/roles.types.js';

@Injectable()
export class RoleMutationService {
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly rolePermissionRepository: RolePermissionRepository,
    private readonly mapper: RolesMapper,
    @Optional()
    @Inject(TransactionManager)
    private readonly transactionManager: TransactionManager | null = null,
    @Optional()
    @Inject(DataScopeService)
    private readonly dataScopeService: DataScopeService | null = null,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService: AuditLogService | null = null,
    @Optional()
    @Inject(PlatformSecurityService)
    private readonly platformSecurityService: PlatformSecurityService | null = null,
    @Optional()
    settingRegistry?: SettingRegistryService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
  }

  public async create(
    dto: CreateRoleRequest,
    resolveInputPermissionsFn: (
      permissionIds?: readonly number[],
      permissionCodes?: readonly string[],
    ) => Promise<PermissionItemSummary[]>,
  ): Promise<RoleResponse> {
    const normalizedCode = dto.code.trim().toLowerCase();
    const existing = await this.roleRepository.findByCode(normalizedCode);
    if (existing) {
      throw new ConflictAppException(
        'roles.duplicateCode',
        [{ code: normalizedCode }],
        { code: normalizedCode },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    const resolvedDataScope =
      dto.dataScope !== undefined
        ? parseDataScope(dto.dataScope)
        : inferDefaultDataScopeForRoleCode(normalizedCode);

    const work = async (): Promise<RoleResponse> => {
      const resolvedPerms = await resolveInputPermissionsFn(dto.permissionIds, dto.permissions);
      assertDataScopeAllAllowedForRole({
        roleCode: normalizedCode,
        dataScope: resolvedDataScope,
        permissionCodes: resolvedPerms.map((p) => p.code),
        isSystem: false,
        settingRegistry: this.settingRegistry,
      });
      const savedRole = await this.roleRepository.saveEntity({
        code: normalizedCode,
        name: dto.name.trim(),
        description: dto.description ?? null,
        isSystem: false,
        dataScope: resolvedDataScope,
        status: dto.status !== undefined ? parseRoleStatus(dto.status) : ROLE_STATUS.ACTIVE,
      });

      if (resolvedPerms.length > 0) {
        await this.rolePermissionRepository.replacePermissionsForRole(
          Number(savedRole.id),
          resolvedPerms.map((p) => Number(p.id)),
        );
      }

      const response = this.mapper.toResponse(savedRole, resolvedPerms, 0);
      await this.auditLogService?.record({
        module: ROLES_AUDIT_META.MODULE,
        feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
        action: ROLES_AUDIT_META.ACTION_CREATED,
        resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
        resourceId: response.id,
        afterData: response,
      });
      await this.platformSecurityService?.recordSecurityEvent({
        eventType: 'PERMISSION_CHANGED',
        module: ROLES_AUDIT_META.MODULE,
        feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
        action: ROLES_AUDIT_META.ACTION_CREATED,
        resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
        resourceId: response.id,
        reason: `Created role ${response.code}`,
        afterData: response,
        persistToAuditLog: false,
      });
      return response;
    };

    if (this.transactionManager) {
      const result = await this.transactionManager.runInTransaction(work);
      defaultMenuRegistry.invalidateCache();
      return result;
    }
    const result = await work();
    defaultMenuRegistry.invalidateCache();
    return result;
  }

  public async clone(
    sourceRoleId: number,
    dto: CloneRoleRequest,
    loadPermissionsMapFn: (
      roleIds: readonly number[],
    ) => Promise<Map<number, PermissionItemSummary[]>>,
  ): Promise<RoleResponse> {
    const sourceRole = await this.roleRepository.findById(sourceRoleId);
    if (!sourceRole) {
      throw new NotFoundAppException('roles.notFound', { id: sourceRoleId });
    }

    const normalizedCode = dto.code.trim().toLowerCase();
    const existing = await this.roleRepository.findByCode(normalizedCode);
    if (existing) {
      throw new ConflictAppException(
        'roles.duplicateCode',
        [{ code: normalizedCode }],
        { code: normalizedCode },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    const permsMap = await loadPermissionsMapFn([Number(sourceRole.id)]);
    const sourcePerms = permsMap.get(Number(sourceRole.id)) ?? [];

    const resolvedDataScope =
      dto.dataScope !== undefined
        ? parseDataScope(dto.dataScope)
        : parseDataScope(sourceRole.dataScope, inferDefaultDataScopeForRoleCode(sourceRole.code));

    assertDataScopeAllAllowedForRole({
      roleCode: normalizedCode,
      dataScope: resolvedDataScope,
      permissionCodes: sourcePerms.map((p) => p.code),
      isSystem: false,
      settingRegistry: this.settingRegistry,
    });

    const work = async (): Promise<RoleResponse> => {
      const savedRole = await this.roleRepository.saveEntity({
        code: normalizedCode,
        name: dto.name.trim(),
        description:
          dto.description !== undefined
            ? dto.description
            : sourceRole.description
              ? `${sourceRole.description} (Cloned from ${sourceRole.code})`
              : `Cloned from ${sourceRole.code}`,
        isSystem: false,
        dataScope: resolvedDataScope,
        status: dto.status !== undefined ? parseRoleStatus(dto.status) : ROLE_STATUS.ACTIVE,
      });

      if (sourcePerms.length > 0) {
        await this.rolePermissionRepository.replacePermissionsForRole(
          Number(savedRole.id),
          sourcePerms.map((p) => Number(p.id)),
        );
      }

      const response = this.mapper.toResponse(savedRole, sourcePerms, 0);
      await this.auditLogService?.record({
        module: ROLES_AUDIT_META.MODULE,
        feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
        action: ROLES_AUDIT_META.ACTION_CLONED,
        resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
        resourceId: response.id,
        beforeData: {
          sourceRoleId: Number(sourceRole.id),
          sourceRoleCode: sourceRole.code,
        },
        afterData: response,
      });
      await this.platformSecurityService?.recordSecurityEvent({
        eventType: 'PERMISSION_CHANGED',
        module: ROLES_AUDIT_META.MODULE,
        feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
        action: ROLES_AUDIT_META.ACTION_CLONED,
        resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
        resourceId: response.id,
        reason: `Cloned role ${response.code} from ${sourceRole.code}`,
        afterData: response,
        persistToAuditLog: false,
      });
      return response;
    };

    if (this.transactionManager) {
      const result = await this.transactionManager.runInTransaction(work);
      defaultMenuRegistry.invalidateCache();
      return result;
    }
    const result = await work();
    defaultMenuRegistry.invalidateCache();
    return result;
  }

  public async update(
    id: number,
    dto: UpdateRoleRequest,
    loadPermissionsMapFn: (
      roleIds: readonly number[],
    ) => Promise<Map<number, PermissionItemSummary[]>>,
    loadUserCountsMapFn: (roleIds: readonly number[]) => Promise<Map<number, number>>,
    resolveInputPermissionsFn: (
      permissionIds?: readonly number[],
      permissionCodes?: readonly string[],
    ) => Promise<PermissionItemSummary[]>,
  ): Promise<RoleResponse> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new NotFoundAppException('roles.notFound', { id });
    }

    if (role.isSystem && dto.status !== undefined && dto.status !== ROLE_STATUS.ACTIVE) {
      throw new ForbiddenAppException('roles.cannotDeactivateSystemRole', [{ code: role.code }]);
    }

    const work = async (): Promise<RoleResponse> => {
      const [beforePermsMap, countsMap] = await Promise.all([
        loadPermissionsMapFn([Number(role.id)]),
        loadUserCountsMapFn([Number(role.id)]),
      ]);
      const beforePerms = beforePermsMap.get(Number(role.id)) ?? [];
      const userCount = countsMap.get(Number(role.id)) ?? 0;
      const beforeSnapshot = this.mapper.toResponse(role, beforePerms, userCount);

      if (dto.name !== undefined) {
        role.name = dto.name.trim();
      }
      if (dto.description !== undefined) {
        role.description = dto.description;
      }
      if (dto.dataScope !== undefined) {
        role.dataScope = parseDataScope(dto.dataScope);
      }
      if (dto.status !== undefined) {
        role.status = parseRoleStatus(dto.status);
      }

      if (dto.permissionIds !== undefined || dto.permissions !== undefined) {
        const resolvedPerms = await resolveInputPermissionsFn(dto.permissionIds, dto.permissions);
        if (dto.dataScope !== undefined) {
          assertDataScopeAllAllowedForRole({
            roleCode: role.code,
            dataScope: role.dataScope,
            permissionCodes: resolvedPerms.map((p) => p.code),
            isSystem: role.isSystem,
            settingRegistry: this.settingRegistry,
          });
        }
        const saved = await this.roleRepository.saveEntity(role);
        await this.rolePermissionRepository.replacePermissionsForRole(
          Number(saved.id),
          resolvedPerms.map((p) => Number(p.id)),
        );
        const updatedResponse = this.mapper.toResponse(saved, resolvedPerms, userCount);
        await this.auditLogService?.record({
          module: ROLES_AUDIT_META.MODULE,
          feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
          action: ROLES_AUDIT_META.ACTION_UPDATED,
          resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
          resourceId: updatedResponse.id,
          beforeData: beforeSnapshot,
          afterData: updatedResponse,
        });
        await this.platformSecurityService?.recordSecurityEvent({
          eventType: 'PERMISSION_CHANGED',
          module: ROLES_AUDIT_META.MODULE,
          feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
          action: ROLES_AUDIT_META.ACTION_UPDATED,
          resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
          resourceId: updatedResponse.id,
          reason: `Updated role ${updatedResponse.code} permissions/scope`,
          beforeData: beforeSnapshot,
          afterData: updatedResponse,
          persistToAuditLog: false,
        });
        return updatedResponse;
      }

      if (dto.dataScope !== undefined) {
        assertDataScopeAllAllowedForRole({
          roleCode: role.code,
          dataScope: role.dataScope,
          permissionCodes: beforePerms.map((p) => p.code),
          isSystem: role.isSystem,
          settingRegistry: this.settingRegistry,
        });
      }
      const saved = await this.roleRepository.saveEntity(role);
      const updatedResponse = this.mapper.toResponse(saved, beforePerms, userCount);
      await this.auditLogService?.record({
        module: ROLES_AUDIT_META.MODULE,
        feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
        action: ROLES_AUDIT_META.ACTION_UPDATED,
        resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
        resourceId: updatedResponse.id,
        beforeData: beforeSnapshot,
        afterData: updatedResponse,
      });
      if (dto.dataScope !== undefined) {
        await this.platformSecurityService?.recordSecurityEvent({
          eventType: 'PERMISSION_CHANGED',
          module: ROLES_AUDIT_META.MODULE,
          feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
          action: ROLES_AUDIT_META.ACTION_UPDATED,
          resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
          resourceId: updatedResponse.id,
          reason: `Updated role ${updatedResponse.code} data scope`,
          beforeData: beforeSnapshot,
          afterData: updatedResponse,
          persistToAuditLog: false,
        });
      }
      return updatedResponse;
    };

    if (this.transactionManager) {
      const result = await this.transactionManager.runInTransaction(work);
      defaultMenuRegistry.invalidateCache();
      return result;
    }
    const result = await work();
    defaultMenuRegistry.invalidateCache();
    return result;
  }

  public async setPermissions(
    id: number,
    dto: SetRolePermissionsRequest,
    loadPermissionsMapFn: (
      roleIds: readonly number[],
    ) => Promise<Map<number, PermissionItemSummary[]>>,
    loadUserCountsMapFn: (roleIds: readonly number[]) => Promise<Map<number, number>>,
    resolveInputPermissionsFn: (
      permissionIds?: readonly number[],
      permissionCodes?: readonly string[],
    ) => Promise<PermissionItemSummary[]>,
  ): Promise<RoleResponse> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new NotFoundAppException('roles.notFound', { id });
    }

    const [beforePermsMap, resolvedPerms, countsMap] = await Promise.all([
      loadPermissionsMapFn([Number(role.id)]),
      resolveInputPermissionsFn(dto.permissionIds, dto.permissions),
      loadUserCountsMapFn([Number(role.id)]),
    ]);
    const beforePerms = beforePermsMap.get(Number(role.id)) ?? [];

    assertDataScopeAllAllowedForRole({
      roleCode: role.code,
      dataScope: Number(role.dataScope ?? DATA_SCOPE.SELF),
      permissionCodes: resolvedPerms.map((p) => p.code),
      isSystem: Boolean(role.isSystem),
      settingRegistry: this.settingRegistry,
    });

    const work = async (): Promise<void> => {
      await this.rolePermissionRepository.replacePermissionsForRole(
        Number(role.id),
        resolvedPerms.map((p) => Number(p.id)),
      );
    };
    if (this.transactionManager) {
      await this.transactionManager.runInTransaction(work);
    } else {
      await work();
    }
    const response = this.mapper.toResponse(
      role,
      resolvedPerms,
      countsMap.get(Number(role.id)) ?? 0,
    );
    await this.auditLogService?.record({
      module: ROLES_AUDIT_META.MODULE,
      feature: ROLES_AUDIT_META.FEATURE_ROLE_PERMISSIONS,
      action: ROLES_AUDIT_META.ACTION_PERMISSIONS_UPDATED,
      resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
      resourceId: role.id,
      beforeData: { permissions: beforePerms.map((p) => p.code) },
      afterData: { permissions: resolvedPerms.map((p) => p.code) },
    });
    await this.platformSecurityService?.recordSecurityEvent({
      eventType: 'PERMISSION_CHANGED',
      module: ROLES_AUDIT_META.MODULE,
      feature: ROLES_AUDIT_META.FEATURE_ROLE_PERMISSIONS,
      action: ROLES_AUDIT_META.ACTION_PERMISSIONS_UPDATED,
      resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
      resourceId: role.id,
      reason: `Updated permissions for role ${role.code}`,
      beforeData: { permissions: beforePerms.map((p) => p.code) },
      afterData: { permissions: resolvedPerms.map((p) => p.code) },
      persistToAuditLog: false,
    });
    defaultMenuRegistry.invalidateCache();
    return response;
  }

  public async remove(
    id: number,
    loadUserCountsMapFn: (roleIds: readonly number[]) => Promise<Map<number, number>>,
  ): Promise<{ deleted: true; id: number }> {
    const role = await this.roleRepository.findById(id);
    if (!role) {
      throw new NotFoundAppException('roles.notFound', { id });
    }
    if (role.isSystem) {
      throw new ForbiddenAppException('roles.cannotDeleteSystemRole', [{ code: role.code }]);
    }

    const countsMap = await loadUserCountsMapFn([Number(role.id)]);
    const assignedUserCount = countsMap.get(Number(role.id)) ?? 0;
    if (assignedUserCount > 0) {
      throw new ConflictAppException(
        'roles.cannotDeleteAssignedRole',
        [{ id: Number(role.id), code: role.code, userCount: assignedUserCount }],
        { id: Number(role.id), code: role.code, userCount: assignedUserCount },
        HTTP_ERROR_CODE.CONFLICT,
      );
    }

    await this.roleRepository.repository.softDelete(id);
    await this.auditLogService?.record({
      module: ROLES_AUDIT_META.MODULE,
      feature: ROLES_AUDIT_META.FEATURE_ROLE_MANAGEMENT,
      action: ROLES_AUDIT_META.ACTION_DELETED,
      resourceType: ROLES_AUDIT_META.RESOURCE_ROLE,
      resourceId: id,
      beforeData: { id: role.id, code: role.code, name: role.name, dataScope: role.dataScope },
      afterData: { deleted: true },
    });
    defaultMenuRegistry.invalidateCache();
    return { deleted: true, id };
  }

  public async getActorEffectiveDataScope(
    actor?: UserIdentity,
    resource = 'users',
  ): Promise<EffectiveDataScopeOverview> {
    if (!this.dataScopeService) {
      return buildFallbackEffectiveDataScope(actor);
    }

    const filter = await this.dataScopeService.resolveScopeFilter(actor, resource, 'read');
    const registeredCustomRules = this.dataScopeService.listRegisteredRules();
    return { filter, registeredCustomRules };
  }

  public listCustomScopeRules(resource?: string): DataScopeCustomRuleMetadata[] {
    if (!this.dataScopeService) return [];
    return this.dataScopeService.listRegisteredRules(resource);
  }

  public registerDeclarativeCustomScopeRule(
    input: DeclarativeCustomScopeRuleInput,
  ): DataScopeCustomRuleMetadata {
    if (!this.dataScopeService) {
      throw new BadRequestAppException('roles.dataScopeServiceUnavailable');
    }

    this.dataScopeService.registerResourceRule({
      code: input.code,
      resource: input.resource,
      module: input.module ?? input.resource,
      name: input.name,
      description: input.description ?? null,
      evaluate: createDeclarativeScopeEvaluateFn(input),
    });

    const rules = this.dataScopeService.listRegisteredRules(input.resource);
    return (
      rules.find((r) => r.code === input.code.trim().toLowerCase()) ?? {
        code: input.code.trim().toLowerCase(),
        resource: input.resource.trim().toLowerCase(),
        module: (input.module ?? input.resource).trim().toLowerCase(),
        name: input.name.trim(),
        description: input.description ?? null,
        priority: 100,
      }
    );
  }

  public async listAuditLogs(query: ListAuditLogsQuery = {}): Promise<AuditLogPaginatedResult> {
    if (!this.auditLogService) {
      const { page, limit } = resolvePagination(query, {
        settingPrefix: ROLES_SETTING_KEYS.AUDIT_LOG_PREFIX,
        defaultLimit: 20,
        maxLimit: 200,
        registry: this.settingRegistry,
      });
      return {
        data: [],
        meta: { page, limit, totalItems: 0, totalPages: 1 },
      };
    }
    return this.auditLogService.listPaginated(query as AuditLogQueryFilter);
  }

  public async getAuditLogById(id: number): Promise<AuditLogRecord> {
    if (!this.auditLogService) {
      throw new NotFoundAppException('roles.auditLogNotFound', { id });
    }
    return this.auditLogService.getById(id);
  }

  public async updateAuditLog(id: number, payload?: unknown): Promise<never> {
    if (this.auditLogService) {
      return this.auditLogService.update(id, payload);
    }
    throw new ForbiddenAppException('security.auditLogImmutable', [{ id, operation: 'UPDATE' }]);
  }

  public async deleteAuditLog(id: number): Promise<never> {
    if (this.auditLogService) {
      return this.auditLogService.remove(id);
    }
    throw new ForbiddenAppException('security.auditLogImmutable', [{ id, operation: 'DELETE' }]);
  }

  public listSecurityEvents(
    filter?: Parameters<PlatformSecurityService['listSecurityEvents']>[0],
  ): SecurityEventRecord[] {
    return this.platformSecurityService?.listSecurityEvents(filter) ?? [];
  }

  public listSecurityAlerts(
    filter?: Parameters<PlatformSecurityService['listAnomalyAlerts']>[0],
  ): SecurityAnomalyAlert[] {
    return this.platformSecurityService?.listAnomalyAlerts(filter) ?? [];
  }
}
