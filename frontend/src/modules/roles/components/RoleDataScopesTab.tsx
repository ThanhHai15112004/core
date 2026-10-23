import React, { useState } from 'react';
import {
  CheckCircle2,
  Compass,
  Layers,
  PlusCircle,
  ShieldAlert,
} from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import { DATA_SCOPE_META } from '../enum/roles.enum';
import type {
  CustomScopeRuleItem,
  EffectiveDataScopeOverview,
  RegisterCustomScopeRulePayload,
  RoleItem,
} from '../types/roles.types';

interface RoleDataScopesTabProps {
  effectiveScope: EffectiveDataScopeOverview | null;
  customRules: readonly CustomScopeRuleItem[];
  roles: readonly RoleItem[];
  submitting: boolean;
  onRegisterCustomRule: (payload: RegisterCustomScopeRulePayload) => Promise<boolean>;
}

export const RoleDataScopesTab: React.FC<RoleDataScopesTabProps> = ({
  effectiveScope,
  customRules,
  roles,
  submitting,
  onRegisterCustomRule,
}) => {
  const [ruleCode, setRuleCode] = useState<string>('');
  const [resource, setResource] = useState<string>('users');
  const [moduleName, setModuleName] = useState<string>('users');
  const [ruleName, setRuleName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [allowAllPerm, setAllowAllPerm] = useState<string>('');
  const [orgUnitIdsRaw, setOrgUnitIdsRaw] = useState<string>('');
  const [userIdsRaw, setUserIdsRaw] = useState<string>('');

  const handleSubmitRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedOrgs = orgUnitIdsRaw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    const parsedUsers = userIdsRaw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);

    const ok = await onRegisterCustomRule({
      code: ruleCode.trim(),
      resource: resource.trim(),
      module: moduleName.trim() || resource.trim(),
      name: ruleName.trim(),
      description: description.trim() || null,
      ...(parsedOrgs.length > 0 ? { allowedOrganizationUnitIds: parsedOrgs } : {}),
      ...(parsedUsers.length > 0 ? { allowedUserIds: parsedUsers } : {}),
      ...(allowAllPerm.trim() ? { allowAllIfHasPermission: allowAllPerm.trim() } : {}),
    });

    if (ok) {
      setRuleCode('');
      setRuleName('');
      setDescription('');
      setAllowAllPerm('');
      setOrgUnitIdsRaw('');
      setUserIdsRaw('');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Effective Data Scope Card for Current Actor */}
      <div style={authStyles.cardHighlighted}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h3 style={authStyles.sectionTitle}>
              <Compass size={18} color="var(--primary)" />
              Phạm vi Dữ liệu Hiệu lực của Tài khoản hiện hành (Effective Data Scope)
            </h3>
            <p style={{ ...authStyles.sectionDesc, marginBottom: 0 }}>
              Hệ thống tự động lấy mức rộng nhất (Least-Restrictive Union) khi người dùng giữ nhiều vai trò hoạt động
            </p>
          </div>

          {effectiveScope && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={authStyles.badgePrimary}>
                Cấp hiệu lực: {effectiveScope.filter.effectiveScopeName} (#
                {effectiveScope.filter.effectiveScope})
              </span>
              {effectiveScope.filter.isUnrestricted ? (
                <span style={authStyles.badgeWarning}>UNRESTRICTED (Toàn hệ thống)</span>
              ) : (
                <span style={authStyles.badgeSuccess}>SCOPED FILTER ACTIVE</span>
              )}
            </div>
          )}
        </div>

        {effectiveScope && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '12px',
              marginTop: '14px',
            }}
          >
            <div style={authStyles.codeBox}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Các cấp Data Scope được cấp
              </div>
              <strong>{effectiveScope.filter.grantedScopes.join(', ') || '4 (SELF)'}</strong>
            </div>
            <div style={authStyles.codeBox}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Đơn vị cho phép (allowedOrganizationUnitIds)
              </div>
              <strong>
                {effectiveScope.filter.allowedOrganizationUnitIds.length > 0
                  ? effectiveScope.filter.allowedOrganizationUnitIds.join(', ')
                  : 'Tất cả (hoặc theo cấp hiệu lực)'}
              </strong>
            </div>
            <div style={authStyles.codeBox}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Rule nghiệp vụ đã áp dụng
              </div>
              <strong>
                {effectiveScope.filter.appliedRuleCodes.length > 0
                  ? effectiveScope.filter.appliedRuleCodes.join(', ')
                  : 'Mặc định Core'}
              </strong>
            </div>
          </div>
        )}
      </div>

      {/* 4 Standard Data Scope Tiers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))',
          gap: '14px',
        }}
      >
        {Object.values(DATA_SCOPE_META).map((meta) => {
          const count = roles.filter((r) => r.dataScope === meta.code).length;
          return (
            <div key={meta.code} style={authStyles.card}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <span
                  style={
                    meta.tone === 'accent'
                      ? authStyles.badgeWarning
                      : meta.tone === 'primary'
                        ? authStyles.badgePrimary
                        : authStyles.badgeSuccess
                  }
                >
                  Cấp #{meta.code} · {meta.name}
                </span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  {count} vai trò
                </span>
              </div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: '14.5px',
                  color: 'var(--text-main)',
                  marginBottom: '6px',
                }}
              >
                {meta.label}
              </div>
              <p
                style={{
                  fontSize: '12.5px',
                  color: 'var(--text-muted)',
                  margin: 0,
                  lineHeight: 1.5,
                }}
              >
                {meta.description}
              </p>
            </div>
          );
        })}
      </div>

      {/* Custom Scope Rules Management */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: '18px' }}>
        <div style={authStyles.card}>
          <h3 style={authStyles.sectionTitle}>
            <Layers size={17} color="var(--primary)" />
            Danh sách Rule Phạm vi Dữ liệu Nghiệp vụ ({customRules.length})
          </h3>
          <p style={authStyles.sectionDesc}>
            Các module nghiệp vụ (LMS, CRM, HRM...) có thể đăng ký rule phạm vi riêng vào{' '}
            <code>DataScopeService</code> mà không cần sửa Core
          </p>

          {customRules.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Chưa có custom rule phạm vi dữ liệu nào được đăng ký thêm.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={authStyles.tableHeaderCell}>Mã Rule</th>
                    <th style={authStyles.tableHeaderCell}>Resource / Module</th>
                    <th style={authStyles.tableHeaderCell}>Tên & Mô tả</th>
                    <th style={authStyles.tableHeaderCell}>Độ ưu tiên</th>
                  </tr>
                </thead>
                <tbody>
                  {customRules.map((rule) => (
                    <tr key={rule.code}>
                      <td style={authStyles.tableCell}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                          {rule.code}
                        </span>
                      </td>
                      <td style={authStyles.tableCell}>
                        <span style={authStyles.badgePrimary}>{rule.resource}</span>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                          module: {rule.module}
                        </div>
                      </td>
                      <td style={authStyles.tableCell}>
                        <div style={{ fontWeight: 600 }}>{rule.name}</div>
                        {rule.description && (
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            {rule.description}
                          </div>
                        )}
                      </td>
                      <td style={authStyles.tableCell}>
                        <span style={authStyles.badgeSuccess}>P{rule.priority}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Form Register Declarative Custom Scope Rule */}
        <div style={authStyles.card}>
          <h3 style={authStyles.sectionTitle}>
            <PlusCircle size={17} color="var(--secondary)" />
            Đăng ký Rule Phạm vi Dữ liệu Động
          </h3>
          <p style={authStyles.sectionDesc}>
            Bổ sung quy tắc mở rộng phạm vi truy cập theo tài nguyên, đơn vị hoặc quyền hạn đặc biệt
          </p>

          <form onSubmit={(e) => void handleSubmitRule(e)}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
                marginBottom: '10px',
              }}
            >
              <div>
                <label style={authStyles.label}>Mã Rule (Code)</label>
                <input
                  type="text"
                  required
                  value={ruleCode}
                  onChange={(e) => setRuleCode(e.target.value)}
                  placeholder="vd: lms.instructor_course_scope"
                  style={authStyles.monoInput}
                />
              </div>
              <div>
                <label style={authStyles.label}>Tên Rule hiển thị</label>
                <input
                  type="text"
                  required
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="vd: Giảng viên xem học viên cùng khóa"
                  style={authStyles.input}
                />
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
                marginBottom: '10px',
              }}
            >
              <div>
                <label style={authStyles.label}>Resource áp dụng</label>
                <input
                  type="text"
                  required
                  value={resource}
                  onChange={(e) => setResource(e.target.value)}
                  placeholder="vd: users, courses, orders"
                  style={authStyles.monoInput}
                />
              </div>
              <div>
                <label style={authStyles.label}>Module sở hữu</label>
                <input
                  type="text"
                  value={moduleName}
                  onChange={(e) => setModuleName(e.target.value)}
                  placeholder="vd: lms, users"
                  style={authStyles.monoInput}
                />
              </div>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label style={authStyles.label}>
                Quyền cho phép bỏ giới hạn (allowAllIfHasPermission — tùy chọn)
              </label>
              <input
                type="text"
                value={allowAllPerm}
                onChange={(e) => setAllowAllPerm(e.target.value)}
                placeholder="vd: users.audit_all"
                style={authStyles.monoInput}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
                marginBottom: '10px',
              }}
            >
              <div>
                <label style={authStyles.label}>ID Đơn vị mở rộng (cách nhau dấu phẩy)</label>
                <input
                  type="text"
                  value={orgUnitIdsRaw}
                  onChange={(e) => setOrgUnitIdsRaw(e.target.value)}
                  placeholder="vd: 1, 2, 5"
                  style={authStyles.monoInput}
                />
              </div>
              <div>
                <label style={authStyles.label}>ID User mở rộng (cách nhau dấu phẩy)</label>
                <input
                  type="text"
                  value={userIdsRaw}
                  onChange={(e) => setUserIdsRaw(e.target.value)}
                  placeholder="vd: 10, 25"
                  style={authStyles.monoInput}
                />
              </div>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={authStyles.label}>Mô tả chi tiết</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ghi chú điều kiện kích hoạt rule phạm vi dữ liệu..."
                style={authStyles.input}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                <ShieldAlert size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                Rule có hiệu lực ngay lập tức trên <code>DataScopeService</code>
              </span>
              <button type="submit" disabled={submitting} style={authStyles.btnTeal}>
                <CheckCircle2 size={14} />
                {submitting ? 'Đang đăng ký...' : 'Đăng ký Rule'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

