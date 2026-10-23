import React, { useEffect, useState } from 'react';
import { Building2, KeyRound, Plus, Save, Trash2, UserPlus } from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import {
  COMMON_USER_TIMEZONES,
  SUPPORTED_USER_LOCALES,
  USER_GENDER_OPTIONS,
  USER_STATUS,
} from '../enum/users.enum';
import type {
  CreateUserPayload,
  OrganizationOptionSummary,
  RoleOptionSummary,
  UpdateUserPayload,
  UserItem,
  UserOrganizationAssignmentInput,
} from '../types/users.types';

interface UserInspectorDrawerProps {
  readonly mode: 'create' | 'edit';
  readonly selectedUser: UserItem | null;
  readonly allUsers: readonly UserItem[];
  readonly roleOptions: readonly RoleOptionSummary[];
  readonly organizationOptions: readonly OrganizationOptionSummary[];
  readonly submitting: boolean;
  readonly onSwitchToEdit: () => void;
  readonly onCreateUser: (payload: CreateUserPayload) => Promise<boolean>;
  readonly onUpdateUser: (id: number, payload: UpdateUserPayload) => Promise<boolean>;
  readonly onAssignRoles: (id: number, roleIds: readonly number[]) => Promise<boolean>;
  readonly onAssignOrganizations: (
    id: number,
    organizationUnits: readonly UserOrganizationAssignmentInput[],
  ) => Promise<boolean>;
}

