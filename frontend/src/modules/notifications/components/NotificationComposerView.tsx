import React, { useState } from 'react';
import { Building2, KeyRound, Send, User, Users } from 'lucide-react';
import type { SimpleLookupOption } from '../hooks/useNotifications';
import type {
  NotificationChannelName,
  NotificationRuntimeConfig,
  NotificationTargetTypeName,
  SendNotificationPayload,
} from '../types/notifications.types';

interface NotificationComposerViewProps {
  usersLookup: SimpleLookupOption[];
  rolesLookup: SimpleLookupOption[];
  orgUnitsLookup: SimpleLookupOption[];
  runtimeConfig: NotificationRuntimeConfig | null;
  loading: boolean;
  onSend: (payload: SendNotificationPayload) => Promise<unknown>;
}

export const NotificationComposerView: React.FC<NotificationComposerViewProps> = ({
  usersLookup,
  rolesLookup,
  orgUnitsLookup,
  runtimeConfig,
  loading,
  onSend,
}) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('SYSTEM');
  const [priority, setPriority] = useState('NORMAL');
  const [targetType, setTargetType] = useState<NotificationTargetTypeName>('SINGLE_USER');
  const [singleUserId, setSingleUserId] = useState<number>(1);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([1]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>([1]);
  const [selectedOrgUnitIds, setSelectedOrgUnitIds] = useState<number[]>([1]);
  const [includeSubUnits, setIncludeSubUnits] = useState<boolean>(
    runtimeConfig?.orgUnitIncludeSubUnitsDefault ?? true,
  );
  const [selectedChannels, setSelectedChannels] = useState<NotificationChannelName[]>(['IN_APP']);
  const [actionUrl, setActionUrl] = useState('');
  const [forceDeliver, setForceDeliver] = useState(false);

  const toggleNumberInList = (list: number[], id: number): number[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const toggleChannel = (ch: NotificationChannelName) => {
    setSelectedChannels((prev) =>
      prev.includes(ch)
        ? prev.length > 1
          ? prev.filter((c) => c !== ch)
          : prev
        : [...prev, ch],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: SendNotificationPayload = {
      title,
      content,
      category,
      priority,
      targetType,
      channels: selectedChannels,
      actionUrl: actionUrl.trim() || null,
      forceDeliver,
    };

    if (targetType === 'SINGLE_USER') {
      payload.userId = Number(singleUserId);
    } else if (targetType === 'USER_GROUP') {
      payload.userIds = selectedUserIds;
    } else if (targetType === 'ROLE') {
      payload.roleIds = selectedRoleIds;
    } else if (targetType === 'ORG_UNIT') {
      payload.organizationUnitIds = selectedOrgUnitIds;
      payload.includeSubUnits = includeSubUnits;
    }

    await onSend(payload);
    setTitle('');
    setContent('');
    setActionUrl('');
  };

  const orgAvailable =
    (runtimeConfig?.orgUnitModuleInstalled ?? true) &&
    (runtimeConfig?.orgUnitTargetingEnabled ?? true) &&
    (runtimeConfig?.orgUnitBroadcastFlagEnabled ?? true);

  return (
    <form onSubmit={handleSubmit} className="glass" style={{ padding: 24, borderRadius: 14 }}>
      <h3 style={{ marginTop: 0, marginBottom: 6, fontSize: 17 }}>
        Phát hành thông báo mới trong hệ thống
      </h3>
      <p style={{ marginTop: 0, marginBottom: 18, fontSize: 13, opacity: 0.75 }}>
        Hỗ trợ tạo thông báo cho 1 người dùng, nhóm nhiều người dùng, theo Vai trò (Role) hoặc theo Đơn vị tổ chức (Organization Unit).
      </p>

      {/* Target Type Selector */}
      <div style={{ marginBottom: 18 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          1. Chọn phạm vi đối tượng nhận thông báo
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <button
            type="button"
            onClick={() => setTargetType('SINGLE_USER')}
            className={`nav-tab-btn ${targetType === 'SINGLE_USER' ? 'nav-tab-btn-active' : ''}`}
            style={{ justifyContent: 'flex-start', padding: '10px 14px' }}
          >
            <User size={16} />
            <span>Một người dùng (Single User)</span>
          </button>

          <button
            type="button"
            onClick={() => setTargetType('USER_GROUP')}
            className={`nav-tab-btn ${targetType === 'USER_GROUP' ? 'nav-tab-btn-active' : ''}`}
            style={{ justifyContent: 'flex-start', padding: '10px 14px' }}
          >
            <Users size={16} />
            <span>Nhiều người dùng (Theo nhóm)</span>
          </button>

          <button
            type="button"
            onClick={() => setTargetType('ROLE')}
            className={`nav-tab-btn ${targetType === 'ROLE' ? 'nav-tab-btn-active' : ''}`}
            style={{ justifyContent: 'flex-start', padding: '10px 14px' }}
          >
            <KeyRound size={16} />
            <span>Theo Vai trò (Role)</span>
          </button>

          <button
            type="button"
            disabled={!orgAvailable}
            onClick={() => setTargetType('ORG_UNIT')}
            className={`nav-tab-btn ${targetType === 'ORG_UNIT' ? 'nav-tab-btn-active' : ''}`}
            style={{
              justifyContent: 'flex-start',
              padding: '10px 14px',
              opacity: orgAvailable ? 1 : 0.45,
            }}
            title={
              orgAvailable
                ? 'Gửi thông báo theo Đơn vị tổ chức'
                : 'Chỉ khả dụng khi bật module Organizations và cấu hình gửi theo đơn vị'
            }
          >
            <Building2 size={16} />
            <span>Theo Đơn vị (Organization)</span>
          </button>
        </div>
      </div>

      {/* Dynamic Target Inputs */}
      <div
        style={{
          marginBottom: 18,
          padding: 14,
          borderRadius: 10,
          background: 'rgba(15, 23, 42, 0.5)',
          border: '1px solid rgba(148, 163, 184, 0.2)',
        }}
      >
        {targetType === 'SINGLE_USER' && (
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Chọn người dùng nhận thông báo:
            </label>
            {usersLookup.length > 0 ? (
              <select
                value={singleUserId}
                onChange={(e) => setSingleUserId(Number(e.target.value))}
                style={{
                  width: '100%',
                  maxWidth: 420,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.85)',
                  color: 'inherit',
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                }}
              >
                {usersLookup.map((u) => (
                  <option key={u.id} value={u.id}>
                    #{u.id} — {u.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min={1}
                value={singleUserId}
                onChange={(e) => setSingleUserId(Number(e.target.value))}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.85)',
                  color: 'inherit',
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                }}
              />
            )}
          </div>
        )}

        {targetType === 'USER_GROUP' && (
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Chọn danh sách người dùng nhận thông báo ({selectedUserIds.length} đã chọn):
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 160, overflowY: 'auto' }}>
              {(usersLookup.length > 0
                ? usersLookup
                : [
                    { id: 1, code: 'superadmin', name: 'Super Admin (#1)' },
                    { id: 2, code: 'admin', name: 'System Admin (#2)' },
                  ]
              ).map((u) => {
                const checked = selectedUserIds.includes(u.id);
                return (
                  <label
                    key={u.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '5px 10px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontSize: 12.5,
                      background: checked ? 'rgba(59, 130, 246, 0.2)' : 'rgba(15, 23, 42, 0.6)',
                      border: checked
                        ? '1px solid rgba(59, 130, 246, 0.5)'
                        : '1px solid rgba(148, 163, 184, 0.2)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setSelectedUserIds((prev) => toggleNumberInList(prev, u.id))}
                    />
                    <span>
                      #{u.id} {u.name}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {targetType === 'ROLE' && (
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Chọn một hoặc nhiều Vai trò nhận thông báo ({selectedRoleIds.length} vai trò):
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(rolesLookup.length > 0
                ? rolesLookup
                : [
                    { id: 1, code: 'super_admin', name: 'Super Administrator' },
                    { id: 2, code: 'admin', name: 'System Administrator' },
                  ]
              ).map((r) => {
                const checked = selectedRoleIds.includes(r.id);
                return (
                  <label
                    key={r.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 12px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontSize: 12.5,
                      background: checked ? 'rgba(245, 158, 11, 0.2)' : 'rgba(15, 23, 42, 0.6)',
                      border: checked
                        ? '1px solid rgba(245, 158, 11, 0.55)'
                        : '1px solid rgba(148, 163, 184, 0.2)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setSelectedRoleIds((prev) => toggleNumberInList(prev, r.id))}
                    />
                    <span>{r.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {targetType === 'ORG_UNIT' && (
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Chọn Đơn vị tổ chức nhận thông báo ({selectedOrgUnitIds.length} đơn vị):
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {(orgUnitsLookup.length > 0
                ? orgUnitsLookup
                : [
                    { id: 1, code: 'HQ_HCM', name: 'Trụ sở Chính TP.HCM (HQ_HCM)' },
                    { id: 2, code: 'BRANCH_HCM', name: 'Chi nhánh TP.HCM (BRANCH_HCM)' },
                  ]
              ).map((o) => {
                const checked = selectedOrgUnitIds.includes(o.id);
                return (
                  <label
                    key={o.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 12px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontSize: 12.5,
                      background: checked ? 'rgba(16, 185, 129, 0.2)' : 'rgba(15, 23, 42, 0.6)',
                      border: checked
                        ? '1px solid rgba(16, 185, 129, 0.55)'
                        : '1px solid rgba(148, 163, 184, 0.2)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedOrgUnitIds((prev) => toggleNumberInList(prev, o.id))
                      }
                    />
                    <span>{o.name}</span>
                  </label>
                );
              })}
            </div>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={includeSubUnits}
                onChange={(e) => setIncludeSubUnits(e.target.checked)}
              />
              <span>Gửi kèm toàn bộ nhân sự thuộc các đơn vị/phòng ban cấp dưới (Sub-units)</span>
            </label>
          </div>
        )}
      </div>

      {/* Category, Priority & Channels */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 14,
          marginBottom: 16,
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            2. Phân nhóm thông báo (Category)
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(15, 23, 42, 0.85)',
              color: 'inherit',
              border: '1px solid rgba(148, 163, 184, 0.3)',
            }}
          >
            <option value="SYSTEM">Hệ thống (SYSTEM)</option>
            <option value="WORK">Công việc & Tác vụ (WORK)</option>
            <option value="SECURITY">Bảo mật & Tài khoản (SECURITY)</option>
            <option value="ANNOUNCEMENT">Thông báo chung & Bản tin (ANNOUNCEMENT)</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            3. Mức độ ưu tiên (Priority)
          </label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(15, 23, 42, 0.85)',
              color: 'inherit',
              border: '1px solid rgba(148, 163, 184, 0.3)',
            }}
          >
            <option value="LOW">Thấp (LOW)</option>
            <option value="NORMAL">Bình thường (NORMAL)</option>
            <option value="HIGH">Cao (HIGH)</option>
            <option value="URGENT">Khẩn cấp (URGENT)</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            4. Kênh phát thông báo
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
            {(['IN_APP', 'EMAIL', 'SMS', 'PUSH'] as NotificationChannelName[]).map((ch) => (
              <label
                key={ch}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5 }}
              >
                <input
                  type="checkbox"
                  checked={selectedChannels.includes(ch)}
                  onChange={() => toggleChannel(ch)}
                />
                <span>{ch}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Title & Content */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          5. Tiêu đề thông báo *
        </label>
        <input
          type="text"
          required
          placeholder="Nhập tiêu đề thông báo..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{
            width: '100%',
            padding: '9px 12px',
            borderRadius: 8,
            background: 'rgba(15, 23, 42, 0.85)',
            color: 'inherit',
            border: '1px solid rgba(148, 163, 184, 0.3)',
          }}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          6. Nội dung chi tiết *
        </label>
        <textarea
          required
          rows={4}
          placeholder="Nhập nội dung thông báo chi tiết..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{
            width: '100%',
            padding: '9px 12px',
            borderRadius: 8,
            background: 'rgba(15, 23, 42, 0.85)',
            color: 'inherit',
            border: '1px solid rgba(148, 163, 184, 0.3)',
            resize: 'vertical',
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Action URL (tùy chọn, vd: /files)"
            value={actionUrl}
            onChange={(e) => setActionUrl(e.target.value)}
            style={{
              padding: '7px 12px',
              borderRadius: 8,
              background: 'rgba(15, 23, 42, 0.85)',
              color: 'inherit',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              width: 240,
              fontSize: 13,
            }}
          />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={forceDeliver}
              onChange={(e) => setForceDeliver(e.target.checked)}
            />
            <span>Gửi bắt buộc (bỏ qua tắt kênh cá nhân)</span>
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="nav-tab-btn nav-tab-btn-active"
          style={{ padding: '9px 18px', fontWeight: 700 }}
        >
          <Send size={15} />
          <span>{loading ? 'Đang gửi...' : 'Phát thông báo ngay'}</span>
        </button>
      </div>
    </form>
  );
};

