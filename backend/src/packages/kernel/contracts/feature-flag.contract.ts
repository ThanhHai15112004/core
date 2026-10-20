import { Injectable } from '@nestjs/common';
import { VALIDATION_ISSUE_CODE, ValidationAppException } from '../errors/http-exceptions.js';
import { discoverInstalledModules, scanModuleManifests } from './manifest.contract.js';

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
 * Cùng một `userId` và `flagKey` luôn nhận cùng một bucket cố định.
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

  let startsAt: string | null = null;
  if (
    input.startsAt !== undefined &&
    input.startsAt !== null &&
    String(input.startsAt).trim() !== ''
  ) {
    const startMs =
      input.startsAt instanceof Date
        ? input.startsAt.getTime()
        : Date.parse(String(input.startsAt).trim());
    if (Number.isNaN(startMs)) {
      throw new ValidationAppException(
        [
          {
            field: 'startsAt',
            message: `${fieldPrefix} startsAt must be a valid ISO-8601 date string`,
            code: VALIDATION_ISSUE_CODE.INVALID_FORMAT,
          },
        ],
        `${fieldPrefix} startsAt must be a valid ISO-8601 date string`,
      );
    }
    startsAt = new Date(startMs).toISOString();
  }

  let endsAt: string | null = null;
  if (input.endsAt !== undefined && input.endsAt !== null && String(input.endsAt).trim() !== '') {
    const endMs =
      input.endsAt instanceof Date
        ? input.endsAt.getTime()
        : Date.parse(String(input.endsAt).trim());
    if (Number.isNaN(endMs)) {
      throw new ValidationAppException(
        [
          {
            field: 'endsAt',
            message: `${fieldPrefix} endsAt must be a valid ISO-8601 date string`,
            code: VALIDATION_ISSUE_CODE.INVALID_FORMAT,
          },
        ],
        `${fieldPrefix} endsAt must be a valid ISO-8601 date string`,
      );
    }
    endsAt = new Date(endMs).toISOString();
  }

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

/**
 * L1 In-Memory Registry & Evaluator cho Feature Flags (Mục 5.2.1 -> 5.2.8):
 * Thực thi đánh giá 6 bước:
 * 1. Tồn tại Flag
 * 2. Module sở hữu Flag phải đã được cài trong `enabledModules` của `project.manifest.json` (Mục 5.2.2)
 * 3. Cờ `isEnabled == true` và `status == ACTIVE` (Mục 5.2.2)
 * 4. Thời gian hiện tại nằm trong khoảng `startsAt..endsAt` (Mục 5.2.7 — tự động đóng khi hết hạn)
 * 5. Khớp điều kiện đối tượng mục tiêu nếu có cấu hình: Người dùng (5.2.3), Vai trò (5.2.4), Đơn vị (5.2.5)
 * 6. Kiểm tra tỷ lệ phần trăm `rolloutPercentage` 0..100% bằng băm nhất quán FNV-1a (Mục 5.2.6)
 */
@Injectable()
export class FeatureFlagRegistryService {
  private static sharedInstance: FeatureFlagRegistryService | null = null;

  public static getInstance(): FeatureFlagRegistryService {
    if (!FeatureFlagRegistryService.sharedInstance) {
      FeatureFlagRegistryService.sharedInstance = new FeatureFlagRegistryService();
    }
    return FeatureFlagRegistryService.sharedInstance;
  }

  private readonly definitions = new Map<string, RegisteredFeatureFlagDefinition>();
  private readonly installedModules = new Set<string>();
  private readonly listeners = new Set<FeatureFlagChangeListener>();
  private nextId = 1;

  constructor() {
    this.bootstrapFromManifests();
    if (!FeatureFlagRegistryService.sharedInstance) {
      FeatureFlagRegistryService.sharedInstance = this;
    }
  }

