import { Injectable } from '@nestjs/common';
import { discoverInstalledModules } from '../contracts/manifest.contract.js';
import {
  FEATURE_FLAG_STATUS,
  computeFeatureFlagRolloutBucket,
  discoverManifestFeatureFlags,
  validateFeatureFlagRules,
  type FeatureFlagChangeListener,
  type FeatureFlagEvaluationContext,
  type FeatureFlagEvaluationReason,
  type FeatureFlagEvaluationResult,
  type FeatureFlagManifestItem,
  type RegisteredFeatureFlagDefinition,
} from '../contracts/feature-flag.contract.js';

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
    const nowMs = this.resolveEvaluationTimestampMs(context?.at);
    const evaluatedAt = new Date(nowMs).toISOString();

    if (!def) {
      return {
        key: normKey,
        module: normKey.split('.')[0] || 'unknown',
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

    const prerequisiteFailure = this.checkFlagPrerequisites(def, nowMs);
    if (prerequisiteFailure) {
      return this.buildEvaluationResult(
        def,
        false,
        prerequisiteFailure,
        null,
        evaluatedAt,
        fromCache,
      );
    }

    const targetDecision = this.evaluateTargetFilters(def, context);
    if (targetDecision.matchedReason) {
      return this.buildEvaluationResult(
        def,
        true,
        targetDecision.matchedReason,
        null,
        evaluatedAt,
        fromCache,
      );
    }
    if (targetDecision.hasAnyFilter) {
      return this.buildEvaluationResult(
        def,
        false,
        'TARGET_MISMATCH',
        null,
        evaluatedAt,
        fromCache,
      );
    }

    return this.evaluateRolloutPercentage(def, context, evaluatedAt, fromCache);
  }

  /** Hàm kiểm tra nhanh boolean cho các module nghiệp vụ */
  public isEnabled(key: string, context?: FeatureFlagEvaluationContext): boolean {
    return this.evaluate(key, context).enabled;
  }

  private resolveEvaluationTimestampMs(at?: Date | string | number | null): number {
    if (at === undefined || at === null) return Date.now();
    const rawMs =
      at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(String(at));
    return Number.isNaN(rawMs) ? Date.now() : rawMs;
  }

  private checkFlagPrerequisites(
    def: RegisteredFeatureFlagDefinition,
    nowMs: number,
  ): FeatureFlagEvaluationReason | null {
    if (!this.isModuleInstalled(def.module)) {
      return 'MODULE_NOT_INSTALLED';
    }
    if (!def.isEnabled || def.status === FEATURE_FLAG_STATUS.ARCHIVED) {
      return 'FLAG_DISABLED';
    }
    if (def.startsAt && nowMs < Date.parse(def.startsAt)) {
      return 'NOT_STARTED';
    }
    if (def.endsAt && nowMs > Date.parse(def.endsAt)) {
      return 'EXPIRED';
    }
    return null;
  }

  private evaluateTargetFilters(
    def: RegisteredFeatureFlagDefinition,
    context?: FeatureFlagEvaluationContext,
  ): {
    hasAnyFilter: boolean;
    matchedReason: FeatureFlagEvaluationReason | null;
  } {
    const hasUserTargets = def.targetUserIds.length > 0;
    if (hasUserTargets && context?.userId !== undefined && context?.userId !== null) {
      const normalizedUserId = String(context.userId).trim().toLowerCase();
      if (def.targetUserIds.some((u) => u.toLowerCase() === normalizedUserId)) {
        return { hasAnyFilter: true, matchedReason: 'TARGET_USER_MATCH' };
      }
    }

    const hasRoleTargets = def.targetRoles.length > 0;
    if (hasRoleTargets && Array.isArray(context?.roles) && context.roles.length > 0) {
      const normalizedRoles = context.roles.map((r) => String(r).trim().toUpperCase());
      if (normalizedRoles.some((r) => def.targetRoles.includes(r))) {
        return { hasAnyFilter: true, matchedReason: 'TARGET_ROLE_MATCH' };
      }
    }

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
        return { hasAnyFilter: true, matchedReason: 'TARGET_ORG_UNIT_MATCH' };
      }
    }

    return {
      hasAnyFilter: hasUserTargets || hasRoleTargets || hasUnitTargets,
      matchedReason: null,
    };
  }

  private evaluateRolloutPercentage(
    def: RegisteredFeatureFlagDefinition,
    context: FeatureFlagEvaluationContext | undefined,
    evaluatedAt: string,
    fromCache: boolean,
  ): FeatureFlagEvaluationResult {
    if (def.rolloutPercentage >= 100) {
      return {
        ...this.buildEvaluationResult(def, true, 'ENABLED_ALL', null, evaluatedAt, fromCache),
        rolloutPercentage: 100,
      };
    }

    if (def.rolloutPercentage <= 0) {
      return {
        ...this.buildEvaluationResult(def, false, 'ROLLOUT_EXCLUDED', null, evaluatedAt, fromCache),
        rolloutPercentage: 0,
      };
    }

    const identifier =
      context?.userId ??
      context?.organizationUnitId ??
      (context?.roles && context.roles.length > 0 ? context.roles[0]! : 'anonymous');
    const userBucket = computeFeatureFlagRolloutBucket(def.key, identifier);
    const matched = userBucket < def.rolloutPercentage;

    return this.buildEvaluationResult(
      def,
      matched,
      matched ? 'ROLLOUT_MATCH' : 'ROLLOUT_EXCLUDED',
      userBucket,
      evaluatedAt,
      fromCache,
    );
  }

  private buildEvaluationResult(
    def: RegisteredFeatureFlagDefinition,
    enabled: boolean,
    reason: FeatureFlagEvaluationReason,
    userBucket: number | null,
    evaluatedAt: string,
    fromCache: boolean,
  ): FeatureFlagEvaluationResult {
    return {
      key: def.key,
      module: def.module,
      enabled,
      reason,
      rolloutPercentage: def.rolloutPercentage,
      userBucket,
      startsAt: def.startsAt,
      endsAt: def.endsAt,
      evaluatedAt,
      fromCache,
    };
  }
}

export const defaultFeatureFlagRegistry = new FeatureFlagRegistryService();
