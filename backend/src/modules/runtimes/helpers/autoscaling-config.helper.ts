import type { CoreConfigService } from '@packages/config/index.js';
import { SettingRegistryService, defaultSettingRegistry } from '@packages/kernel/index.js';
import type { AutoscalingWorkloadPolicy } from '@packages/runtime/index.js';
import { AUTOSCALING_SETTING_KEYS as K } from '../constants/autoscaling.constants.js';

export interface ResolvedAutoscalingConfig {
  readonly enabled: boolean;
  readonly tolerancePercent: number;
  readonly api: AutoscalingWorkloadPolicy;
  readonly worker: AutoscalingWorkloadPolicy;
  readonly database: {
    readonly maxConnectionsBudget: number;
    readonly warnUtilizationPercent: number;
  };
  /** Danh sách khóa đang được override động trong `system_settings` (khác giá trị default manifest). */
  readonly overriddenKeys: readonly string[];
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isExplicitSettingOverride(
  registry: SettingRegistryService,
  key: string,
  resolved: NonNullable<ReturnType<SettingRegistryService['resolve']>>,
): boolean {
  const src = resolved.resolvedSource.toUpperCase();
  if (src === 'DEFAULT') return false;
  if (src === 'UNIT_ENV' || src === 'UNIT_ALL' || src === 'GLOBAL_ENV') return true;
  const def = registry.getDefinition(key);
  if (def && def.updatedBy !== null && def.updatedBy !== undefined) return true;
  return resolved.value !== resolved.defaultValue;
}

function readDynamicNumber(
  registry: SettingRegistryService,
  key: string,
  envFallback: number,
  min: number,
  max: number,
  overridden: string[],
): number {
  const resolved = registry.resolve<number>(key, undefined, { maskSensitive: false });
  if (
    resolved &&
    isExplicitSettingOverride(registry, key, resolved) &&
    typeof resolved.value === 'number' &&
    Number.isFinite(resolved.value)
  ) {
    overridden.push(key);
    return clampInt(resolved.value, min, max);
  }
  return clampInt(envFallback, min, max);
}

function readDynamicBoolean(
  registry: SettingRegistryService,
  key: string,
  envFallback: boolean,
  overridden: string[],
): boolean {
  const resolved = registry.resolve<boolean>(key, undefined, { maskSensitive: false });
  if (
    resolved &&
    isExplicitSettingOverride(registry, key, resolved) &&
    typeof resolved.value === 'boolean'
  ) {
    overridden.push(key);
    return resolved.value;
  }
  return envFallback;
}

/**
 * Hợp nhất cấu hình Autoscaling từ `.env` (`CoreConfigService.runtime.autoscaling`)
 * và override động trong `SettingRegistryService` (`system_settings`).
 * Giá trị DB chỉ ghi đè `.env` khi đã được thiết lập tường minh (`resolvedSource !== 'DEFAULT'`).
 */
export function resolveAutoscalingConfig(
  config: CoreConfigService,
  settingRegistry: SettingRegistryService = defaultSettingRegistry,
): ResolvedAutoscalingConfig {
  const base = config.runtime.autoscaling;
  const overridden: string[] = [];

  const apiMin = readDynamicNumber(
    settingRegistry,
    K.API_MIN_REPLICAS,
    base.api.minReplicas,
    1,
    200,
    overridden,
  );
  const apiMaxRaw = readDynamicNumber(
    settingRegistry,
    K.API_MAX_REPLICAS,
    base.api.maxReplicas,
    1,
    500,
    overridden,
  );
  const apiMax = Math.max(apiMin, apiMaxRaw);

  const workerMin = readDynamicNumber(
    settingRegistry,
    K.WORKER_MIN_REPLICAS,
    base.worker.minReplicas,
    1,
    200,
    overridden,
  );
  const workerMaxRaw = readDynamicNumber(
    settingRegistry,
    K.WORKER_MAX_REPLICAS,
    base.worker.maxReplicas,
    1,
    500,
    overridden,
  );
  const workerMax = Math.max(workerMin, workerMaxRaw);

  return {
    enabled: readDynamicBoolean(settingRegistry, K.ENABLED, base.enabled, overridden),
    tolerancePercent: readDynamicNumber(
      settingRegistry,
      K.TOLERANCE_PERCENT,
      base.tolerancePercent,
      0,
      50,
      overridden,
    ),
    api: {
      minReplicas: apiMin,
      maxReplicas: apiMax,
      scaleUpCooldownSec: readDynamicNumber(
        settingRegistry,
        K.API_SCALE_UP_COOLDOWN_SEC,
        base.api.scaleUpCooldownSec,
        0,
        3600,
        overridden,
      ),
      scaleDownCooldownSec: readDynamicNumber(
        settingRegistry,
        K.API_SCALE_DOWN_COOLDOWN_SEC,
        base.api.scaleDownCooldownSec,
        0,
        7200,
        overridden,
      ),
      scaleUpMaxStep: readDynamicNumber(
        settingRegistry,
        K.API_SCALE_UP_MAX_STEP,
        base.api.scaleUpMaxStep,
        1,
        50,
        overridden,
      ),
      scaleDownMaxStep: readDynamicNumber(
        settingRegistry,
        K.API_SCALE_DOWN_MAX_STEP,
        base.api.scaleDownMaxStep,
        1,
        50,
        overridden,
      ),
      targetCpuPercent: readDynamicNumber(
        settingRegistry,
        K.API_TARGET_CPU_PERCENT,
        base.api.targetCpuPercent,
        10,
        95,
        overridden,
      ),
      targetMemoryPercent: readDynamicNumber(
        settingRegistry,
        K.API_TARGET_MEMORY_PERCENT,
        base.api.targetMemoryPercent,
        10,
        95,
        overridden,
      ),
      targetInFlightPerInstance: readDynamicNumber(
        settingRegistry,
        K.API_TARGET_IN_FLIGHT,
        base.api.targetInFlightPerInstance,
        1,
        100_000,
        overridden,
      ),
    },
    worker: {
      minReplicas: workerMin,
      maxReplicas: workerMax,
      scaleUpCooldownSec: readDynamicNumber(
        settingRegistry,
        K.WORKER_SCALE_UP_COOLDOWN_SEC,
        base.worker.scaleUpCooldownSec,
        0,
        3600,
        overridden,
      ),
      scaleDownCooldownSec: readDynamicNumber(
        settingRegistry,
        K.WORKER_SCALE_DOWN_COOLDOWN_SEC,
        base.worker.scaleDownCooldownSec,
        0,
        7200,
        overridden,
      ),
      scaleUpMaxStep: readDynamicNumber(
        settingRegistry,
        K.WORKER_SCALE_UP_MAX_STEP,
        base.worker.scaleUpMaxStep,
        1,
        50,
        overridden,
      ),
      scaleDownMaxStep: readDynamicNumber(
        settingRegistry,
        K.WORKER_SCALE_DOWN_MAX_STEP,
        base.worker.scaleDownMaxStep,
        1,
        50,
        overridden,
      ),
      targetCpuPercent: readDynamicNumber(
        settingRegistry,
        K.WORKER_TARGET_CPU_PERCENT,
        base.worker.targetCpuPercent,
        10,
        95,
        overridden,
      ),
      targetMemoryPercent: readDynamicNumber(
        settingRegistry,
        K.WORKER_TARGET_MEMORY_PERCENT,
        base.worker.targetMemoryPercent,
        10,
        95,
        overridden,
      ),
      targetBacklogPerInstance: readDynamicNumber(
        settingRegistry,
        K.WORKER_TARGET_BACKLOG,
        base.worker.targetBacklogPerInstance,
        1,
        1_000_000,
        overridden,
      ),
    },
    database: {
      maxConnectionsBudget: readDynamicNumber(
        settingRegistry,
        K.DB_MAX_CONNECTIONS_BUDGET,
        base.database.maxConnectionsBudget,
        10,
        100_000,
        overridden,
      ),
      warnUtilizationPercent: readDynamicNumber(
        settingRegistry,
        K.DB_WARN_UTILIZATION_PERCENT,
        base.database.warnUtilizationPercent,
        10,
        100,
        overridden,
      ),
    },
    overriddenKeys: overridden,
  };
}
