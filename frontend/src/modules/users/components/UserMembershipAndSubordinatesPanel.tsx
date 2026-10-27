import React from 'react';
import { Building2, GitBranch, Network } from 'lucide-react';
import { authStyles } from '../../auth/components/auth-ui.styles';
import type {
  UserOrganizationHistoryItem,
  UserSubordinatesOverview,
} from '../types/users.types';

interface UserMembershipAndSubordinatesPanelProps {
  readonly organizationHistory: readonly UserOrganizationHistoryItem[];
  readonly subordinatesOverview: UserSubordinatesOverview | null;
  readonly loadingHistory: boolean;
}

function getActionBadge(actionType: UserOrganizationHistoryItem['actionType']) {
  if (actionType === 'ASSIGN') {
    return { label: 'ASSIGN (Gán mới)', style: authStyles.badgeSuccess };
  }
  if (actionType === 'TRANSFER') {
    return { label: 'TRANSFER (Điều chuyển)', style: authStyles.badgePrimary };
  }
  if (actionType === 'UPDATE') {
    return { label: 'UPDATE (Cập nhật)', style: authStyles.badgeWarning };
  }
  return { label: 'END (Kết thúc)', style: authStyles.badgeDanger };
}

export const UserMembershipAndSubordinatesPanel: React.FC<
  UserMembershipAndSubordinatesPanelProps
> = ({ organizationHistory, subordinatesOverview, loadingHistory }) => {
  const subordinates = subordinatesOverview?.subordinates ?? [];
  const approverChain = subordinatesOverview?.approverChain ?? [];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
        gap: '16px',
      }}
    >
      {/* Left Card: Organization Membership & Transfer History (Mục 9.2.1 & 9.2.6) */}
      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>
          <Building2 size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
          Lịch sử Đơn vị & Điều chuyển Membership ({organizationHistory.length})
        </h3>
        <p style={authStyles.sectionDesc}>
          Nhật ký gán mới, cập nhật chức vụ, điều chuyển đơn vị và kết thúc thời hạn công tác từ{' '}
          <code>user_organization_histories</code> (Mục 9.2.1 & 9.2.6).
        </p>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Thời gian</th>
                <th style={authStyles.tableHeaderCell}>Thao tác</th>
                <th style={authStyles.tableHeaderCell}>Đơn vị & Điều chuyển</th>
                <th style={authStyles.tableHeaderCell}>Chức vụ & Thời hạn</th>
                <th style={authStyles.tableHeaderCell}>Lý do</th>
              </tr>
            </thead>
            <tbody>
              {organizationHistory.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      ...authStyles.tableCell,
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {loadingHistory
                      ? 'Đang tải lịch sử đơn vị...'
                      : 'Chưa có lịch sử gán hoặc điều chuyển đơn vị.'}
                  </td>
                </tr>
              ) : (
                organizationHistory.map((item) => {
                  const badge = getActionBadge(item.actionType);
                  return (
                    <tr key={item.id}>
                      <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                        {new Date(item.createdAt).toLocaleString()}
                      </td>
                      <td style={authStyles.tableCell}>
                        <span style={badge.style}>{badge.label}</span>
                      </td>
                      <td style={{ ...authStyles.tableCell, fontSize: '12.5px' }}>
                        {item.fromOrganizationUnitId ? (
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>
                              {item.fromOrganizationUnitName || `#${item.fromOrganizationUnitId}`} →{' '}
                            </span>
                            <strong>
                              {item.organizationUnitName || `#${item.organizationUnitId}`}
                            </strong>
                          </div>
                        ) : (
                          <strong>
                            {item.organizationUnitName || `#${item.organizationUnitId}`}
                          </strong>
                        )}
                        {item.isPrimary && (
                          <div style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: 700 }}>
                            ★ Đơn vị chính
                          </div>
                        )}
                      </td>
                      <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                        <div style={{ fontWeight: 600 }}>{item.positionTitle || '—'}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                          {item.startDate ? item.startDate.slice(0, 10) : '—'} →{' '}
                          {item.endDate ? item.endDate.slice(0, 10) : 'Hiện tại'}
                        </div>
                      </td>
                      <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                        {item.reason || '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right Card: Subordinates & Approval Chain (Mục 9.2.4, 9.2.5 & 9.2.7) */}
      <div style={authStyles.card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '6px',
          }}
        >
          <h3 style={{ ...authStyles.sectionTitle, marginBottom: 0 }}>
            <Network size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
            Danh sách Cấp dưới & Chuỗi Phê duyệt (Mục 9.2.7)
          </h3>
          {subordinatesOverview && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <span style={authStyles.badgePrimary}>
                Trực tiếp: {subordinatesOverview.directCount}
              </span>
              <span style={authStyles.badgeWarning}>
                Tạm thời: {subordinatesOverview.temporaryCount}
              </span>
              <span style={authStyles.badgeSuccess}>
                Gián tiếp: {subordinatesOverview.indirectCount}
              </span>
            </div>
          )}
        </div>
        <p style={authStyles.sectionDesc}>
          Dùng trực tiếp cho <code>DATA_SCOPE.SUBORDINATES</code> và luồng phê duyệt nhiều cấp
          (Approval Chain).
        </p>

        {/* Approver Chain Stepper */}
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-input)',
            border: '1px solid var(--border-color)',
            marginBottom: '12px',
          }}
        >
          <div
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--text-main)',
              marginBottom: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <GitBranch size={14} /> Chuỗi Người Phê duyệt Cấp trên (Approval Chain):
          </div>
          {approverChain.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Nhân sự này chưa có người quản lý trực tiếp hoặc tạm thời đang hiệu lực.
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              {approverChain.map((app) => (
                <div
                  key={`${app.step}-${app.userId}`}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                    Cấp {app.step}: {app.fullName} (<code>@{app.username}</code>)
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {app.positionTitle || 'Quản lý'} ·{' '}
                    {app.sourceType === 'TEMPORARY_MANAGER'
                      ? 'Ủy quyền tạm thời'
                      : 'Quản lý trực tiếp'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Subordinates Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Nhân sự cấp dưới</th>
                <th style={authStyles.tableHeaderCell}>Cấp & Quan hệ</th>
                <th style={authStyles.tableHeaderCell}>Đơn vị & Chức vụ</th>
                <th style={authStyles.tableHeaderCell}>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {subordinates.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    style={{
                      ...authStyles.tableCell,
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {loadingHistory
                      ? 'Đang tra cứu danh sách cấp dưới...'
                      : 'Nhân sự này hiện chưa quản lý cấp dưới nào.'}
                  </td>
                </tr>
              ) : (
                subordinates.map((sub) => (
                  <tr key={sub.id}>
                    <td style={{ ...authStyles.tableCell, fontSize: '12.5px' }}>
                      <div style={{ fontWeight: 700 }}>{sub.fullName}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        <code>@{sub.username}</code> · {sub.email}
                      </div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <span
                        style={
                          sub.relationType === 'DIRECT'
                            ? authStyles.badgePrimary
                            : sub.relationType === 'TEMPORARY'
                              ? authStyles.badgeWarning
                              : authStyles.badgeSuccess
                        }
                      >
                        {sub.relationType} (Bậc {sub.level})
                      </span>
                    </td>
                    <td style={{ ...authStyles.tableCell, fontSize: '12px' }}>
                      <div>{sub.primaryOrganizationUnitName || '—'}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {sub.positionTitle || '—'}
                      </div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <span style={authStyles.badgeSuccess}>{sub.statusName}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
