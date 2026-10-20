import { Injectable } from '@nestjs/common';
import { ForbiddenAppException } from '@packages/kernel/index.js';
import type { UserIdentity } from '../contracts/auth.contract.js';
import {
  DATA_SCOPE,
  type DataScopeCode,
  type DataScopeCustomRuleDeclaration,
  type DataScopeCustomRuleMetadata,
  type DataScopeRecordTarget,
  type ResolvedDataScopeFilter,
  getDataScopeName,
  inferDefaultDataScopeForRoleCode,
  parseDataScope,
} from '../contracts/data-scope.contract.js';

@Injectable()
export class DataScopeService {
  private orgHierarchyResolver?: (unitIds: readonly number[]) => Promise<number[]>;
  private subordinateResolver?: (managerId: number) => Promise<number[]>;
  private roleScopeResolver?: (roleCodes: readonly string[]) => Promise<DataScopeCode[]>;
  private readonly resourceRules = new Map<string, Map<string, DataScopeCustomRuleDeclaration>>();

  /**
   * Đăng ký hàm giải quyết cây đơn vị tổ chức (đơn vị hiện tại + các đơn vị con trực thuộc).
   * Được gọi từ module `organizations` mà không tạo phụ thuộc ngược vào Core.
   */
  public registerOrgHierarchyResolver(
    resolver: (unitIds: readonly number[]) => Promise<number[]>,
  ): void {
    this.orgHierarchyResolver = resolver;
  }

  /**
   * Đăng ký hàm giải quyết danh sách ID nhân sự cấp dưới theo cây quản lý (`managerId`).
   * Được gọi từ module `users` mà không tạo phụ thuộc ngược vào Core.
   */
  public registerSubordinateResolver(resolver: (managerId: number) => Promise<number[]>): void {
    this.subordinateResolver = resolver;
  }

  /**
   * Đăng ký hàm tra cứu danh sách mã DataScope từ danh sách mã vai trò (`roleCodes`).
   * Được gọi từ module `roles` để giải quyết chính xác phạm vi dữ liệu đã cấu hình trong DB.
   */
  public registerRoleScopeResolver(
    resolver: (roleCodes: readonly string[]) => Promise<DataScopeCode[]>,
  ): void {
    this.roleScopeResolver = resolver;
  }

  /**
   * Cho phép module nghiệp vụ (`modules/*`, `project-modules/*`) bổ sung rule phạm vi riêng
   * mà không cần chỉnh sửa trực tiếp Core (Mục 4.3.7).
   */
  public registerResourceRule(declaration: DataScopeCustomRuleDeclaration): void {
    const resourceKey = declaration.resource.trim().toLowerCase();
    const ruleCode = declaration.code.trim().toLowerCase();
    if (!resourceKey || !ruleCode) return;

    const bucket =
      this.resourceRules.get(resourceKey) ?? new Map<string, DataScopeCustomRuleDeclaration>();
    bucket.set(ruleCode, {
      ...declaration,
      resource: resourceKey,
      code: ruleCode,
      module: declaration.module?.trim().toLowerCase() || resourceKey,
      name: declaration.name.trim() || ruleCode,
      description: declaration.description ?? null,
      priority: declaration.priority ?? 100,
    });
    this.resourceRules.set(resourceKey, bucket);
  }

  /** Gỡ bỏ một rule phạm vi tùy chỉnh của module nghiệp vụ */
  public unregisterResourceRule(resource: string, ruleCode: string): boolean {
    const resourceKey = resource.trim().toLowerCase();
    const codeKey = ruleCode.trim().toLowerCase();
    const bucket = this.resourceRules.get(resourceKey);
    if (!bucket) return false;
    return bucket.delete(codeKey);
  }

