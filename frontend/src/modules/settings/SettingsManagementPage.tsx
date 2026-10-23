import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Flag,
  FolderTree,
  Globe,
  Hash,
  RefreshCw,
  Settings,
  Sliders,
} from 'lucide-react';
import { authStyles } from '../auth/components/auth-ui.styles';
import { SETTINGS_TAB, type SettingsTabId } from './enum/settings.enum';
import { useSettingsManagement } from './hooks/useSettingsManagement';
import { SystemSettingsTab } from './components/SystemSettingsTab';
import { FeatureFlagsTab } from './components/FeatureFlagsTab';
import { I18nManagementTab } from './components/I18nManagementTab';
import { SequencesTab } from './components/SequencesTab';
import { MenusManagementTab } from './components/MenusManagementTab';

export const SettingsManagementPage: React.FC = () => {
  const {
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
  } = useSettingsManagement();

  const tabItems: readonly { id: SettingsTabId; label: string; icon: React.ReactNode }[] = [
    {
      id: SETTINGS_TAB.SYSTEM_SETTINGS,
      label: `Cấu hình Hệ thống 5 Tầng (${settings.length})`,
      icon: <Sliders size={15} />,
    },
    {
      id: SETTINGS_TAB.FEATURE_FLAGS,
      label: `Feature Flags & Rollout (${featureFlags.length})`,
      icon: <Flag size={15} />,
    },
    {
      id: SETTINGS_TAB.I18N,
      label: `Đa ngôn ngữ & Múi giờ (${locales.length || 2} Locales)`,
      icon: <Globe size={15} />,
    },
    {
      id: SETTINGS_TAB.SEQUENCES,
      label: `Quy tắc Sinh Mã Tự động (${sequences.length})`,
      icon: <Hash size={15} />,
    },
    {
      id: SETTINGS_TAB.MENUS,
      label: `Cây Menu Động (${menus.length})`,
      icon: <FolderTree size={15} />,
    },
  ];

  return (
    <main style={{ maxWidth: '1420px', margin: '0 auto', padding: '24px 20px 60px' }}>
      {/* Hero Header Banner */}
      <section
        style={{
          background:
            'linear-gradient(135deg, var(--bg-light-blue) 0%, var(--bg-surface-elevated) 100%)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          padding: '22px 26px',
          marginBottom: '20px',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '13px',
              background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.28)',
              flexShrink: 0,
            }}
          >
            <Settings size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h1
                style={{
                  fontSize: '21px',
                  fontWeight: 800,
                  margin: 0,
                  color: 'var(--text-main)',
                  letterSpacing: '-0.02em',
                }}
              >
                Trung Tâm Cấu Hình Động, Feature Flags, Đa Ngôn Ngữ, Sinh Mã & Cây Menu
              </h1>
              <span style={authStyles.badgePrimary}>5-Layer Scope Resolution</span>
              <span style={authStyles.badgeSuccess}>AES-256-GCM Secret + L1/L2 Cache</span>
            </div>
            <p
              style={{
                fontSize: '13.5px',
                color: 'var(--text-secondary)',
                margin: '4px 0 0',
              }}
            >
              Điều phối hợp nhất 5 phân hệ nền tảng: Cấu hình động 5 tầng (
              <code>system_settings</code>), công tắc tính năng (<code>feature_flags</code>), đa
              ngôn ngữ & múi giờ (<code>i18n_*</code>), quy tắc sinh mã nghiệp vụ (
              <code>sequence_rules</code>) và cây điều hướng phân quyền (<code>menus</code>).
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleSyncAllManifests()}
            style={authStyles.btnTeal}
          >
            <RefreshCw size={15} />
            <span>Đồng bộ toàn bộ từ Manifest</span>
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => void refreshActiveTab()}
            style={authStyles.btnSecondary}
          >
            <RefreshCw size={14} />
            <span>Làm mới</span>
          </button>
        </div>
      </section>

      {/* Feedback Banner */}
      {banner && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '16px',
            background:
              banner.type === 'success' ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
            color: banner.type === 'success' ? 'var(--status-success)' : 'var(--status-danger)',
            border:
              banner.type === 'success'
                ? '1px solid rgba(16, 185, 129, 0.35)'
                : '1px solid rgba(239, 68, 68, 0.35)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            {banner.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{banner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
          marginBottom: '18px',
          padding: '6px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
        }}
      >
        {tabItems.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={
                active
                  ? authStyles.btnPrimary
                  : {
                      ...authStyles.btnSecondary,
                      background: 'transparent',
                      borderColor: 'transparent',
                    }
              }
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: System Settings */}
      {activeTab === SETTINGS_TAB.SYSTEM_SETTINGS && (
        <SystemSettingsTab
          groups={groups}
          selectedGroupCode={selectedGroupCode}
          onSelectGroupCode={setSelectedGroupCode}
          settings={settings}
          environment={settingEnvironment}
          onEnvironmentChange={setSettingEnvironment}
          orgUnitId={settingOrgUnitId}
          onOrgUnitIdChange={setSettingOrgUnitId}
          search={settingSearch}
          onSearchChange={setSettingSearch}
          history={settingHistory}
          loading={loading}
          submitting={submitting}
          onUpdateSettingValue={handleUpdateSettingValue}
          onRemoveScopeOverride={handleRemoveSettingScopeOverride}
          onCreateSetting={handleCreateSetting}
        />
      )}

      {/* Tab 2: Feature Flags */}
      {activeTab === SETTINGS_TAB.FEATURE_FLAGS && (
        <FeatureFlagsTab
          flags={featureFlags}
          search={flagSearch}
          onSearchChange={setFlagSearch}
          evalResults={flagEvalResults}
          history={flagHistory}
          loading={loading}
          submitting={submitting}
          onToggleFlag={handleToggleFeatureFlag}
          onUpdateFlag={handleUpdateFeatureFlag}
          onCreateFlag={handleCreateFeatureFlag}
          onEvaluateFlags={handleEvaluateFeatureFlags}
        />
      )}

      {/* Tab 3: I18n */}
      {activeTab === SETTINGS_TAB.I18N && (
        <I18nManagementTab
          locales={locales}
          timezones={timezones}
          translations={translations}
          localeFilter={translationLocaleFilter}
          onLocaleFilterChange={setTranslationLocaleFilter}
          search={translationSearch}
          onSearchChange={setTranslationSearch}
          loading={loading}
          submitting={submitting}
          onUpdateLocale={handleUpdateLocale}
          onUpdateTimezone={handleUpdateTimezone}
          onUpsertTranslation={handleUpsertTranslation}
        />
      )}

      {/* Tab 4: Sequences */}
      {activeTab === SETTINGS_TAB.SEQUENCES && (
        <SequencesTab
          sequences={sequences}
          search={sequenceSearch}
          onSearchChange={setSequenceSearch}
          preview={sequencePreview}
          lastGenerated={lastGeneratedSequence}
          loading={loading}
          submitting={submitting}
          onPreviewSequence={handlePreviewSequence}
          onUpdateSequenceRule={handleUpdateSequenceRule}
          onCreateSequenceRule={handleCreateSequenceRule}
          onGenerateNext={handleGenerateNextSequence}
        />
      )}

      {/* Tab 5: Menus */}
      {activeTab === SETTINGS_TAB.MENUS && (
        <MenusManagementTab
          menus={menus}
          positionFilter={menuPositionFilter}
          onPositionFilterChange={setMenuPositionFilter}
          menuTree={menuTree}
          loading={loading}
          submitting={submitting}
          onCreateMenu={handleCreateMenu}
          onUpdateMenu={handleUpdateMenu}
          onToggleMenu={handleToggleMenu}
          onDeleteMenu={handleDeleteMenu}
          onInvalidateCache={handleInvalidateMenuCache}
        />
      )}
    </main>
  );
};

