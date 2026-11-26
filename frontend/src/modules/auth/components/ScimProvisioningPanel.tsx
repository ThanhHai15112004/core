import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { authStyles } from './auth-ui.styles';
import { ScimClientsSection } from './ScimClientsSection';
import { ScimDirectorySection } from './ScimDirectorySection';
import { ScimReconciliationSection } from './ScimReconciliationSection';
import { ScimSyncLogsSection } from './ScimSyncLogsSection';
import type { UpsertScimClientPayload } from '../services/scim-provisioning.api';
import type {
  ScimClientItem,
  ScimGroupItem,
  ScimReconciliationMode,
  ScimReconciliationRunItem,
  ScimSyncLogItem,
  ScimUserLinkItem,
} from '../types/scim-provisioning.types';

type ScimSubView = 'clients' | 'directory' | 'logs' | 'reconcile';

interface ScimProvisioningPanelProps {
  readonly accessToken: string;
  readonly busy: boolean;
  readonly clients: readonly ScimClientItem[];
  readonly userLinks: readonly ScimUserLinkItem[];
  readonly groups: readonly ScimGroupItem[];
  readonly syncLogs: readonly ScimSyncLogItem[];
  readonly reconciliations: readonly ScimReconciliationRunItem[];
  readonly issuedTokenBanner: { readonly clientCode: string; readonly plainToken: string } | null;
  readonly onClearIssuedToken: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly onCreateClient: (payload: UpsertScimClientPayload) => Promise<void>;
  readonly onUpdateClient: (clientId: number, payload: UpsertScimClientPayload) => Promise<void>;
  readonly onRotateToken: (clientId: number) => Promise<void>;
  readonly onDeleteClient: (clientId: number) => Promise<void>;
  readonly onFilterLogs: (filters?: {
    clientId?: number;
    outcome?: string;
    resourceType?: string;
  }) => Promise<void>;
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

export const ScimProvisioningPanel: React.FC<ScimProvisioningPanelProps> = ({
  accessToken,
  busy,
  clients,
  userLinks,
  groups,
  syncLogs,
  reconciliations,
  issuedTokenBanner,
  onClearIssuedToken,
  onRefresh,
  onCreateClient,
  onUpdateClient,
  onRotateToken,
  onDeleteClient,
  onFilterLogs,
  onRunReconciliation,
}) => {
  const [view, setView] = useState<ScimSubView>('clients');

  if (!accessToken) {
    return (
      <div style={authStyles.card}>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          Vui lòng đăng nhập bằng tài khoản quản trị có quyền <code>identity-provisioning.read</code>{' '}
          để cấu hình và theo dõi SCIM 2.0 Provisioning.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div
        style={{
          ...authStyles.card,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          padding: '12px 16px',
        }}
      >
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {(
            [
              { id: 'clients', label: `SCIM Clients (${clients.length})` },
              { id: 'directory', label: `Users & Groups (${userLinks.length}/${groups.length})` },
              { id: 'logs', label: `Lịch sử đồng bộ (${syncLogs.length})` },
              { id: 'reconcile', label: `Đối soát IdP (${reconciliations.length})` },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              style={view === item.id ? authStyles.btnPrimary : authStyles.btnSecondary}
            >
              {item.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void onRefresh()}
          style={authStyles.btnSecondary}
        >
          <RefreshCw size={14} /> Làm mới
        </button>
      </div>

      {view === 'clients' && (
        <ScimClientsSection
          busy={busy}
          clients={clients}
          issuedTokenBanner={issuedTokenBanner}
          onClearIssuedToken={onClearIssuedToken}
          onCreateClient={onCreateClient}
          onUpdateClient={onUpdateClient}
          onRotateToken={onRotateToken}
          onDeleteClient={onDeleteClient}
        />
      )}

      {view === 'directory' && <ScimDirectorySection userLinks={userLinks} groups={groups} />}

      {view === 'logs' && (
        <ScimSyncLogsSection
          busy={busy}
          clients={clients}
          syncLogs={syncLogs}
          onFilterLogs={onFilterLogs}
        />
      )}

      {view === 'reconcile' && (
        <ScimReconciliationSection
          busy={busy}
          clients={clients}
          reconciliations={reconciliations}
          onRunReconciliation={onRunReconciliation}
        />
      )}
    </div>
  );
};
