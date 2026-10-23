import {
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
  discoverInstalledModules,
} from '@packages/kernel/index.js';
import {
  NOTIFICATIONS_FEATURE_FLAG_KEYS,
  NOTIFICATIONS_SETTING_KEYS,
  type NotificationChannelName,
} from '../enum/notifications.enum.js';
import type {
  DefaultCategoryChannelMatrix,
  ResolvedNotificationRuntimeConfig,
} from '../types/notifications.types.js';

export const DEFAULT_NOTIFICATION_PREFERENCE_MATRIX: DefaultCategoryChannelMatrix = {
  SYSTEM: { inApp: true, email: true, sms: false, push: true },
  WORK: { inApp: true, email: true, sms: false, push: true },
  SECURITY: { inApp: true, email: true, sms: true, push: true },
  ANNOUNCEMENT: { inApp: true, email: false, sms: false, push: true },
};

const VALID_CHANNEL_NAMES = new Set<NotificationChannelName>(['IN_APP', 'EMAIL', 'SMS', 'PUSH']);

function normalizeChannelNameList(
  raw: unknown,
  fallback: readonly NotificationChannelName[],
): NotificationChannelName[] {
  if (!Array.isArray(raw)) return [...fallback];
  const result: NotificationChannelName[] = [];
  for (const item of raw) {
    const norm = String(item ?? '')
      .trim()
      .toUpperCase() as NotificationChannelName;
    if (VALID_CHANNEL_NAMES.has(norm) && !result.includes(norm)) {
      result.push(norm);
    }
  }
  return result.length > 0 ? result : [...fallback];
}

function normalizeDefaultPreferenceMatrix(raw: unknown): DefaultCategoryChannelMatrix {
  const result: DefaultCategoryChannelMatrix = {
    SYSTEM: { ...DEFAULT_NOTIFICATION_PREFERENCE_MATRIX.SYSTEM! },
    WORK: { ...DEFAULT_NOTIFICATION_PREFERENCE_MATRIX.WORK! },
    SECURITY: { ...DEFAULT_NOTIFICATION_PREFERENCE_MATRIX.SECURITY! },
    ANNOUNCEMENT: { ...DEFAULT_NOTIFICATION_PREFERENCE_MATRIX.ANNOUNCEMENT! },
  };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return result;
  }

  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
    const catKey = key.trim().toUpperCase();
    const record = val as Record<string, unknown>;
    const base = result[catKey] ?? { inApp: true, email: true, sms: false, push: true };
    result[catKey] = {
      inApp: typeof record.inApp === 'boolean' ? record.inApp : base.inApp,
      email: typeof record.email === 'boolean' ? record.email : base.email,
      sms: typeof record.sms === 'boolean' ? record.sms : base.sms,
      push: typeof record.push === 'boolean' ? record.push : base.push,
    };
  }

  return result;
}