  /** Liệt kê danh sách các rule phạm vi riêng đã được các module nghiệp vụ đăng ký */
  public listRegisteredRules(resource?: string): DataScopeCustomRuleMetadata[] {
    const items: DataScopeCustomRuleMetadata[] = [];
    const targetResource = resource?.trim().toLowerCase();

    for (const [resKey, bucket] of this.resourceRules.entries()) {
      if (targetResource && resKey !== targetResource && resKey !== '*') continue;
      for (const rule of bucket.values()) {
        items.push({
          code: rule.code,
          resource: rule.resource,
          module: rule.module ?? rule.resource,
          name: rule.name,
          description: rule.description ?? null,
          priority: rule.priority ?? 100,
        });
      }
    }

    return items.sort((a, b) =>
      a.resource === b.resource
        ? a.priority - b.priority || a.code.localeCompare(b.code)
        : a.resource.localeCompare(b.resource),
    );
  }

  /**
   * Giải quyết bộ lọc phạm vi dữ liệu (`ResolvedDataScopeFilter`) cho người dùng hiện hành
   * để áp dụng vào truy vấn Danh sách và Báo cáo (Mục 4.3.1 -> 4.3.5 & 4.3.7).
   */
  public async resolveScopeFilter(
    actor?: UserIdentity | null,
    resource = 'users',
    action = 'read',
  ): Promise<ResolvedDataScopeFilter> {
    // Trường hợp gọi nội bộ hệ thống (không truyền actor) -> không giới hạn phạm vi
    if (!actor) {
      return {
        isUnrestricted: true,
        effectiveScope: DATA_SCOPE.ALL,
        effectiveScopeName: 'ALL',
        grantedScopes: [DATA_SCOPE.ALL],
        allowedUserIds: [],
        allowedOrganizationUnitIds: [],
        customAttributes: {},
        appliedRuleCodes: [],
      };
    }

    const grantedScopes = await this.resolveActorScopes(actor);
    const hasAllScope = grantedScopes.includes(DATA_SCOPE.ALL);
    const hasOrgScope = grantedScopes.includes(DATA_SCOPE.ORG_UNIT);
    const hasSubordinateScope = grantedScopes.includes(DATA_SCOPE.SUBORDINATES);

    // Mức phạm vi hiệu lực cao nhất (1 = ALL < 2 = ORG_UNIT < 3 = SUBORDINATES < 4 = SELF)
    const effectiveScope: DataScopeCode =
      grantedScopes.length > 0 ? (Math.min(...grantedScopes) as DataScopeCode) : DATA_SCOPE.SELF;

    const allowedUserIdsSet = new Set<number>();
    if (Number.isInteger(actor.id) && actor.id > 0) {
      allowedUserIdsSet.add(Number(actor.id));
    }

    const allowedOrgIdsSet = new Set<number>();

    if (!hasAllScope) {
      if (hasOrgScope) {
        const directOrgIds = (actor.organizationUnitIds ?? [])
          .map(Number)
          .filter((id) => Number.isInteger(id) && id > 0);
        for (const id of directOrgIds) {
          allowedOrgIdsSet.add(id);
        }
        if (directOrgIds.length > 0 && this.orgHierarchyResolver) {
          const expandedOrgIds = await this.orgHierarchyResolver(directOrgIds);
          for (const id of expandedOrgIds) {
            if (Number.isInteger(id) && id > 0) {
              allowedOrgIdsSet.add(Number(id));
            }
          }
        }
      }

      if (hasSubordinateScope && Number.isInteger(actor.id) && actor.id > 0) {
        if (this.subordinateResolver) {
          const subordinateIds = await this.subordinateResolver(Number(actor.id));
          for (const subId of subordinateIds) {
            if (Number.isInteger(subId) && subId > 0) {
              allowedUserIdsSet.add(Number(subId));
            }
          }
        }
      }
    }

    let isUnrestricted = hasAllScope;
    const customAttributes: Record<string, unknown> = {};
    const appliedRuleCodes: string[] = [];

    const baseFilter: ResolvedDataScopeFilter = {
      isUnrestricted,
      effectiveScope,
      effectiveScopeName: getDataScopeName(effectiveScope),
      grantedScopes,
      allowedUserIds: [...allowedUserIdsSet],
      allowedOrganizationUnitIds: [...allowedOrgIdsSet],
      customAttributes: { ...customAttributes },
      appliedRuleCodes: [...appliedRuleCodes],
    };

    // Chạy các rule mở rộng của module nghiệp vụ (nếu có đăng ký cho resource này hoặc '*')
    const rules = this.getMatchingRules(resource);
    for (const rule of rules) {
      const evalRes = await rule.evaluate({
        actor,
        resource: resource.trim().toLowerCase(),
        action,
        baseFilter: {
          ...baseFilter,
          isUnrestricted,
          allowedUserIds: [...allowedUserIdsSet],
          allowedOrganizationUnitIds: [...allowedOrgIdsSet],
          customAttributes: { ...customAttributes },
          appliedRuleCodes: [...appliedRuleCodes],
        },
      });
      if (!evalRes) continue;
      appliedRuleCodes.push(rule.code);

      if (evalRes.filterOverride) {
        if (evalRes.filterOverride.isUnrestricted !== undefined) {
          isUnrestricted = evalRes.filterOverride.isUnrestricted;
        }
        if (evalRes.filterOverride.allowedUserIds) {
          for (const uid of evalRes.filterOverride.allowedUserIds) {
            if (Number.isInteger(uid) && uid > 0) {
              allowedUserIdsSet.add(Number(uid));
            }
          }
        }
        if (evalRes.filterOverride.allowedOrganizationUnitIds) {
          for (const oid of evalRes.filterOverride.allowedOrganizationUnitIds) {
            if (Number.isInteger(oid) && oid > 0) {
              allowedOrgIdsSet.add(Number(oid));
            }
          }
        }
        if (evalRes.filterOverride.customAttributes) {
          Object.assign(customAttributes, evalRes.filterOverride.customAttributes);
        }
      }
    }

    return {
      isUnrestricted,
      effectiveScope: isUnrestricted ? DATA_SCOPE.ALL : effectiveScope,
      effectiveScopeName: getDataScopeName(isUnrestricted ? DATA_SCOPE.ALL : effectiveScope),
      grantedScopes,
      allowedUserIds: [...allowedUserIdsSet],
      allowedOrganizationUnitIds: [...allowedOrgIdsSet],
      customAttributes,
      appliedRuleCodes,
    };
  }