  /** Nạp danh sách module đã cài (`enabledModules`) và danh mục `featureFlags` từ Manifest */
  public bootstrapFromManifests(): void {
    for (const mod of discoverInstalledModules()) {
      this.installedModules.add(mod);
    }
    this.registerManifestFlags(discoverManifestFeatureFlags());
  }

  /** Kiểm tra một module đã được cài đặt trong `project.manifest.json` (`enabledModules`) hay chưa (Mục 5.2.2) */
  public isModuleInstalled(moduleName: string): boolean {
    const norm = moduleName.trim().toLowerCase();
    if (!norm) return false;
    if (this.installedModules.size === 0) {
      for (const mod of discoverInstalledModules()) {
        this.installedModules.add(mod);
      }
    }
    return this.installedModules.has(norm);
  }

  /** Lấy danh sách các module đã được cài đặt */
  public getInstalledModules(): string[] {
    if (this.installedModules.size === 0) {
      for (const mod of discoverInstalledModules()) {
        this.installedModules.add(mod);
      }
    }
    return [...this.installedModules].sort();
  }

  /** Cập nhật danh sách các module đã cài đặt (phục vụ đồng bộ hoặc kiểm thử cô lập) */
  public setInstalledModules(modules: readonly string[]): void {
    this.installedModules.clear();
    for (const m of modules) {
      const norm = m.trim().toLowerCase();
      if (norm) {
        this.installedModules.add(norm);
      }
    }
    if (
      FeatureFlagRegistryService.sharedInstance &&
      FeatureFlagRegistryService.sharedInstance !== this
    ) {
      FeatureFlagRegistryService.sharedInstance.installedModules.clear();
      for (const m of this.installedModules) {
        FeatureFlagRegistryService.sharedInstance.installedModules.add(m);
      }
    }
  }

  /** Đăng ký listener lắng nghe khi một Feature Flag thay đổi */
  public onFlagChanged(listener: FeatureFlagChangeListener): () => void {
    this.listeners.add(listener);
    if (
      FeatureFlagRegistryService.sharedInstance &&
      FeatureFlagRegistryService.sharedInstance !== this
    ) {
      FeatureFlagRegistryService.sharedInstance.listeners.add(listener);
    }
    return () => {
      this.listeners.delete(listener);
      if (
        FeatureFlagRegistryService.sharedInstance &&
        FeatureFlagRegistryService.sharedInstance !== this
      ) {
        FeatureFlagRegistryService.sharedInstance.listeners.delete(listener);
      }
    };
  }

  public registerManifestFlags(items: readonly FeatureFlagManifestItem[]): void {
    for (const item of items) {
      const key = item.key.trim().toLowerCase();
      const existing = this.definitions.get(key);
      const assignedId = existing?.id ?? this.nextId++;
      if (assignedId >= this.nextId) {
        this.nextId = assignedId + 1;
      }

      const moduleName = (item.module ?? existing?.module ?? key.split('.')[0] ?? 'settings')
        .trim()
        .toLowerCase();
      const validated = validateFeatureFlagRules({
        key,
        name: item.name,
        description: item.description,
        rolloutPercentage: item.rolloutPercentage ?? existing?.rolloutPercentage ?? 100,
        targetUserIds: item.targetUserIds ?? existing?.targetUserIds ?? [],
        targetRoles: item.targetRoles ?? existing?.targetRoles ?? [],
        targetOrganizationUnitIds:
          item.targetOrganizationUnitIds ?? existing?.targetOrganizationUnitIds ?? [],
        startsAt: item.startsAt !== undefined ? item.startsAt : existing?.startsAt,
        endsAt: item.endsAt !== undefined ? item.endsAt : existing?.endsAt,
      });

      const def: RegisteredFeatureFlagDefinition = {
        id: assignedId,
        key,
        module: moduleName,
        name: item.name.trim(),
        description: item.description.trim(),
        isEnabled: existing?.isEnabled ?? Boolean(item.isEnabled ?? false),
        rolloutPercentage: validated.rolloutPercentage,
        targetUserIds: validated.targetUserIds,
        targetRoles: validated.targetRoles,
        targetOrganizationUnitIds: validated.targetOrganizationUnitIds,
        startsAt: validated.startsAt,
        endsAt: validated.endsAt,
        metadata: item.metadata ?? existing?.metadata ?? null,
        isSystem: item.isSystem ?? existing?.isSystem ?? true,
        status:
          item.status === FEATURE_FLAG_STATUS.ARCHIVED
            ? FEATURE_FLAG_STATUS.ARCHIVED
            : FEATURE_FLAG_STATUS.ACTIVE,
        updatedBy: existing?.updatedBy ?? null,
        updatedAt: existing?.updatedAt ?? new Date().toISOString(),
      };

      this.definitions.set(key, def);
      if (
        FeatureFlagRegistryService.sharedInstance &&
        FeatureFlagRegistryService.sharedInstance !== this
      ) {
        FeatureFlagRegistryService.sharedInstance.definitions.set(key, def);
      }
    }
  }

