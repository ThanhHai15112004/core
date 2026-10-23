import { useCallback, useEffect, useState } from 'react';
import { SETTINGS_TAB, type SettingsTabId } from '../enum/settings.enum';
import { settingsApi } from '../services/settings.api';
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
  SystemSettingSummary,
} from '../types/settings.types';

export function useSettingsManagement() {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(SETTINGS_TAB.SYSTEM_SETTINGS);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 1. System Settings state
  const [groups, setGroups] = useState<SettingGroupSummary[]>([]);
  const [selectedGroupCode, setSelectedGroupCode] = useState<string>('');
  const [settings, setSettings] = useState<SystemSettingSummary[]>([]);
  const [settingEnvironment, setSettingEnvironment] = useState<string>('');
  const [settingOrgUnitId, setSettingOrgUnitId] = useState<string>('');
  const [settingSearch, setSettingSearch] = useState<string>('');
  const [settingHistory, setSettingHistory] = useState<SettingHistoryRecord[]>([]);

  // 2. Feature Flags state
  const [featureFlags, setFeatureFlags] = useState<FeatureFlagSummary[]>([]);
  const [flagSearch, setFlagSearch] = useState<string>('');
  const [flagEvalResults, setFlagEvalResults] = useState<FeatureFlagEvaluationResult[]>([]);
  const [flagHistory, setFlagHistory] = useState<FeatureFlagHistoryRecord[]>([]);

  // 3. I18n state
  const [locales, setLocales] = useState<I18nLocaleSummary[]>([]);
  const [timezones, setTimezones] = useState<I18nTimezoneSummary[]>([]);
  const [translations, setTranslations] = useState<I18nTranslationSummary[]>([]);
  const [translationLocaleFilter, setTranslationLocaleFilter] = useState<string>('vi');
  const [translationSearch, setTranslationSearch] = useState<string>('');

  // 4. Sequences state
  const [sequences, setSequences] = useState<SequenceRuleSummary[]>([]);
  const [sequenceSearch, setSequenceSearch] = useState<string>('');
  const [sequencePreview, setSequencePreview] = useState<SequencePreviewResult | null>(null);
  const [lastGeneratedSequence, setLastGeneratedSequence] = useState<
    SequenceGeneratedResult | SequenceGeneratedResult[] | null
  >(null);

  // 5. Menus state
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [menuPositionFilter, setMenuPositionFilter] = useState<string>('SIDEBAR');
  const [menuTree, setMenuTree] = useState<MenuTreeEvaluationResult | null>(null);

  const notify = useCallback((type: 'success' | 'error', message: string) => {
    setBanner({ type, message });
  }, []);

  // Loaders per tab
  const loadSystemSettingsTab = useCallback(async () => {
    setLoading(true);
    try {
      const orgIdNum = settingOrgUnitId ? Number(settingOrgUnitId) : undefined;
      const [grpList, settingList, histList] = await Promise.all([
        settingsApi.listGroups(),
        settingsApi.listSettings({
          groupCode: selectedGroupCode || undefined,
          environment: settingEnvironment || undefined,
          organizationUnitId: orgIdNum && !Number.isNaN(orgIdNum) ? orgIdNum : undefined,
          q: settingSearch.trim() || undefined,
        }),
        settingsApi.listSettingHistory({ limit: 30 }),
      ]);
      setGroups(grpList);
      setSettings(settingList);
      setSettingHistory(histList);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Không thể tải cấu hình hệ thống');
    } finally {
      setLoading(false);
    }
  }, [selectedGroupCode, settingEnvironment, settingOrgUnitId, settingSearch, notify]);

  const loadFeatureFlagsTab = useCallback(async () => {
    setLoading(true);
    try {
      const [flags, hist] = await Promise.all([
        settingsApi.listFeatureFlags({ q: flagSearch.trim() || undefined }),
        settingsApi.listFeatureFlagHistory({ limit: 30 }),
      ]);
      setFeatureFlags(flags);
      setFlagHistory(hist);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Không thể tải Feature Flags');
    } finally {
      setLoading(false);
    }
  }, [flagSearch, notify]);

  const loadI18nTab = useCallback(async () => {
    setLoading(true);
    try {
      const [locList, tzList, trList] = await Promise.all([
        settingsApi.listLocales(),
        settingsApi.listTimezones(),
        settingsApi.listTranslations({
          locale: translationLocaleFilter || undefined,
          q: translationSearch.trim() || undefined,
        }),
      ]);
      setLocales(locList);
      setTimezones(tzList);
      setTranslations(trList);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Không thể tải dữ liệu Đa ngôn ngữ & Múi giờ');
    } finally {
      setLoading(false);
    }
  }, [translationLocaleFilter, translationSearch, notify]);

  const loadSequencesTab = useCallback(async () => {
    setLoading(true);
    try {
      const seqList = await settingsApi.listSequences({ q: sequenceSearch.trim() || undefined });
      setSequences(seqList);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Không thể tải quy tắc sinh mã');
    } finally {
      setLoading(false);
    }
  }, [sequenceSearch, notify]);

  const loadMenusTab = useCallback(async () => {
    setLoading(true);
    try {
      const [menuList, treeRes] = await Promise.all([
        settingsApi.listMenus({ position: menuPositionFilter || undefined }),
        settingsApi.getMenuTree({
          position: menuPositionFilter || undefined,
          includeInactive: true,
        }),
      ]);
      setMenus(menuList);
      setMenuTree(treeRes);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Không thể tải cấu hình Menu động');
    } finally {
      setLoading(false);
    }
  }, [menuPositionFilter, notify]);

  const refreshActiveTab = useCallback(async () => {
    switch (activeTab) {
      case SETTINGS_TAB.SYSTEM_SETTINGS:
        await loadSystemSettingsTab();
        break;
      case SETTINGS_TAB.FEATURE_FLAGS:
        await loadFeatureFlagsTab();
        break;
      case SETTINGS_TAB.I18N:
        await loadI18nTab();
        break;
      case SETTINGS_TAB.SEQUENCES:
        await loadSequencesTab();
        break;
      case SETTINGS_TAB.MENUS:
        await loadMenusTab();
        break;
    }
  }, [
    activeTab,
    loadSystemSettingsTab,
    loadFeatureFlagsTab,
    loadI18nTab,
    loadSequencesTab,
    loadMenusTab,
  ]);

  useEffect(() => {
    void refreshActiveTab();
  }, [refreshActiveTab]);

  // Actions: System Settings
  const handleSyncAllManifests = async () => {
    setSubmitting(true);
    try {
      const [sRes, fRes, iRes, seqRes, mRes] = await Promise.all([
        settingsApi.syncSettingsManifests(),
        settingsApi.syncFeatureFlags(),
        settingsApi.syncI18nCatalog(),
        settingsApi.syncSequences(),
        settingsApi.syncMenus(),
      ]);
      notify(
        'success',
        `Đồng bộ hoàn tất: ${sRes.totalSettings} cấu hình, ${fRes.totalFlags} flags, ${iRes.totalLocales} ngôn ngữ, ${seqRes.totalSequences} bộ sinh mã, ${mRes.totalMenus} mục menu.`,
      );
      await refreshActiveTab();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Đồng bộ Manifest thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateSettingValue = async (
    key: string,
    payload: {
      value: unknown;
      environment?: string;
      organizationUnitId?: number | null;
      reason?: string | null;
    },
  ) => {
    setSubmitting(true);
    try {
      await settingsApi.updateSettingValue(key, payload);
      notify('success', `Đã cập nhật cấu hình ${key}`);
      await loadSystemSettingsTab();
      return true;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Cập nhật cấu hình thất bại');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveSettingScopeOverride = async (
    key: string,
    params: { environment?: string; organizationUnitId?: number; reason?: string },
  ) => {
    setSubmitting(true);
    try {
      await settingsApi.removeScopeOverride(key, params);
      notify('success', `Đã xóa bản ghi ghi đè phạm vi của ${key}`);
      await loadSystemSettingsTab();
      return true;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Xóa ghi đè phạm vi thất bại');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateSetting = async (payload: {
    key: string;
    groupCode: string;
    module?: string;
    namespace?: string;
    name: string;
    description?: string | null;
    valueType: number;
    defaultValue: unknown;
    isSensitive?: boolean;
    allowUnitOverride?: boolean;
  }) => {
    setSubmitting(true);
    try {
      await settingsApi.createSetting(payload);
      notify('success', `Đã tạo mới cấu hình ${payload.key}`);
      await loadSystemSettingsTab();
      return true;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Tạo cấu hình thất bại');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  // Actions: Feature Flags
  const handleToggleFeatureFlag = async (key: string, isEnabled: boolean, reason?: string) => {
    setSubmitting(true);
    try {
      await settingsApi.toggleFeatureFlag(key, { isEnabled, reason });
      notify('success', `Đã ${isEnabled ? 'BẬT' : 'TẮT'} Feature Flag ${key}`);
      await loadFeatureFlagsTab();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Chuyển trạng thái Feature Flag thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateFeatureFlag = async (
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
      reason?: string | null;
    },
  ) => {
    setSubmitting(true);
    try {
      await settingsApi.updateFeatureFlag(key, payload);
      notify('success', `Đã cập nhật quy tắc nhắm mục tiêu cho ${key}`);
      await loadFeatureFlagsTab();
      return true;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Cập nhật Feature Flag thất bại');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateFeatureFlag = async (payload: {
    key: string;
    module?: string;
    name: string;
    description: string;
    isEnabled?: boolean;
    rolloutPercentage?: number;
    targetRoles?: string[];
  }) => {
    setSubmitting(true);
    try {
      await settingsApi.createFeatureFlag(payload);
      notify('success', `Đã tạo mới Feature Flag ${payload.key}`);
      await loadFeatureFlagsTab();
      return true;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Tạo Feature Flag thất bại');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleEvaluateFeatureFlags = async (params: {
    key?: string;
    userId?: string;
    roles?: string;
    organizationUnitId?: string;
  }) => {
    setSubmitting(true);
    try {
      const res = await settingsApi.evaluateFeatureFlags(params);
      setFlagEvalResults(res);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Mô phỏng đánh giá Feature Flag thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  // Actions: I18n
  const handleUpdateLocale = async (
    code: string,
    payload: { isDefault?: boolean; status?: number; dateFormat?: string; currencyCode?: string },
  ) => {
    setSubmitting(true);
    try {
      await settingsApi.updateLocale(code, payload);
      notify('success', `Đã cập nhật ngôn ngữ ${code}`);
      await loadI18nTab();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Cập nhật ngôn ngữ thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateTimezone = async (
    code: string,
    payload: { isDefault?: boolean; status?: number },
  ) => {
    setSubmitting(true);
    try {
      await settingsApi.updateTimezone(code, payload);
      notify('success', `Đã cập nhật múi giờ ${code}`);
      await loadI18nTab();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Cập nhật múi giờ thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpsertTranslation = async (payload: {
    locale: string;
    namespace: string;
    key: string;
    value: string;
    description?: string | null;
  }) => {
    setSubmitting(true);
    try {
      await settingsApi.upsertTranslation(payload);
      notify('success', `Đã lưu bản dịch [${payload.locale}] ${payload.namespace}.${payload.key}`);
      await loadI18nTab();
      return true;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Lưu bản dịch thất bại');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  // Actions: Sequences
  const handlePreviewSequence = async (payload: {
    key?: string;
    prefix?: string;
    suffix?: string;
    separator?: string;
    dateFormat?: number;
    paddingLength?: number;
    startValue?: number;
    step?: number;
    resetPolicy?: number;
    scopeByUnit?: boolean;
    unitCode?: string | null;
  }) => {
    setSubmitting(true);
    try {
      const res = await settingsApi.previewSequence(payload);
      setSequencePreview(res);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Xem trước mẫu sinh mã thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateSequenceRule = async (
    key: string,
    payload: {
      name?: string;
      prefix?: string;
      suffix?: string;
      separator?: string;
      dateFormat?: number;
      paddingLength?: number;
      resetPolicy?: number;
      scopeByUnit?: boolean;
      reason?: string | null;
    },
  ) => {
    setSubmitting(true);
    try {
      await settingsApi.updateSequenceRule(key, payload);
      notify('success', `Đã cập nhật quy tắc sinh mã ${key}`);
      await loadSequencesTab();
      return true;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Cập nhật quy tắc sinh mã thất bại');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateSequenceRule = async (payload: {
    key: string;
    module?: string;
    name: string;
    prefix?: string;
    suffix?: string;
    separator?: string;
    dateFormat?: number;
    paddingLength?: number;
    resetPolicy?: number;
    scopeByUnit?: boolean;
  }) => {
    setSubmitting(true);
    try {
      await settingsApi.createSequenceRule(payload);
      notify('success', `Đã tạo mới quy tắc sinh mã ${payload.key}`);
      await loadSequencesTab();
      return true;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Tạo quy tắc sinh mã thất bại');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerateNextSequence = async (
    key: string,
    payload?: { count?: number; unitCode?: string | null },
  ) => {
    setSubmitting(true);
    try {
      const res = await settingsApi.generateNextSequence(key, payload);
      setLastGeneratedSequence(res);
      notify('success', `Đã cấp phát mã tiếp theo cho ${key}`);
      await loadSequencesTab();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Sinh mã tiếp theo thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  // Actions: Menus
  const handleCreateMenu = async (payload: {
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
  }) => {
    setSubmitting(true);
    try {
      await settingsApi.createMenu(payload);
      notify('success', `Đã tạo mục menu ${payload.code}`);
      await loadMenusTab();
      return true;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Tạo mục menu thất bại');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateMenu = async (
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
    },
  ) => {
    setSubmitting(true);
    try {
      await settingsApi.updateMenu(code, payload);
      notify('success', `Đã cập nhật mục menu ${code}`);
      await loadMenusTab();
      return true;
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Cập nhật mục menu thất bại');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleMenu = async (code: string, status: number, cascadeChildren = false) => {
    setSubmitting(true);
    try {
      await settingsApi.toggleMenu(code, { status, cascadeChildren });
      notify('success', `Đã chuyển trạng thái menu ${code}`);
      await loadMenusTab();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Đổi trạng thái menu thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMenu = async (code: string) => {
    setSubmitting(true);
    try {
      await settingsApi.deleteMenu(code);
      notify('success', `Đã xóa mục menu ${code}`);
      await loadMenusTab();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Xóa mục menu thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const handleInvalidateMenuCache = async () => {
    setSubmitting(true);
    try {
      const res = await settingsApi.invalidateMenuCache();
      notify('success', `Đã làm mới Cache L1/L2 Menu (Version: ${res.cacheVersion})`);
      await loadMenusTab();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Xóa cache menu thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  return {
    activeTab,
    setActiveTab,
    loading,
    submitting,
    banner,
    setBanner,
    refreshActiveTab,
    handleSyncAllManifests,

    // 1. System Settings
    groups,
    selectedGroupCode,
    setSelectedGroupCode,
    settings,
    settingEnvironment,
    setSettingEnvironment,
    settingOrgUnitId,
    setSettingOrgUnitId,
    settingSearch,
    setSettingSearch,
    settingHistory,
    handleUpdateSettingValue,
    handleRemoveSettingScopeOverride,
    handleCreateSetting,

    // 2. Feature Flags
    featureFlags,
    flagSearch,
    setFlagSearch,
    flagEvalResults,
    flagHistory,
    handleToggleFeatureFlag,
    handleUpdateFeatureFlag,
    handleCreateFeatureFlag,
    handleEvaluateFeatureFlags,

    // 3. I18n
    locales,
    timezones,
    translations,
    translationLocaleFilter,
    setTranslationLocaleFilter,
    translationSearch,
    setTranslationSearch,
    handleUpdateLocale,
    handleUpdateTimezone,
    handleUpsertTranslation,

    // 4. Sequences
    sequences,
    sequenceSearch,
    setSequenceSearch,
    sequencePreview,
    lastGeneratedSequence,
    handlePreviewSequence,
    handleUpdateSequenceRule,
    handleCreateSequenceRule,
    handleGenerateNextSequence,

    // 5. Menus
    menus,
    menuPositionFilter,
    setMenuPositionFilter,
    menuTree,
    handleCreateMenu,
    handleUpdateMenu,
    handleToggleMenu,
    handleDeleteMenu,
    handleInvalidateMenuCache,
  };
}

