import React, { useState } from 'react';
import { GitCompare, Play } from 'lucide-react';
import { authStyles } from './auth-ui.styles';
import type {
  ScimClientItem,
  ScimReconciliationMode,
  ScimReconciliationRunItem,
} from '../types/scim-provisioning.types';

interface ScimReconciliationSectionProps {
  readonly busy: boolean;
  readonly clients: readonly ScimClientItem[];
  readonly reconciliations: readonly ScimReconciliationRunItem[];
  readonly onRunReconciliation: (
    clientId: number,
    payload: {
      mode: ScimReconciliationMode;
      applyDeprovisionOrphans?: boolean;
      applySyncMissingAndDrifts?: boolean;
      idpUsers: unknown[];
      idpGroups?: unknown[];
    },
  ) => Promise<ScimReconciliationRunItem | null>;
}

const SAMPLE_SNAPSHOT = JSON.stringify(
  {
    idpUsers: [
      {
        externalId: 'idp-u-001',
        userName: 'scim.alice@example.com',
        email: 'scim.alice@example.com',
        firstName: 'Alice',
        lastName: 'Nguyen',
        fullName: 'Alice Nguyen',
        active: true,
      },
    ],
    idpGroups: [
      {
        externalId: 'idp-g-001',
        displayName: 'Engineering',
        memberExternalIds: ['idp-u-001'],
      },
    ],
  },
  null,
  2,
);

export const ScimReconciliationSection: React.FC<ScimReconciliationSectionProps> = ({
  busy,
  clients,
  reconciliations,
  onRunReconciliation,
}) => {
  const [selectedClientId, setSelectedClientId] = useState<string>(
    clients[0]?.id ? String(clients[0].id) : '',
  );
  const [mode, setMode] = useState<ScimReconciliationMode>('DRY_RUN');
  const [snapshotJson, setSnapshotJson] = useState(SAMPLE_SNAPSHOT);
  const [latestRun, setLatestRun] = useState<ScimReconciliationRunItem | null>(null);

  const effectiveClientId = selectedClientId || (clients[0]?.id ? String(clients[0].id) : '');

  const handleRun = async () => {
    if (!effectiveClientId) return;
    let parsed: { idpUsers?: unknown[]; idpGroups?: unknown[] } = {};
    try {
      parsed = JSON.parse(snapshotJson) as { idpUsers?: unknown[]; idpGroups?: unknown[] };
    } catch {
      return;
    }
    const result = await onRunReconciliation(Number(effectiveClientId), {
      mode,
      applyDeprovisionOrphans: true,
      applySyncMissingAndDrifts: true,
      idpUsers: Array.isArray(parsed.idpUsers) ? parsed.idpUsers : [],
      idpGroups: Array.isArray(parsed.idpGroups) ? parsed.idpGroups : [],
    });
    if (result) {
      setLatestRun(result);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>
          <GitCompare size={17} />
          <span>Đối soát dữ liệu với Identity Provider</span>
        </h3>
        <p style={authStyles.sectionDesc}>
          So sánh snapshot Users/Groups từ IdP với dữ liệu SCIM nội bộ để phát hiện user thiếu,
          user mồ côi cần deprovision, lệch thuộc tính/trạng thái hoặc lệch thành viên nhóm.
        </p>

        <div style={{ display: 'grid', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={authStyles.label}>SCIM Client</label>
              <select
                style={{ ...authStyles.input, width: '220px' }}
                value={effectiveClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
              >
                {clients.length === 0 ? (
                  <option value="">-- Chưa có Client --</option>
                ) : (
                  clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label style={authStyles.label}>Chế độ chạy</label>
              <select
                style={{ ...authStyles.input, width: '210px' }}
                value={mode}
                onChange={(e) => setMode(e.target.value as ScimReconciliationMode)}
              >
                <option value="DRY_RUN">DRY_RUN (Chỉ phát hiện lệch)</option>
                <option value="APPLY">APPLY (Tự động đồng bộ & khóa)</option>
              </select>
            </div>
            <button
              type="button"
              disabled={busy || !effectiveClientId}
              onClick={() => void handleRun()}
              style={mode === 'APPLY' ? authStyles.btnAccent : authStyles.btnPrimary}
            >
              <Play size={14} /> Chạy đối soát
            </button>
          </div>

          <div>
            <label style={authStyles.label}>IdP Snapshot JSON (idpUsers &amp; idpGroups)</label>
            <textarea
              style={{ ...authStyles.monoInput, minHeight: '170px' }}
              value={snapshotJson}
              onChange={(e) => setSnapshotJson(e.target.value)}
            />
          </div>
        </div>
      </div>

      {latestRun && (
        <div style={authStyles.cardHighlighted}>
          <h4 style={{ margin: '0 0 10px', fontSize: '14px' }}>
            Kết quả đối soát #{latestRun.id} ({latestRun.mode}) — {latestRun.discrepanciesCount} sai
            lệch
          </h4>
          {latestRun.discrepancies.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--status-success)' }}>
              Không phát hiện sai lệch giữa hệ thống nội bộ và Identity Provider.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={authStyles.tableHeaderCell}>Loại sai lệch</th>
                    <th style={authStyles.tableHeaderCell}>Đối tượng</th>
                    <th style={authStyles.tableHeaderCell}>External ID</th>
                    <th style={authStyles.tableHeaderCell}>Xử lý</th>
                  </tr>
                </thead>
                <tbody>
                  {latestRun.discrepancies.map((d, idx) => (
                    <tr key={`${d.type}-${idx}`}>
                      <td style={authStyles.tableCell}>
                        <span style={authStyles.badgeWarning}>{d.type}</span>
                      </td>
                      <td style={authStyles.tableCell}>
                        {d.entityType}: {d.identifier}
                      </td>
                      <td style={authStyles.tableCell}>
                        <code>{d.externalId ?? '-'}</code>
                      </td>
                      <td style={authStyles.tableCell}>
                        {d.resolved ? d.resolutionAction : 'Chỉ báo cáo (Dry-Run)'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div style={authStyles.card}>
        <h3 style={authStyles.sectionTitle}>Lịch sử các phiên đối soát ({reconciliations.length})</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={authStyles.tableHeaderCell}>ID</th>
                <th style={authStyles.tableHeaderCell}>Mode</th>
                <th style={authStyles.tableHeaderCell}>IdP / Local Users</th>
                <th style={authStyles.tableHeaderCell}>Sai lệch</th>
                <th style={authStyles.tableHeaderCell}>Đã áp dụng</th>
                <th style={authStyles.tableHeaderCell}>Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {reconciliations.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...authStyles.tableCell, textAlign: 'center' }}>
                    Chưa có phiên đối soát nào.
                  </td>
                </tr>
              ) : (
                reconciliations.map((run) => (
                  <tr key={run.id}>
                    <td style={authStyles.tableCell}>#{run.id}</td>
                    <td style={authStyles.tableCell}>
                      <span
                        style={
                          run.mode === 'APPLY' ? authStyles.badgeWarning : authStyles.badgePrimary
                        }
                      >
                        {run.mode}
                      </span>
                    </td>
                    <td style={authStyles.tableCell}>
                      {run.idpUsersCount} / {run.localUsersCount}
                    </td>
                    <td style={authStyles.tableCell}>{run.discrepanciesCount}</td>
                    <td style={authStyles.tableCell}>{run.appliedActionsCount}</td>
                    <td style={authStyles.tableCell}>
                      {new Date(run.startedAt).toLocaleString()}
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