  public upsertDefinition(def: RegisteredFeatureFlagDefinition): RegisteredFeatureFlagDefinition {
    const key = def.key.trim().toLowerCase();
    const existing = this.definitions.get(key);
    const assignedId = def.id !== undefined ? Number(def.id) : (existing?.id ?? this.nextId++);
    if (assignedId >= this.nextId) {
      this.nextId = assignedId + 1;
    }

    const normalized: RegisteredFeatureFlagDefinition = {
      ...def,
      id: assignedId,
      key,
      module: def.module.trim().toLowerCase(),
      targetUserIds: Array.from(
        new Set(def.targetUserIds.map((id) => String(id).trim()).filter(Boolean)),
      ),
      targetRoles: Array.from(
        new Set(def.targetRoles.map((r) => String(r).trim().toUpperCase()).filter(Boolean)),
      ),
      targetOrganizationUnitIds: Array.from(
        new Set(def.targetOrganizationUnitIds.map((id) => String(id).trim()).filter(Boolean)),
      ),
    };

    this.definitions.set(key, normalized);
    if (
      FeatureFlagRegistryService.sharedInstance &&
      FeatureFlagRegistryService.sharedInstance !== this
    ) {
      FeatureFlagRegistryService.sharedInstance.definitions.set(key, normalized);
    }

    for (const listener of this.listeners) {
      try {
        void listener({
          key: normalized.key,
          module: normalized.module,
          isEnabled: normalized.isEnabled,
        });
      } catch {
        // Ignore listener errors
      }
    }

    return normalized;
  }

  public getDefinition(key: string): RegisteredFeatureFlagDefinition | undefined {
    return this.definitions.get(key.trim().toLowerCase());
  }

  public listDefinitions(filter?: {
    module?: string | undefined;
    isEnabled?: boolean | undefined;
    status?: number | undefined;
  }): RegisteredFeatureFlagDefinition[] {
    let items = [...this.definitions.values()];
    if (filter?.module?.trim()) {
      const m = filter.module.trim().toLowerCase();
      items = items.filter((d) => d.module.toLowerCase() === m);
    }
    if (filter?.isEnabled !== undefined) {
      items = items.filter((d) => d.isEnabled === filter.isEnabled);
    }
    if (filter?.status !== undefined) {
      items = items.filter((d) => d.status === filter.status);
    }
    return items.sort((a, b) => a.module.localeCompare(b.module) || a.key.localeCompare(b.key));
  }

