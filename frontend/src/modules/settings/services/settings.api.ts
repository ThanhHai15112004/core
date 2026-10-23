import { fetchApi } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/api.routes';
import type {
  FeatureFlagEvaluationResult,
  FeatureFlagHistoryRecord,
  FeatureFlagSummary,
  I18nLocaleSummary,
  I18nTimezoneSummary,
  I18nTranslationSummary,
  MenuSummary,
  MenuTreeEvaluationResult,
  SequenceGeneratedResult,
  SequencePreviewResult,
  SequenceRuleSummary,
  SettingGroupSummary,
  SettingHistoryRecord,
  SettingValidationRules,
  SyncSettingsResult,
  SystemSettingSummary,
} from '../types/settings.types';

function toQueryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      sp.set(k, String(v));
    }
  }
  return sp.toString();
}

export const settingsApi = {
  // 1. System Settings
  syncSettingsManifests(): Promise<SyncSettingsResult> {
    return fetchApi<SyncSettingsResult>(API_ROUTES.SETTINGS.SYNC, { method: 'POST' });
  },

  listGroups(params?: { module?: string; q?: string }): Promise<SettingGroupSummary[]> {
    return fetchApi<SettingGroupSummary[]>(
      API_ROUTES.SETTINGS.GROUPS(toQueryString(params ?? {})),
    );
  },

  createGroup(payload: {
    code: string;
    module?: string;
    name: string;
    description?: string | null;
    icon?: string | null;
    sortOrder?: number;
  }): Promise<SettingGroupSummary> {
    return fetchApi<SettingGroupSummary>(API_ROUTES.SETTINGS.GROUPS(), {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  listSettings(params?: {
    groupCode?: string;
    module?: string;
    namespace?: string;
    valueType?: number | string;
    isSensitive?: boolean;
    environment?: string;
    organizationUnitId?: number;
    q?: string;
  }): Promise<SystemSettingSummary[]> {
    return fetchApi<SystemSettingSummary[]>(
      API_ROUTES.SETTINGS.LIST(toQueryString(params ?? {})),
    );
  },

  createSetting(payload: {
    key: string;
    groupCode: string;
    module?: string;
    namespace?: string;
    name: string;
    description?: string | null;
    valueType: number | string;
    defaultValue: unknown;
    value?: unknown;
    validationRules?: SettingValidationRules | null;
    isSensitive?: boolean;
    allowUnitOverride?: boolean;
    reason?: string | null;
  }): Promise<SystemSettingSummary> {
    return fetchApi<SystemSettingSummary>(API_ROUTES.SETTINGS.CREATE, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateSettingValue(
    key: string,
    payload: {
      value: unknown;
      environment?: string;
      organizationUnitId?: number | null;
      name?: string;
      description?: string | null;
      allowUnitOverride?: boolean;
      reason?: string | null;
    },
  ): Promise<SystemSettingSummary> {
    return fetchApi<SystemSettingSummary>(API_ROUTES.SETTINGS.DETAIL(key), {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  removeScopeOverride(
    key: string,
    params: { environment?: string; organizationUnitId?: number; reason?: string },
  ): Promise<SystemSettingSummary> {
    return fetchApi<SystemSettingSummary>(
      API_ROUTES.SETTINGS.KEY_SCOPES(key, toQueryString(params)),
      { method: 'DELETE' },
    );
  },

  listSettingHistory(params?: {
    settingKey?: string;
    environment?: string;
    organizationUnitId?: number;
    limit?: number;
  }): Promise<SettingHistoryRecord[]> {
    return fetchApi<SettingHistoryRecord[]>(
      API_ROUTES.SETTINGS.HISTORY(toQueryString(params ?? {})),
    );
  },

  // 2. Feature Flags
  syncFeatureFlags(): Promise<{ syncedModules: string[]; totalFlags: number }> {
    return fetchApi<{ syncedModules: string[]; totalFlags: number }>(
      API_ROUTES.SETTINGS.FEATURE_FLAGS.SYNC,
      { method: 'POST' },
    );
  },

  listFeatureFlags(params?: {
    module?: string;
    isEnabled?: boolean;
    q?: string;
  }): Promise<FeatureFlagSummary[]> {
    return fetchApi<FeatureFlagSummary[]>(
      API_ROUTES.SETTINGS.FEATURE_FLAGS.LIST(toQueryString(params ?? {})),
    );
  },

  createFeatureFlag(payload: {
    key: string;
    module?: string;
    name: string;
    description: string;
    isEnabled?: boolean;
    rolloutPercentage?: number;
    targetUserIds?: string[];
    targetRoles?: string[];
    targetOrganizationUnitIds?: string[];
    startsAt?: string | null;
    endsAt?: string | null;
    reason?: string | null;
  }): Promise<FeatureFlagSummary> {
    return fetchApi<FeatureFlagSummary>(API_ROUTES.SETTINGS.FEATURE_FLAGS.CREATE, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateFeatureFlag(
    key: string,
    payload: {
      name?: string;
      description?: string;
      isEnabled?: boolean;
      rolloutPercentage?: number;
      targetUserIds?: string[];
      targetRoles?: string[];
      targetOrganizationUnitIds?: string[];
      startsAt?: string | null;
      endsAt?: string | null;
      status?: number;
      reason?: string | null;
    },
  ): Promise<FeatureFlagSummary> {
    return fetchApi<FeatureFlagSummary>(API_ROUTES.SETTINGS.FEATURE_FLAGS.DETAIL(key), {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  toggleFeatureFlag(
    key: string,
    payload: { isEnabled: boolean; reason?: string | null },
  ): Promise<FeatureFlagSummary> {
    return fetchApi<FeatureFlagSummary>(API_ROUTES.SETTINGS.FEATURE_FLAGS.TOGGLE(key), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  evaluateFeatureFlags(params: {
    key?: string;
    userId?: string;
    roles?: string;
    organizationUnitId?: string;
  }): Promise<FeatureFlagEvaluationResult[]> {
    return fetchApi<FeatureFlagEvaluationResult[]>(
      API_ROUTES.SETTINGS.FEATURE_FLAGS.EVALUATE(toQueryString(params)),
    );
  },

  listFeatureFlagHistory(params?: {
    flagKey?: string;
    limit?: number;
  }): Promise<FeatureFlagHistoryRecord[]> {
    return fetchApi<FeatureFlagHistoryRecord[]>(
      API_ROUTES.SETTINGS.FEATURE_FLAGS.HISTORY(toQueryString(params ?? {})),
    );
  },

  // 3. I18n Management
  syncI18nCatalog(): Promise<{
    totalLocales: number;
    totalTimezones: number;
    totalTranslations: number;
  }> {
    return fetchApi<{
      totalLocales: number;
      totalTimezones: number;
      totalTranslations: number;
    }>(API_ROUTES.SETTINGS.I18N.SYNC, { method: 'POST' });
  },

  listLocales(params?: { status?: number }): Promise<I18nLocaleSummary[]> {
    return fetchApi<I18nLocaleSummary[]>(
      API_ROUTES.SETTINGS.I18N.LOCALES(toQueryString(params ?? {})),
    );
  },

  createLocale(payload: {
    code: string;
    bcp47Tag: string;
    name: string;
    nativeName: string;
    direction?: 'ltr' | 'rtl';
    dateFormat?: string;
    datetimeFormat?: string;
    currencyCode?: string;
    isDefault?: boolean;
  }): Promise<I18nLocaleSummary> {
    return fetchApi<I18nLocaleSummary>(API_ROUTES.SETTINGS.I18N.LOCALES(), {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateLocale(
    code: string,
    payload: {
      name?: string;
      nativeName?: string;
      dateFormat?: string;
      datetimeFormat?: string;
      currencyCode?: string;
      isDefault?: boolean;
      status?: number;
    },
  ): Promise<I18nLocaleSummary> {
    return fetchApi<I18nLocaleSummary>(API_ROUTES.SETTINGS.I18N.LOCALE_DETAIL(code), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  listTimezones(params?: { region?: string; q?: string }): Promise<I18nTimezoneSummary[]> {
    return fetchApi<I18nTimezoneSummary[]>(
      API_ROUTES.SETTINGS.I18N.TIMEZONES(toQueryString(params ?? {})),
    );
  },

  updateTimezone(
    code: string,
    payload: { isDefault?: boolean; status?: number },
  ): Promise<I18nTimezoneSummary> {
    return fetchApi<I18nTimezoneSummary>(API_ROUTES.SETTINGS.I18N.TIMEZONE_DETAIL(code), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  listTranslations(params?: {
    locale?: string;
    namespace?: string;
    q?: string;
  }): Promise<I18nTranslationSummary[]> {
    return fetchApi<I18nTranslationSummary[]>(
      API_ROUTES.SETTINGS.I18N.TRANSLATIONS(toQueryString(params ?? {})),
    );
  },

  upsertTranslation(payload: {
    locale: string;
    namespace: string;
    key: string;
    value: string;
    description?: string | null;
  }): Promise<I18nTranslationSummary> {
    return fetchApi<I18nTranslationSummary>(API_ROUTES.SETTINGS.I18N.TRANSLATIONS(), {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  // 4. Sequences
  syncSequences(): Promise<{ syncedModules: string[]; totalSequences: number }> {
    return fetchApi<{ syncedModules: string[]; totalSequences: number }>(
      API_ROUTES.SETTINGS.SEQUENCES.SYNC,
      { method: 'POST' },
    );
  },

  listSequences(params?: {
    module?: string;
    resetPolicy?: number;
    q?: string;
  }): Promise<SequenceRuleSummary[]> {
    return fetchApi<SequenceRuleSummary[]>(
      API_ROUTES.SETTINGS.SEQUENCES.LIST(toQueryString(params ?? {})),
    );
  },

  previewSequence(payload: {
    key?: string;
    prefix?: string;
    suffix?: string;
    separator?: string;
    dateFormat?: number | string;
    paddingLength?: number;
    startValue?: number;
    step?: number;
    resetPolicy?: number | string;
    scopeByUnit?: boolean;
    unitCode?: string | null;
  }): Promise<SequencePreviewResult> {
    return fetchApi<SequencePreviewResult>(API_ROUTES.SETTINGS.SEQUENCES.PREVIEW, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  createSequenceRule(payload: {
    key: string;
    module?: string;
    name: string;
    description?: string | null;
    prefix?: string;
    suffix?: string;
    separator?: string;
    dateFormat?: number;
    paddingLength?: number;
    startValue?: number;
    step?: number;
    resetPolicy?: number;
    scopeByUnit?: boolean;
  }): Promise<SequenceRuleSummary> {
    return fetchApi<SequenceRuleSummary>(API_ROUTES.SETTINGS.SEQUENCES.CREATE, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateSequenceRule(
    key: string,
    payload: {
      name?: string;
      description?: string | null;
      prefix?: string;
      suffix?: string;
      separator?: string;
      dateFormat?: number;
      paddingLength?: number;
      startValue?: number;
      step?: number;
      resetPolicy?: number;
      scopeByUnit?: boolean;
      reason?: string | null;
    },
  ): Promise<SequenceRuleSummary> {
    return fetchApi<SequenceRuleSummary>(API_ROUTES.SETTINGS.SEQUENCES.DETAIL(key), {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  generateNextSequence(
    key: string,
    payload?: { count?: number; unitCode?: string | null; organizationUnitId?: number | null },
  ): Promise<SequenceGeneratedResult | SequenceGeneratedResult[]> {
    return fetchApi<SequenceGeneratedResult | SequenceGeneratedResult[]>(
      API_ROUTES.SETTINGS.SEQUENCES.NEXT(key),
      {
        method: 'POST',
        body: JSON.stringify(payload ?? {}),
      },
    );
  },

  // 5. Menus
  syncMenus(): Promise<{ syncedModules: string[]; totalMenus: number }> {
    return fetchApi<{ syncedModules: string[]; totalMenus: number }>(
      API_ROUTES.SETTINGS.MENUS.SYNC,
      { method: 'POST' },
    );
  },

  listMenus(params?: {
    position?: string;
    module?: string;
    status?: number;
    q?: string;
  }): Promise<MenuSummary[]> {
    return fetchApi<MenuSummary[]>(
      API_ROUTES.SETTINGS.MENUS.LIST(toQueryString(params ?? {})),
    );
  },

  getMenuTree(params?: {
    position?: string;
    includeInactive?: boolean;
  }): Promise<MenuTreeEvaluationResult> {
    const qs = toQueryString(params ?? {});
    return fetchApi<MenuTreeEvaluationResult>(
      `/settings/menus/tree${qs ? `?${qs}` : ''}`,
    );
  },

  createMenu(payload: {
    code: string;
    module?: string;
    name: string;
    position?: string;
    type?: number;
    link?: string | null;
    key?: string | null;
    icon?: string | null;
    numOrder?: number;
    parentCode?: string | null;
  }): Promise<MenuSummary> {
    return fetchApi<MenuSummary>(API_ROUTES.SETTINGS.MENUS.CREATE, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateMenu(
    code: string,
    payload: {
      name?: string;
      position?: string;
      type?: number;
      link?: string | null;
      key?: string | null;
      icon?: string | null;
      numOrder?: number;
      parentCode?: string | null;
      status?: number;
    },
  ): Promise<MenuSummary> {
    return fetchApi<MenuSummary>(API_ROUTES.SETTINGS.MENUS.DETAIL(code), {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  toggleMenu(
    code: string,
    payload: { status?: number; cascadeChildren?: boolean },
  ): Promise<MenuSummary> {
    return fetchApi<MenuSummary>(API_ROUTES.SETTINGS.MENUS.TOGGLE(code), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  deleteMenu(code: string): Promise<{ deleted: true; code: string; id: number }> {
    return fetchApi<{ deleted: true; code: string; id: number }>(
      API_ROUTES.SETTINGS.MENUS.DETAIL(code),
      { method: 'DELETE' },
    );
  },

  invalidateMenuCache(): Promise<{ invalidated: true; cacheVersion: number }> {
    return fetchApi<{ invalidated: true; cacheVersion: number }>(
      API_ROUTES.SETTINGS.MENUS.INVALIDATE_CACHE,
      { method: 'POST' },
    );
  },
};

