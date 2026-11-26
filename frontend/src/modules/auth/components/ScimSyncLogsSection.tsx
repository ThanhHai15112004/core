import React, { useState } from 'react';
import { Activity, Filter } from 'lucide-react';
import { authStyles } from './auth-ui.styles';
import type { ScimClientItem, ScimSyncLogItem } from '../types/scim-provisioning.types';

interface ScimSyncLogsSectionProps {
  readonly busy: boolean;
  readonly clients: readonly ScimClientItem[];
  readonly syncLogs: readonly ScimSyncLogItem[];
  readonly onFilterLogs: (filters?: {
    clientId?: number;
    outcome?: string;
    resourceType?: string;
  }) => Promise<void>;
}

export const ScimSyncLogsSection: React.FC<ScimSyncLogsSectionProps> = ({
  busy,
  clients,
  syncLogs,
  onFilterLogs,
}) => {
  const [clientId, setClientId] = useState<string>('');
  const [outcome, setOutcome] = useState<string>('');
  const [resourceType, setResourceType] = useState<string>('');

  const resolveOutcomeBadge = (val: ScimSyncLogItem['outcome']) => {
    switch (val) {
      case 'SUCCESS':
        return authStyles.badgeSuccess;
      case 'NOOP_DUPLICATE':
        return authStyles.badgePrimary;
      case 'CONFLICT':
        return authStyles.badgeWarning;
      default:
        return authStyles.badgeDanger;
    }
  };

  return (
    <div style={authStyles.card}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '14px',
        }}
      >
        <h3 style={{ ...authStyles.sectionTitle, margin: 0 }}>
          <Activity size={17} />
          <span>Lịch sử đồng bộ SCIM ({syncLogs.length})</span>
        </h3>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            style={{ ...authStyles.input, width: '160px' }}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">Tất cả Client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
          <select
            style={{ ...authStyles.input, width: '150px' }}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          >
            <option value="">Mọi kết quả</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="NOOP_DUPLICATE">NOOP_DUPLICATE</option>
            <option value="CONFLICT">CONFLICT</option>
            <option value="FAILED">FAILED</option>
          </select>
          <select
            style={{ ...authStyles.input, width: '140px' }}
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
          >
            <option value="">Mọi tài nguyên</option>
            <option value="User">User</option>
            <option value="Group">Group</option>
            <option value="ScimClient">ScimClient</option>
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void onFilterLogs({
                ...(clientId ? { clientId: Number(clientId) } : {}),
                ...(outcome ? { outcome } : {}),
                ...(resourceType ? { resourceType } : {}),
              })
            }
            style={authStyles.btnSecondary}
          >
            <Filter size={13} /> Lọc
          </button>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={authStyles.tableHeaderCell}>Thời gian</th>
              <th style={authStyles.tableHeaderCell}>Operation</th>
              <th style={authStyles.tableHeaderCell}>Resource / External ID</th>
              <th style={authStyles.tableHeaderCell}>HTTP</th>
              <th style={authStyles.tableHeaderCell}>Outcome</th>
              <th style={authStyles.tableHeaderCell}>Lỗi / Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {syncLogs.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ ...authStyles.tableCell, textAlign: 'center' }}>
                  Chưa có bản ghi nhật ký SCIM nào.
                </td>
              </tr>
            ) : (
              syncLogs.map((log) => (
                <tr key={log.id}>
                  <td style={authStyles.tableCell}>
                    <div style={{ fontSize: '12px' }}>
                      {new Date(log.createdAt).toLocaleString()}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {log.durationMs}ms · {log.ipAddress ?? '-'}
                    </div>
                  </td>
                  <td style={authStyles.tableCell}>
                    <code>
                      {log.httpMethod} {log.operation}
                    </code>
                  </td>
                  <td style={authStyles.tableCell}>
                    <div>
                      {log.resourceType} #{log.resourceId ?? '-'}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      ext: {log.externalId ?? '-'}
                    </div>
                  </td>
                  <td style={authStyles.tableCell}>{log.httpStatus}</td>
                  <td style={authStyles.tableCell}>
                    <span style={resolveOutcomeBadge(log.outcome)}>
                      {log.outcome}
                      {log.idempotencyHit ? ' (Dedup)' : ''}
                    </span>
                  </td>
                  <td style={authStyles.tableCell}>
                    {log.errorMessage ? (
                      <span style={{ color: 'var(--status-danger)', fontSize: '12px' }}>
                        {log.errorCode ? `[${log.errorCode}] ` : ''}
                        {log.errorMessage}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