  /**
   * Kiểm tra xem người dùng có được phép truy cập một bản ghi cụ thể hay không (Mục 4.3.6 & 4.3.7).
   */
  public async canAccessRecord(
    actor: UserIdentity | undefined | null,
    resource: string,
    target: DataScopeRecordTarget,
    action = 'read',
  ): Promise<{ allowed: boolean; filter: ResolvedDataScopeFilter; reason?: string }> {
    const filter = await this.resolveScopeFilter(actor, resource, action);
    if (!actor) {
      return { allowed: true, filter };
    }

    // 1. Cho phép các rule nghiệp vụ tùy chỉnh đánh giá trực tiếp trên bản ghi target
    const rules = this.getMatchingRules(resource);
    for (const rule of rules) {
      const evalRes = await rule.evaluate({
        actor,
        resource: resource.trim().toLowerCase(),
        action,
        baseFilter: filter,
        target,
      });
      if (evalRes && typeof evalRes.allow === 'boolean') {
        return evalRes.allow
          ? { allowed: true, filter }
          : {
              allowed: false,
              filter,
              reason: `Denied by custom data scope rule '${rule.code}' on resource '${resource}'`,
            };
      }
    }

    // 2. Nếu có phạm vi toàn hệ thống (ALL) -> cho phép
    if (filter.isUnrestricted) {
      return { allowed: true, filter };
    }

    // 3. Kiểm tra theo danh sách User được phép (SELF hoặc SUBORDINATES)
    const normalizedResource = resource.trim().toLowerCase();
    const isUserResource = normalizedResource === 'users' || normalizedResource === 'user';
    const targetOwnerId =
      target.ownerId !== undefined && target.ownerId !== null
        ? Number(target.ownerId)
        : isUserResource && target.id !== undefined && target.id !== null
          ? Number(target.id)
          : NaN;

    if (
      !Number.isNaN(targetOwnerId) &&
      targetOwnerId > 0 &&
      filter.allowedUserIds.includes(targetOwnerId)
    ) {
      return { allowed: true, filter };
    }

    // 4. Kiểm tra theo danh sách Đơn vị tổ chức được phép (ORG_UNIT)
    if (filter.allowedOrganizationUnitIds.length > 0) {
      const targetOrgIds = new Set<number>();
      if (
        target.primaryOrganizationUnitId !== undefined &&
        target.primaryOrganizationUnitId !== null &&
        Number(target.primaryOrganizationUnitId) > 0
      ) {
        targetOrgIds.add(Number(target.primaryOrganizationUnitId));
      }
      if (Array.isArray(target.organizationUnitIds)) {
        for (const oid of target.organizationUnitIds) {
          if (Number(oid) > 0) {
            targetOrgIds.add(Number(oid));
          }
        }
      }

      for (const allowedOrgId of filter.allowedOrganizationUnitIds) {
        if (targetOrgIds.has(allowedOrgId)) {
          return { allowed: true, filter };
        }
      }
    }

    return {
      allowed: false,
      filter,
      reason: `Record #${String(target.id ?? targetOwnerId ?? 'unknown')} is outside actor #${actor.id} data scope (${filter.effectiveScopeName})`,
    };
  }