export function resolveNotificationRuntimeConfig(
  organizationUnitId?: number | null,
  actorContext?: {
    userId?: number | string | null;
    roles?: readonly string[];
  },
): ResolvedNotificationRuntimeConfig {
  const settingCtx =
    organizationUnitId !== undefined && organizationUnitId !== null
      ? { organizationUnitId: Number(organizationUnitId) }
      : undefined;

  const flagCtx = {
    ...(actorContext?.userId !== undefined && actorContext?.userId !== null
      ? { userId: String(actorContext.userId) }
      : {}),
    ...(actorContext?.roles ? { roles: actorContext.roles } : {}),
    ...(organizationUnitId !== undefined && organizationUnitId !== null
      ? { organizationUnitIds: [String(organizationUnitId)] }
      : {}),
  };

  const registryModules = defaultFeatureFlagRegistry.getInstalledModules();
  const activeInstalledModules =
    registryModules.length > 0 ? registryModules : discoverInstalledModules();
  const installedModules = new Set(activeInstalledModules.map((m) => m.trim().toLowerCase()));
  const orgUnitModuleInstalled = installedModules.has('organizations');

  const enabled = defaultSettingRegistry.getBoolean(
    NOTIFICATIONS_SETTING_KEYS.ENABLED,
    settingCtx,
    true,
  );
  const inAppFeatureEnabled = defaultFeatureFlagRegistry.isEnabled(
    NOTIFICATIONS_FEATURE_FLAG_KEYS.IN_APP_ENABLED,
    flagCtx,
  );

  const orgUnitTargetingEnabled = defaultSettingRegistry.getBoolean(
    NOTIFICATIONS_SETTING_KEYS.ORG_UNIT_TARGETING_ENABLED,
    settingCtx,
    true,
  );
  const orgUnitBroadcastFlagEnabled = defaultFeatureFlagRegistry.isEnabled(
    NOTIFICATIONS_FEATURE_FLAG_KEYS.ORG_UNIT_BROADCAST,
    flagCtx,
  );
  const orgUnitIncludeSubUnitsDefault = defaultSettingRegistry.getBoolean(
    NOTIFICATIONS_SETTING_KEYS.ORG_UNIT_INCLUDE_SUB_UNITS_DEFAULT,
    settingCtx,
    true,
  );

  const roleTargetingEnabled = defaultSettingRegistry.getBoolean(
    NOTIFICATIONS_SETTING_KEYS.ROLE_TARGETING_ENABLED,
    settingCtx,
    true,
  );
  const roleBroadcastFlagEnabled = defaultFeatureFlagRegistry.isEnabled(
    NOTIFICATIONS_FEATURE_FLAG_KEYS.ROLE_BROADCAST,
    flagCtx,
  );

  const allowUserCustomization = defaultSettingRegistry.getBoolean(
    NOTIFICATIONS_SETTING_KEYS.ALLOW_USER_CUSTOMIZATION,
    settingCtx,
    true,
  );
  const userPreferencesFlagEnabled = defaultFeatureFlagRegistry.isEnabled(
    NOTIFICATIONS_FEATURE_FLAG_KEYS.USER_PREFERENCES,
    flagCtx,
  );
  const lockSecurityInApp = defaultSettingRegistry.getBoolean(
    NOTIFICATIONS_SETTING_KEYS.LOCK_SECURITY_IN_APP,
    settingCtx,
    true,
  );

  const autoReadOnOpen = defaultSettingRegistry.getBoolean(
    NOTIFICATIONS_SETTING_KEYS.AUTO_READ_ON_OPEN,
    settingCtx,
    true,
  );
  const retentionDays = defaultSettingRegistry.getNumber(
    NOTIFICATIONS_SETTING_KEYS.RETENTION_DAYS,
    settingCtx,
    90,
  );
  const pollingIntervalSec = defaultSettingRegistry.getNumber(
    NOTIFICATIONS_SETTING_KEYS.POLLING_INTERVAL_SEC,
    settingCtx,
    30,
  );
  const maxRecipientsPerBatch = defaultSettingRegistry.getNumber(
    NOTIFICATIONS_SETTING_KEYS.MAX_RECIPIENTS_PER_BATCH,
    settingCtx,
    5000,
  );
  const maxTitleLength = defaultSettingRegistry.getNumber(
    NOTIFICATIONS_SETTING_KEYS.MAX_TITLE_LENGTH,
    settingCtx,
    255,
  );
  const maxBodyLength = defaultSettingRegistry.getNumber(
    NOTIFICATIONS_SETTING_KEYS.MAX_BODY_LENGTH,
    settingCtx,
    5000,
  );
  const paginationDefaultPageSize = defaultSettingRegistry.getNumber(
    NOTIFICATIONS_SETTING_KEYS.PAGINATION_DEFAULT_PAGE_SIZE,
    settingCtx,
    20,
  );
  const paginationMaxPageSize = defaultSettingRegistry.getNumber(
    NOTIFICATIONS_SETTING_KEYS.PAGINATION_MAX_PAGE_SIZE,
    settingCtx,
    100,
  );

  const rawEnabledChannels = defaultSettingRegistry.getJson<unknown>(
    NOTIFICATIONS_SETTING_KEYS.CHANNELS_ENABLED,
    settingCtx,
    ['IN_APP', 'EMAIL', 'SMS', 'PUSH'],
  );
  const enabledChannels = normalizeChannelNameList(rawEnabledChannels, [
    'IN_APP',
    'EMAIL',
    'SMS',
    'PUSH',
  ]);

  const rawDefaultChannels = defaultSettingRegistry.getJson<unknown>(
    NOTIFICATIONS_SETTING_KEYS.CHANNELS_DEFAULT,
    settingCtx,
    ['IN_APP'],
  );
  const defaultChannels = normalizeChannelNameList(rawDefaultChannels, ['IN_APP']).filter((c) =>
    enabledChannels.includes(c),
  );

  const rawDefaultMatrix = defaultSettingRegistry.getJson<unknown>(
    NOTIFICATIONS_SETTING_KEYS.DEFAULT_PREFERENCE_MATRIX,
    settingCtx,
    DEFAULT_NOTIFICATION_PREFERENCE_MATRIX,
  );
  const defaultPreferenceMatrix = normalizeDefaultPreferenceMatrix(rawDefaultMatrix);

  return {
    enabled,
    inAppFeatureEnabled,
    orgUnitModuleInstalled,
    orgUnitTargetingEnabled,
    orgUnitBroadcastFlagEnabled,
    orgUnitIncludeSubUnitsDefault,
    roleTargetingEnabled,
    roleBroadcastFlagEnabled,
    allowUserCustomization,
    userPreferencesFlagEnabled,
    lockSecurityInApp,
    autoReadOnOpen,
    retentionDays,
    pollingIntervalSec,
    maxRecipientsPerBatch,
    maxTitleLength,
    maxBodyLength,
    paginationDefaultPageSize,
    paginationMaxPageSize,
    enabledChannels,
    defaultChannels: defaultChannels.length > 0 ? defaultChannels : ['IN_APP'],
    defaultPreferenceMatrix,
  };
}
