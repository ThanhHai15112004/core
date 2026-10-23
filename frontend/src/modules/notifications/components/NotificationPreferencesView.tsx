import React, { useEffect, useState } from 'react';
import { Lock, Save, Sliders } from 'lucide-react';
import type { NotificationPreferenceItem } from '../types/notifications.types';

interface NotificationPreferencesViewProps {
  preferences: NotificationPreferenceItem[];
  loading: boolean;
  onSave: (
    updated: Array<{
      category: number | string;
      inAppEnabled?: boolean;
      emailEnabled?: boolean;
      smsEnabled?: boolean;
      pushEnabled?: boolean;
    }>,
  ) => Promise<void>;
}

export const NotificationPreferencesView: React.FC<NotificationPreferencesViewProps> = ({
  preferences,
  loading,
  onSave,
}) => {
  const [draft, setDraft] = useState<NotificationPreferenceItem[]>(preferences);

  useEffect(() => {
    setDraft(preferences);
  }, [preferences]);

  const toggleField = (
    category: number,
    field: 'inAppEnabled' | 'emailEnabled' | 'smsEnabled' | 'pushEnabled',
  ) => {
    setDraft((prev) =>
      prev.map((item) => {
        if (item.category !== category) return item;
        if (field === 'inAppEnabled' && item.isSecurityLockedInApp) {
          return item;
        }
        return {
          ...item,
          [field]: !item[field],
        };
      }),
    );
  };

  const handleSave = async () => {
    await onSave(
      draft.map((item) => ({
        category: item.categoryCode,
        inAppEnabled: item.inAppEnabled,
        emailEnabled: item.emailEnabled,
        smsEnabled: item.smsEnabled,
        pushEnabled: item.pushEnabled,
      })),
    );
  };

  return (
    <div className="glass" style={{ padding: 24, borderRadius: 14 }}>
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
            <Sliders size={17} color="#60A5FA" />
            <span>Thiết lập sở thích nhận thông báo (Notification Preferences)</span>
          </h3>
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
            Chủ động bật hoặc tắt các kênh nhận thông báo được phép cho từng phân nhóm nghiệp vụ (Hệ thống, Công việc, Bảo mật, Thông báo chung).
          </div>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void handleSave()}
          className="nav-tab-btn nav-tab-btn-active"
          style={{ padding: '8px 16px', fontWeight: 700 }}
        >
          <Save size={15} />
          <span>{loading ? 'Đang lưu...' : 'Lưu thiết lập kênh nhận'}</span>
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead>
            <tr
              style={{
                borderBottom: '1px solid rgba(148, 163, 184, 0.25)',
                textAlign: 'left',
              }}
            >
              <th style={{ padding: '12px 10px' }}>Phân nhóm thông báo</th>
              <th style={{ padding: '12px 10px' }}>Trong hệ thống (In-App)</th>
              <th style={{ padding: '12px 10px' }}>Thư điện tử (Email)</th>
              <th style={{ padding: '12px 10px' }}>Tin nhắn SMS</th>
              <th style={{ padding: '12px 10px' }}>Thông báo đẩy (Push)</th>
            </tr>
          </thead>
          <tbody>
            {draft.map((pref) => (
              <tr
                key={pref.category}
                style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.14)' }}
              >
                <td style={{ padding: '14px 10px' }}>
                  <div style={{ fontWeight: 700 }}>{pref.categoryLabel}</div>
                  <div style={{ fontSize: 12, opacity: 0.65 }}>Mã nhóm: {pref.categoryCode}</div>
                </td>

                <td style={{ padding: '14px 10px' }}>
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: pref.isSecurityLockedInApp ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={pref.inAppEnabled}
                      disabled={pref.isSecurityLockedInApp}
                      onChange={() => toggleField(pref.category, 'inAppEnabled')}
                    />
                    <span>{pref.inAppEnabled ? 'Đang bật' : 'Đã tắt'}</span>
                    {pref.isSecurityLockedInApp && (
                      <span
                        title="Kênh In-App của nhóm Bảo mật được khóa bắt buộc theo chính sách an toàn"
                        style={{ display: 'inline-flex', alignItems: 'center', color: '#FBBF24' }}
                      >
                        <Lock size={13} />
                      </span>
                    )}
                  </label>
                </td>

                <td style={{ padding: '14px 10px' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={pref.emailEnabled}
                      onChange={() => toggleField(pref.category, 'emailEnabled')}
                    />
                    <span>{pref.emailEnabled ? 'Đang bật' : 'Đã tắt'}</span>
                  </label>
                </td>

                <td style={{ padding: '14px 10px' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={pref.smsEnabled}
                      onChange={() => toggleField(pref.category, 'smsEnabled')}
                    />
                    <span>{pref.smsEnabled ? 'Đang bật' : 'Đã tắt'}</span>
                  </label>
                </td>

                <td style={{ padding: '14px 10px' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={pref.pushEnabled}
                      onChange={() => toggleField(pref.category, 'pushEnabled')}
                    />
                    <span>{pref.pushEnabled ? 'Đang bật' : 'Đã tắt'}</span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