export const UserInspectorDrawer: React.FC<UserInspectorDrawerProps> = ({
  mode,
  selectedUser,
  allUsers,
  roleOptions,
  organizationOptions,
  submitting,
  onSwitchToEdit,
  onCreateUser,
  onUpdateUser,
  onAssignRoles,
  onAssignOrganizations,
}) => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('CoreUser@2026');
  const [fullName, setFullName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState<string>('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [identityNumber, setIdentityNumber] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [preferredLocale, setPreferredLocale] = useState('vi');
  const [preferredTimezone, setPreferredTimezone] = useState('Asia/Ho_Chi_Minh');
  const [managerId, setManagerId] = useState<string>('');

  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>([]);
  const [orgAssignments, setOrgAssignments] = useState<UserOrganizationAssignmentInput[]>([]);

  useEffect(() => {
    if (mode === 'create') {
      setUsername('');
      setEmail('');
      setPassword('CoreUser@2026');
      setFullName('');
      setFirstName('');
      setLastName('');
      setPhone('');
      setGender('');
      setDateOfBirth('');
      setIdentityNumber('');
      setAddress('');
      setCity('');
      setPreferredLocale('vi');
      setPreferredTimezone('Asia/Ho_Chi_Minh');
      setManagerId('');
      setSelectedRoleIds([]);
      setOrgAssignments([]);
      return;
    }

    if (selectedUser) {
      setUsername(selectedUser.username);
      setEmail(selectedUser.email);
      setFullName(selectedUser.fullName);
      setFirstName(selectedUser.firstName);
      setLastName(selectedUser.lastName);
      setPhone(selectedUser.phone ?? '');
      setGender(
        selectedUser.profile?.gender !== null && selectedUser.profile?.gender !== undefined
          ? String(selectedUser.profile.gender)
          : '',
      );
      setDateOfBirth(selectedUser.profile?.dateOfBirth ?? '');
      setIdentityNumber(selectedUser.profile?.identityNumber ?? '');
      setAddress(selectedUser.profile?.address ?? '');
      setCity(selectedUser.profile?.city ?? '');
      setPreferredLocale(
        selectedUser.preferredLocale ?? selectedUser.profile?.preferredLocale ?? 'vi',
      );
      setPreferredTimezone(
        selectedUser.preferredTimezone ??
          selectedUser.profile?.preferredTimezone ??
          'Asia/Ho_Chi_Minh',
      );
      setManagerId(selectedUser.managerId ? String(selectedUser.managerId) : '');
      setSelectedRoleIds(selectedUser.roles.map((r) => r.roleId));
      setOrgAssignments(
        selectedUser.organizationUnits.map((o) => ({
          organizationUnitId: o.organizationUnitId,
          isPrimary: o.isPrimary,
          positionTitle: o.positionTitle ?? '',
        })),
      );
    }
  }, [mode, selectedUser]);

  const toggleRoleId = (roleId: number) => {
    setSelectedRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  };

  const addOrgAssignment = () => {
    const firstAvailable = organizationOptions.find(
      (o) => !orgAssignments.some((a) => a.organizationUnitId === o.id),
    );
    if (!firstAvailable) return;
    setOrgAssignments((prev) => [
      ...prev,
      {
        organizationUnitId: firstAvailable.id,
        isPrimary: prev.length === 0,
        positionTitle: 'Chuyên viên',
      },
    ]);
  };

  const updateOrgAssignment = (
    idx: number,
    patch: Partial<UserOrganizationAssignmentInput>,
  ) => {
    setOrgAssignments((prev) =>
      prev.map((item, i) => {
        if (patch.isPrimary) {
          return {
            ...item,
            ...(i === idx ? patch : {}),
            isPrimary: i === idx,
          };
        }
        return i === idx ? { ...item, ...patch } : item;
      }),
    );
  };

  const removeOrgAssignment = (idx: number) => {
    setOrgAssignments((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length > 0 && !next.some((n) => n.isPrimary)) {
        next[0] = { ...next[0]!, isPrimary: true };
      }
      return next;
    });
  };

  const handleSubmitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'create') {
      const ok = await onCreateUser({
        ...(username.trim() ? { username: username.trim() } : {}),
        email: email.trim(),
        password,
        ...(fullName.trim() ? { fullName: fullName.trim() } : {}),
        ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
        ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
        phone: phone.trim() || null,
        gender: gender ? Number(gender) : null,
        dateOfBirth: dateOfBirth.trim() || null,
        identityNumber: identityNumber.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        preferredLocale,
        preferredTimezone,
        managerId: managerId ? Number(managerId) : null,
        status: USER_STATUS.ACTIVE,
        roleIds: selectedRoleIds,
        organizationUnits: orgAssignments,
      });
      if (ok) {
        onSwitchToEdit();
      }
      return;
    }

    if (!selectedUser) return;
    await onUpdateUser(selectedUser.id, {
      email: email.trim(),
      ...(fullName.trim() ? { fullName: fullName.trim() } : {}),
      ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
      ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
      phone: phone.trim() || null,
      gender: gender ? Number(gender) : null,
      dateOfBirth: dateOfBirth.trim() || null,
      identityNumber: identityNumber.trim() || null,
      address: address.trim() || null,
      city: city.trim() || null,
      preferredLocale,
      preferredTimezone,
      managerId: managerId ? Number(managerId) : null,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Card 1: Core Profile & Identity Form */}
      <form onSubmit={(e) => void handleSubmitProfile(e)} style={authStyles.cardHighlighted}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}
        >
          <div>
            <h3 style={authStyles.sectionTitle}>
              {mode === 'create'
                ? 'Tạo mới Hồ sơ Nhân sự'
                : `Hồ sơ Chi tiết: ${selectedUser?.fullName ?? 'Chưa chọn'}`}
            </h3>
            <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
              Lưu trữ đồng bộ trên bảng <code>users</code> (tài khoản) và <code>user_profiles</code> (thông tin cá nhân).
            </p>
          </div>
          {mode === 'create' && selectedUser && (
            <button type="button" onClick={onSwitchToEdit} style={authStyles.btnSecondary}>
              Quay lại xem #{selectedUser.id}
            </button>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
            gap: '10px',
            marginBottom: '12px',
          }}
        >
          <div>
            <label style={authStyles.label}>Username {mode === 'create' && '(Tùy chọn)'}</label>
            <input
              type="text"
              value={username}
              disabled={mode === 'edit'}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="VD: nguyen.van.a"
              style={authStyles.monoInput}
            />
          </div>

          <div>
            <label style={authStyles.label}>Email *</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@company.vn"
              style={authStyles.input}
            />
          </div>

          {mode === 'create' && (
            <div>
              <label style={authStyles.label}>Mật khẩu khởi tạo *</label>
              <input
                type="text"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={authStyles.monoInput}
              />
            </div>
          )}

          <div>
            <label style={authStyles.label}>Họ và tên đầy đủ *</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nguyễn Văn Hải"
              style={authStyles.input}
            />
          </div>

          <div>
            <label style={authStyles.label}>Họ & Tên đệm (Last Name)</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Nguyễn Văn"
              style={authStyles.input}
            />
          </div>

          <div>
            <label style={authStyles.label}>Tên gọi (First Name)</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Hải"
              style={authStyles.input}
            />
          </div>

          <div>
            <label style={authStyles.label}>Số điện thoại (Mã hóa & Blind Hash)</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0909123456"
              style={authStyles.input}
            />
          </div>

          <div>
            <label style={authStyles.label}>Giới tính</label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              style={authStyles.input}
            >
              <option value="">-- Chưa chọn --</option>
              {USER_GENDER_OPTIONS.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={authStyles.label}>Ngày sinh</label>
            <input
              type="date"
              value={dateOfBirth ? dateOfBirth.slice(0, 10) : ''}
              onChange={(e) => setDateOfBirth(e.target.value)}
              style={authStyles.input}
            />
          </div>

          <div>
            <label style={authStyles.label}>Số CCCD / CMND</label>
            <input
              type="text"
              value={identityNumber}
              onChange={(e) => setIdentityNumber(e.target.value)}
              placeholder="079099001234"
              style={authStyles.monoInput}
            />
          </div>

          <div>
            <label style={authStyles.label}>Tỉnh / Thành phố</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="TP. Hồ Chí Minh"
              style={authStyles.input}
            />
          </div>

          <div>
            <label style={authStyles.label}>Người quản lý trực tiếp (Manager)</label>
            <select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              style={authStyles.input}
            >
              <option value="">-- Không có người quản lý --</option>
              {allUsers
                .filter((u) => mode === 'create' || u.id !== selectedUser?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} (@{u.username})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label style={authStyles.label}>Ngôn ngữ ưu tiên (Locale)</label>
            <select
              value={preferredLocale}
              onChange={(e) => setPreferredLocale(e.target.value)}
              style={authStyles.input}
            >
              {SUPPORTED_USER_LOCALES.map((loc) => (
                <option key={loc.code} value={loc.code}>
                  {loc.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={authStyles.label}>Múi giờ (IANA Timezone)</label>
            <select
              value={preferredTimezone}
              onChange={(e) => setPreferredTimezone(e.target.value)}
              style={authStyles.input}
            >
              {COMMON_USER_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={authStyles.label}>Địa chỉ liên hệ</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Số nhà, đường, phường/xã..."
            style={authStyles.input}
          />
        </div>

        <button type="submit" disabled={submitting} style={authStyles.btnPrimary}>
          {mode === 'create' ? <UserPlus size={15} /> : <Save size={15} />}
          {mode === 'create' ? 'Tạo tài khoản & Lưu hồ sơ' : 'Lưu cập nhật hồ sơ cá nhân'}
        </button>
      </form>

      {/* Card 2: Multi-Role Assignment */}
      <div style={authStyles.card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
          }}
        >
          <div>
            <h4 style={{ ...authStyles.sectionTitle, fontSize: '15px' }}>
              <KeyRound
                size={15}
                style={{ verticalAlign: 'middle', marginRight: '6px', color: 'var(--primary)' }}
              />
              Phân quyền Đa Vai trò (Multi-Role RBAC)
            </h4>
            <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
              Chọn một hoặc nhiều vai trò cho nhân sự ({selectedRoleIds.length} đã chọn).
            </p>
          </div>

          {mode === 'edit' && selectedUser && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void onAssignRoles(selectedUser.id, selectedRoleIds)}
              style={authStyles.btnTeal}
            >
              <Save size={14} /> Lưu Vai trò
            </button>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
            gap: '8px',
          }}
        >
          {roleOptions.map((role) => {
            const checked = selectedRoleIds.includes(role.id);
            return (
              <label
                key={role.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: checked
                    ? '1px solid var(--primary)'
                    : '1px solid var(--border-color)',
                  background: checked ? 'var(--bg-light-blue)' : 'var(--bg-input)',
                  cursor: 'pointer',
                  fontSize: '12.5px',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleRoleId(role.id)}
                />
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{role.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    <code>{role.code}</code> · Scope: {role.dataScopeName ?? 'SELF'}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Card 3: Multi-Organization Assignment */}
      <div style={authStyles.card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
          }}
        >
          <div>
            <h4 style={{ ...authStyles.sectionTitle, fontSize: '15px' }}>
              <Building2
                size={15}
                style={{ verticalAlign: 'middle', marginRight: '6px', color: 'var(--secondary)' }}
              />
              Phân công Đa Đơn vị & Phòng ban (1 Đơn vị chính)
            </h4>
            <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
              Nhân sự có thể thuộc nhiều đơn vị nhưng chỉ có 1 đơn vị chính (<code>isPrimary</code>).
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={addOrgAssignment} style={authStyles.btnSecondary}>
              <Plus size={14} /> Thêm đơn vị
            </button>
            {mode === 'edit' && selectedUser && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void onAssignOrganizations(selectedUser.id, orgAssignments)}
                style={authStyles.btnTeal}
              >
                <Save size={14} /> Lưu Đơn vị
              </button>
            )}
          </div>
        </div>

        {orgAssignments.length === 0 ? (
          <div
            style={{
              padding: '14px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-input)',
              fontSize: '12.5px',
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}
          >
            Chưa gán đơn vị nào. Nhấn &ldquo;Thêm đơn vị&rdquo; để phân công phòng ban/chi nhánh.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {orgAssignments.map((item, idx) => (
              <div
                key={`${item.organizationUnitId}-${idx}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.6fr 1.2fr auto auto',
                  gap: '8px',
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: item.isPrimary
                    ? '1px solid var(--secondary)'
                    : '1px solid var(--border-color)',
                  background: 'var(--bg-input)',
                }}
              >
                <select
                  value={item.organizationUnitId}
                  onChange={(e) =>
                    updateOrgAssignment(idx, {
                      organizationUnitId: Number(e.target.value),
                    })
                  }
                  style={authStyles.input}
                >
                  {organizationOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.code})
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  value={item.positionTitle ?? ''}
                  onChange={(e) =>
                    updateOrgAssignment(idx, { positionTitle: e.target.value })
                  }
                  placeholder="Chức danh (VD: Trưởng phòng)"
                  style={authStyles.input}
                />

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <input
                    type="radio"
                    name="primaryOrgUnit"
                    checked={Boolean(item.isPrimary)}
                    onChange={() => updateOrgAssignment(idx, { isPrimary: true })}
                  />
                  Đơn vị chính
                </label>

                <button
                  type="button"
                  onClick={() => removeOrgAssignment(idx)}
                  style={{
                    ...authStyles.btnDanger,
                    padding: '6px 9px',
                  }}
                  title="Xóa đơn vị này"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

