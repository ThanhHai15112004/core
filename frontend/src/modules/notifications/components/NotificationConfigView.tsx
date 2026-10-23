import React, { useEffect, useState } from 'react';
import { Save, Settings } from 'lucide-react';
import type { NotificationRuntimeConfig } from '../types/notifications.types';

interface NotificationConfigViewProps {
  config: NotificationRuntimeConfig | null;
  loading: boolean;
  onSave: (partial: Partial<NotificationRuntimeConfig>) => Promise<void>;
}

export const NotificationConfigView: React.FC<NotificationConfigViewProps> = ({
  config,
  loading,
  onSave,
}) => {
  const [draft, setDraft] = useState<NotificationRuntimeConfig | null>(config);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  if (!draft) {
    return (
      <div className="glass" style={{ padding: 24, borderRadius: 14 }}>
        Đang tải cấu hình vận hành hệ thống thông báo...
      </div>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      enabled: draft.enabled,
      inAppFeatureEnabled: draft.inAppFeatureEnabled,
      orgUnitTargetingEnabled: draft.orgUnitTargetingEnabled,
      orgUnitBroadcastFlagEnabled: draft.orgUnitBroadcastFlagEnabled,
      orgUnitIncludeSubUnitsDefault: draft.orgUnitIncludeSubUnitsDefault,
      roleTargetingEnabled: draft.roleTargetingEnabled,
      roleBroadcastFlagEnabled: draft.roleBroadcastFlagEnabled,
      allowUserCustomization: draft.allowUserCustomization,
      userPreferencesFlagEnabled: draft.userPreferencesFlagEnabled,
      lockSecurityInApp: draft.lockSecurityInApp,
      autoReadOnOpen: draft.autoReadOnOpen,
      retentionDays: Number(draft.retentionDays),
      pollingIntervalSec: Number(draft.pollingIntervalSec),
      maxRecipientsPerBatch: Number(draft.maxRecipientsPerBatch),
      maxTitleLength: Number(draft.maxTitleLength),
      maxBodyLength: Number(draft.maxBodyLength),
    });
  };

  return (
    <form onSubmit={(e) => void handleSave(e)} className="glass" style={{ padding: 24, borderRadius: 14 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={17} color="#60A5FA" />
            <span>Cấu hình vận hành Thông báo (Runtime Settings & Feature Flags)</span>
          </h3>
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
            Đồng bộ trực tiếp với SettingRegistryService & FeatureFlagRegistryService (module.manifest.json).
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="nav-tab-btn nav-tab-btn-active"
          style={{ padding: '8px 16px', fontWeight: 700 }}
        >
          <Save size={15} />
          <span>{loading ? 'Đang lưu...' : 'Lưu cấu hình thông báo'}</span>
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 14,
          marginBottom: 18,
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          <span>Bật hệ thống thông báo (notification.enabled)</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
          <input
            type="checkbox"
            checked={draft.orgUnitTargetingEnabled}
            onChange={(e) => setDraft({ ...draft, orgUnitTargetingEnabled: e.target.checked })}
          />
          <span>Cho phép gửi theo Đơn vị (org_unit_targeting.enabled)</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
          <input
            type="checkbox"
            checked={draft.orgUnitIncludeSubUnitsDefault}
            onChange={(e) =>
              setDraft({ ...draft, orgUnitIncludeSubUnitsDefault: e.target.checked })
            }
          />
          <span>Mặc định gửi kèm đơn vị cấp dưới (include_sub_units_default)</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
          <input
            type="checkbox"
            checked={draft.roleTargetingEnabled}
            onChange={(e) => setDraft({ ...draft, roleTargetingEnabled: e.target.checked })}
          />
          <span>Cho phép gửi theo Vai trò (role_targeting.enabled)</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
          <input
            type="checkbox"
            checked={draft.allowUserCustomization}
            onChange={(e) => setDraft({ ...draft, allowUserCustomization: e.target.checked })}
          />
          <span>Cho phép User tùy chỉnh kênh nhận (allow_user_customization)</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
          <input
            type="checkbox"
            checked={draft.lockSecurityInApp}
            onChange={(e) => setDraft({ ...draft, lockSecurityInApp: e.target.checked })}
          />
          <span>Khóa bắt buộc In-App cho nhóm Bảo mật (lock_security_in_app)</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
          <input
            type="checkbox"
            checked={draft.autoReadOnOpen}
            onChange={(e) => setDraft({ ...draft, autoReadOnOpen: e.target.checked })}
          />
          <span>Tự động đánh dấu đã đọc khi mở xem (auto_read_on_open)</span>
        </label>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 14,
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: 12.5, marginBottom: 4 }}>
            Số người nhận tối đa / lô (max_recipients_per_batch)
          </label>
          <input
            type="number"
            value={draft.maxRecipientsPerBatch}
            onChange={(e) =>
              setDraft({ ...draft, maxRecipientsPerBatch: Number(e.target.value) })
            }
            style={{
              width: '100%',
              padding: '7px 10px',
              borderRadius: 8,
              background: 'rgba(15, 23, 42, 0.8)',
              color: 'inherit',
              border: '1px solid rgba(148, 163, 184, 0.3)',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12.5, marginBottom: 4 }}>
            Thời gian lưu hộp thư (Ngày - retention_days)
          </label>
          <input
            type="number"
            value={draft.retentionDays}
            onChange={(e) => setDraft({ ...draft, retentionDays: Number(e.target.value) })}
            style={{
              width: '100%',
              padding: '7px 10px',
              borderRadius: 8,
              background: 'rgba(15, 23, 42, 0.8)',
              color: 'inherit',
              border: '1px solid rgba(148, 163, 184, 0.3)',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12.5, marginBottom: 4 }}>
            Chu kỳ cập nhật số thông báo mới (Giây - polling_interval_sec)
          </label>
          <input
            type="number"
            value={draft.pollingIntervalSec}
            onChange={(e) => setDraft({ ...draft, pollingIntervalSec: Number(e.target.value) })}
            style={{
              width: '100%',
              padding: '7px 10px',
              borderRadius: 8,
              background: 'rgba(15, 23, 42, 0.8)',
              color: 'inherit',
              border: '1px solid rgba(148, 163, 184, 0.3)',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12.5, marginBottom: 4 }}>
            Độ dài tối đa tiêu đề / nội dung
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number"
              value={draft.maxTitleLength}
              onChange={(e) => setDraft({ ...draft, maxTitleLength: Number(e.target.value) })}
              style={{
                width: '50%',
                padding: '7px 10px',
                borderRadius: 8,
                background: 'rgba(15, 23, 42, 0.8)',
                color: 'inherit',
                border: '1px solid rgba(148, 163, 184, 0.3)',
              }}
            />
            <input
              type="number"
              value={draft.maxBodyLength}
              onChange={(e) => setDraft({ ...draft, maxBodyLength: Number(e.target.value) })}
              style={{
                width: '50%',
                padding: '7px 10px',
                borderRadius: 8,
                background: 'rgba(15, 23, 42, 0.8)',
                color: 'inherit',
                border: '1px solid rgba(148, 163, 184, 0.3)',
              }}
            />
          </div>
        </div>
      </div>
    </form>
  );
};