  /**
   * Đánh giá chi tiết một Feature Flag theo ngữ cảnh (Mục 5.2.2 -> 5.2.7).
   */
  public evaluate(
    key: string,
    context?: FeatureFlagEvaluationContext,
    fromCache = false,
  ): FeatureFlagEvaluationResult {
    const normKey = key.trim().toLowerCase();
    const def = this.definitions.get(normKey);
    const nowMs =
      context?.at !== undefined && context?.at !== null
        ? context.at instanceof Date
          ? context.at.getTime()
          : typeof context.at === 'number'
            ? context.at
            : Date.parse(String(context.at))
        : Date.now();
    const evaluatedAt = new Date(Number.isNaN(nowMs) ? Date.now() : nowMs).toISOString();

    if (!def) {
      const inferredModule = normKey.split('.')[0] || 'unknown';
      return {
        key: normKey,
        module: inferredModule,
        enabled: false,
        reason: 'FLAG_NOT_FOUND',
        rolloutPercentage: 0,
        userBucket: null,
        startsAt: null,
        endsAt: null,
        evaluatedAt,
        fromCache,
      };
    }

    // 5.2.2: Không dùng flag thay cho việc cài module — module phải có trong enabledModules
    if (!this.isModuleInstalled(def.module)) {
      return {
        key: def.key,
        module: def.module,
        enabled: false,
        reason: 'MODULE_NOT_INSTALLED',
        rolloutPercentage: def.rolloutPercentage,
        userBucket: null,
        startsAt: def.startsAt,
        endsAt: def.endsAt,
        evaluatedAt,
        fromCache,
      };
    }

    if (!def.isEnabled || def.status === FEATURE_FLAG_STATUS.ARCHIVED) {
      return {
        key: def.key,
        module: def.module,
        enabled: false,
        reason: 'FLAG_DISABLED',
        rolloutPercentage: def.rolloutPercentage,
        userBucket: null,
        startsAt: def.startsAt,
        endsAt: def.endsAt,
        evaluatedAt,
        fromCache,
      };
    }

    // 5.2.7: Kiểm tra thời gian bắt đầu và kết thúc (Tự động đóng tính năng thử nghiệm khi hết hạn)
    if (def.startsAt && nowMs < Date.parse(def.startsAt)) {
      return {
        key: def.key,
        module: def.module,
        enabled: false,
        reason: 'NOT_STARTED',
        rolloutPercentage: def.rolloutPercentage,
        userBucket: null,
        startsAt: def.startsAt,
        endsAt: def.endsAt,
        evaluatedAt,
        fromCache,
      };
    }

    if (def.endsAt && nowMs > Date.parse(def.endsAt)) {
      return {
        key: def.key,
        module: def.module,
        enabled: false,
        reason: 'EXPIRED',
        rolloutPercentage: def.rolloutPercentage,
        userBucket: null,
        startsAt: def.startsAt,
        endsAt: def.endsAt,
        evaluatedAt,
        fromCache,
      };
    }

    // 5.2.3: Bật theo người dùng (targetUserIds)
    const hasUserTargets = def.targetUserIds.length > 0;
    if (hasUserTargets && context?.userId !== undefined && context?.userId !== null) {
      const normalizedUserId = String(context.userId).trim().toLowerCase();
      if (def.targetUserIds.some((u) => u.toLowerCase() === normalizedUserId)) {
        return {
          key: def.key,
          module: def.module,
          enabled: true,
          reason: 'TARGET_USER_MATCH',
          rolloutPercentage: def.rolloutPercentage,
          userBucket: null,
          startsAt: def.startsAt,
          endsAt: def.endsAt,
          evaluatedAt,
          fromCache,
        };
      }
    }

    // 5.2.4: Bật theo vai trò (targetRoles)
    const hasRoleTargets = def.targetRoles.length > 0;
    if (hasRoleTargets && Array.isArray(context?.roles) && context.roles.length > 0) {
      const normalizedRoles = context.roles.map((r) => String(r).trim().toUpperCase());
      if (normalizedRoles.some((r) => def.targetRoles.includes(r))) {
        return {
          key: def.key,
          module: def.module,
          enabled: true,
          reason: 'TARGET_ROLE_MATCH',
          rolloutPercentage: def.rolloutPercentage,
          userBucket: null,
          startsAt: def.startsAt,
          endsAt: def.endsAt,
          evaluatedAt,
          fromCache,
        };
      }
    }

    // 5.2.5: Bật theo đơn vị (targetOrganizationUnitIds)
    const hasUnitTargets = def.targetOrganizationUnitIds.length > 0;
    if (hasUnitTargets) {
      const candidateUnitIds = new Set<string>();
      if (context?.organizationUnitId !== undefined && context?.organizationUnitId !== null) {
        candidateUnitIds.add(String(context.organizationUnitId).trim().toLowerCase());
      }
      if (Array.isArray(context?.organizationUnitIds)) {
        for (const uid of context.organizationUnitIds) {
          if (uid !== undefined && uid !== null) {
            candidateUnitIds.add(String(uid).trim().toLowerCase());
          }
        }
      }
      if (
        [...candidateUnitIds].some((uid) =>
          def.targetOrganizationUnitIds.some((t) => t.toLowerCase() === uid),
        )
      ) {
        return {
          key: def.key,
          module: def.module,
          enabled: true,
          reason: 'TARGET_ORG_UNIT_MATCH',
          rolloutPercentage: def.rolloutPercentage,
          userBucket: null,
          startsAt: def.startsAt,
          endsAt: def.endsAt,
          evaluatedAt,
          fromCache,
        };
      }
    }

    const hasAnyTargetFilter = hasUserTargets || hasRoleTargets || hasUnitTargets;

    if (hasAnyTargetFilter) {
      return {
        key: def.key,
        module: def.module,
        enabled: false,
        reason: 'TARGET_MISMATCH',
        rolloutPercentage: def.rolloutPercentage,
        userBucket: null,
        startsAt: def.startsAt,
        endsAt: def.endsAt,
        evaluatedAt,
        fromCache,
      };
    }

    // 5.2.6: Bật theo tỷ lệ người dùng (rolloutPercentage 0..100%)
    if (def.rolloutPercentage >= 100) {
      return {
        key: def.key,
        module: def.module,
        enabled: true,
        reason: 'ENABLED_ALL',
        rolloutPercentage: 100,
        userBucket: null,
        startsAt: def.startsAt,
        endsAt: def.endsAt,
        evaluatedAt,
        fromCache,
      };
    }

    if (def.rolloutPercentage <= 0) {
      return {
        key: def.key,
        module: def.module,
        enabled: false,
        reason: 'ROLLOUT_EXCLUDED',
        rolloutPercentage: 0,
        userBucket: null,
        startsAt: def.startsAt,
        endsAt: def.endsAt,
        evaluatedAt,
        fromCache,
      };
    }

    const identifier =
      context?.userId ??
      context?.organizationUnitId ??
      (context?.roles && context.roles.length > 0 ? context.roles[0]! : 'anonymous');
    const userBucket = computeFeatureFlagRolloutBucket(def.key, identifier);

    if (userBucket < def.rolloutPercentage) {
      return {
        key: def.key,
        module: def.module,
        enabled: true,
        reason: 'ROLLOUT_MATCH',
        rolloutPercentage: def.rolloutPercentage,
        userBucket,
        startsAt: def.startsAt,
        endsAt: def.endsAt,
        evaluatedAt,
        fromCache,
      };
    }

    return {
      key: def.key,
      module: def.module,
      enabled: false,
      reason: 'ROLLOUT_EXCLUDED',
      rolloutPercentage: def.rolloutPercentage,
      userBucket,
      startsAt: def.startsAt,
      endsAt: def.endsAt,
      evaluatedAt,
      fromCache,
    };
  }

  /** Hàm kiểm tra nhanh boolean cho các module nghiệp vụ */
  public isEnabled(key: string, context?: FeatureFlagEvaluationContext): boolean {
    return this.evaluate(key, context).enabled;
  }
}

export const defaultFeatureFlagRegistry = new FeatureFlagRegistryService();
