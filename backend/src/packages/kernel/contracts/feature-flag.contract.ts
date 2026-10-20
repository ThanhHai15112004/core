import { VALIDATION_ISSUE_CODE, ValidationAppException } from '../errors/http-exceptions.js';
import { scanModuleManifests } from './manifest.contract.js';

export const FEATURE_FLAG_STATUS = {
  ACTIVE: 1,
  ARCHIVED: 2,
} as const;

export const FEATURE_FLAG_ITEM_STATUS = FEATURE_FLAG_STATUS;

export type FeatureFlagStatusCode = (typeof FEATURE_FLAG_STATUS)[keyof typeof FEATURE_FLAG_STATUS];

export type FeatureFlagEvaluationReason =
  | 'ENABLED_ALL'
  | 'TARGET_USER_MATCH'
  | 'TARGET_ROLE_MATCH'
  | 'TARGET_ORG_UNIT_MATCH'
  | 'ROLLOUT_MATCH'
  | 'FLAG_NOT_FOUND'
  | 'MODULE_NOT_INSTALLED'
  | 'FLAG_DISABLED'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'TARGET_MISMATCH'
  | 'ROLLOUT_EXCLUDED';

/** Khai báo Feature Flag mặc định trong `module.manifest.json` (Mục 5.2.1 -> 5.2.7) */
export interface FeatureFlagManifestItem {
  readonly key: string;
  readonly module?: string | undefined;
  readonly name: string;
  readonly description: string;
  readonly isEnabled?: boolean | undefined;
  readonly rolloutPercentage?: number | undefined;
  readonly targetUserIds?: readonly (string | number)[] | undefined;
  readonly targetRoles?: readonly string[] | undefined;
  readonly targetOrganizationUnitIds?: readonly (string | number)[] | undefined;
  readonly startsAt?: string | null | undefined;
  readonly endsAt?: string | null | undefined;
  readonly metadata?: Record<string, unknown> | null | undefined;
  readonly isSystem?: boolean | undefined;
  readonly status?: number | undefined;
}

/** Định nghĩa Feature Flag trong L1 Registry (Mục 5.2) */
export interface RegisteredFeatureFlagDefinition {
  id?: number | undefined;
  key: string;
  module: string;
  name: string;
  description: string;
  isEnabled: boolean;
  rolloutPercentage: number;
  targetUserIds: readonly string[];
  targetRoles: readonly string[];
  targetOrganizationUnitIds: readonly string[];
  startsAt: string | null;
  endsAt: string | null;
  metadata: Record<string, unknown> | null;
  isSystem: boolean;
  status: FeatureFlagStatusCode;
  updatedBy?: number | null | undefined;
  updatedAt?: string | undefined;
}

/** Ngữ cảnh đánh giá Feature Flag theo người dùng / vai trò / đơn vị / thời điểm (Mục 5.2.3 -> 5.2.7) */
export interface FeatureFlagEvaluationContext {
  readonly userId?: string | number | null | undefined;
  readonly roles?: readonly string[] | null | undefined;
  readonly organizationUnitId?: string | number | null | undefined;
  readonly organizationUnitIds?: readonly (string | number)[] | null | undefined;
  readonly at?: Date | string | number | null | undefined;
}

/** Kết quả đánh giá một Feature Flag (Mục 5.2) */
export interface FeatureFlagEvaluationResult {
  readonly key: string;
  readonly module: string;
  readonly enabled: boolean;
  readonly reason: FeatureFlagEvaluationReason;
  readonly rolloutPercentage: number;
  readonly userBucket: number | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly evaluatedAt: string;
  readonly fromCache: boolean;
}

export type FeatureFlagChangeListener = (event: {
  key: string;
  module: string;
  isEnabled: boolean;
}) => void | Promise<void>;

/**
 * Thuật toán băm nhất quán FNV-1a (Deterministic Rollout Hash) ánh xạ `(flagKey, identifier)`
 * về khoảng số nguyên `0..99` (Mục 5.2.6 — Bật theo tỷ lệ người dùng phục vụ rollout dần).
 */