  /**
   * Khẳng định quyền truy cập phạm vi dữ liệu trước khi xem chi tiết hoặc thao tác trên bản ghi.
   * Ngăn chặn hành vi đổi ID trên URL để xem dữ liệu ngoài phạm vi (Anti-IDOR — Mục 4.3.6).
   */
  public async assertCanAccessRecord(
    actor: UserIdentity | undefined | null,
    resource: string,
    target: DataScopeRecordTarget,
    action = 'read',
  ): Promise<ResolvedDataScopeFilter> {
    const check = await this.canAccessRecord(actor, resource, target, action);
    if (!check.allowed) {
      throw new ForbiddenAppException('security.dataScopeForbidden', [
        {
          resource,
          action,
          targetId: target.id ?? target.ownerId ?? null,
          effectiveScope: check.filter.effectiveScopeName,
          reason: check.reason,
        },
      ]);
    }
    return check.filter;
  }

  /** Giải quyết danh sách các mã DataScopeCode của người dùng hiện hành */
  private async resolveActorScopes(actor: UserIdentity): Promise<DataScopeCode[]> {
    const scopes = new Set<DataScopeCode>();

    if (Array.isArray(actor.dataScopes) && actor.dataScopes.length > 0) {
      for (const s of actor.dataScopes) {
        scopes.add(parseDataScope(s));
      }
    }
    if (actor.dataScope !== undefined && actor.dataScope !== null) {
      scopes.add(parseDataScope(actor.dataScope));
    }

    // Nếu token/identity chưa đính kèm sẵn dataScopes, tra cứu động từ RolesService hoặc suy diễn theo mã vai trò
    if (scopes.size === 0 && Array.isArray(actor.roles) && actor.roles.length > 0) {
      if (this.roleScopeResolver) {
        const resolvedFromDb = await this.roleScopeResolver(actor.roles);
        for (const s of resolvedFromDb) {
          scopes.add(parseDataScope(s));
        }
      }
      if (scopes.size === 0) {
        for (const roleCode of actor.roles) {
          scopes.add(inferDefaultDataScopeForRoleCode(roleCode));
        }
      }
    }

    if (scopes.size === 0) {
      scopes.add(DATA_SCOPE.SELF);
    }

    return [...scopes].sort((a, b) => a - b);
  }

  /** Lấy danh sách các rule tùy chỉnh khớp với resource (bao gồm cả wildcard '*') */
  private getMatchingRules(resource: string): DataScopeCustomRuleDeclaration[] {
    const resourceKey = resource.trim().toLowerCase();
    const matched: DataScopeCustomRuleDeclaration[] = [];

    const wildcardBucket = this.resourceRules.get('*');
    if (wildcardBucket) {
      matched.push(...wildcardBucket.values());
    }
    if (resourceKey && resourceKey !== '*') {
      const specificBucket = this.resourceRules.get(resourceKey);
      if (specificBucket) {
        matched.push(...specificBucket.values());
      }
    }

    return matched.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }
}

export function createDefaultDataScopeService(): DataScopeService {
  return new DataScopeService();
}
