import { ForbiddenAppException, type SettingRegistryService } from '@packages/kernel/index.js';
import {
  DATA_SCOPE,
  type DataScopeEvaluationContext,
  type DataScopeRuleEvaluationResult,
  type UserIdentity,
} from '@packages/security/index.js';
import {
  DEFAULT_ALL_SCOPE_PERMISSIONS,
  DEFAULT_ALL_SCOPE_ROLE_PATTERNS,
  ROLES_SETTING_KEYS,
} from '../enum/roles.enum.js';
import type {
  DeclarativeCustomScopeRuleInput,
  EffectiveDataScopeOverview,
} from '../types/roles.types.js';

/** Kiểm tra chuỗi có khớp với danh sách mẫu wildcard (hỗ trợ hậu tố `*`) */
export function matchesWildcardPattern(value: string, patterns: readonly string[]): boolean {
  const normalized = value.trim().toLowerCase();
  for (const rawPattern of patterns) {
    const pattern = String(rawPattern).trim().toLowerCase();
    if (!pattern) continue;
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (normalized.startsWith(prefix)) return true;
    } else if (normalized === pattern) {
      return true;
    }
  }
  return false;
}

/**
 * Kiểm tra chỉ vai trò được phép mới được gán Phạm vi dữ liệu Toàn hệ thống (DATA_SCOPE.ALL = 1 — Mục 4.3.4).
 */
export function assertDataScopeAllAllowedForRole(params: {
  readonly roleCode: string;
  readonly dataScope: number;
  readonly permissionCodes: readonly string[];
  readonly isSystem?: boolean;
  readonly settingRegistry: SettingRegistryService;
}): void {
  const { roleCode, dataScope, permissionCodes, isSystem = false, settingRegistry } = params;
  if (dataScope !== DATA_SCOPE.ALL || isSystem) return;

  const allowedRolePatterns = settingRegistry.getJson<readonly string[]>(
    ROLES_SETTING_KEYS.ALL_ALLOWED_ROLE_PATTERNS,
    undefined,
    DEFAULT_ALL_SCOPE_ROLE_PATTERNS,
  );
  const allowedPermPatterns = settingRegistry.getJson<readonly string[]>(
    ROLES_SETTING_KEYS.ALL_ALLOWED_PERMISSIONS,
    undefined,
    DEFAULT_ALL_SCOPE_PERMISSIONS,
  );

  const isPermittedRoleCode = matchesWildcardPattern(
    roleCode,
    Array.isArray(allowedRolePatterns) ? allowedRolePatterns : DEFAULT_ALL_SCOPE_ROLE_PATTERNS,
  );

  const effectivePermPatterns = Array.isArray(allowedPermPatterns)
    ? allowedPermPatterns
    : DEFAULT_ALL_SCOPE_PERMISSIONS;
  const hasSystemWidePermission = permissionCodes.some((perm) =>
    matchesWildcardPattern(perm, effectivePermPatterns),
  );

  if (!isPermittedRoleCode && !hasSystemWidePermission) {
    throw new ForbiddenAppException('roles.dataScopeAllNotAllowedForRole', [{ code: roleCode }]);
  }
}

/** Tạo hàm evaluate cho rule phạm vi dữ liệu động của module nghiệp vụ */
export function createDeclarativeScopeEvaluateFn(
  input: DeclarativeCustomScopeRuleInput,
): (ctx: DataScopeEvaluationContext) => DataScopeRuleEvaluationResult {
  return ({ actor, target }) => {
    if (
      input.allowAllIfHasPermission &&
      actor.permissions.includes(input.allowAllIfHasPermission)
    ) {
      return {
        allow: true,
        filterOverride: { isUnrestricted: true },
      };
    }

    const extraOrgs = input.allowedOrganizationUnitIds ?? [];
    const extraUsers = input.allowedUserIds ?? [];

    if (target) {
      const targetOwner = Number(target.ownerId ?? target.id);
      if (!Number.isNaN(targetOwner) && extraUsers.includes(targetOwner)) {
        return { allow: true };
      }
      const targetPrimaryOrg = Number(target.primaryOrganizationUnitId);
      if (!Number.isNaN(targetPrimaryOrg) && extraOrgs.includes(targetPrimaryOrg)) {
        return { allow: true };
      }
    }

    return {
      filterOverride: {
        ...(extraOrgs.length > 0 ? { allowedOrganizationUnitIds: extraOrgs } : {}),
        ...(extraUsers.length > 0 ? { allowedUserIds: extraUsers } : {}),
        customAttributes: { [input.code]: true },
      },
    };
  };
}

/** Tạo kết quả phạm vi dữ liệu mặc định khi DataScopeService không khả dụng */
export function buildFallbackEffectiveDataScope(actor?: UserIdentity): EffectiveDataScopeOverview {
  return {
    filter: {
      isUnrestricted: true,
      effectiveScope: DATA_SCOPE.ALL,
      effectiveScopeName: 'ALL',
      grantedScopes: [DATA_SCOPE.ALL],
      allowedUserIds: actor?.id ? [actor.id] : [],
      allowedOrganizationUnitIds: actor?.organizationUnitIds ? [...actor.organizationUnitIds] : [],
      customAttributes: {},
      appliedRuleCodes: [],
    },
    registeredCustomRules: [],
  };
}