export function computeFeatureFlagRolloutBucket(
  flagKey: string,
  identifier: string | number,
): number {
  const input = `${flagKey.trim().toLowerCase()}:${String(identifier).trim().toLowerCase()}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

function parseIsoFlagDateBound(
  raw: string | Date | null | undefined,
  field: 'startsAt' | 'endsAt',
  fieldPrefix: string,
): string | null {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return null;
  }
  const ms = raw instanceof Date ? raw.getTime() : Date.parse(String(raw).trim());
  if (Number.isNaN(ms)) {
    throw new ValidationAppException(
      [
        {
          field,
          message: `${fieldPrefix} ${field} must be a valid ISO-8601 date string`,
          code: VALIDATION_ISSUE_CODE.INVALID_FORMAT,
        },
      ],
      `${fieldPrefix} ${field} must be a valid ISO-8601 date string`,
    );
  }
  return new Date(ms).toISOString();
}

/**
 * Kiểm tra tính hợp lệ của key, mô tả, đối tượng mục tiêu, tỷ lệ phần trăm rollout `0..100`
 * và khung thời gian `startsAt..endsAt` (Mục 5.2.1 -> 5.2.7).
 */
export function validateFeatureFlagRules(input: {
  key: string;
  name: string;
  description: string;
  rolloutPercentage?: number | undefined;
  targetUserIds?: readonly (string | number)[] | undefined;
  targetRoles?: readonly string[] | undefined;
  targetOrganizationUnitIds?: readonly (string | number)[] | undefined;
  startsAt?: string | Date | null | undefined;
  endsAt?: string | Date | null | undefined;
}): {
  rolloutPercentage: number;
  targetUserIds: string[];
  targetRoles: string[];
  targetOrganizationUnitIds: string[];
  startsAt: string | null;
  endsAt: string | null;
} {
  const key = input.key.trim().toLowerCase();
  const fieldPrefix = `FeatureFlag '${key}'`;

  if (!key || !/^[a-z0-9][a-z0-9._-]*\.[a-z0-9._-]+$/i.test(key)) {
    throw new ValidationAppException(
      [
        {
          field: 'key',
          message: `${fieldPrefix} key must follow <module>.<feature> format`,
          code: VALIDATION_ISSUE_CODE.INVALID_FORMAT,
        },
      ],
      `${fieldPrefix} key must follow <module>.<feature> format`,
    );
  }

  if (!input.name || input.name.trim().length < 2) {
    throw new ValidationAppException(
      [
        {
          field: 'name',
          message: `${fieldPrefix} name must be at least 2 characters`,
          code: VALIDATION_ISSUE_CODE.INVALID_VALUE,
        },
      ],
      `${fieldPrefix} name must be at least 2 characters`,
    );
  }

  if (!input.description || input.description.trim().length < 3) {
    throw new ValidationAppException(
      [
        {
          field: 'description',
          message: `${fieldPrefix} description must be clear and at least 3 characters`,
          code: VALIDATION_ISSUE_CODE.INVALID_VALUE,
        },
      ],
      `${fieldPrefix} description must be clear and at least 3 characters`,
    );
  }

  const rollout = input.rolloutPercentage ?? 100;
  if (typeof rollout !== 'number' || !Number.isInteger(rollout) || rollout < 0 || rollout > 100) {
    throw new ValidationAppException(
      [
        {
          field: 'rolloutPercentage',
          message: `${fieldPrefix} rolloutPercentage must be an integer between 0 and 100`,
          code: VALIDATION_ISSUE_CODE.INVALID_VALUE,
        },
      ],
      `${fieldPrefix} rolloutPercentage must be an integer between 0 and 100`,
    );
  }

  const startsAt = parseIsoFlagDateBound(input.startsAt, 'startsAt', fieldPrefix);
  const endsAt = parseIsoFlagDateBound(input.endsAt, 'endsAt', fieldPrefix);

  if (startsAt && endsAt && Date.parse(startsAt) > Date.parse(endsAt)) {
    throw new ValidationAppException(
      [
        {
          field: 'endsAt',
          message: `${fieldPrefix} startsAt must be earlier than or equal to endsAt`,
          code: VALIDATION_ISSUE_CODE.INVALID_VALUE,
        },
      ],
      `${fieldPrefix} startsAt must be earlier than or equal to endsAt`,
    );
  }

  const targetUserIds = Array.from(
    new Set((input.targetUserIds ?? []).map((id) => String(id).trim()).filter(Boolean)),
  );
  const targetRoles = Array.from(
    new Set((input.targetRoles ?? []).map((r) => String(r).trim().toUpperCase()).filter(Boolean)),
  );
  const targetOrganizationUnitIds = Array.from(
    new Set((input.targetOrganizationUnitIds ?? []).map((id) => String(id).trim()).filter(Boolean)),
  );

  return {
    rolloutPercentage: rollout,
    targetUserIds,
    targetRoles,
    targetOrganizationUnitIds,
    startsAt,
    endsAt,
  };
}

/**
 * Quét tự động (Zero-Hardcode) các tệp `module.manifest.json` qua `scanModuleManifests()`
 * để thu thập danh sách `featureFlags` phục vụ Seeder và L1 Fallback (Mục 5.2).
 */
export function discoverManifestFeatureFlags(): FeatureFlagManifestItem[] {
  const flagMap = new Map<string, FeatureFlagManifestItem>();

  for (const { moduleName, raw } of scanModuleManifests<{
    name?: string;
    featureFlags?: FeatureFlagManifestItem[];
  }>()) {
    if (Array.isArray(raw.featureFlags)) {
      for (const item of raw.featureFlags) {
        if (!item || typeof item.key !== 'string') continue;
        const key = item.key.trim().toLowerCase();
        if (!flagMap.has(key)) {
          flagMap.set(key, {
            ...item,
            key,
            module: (item.module ?? moduleName).trim().toLowerCase(),
          });
        }
      }
    }
  }

  return [...flagMap.values()];
}
