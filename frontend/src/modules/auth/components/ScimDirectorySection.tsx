import React from 'react';
import { Users } from 'lucide-react';
import { authStyles } from './auth-ui.styles';
import type { ScimGroupItem, ScimUserLinkItem } from '../types/scim-provisioning.types';

interface ScimDirectorySectionProps {
  readonly userLinks: readonly ScimUserLinkItem[];
  readonly groups: readonly ScimGroupItem[];
}

export const ScimDirectorySection: React.FC<ScimDirectorySectionProps> = ({
  userLinks,
  groups,
}) => {
  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>
          <Users size={17} />
          <span>SCIM User Links ({userLinks.length})</span>
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>User ID</th>
                <th style={authStyles.tableHeaderCell}>External ID</th>
                <th style={authStyles.tableHeaderCell}>Username / Email</th>
                <th style={authStyles.tableHeaderCell}>ETag Ver</th>
                <th style={authStyles.tableHeaderCell}>SCIM Active</th>
                <th style={authStyles.tableHeaderCell}>User Status</th>
              </tr>
            </thead>
            <tbody>
              {userLinks.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...authStyles.tableCell, textAlign: 'center' }}>
                    Chưa có liên kết người dùng SCIM nào.
                  </td>
                </tr>
              ) : (
                userLinks.map((link) => (
                  <tr key={link.id}>
                    <td style={authStyles.tableCell}>#{link.userId}</td>
                    <td style={authStyles.tableCell}>
                      <code>{link.externalId}</code>
                    </td>
                    <td style={authStyles.tableCell}>
                      <div>{link.scimUsername}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {link.userEmail ?? '-'}
                      </div>
                    </td>
                    <td style={authStyles.tableCell}>
                      <code>W/&quot;{link.scimVersion}&quot;</code>
                    </td>
                    <td style={authStyles.tableCell}>
                      <span
                        style={link.active ? authStyles.badgeSuccess : authStyles.badgeDanger}
                      >
                        {link.active ? 'ACTIVE' : 'DEPROVISIONED'}
                      </span>
                    </td>
                    <td style={authStyles.tableCell}>{link.userStatusName ?? '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>
          <Users size={17} />
          <span>SCIM Groups ({groups.length})</span>
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>Group ID</th>
                <th style={authStyles.tableHeaderCell}>Display Name</th>
                <th style={authStyles.tableHeaderCell}>External ID</th>
                <th style={authStyles.tableHeaderCell}>Mapped Role</th>
                <th style={authStyles.tableHeaderCell}>Members</th>
                <th style={authStyles.tableHeaderCell}>ETag Ver</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...authStyles.tableCell, textAlign: 'center' }}>
                    Chưa có nhóm SCIM nào.
                  </td>
                </tr>
              ) : (
                groups.map((grp) => (
                  <tr key={grp.id}>
                    <td style={authStyles.tableCell}>#{grp.id}</td>
                    <td style={authStyles.tableCell}>
                      <strong>{grp.displayName}</strong>
                    </td>
                    <td style={authStyles.tableCell}>
                      <code>{grp.externalId ?? '-'}</code>
                    </td>
                    <td style={authStyles.tableCell}>
                      {grp.mappedRoleCode ? (
                        <span style={authStyles.badgePrimary}>{grp.mappedRoleCode}</span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td style={authStyles.tableCell}>{grp.memberCount}</td>
                    <td style={authStyles.tableCell}>
                      <code>W/&quot;{grp.scimVersion}&quot;</code>
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
